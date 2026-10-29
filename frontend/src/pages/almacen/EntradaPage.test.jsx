import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { exactItem, makeItem } from '../../test/almacenFixtures';
import { localISODate } from '../../utils/almacen';
import EntradaPage from './EntradaPage';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 4 }),
  exactItem({ id: 2, product_code: 'EPP000002', description: 'Cinta de seguridad', unit: 'M2', total_stock: 0, stocks: [] }),
];

const GROUP = { id: 5, group_number: 'ENT-2026-G0001', movements: [{ id: 50 }] };

async function pickItem(user, label, name) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name }));
}

async function fillValidLine(user, quantity = '5') {
  await pickItem(user, /ítem 1/i, /casco blanco/i);
  await user.type(screen.getByLabelText(/cantidad ingresada/i), quantity);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.registerEntryBatch.mockResolvedValue({ data: GROUP });
});

describe('EntradaPage — validaciones', () => {
  it('exige la fecha del ingreso y enfoca el campo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    const date = screen.getByLabelText(/fecha del ingreso/i);
    expect(date).toHaveValue(localISODate());

    fireEvent.change(date, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    expect(await screen.findByText('Indique la fecha del movimiento.')).toBeInTheDocument();
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(api.registerEntryBatch).not.toHaveBeenCalled();
  });

  it('rechaza una fecha futura', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    fireEvent.change(screen.getByLabelText(/fecha del ingreso/i), { target: { value: '2999-01-01' } });
    await fillValidLine(user);
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    expect(await screen.findByText('La fecha no puede ser futura.')).toBeInTheDocument();
    expect(api.registerEntryBatch).not.toHaveBeenCalled();
  });

  it('avisa (sin bloquear) cuando la fecha es de hace más de 7 días', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    fireEvent.change(screen.getByLabelText(/fecha del ingreso/i), { target: { value: '2020-01-15' } });
    expect(screen.getByText('La fecha es anterior a 7 días. Verifique antes de guardar.')).toBeInTheDocument();
    await fillValidLine(user);
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
  });

  it('valida ítem y cantidad (mayor que 0 y entera para EA)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });

    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    expect(await screen.findByText('Seleccione un ítem.')).toBeInTheDocument();
    expect(screen.getByText('La cantidad debe ser mayor que 0.')).toBeInTheDocument();

    await pickItem(user, /ítem 1/i, /casco blanco/i);
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '1.5');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    expect(await screen.findByText('La cantidad de EA debe ser un número entero.')).toBeInTheDocument();
    expect(api.registerEntryBatch).not.toHaveBeenCalled();
  });

  it('acepta decimales en unidades como M2', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await pickItem(user, /ítem 1/i, /cinta de seguridad/i);
    await user.type(screen.getByLabelText(/cantidad ingresada/i), '1.5');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
  });

  it('avisa que no hay guía de remisión sin bloquear', async () => {
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    expect(screen.getByText(/sin guía de remisión: se registrará, pero la recepción quedará sin documento/i)).toBeInTheDocument();
  });
});

describe('EntradaPage — registro', () => {
  it('envía fecha, documentos, TAG y observación y muestra el resultado con pendientes de ubicar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });

    await user.type(screen.getByLabelText(/^proveedor/i), 'Proveedor de prueba');
    await user.type(screen.getByLabelText(/^po \/ oc/i), 'OC-100');
    await user.type(screen.getByLabelText(/^guía de remisión/i), 'T001-000123');
    await user.type(screen.getByLabelText(/^factura/i), 'F001-000999');
    await user.type(screen.getByLabelText(/observación general/i), 'Llegó completo');
    await fillValidLine(user);
    await user.type(screen.getByLabelText(/^tag/i), 'TAG-9');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));

    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    expect(api.registerEntryBatch).toHaveBeenCalledWith({
      items: [{ inventory: 1, quantity: 5, tag: 'TAG-9' }],
      warehouse: 'CENTRAL',
      source_type: 'PURCHASE',
      movement_date: localISODate(),
      supplier_name: 'Proveedor de prueba',
      po_number: 'OC-100',
      guide_number: 'T001-000123',
      invoice_number: 'F001-000999',
      notes: 'Llegó completo',
    });

    expect(await screen.findByRole('heading', { name: 'Ingreso registrado' })).toBeInTheDocument();
    expect(screen.getByText('ENT-2026-G0001')).toBeInTheDocument();
    expect(screen.getByText(/1 ítem quedó pendiente de ubicar/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /asignar ubicación en inventario/i })).toHaveAttribute('href', '/almacen/inventario?pendientes=1');
  });

  it('una transferencia interna pide el piso de origen y lo registra', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.click(screen.getByRole('checkbox', { name: /es transferencia interna/i }));
    await fillValidLine(user);

    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    expect(await screen.findByText('Indique el piso de origen.')).toBeInTheDocument();
    expect(api.registerEntryBatch).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText(/piso de origen/i), '1er piso');
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    expect(api.registerEntryBatch.mock.calls[0][0]).toMatchObject({
      source_type: 'TRANSFER_IN', internal_transfer: 'Desde 1er piso',
    });
  });

  it('"Registrar y agregar otro" conserva los datos generales y limpia los ítems', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await user.type(screen.getByLabelText(/^po \/ oc/i), 'OC-100');
    await fillValidLine(user);
    await user.click(screen.getByRole('button', { name: /registrar y agregar otro/i }));

    await waitFor(() => expect(api.registerEntryBatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(/cantidad ingresada/i)).toHaveValue(''));
    expect(screen.getByLabelText(/^po \/ oc/i)).toHaveValue('OC-100');
    expect(screen.getByRole('combobox', { name: /ítem 1/i })).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Ingreso registrado' })).not.toBeInTheDocument();
  });

  it('no envía dos veces si se pulsa de nuevo mientras se guarda', async () => {
    const user = userEvent.setup();
    let release;
    api.registerEntryBatch.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await fillValidLine(user);

    const submit = screen.getByRole('button', { name: /^registrar ingreso/i });
    await user.click(submit);
    await user.click(screen.getByRole('button', { name: /registrando/i }));
    expect(api.registerEntryBatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /registrando/i })).toHaveAttribute('aria-disabled', 'true');

    release({ data: GROUP });
    expect(await screen.findByRole('heading', { name: 'Ingreso registrado' })).toBeInTheDocument();
  });

  it('muestra el mensaje del servidor si falla', async () => {
    const user = userEvent.setup();
    api.registerEntryBatch.mockRejectedValue({ response: { status: 400, data: { detail: 'La cantidad de EA debe ser un número entero.' } } });
    renderWithProviders(<EntradaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    await fillValidLine(user);
    await user.click(screen.getByRole('button', { name: /^registrar ingreso/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La cantidad de EA debe ser un número entero.');
    expect(screen.queryByRole('heading', { name: 'Ingreso registrado' })).not.toBeInTheDocument();
  });
});

describe('EntradaPage — estados del catálogo', () => {
  it('muestra el error de carga y permite reintentar', async () => {
    const user = userEvent.setup();
    api.getInventory.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<EntradaPage />);
    expect(await screen.findByText('No se pudo cargar el catálogo de ítems.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByRole('combobox', { name: /ítem 1/i })).toBeInTheDocument();
  });

  it('precarga el ítem cuando llega desde el kardex (?item=)', async () => {
    renderWithProviders(<EntradaPage />, { route: '/almacen/entrada?item=1' });
    const combo = await screen.findByRole('combobox', { name: /ítem 1/i });
    expect(combo).toHaveValue('EPP000001 — Casco blanco');
  });
});
