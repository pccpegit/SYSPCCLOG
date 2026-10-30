import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LAYOUT, SUMMARY, exactItem, makeItem, page } from '../../test/almacenFixtures';
import InventarioPage from './InventarioPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · QA ronda 2 — ramas de «Empezar a ubicar», asignación por fila y alta de ítems.

const PENDING = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco T: L', total_stock: 12 }),
  makeItem({ id: 3, product_code: 'EPP000003', description: 'Lentes claros', total_stock: 2 }),
];
const EXACT = [exactItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', total_stock: 4 })];

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue(page([...PENDING, ...EXACT]));
  api.getCategories.mockResolvedValue({ data: ['EPP', 'Otros'] });
  api.getSummary.mockResolvedValue({ data: SUMMARY });
  api.getMovementSummary.mockResolvedValue({ data: { results: [], meta: { totals: { closing: 100 } } } });
  api.getLocationLayout.mockResolvedValue({ data: LAYOUT });
  api.assignLocations.mockResolvedValue({ data: { updated: 1 } });
});

describe('InventarioPage — «Empezar a ubicar»', () => {
  it('con el filtro de pendientes ya activo abre directamente el primer pendiente de la lista', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />, { route: '/almacen/inventario?pendientes=1' });
    await screen.findByText('EPP000001');
    const loads = api.getInventory.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /empezar a ubicar/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Asignar ubicación' });
    expect(within(dialog).getByText('EPP000001')).toBeInTheDocument();
    expect(api.getInventory.mock.calls.length).toBe(loads);          // no recarga: el filtro ya estaba puesto
  });

  it('si la lista visible no tiene pendientes (aviso desfasado) no abre un diálogo vacío', async () => {
    const user = userEvent.setup();
    api.getInventory.mockResolvedValue(page(EXACT));
    renderWithProviders(<InventarioPage />, { route: '/almacen/inventario?pendientes=1' });
    await screen.findByText('EPP000002');
    await user.click(screen.getByRole('button', { name: /empezar a ubicar/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cerrar el diálogo sin asignar no envía nada ni recarga el listado', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />, { route: '/almacen/inventario?pendientes=1' });
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /empezar a ubicar/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Asignar ubicación' });
    const loads = api.getInventory.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: /cancelar/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.assignLocations).not.toHaveBeenCalled();
    expect(api.getInventory.mock.calls.length).toBe(loads);
  });
});

describe('InventarioPage — asignar por fila y alta de ítems', () => {
  it('el botón de la fila abre la asignación de ESE ítem, sin cola', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000003');
    await user.click(screen.getByRole('button', { name: 'Asignar ubicación a EPP000003' }));
    const dialog = await screen.findByRole('dialog', { name: 'Asignar ubicación' });
    expect(within(dialog).getByText('EPP000003')).toBeInTheDocument();
    expect(within(dialog).queryByText('EPP000001')).not.toBeInTheDocument();
  });

  it('abrir la asignación desde la fila no navega al kardex del ítem', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: 'Asignar ubicación a EPP000001' }));
    expect(await screen.findByRole('dialog', { name: 'Asignar ubicación' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /kardex/i })).not.toBeInTheDocument();
  });

  it('«Nuevo ítem» abre el formulario y «Cancelar» lo cierra sin crear nada', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /nuevo ítem/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.createInventoryItem).not.toHaveBeenCalled();
  });
});
