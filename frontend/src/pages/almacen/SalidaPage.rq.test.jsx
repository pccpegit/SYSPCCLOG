import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeItem } from '../../test/almacenFixtures';
import {
  ITEM_CASCO, ITEM_GUANTES, ITEM_LENTES, ITEM_TUBO, apiError, deliverablePage, deliverableRow, makePicking,
} from '../../test/pickingFixtures';
import { localISODate } from '../../utils/almacen';
import SalidaPage from './SalidaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';
import { downloadResponse } from '../../utils/download';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../utils/download', async (importOriginal) => ({ ...(await importOriginal()), downloadResponse: vi.fn() }));

// SYSPCC-041 — Salida vinculada a un RQ pendiente por entregar: se entrega lo pendiente del requerimiento
// (misma lógica que Picking), con almacén fijo en Central y guía generada por el servidor.

const RQ = deliverableRow();
const DELIVERY = {
  id: 3, dispatch_number: 'SAL-2026-G0009', dispatch_guide_number: 'GR-2026-000042',
  movement_group_id: 43, first_movement_id: 430,
};

const qty = (line) => screen.getByRole('textbox', { name: `Cantidad a entregar de la línea ${line}` });
const include = (line) => screen.getByRole('checkbox', { name: `Incluir la línea ${line}` });
const row = (id) => screen.getByTestId(`rq-line-${id}`);
const submitBtn = () => screen.getByRole('button', { name: /^registrar entrega del requerimiento$/i });

async function ready() {
  await screen.findByRole('combobox', { name: /ítem 1/i });
}

async function pickRq(user) {
  await ready();
  await user.click(screen.getByRole('combobox', { name: /rq pendiente por entregar/i }));
  await user.click(await screen.findByRole('option', { name: /RQ-2026-0007/ }));
  await screen.findByTestId('rq-line-11');
}

beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: [makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 3 })] });
  api.getMovements.mockResolvedValue({ data: { results: [] } });
  api.getDeliverableRequests.mockResolvedValue(deliverablePage([RQ]));
  api.getRqPicking.mockResolvedValue({ data: makePicking() });
  api.deliverRqItems.mockResolvedValue({ data: { delivery: DELIVERY, picking: makePicking() } });
});

describe('SalidaPage con RQ — carga de ítems pendientes', () => {
  it('al elegir un RQ carga su picking, fija el almacén central y oculta modo, destino y trabajador', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    // Antes de elegir: formulario normal.
    expect(screen.getByRole('group', { name: /tipo de egreso/i })).toBeInTheDocument();

    await pickRq(user);
    expect(api.getRqPicking).toHaveBeenCalledWith(7);
    expect(screen.getByRole('group', { name: /rq pendiente por entregar/i })).toHaveTextContent('RQ-2026-0007');

    expect(screen.queryByRole('group', { name: /tipo de egreso/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /trabajador/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^destino/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/solicitado por/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /ítem 1/i })).not.toBeInTheDocument(); // sin líneas libres

    const warehouse = screen.getByLabelText(/^almacén/i);
    expect(warehouse).toHaveValue('CENTRAL');
    expect(warehouse).toBeDisabled();
    expect(screen.getByText(/sale siempre del almacén central/i)).toBeInTheDocument();
  });

  it('las líneas entregables vienen marcadas con la cantidad sugerida y las bloqueadas explican por qué', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await pickRq(user);

    expect(include(1)).toBeChecked();
    expect(qty(1)).toHaveValue('6');
    expect(within(row(11)).getByText('Máximo 6 EA')).toBeInTheDocument();
    expect(include(2)).toBeChecked();
    expect(qty(2)).toHaveValue('5');

    expect(include(3)).toBeDisabled();
    expect(within(row(13)).getByText(/sin vincular al catálogo/i)).toBeInTheDocument();
    expect(include(4)).toBeDisabled();
    expect(within(row(14)).getByText(/sin stock disponible en almacén central/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Cantidad a entregar de la línea 3' })).not.toBeInTheDocument();
    expect(screen.getByText(/lo menor entre lo pendiente y el stock/i)).toBeInTheDocument();
  });

  it('la cantidad sugerida respeta el stock cuando es menor que lo pendiente', async () => {
    const user = userEvent.setup();
    const scarce = { ...ITEM_CASCO, remaining: '6.000', available_central: '2.000', max_deliverable: '2.000' };
    api.getRqPicking.mockResolvedValue({ data: makePicking({ items: [scarce, ITEM_GUANTES, ITEM_TUBO, ITEM_LENTES] }) });
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    expect(qty(1)).toHaveValue('2');
  });

  it('muestra «Cargando» y luego el error del picking sin ofrecer reintentar un estado que ya no sirve', async () => {
    const user = userEvent.setup();
    api.getRqPicking.mockRejectedValue(apiError(409, { code: 'INVALID_STATE' }));
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.click(screen.getByRole('combobox', { name: /rq pendiente por entregar/i }));
    await user.click(await screen.findByRole('option', { name: /RQ-2026-0007/ }));
    expect(await screen.findByText(/ya no está en la etapa de almacén/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(submitBtn()).toHaveAttribute('aria-disabled', 'true');

    // Quitar el RQ devuelve el formulario normal.
    await user.click(screen.getByRole('button', { name: 'Quitar requerimiento' }));
    expect(await screen.findByRole('combobox', { name: /ítem 1/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /tipo de egreso/i })).toBeInTheDocument();
  });

  it('un error de red al cargar el picking permite reintentar', async () => {
    const user = userEvent.setup();
    api.getRqPicking.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.click(screen.getByRole('combobox', { name: /rq pendiente por entregar/i }));
    await user.click(await screen.findByRole('option', { name: /RQ-2026-0007/ }));
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('rq-line-11')).toBeInTheDocument();
    expect(api.getRqPicking).toHaveBeenCalledTimes(2);
  });

  it('si el rol no puede entregar en ese estado queda en solo lectura', async () => {
    const user = userEvent.setup();
    api.getRqPicking.mockResolvedValue({ data: makePicking({ request: { can_deliver: false, deliver_roles: ['LOGISTICS_COORDINATOR'] } }) });
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    expect(screen.getByText(/solo lectura: registrar entregas en este estado corresponde a/i)).toBeInTheDocument();
    expect(submitBtn()).toHaveAttribute('aria-disabled', 'true');
    expect(include(1)).toBeDisabled();
    await user.click(submitBtn());
    expect(api.deliverRqItems).not.toHaveBeenCalled();
  });
});

describe('SalidaPage con RQ — validación en el cliente', () => {
  it('no deja entregar más de lo pendiente', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.clear(qty(1));
    await user.type(qty(1), '7');
    await user.click(submitBtn());

    expect(await within(row(11)).findByText('No puede superar lo pendiente: 6 EA.')).toBeInTheDocument();
    expect(qty(1)).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(qty(1)).toHaveFocus());
    expect(screen.getByText(/revise 1 campo marcado en rojo/i)).toBeInTheDocument();
    expect(api.deliverRqItems).not.toHaveBeenCalled();
  });

  it('no deja entregar más que el stock del Almacén Central', async () => {
    const user = userEvent.setup();
    const scarce = { ...ITEM_CASCO, remaining: '10.000', available_central: '3.000', max_deliverable: '3.000' };
    api.getRqPicking.mockResolvedValue({ data: makePicking({ items: [scarce, ITEM_GUANTES, ITEM_TUBO, ITEM_LENTES] }) });
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.clear(qty(1));
    await user.type(qty(1), '4');
    await user.click(submitBtn());
    expect(await within(row(11)).findByText('Stock insuficiente en Almacén Central. Disponible: 3 EA.')).toBeInTheDocument();
    expect(api.deliverRqItems).not.toHaveBeenCalled();
  });

  it('una línea marcada sin cantidad se rechaza y la desmarcada no se valida', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.clear(qty(1));
    await user.click(submitBtn());
    expect(await within(row(11)).findByText('Indique la cantidad a entregar.')).toBeInTheDocument();

    await user.click(include(1)); // desmarcar la línea con error
    expect(qty(1)).toBeDisabled();
    await user.click(submitBtn());
    await waitFor(() => expect(api.deliverRqItems).toHaveBeenCalledTimes(1));
    expect(api.deliverRqItems.mock.calls[0][1].lines).toEqual([{ request_item_id: 12, quantity: '5' }]);
  });

  it('sin ninguna línea marcada pide marcar al menos una', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.click(screen.getByRole('button', { name: 'Quitar todas' }));
    await user.click(submitBtn());
    expect(await screen.findByText('Marque al menos una línea con cantidad para entregar.')).toBeInTheDocument();
    expect(api.deliverRqItems).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Completar con lo sugerido' }));
    expect(include(1)).toBeChecked();
    expect(qty(2)).toHaveValue('5');
  });

  it('una fecha futura se rechaza', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    fireEvent.change(screen.getByLabelText(/^fecha/i), { target: { value: '2999-01-01' } });
    await user.click(submitBtn());
    expect(await screen.findByText('La fecha no puede ser futura.')).toBeInTheDocument();
    expect(api.deliverRqItems).not.toHaveBeenCalled();
  });
});

describe('SalidaPage con RQ — registro y confirmación', () => {
  it('envía al endpoint de entrega del RQ solo las líneas incluidas, sin guía ni vale', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.click(include(2)); // sin los guantes
    await user.clear(qty(1));
    await user.type(qty(1), '3');
    await user.type(screen.getByLabelText(/^observación/i), 'Retira el supervisor');
    await user.click(submitBtn());

    await waitFor(() => expect(api.deliverRqItems).toHaveBeenCalledTimes(1));
    expect(api.deliverRqItems).toHaveBeenCalledWith(7, {
      lines: [{ request_item_id: 11, quantity: '3' }],
      movement_date: localISODate(),
      notes: 'Retira el supervisor',
    });
    expect(api.registerEppDelivery).not.toHaveBeenCalled();
    expect(api.registerExitBatch).not.toHaveBeenCalled();
  });

  it('muestra la guía generada con el vale interno, el PDF y el enlace al picking', async () => {
    const user = userEvent.setup();
    api.downloadGroupPdf.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    downloadResponse.mockResolvedValue('GR-2026-000042.pdf');
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.click(submitBtn());

    expect(await screen.findByRole('heading', { name: 'Entrega registrada' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Guía generada' })).toHaveTextContent('GR-2026-000042');
    expect(screen.getByText('SAL-2026-G0009')).toBeInTheDocument();
    expect(screen.getByText(/2 ítems del requerimiento/)).toHaveTextContent('RQ-2026-0007');
    expect(screen.getByText('Entrega registrada. Guía GR-2026-000042')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver el picking del requerimiento/i })).toHaveAttribute('href', '/almacen/pendientes/7/picking');
    expect(screen.getByRole('button', { name: /imprimir vale/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /descargar pdf/i }));
    await waitFor(() => expect(downloadResponse).toHaveBeenCalledTimes(1));
    expect(api.downloadGroupPdf).toHaveBeenCalledWith(43);
    expect(downloadResponse.mock.calls[0][1]).toBe('GR-2026-000042.pdf');

    await user.click(screen.getByRole('button', { name: /registrar otra entrega/i }));
    expect(await screen.findByRole('combobox', { name: /ítem 1/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /rq pendiente por entregar/i })).toHaveValue('');
  });

  it('no envía dos veces mientras se guarda', async () => {
    const user = userEvent.setup();
    let release;
    api.deliverRqItems.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.click(submitBtn());
    const busy = await screen.findByRole('button', { name: /registrando/i });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    await user.click(busy);
    expect(api.deliverRqItems).toHaveBeenCalledTimes(1);
    release({ data: { delivery: DELIVERY, picking: makePicking() } });
    expect(await screen.findByRole('heading', { name: 'Entrega registrada' })).toBeInTheDocument();
  });

  it('DELIVERY_LINES_INVALID marca la línea, recarga el picking y conserva lo tecleado', async () => {
    const user = userEvent.setup();
    api.deliverRqItems.mockRejectedValue(apiError(409, {
      detail: 'x', code: 'DELIVERY_LINES_INVALID',
      lines: [{ request_item_id: 11, line_number: 1, code: 'INSUFFICIENT_STOCK', message: 'Solo quedan 2 EA en Almacén Central.' }],
    }));
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.clear(qty(1));
    await user.type(qty(1), '5');
    await user.click(submitBtn());

    expect(await within(row(11)).findByText('Solo quedan 2 EA en Almacén Central.')).toBeInTheDocument();
    expect((await screen.findAllByText(/no se registró la entrega: hay 1 línea con problemas/i)).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.getRqPicking).toHaveBeenCalledTimes(2));
    expect(qty(1)).toHaveValue('5');
    expect(screen.queryByRole('heading', { name: 'Entrega registrada' })).not.toBeInTheDocument();
    expect(submitBtn()).toHaveAttribute('aria-disabled', 'false');
  });

  it('DUPLICATE_DELIVERY informa que ya se registró y recarga', async () => {
    const user = userEvent.setup();
    api.deliverRqItems.mockRejectedValue(apiError(409, {
      detail: 'Esta entrega ya se registró hace unos segundos. Revise el historial del requerimiento.', code: 'DUPLICATE_DELIVERY',
    }));
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.click(submitBtn());
    expect((await screen.findAllByText(/ya se registró hace unos segundos/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.getRqPicking).toHaveBeenCalledTimes(2));
  });

  it('INVALID_DATE fija la fecha mínima y marca el campo', async () => {
    const user = userEvent.setup();
    api.deliverRqItems.mockRejectedValue(apiError(400, {
      code: 'INVALID_DATE', detail: 'La fecha no puede ser anterior a la creación del requerimiento.', min_date: '2026-10-20',
    }));
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.click(submitBtn());
    expect((await screen.findAllByText('La fecha no puede ser anterior a la creación del requerimiento.')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^fecha/i)).toHaveAttribute('min', '2026-10-20');
    expect(screen.getByLabelText(/^fecha/i)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('SalidaPage — el RQ es opcional', () => {
  it('sin RQ el formulario sigue igual y aclara que el EPP no cambia el estado de ningún RQ', async () => {
    renderWithProviders(<SalidaPage />);
    await ready();
    expect(api.getRqPicking).not.toHaveBeenCalled();
    expect(api.getDeliverableRequests).not.toHaveBeenCalled();
    expect(screen.getByText(/las entregas de epp no cambian el estado de ningún rq/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /entrega a trabajador/i })).toBeChecked();
  });

  it('quitar el RQ devuelve el formulario libre con lo ya elegido (modo y fecha)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await ready();
    await user.click(screen.getByRole('radio', { name: /proyecto \/ obra/i }));
    await pickRq(user);
    await user.click(screen.getByRole('button', { name: 'Quitar requerimiento' }));
    expect(await screen.findByRole('radio', { name: /proyecto \/ obra/i })).toBeChecked();
    expect(screen.getByLabelText(/^almacén/i)).not.toBeDisabled();
    expect(screen.queryByTestId('rq-line-11')).not.toBeInTheDocument();
  });

  it('con RQ elegido «Limpiar formulario» pide confirmación y vuelve al estado inicial', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalidaPage />);
    await pickRq(user);
    await user.click(screen.getByRole('button', { name: /limpiar formulario/i }));
    const dialog = await screen.findByRole('dialog', { name: '¿Limpiar el formulario?' });
    await user.click(within(dialog).getByRole('button', { name: 'Limpiar formulario' }));
    expect(screen.queryByTestId('rq-line-11')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /rq pendiente por entregar/i })).toHaveValue('');
  });

  it('el Almacén de Obra no ve el selector: sus entregas de RQ salen del central', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<SalidaPage />);
    await ready();
    expect(screen.queryByRole('combobox', { name: /rq pendiente por entregar/i })).not.toBeInTheDocument();
    expect(api.getDeliverableRequests).not.toHaveBeenCalled();
  });
});
