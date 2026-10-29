import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { exportImportProblems, getImportProblems } from '../../../api/almacenImport';
import useFileDownload from '../../../hooks/useFileDownload';
import useFilterAnnouncer from '../../../hooks/useFilterAnnouncer';
import { localISODate } from '../../../utils/almacen';
import { SEVERITY_META, problemCodeLabel } from '../../../utils/almacenImport';
import { Chip, EmptyBlock, ErrorBlock, LoadingBlock, Pagination } from '../ui';
import { btnSecondary, inputCls, thCls } from '../uiStyles';

const PAGE_SIZE = 20;
const SEVERITIES = ['blocker', 'error', 'warning', 'info'];

/** Tabla de problemas del libro: filtrable por gravedad, hoja y código; descargable sin nombres. */
export default function ProblemsPanel({ importId, summary }) {
  const download = useFileDownload();
  const [severity, setSeverity] = useState('');
  const [sheet, setSheet] = useState('');
  const [code, setCode] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: 'loading', rows: [], total: 0, meta: null });
  const seq = useRef(0);

  const sheets = Object.keys(summary?.sheets ?? {});
  const codes = Object.keys(summary?.by_code ?? {});

  const filterParams = useCallback(() => {
    const params = {};
    if (severity) params.severity = severity;
    if (sheet) params.sheet = sheet;
    if (code) params.code = code;
    return params;
  }, [severity, sheet, code]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState((prev) => ({ ...prev, status: prev.rows.length ? 'refreshing' : 'loading' }));
    try {
      const res = await getImportProblems(importId, { ...filterParams(), page, page_size: PAGE_SIZE });
      if (mine !== seq.current) return;
      const rows = res.data?.results ?? [];
      setState({ status: 'ready', rows, total: res.data?.count ?? rows.length, meta: res.data?.meta ?? null });
    } catch {
      if (mine === seq.current) setState({ status: 'error', rows: [], total: 0, meta: null });
    }
  }, [importId, filterParams, page]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const change = (setter) => (e) => { setter(e.target.value); setPage(1); };

  const filterKey = JSON.stringify(filterParams());
  const announcement = useFilterAnnouncer(
    filterKey,
    state.status === 'ready' ? `Mostrando ${state.total} ${state.total === 1 ? 'problema' : 'problemas'}.` : '',
  );

  return (
    <section aria-labelledby="problems-title" className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <h3 id="problems-title" className="text-sm font-bold text-gray-700 uppercase tracking-wider font-display">Problemas del libro</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="prob-severity" className="block text-xs font-semibold text-gray-600 mb-1">Gravedad</label>
            <select id="prob-severity" value={severity} onChange={change(setSeverity)} className={inputCls()}>
              <option value="">Todas</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="prob-sheet" className="block text-xs font-semibold text-gray-600 mb-1">Hoja</label>
            <select id="prob-sheet" value={sheet} onChange={change(setSheet)} className={inputCls()}>
              <option value="">Todas</option>
              {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="prob-code" className="block text-xs font-semibold text-gray-600 mb-1">Tipo de problema</label>
            <select id="prob-code" value={code} onChange={change(setCode)} className={inputCls()}>
              <option value="">Todos</option>
              {codes.map((c) => <option key={c} value={c}>{problemCodeLabel(c)} ({summary.by_code[c]})</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => download.run(
              () => exportImportProblems(importId, filterParams()),
              `PROBLEMAS_IMPORTACION_${localISODate()}.xlsx`,
              'No se pudo descargar el informe. Intente nuevamente.',
            )}
            aria-disabled={download.busy}
            className={btnSecondary}
          >
            {download.busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            Descargar informe de problemas (.xlsx)
          </button>
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      <div className={`rounded-2xl border border-gray-100 overflow-hidden ${state.status === 'refreshing' ? 'opacity-60' : ''}`}>
        {state.status === 'loading' && <LoadingBlock label="Cargando problemas…" className="h-32" />}
        {state.status === 'error' && <ErrorBlock message="No se pudieron cargar los problemas." onRetry={load} />}
        {(state.status === 'ready' || state.status === 'refreshing') && state.rows.length === 0 && (
          <EmptyBlock title={severity || sheet || code ? 'Ningún problema coincide con los filtros.' : 'El libro no tiene problemas.'} />
        )}
        {(state.status === 'ready' || state.status === 'refreshing') && state.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Problemas encontrados en el libro</caption>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left">
                  <th scope="col" className={thCls}>Hoja</th>
                  <th scope="col" className={`${thCls} text-right`}>Fila</th>
                  <th scope="col" className={thCls}>Gravedad</th>
                  <th scope="col" className={thCls}>Tipo de problema</th>
                  <th scope="col" className={thCls}>Descripción del problema</th>
                  <th scope="col" className={`${thCls} hidden lg:table-cell`}>Qué se hará</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {state.rows.map((p, idx) => {
                  const meta = SEVERITY_META[p.severity] ?? SEVERITY_META.info;
                  return (
                    <tr key={`${p.code}-${p.sheet}-${p.row}-${idx}`}>
                      <td className="px-4 py-2.5 text-xs text-gray-700 whitespace-nowrap">{p.sheet || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-right tabular-nums text-gray-700">{p.row ?? '—'}</td>
                      <td className="px-4 py-2.5"><Chip tone={meta.tone}>{meta.label}</Chip></td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 min-w-[10rem]">
                        <span className="block font-medium">{problemCodeLabel(p.code)}</span>
                        <span className="block font-mono text-xs text-gray-500">{p.code}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-800 min-w-[16rem]">{p.message}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 hidden lg:table-cell">{meta.action}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(state.status === 'ready' || state.status === 'refreshing') && state.total > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={state.total} noun="problemas" onPage={setPage} />
        )}
      </div>
      {state.meta?.truncated && (
        <p className="text-xs text-gray-500">
          El libro tiene {state.meta.total} problemas; se guardaron los más graves. Corrija esos y vuelva a analizar el libro.
        </p>
      )}
    </section>
  );
}
