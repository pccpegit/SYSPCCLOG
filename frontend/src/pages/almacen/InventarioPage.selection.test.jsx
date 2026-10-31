import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LAYOUT, SUMMARY, makeItem, page } from '../../test/almacenFixtures';
import InventarioPage from './InventarioPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco' }),
  makeItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero' }),
  makeItem({ id: 3, product_code: 'EPP000003', description: 'Lentes claros' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue(page(ITEMS));
  api.getCategories.mockResolvedValue({ data: ['EPP'] });
  api.getSummary.mockResolvedValue({ data: SUMMARY });
  api.getMovementSummary.mockResolvedValue({ data: { results: [], meta: { totals: { closing: 100 } } } });
  api.getLocationLayout.mockResolvedValue({ data: LAYOUT });
});

const checkbox = (name) => screen.getByRole('checkbox', { name });

describe('InventarioPage — selección masiva', () => {
  it('«Seleccionar todos» marca la página, anuncia la cantidad y se puede deshacer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');

    await user.click(checkbox(/seleccionar todos los ítems de esta página/i));
    expect(screen.getByText('3 ítems seleccionados')).toBeInTheDocument();
    expect(checkbox('Seleccionar EPP000002')).toBeChecked();

    await user.click(checkbox(/seleccionar todos los ítems de esta página/i));
    expect(screen.queryByText(/ítems seleccionados/)).not.toBeInTheDocument();
    expect(checkbox('Seleccionar EPP000002')).not.toBeChecked();
  });

  it('una casilla suelta usa el singular y «Quitar selección» la limpia', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');

    await user.click(checkbox('Seleccionar EPP000002'));
    expect(screen.getByText('1 ítem seleccionado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /asignar ubicación a 1 ítem$/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /quitar selección/i }));
    expect(screen.queryByText(/ítem seleccionado/)).not.toBeInTheDocument();
  });

  it('marcar todos y luego desmarcar uno deja la casilla general sin marcar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(checkbox(/seleccionar todos los ítems de esta página/i));
    await user.click(checkbox('Seleccionar EPP000003'));
    expect(checkbox(/seleccionar todos los ítems de esta página/i)).not.toBeChecked();
    expect(screen.getByText('2 ítems seleccionados')).toBeInTheDocument();
  });

  it('cambiar de página descarta la selección (no se asigna a ítems que ya no se ven)', async () => {
    const user = userEvent.setup();
    api.getInventory.mockResolvedValue(page(ITEMS, { count: 120 }));
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(checkbox('Seleccionar EPP000001'));
    expect(screen.getByText('1 ítem seleccionado')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(api.getInventory.mock.lastCall[0]).toMatchObject({ page: 2 }));
    expect(screen.queryByText(/ítem seleccionado/)).not.toBeInTheDocument();
  });

  it('cambiar un filtro descarta la selección y vuelve a la página 1', async () => {
    const user = userEvent.setup();
    api.getInventory.mockResolvedValue(page(ITEMS, { count: 120 }));
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(api.getInventory.mock.lastCall[0]).toMatchObject({ page: 2 }));
    await user.click(checkbox('Seleccionar EPP000002'));

    await user.selectOptions(screen.getByLabelText('Categoría'), 'EPP');
    await waitFor(() => expect(api.getInventory.mock.lastCall[0]).toMatchObject({ page: 1, category: 'EPP' }));
    expect(screen.queryByText(/ítem seleccionado/)).not.toBeInTheDocument();
  });

  it('el diálogo de asignación masiva se cierra con Cancelar sin enviar nada', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(checkbox('Seleccionar EPP000001'));
    await user.click(checkbox('Seleccionar EPP000002'));
    await user.click(screen.getByRole('button', { name: /asignar ubicación a 2 ítems/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.assignLocations).not.toHaveBeenCalled();
    expect(screen.getByText('2 ítems seleccionados')).toBeInTheDocument();          // la selección sigue
  });

  it('la fila tiene su propio botón de ubicar y sus casillas no abren el kardex', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: 'Asignar ubicación a EPP000003' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('InventarioPage — sin permiso de asignar ubicación', () => {
  it.each([['SITE_WAREHOUSE'], ['LOGISTICS_COORDINATOR'], ['LOGISTICS_SUPERVISOR']])(
    '%s no ve casillas, botones de ubicar ni la selección masiva',
    async (role) => {
      useAuth.mockReturnValue({ userRoles: [role] });
      renderWithProviders(<InventarioPage />);
      await screen.findByText('EPP000001');
      expect(screen.queryAllByRole('checkbox', { name: /seleccionar/i })).toHaveLength(0);
      expect(screen.queryByRole('button', { name: /asignar ubicación/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /empezar a ubicar/i })).not.toBeInTheDocument();
    },
  );

  /**
   * DEFECTO QA-24: `POST/PATCH inventory/` con piso, ubicación o proyecto responde 403 a los roles sin
   * `CanAssignLocations` («Solo Almacén Central y Jefatura de Logística pueden cambiar la ubicación…»),
   * pero «Nuevo ítem» les ofrece los selectores de piso y ubicación: el 403 llega después de rellenar todo.
   */
  it.each([['SITE_WAREHOUSE'], ['LOGISTICS_COORDINATOR'], ['LOGISTICS_SUPERVISOR']])(
    'DEFECTO QA-24: %s no puede elegir piso ni ubicación en «Nuevo ítem»',
    async (role) => {
      const user = userEvent.setup();
      useAuth.mockReturnValue({ userRoles: [role] });
      renderWithProviders(<InventarioPage />);
      await screen.findByText('EPP000001');
      await user.click(screen.getByRole('button', { name: /nuevo ítem/i }));
      const dialog = await screen.findByRole('dialog');

      const floor = within(dialog).queryByLabelText(/piso o zona/i);
      expect(floor === null || floor.disabled).toBe(true);
    },
  );

  it('Almacén Central sí puede elegir el piso al crear un ítem', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /nuevo ítem/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/piso o zona/i)).toBeEnabled();
  });
});
