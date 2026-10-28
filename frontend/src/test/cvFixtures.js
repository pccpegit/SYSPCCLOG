// SYSPCC-023 — fixtures with the real shape of /hr/cv-analyses/ responses.

export function cvConfig(overrides = {}) {
  return {
    enabled: true,
    dispatch: 'celery',
    provider: 'anthropic',
    simulated: false,
    limits: {
      max_file_mb: 10,
      max_file_bytes: 10 * 1024 * 1024,
      max_files_per_request: 25,
      batch_size: 25,
      max_items_per_analysis: 500,
      daily_remaining: 500,
      extensions: ['.pdf', '.docx', '.jpg', '.jpeg', '.png'],
    },
    estimate_usd: { min: 0.03, max: 0.08 },
    posting: {
      max_file_mb: 5,
      max_file_bytes: 5 * 1024 * 1024,
      extensions: ['.pdf', '.docx', '.jpg', '.jpeg', '.png'],
      max_text_chars: 12000,
      max_requirements: 15,
      extraction: 'ai',
      estimate_usd: { min: 0.01, max: 0.03 },
    },
    disclaimer: 'La IA ayuda a ordenar; la decisión final es de RR. HH.',
    ...overrides,
  };
}

export const REQS = [
  { id: 1, text: 'Ingeniero civil colegiado', weight: 3 },
  { id: 2, text: '5 años en obras viales', weight: 1 },
];

export function analysisDetail(overrides = {}) {
  return {
    id: 5,
    name: 'Residente de obra — Oct 2026',
    created_at: '2026-10-27T10:00:00-05:00',
    created_by_name: 'Gerente RRHH',
    has_requirements: true,
    has_posting: false,
    status: 'EMPTY',
    cost_usd: 0,
    counts: { total: 0, done: 0, failed: 0, pending: 0, queued: 0, processing: 0, cancelled: 0 },
    requirements: REQS,
    requirements_text: 'Ingeniero civil colegiado (obligatorio)\n5 años en obras viales',
    requirements_locked: false,
    posting: null,
    model_name: 'claude-opus-5-5',
    ...overrides,
  };
}

export function listRow(overrides = {}) {
  return {
    id: 5,
    name: 'Residente de obra — Oct 2026',
    created_at: '2026-10-27T10:00:00-05:00',
    created_by_name: 'Gerente RRHH',
    has_requirements: true,
    has_posting: false,
    counts: { total: 0, done: 0, failed: 0, pending: 0 },
    status: 'EMPTY',
    cost_usd: 0,
    ...overrides,
  };
}

export function itemRow(id, overrides = {}) {
  return {
    id,
    rank: null,
    original_name: `cv_${id}.pdf`,
    status: 'DONE',
    error_code: '',
    error_message: '',
    candidate_name: `Candidato ${id}`,
    headline: 'Ingeniero civil',
    experience_years: 6,
    score: 80,
    recommendation: 'ADVANCE',
    injection_suspected: false,
    ...overrides,
  };
}

export function progressResponse(counts = {}, overrides = {}) {
  const c = { total: 0, queued: 0, processing: 0, done: 0, failed: 0, cancelled: 0, ...counts };
  return {
    server_time: '2026-10-27T10:05:00-05:00',
    status: c.queued + c.processing > 0 ? 'PROCESSING' : c.failed ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
    counts: c,
    percent: c.total ? Math.round(((c.done + c.failed + c.cancelled) / c.total) * 100) : 0,
    cost_usd: 0.84,
    stalled: false,
    recommendations: { advance: 0, review: 0, no_advance: 0 },
    flagged: { injection: 0 },
    items: [],
    ...overrides,
  };
}

export function itemDetail(id, overrides = {}) {
  return {
    ...itemRow(id),
    kind: 'PDF',
    page_count: 2,
    attempts: 1,
    tokens_in: 1200,
    tokens_out: 400,
    cost_usd: 0.05,
    file_available: true,
    report_available: true,
    created_at: '2026-10-27T10:00:00-05:00',
    finished_at: '2026-10-27T10:01:00-05:00',
    report: {
      candidate: { full_name: `Candidato ${id}`, email: 'ana@example.com', phone: '+51 900 000 111', location: 'Lima', links: ['https://linkedin.com/in/ana', 'javascript:alert(1)'] },
      headline: 'Ingeniero civil',
      summary: 'Ingeniero con 6 años en obras viales.',
      readability: 'good',
      injection_suspected: false,
      experience: [{ company: 'Constructora Demo', role: 'Residente', start: '2020-01', end: null, is_current: true, description: 'Obras viales' }],
      education: [{ institution: 'UNI', degree: 'Ingeniería Civil', field: null, status: 'completed', end_year: 2015 }],
      skills: ['Costos', 'Planeamiento'],
      certifications: [{ name: 'PMP', issuer: 'PMI', year: 2021 }],
      languages: [{ language: 'Inglés', level: 'B2' }],
      evaluation: {
        requirement_results: [],
        strengths: ['Experiencia en obras viales'],
        gaps: ['Sin certificación en seguridad'],
      },
    },
    computed: {
      score: 80,
      recommendation: 'ADVANCE',
      experience_years: 6,
      experience_source: 'dates',
      caps: [],
      requirements: [
        { id: 1, text: 'Ingeniero civil colegiado', weight: 3, status: 'met', evidence: 'CIP 12345' },
        { id: 2, text: '5 años en obras viales', weight: 1, status: 'partial', evidence: '4 años' },
      ],
    },
    ...overrides,
  };
}

export const authAs = (roles) => ({
  isAuthenticated: true,
  isLoading: false,
  userRoles: roles,
  primaryRole: roles[0] ?? null,
  currentUser: { first_name: 'Demo', last_name: 'RRHH', username: 'rrhh' },
  logout: () => {},
});

export const FINISHED_COUNTS = { total: 4, queued: 0, processing: 0, done: 3, failed: 1, cancelled: 0, pending: 0 };

/** Rows in a shuffled order: the page must sort them (ranking) itself. */
export function finishedRows() {
  return [
    itemRow(3, { candidate_name: 'Carla Soto', score: 40, rank: 3, recommendation: 'NO_ADVANCE', headline: 'Arquitecta', experience_years: 2 }),
    itemRow(1, { candidate_name: 'Ana Paz', score: 92, rank: 1, recommendation: 'ADVANCE' }),
    itemRow(4, { status: 'FAILED', error_code: 'ai_failed', error_message: 'El servicio no respondió. Inténtalo de nuevo.', candidate_name: null, headline: null, experience_years: null, score: null, rank: null, recommendation: null }),
    itemRow(2, { candidate_name: 'Beto Ríos', score: 75, rank: 2, recommendation: 'REVIEW' }),
  ];
}
