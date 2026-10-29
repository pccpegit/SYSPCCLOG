import { CircleCheck, CircleDot, Clock, FolderOpen, Link2, Percent } from 'lucide-react';
import { formatPercent } from '../../utils/requestMaster';

function Tile({ icon, label, value, hint, tone }) {
  const Icon = icon;
  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-wider font-display">{label}</dt>
        <dd className="text-2xl font-extrabold text-gray-900 tabular-nums font-display leading-tight">{value}</dd>
        {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

const TONE = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

/** KPIs del conjunto filtrado completo (no solo de la página). `kpis` null = todavía sin datos. */
export default function MasterKpis({ kpis, loading, failed }) {
  const show = (value) => (kpis ? value : '—');
  return (
    <section aria-labelledby="master-kpis-title" aria-busy={loading}>
      <h2 id="master-kpis-title" className="sr-only">Indicadores del Master</h2>
      {failed && (
        <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">No se pudieron calcular los indicadores.</p>
      )}
      <dl className={`grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <Tile icon={FolderOpen} label="RQs abiertos" value={show(kpis?.rqs_open)} hint={kpis ? `de ${kpis.rqs_total} RQs` : null} tone={TONE.blue} />
        <Tile icon={Clock} label="Ítems pendientes" value={show(kpis?.items_pending)} hint={kpis ? `de ${kpis.items_total} ítems` : null} tone={TONE.blue} />
        <Tile icon={CircleDot} label="Ítems parciales" value={show(kpis?.items_partial)} tone={TONE.amber} />
        <Tile icon={CircleCheck} label="Ítems atendidos" value={show(kpis?.items_attended)} tone={TONE.emerald} />
        <Tile icon={Percent} label="Avance promedio" value={show(formatPercent(kpis?.percent_avg))} hint="Promedio por RQ" tone={TONE.violet} />
        <Tile icon={Link2} label="Vinculados al catálogo" value={show(formatPercent(kpis?.linked_pct))} tone={TONE.violet} />
      </dl>
    </section>
  );
}
