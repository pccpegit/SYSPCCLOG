import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LAYOUT, SUMMARY, exactItem, makeItem, page } from '../../test/almacenFixtures';
import InventarioPage from './InventarioPage';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco T: L', total_stock: 12 }),
  exactItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', total_stock: 0, stocks: [] }),
  makeItem({ id: 3, product_code: 'EPP000003', description: 'Lentes claros', total_stock: 2, min_stock: 5 }),
];

const lastParams = () => api.getInventory.mock.lastCall[0];

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue(page(ITEMS));
  api.getCategories.mockResolvedValue({ data: ['EPP', 'Otros'] });
  api.getSummary.mockResolvedValue({ data: SUMMARY });
  api.getMovementSummary.mockResolvedValue({ data: { results: [], meta: { totals: { closing: 6857 } } } });
  api.getLocationLayout.mockResolvedValue({ data: LAYOUT });
});

describe('InventarioPage — listado', () => {
  it('muestra la cabecera con ítems, unidades, sin stock y pendientes', async () => {
    renderWithProviders(<InventarioPage />);
    expect(await screen.findByText(/254 ítems/)).toBeInTheDocument();
    expect(screen.getByText(/6[.,]857 unidades/)).toBeInTheDocument();
    expect(screen.getByText(/27 sin stock/)).toBeInTheDocument();
    expect(screen.getByText(/254 pendientes de ubicar/)).toBeInTheDocument();
  });

  it('muestra ubicación exacta o "Pendiente de ubicar · piso" y el estado con texto', async () => {
    renderWithProviders(<InventarioPage />);
    const table = await screen.findByRole('table', { name: /ítems del inventario/i });
    expect(within(table).getByText('F3-2')).toBeInTheDocument();
    expect(within(table).getAllByText(/pendiente de ubicar · 2do piso/i)).toHaveLength(2);
    expect(within(table).getByText('Con stock')).toBeInTheDocument();
    expect(within(table).getByText('Sin stock')).toBeInTheDocument();
    expect(within(table).getByText('Bajo mínimo')).toBeInTheDocument();
  });

  it('muestra el estado vacío con los filtros activos', async () => {
    api.getInventory.mockResolvedValue(page([]));
    renderWithProviders(<InventarioPage />);
    expect(await screen.findByText('No hay ítems que coincidan con los filtros.')).toBeInTheDocument();
  });

  it('muestra el error y permite reintentar', async () => {
    const user = userEvent.setup();
    api.getInventory.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<InventarioPage />);
    expect(await screen.findByText('No se pudo cargar el inventario.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText('EPP000001')).toBeInTheDocument();
  });
});

describe('InventarioPage — filtros', () => {
  it('traduce cada filtro a los parámetros del backend', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');

    await user.selectOptions(screen.getByLabelText('Estado de stock'), 'Sin stock');
    await waitFor(() => expect(lastParams()).toMatchObject({ has_stock: 'false' }));

    await user.selectOptions(screen.getByLabelText('Estado de stock'), 'Bajo mínimo');
    await waitFor(() => expect(lastParams()).toMatchObject({ low_stock: 'true', has_stock: 'true' }));

    await user.selectOptions(screen.getByLabelText('Piso'), '2do piso');
    await waitFor(() => expect(lastParams()).toMatchObject({ floor: '2' }));

    await user.selectOptions(screen.getByLabelText('Categoría'), 'EPP');
    await waitFor(() => expect(lastParams()).toMatchObject({ category: 'EPP' }));

    await user.click(screen.getByRole('checkbox', { name: /solo pendientes de ubicar/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ location_status: 'pending' }));
  });

  it('busca con retardo y vuelve a la página 1', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.type(screen.getByLabelText('Buscar'), 'casco');
    await waitFor(() => expect(lastParams()).toMatchObject({ search: 'casco', page: 1 }));
  });

  it('respeta el filtro de un enlace (?pendientes=1&estado=none)', async () => {
    renderWithProviders(<InventarioPage />, { route: '/almacen/inventario?pendientes=1&estado=none' });
    await screen.findByText('EPP000001');
    expect(api.getInventory.mock.calls[0][0]).toMatchObject({ location_status: 'pending', has_stock: 'false' });
  });
});

describe('InventarioPage — roles', () => {
  it('Almacén Central ve casillas, asignar ubicación e Importar Excel', async () => {
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar EPP000001' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /importar excel/i })).toHaveAttribute('href', '/almacen/importar');
    expect(screen.getByRole('button', { name: 'Asignar ubicación a EPP000001' })).toBeInTheDocument();
  });

  it('Almacén de Obra no ve asignar ubicación ni Importar Excel', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    expect(screen.queryByRole('checkbox', { name: /seleccionar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /importar excel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /asignar ubicación/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nuevo ítem/i })).toBeInTheDocument();
  });
});

describe('InventarioPage — asignar ubicación (fase 3)', () => {
  async function openAssign(user) {
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar EPP000001' }));
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar EPP000003' }));
    await user.click(screen.getByRole('button', { name: /asignar ubicación a 2 ítems/i }));
    return screen.findByRole('dialog');
  }

  it('asigna la misma ubicación a los ítems seleccionados y recarga la lista', async () => {
    const user = userEvent.setup();
    api.assignLocations.mockResolvedValue({ data: { updated: 2 } });
    const dialog = await openAssign(user);

    // Los dos ítems están en el 2do piso: solo se ofrecen los pabellones F a K.
    const pavilion = await within(dialog).findByLabelText('Pabellón');
    expect(within(pavilion).queryByRole('option', { name: 'A' })).not.toBeInTheDocument();
    await user.selectOptions(pavilion, 'F');
    await user.selectOptions(within(dialog).getByLabelText('Sección'), '3');
    await user.selectOptions(within(dialog).getByLabelText('Nivel'), '2');
    expect(within(dialog).getByText('F3-2')).toBeInTheDocument();

    const callsBefore = api.getInventory.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: /^asignar$/i }));

    await waitFor(() => expect(api.assignLocations).toHaveBeenCalledWith([
      { inventory: 1, location: 'F3-2' },
      { inventory: 3, location: 'F3-2' },
    ]));
    await waitFor(() => expect(api.getInventory.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no envía nada hasta elegir pabellón, sección y nivel', async () => {
    const user = userEvent.setup();
    const dialog = await openAssign(user);
    await within(dialog).findByLabelText('Pabellón');
    await user.click(within(dialog).getByRole('button', { name: /^asignar$/i }));
    expect(await within(dialog).findByText('Escriba el código o elija pabellón, sección y nivel.')).toBeInTheDocument();
    expect(api.assignLocations).not.toHaveBeenCalled();
  });

  it('si el servidor rechaza una ubicación, no aplica ninguna y muestra el error por ítem', async () => {
    const user = userEvent.setup();
    api.assignLocations.mockRejectedValue({
      response: { status: 400, data: { errors: [{ index: 1, field: 'location', error: 'La ubicación F9-7 no existe en el layout del almacén.' }] } },
    });
    const dialog = await openAssign(user);
    await user.selectOptions(await within(dialog).findByLabelText('Pabellón'), 'F');
    await user.selectOptions(within(dialog).getByLabelText('Sección'), '1');
    await user.selectOptions(within(dialog).getByLabelText('Nivel'), '1');
    await user.click(within(dialog).getByRole('button', { name: /^asignar$/i }));

    expect(await within(dialog).findByText(/no se aplicó ningún cambio/i)).toBeInTheDocument();
    const errorList = within(dialog).getByRole('list', { name: /errores por ítem/i });
    expect(within(errorList).getByText('EPP000003')).toBeInTheDocument();
    expect(within(errorList).getByText(/no existe en el layout/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('InventarioPage — exportar', () => {
  it('descarga el Excel con los filtros activos', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    api.exportInventory.mockResolvedValue({
      data: new Blob(['x']), headers: { 'content-disposition': 'attachment; filename="inventario.xlsx"' },
    });
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.selectOptions(screen.getByLabelText('Piso'), '2do piso');
    await user.click(screen.getByRole('button', { name: /exportar/i }));

    await waitFor(() => expect(api.exportInventory).toHaveBeenCalledWith({ floor: '2' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('avisa si la exportación falla', async () => {
    const user = userEvent.setup();
    api.exportInventory.mockRejectedValue(new Error('x'));
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /exportar/i }));
    expect(await screen.findByText(/no se pudo exportar el inventario/i)).toBeInTheDocument();
  });
});

describe('InventarioPage — nuevo ítem', () => {
  it('valida los campos obligatorios en español sin llamar al servidor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /nuevo ítem/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /crear ítem/i }));
    expect(within(dialog).getAllByText('Este campo es obligatorio.').length).toBeGreaterThanOrEqual(3);
    expect(api.createInventoryItem).not.toHaveBeenCalled();
  });

  it('crea el ítem con los campos nuevos y recarga el listado', async () => {
    const user = userEvent.setup();
    api.createInventoryItem.mockResolvedValue({ data: { id: 99 } });
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /nuevo ítem/i }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText(/^código/i), 'EPP000999');
    await user.type(within(dialog).getByLabelText(/^descripción/i), 'Tapones auditivos');
    await user.type(within(dialog).getByLabelText(/^unidad/i), 'PAR');
    await user.type(within(dialog).getByLabelText(/^oc$/i), 'OC-77');
    await user.type(within(dialog).getByLabelText(/packing list/i), '24003-13');
    await user.click(within(dialog).getByRole('button', { name: /crear ítem/i }));

    await waitFor(() => expect(api.createInventoryItem).toHaveBeenCalledTimes(1));
    expect(api.createInventoryItem.mock.calls[0][0]).toMatchObject({
      product_code: 'EPP000999', description: 'Tapones auditivos', unit: 'PAR', category: 'EPP',
      purchase_order_ref: 'OC-77', packing_list: '24003-13', location: '', floor: null,
    });
  });

  it('muestra el error del servidor en el campo (código duplicado)', async () => {
    const user = userEvent.setup();
    api.createInventoryItem.mockRejectedValue({ response: { status: 400, data: { error: true, detail: { product_code: ['Ya existe un ítem con el código EPP000001.'] } } } });
    renderWithProviders(<InventarioPage />);
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /nuevo ítem/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^código/i), 'EPP000001');
    await user.type(within(dialog).getByLabelText(/^descripción/i), 'X');
    await user.type(within(dialog).getByLabelText(/^unidad/i), 'EA');
    await user.click(within(dialog).getByRole('button', { name: /crear ítem/i }));
    expect(await within(dialog).findByText('Ya existe un ítem con el código EPP000001.')).toBeInTheDocument();
  });
});

// SYSPCC-025 · react-frontend ronda 1 — los 254 ítems del libro real quedan «sin ubicación exacta»:
// el aviso con «Empezar a ubicar» y el recorrido ítem por ítem.
describe('InventarioPage — empezar a ubicar', () => {
  // Otros tests de este archivo dejan `assignLocations` rechazando: aquí siempre responde bien.
  beforeEach(() => { api.assignLocations.mockResolvedValue({ data: { updated: 1 } }); });

  it('muestra un aviso destacado con el botón «Empezar a ubicar» cuando hay pendientes', async () => {
    renderWithProviders(<InventarioPage />);
    expect(await screen.findByRole('button', { name: /empezar a ubicar/i })).toBeInTheDocument();
    expect(screen.getByText(/sin ubicación exacta: 254/i)).toBeInTheDocument();
  });

  it('no lo muestra a un rol que no puede asignar ubicaciones', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<InventarioPage />);
    await screen.findByRole('table', { name: /ítems del inventario/i });
    expect(screen.queryByRole('button', { name: /empezar a ubicar/i })).not.toBeInTheDocument();
  });

  it('no lo muestra si no hay pendientes', async () => {
    api.getSummary.mockResolvedValue({ data: { ...SUMMARY, pending_location_count: 0 } });
    renderWithProviders(<InventarioPage />);
    await screen.findByRole('table', { name: /ítems del inventario/i });
    expect(screen.queryByRole('button', { name: /empezar a ubicar/i })).not.toBeInTheDocument();
  });

  it('filtra por pendientes y abre la asignación del primero con «Asignar y siguiente»', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />);
    await user.click(await screen.findByRole('button', { name: /empezar a ubicar/i }));

    await waitFor(() => expect(lastParams()).toMatchObject({ location_status: 'pending' }));
    const dialog = await screen.findByRole('dialog', { name: 'Asignar ubicación' });
    // El primer pendiente de la lista es EPP000001; quedan otros después.
    expect(within(dialog).getByText('EPP000001')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /asignar y siguiente/i })).toBeInTheDocument();
  });

  it('con ?ubicar=1 (enlace del Dashboard) abre la asignación del primer pendiente al cargar', async () => {
    renderWithProviders(<InventarioPage />, { route: '/almacen/inventario?pendientes=1&ubicar=1' });
    const dialog = await screen.findByRole('dialog', { name: 'Asignar ubicación' });
    expect(within(dialog).getByText('EPP000001')).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ location_status: 'pending' });
  });

  it('«Asignar y siguiente» recorre los pendientes sin cerrar el diálogo y recarga el listado', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventarioPage />, { route: '/almacen/inventario?pendientes=1&ubicar=1' });
    const dialog = await screen.findByRole('dialog', { name: 'Asignar ubicación' });
    await user.type(within(dialog).getByLabelText('Código de ubicación'), 'F3-2');
    const callsBefore = api.getInventory.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: /asignar y siguiente/i }));

    await waitFor(() => expect(api.assignLocations).toHaveBeenCalledWith([{ inventory: 1, location: 'F3-2' }]));
    // El mismo diálogo ahora muestra el siguiente pendiente (EPP000003: el 2 ya tiene ubicación exacta).
    expect(await within(screen.getByRole('dialog')).findByText('EPP000003')).toBeInTheDocument();
    await waitFor(() => expect(api.getInventory.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
