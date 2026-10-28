// SYSPCC-023 — filtrado de archivos del lado del cliente (el servidor valida de nuevo).

import { COPY } from './cvCopy';
import { formatBytes } from './cvFormat';

export const DEFAULT_EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png'];
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_DROP_ENTRIES = 2000;
const MAX_DROP_DEPTH = 6;

const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** System/hidden files that are dropped silently (they are not errors). */
export function isIgnoredFile(name = '') {
  const lower = String(name).toLowerCase();
  return IGNORED_NAMES.has(lower) || lower.startsWith('~$') || lower.startsWith('.') || lower.startsWith('__macosx');
}

export const extensionOf = (name = '') => {
  const i = String(name).lastIndexOf('.');
  return i < 0 ? '' : String(name).slice(i).toLowerCase();
};

export const fileKey = (file) => `${file.name}|${file.size}|${file.lastModified ?? 0}`;

let seq = 0;
const nextId = () => {
  seq += 1;
  return `f${seq}`;
};

/**
 * Splits a selection into usable files and problems (with an es-PE reason).
 * `existingKeys` = Set of fileKey() already in the list.
 * Returns { ok: [{id,file}], problems: [{id,file,code,detail}], ignored }.
 */
export function classifyFiles(files, { extensions = DEFAULT_EXTENSIONS, maxBytes = DEFAULT_MAX_BYTES, existingKeys = new Set() } = {}) {
  const ok = [];
  const problems = [];
  let ignored = 0;
  const seen = new Set(existingKeys);
  const allowed = new Set(extensions.map((e) => e.toLowerCase()));
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  for (const file of files) {
    if (isIgnoredFile(file.name)) {
      ignored += 1;
      continue;
    }
    const id = nextId();
    if (!allowed.has(extensionOf(file.name))) {
      problems.push({ id, file, code: 'unsupported_type', detail: 'Formato no admitido. Usa PDF, Word o imagen.' });
    } else if (file.size === 0) {
      problems.push({ id, file, code: 'file_empty', detail: 'El archivo está vacío.' });
    } else if (file.size > maxBytes) {
      problems.push({ id, file, code: 'file_too_large', detail: `Pesa más de ${maxMb} MB.` });
    } else if (seen.has(fileKey(file))) {
      problems.push({ id, file, code: 'duplicate_selection', detail: COPY.step2.duplicateSelection });
    } else {
      seen.add(fileKey(file));
      ok.push({ id, file });
    }
  }
  return { ok, problems, ignored };
}

export const describeFile = (file) => `${file.name} · ${formatBytes(file.size)}`;

// ── Carpetas arrastradas (webkitGetAsEntry) ──────────────────────────────────

function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const next = () => {
      reader.readEntries((batch) => {
        if (!batch.length) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    };
    next();
  });
}

const entryToFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

async function walk(entry, depth, budget, out) {
  if (budget.left <= 0 || depth > MAX_DROP_DEPTH) return;
  budget.left -= 1;
  if (entry.isFile) {
    try {
      out.push(await entryToFile(entry));
    } catch {
      // unreadable entry: skipped
    }
  } else if (entry.isDirectory) {
    let children = [];
    try {
      children = await readAllEntries(entry.createReader());
    } catch {
      return;
    }
    for (const child of children) {
      await walk(child, depth + 1, budget, out);
    }
  }
}

/** Files from a drop event, descending into folders (cap: 2 000 entries, depth 6). */
export async function collectDroppedFiles(dataTransfer) {
  if (!dataTransfer) return [];
  const items = [...(dataTransfer.items ?? [])];
  const canWalk = items.length > 0 && typeof items[0].webkitGetAsEntry === 'function';
  if (!canWalk) return [...(dataTransfer.files ?? [])];
  // Entries must be read synchronously, before the first await.
  const entries = items.filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  const budget = { left: MAX_DROP_ENTRIES };
  for (const entry of entries) {
    await walk(entry, 0, budget, out);
  }
  return out;
}
