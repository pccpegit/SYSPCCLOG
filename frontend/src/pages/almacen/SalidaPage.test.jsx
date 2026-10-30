import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { exactItem, makeItem } from '../../test/almacenFixtures';
import { localISODate } from '../../utils/almacen';
import SalidaPage from './SalidaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 3 }),
  exactItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', unit: 'PAR', total_stock: 20 }),
];

const GROUP = { id: 9, group_number: 'SAL-2026-G0004', movements: [{ id: 90 }] };
const WORKER = { id: 7, full_name: 'Apellido Prueba Siete', position: 'Operario', project_code: 'OP' };

const lineCombo = (n = 1) => screen.getByRole('combobox', { name: new RegExp(`ítem ${n}`, 'i') });

async function pickItem(user, n, name) {
  await user.click(lineCombo(n));
  await user.click(await screen.findByRole('option', { name }));
}

async function pickWorker(user) {
  await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Siete');
  await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));
}

async function ready() {
  await screen.findByRole('combobox', { name: /ítem 1/i });
}

const submitBtn = (name = /^registrar entrega$/i) => screen.getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: ITEMS });
  api.getMovements.mockResolvedValue({ data: { results: [] } });
  api.lookupPersonal.mockResolvedValue({ data: [WORKER] });
  api.registerEppDelivery.mockResolvedValue({ data: GROUP });
  api.registerExitBatch.mockResolvedValue({ data: GROUP });
});

describe('SalidaPage — entrega de EPP', () => {
  it('abre en "Entrega a trabajador" con fecha de hoy y aviso de vale faltante', async () => {
    renderWithProviders(<SalidaPage />);
    await ready();
    expect(screen.getByRole('radio', { name: /entrega a trabajador/i })).toBeChecked();
    expect(screen.getByLabelText(/^fecha/i)).toHaveValue(localISODate());
    expect(screen.getByLabelText(/n° de vale \(físico\)/i)).toBeInTheDocument();
    expect(screen.getByText(/el número impreso en el vale firmado/i)).toBeInTheDocument();
    expect(screen.getByText(/no indicó n° de vale\. la entrega se guardará como «sin vale»/i)).toBeInTheDocument();
  });

  it('con vale y trabajador de Personal usa la entrega de EPP del backend', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.type(screen.getByLabelText(/n° de vale \(físico\)/i), '0123');
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '2');
    await user.type(screen.getByLabelText(/^observación/i), 'Entrega de mostrador');
    await user.click(submitBtn());

    await waitFor(() => expect(api.registerEppDelivery).toHaveBeenCalledTimes(1));
    expect(api.registerEppDelivery).toHaveBeenCalledWith({
      warehouse: 'CENTRAL',
      movement_date: localISODate(),
      items: [{ inventory: 1, quantity: 2 }],
      voucher_number: '0123',
      recipient: { personal: 7 },
      notes: 'Entrega de mostrador',
    });
    expect(api.registerExitBatch).not.toHaveBeenCalled();

    expect(await screen.findByRole('heading', { name: 'Entrega registrada' })).toBeInTheDocument();
    expect(screen.getByText('SAL-2026-G0004')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /imprimir vale/i })).toBeInTheDocument();
    expect(screen.queryByText(/sin vale/i)).not.toBeInTheDocument();
  });

  it('sin vale se guarda como «Sin vale» (salida por lotes al empleado) y lo informa', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());

    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
    expect(api.registerExitBatch).toHaveBeenCalledWith({
      warehouse: 'CENTRAL',
      movement_date: localISODate(),
      items: [{ inventory: 1, quantity: 1 }],
      destination_type: 'EMPLOYEE',
      destination_detail: 'Apellido Prueba Siete',
      destination_personal: 7,
    });
    expect(api.registerEppDelivery).not.toHaveBeenCalled();
    expect(await screen.findByText(/se guardó como «sin vale»/i)).toBeInTheDocument();
  });

  it('un trabajador escrito a mano se guarda como texto (sin vínculo a Personal)', async () => {
    const user = userEvent.setup();
    api.lookupPersonal.mockResolvedValue({ data: [] });
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.type(screen.getByLabelText(/n° de vale \(físico\)/i), '55');
    await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Nombre Manual');
    await user.click(await screen.findByRole('option', { name: /escribir manualmente/i }));
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());

    await waitFor(() => expect(api.registerEppDelivery).toHaveBeenCalledTimes(1));
    expect(api.registerEppDelivery.mock.calls[0][0].recipient).toEqual({ name: 'Nombre Manual' });
  });

  it('exige el trabajador', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());
    expect(await screen.findByText('Seleccione o escriba el trabajador que recibe.')).toBeInTheDocument();
    expect(api.registerExitBatch).not.toHaveBeenCalled();
    expect(api.registerEppDelivery).not.toHaveBeenCalled();
  });

  it('muestra la última entrega del ítem al trabajador vinculado', async () => {
    const user = userEvent.setup();
    api.getMovements.mockResolvedValue({
      data: { results: [{ movement_date: '2026-10-05', quantity: 1, inventory_unit: 'EA' }] },
    });
    renderWithProviders(<SalidaPage />);
    await ready();
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    expect(await screen.findByText(/última entrega de este ítem al trabajador: 05\/10\/2026 \(1 EA\)/i)).toBeInTheDocument();
    expect(api.getMovements).toHaveBeenCalledWith(expect.objectContaining({ destination_personal: 7, movement_type: 'EXIT' }));
  });
});

describe('SalidaPage — stock y validaciones', () => {
  it('bloquea cuando la cantidad supera el stock disponible', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '5');

    expect(await screen.findByText('Stock insuficiente para EPP000001. Disponible: 3, solicitado: 5.')).toBeInTheDocument();
    expect(submitBtn()).toHaveAttribute('aria-disabled', 'true');
    await user.click(submitBtn());
    expect(api.registerExitBatch).not.toHaveBeenCalled();
    expect(api.registerEppDelivery).not.toHaveBeenCalled();
  });

  it('suma las cantidades de un mismo ítem repetido en varias líneas', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getAllByLabelText(/^cantidad/i)[0], '2');
    await user.click(screen.getByRole('button', { name: /agregar ítem/i }));
    await pickItem(user, 2, /casco blanco/i);
    await user.type(screen.getAllByLabelText(/^cantidad/i)[1], '2');

    expect((await screen.findAllByText('Stock insuficiente para EPP000001. Disponible: 3, solicitado: 4.')).length).toBeGreaterThan(0);
    expect(submitBtn()).toHaveAttribute('aria-disabled', 'true');
  });

  it('exige cantidad entera para unidades EA/PAR', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    await pickWorker(user);
    await pickItem(user, 1, /guantes de cuero/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1.5');
    await user.click(submitBtn());
    expect(await screen.findByText('La cantidad de PAR debe ser un número entero.')).toBeInTheDocument();
  });

  it('rechaza una fecha futura', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/^fecha/i), { target: { value: '2999-01-01' } });
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());
    expect(await screen.findByText('La fecha no puede ser futura.')).toBeInTheDocument();
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });
});

describe('SalidaPage — vale duplicado', () => {
  it('ofrece corregir o registrar de todos modos y reenvía con allow_duplicate_voucher', async () => {
    const user = userEvent.setup();
    api.registerEppDelivery
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Ya existe un egreso con ese N° de vale en este almacén.', code: 'voucher_number_exists' } } })
      .mockResolvedValueOnce({ data: GROUP });
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.type(screen.getByLabelText(/n° de vale \(físico\)/i), '0123');
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());

    expect(await screen.findByText('Ya existe un egreso con ese N° de vale en este almacén.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /registrar de todos modos/i }));

    await waitFor(() => expect(api.registerEppDelivery).toHaveBeenCalledTimes(2));
    expect(api.registerEppDelivery.mock.calls[1][0]).toMatchObject({ voucher_number: '0123', allow_duplicate_voucher: true });
    expect(await screen.findByRole('heading', { name: 'Entrega registrada' })).toBeInTheDocument();
  });
});

describe('SalidaPage — flujo de mostrador y otros tipos', () => {
  it('"Registrar y agregar otra entrega" conserva la fecha y limpia vale, trabajador y líneas', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/^fecha/i), { target: { value: localISODate() } });
    await user.type(screen.getByLabelText(/n° de vale \(físico\)/i), '0123');
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar y agregar otra entrega/i }));

    await waitFor(() => expect(api.registerEppDelivery).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(/n° de vale \(físico\)/i)).toHaveValue(''));
    expect(screen.getByLabelText(/^fecha/i)).toHaveValue(localISODate());
    expect(screen.getByRole('combobox', { name: /trabajador/i })).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Entrega registrada' })).not.toBeInTheDocument();
  });

  it('a un proyecto exige destino y registra la salida por lotes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.click(screen.getByRole('radio', { name: /proyecto \/ obra/i }));
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    expect(await screen.findByText('Ingrese el destino.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^destino/i), 'Proyecto Arequipa');
    await user.type(screen.getByLabelText(/solicitado por/i), 'Jefe de obra');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    await waitFor(() => expect(api.registerExitBatch).toHaveBeenCalledTimes(1));
    expect(api.registerExitBatch.mock.calls[0][0]).toMatchObject({
      destination_type: 'PROJECT', destination_detail: 'Proyecto Arequipa', notes: 'Solicitado por: Jefe de obra',
    });
  });

  it('no envía dos veces mientras se guarda', async () => {
    const user = userEvent.setup();
    let release;
    api.registerEppDelivery.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.type(screen.getByLabelText(/n° de vale \(físico\)/i), '1');
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());
    await user.click(screen.getByRole('button', { name: /registrando/i }));
    expect(api.registerEppDelivery).toHaveBeenCalledTimes(1);
    release({ data: GROUP });
    expect(await screen.findByRole('heading', { name: 'Entrega registrada' })).toBeInTheDocument();
  });
});

describe('SalidaPage — roles', () => {
  it('Almacén de Obra solo opera el almacén de obra', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    api.getInventory.mockResolvedValue({
      data: [makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', total_stock: 0, stocks: [{ id: 1, warehouse_type: 'SITE', project_id: null, department_id: null, quantity: 6 }] })],
    });
    renderWithProviders(<SalidaPage />);
    await ready();
    expect(screen.getByLabelText(/^almacén/i)).toHaveValue('SITE');
    expect(screen.getByLabelText(/^almacén/i)).toBeDisabled();

    await user.type(screen.getByLabelText(/n° de vale \(físico\)/i), '8');
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '2');
    await user.click(submitBtn());
    await waitFor(() => expect(api.registerEppDelivery).toHaveBeenCalledTimes(1));
    expect(api.registerEppDelivery.mock.calls[0][0].warehouse).toBe('SITE');
  });

  it('un rol de logística no ve la entrega de EPP y arranca en Proyecto / Obra', async () => {
    useAuth.mockReturnValue({ userRoles: ['LOGISTICS_COORDINATOR'] });
    renderWithProviders(<SalidaPage />);
    await ready();
    expect(screen.queryByRole('radio', { name: /entrega a trabajador/i })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /proyecto \/ obra/i })).toBeChecked();
  });
});

describe('SalidaPage — aviso de registro (concordancia y N° de vale interno)', () => {
  async function deliver(user) {
    await ready();
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());
  }

  it('la entrega dice «Entrega registrada» (femenino) con el vale interno, nunca «Entrega registrado»', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await deliver(user);
    expect(await screen.findByText('Entrega registrada. Vale interno SAL-2026-G0004')).toBeInTheDocument();
    expect(screen.queryByText(/entrega registrado/i)).not.toBeInTheDocument();
  });

  it('sin número de vale interno el aviso termina en punto, sin la etiqueta colgando', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockResolvedValue({ data: {} });
    renderWithProviders(<SalidaPage />);
    await deliver(user);
    expect(await screen.findByText('Entrega registrada.')).toBeInTheDocument();
  });

  it('el 409 de vale repetido habla de «egreso», igual que el resto de la pantalla', async () => {
    const user = userEvent.setup();
    api.registerEppDelivery.mockRejectedValueOnce({
      response: { status: 409, data: { detail: 'texto del servidor', code: 'voucher_number_exists' } },
    });
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.type(screen.getByLabelText(/n° de vale \(físico\)/i), '0123');
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());
    expect(await screen.findByText('Ya existe un egreso con ese N° de vale en este almacén.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /tipo de egreso/i })).toBeInTheDocument();
  });
});
