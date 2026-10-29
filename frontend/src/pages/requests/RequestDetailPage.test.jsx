import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequestDetailPage from './RequestDetailPage';
import { useAuth } from '../../context/AuthContext';
import * as requestsApi from '../../api/requests';

// SYSPCC-026 — el detalle del RQ muestra el Área del RQ y, por ítem, la Fuente
// y el vínculo con el catálogo (o "Fuera de catálogo" / "Sin vincular").
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/requests');
// SYSPCC-030: el detalle incluye el seguimiento por ítem; aquí no es el objeto de la prueba.
vi.mock('../../api/requestMaster', () => ({
  getRequestMaster: vi.fn(() => new Promise(() => {})),
}));

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
    items: [
      {
        id: 1, line_number: 1, description: 'Casco blanco', quantity: '10.000', unit: 'UND',
        stock_almacen_obra: '1.000', stock_almacen_central: '7.000', x_atender: '2.000',
        inventory_item: 5, inventory_item_code: 'EPP-0001',
        inventory_item_description: 'Casco de seguridad blanco', inventory_item_unit: 'UND',
        is_off_catalog: false, item_source: 'EPP', item_source_display: 'EPP',
      },
      {
        id: 2, line_number: 2, description: 'Servicio de topografía', quantity: '1.000', unit: 'GLB',
        inventory_item: null, is_off_catalog: true, item_source: 'EQUIPOS', item_source_display: 'Equipos',
      },
      {
        id: 3, line_number: 3, description: 'Cinta señalizadora', quantity: '5.000', unit: 'UND',
        inventory_item: null, is_off_catalog: false, item_source: '', item_source_display: '',
      },
    ],
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

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ primaryRole: 'REQUESTER' });
  requestsApi.getRequest.mockResolvedValue({ data: buildRequest() });
  requestsApi.getApprovals.mockResolvedValue({ data: { results: [] } });
});

describe('RequestDetailPage — área, fuente y vínculo por ítem (SYSPCC-026)', () => {
  it('muestra el Área del RQ con la etiqueta que envía el backend', async () => {
    renderPage();

    const label = await screen.findByText('Área del RQ:');
    expect(label.parentElement).toHaveTextContent('Seguridad y Salud (HSE)');
  });

  it('un RQ histórico sin área se muestra como "Sin área"', async () => {
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({ requesting_area: '', requesting_area_display: '' }),
    });
    renderPage();

    const label = await screen.findByText('Área del RQ:');
    expect(label.parentElement).toHaveTextContent('Sin área');
  });

  it('cada ítem muestra su fuente y su relación con el catálogo', async () => {
    renderPage();
    await screen.findByText('Casco blanco');

    const rows = screen.getAllByRole('row');
    const row = (text) => rows.find((r) => within(r).queryByText(text));

    const linked = within(row('Casco blanco'));
    expect(linked.getByText('EPP-0001')).toBeInTheDocument();
    expect(linked.getByText('Casco de seguridad blanco')).toBeInTheDocument();
    expect(linked.getByText('EPP')).toBeInTheDocument();

    const off = within(row('Servicio de topografía'));
    expect(off.getByText('Fuera de catálogo')).toBeInTheDocument();
    expect(off.getByText('Equipos')).toBeInTheDocument();

    const unlinked = within(row('Cinta señalizadora'));
    expect(unlinked.getByText('Sin vincular')).toBeInTheDocument();
  });

  it('las cabeceras nuevas están en la tabla del documento', async () => {
    renderPage();
    await screen.findByText('Casco blanco');

    expect(screen.getByRole('columnheader', { name: 'Producto de catálogo' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fuente' })).toBeInTheDocument();
  });

  it('"Stock Almacén Principal" lee stock_almacen_central (el nombre *_principal nunca existió en la API)', async () => {
    renderPage();
    await screen.findByText('Casco blanco');

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const col = headers.indexOf('Stock Almacén Principal');
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Casco blanco'));
    expect(within(row).getAllByRole('cell')[col]).toHaveTextContent('7');
  });

  it('un RQ inexistente muestra el estado "no encontrado"', async () => {
    requestsApi.getRequest.mockRejectedValue({ response: { status: 404 } });
    renderPage();

    expect(await screen.findByText('Requerimiento no encontrado')).toBeInTheDocument();
  });
});
