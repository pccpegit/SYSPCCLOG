import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { apiError, pendingRow } from '../../test/pickingFixtures';
import PendientesPage from './PendientesPage';
import { useAuth } from '../../context/AuthContext';
import * as almacen from '../../api/almacen';
import * as requests from '../../api/requests';

vi.mock('../../api/almacen');
vi.mock('../../api/requests');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const COUNT = {
  total: 2,
  by_status: [
    { status: 'IN_STOCK', label: 'Stock disponible — pendiente despacho', count: 1 },
    { status: 'QUALITY_APPROVED', label: 'Calidad aprobada — pendiente despacho', count: 1 },
  ],
};

const RQ_DETAIL = {
  id: 7, rq_number: 'RQ-2026-0007', status: 'IN_STOCK', flow: 'OPERATIONS', priority: 'NORMAL',
  project: { name: 'Proyecto Prueba' }, requested_by: { full_name: 'Luis Prueba Dos' },
  items: [{ id: 11, description: 'Casco de seguridad blanco', quantity: '10.000', unit: 'EA', supply_source: 'STOCK' }],
};

const listOf = (...rows) => ({ data: { count: rows.length, results: rows } });

beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  almacen.getPendingRequests.mockResolvedValue(listOf(
    pendingRow(),
    pendingRow({
      id: 8, rq_number: 'RQ-2026-0008', status: 'QUALITY_APPROVED', act_roles: ['LOGISTICS_COORDINATOR'],
      can_act: false, can_deliver: false, project: 'Proyecto Dos',
    }),
  ));
  almacen.getPendingCount.mockResolvedValue({ data: COUNT });
  requests.getRequest.mockResolvedValue({ data: RQ_DETAIL });
  requests.getAvailableActions.mockResolvedValue({
    data: { available_actions: [{ action: 'DISPATCHED', label: 'Despachar', requires_rejection_path: false }] },
  });
  requests.performAction.mockResolvedValue({ data: {} });
});

describe('PendientesPage — listado', () => {
  it('muestra los RQ en calidad aprobada con su etiqueta', async () => {
    renderWithProviders(<PendientesPage />);
    const card = await screen.findByRole('article', { name: 'Requerimiento RQ-2026-0008' });
    expect(within(card).getByText('Calidad aprobada — pendiente despacho')).toBeInTheDocument();
    // El filtro por estado también la ofrece.
    expect(screen.getByRole('button', { name: /Calidad aprobada — pendiente despacho/ })).toBeInTheDocument();
  });

  it('una tarjeta sin permiso para actuar es de solo lectura', async () => {
    renderWithProviders(<PendientesPage />);
    const card = await screen.findByRole('article', { name: 'Requerimiento RQ-2026-0008' });
    expect(within(card).getByText(/Solo lectura: la acción corresponde a Coord\. Logístico/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Ver detalle RQ-2026-0008' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Gestionar/ })).not.toBeInTheDocument();
  });

  it('enlaza al picking: «Picking y entrega» si puede entregar, «Ver picking» si no', async () => {
    renderWithProviders(<PendientesPage />);
    const link = await screen.findByRole('link', { name: 'Picking y entrega de RQ-2026-0007' });
    expect(link).toHaveAttribute('href', '/almacen/pendientes/7/picking');
    expect(screen.getByRole('link', { name: 'Ver picking de RQ-2026-0008' })).toHaveAttribute('href', '/almacen/pendientes/8/picking');
  });

  it('no ofrece el picking en los estados posteriores al despacho', async () => {
    almacen.getPendingRequests.mockResolvedValue(listOf(pendingRow({ id: 9, rq_number: 'RQ-2026-0009', status: 'DELIVERED' })));
    renderWithProviders(<PendientesPage />);
    await screen.findByRole('article', { name: 'Requerimiento RQ-2026-0009' });
    expect(screen.queryByRole('link', { name: /picking/i })).not.toBeInTheDocument();
  });

  it('informa cuando no hay pendientes', async () => {
    almacen.getPendingRequests.mockResolvedValue(listOf());
    almacen.getPendingCount.mockResolvedValue({ data: { total: 0, by_status: [] } });
    renderWithProviders(<PendientesPage />);
    expect(await screen.findByText('Sin requerimientos pendientes')).toBeInTheDocument();
  });

  it('muestra el error de carga y permite reintentar', async () => {
    almacen.getPendingRequests.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<PendientesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar los requerimientos pendientes.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('article', { name: 'Requerimiento RQ-2026-0007' })).toBeInTheDocument();
  });

  it('filtrar por estado pide la lista con ese estado desde la página 1', async () => {
    renderWithProviders(<PendientesPage />);
    await screen.findByRole('article', { name: 'Requerimiento RQ-2026-0007' });
    await userEvent.click(screen.getByRole('button', { name: /Calidad aprobada — pendiente despacho/ }));
    await waitFor(() => expect(almacen.getPendingRequests).toHaveBeenLastCalledWith({ page: 1, status: 'QUALITY_APPROVED' }));
  });
});

describe('PendientesPage — panel de acciones', () => {
  async function openPanel(user) {
    renderWithProviders(<PendientesPage />);
    await user.click(await screen.findByRole('button', { name: 'Gestionar RQ-2026-0007' }));
    return screen.findByRole('dialog');
  }

  it('lee available_actions y consulta con el rol del usuario', async () => {
    const user = userEvent.setup();
    const dialog = await openPanel(user);
    expect(requests.getAvailableActions).toHaveBeenCalledWith(7, 'CENTRAL_WAREHOUSE');
    expect(await within(dialog).findByLabelText('Registrar despacho')).toBeChecked();
    expect(within(dialog).getByText('Casco de seguridad blanco')).toBeInTheDocument();
  });

  it('envía acting_role y comments (no comment)', async () => {
    const user = userEvent.setup();
    const dialog = await openPanel(user);
    await within(dialog).findByLabelText('Registrar despacho');
    await user.type(within(dialog).getByLabelText(/Comentario/), 'Todo conforme');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar despacho' }));
    await waitFor(() => expect(requests.performAction).toHaveBeenCalledTimes(1));
    expect(requests.performAction).toHaveBeenCalledWith(7, {
      action: 'DISPATCHED', acting_role: 'CENTRAL_WAREHOUSE', comments: 'Todo conforme',
    });
    // Cierra el panel y recarga la lista.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(almacen.getPendingRequests).toHaveBeenCalledTimes(2));
  });

  it('usa el rol que corresponde cuando el usuario tiene varios', async () => {
    useAuth.mockReturnValue({ userRoles: ['REQUESTER', 'SITE_WAREHOUSE', 'CENTRAL_WAREHOUSE'] });
    const user = userEvent.setup();
    await openPanel(user);
    expect(requests.getAvailableActions).toHaveBeenCalledWith(7, 'CENTRAL_WAREHOUSE');
  });

  it('ya no ofrece «Confirmar recepción» (SITE_RECEIVED no existe)', async () => {
    requests.getAvailableActions.mockResolvedValue({
      data: {
        available_actions: [
          { action: 'SITE_RECEIVED', label: 'Recibido en obra' },
          { action: 'DISPATCHED', label: 'Despachar' },
        ],
      },
    });
    const user = userEvent.setup();
    const dialog = await openPanel(user);
    await within(dialog).findByLabelText('Registrar despacho');
    expect(within(dialog).queryByText(/Confirmar recepción/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('SITE_RECEIVED')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
  });

  it('muestra el error del servidor y deja reintentar', async () => {
    requests.performAction.mockRejectedValueOnce(apiError(400, { detail: 'Hay líneas sin stock suficiente.' }));
    const user = userEvent.setup();
    const dialog = await openPanel(user);
    await within(dialog).findByLabelText('Registrar despacho');
    const submit = within(dialog).getByRole('button', { name: 'Registrar despacho' });
    await user.click(submit);
    expect((await within(dialog).findAllByText('Hay líneas sin stock suficiente.')).length).toBeGreaterThan(0);
    expect(submit).not.toHaveAttribute('aria-disabled');
    await user.click(submit);
    await waitFor(() => expect(requests.performAction).toHaveBeenCalledTimes(2));
  });

  it('no envía dos veces con doble clic mientras la acción está en curso', async () => {
    let resolve;
    requests.performAction.mockReturnValue(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    const dialog = await openPanel(user);
    await within(dialog).findByLabelText('Registrar despacho');
    const submit = within(dialog).getByRole('button', { name: 'Registrar despacho' });
    await user.dblClick(submit);
    expect(requests.performAction).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Ejecutando…' })).toHaveAttribute('aria-disabled', 'true');
    resolve({ data: {} });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('avisa si el usuario no tiene acciones disponibles', async () => {
    requests.getAvailableActions.mockResolvedValue({ data: { available_actions: [] } });
    const user = userEvent.setup();
    const dialog = await openPanel(user);
    expect(await within(dialog).findByText(/No tienes acciones disponibles/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
  });

  it('en una tarjeta de solo lectura muestra los ítems sin acciones ni consulta de acciones', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PendientesPage />);
    await user.click(await screen.findByRole('button', { name: 'Ver detalle RQ-2026-0008' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Solo lectura: la acción de este estado corresponde a Coord\. Logístico/)).toBeInTheDocument();
    expect(requests.getAvailableActions).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Registrar despacho/ })).not.toBeInTheDocument();
  });

  it('ofrece el picking dentro del panel si el usuario puede entregar', async () => {
    const user = userEvent.setup();
    const dialog = await openPanel(user);
    const link = await within(dialog).findByRole('link', { name: 'Picking y entrega' });
    expect(link).toHaveAttribute('href', '/almacen/pendientes/7/picking');
  });

  it('muestra el error de carga del requerimiento', async () => {
    requests.getRequest.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    const dialog = await openPanel(user);
    expect(await within(dialog).findByText('No se pudo cargar el requerimiento. Intente de nuevo.')).toBeInTheDocument();
  });

  it('Escape cierra el panel', async () => {
    const user = userEvent.setup();
    await openPanel(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
