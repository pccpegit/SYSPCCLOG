// SYSPCC-041 — textos puros del selector de «RQ pendientes por entregar» (es-PE).

export const RQ_PAGE_SIZE = 20;

/** Origen del RQ para mostrar: proyecto (con código) o, si no, el departamento. */
export function rqOrigin(rq) {
  if (rq?.project) return `${rq.project}${rq.project_code ? ` · ${rq.project_code}` : ''}`;
  return rq?.department || '';
}

/** «5 ítems pendientes» a partir de lo que informa el servidor. */
export function rqPendingText(rq) {
  const split = Number(rq?.items_pending) + Number(rq?.items_partial);
  const count = Number.isFinite(split) ? split : Number(rq?.items_deliverable);
  if (!Number.isFinite(count)) return '';
  return `${count} ${count === 1 ? 'ítem pendiente' : 'ítems pendientes'}`;
}

const percentText = (rq) => {
  if (rq?.percent == null || Number.isNaN(Number(rq.percent))) return '';
  return `${Number(rq.percent).toLocaleString('es-PE', { maximumFractionDigits: 1 })}% atendido`;
};

/** Una línea de resumen del RQ, sin el N°: «Proyecto X · Ana Prueba · 5 ítems pendientes · 37.5% atendido». */
export function rqSummary(rq) {
  return [rqOrigin(rq), rq?.requested_by, rqPendingText(rq), percentText(rq)].filter(Boolean).join(' · ');
}
