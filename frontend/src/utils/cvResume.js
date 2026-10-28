// SYSPCC-023 — "reanudar donde lo dejó". El estado real vive en el servidor
// (análisis, requisitos, CVs); localStorage solo recuerda "continuar sin
// convocatoria" (comodidad: sin él, reabrir cae en el paso 1).

const key = (id) => `hrcv:skip:${id}`;

export function isSkipped(id) {
  try {
    return localStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
}

export function markSkipped(id) {
  try {
    localStorage.setItem(key(id), '1');
  } catch {
    // storage unavailable: only a convenience
  }
}

export function clearSkipped(id) {
  try {
    localStorage.removeItem(key(id));
  } catch {
    // storage unavailable: only a convenience
  }
}

/** Step where an analysis should be resumed: 'results' | 2 | 1. Works with list rows and details. */
export function resumeStep(analysis) {
  if ((analysis.counts?.total ?? 0) > 0) return 'results';
  const hasRequirements = analysis.has_requirements ?? (analysis.requirements?.length ?? 0) > 0;
  if (hasRequirements || isSkipped(analysis.id)) return 2;
  return 1;
}

export function resumeHref(analysis) {
  const step = resumeStep(analysis);
  if (step === 'results') return `/rrhh/cvs/${analysis.id}`;
  return `/rrhh/cvs/${analysis.id}/preparar${step === 2 ? '?paso=2' : ''}`;
}
