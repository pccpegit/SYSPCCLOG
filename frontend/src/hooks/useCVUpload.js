import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadCVFiles } from '../api/hr';
import { hrErrorCode, hrErrorMessage } from '../utils/hrErrors';

const CONCURRENCY = 2;
const MAX_BATCH_BYTES = 40 * 1024 * 1024;
// Errors of the whole request that make retrying pointless.
const FATAL_CODES = new Set(['analysis_limit_reached', 'daily_limit_reached', 'analysis_unavailable', 'no_files', 'requirements_locked']);

/** Splits entries into batches of <= batchSize files and <= 40 MB. */
export function makeBatches(entries, batchSize = 25, maxBytes = MAX_BATCH_BYTES) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = entry.file.size ?? 0;
    if (current.length && (current.length >= batchSize || bytes + size > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

function applyResult(batch, data, onEntry, summary) {
  const rejected = {};
  (data?.rejected ?? []).forEach((r) => {
    (rejected[r.original_name] ??= []).push(r);
  });
  const duplicates = {};
  (data?.duplicates ?? []).forEach((d) => {
    duplicates[d.original_name] = (duplicates[d.original_name] ?? 0) + 1;
  });
  for (const entry of batch) {
    const name = entry.file.name;
    if (rejected[name]?.length) {
      const r = rejected[name].shift();
      summary.rejected += 1;
      onEntry(entry.id, { state: 'rejected', detail: r.detail, code: r.code });
    } else if (duplicates[name] > 0) {
      duplicates[name] -= 1;
      summary.duplicates += 1;
      onEntry(entry.id, { state: 'duplicate', detail: '' });
    } else {
      summary.uploaded += 1;
      onEntry(entry.id, { state: 'uploaded', detail: '' });
    }
  }
}

/**
 * Uploads CVs in batches (<= batch_size files, 2 in parallel, each batch
 * retried once on network/5xx errors). `onEntry(id, patch)` reports the state of
 * every file. Stopping keeps what was already uploaded.
 * Resolves { uploaded, duplicates, rejected, failed, aborted, fatal }.
 */
export default function useCVUpload(analysisId) {
  const [state, setState] = useState({ uploading: false, stopping: false, sent: 0, total: 0 });
  const controllerRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setState((s) => (s.uploading ? { ...s, stopping: true } : s));
  }, []);

  const upload = useCallback(
    async (entries, { batchSize = 25, onEntry = () => {} } = {}) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;
      const batches = makeBatches(entries, batchSize);
      const summary = { uploaded: 0, duplicates: 0, rejected: 0, failed: 0, aborted: false, fatal: null };
      setState({ uploading: true, stopping: false, sent: 0, total: entries.length });

      const runBatch = async (batch) => {
        batch.forEach((e) => onEntry(e.id, { state: 'uploading', detail: '' }));
        let lastError = null;
        for (let attempt = 0; attempt < 2 && !signal.aborted; attempt += 1) {
          try {
            const { data } = await uploadCVFiles(analysisId, batch.map((e) => e.file), { signal });
            applyResult(batch, data, onEntry, summary);
            return;
          } catch (err) {
            if (signal.aborted) break;
            lastError = err;
            const status = err?.response?.status;
            if (FATAL_CODES.has(hrErrorCode(err))) break; // limits/no key: retrying is pointless
            if (status && status < 500 && status !== 429) break; // business error: do not retry
          }
        }
        if (signal.aborted || !lastError) {
          batch.forEach((e) => onEntry(e.id, { state: 'pending', detail: '' }));
          return;
        }
        const code = hrErrorCode(lastError);
        if (FATAL_CODES.has(code)) {
          summary.fatal = { code, message: hrErrorMessage(lastError) };
          batch.forEach((e) => onEntry(e.id, { state: 'pending', detail: '' }));
          return;
        }
        summary.failed += batch.length;
        const detail = hrErrorMessage(lastError);
        batch.forEach((e) => onEntry(e.id, { state: 'failed', detail }));
      };

      let cursor = 0;
      const worker = async () => {
        while (!signal.aborted && !summary.fatal) {
          const index = cursor;
          cursor += 1;
          if (index >= batches.length) break;
          const batch = batches[index];
          await runBatch(batch);
          setState((s) => ({ ...s, sent: Math.min(s.total, s.sent + batch.length) }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

      summary.aborted = signal.aborted;
      setState((s) => ({ ...s, uploading: false, stopping: false }));
      return summary;
    },
    [analysisId],
  );

  return { ...state, upload, stop };
}
