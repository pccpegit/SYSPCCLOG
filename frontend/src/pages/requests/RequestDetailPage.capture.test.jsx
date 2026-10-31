import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequestDetailPage from './RequestDetailPage';
import { useAuth } from '../../context/useAuth';
import * as requestsApi from '../../api/requests';

// SYSPCC-026 (QA ronda 1) — complements RequestDetailPage.test.jsx: area and source labels when the
// API only sends the code, historical RQs (no area, nothing linked) and inconsistent lines.
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/requests');
// SYSPCC-030: el detalle incluye el seguimiento por ítem; aquí no es el objeto de la prueba.
vi.mock('../../api/requestMaster', () => ({
  getRequestMaster: vi.fn(() => new Promise(() => {})),
}));

const line = (over = {}) => ({
  id: 1, line_number: 1, description: 'Casco blanco', quantity: '10.000', unit: 'UND',
  inventory_item: null, is_off_catalog: false, item_source: '', item_source_display: '', ...over,
});

function buildRequest(overrides = {}) {
  return {
    id: 42,
    rq_number: 'RQ-2026-0042',
    status: 'SUBMITTED',
    flow: 'OPERATIONS',
    description: 'Material para frente 3',
    priority: 'NORMAL',
    project_code: 'PRY-001',
    project_name: 'Minera Yanaocha',
    requested_by_name: 'Op Erator',
    created_at: '2026-10-01T10:00:00Z',
    requesting_area: 'HSE',
    requesting_area_display: 'Seguridad y Salud (HSE)',
    items: [line()],
    ...overrides,
  };
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/rq/requests/:id" element={<RequestDetailPage />} />
    </Routes>,
    { route: '/rq/requests/42' },
  );
}

const rowOf = (text) => screen.getAllByRole('row').find((r) => within(r).queryByText(text));
const cellUnder = (header, row) => {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  return within(row).getAllByRole('cell')[headers.indexOf(header)];
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ primaryRole: 'REQUESTER' });
  requestsApi.getRequest.mockResolvedValue({ data: buildRequest() });
  requestsApi.getApprovals.mockResolvedValue({ data: { results: [] } });
});

describe('RequestDetailPage — etiquetas cuando la API sólo manda el código', () => {
  it.each([
    ['OP', 'Operaciones (OP)'],
    ['QC', 'Control de Calidad (QC)'],
    ['HSE', 'Seguridad y Salud (HSE)'],
    ['ADM', 'Administración (ADM)'],
  ])('el área %s sin etiqueta del backend se muestra como "%s"', async (code, label) => {
    requestsApi.getRequest.mockResolvedValue({ data: buildRequest({ requesting_area: code, requesting_area_display: undefined }) });
    renderPage();

    const area = await screen.findByText('Área del RQ:');
    expect(area.parentElement).toHaveTextContent(label);
  });

  it('una fuente sin etiqueta del backend usa la del vocabulario; una desconocida muestra un guion', async () => {
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({
        items: [
          line({ id: 1, line_number: 1, description: 'Llave', item_source: 'HERRAMIENTAS', item_source_display: undefined }),
          line({ id: 2, line_number: 2, description: 'Cosa rara', item_source: 'XYZ', item_source_display: undefined }),
        ],
      }),
    });
    renderPage();
    await screen.findByText('Llave');

    expect(cellUnder('Fuente', rowOf('Llave'))).toHaveTextContent('Herramientas');
    expect(cellUnder('Fuente', rowOf('Cosa rara'))).toHaveTextContent('—');
  });
});

describe('RequestDetailPage — RQs históricos y datos incompletos', () => {
  it('un RQ anterior a SYSPCC-026 se ve completo: sin área, todas las líneas "Sin vincular" y sin fuente', async () => {
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({
        requesting_area: '',
        requesting_area_display: '',
        items: [line({ id: 1, description: 'Cemento' }), line({ id: 2, line_number: 2, description: 'Arena' })],
      }),
    });
    renderPage();
    await screen.findByText('Cemento');

    expect((await screen.findByText('Área del RQ:')).parentElement).toHaveTextContent('Sin área');
    for (const description of ['Cemento', 'Arena']) {
      const row = rowOf(description);
      expect(within(row).getByText('Sin vincular')).toBeInTheDocument();
      expect(cellUnder('Fuente', row)).toHaveTextContent('—');
    }
  });

  it('un vínculo sin código no muestra "undefined": muestra un guion', async () => {
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({ items: [line({ inventory_item: 9, inventory_item_code: undefined, inventory_item_description: undefined })] }),
    });
    renderPage();
    await screen.findByText('Casco blanco');

    const cell = cellUnder('Producto de catálogo', rowOf('Casco blanco'));
    expect(cell).toHaveTextContent('—');
    expect(cell).not.toHaveTextContent('undefined');
    expect(within(cell).queryByText('Sin vincular')).not.toBeInTheDocument();
  });

  it('un dato incoherente (vínculo y fuera de catálogo a la vez) se muestra vinculado, sin contradecirse', async () => {
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({
        items: [line({ inventory_item: 5, inventory_item_code: 'EPP-0001', inventory_item_description: 'Casco', is_off_catalog: true })],
      }),
    });
    renderPage();
    await screen.findByText('Casco blanco');

    const cell = cellUnder('Producto de catálogo', rowOf('Casco blanco'));
    expect(cell).toHaveTextContent('EPP-0001');
    expect(within(cell).queryByText('Fuera de catálogo')).not.toBeInTheDocument();
  });

  it('un RQ del flujo Administración muestra su área y sus líneas igual que uno de Operaciones', async () => {
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({
        flow: 'ADMINISTRATIVE',
        project_code: undefined,
        project_name: undefined,
        department_name: 'Administración',
        requesting_area: 'ADM',
        requesting_area_display: 'Administración (ADM)',
        items: [line({ description: 'Papel bond A4', unit: 'MLL', item_source: 'UTILES', item_source_display: 'Útiles', is_off_catalog: true })],
      }),
    });
    renderPage();
    await screen.findByText('Papel bond A4');

    expect((await screen.findByText('Área del RQ:')).parentElement).toHaveTextContent('Administración (ADM)');
    const row = rowOf('Papel bond A4');
    expect(within(row).getByText('Fuera de catálogo')).toBeInTheDocument();
    expect(cellUnder('Fuente', row)).toHaveTextContent('Útiles');
  });

  it('un RQ sin ítems no rompe la tabla nueva', async () => {
    requestsApi.getRequest.mockResolvedValue({ data: buildRequest({ items: [] }) });
    renderPage();

    expect(await screen.findByRole('columnheader', { name: 'Producto de catálogo' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fuente' })).toBeInTheDocument();
  });
});
