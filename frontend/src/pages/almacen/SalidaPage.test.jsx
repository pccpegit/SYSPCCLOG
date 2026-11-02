import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { exactItem, makeItem } from '../../test/almacenFixtures';
import { localISODate } from '../../utils/almacen';
import SalidaPage from './SalidaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';
import { downloadResponse } from '../../utils/download';

vi.mock('../../api/almacen');
vi.mock('../../utils/download', async (importOriginal) => ({ ...(await importOriginal()), downloadResponse: vi.fn() }));
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 3 }),
  exactItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', unit: 'PAR', total_stock: 20 }),
];

const GROUP = { id: 9, group_number: 'SAL-2026-G0004', internal_guide_number: 'GR-2026-000001', movements: [{ id: 90 }] };
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
  it('abre en "Entrega a trabajador" con fecha de hoy, sin pedir N° de vale ni avisar «Sin vale»', async () => {
    renderWithProviders(<SalidaPage />);
    await ready();
    expect(screen.getByRole('radio', { name: /entrega a trabajador/i })).toBeChecked();
    expect(screen.getByLabelText(/^fecha/i)).toHaveValue(localISODate());
    expect(screen.queryByLabelText(/n° de vale/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin vale/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/registrar de todos modos/i)).not.toBeInTheDocument();
    // En su lugar hay un selector opcional de RQ pendientes por entregar.
    expect(screen.getByRole('combobox', { name: /rq pendiente por entregar \(opcional\)/i })).toBeInTheDocument();
  });

  it('trabajador de Personal: usa la entrega de EPP (sin vale) y muestra la guía generada con su PDF', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
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
      recipient: { personal: 7 },
      notes: 'Entrega de mostrador',
    });
    expect(api.registerExitBatch).not.toHaveBeenCalled();
    expect(api.deliverRqItems).not.toHaveBeenCalled();

    expect(await screen.findByRole('heading', { name: 'Entrega registrada' })).toBeInTheDocument();
    const guide = screen.getByRole('group', { name: 'Guía generada' });
    expect(within(guide).getByText('N° de guía')).toBeInTheDocument();
    expect(within(guide).getByText('GR-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('SAL-2026-G0004')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /imprimir vale/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeInTheDocument();
    expect(screen.queryByText(/sin vale/i)).not.toBeInTheDocument();
  });

  it('«Descargar PDF» baja el PDF del grupo con el N° de guía como nombre', async () => {
    const user = userEvent.setup();
    api.downloadGroupPdf.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    downloadResponse.mockResolvedValue('GR-2026-000001.pdf');
    renderWithProviders(<SalidaPage />);
    await ready();
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());
    await user.click(await screen.findByRole('button', { name: /descargar pdf/i }));
    await waitFor(() => expect(downloadResponse).toHaveBeenCalledTimes(1));
    expect(api.downloadGroupPdf).toHaveBeenCalledWith(9);
    expect(downloadResponse.mock.calls[0][1]).toBe('GR-2026-000001.pdf');
  });

  it('un trabajador escrito a mano se guarda como texto (sin vínculo a Personal)', async () => {
    const user = userEvent.setup();
    api.lookupPersonal.mockResolvedValue({ data: [] });
    renderWithProviders(<SalidaPage />);
    await ready();
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

describe('SalidaPage — flujo de mostrador y otros tipos', () => {
  it('"Registrar y agregar otra entrega" conserva la fecha y limpia trabajador y líneas', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/^fecha/i), { target: { value: localISODate() } });
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar y agregar otra entrega/i }));

    await waitFor(() => expect(api.registerEppDelivery).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /trabajador/i })).toHaveValue(''));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /trabajador/i })).toHaveFocus());
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

describe('SalidaPage — aviso de registro (concordancia y guía automática)', () => {
  async function deliver(user) {
    await ready();
    await pickWorker(user);
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(submitBtn());
  }

  it('la entrega dice «Entrega registrada» (femenino) con la guía generada, nunca «Entrega registrado»', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await deliver(user);
    expect(await screen.findByText('Entrega registrada. Guía GR-2026-000001')).toBeInTheDocument();
    expect(screen.queryByText(/entrega registrado/i)).not.toBeInTheDocument();
  });

  it('un servidor antiguo sin guía: el aviso cae al vale interno', async () => {
    const user = userEvent.setup();
    api.registerEppDelivery.mockResolvedValue({ data: { id: 9, group_number: 'SAL-2026-G0004', movements: [{ id: 90 }] } });
    renderWithProviders(<SalidaPage />);
    await deliver(user);
    expect(await screen.findByText('Entrega registrada. Vale interno SAL-2026-G0004')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Guía generada' })).not.toBeInTheDocument();
  });

  it('sin guía ni vale interno el aviso termina en punto, sin etiquetas colgando', async () => {
    const user = userEvent.setup();
    api.registerEppDelivery.mockResolvedValue({ data: {} });
    renderWithProviders(<SalidaPage />);
    await deliver(user);
    expect(await screen.findByText('Entrega registrada.')).toBeInTheDocument();
  });

  it('si el servidor rechaza el registro muestra el mensaje y deja reintentar', async () => {
    const user = userEvent.setup();
    api.registerEppDelivery.mockRejectedValueOnce({
      response: { status: 409, data: { detail: 'Stock insuficiente para EPP000001.' } },
    });
    renderWithProviders(<SalidaPage />);
    await deliver(user);
    expect((await screen.findAllByText('Stock insuficiente para EPP000001.')).length).toBeGreaterThan(0);
    expect(screen.getByText('No se registró la entrega.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /tipo de egreso/i })).toBeInTheDocument();
    expect(submitBtn()).toHaveAttribute('aria-disabled', 'false');
  });

  it('DUPLICATE_EXIT: avisa que la salida ya se registró, ofrece ver los movimientos y NO reintenta solo', async () => {
    const user = userEvent.setup();
    api.registerEppDelivery.mockRejectedValue({
      response: { status: 409, data: { code: 'DUPLICATE_EXIT', detail: 'texto del servidor' } },
    });
    renderWithProviders(<SalidaPage />);
    await deliver(user);

    expect((await screen.findAllByText(/esta salida ya se registró hace unos segundos/i)).length).toBeGreaterThan(0);
    expect(screen.getByText('No se registró la entrega.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver movimientos recientes' })).toHaveAttribute('href', '/almacen/movimientos');
    expect(screen.queryByRole('heading', { name: 'Entrega registrada' })).not.toBeInTheDocument();
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    expect(api.registerEppDelivery).toHaveBeenCalledTimes(1);          // sin reintento automático
    expect(submitBtn()).toHaveAttribute('aria-disabled', 'false');     // el usuario decide
  });

  it('DUPLICATE_EXIT también aplica a una salida a proyecto', async () => {
    const user = userEvent.setup();
    api.registerExitBatch.mockRejectedValue({ response: { status: 409, data: { code: 'DUPLICATE_EXIT' } } });
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.click(screen.getByRole('radio', { name: /proyecto \/ obra/i }));
    await user.type(screen.getByLabelText(/^destino/i), 'Proyecto Arequipa');
    await pickItem(user, 1, /casco blanco/i);
    await user.type(screen.getByLabelText(/^cantidad/i), '1');
    await user.click(screen.getByRole('button', { name: /registrar egreso/i }));
    expect(await screen.findByRole('link', { name: 'Ver movimientos recientes' })).toBeInTheDocument();
    expect(screen.getByText('No se registró el egreso.')).toBeInTheDocument();
  });

  it('el aviso de duplicado desaparece al volver a intentar con éxito', async () => {
    const user = userEvent.setup();
    api.registerEppDelivery
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'DUPLICATE_EXIT' } } })
      .mockResolvedValueOnce({ data: GROUP });
    renderWithProviders(<SalidaPage />);
    await deliver(user);
    await screen.findByRole('link', { name: 'Ver movimientos recientes' });
    await user.click(submitBtn());
    expect(await screen.findByRole('heading', { name: 'Entrega registrada' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ver movimientos recientes' })).not.toBeInTheDocument();
  });

  it('429 (límite de salidas): pide esperar un minuto, sin enlace de duplicado', async () => {
    const user = userEvent.setup();
    api.registerEppDelivery.mockRejectedValue({ response: { status: 429, data: { detail: 'Request was throttled.' } } });
    renderWithProviders(<SalidaPage />);
    await deliver(user);
    expect((await screen.findAllByText('Se registraron demasiadas salidas seguidas. Espere un minuto e intente de nuevo.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/request was throttled/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ver movimientos recientes' })).not.toBeInTheDocument();
  });
});
