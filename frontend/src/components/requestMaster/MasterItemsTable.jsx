import { Fragment, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, CirclePause, CircleX, Undo2 } from 'lucide-react';
import SortableTh from './SortableTh';
import { TH_CLS } from './styles';
import { AlertChips, ItemStatusBadge, PercentBar, StageChip } from './badges';
import { formatMasterDate, formatMasterQty, rowToggleId } from '../../utils/requestMaster';
import { OVERRIDE_LABELS } from '../../data/requestMaster';

const TD = 'py-3 px-3 align-top text-gray-700';
const ACTION_BTN =
  'inline-flex min-h-11 items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';

function Dl({ items }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-2 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <dt className="font-bold uppercase tracking-wider text-[10px] text-gray-500 font-display">{label}</dt>
          <dd className="text-gray-700 break-words">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Deliveries({ deliveries = [] }) {
  if (!deliveries.length) {
    return <p className="text-xs text-gray-500">Sin entregas registradas por el almacén.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full max-w-2xl">
        <caption className="sr-only">Entregas del almacén</caption>
        <thead>
          <tr className="text-left text-gray-500">
            <th scope="col" className="py-1 pr-4 font-bold">Fecha</th>
            <th scope="col" className="py-1 pr-4 font-bold">Despacho</th>
            <th scope="col" className="py-1 pr-4 font-bold">Guía</th>
            <th scope="col" className="py-1 pr-4 font-bold text-right">Cantidad</th>
            <th scope="col" className="py-1 font-bold">Responsable</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={`${d.dispatch_id}-${d.is_reversal ? 'r' : 'd'}`} className="border-t border-gray-100">
              <td className="py-1.5 pr-4 whitespace-nowrap">{formatMasterDate(d.date)}</td>
              <td className="py-1.5 pr-4 font-mono">{d.dispatch_number || '—'}</td>
              <td className="py-1.5 pr-4">{d.guide || '—'}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">
                {formatMasterQty(d.quantity)}
                {d.is_reversal && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    <Undo2 size={10} aria-hidden="true" /> Reversa
                  </span>
                )}
              </td>
              <td className="py-1.5">{d.responsible || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemDetail({ row }) {
  const progress = row.rq_progress;
  const budget = [row.budget_type, row.budget_classification_label].filter(Boolean).join(' — ');
  const gm = [row.gm_approval_label, row.gm_approval_kind_label].filter(Boolean).join(' · ');
  const stock = row.central_stock === null || row.central_stock === undefined
    ? '—'
    : `${formatMasterQty(row.central_stock)} ${row.unit} (${row.central_stock_is_live ? 'actual' : 'a la fecha de atención'})`;

  return (
    <div className="space-y-4">
      <Dl
        items={[
          ['Solicitante', row.requested_by_name],
          ['Proyecto', [row.project_code, row.project_name].filter(Boolean).join(' — ')],
          ['Departamento', row.department_name],
          ['Origen', row.origin],
          ['Prioridad', row.priority_label],
          ['Flujo', row.flow_label],
          ['Código de producto', row.product_code],
          ['Stock en almacén central', stock],
          ['Aprobación de gerencia general', gm],
          ['Presupuesto (P/A)', budget],
          ['Estado del RQ', row.rq_status_label],
          ['Última entrega', formatMasterDate(row.last_delivery_date)],
          ['Vínculo sugerido', row.link_proposed],
          ['Atendido por flujo', row.attended_by_flow],
        ]}
      />

      {(row.attention_override || row.attention_note) && (
        <p className="text-xs rounded-lg bg-violet-50 text-violet-800 dark:bg-violet-500/10 dark:text-violet-300 px-3 py-2">
          <span className="font-bold">Seguimiento manual: {row.attention_override_label || OVERRIDE_LABELS[row.attention_override]}.</span>{' '}
          {row.attention_note}
        </p>
      )}

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 font-display mb-1">Comentario</h4>
        <p className="text-xs text-gray-700 whitespace-pre-line">{row.comments || '—'}</p>
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 font-display mb-1">
          Avance del RQ
        </h4>
        {progress ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-700">
            <div className="w-56"><PercentBar percent={progress.percent} label={`Avance del RQ ${row.rq_number}`} /></div>
            <span>{progress.items_attended} atendidos · {progress.items_partial} parciales · {progress.items_pending} pendientes</span>
            <span>{progress.items_stand_by} en stand by · {progress.items_unlinked} sin vincular</span>
          </div>
        ) : '—'}
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 font-display mb-1">Entregas</h4>
        <Deliveries deliveries={row.deliveries} />
      </div>
    </div>
  );
}

/**
 * Tabla del Master «Por ítem». `compact` oculta RQ y proyecto (detalle de un solo RQ).
 * `onOverride(row, '' | 'STAND_BY' | 'DESESTIMADO')` abre el diálogo de seguimiento manual; el botón
 * solo existe si el servidor marcó `can_set_override` (el backend vuelve a validar).
 */
export default function MasterItemsTable({ rows, ordering, onOrder, onOverride, compact = false, busy = false }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const uid = useId();
  const showActions = Boolean(onOverride) && rows.some((r) => r.can_set_override);
  const colCount = 18 - (compact ? 1 : 0) + (showActions ? 1 : 0);

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div
      className={`overflow-x-auto transition-opacity ${busy ? 'opacity-60' : ''}`}
      role="region"
      aria-label="Tabla del Master de RQ"
      tabIndex={0}
    >
      <table className="w-full min-w-[1500px] text-sm">
        <caption className="sr-only">
          Seguimiento por ítem de requerimientos. Use los botones de los encabezados para ordenar y el
          botón de cada fila para ver entregas, comentario y aprobación de gerencia.
        </caption>
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th scope="col" className={`${TH_CLS} w-10`}><span className="sr-only">Detalle</span></th>
            {!compact && <SortableTh label="RQ" field="rq_number" ordering={ordering} onOrder={onOrder} />}
            <SortableTh label="Línea" field="line_number" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Descripción" />
            <SortableTh label="Área" />
            <SortableTh label="Fuente" field="source" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Und." />
            <SortableTh label="Solicitado" field="quantity" ordering={ordering} onOrder={onOrder} align="right" />
            <SortableTh label="Atendido" field="attended" ordering={ordering} onOrder={onOrder} align="right" />
            <SortableTh label="Faltante" field="missing" ordering={ordering} onOrder={onOrder} align="right" />
            <SortableTh label="Estado" field="status" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Etapa" />
            <SortableTh label="F. aprobación" field="approval_date" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="F. requerida" field="need_date" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="F. atendida" field="attended_date" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Guía" />
            <SortableTh label="Resp. atención" />
            <SortableTh label="Alertas" />
            {showActions && <SortableTh label="Seguimiento" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = expanded.has(row.id);
            const detailId = `${uid}-detail-${row.id}`;
            const rowName = `línea ${row.line_number} de ${row.rq_number}`;
            return (
              <Fragment key={row.id}>
                <tr className="border-b border-gray-100 hover:bg-blue-50/60 dark:hover:bg-blue-500/10">
                  <td className="py-2 px-1 align-top">
                    <button
                      type="button"
                      id={rowToggleId(row.id)}
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={`${open ? 'Ocultar' : 'Ver'} detalle de la ${rowName}`}
                      onClick={() => toggle(row.id)}
                      className="inline-flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                    </button>
                  </td>
                  {!compact && (
                    <td className={`${TD} whitespace-nowrap`}>
                      <Link
                        to={`/rq/requests/${row.request_id}`}
                        className="font-mono font-bold text-xs text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        {row.rq_number}
                      </Link>
                      <span className="block text-[11px] text-gray-500">{row.project_code || '—'}</span>
                    </td>
                  )}
                  <td className={`${TD} tabular-nums`}>{row.line_number}</td>
                  <td className={`${TD} max-w-xs`}>
                    <span className="line-clamp-2 leading-snug">{row.description}</span>
                    {row.product_code && <span className="block font-mono text-[11px] text-gray-500">{row.product_code}</span>}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{row.requesting_area_label || '—'}</td>
                  <td className={`${TD} whitespace-nowrap`}>{row.item_source_label || '—'}</td>
                  <td className={TD}>{row.unit}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatMasterQty(row.quantity)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatMasterQty(row.quantity_attended)}</td>
                  <td className={`${TD} text-right tabular-nums font-semibold`}>{formatMasterQty(row.quantity_missing)}</td>
                  <td className={TD}><ItemStatusBadge status={row.status} label={row.status_label} /></td>
                  <td className={TD}><StageChip stage={row.stage} label={row.stage_label} phase={row.phase} /></td>
                  <td className={`${TD} whitespace-nowrap`}>{formatMasterDate(row.approval_date)}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatMasterDate(row.need_date)}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatMasterDate(row.attended_date)}</td>
                  <td className={`${TD} max-w-[160px] break-words`}>{row.guide_text || '—'}</td>
                  <td className={TD}>{row.attention_responsible || '—'}</td>
                  <td className={TD}><AlertChips alerts={row.alerts} /></td>
                  {showActions && (
                    <td className={TD}>
                      {row.can_set_override ? (
                        <div className="flex flex-col gap-1.5 items-start">
                          {row.attention_override !== 'STAND_BY' && (
                            <button type="button" className={ACTION_BTN} onClick={() => onOverride(row, 'STAND_BY')} aria-label={`Poner en stand by la ${rowName}`}>
                              <CirclePause size={13} aria-hidden="true" /> Stand by
                            </button>
                          )}
                          {row.attention_override !== 'DESESTIMADO' && (
                            <button type="button" className={ACTION_BTN} onClick={() => onOverride(row, 'DESESTIMADO')} aria-label={`Desestimar la ${rowName}`}>
                              <CircleX size={13} aria-hidden="true" /> Desestimar
                            </button>
                          )}
                          {row.attention_override && (
                            <button type="button" className={ACTION_BTN} onClick={() => onOverride(row, '')} aria-label={`Quitar el seguimiento manual de la ${rowName}`}>
                              <Undo2 size={13} aria-hidden="true" /> Quitar
                            </button>
                          )}
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                  )}
                </tr>
                {open && (
                  <tr id={detailId} className="border-b border-gray-100 bg-gray-50">
                    <td colSpan={colCount} className="px-6 py-4">
                      <ItemDetail row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
