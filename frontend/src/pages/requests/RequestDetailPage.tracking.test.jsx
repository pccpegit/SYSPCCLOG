import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequestDetailPage from './RequestDetailPage';
import { useAuth } from '../../context/useAuth';
import * as requestsApi from '../../api/requests';
import * as masterApi from '../../api/requestMaster';
import { buildMasterRow, page } from '../../test/requestMasterFixtures';

// SYSPCC-030 — el detalle del RQ incluye «Seguimiento por ítem» con request-master/?request=<id>.
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/requests');
vi.mock('../../api/requestMaster');

beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ primaryRole: 'REQUESTER' });
  requestsApi.getRequest.mockResolvedValue({
    data: {
      id: 42, rq_number: 'RQ-2026-0042', status: 'IN_STOCK', flow: 'OPERATIONS',
      description: 'Material para frente 3', priority: 'NORMAL', project_code: 'PRY-001',
      project_name: 'Proyecto Demo Uno', requested_by_name: 'Usuario Prueba 1', created_at: '2026-10-01T10:00:00Z',
      items: [{ id: 101, line_number: 1, description: 'Casco blanco', quantity: '10.000', unit: 'UND' }],
    },
  });
  requestsApi.getApprovals.mockResolvedValue({ data: { results: [] } });
  masterApi.getRequestMaster.mockResolvedValue({ data: page([buildMasterRow()]), headers: {} });
});

function renderPage(route = '/rq/requests/42') {
  return renderWithProviders(
    <Routes>
      <Route path="/rq/requests/:id" element={<RequestDetailPage />} />
    </Routes>,
    { route },
  );
}

describe('RequestDetailPage — Seguimiento por ítem (SYSPCC-030)', () => {
  it('muestra la sección con lo atendido por el almacén, consultando por el id del RQ', async () => {
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'Seguimiento por ítem' });
    const section = heading.closest('section');
    const table = await within(section).findByRole('table', { name: /Seguimiento por ítem/ });
    expect(within(table).getByText('Parcial')).toBeInTheDocument();
    expect(masterApi.getRequestMaster).toHaveBeenCalledWith(expect.objectContaining({ request: 42 }));
    const params = masterApi.getRequestMaster.mock.calls[0][0];
    expect(params).not.toHaveProperty('project');
  });

  it('si se abre por número de RQ, consulta con el id numérico del detalle', async () => {
    requestsApi.getRequests.mockResolvedValue({ data: { results: [{ id: 42 }] } });
    renderPage('/rq/requests/RQ-2026-0042');
    // la ruta es :id, así que el parámetro llega como texto
    await screen.findByRole('heading', { name: 'Seguimiento por ítem' });
    expect(masterApi.getRequestMaster).toHaveBeenCalledWith(expect.objectContaining({ request: 42 }));
  });

  it('un fallo del seguimiento no rompe el resto del detalle', async () => {
    masterApi.getRequestMaster.mockRejectedValue({ response: { status: 500, data: 'boom' } });
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'Seguimiento por ítem' });
    expect(await within(heading.closest('section')).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Documento PCC-ADM-FOR-01')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Historial del Requerimiento' })).toBeInTheDocument();
  });
});
