import { Link } from 'react-router-dom';
import SortableTh from './SortableTh';
import { PercentBar, StageChip } from './badges';
import { TONES } from '../almacen/uiStyles';
import { formatMasterDate } from '../../utils/requestMaster';

const TD = 'py-3 px-3 align-top text-gray-700';

const GM_TONE = {
  APROBADO: TONES.emerald,
  RECHAZADO: TONES.red,
  PENDIENTE: TONES.amber,
  NO_APLICA: TONES.gray,
};

function GmChip({ row }) {
  const text = [row.gm_approval_label, row.gm_approval_kind_label].filter(Boolean).join(' · ');
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap ${GM_TONE[row.gm_approval] ?? TONES.gray}`}>
      {text || '—'}
    </span>
  );
}

/** Tabla del Master «Por RQ»: avance y conteos de ítems de cada requerimiento. */
export default function MasterSummaryTable({ rows, ordering, onOrder, busy = false }) {
  return (
    <div
      className={`overflow-x-auto transition-opacity ${busy ? 'opacity-60' : ''}`}
      role="region"
      aria-label="Tabla del Master por RQ"
      tabIndex={0}
    >
      <table className="w-full min-w-[1300px] text-sm">
        <caption className="sr-only">
          Avance de atención de cada requerimiento. Use los botones de los encabezados para ordenar.
        </caption>
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <SortableTh label="RQ" field="rq_number" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Proyecto / origen" field="project" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Solicitante" />
            <SortableTh label="Etapa" field="stage" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Avance" field="percent" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Ítems" field="items_total" ordering={ordering} onOrder={onOrder} align="right" />
            <SortableTh label="Atendidos" align="right" />
            <SortableTh label="Parciales" align="right" />
            <SortableTh label="Pendientes" align="right" />
            <SortableTh label="Stand by" align="right" />
            <SortableTh label="Sin vincular" align="right" />
            <SortableTh label="F. aprobación" field="approval_date" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="F. requerida" field="need_date" ordering={ordering} onOrder={onOrder} />
            <SortableTh label="Gerencia general" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.request_id} className="border-b border-gray-100 hover:bg-blue-50/60 dark:hover:bg-blue-500/10">
              <td className={`${TD} whitespace-nowrap`}>
                <Link
                  to={`/rq/requests/${row.request_id}`}
                  className="font-mono font-bold text-xs text-blue-700 dark:text-blue-400 hover:underline"
                >
                  {row.rq_number}
                </Link>
                <span className="block text-[11px] text-gray-500">{row.flow_label}</span>
              </td>
              <td className={TD}>
                <span className="font-semibold text-xs">{row.origin || row.project_code || '—'}</span>
                {row.requesting_area_label && <span className="block text-[11px] text-gray-500">{row.requesting_area_label}</span>}
              </td>
              <td className={TD}>{row.requested_by_name || '—'}</td>
              <td className={TD}>
                <StageChip stage={row.stage} label={row.stage_label} phase={row.phase} />
                <span className="block text-[11px] text-gray-500 mt-1">{row.rq_status_label}</span>
              </td>
              <td className={TD}><PercentBar percent={row.percent} label={`Avance de ${row.rq_number}`} /></td>
              <td className={`${TD} text-right tabular-nums font-semibold`}>{row.items_total}</td>
              <td className={`${TD} text-right tabular-nums`}>{row.items_attended}</td>
              <td className={`${TD} text-right tabular-nums`}>{row.items_partial}</td>
              <td className={`${TD} text-right tabular-nums`}>{row.items_pending}</td>
              <td className={`${TD} text-right tabular-nums`}>{row.items_stand_by}</td>
              <td className={`${TD} text-right tabular-nums`}>{row.items_unlinked}</td>
              <td className={`${TD} whitespace-nowrap`}>{formatMasterDate(row.approval_date)}</td>
              <td className={`${TD} whitespace-nowrap`}>{formatMasterDate(row.need_date)}</td>
              <td className={TD}><GmChip row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
