import spec from './hrContractSpec.json';

// Esquema real de GET /hr/document-types/ (capturado del backend, SYSPCC-022).
export const CONTRACT_SPEC = { ...spec, constraints: { min_wage: '1130.00', default_probation_months: 3 } };

export function activeTemplate(overrides = {}) {
  return {
    id: 1,
    document_type: 'CONTRACT',
    slug: 'contrato-trabajo',
    name: 'Contrato de trabajo (MODELO DEMO)',
    version: 1,
    original_filename: 'contrato_demo.docx',
    detected_variables: ['cargo'],
    unknown_variables: [],
    missing_required_variables: [],
    is_active: true,
    ...overrides,
  };
}

export function documentDetail(overrides = {}) {
  return {
    id: 7,
    document_type: 'CONTRACT',
    document_type_label: 'Contrato de trabajo',
    subject_name: 'Pérez Ana',
    status: 'DRAFT',
    status_label: 'Borrador',
    reference_number: null,
    source: 'MANUAL',
    template_version: 1,
    pdf_available: false,
    created_by_name: 'Gerente',
    created_at: '2026-10-05T10:00:00-05:00',
    issued_at: null,
    data: {
      worker_full_name: 'Pérez Ana',
      worker_dni: '12345678',
      contract_type: 'INDEFINITE',
      start_date: '2026-11-01',
      gross_salary: '2000.00',
      currency: 'PEN',
    },
    company: {},
    warnings: ['El sueldo (S/ 900.00) es menor a la remuneración mínima vital vigente (S/ 1,130.00).'],
    template: { id: 1, name: 'Contrato de trabajo (MODELO DEMO)', version: 1 },
    personal_id: null,
    issued_by_name: '',
    voided_at: null,
    void_reason: '',
    updated_at: '2026-10-05T10:00:00-05:00',
    ...overrides,
  };
}
