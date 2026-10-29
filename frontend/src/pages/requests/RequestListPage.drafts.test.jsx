import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import LocationProbe from '../../test/LocationProbe';
import RequestListPage from './RequestListPage';
import { useAuth } from '../../context/AuthContext';
import * as requestsApi from '../../api/requests';
import * as coreApi from '../../api/core';

// SYSPCC-031: the drafts of "Mis requerimientos" show up with the state Borrador and the actions
// Continuar / Enviar / Eliminar. The API layer is mocked.
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/requests');
vi.mock('../../api/core');

const DRAFT = {
  id: 7, rq_number: 'BOR-AB12CD34EF56', status: 'DRAFT', description: '', priority: 'NORMAL',
  project_code: 'PRY-001', project_name: 'Proyecto Minera', created_at: '2026-10-29T10:00:00Z',
};
const SENT = {
  id: 8, rq_number: 'RQ-2026-0001', status: 'SUBMITTED', description: 'Cemento', priority: 'NORMAL',
  project_code: 'PRY-001', project_name: 'Proyecto Minera', created_at: '2026-10-28T10:00:00Z',
};

function renderList() {
  return renderWithProviders(
    <Routes>
      <Route path="/rq/requests" element={<RequestListPage />} />
      <Route path="*" element={<LocationProbe />} />
    </Routes>,
    { route: '/rq/requests' },
  );
}

async function findDraftRow() {
  const sent = await screen.findByText('RQ-2026-0001');
  return { draftRow: screen.getAllByRole('row').find((r) => within(r).queryByRole('button', { name: /^Continuar el borrador/ })), sentRow: sent.closest('tr') };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ primaryRole: 'REQUESTER', currentUser: { id: 1 } });
  coreApi.getProjects.mockResolvedValue({ data: { results: [] } });
  requestsApi.getRequests.mockResolvedValue({ data: { count: 2, results: [DRAFT, SENT] } });
});

describe('RequestListPage — borradores (SYSPCC-031)', () => {
  it('el borrador aparece con estado Borrador, sin su N° provisional, y con las acciones; un RQ enviado no las tiene', async () => {
    renderList();

    const { draftRow, sentRow } = await findDraftRow();

    expect(draftRow).toBeDefined();
    expect(within(draftRow).getAllByText('Borrador').length).toBe(2); // N° column + badge del estado
    expect(screen.queryByText('BOR-AB12CD34EF56')).not.toBeInTheDocument();
    expect(within(draftRow).getByRole('button', { name: /^Enviar el borrador/ })).toBeInTheDocument();
    expect(within(draftRow).getByRole('button', { name: /^Eliminar el borrador/ })).toBeInTheDocument();
    expect(within(sentRow).queryByRole('button')).not.toBeInTheDocument();
    // A draft is deleted, never cancelled (a cancelled draft would leave a numbered ghost).
    expect(within(draftRow).queryByRole('button', { name: /cancelar/i })).not.toBeInTheDocument();
    expect(within(draftRow).getAllByRole('button')).toHaveLength(3);
  });

  it('Continuar abre el formulario del borrador; clicar la fila hace lo mismo', async () => {
    const user = userEvent.setup();
    renderList();
    const { draftRow } = await findDraftRow();

    await user.click(within(draftRow).getByRole('button', { name: /^Continuar el borrador/ }));

    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/requests/draft/7');
  });

  it('clicar la fila de un RQ enviado abre su detalle', async () => {
    const user = userEvent.setup();
    renderList();
    const { sentRow } = await findDraftRow();

    await user.click(sentRow);

    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/requests/RQ-2026-0001');
  });

  it('Enviar ejecuta el envío, avisa con el N° oficial y recarga la lista', async () => {
    const user = userEvent.setup();
    requestsApi.submitDraft.mockResolvedValue({ data: { id: 7, status: 'SUBMITTED', rq_number: 'RQ-2026-0042' } });
    renderList();
    const { draftRow } = await findDraftRow();

    await user.click(within(draftRow).getByRole('button', { name: /^Enviar el borrador/ }));

    await screen.findByText('Requerimiento enviado. N° RQ-2026-0042.');
    expect(requestsApi.submitDraft).toHaveBeenCalledWith(7);
    expect(requestsApi.getRequests).toHaveBeenCalledTimes(2);
  });

  it('si el servidor dice que falta algo (400) lista cada error, no recarga y ofrece continuar el borrador', async () => {
    const user = userEvent.setup();
    requestsApi.submitDraft.mockRejectedValue({
      response: {
        status: 400,
        data: { error: true, detail: { fecha_necesidad: ['Ingrese la fecha de entrega.'], items: ['Ítem 1: Seleccione la fuente del ítem.'] } },
      },
    });
    renderList();
    const { draftRow } = await findDraftRow();

    await user.click(within(draftRow).getByRole('button', { name: /^Enviar el borrador/ }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Ingrese la fecha de entrega.')).toBeInTheDocument();
    expect(within(alert).getByText('Ítem 1: Seleccione la fuente del ítem.')).toBeInTheDocument();
    expect(requestsApi.getRequests).toHaveBeenCalledTimes(1);

    await user.click(within(alert).getByRole('button', { name: 'Continuar el borrador' }));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/requests/draft/7');
  });

  it('Eliminar pide confirmación; cancelar no borra nada', async () => {
    const user = userEvent.setup();
    renderList();
    const { draftRow } = await findDraftRow();

    await user.click(within(draftRow).getByRole('button', { name: /^Eliminar el borrador/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/no se puede deshacer/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(requestsApi.deleteRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirmar Eliminar borra el borrador, avisa y recarga la lista', async () => {
    const user = userEvent.setup();
    requestsApi.deleteRequest.mockResolvedValue({});
    renderList();
    const { draftRow } = await findDraftRow();

    await user.click(within(draftRow).getByRole('button', { name: /^Eliminar el borrador/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }));

    await screen.findByText('Borrador eliminado.');
    expect(requestsApi.deleteRequest).toHaveBeenCalledWith(7);
    expect(requestsApi.getRequests).toHaveBeenCalledTimes(2);
  });

  it('si no se puede eliminar muestra el error del servidor', async () => {
    const user = userEvent.setup();
    requestsApi.deleteRequest.mockRejectedValue({
      response: { status: 400, data: { detail: 'Solo se pueden eliminar requerimientos en estado BORRADOR.' } },
    });
    renderList();
    const { draftRow } = await findDraftRow();

    await user.click(within(draftRow).getByRole('button', { name: /^Eliminar el borrador/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText('Solo se pueden eliminar requerimientos en estado BORRADOR.')).toBeInTheDocument();
  });
});
