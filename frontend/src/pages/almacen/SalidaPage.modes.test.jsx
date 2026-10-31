import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { exactItem, makeItem } from '../../test/almacenFixtures';
import { addDaysISO, localISODate } from '../../utils/almacen';
import SalidaPage from './SalidaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · QA ronda 2 — egresos que no son entregas de EPP (proyecto, departamento, ajuste), fechas atrasadas,
// stock en cero y el resultado con uno o varios ítems.

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 5 }),
  exactItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', unit: 'PAR', total_stock: 0, stocks: [] }),
  exactItem({ id: 3, product_code: 'EPP000003', description: 'Lentes claros', unit: 'EA', total_stock: 9 }),
];
const GROUP = { id: 9, group_number: 'SAL-2026-G0007', movements: [{ id: 90 }] };

const pick = async (user, n, name) => {
  await user.click(screen.getByRole('combobox', { name: new RegExp(`ítem ${n}`, 'i') }));
  await user.click(await screen.findByRole('option', { name }));
};

const ready = () => screen.findByRole('combobox', { name: /ítem 1/i });

async function chooseMode(user, name) {
  await ready();
  await user.click(screen.getByRole('radio', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.getMovements.mockResolvedValue({ data: { results: [] } });
  api.registerExitBatch.mockResolvedValue({ data: GROUP });
  api.registerEppDelivery.mockResolvedValue({ data: GROUP });
});

describe('SalidaPage — ajuste', () => {
  it('pide el «motivo del ajuste» (no el destino) y no envía sin él', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await chooseMode(user, /^ajuste$/i);
    expect(screen.getByLabelText(/motivo del ajuste/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^destino/i)).not.toBeInTheDocument();

    await pick(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    expect(await screen.findByText('Indique el motivo del ajuste.')).toBeInTheDocument();
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });

  it('con el motivo registra una salida de tipo ADJUSTMENT', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await chooseMode(user, /^ajuste$/i);
    await user.type(screen.getByLabelText(/motivo del ajuste/i), 'Inventario físico: merma');
    await pick(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
    expect(api.registerExitBatch.mock.calls[0][0]).toMatchObject({
      destination_type: 'ADJUSTMENT', destination_detail: 'Inventario físico: merma',
    });
  });
});

describe('SalidaPage — vale repetido en un egreso a proyecto', () => {
  it('«Registrar de todos modos» reenvía por la salida por lotes con allow_duplicate_voucher', async () => {
    const user = userEvent.setup();
    api.registerExitBatch
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Ya existe un egreso con ese N° de vale en este almacén.', code: 'voucher_number_exists' } } })
      .mockResolvedValueOnce({ data: GROUP });
    renderWithProviders(<SalidaPage />);
    await chooseMode(user, /proyecto \/ obra/i);
    await user.type(screen.getByLabelText(/^destino/i), 'Proyecto Arequipa');
    await user.type(screen.getByLabelText(/n° de vale \(físico\)/i), '0456');
    await pick(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));

    await user.click(await screen.findByRole('button', { name: /registrar de todos modos/i }));
    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(2));
    expect(api.registerExitBatch.mock.calls[0][0]).not.toHaveProperty('allow_duplicate_voucher');
    expect(api.registerExitBatch.mock.calls[1][0]).toMatchObject({ voucher_number: '0456', allow_duplicate_voucher: true });
    expect(await screen.findByRole('heading', { name: 'Egreso registrado' })).toBeInTheDocument();
  });

  it('«Solicitado por» y la observación se juntan en las notas del egreso', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await chooseMode(user, /departamento/i);
    await user.type(screen.getByLabelText(/^destino/i), 'Administración');
    await user.type(screen.getByLabelText(/solicitado por/i), 'Persona Ficticia');
    await user.type(screen.getByLabelText(/^observación/i), 'Urgente');
    await pick(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
    expect(api.registerExitBatch.mock.calls[0][0]).toMatchObject({
      destination_type: 'DEPARTMENT', notes: 'Solicitado por: Persona Ficticia. Urgente',
    });
  });
});

describe('SalidaPage — fecha atrasada y stock en cero', () => {
  it('una fecha de hace más de 7 días avisa sin bloquear el envío', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await chooseMode(user, /proyecto \/ obra/i);
    fireEvent.change(screen.getByLabelText(/^fecha/i), { target: { value: addDaysISO(localISODate(), -10) } });
    expect(await screen.findByText('La fecha es anterior a 7 días. Verifique antes de guardar.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^destino/i), 'Proyecto Arequipa');
    await pick(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
  });

  it('un ítem sin existencias muestra «Disponible: 0» y la cantidad no se puede registrar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await chooseMode(user, /proyecto \/ obra/i);
    await user.type(screen.getByLabelText(/^destino/i), 'Proyecto Arequipa');
    await pick(user, 1, /guantes de cuero/i).catch(() => {});
    // el combobox no deja elegir un ítem sin stock: el campo queda sin selección y no hay envío posible
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    expect(await screen.findByText('Seleccione un ítem.')).toBeInTheDocument();
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });

  it('muestra cuánto hay disponible del ítem elegido', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await chooseMode(user, /proyecto \/ obra/i);
    await pick(user, 1, /casco blanco/i);
    expect(screen.getByText(/disponible:/i)).toHaveTextContent('Disponible: 5 EA');
  });
});

describe('SalidaPage — resultado', () => {
  async function registerLines(user, count) {
    await chooseMode(user, /proyecto \/ obra/i);
    await user.type(screen.getByLabelText(/^destino/i), 'Proyecto Arequipa');
    await pick(user, 1, /casco blanco/i);
    await user.type(screen.getAllByLabelText(/^cantidad/i)[0], '1');
    if (count === 2) {
      await user.click(screen.getByRole('button', { name: /agregar ítem/i }));
      await pick(user, 2, /lentes claros/i);
      await user.type(screen.getAllByLabelText(/^cantidad/i)[1], '1');
    }
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
  }

  it('con un ítem usa el singular y ofrece imprimir el vale', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await registerLines(user, 1);
    expect(await screen.findByText(/^1 ítem\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /imprimir vale/i })).toBeInTheDocument();
  });

  it('con varios ítems usa el plural', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await registerLines(user, 2);
    expect(await screen.findByText(/^2 ítems\./)).toBeInTheDocument();
  });

  it('si el servidor no devuelve número de vale ni movimientos no ofrece imprimir un vale que no existe', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockResolvedValue({ data: {} });
    renderWithProviders(<SalidaPage />);
    await registerLines(user, 1);
    expect(await screen.findByRole('heading', { name: 'Egreso registrado' })).toBeInTheDocument();
    expect(document.querySelector('strong.font-mono')).toBeNull();                      // sin número que mostrar
    expect(screen.queryByRole('button', { name: /imprimir vale/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /descargar pdf/i })).not.toBeInTheDocument();
  });

  /**
   * DEFECTO QA-34 (menor): el aviso emergente se arma con `` `Egreso registrado. Vale interno ${groupNumber}`.trim() ``;
   * si el servidor no manda `group_number`, el `trim()` no quita la etiqueta y el usuario lee «Egreso registrado.
   * Vale interno» con la frase cortada. (Ingreso y Transferencia repiten el patrón.)
   */
  it('DEFECTO QA-34: sin número de vale el aviso no deja la etiqueta «Vale interno» colgando', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockResolvedValue({ data: {} });
    renderWithProviders(<SalidaPage />);
    await registerLines(user, 1);
    await screen.findByRole('heading', { name: 'Egreso registrado' });
    const toast = await screen.findAllByText(/^egreso registrado/i);
    expect(toast.some((node) => /vale interno\s*$/i.test(node.textContent))).toBe(false);
  });

  it('el aviso del egreso incluye el vale interno cuando el servidor lo envía', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await registerLines(user, 1);
    expect(await screen.findByText('Egreso registrado. Vale interno SAL-2026-G0007')).toBeInTheDocument();
  });

  it('«Registrar otro egreso» vuelve al formulario vacío', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await registerLines(user, 1);
    await user.click(await screen.findByRole('button', { name: /registrar otro egreso/i }));
    expect(await screen.findByRole('combobox', { name: /ítem 1/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^cantidad/i)).toHaveValue('');
  });
});
