import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import {
  DELIVERY_1, ITEM_CASCO, ITEM_GUANTES, ITEM_LENTES, ITEM_TUBO, apiError, makePicking,
} from '../../test/pickingFixtures';
import { localISODate } from '../../utils/almacen';
import PickingPage from './PickingPage';
import * as almacen from '../../api/almacen';

vi.mock('../../api/almacen');

const renderPage = () => renderWithProviders(
  <Routes>
    <Route path="/almacen/pendientes/:id/picking" element={<PickingPage />} />
  </Routes>,
  { route: '/almacen/pendientes/7/picking' },
);

const row = (id) => screen.getByTestId(`picking-row-${id}`);
const qtyInput = (line) => screen.getByRole('textbox', { name: `Cantidad a entregar de la línea ${line}` });

/** Cambia un <input type=date> (userEvent.type no escribe fechas en jsdom). */
const fireDate = (input, value) => fireEvent.change(input, { target: { value } });

const REVERSAL = {
  id: 2, dispatch_number: 'DSP-0002', dispatch_guide_number: 'GR-100', movement_date: '2026-10-21',
  dispatched_at: '2026-10-21T09:00:00-05:00', dispatched_by: 'Rosa Prueba Uno', is_reversal: true,
  reverses: 1, reversed_by: null, notes: '', can_reverse: false,
  lines: [{ request_item_id: 11, line_number: 1, description: 'Casco de seguridad blanco', quantity: '4.000' }],
};

beforeEach(() => {
  vi.resetAllMocks();
  almacen.getRqPicking.mockResolvedValue({ data: makePicking() });
});

describe('PickingPage — lista de picking', () => {
  it('muestra el resumen, las líneas, la ubicación y el stock', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: /Picking y entrega · RQ-2026-0007/ })).toBeInTheDocument();
    expect(almacen.getRqPicking).toHaveBeenCalledWith('7');

    const resumen = screen.getByRole('region', { name: 'Resumen del picking' });
    expect(within(resumen).getByText('Completos').previousElementSibling).toHaveTextContent('0');
    expect(within(resumen).getByText('Parciales').previousElementSibling).toHaveTextContent('1');
    expect(within(resumen).getByText('Pendientes').previousElementSibling).toHaveTextContent('3');
    expect(within(resumen).getByText('Bloqueados').previousElementSibling).toHaveTextContent('2');

    const casco = within(row(11));
    expect(casco.getByText('Casco de seguridad blanco')).toBeInTheDocument();
    expect(casco.getByText('B3-2')).toBeInTheDocument();
    expect(casco.getByText('20 EA')).toBeInTheDocument(); // disponible
    expect(casco.getByText('Parcial')).toBeInTheDocument();
    expect(casco.getByText('Máximo 6 EA')).toBeInTheDocument();

    expect(within(row(12)).getByText('Piso 1 — pendiente de ubicar')).toBeInTheDocument();
  });

  it('explica con palabras por qué una línea está bloqueada', async () => {
    renderPage();
    await screen.findByTestId('picking-row-13');
    expect(within(row(13)).getByText(/Sin vincular al catálogo: Logística debe asociarlo/)).toBeInTheDocument();
    expect(within(row(13)).getByText('Sin vincular')).toBeInTheDocument();
    expect(within(row(14)).getByText('Sin stock disponible en Almacén Central.')).toBeInTheDocument();
    // Las bloqueadas no tienen campo de cantidad.
    expect(screen.queryByRole('textbox', { name: 'Cantidad a entregar de la línea 3' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Cantidad a entregar de la línea 4' })).not.toBeInTheDocument();
  });

  it('muestra un estado de carga y luego la pantalla', async () => {
    let resolve;
    almacen.getRqPicking.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando la lista de picking…');
    resolve({ data: makePicking() });
    expect(await screen.findByTestId('picking-row-11')).toBeInTheDocument();
  });

  it('muestra el error de carga y permite reintentar', async () => {
    almacen.getRqPicking.mockRejectedValueOnce(apiError(500, { detail: 'boom' }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el picking del requerimiento. Intente de nuevo.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('picking-row-11')).toBeInTheDocument();
  });

  it('un RQ fuera de la etapa de almacén explica el motivo y no ofrece reintentar', async () => {
    almacen.getRqPicking.mockRejectedValue(apiError(409, { detail: 'x', code: 'INVALID_STATE' }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('ya no está en la etapa de almacén');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Volver a pendientes/ })).toHaveAttribute('href', '/almacen/pendientes');
  });

  it('sin permiso para entregar es de solo lectura: sin formulario ni campos', async () => {
    almacen.getRqPicking.mockResolvedValue({ data: makePicking({ request: { can_deliver: false, deliver_roles: ['CENTRAL_WAREHOUSE'] } }) });
    renderPage();
    expect(await screen.findByText(/Solo lectura: registrar entregas en este estado corresponde a Almacén Central/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar entrega' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Cantidad a entregar/ })).not.toBeInTheDocument();
    // El historial sigue visible.
    expect(screen.getByText('DSP-0001')).toBeInTheDocument();
  });

  it('un RQ que ya no admite entregas solo muestra la consulta', async () => {
    almacen.getRqPicking.mockResolvedValue({ data: makePicking({ request: { status: 'DELIVERED', deliverable_state: false } }) });
    renderPage();
    expect(await screen.findByText(/ya no admite nuevas entregas/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar entrega' })).not.toBeInTheDocument();
  });
});

describe('PickingPage — entrega parcial', () => {
  it('registra una tanda, muestra el picking devuelto y limpia el formulario', async () => {
    const after = makePicking({
      items: [{ ...ITEM_CASCO, delivered: '7.000', remaining: '3.000', max_deliverable: '3.000' }, ITEM_GUANTES, ITEM_TUBO, ITEM_LENTES],
      deliveries: [DELIVERY_1, { ...DELIVERY_1, id: 3, dispatch_number: 'DSP-0003', dispatch_guide_number: 'GR-200', notes: '', can_reverse: true }],
    });
    almacen.deliverRqItems.mockResolvedValue({ data: { delivery: { id: 3, dispatch_number: 'DSP-0003' }, picking: after } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');

    await user.type(qtyInput(1), '3');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-200');
    await user.type(screen.getByLabelText('Notas'), 'Segunda tanda');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));

    await waitFor(() => expect(almacen.deliverRqItems).toHaveBeenCalledTimes(1));
    expect(almacen.deliverRqItems).toHaveBeenCalledWith('7', {
      lines: [{ request_item_id: 11, quantity: '3' }],
      dispatch_guide_number: 'GR-200',
      movement_date: localISODate(),
      notes: 'Segunda tanda',
    });
    // Usa el picking devuelto (sin pedirlo otra vez) y limpia el formulario.
    expect(await within(row(11)).findByText('Máximo 3 EA')).toBeInTheDocument();
    expect(almacen.getRqPicking).toHaveBeenCalledTimes(1);
    expect(qtyInput(1)).toHaveValue('');
    expect(screen.getByLabelText(/Guía de remisión/)).toHaveValue('');
    expect(screen.getAllByText('Entrega DSP-0003 registrada con la guía GR-200.')).toHaveLength(2); // aviso visible + región viva
    expect(document.body.querySelector('[aria-live="polite"].sr-only')).toHaveTextContent('Entrega DSP-0003 registrada');
    expect(screen.getByText('DSP-0003')).toBeInTheDocument();
  });

  it('solo envía las líneas con cantidad (la coma decimal se normaliza)', async () => {
    almacen.deliverRqItems.mockResolvedValue({ data: { delivery: { id: 3, dispatch_number: 'DSP-0003' }, picking: makePicking() } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-12');
    await user.type(qtyInput(2), '2');
    await user.type(qtyInput(1), '0');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-9');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    await waitFor(() => expect(almacen.deliverRqItems).toHaveBeenCalled());
    expect(almacen.deliverRqItems.mock.calls[0][1].lines).toEqual([{ request_item_id: 12, quantity: '2' }]);
  });

  it('«Completar con lo disponible» llena el máximo de cada línea entregable', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.click(screen.getByRole('button', { name: 'Completar con lo disponible' }));
    expect(qtyInput(1)).toHaveValue('6');
    expect(qtyInput(2)).toHaveValue('5');
    await user.click(screen.getByRole('button', { name: 'Borrar cantidades' }));
    expect(qtyInput(1)).toHaveValue('');
  });

  it('exige la guía y al menos una línea, y enfoca el primer campo inválido', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');

    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect((await screen.findAllByText('Indique la cantidad a entregar en al menos una línea y revise los datos marcados.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Indique el número de la guía de remisión.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/Guía de remisión/)).toHaveFocus());
    expect(almacen.deliverRqItems).not.toHaveBeenCalled();
  });

  it('sin ninguna cantidad pero con guía pide una cantidad y enfoca el primer campo', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-1');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect((await screen.findAllByText('Indique la cantidad a entregar en al menos una línea.')).length).toBeGreaterThan(0);
    await waitFor(() => expect(qtyInput(1)).toHaveFocus());
    expect(almacen.deliverRqItems).not.toHaveBeenCalled();
  });

  it('marca la línea que supera el máximo y no llama a la API', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '9');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-1');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));

    expect(await within(row(11)).findByText('No puede superar 6 EA.')).toBeInTheDocument();
    expect(qtyInput(1)).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(qtyInput(1)).toHaveFocus());
    expect(almacen.deliverRqItems).not.toHaveBeenCalled();
    // Al corregir, el error de esa línea desaparece.
    await user.clear(qtyInput(1));
    await user.type(qtyInput(1), '6');
    expect(within(row(11)).queryByText('No puede superar 6 EA.')).not.toBeInTheDocument();
  });

  it('rechaza decimales en unidades enteras y más de 3 decimales', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1.5');
    await user.type(qtyInput(2), '1.2345');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-1');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(await within(row(11)).findByText('La cantidad de EA debe ser un número entero.')).toBeInTheDocument();
    expect(within(row(12)).getByText(/entero|decimales/)).toBeInTheDocument();
    expect(almacen.deliverRqItems).not.toHaveBeenCalled();
  });

  it('DELIVERY_LINES_INVALID resalta las filas con el mensaje del servidor y recarga el picking', async () => {
    almacen.deliverRqItems.mockRejectedValue(apiError(409, {
      detail: 'Líneas inválidas.', code: 'DELIVERY_LINES_INVALID',
      lines: [
        { request_item_id: 11, line_number: 1, code: 'INSUFFICIENT_STOCK', message: 'Solo quedan 2 EA en Almacén Central.', available: '2.000' },
        { request_item_id: 12, line_number: 2, code: 'EXCEEDS_REMAINING', message: 'Ya se entregó casi todo.', remaining: '1.000' },
      ],
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '5');
    await user.type(qtyInput(2), '5');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));

    expect(await within(row(11)).findByText('Solo quedan 2 EA en Almacén Central.')).toBeInTheDocument();
    expect(within(row(12)).getByText('Ya se entregó casi todo.')).toBeInTheDocument();
    expect(row(11)).toHaveClass('bg-red-50');
    expect(screen.getAllByText(/No se registró la entrega: hay 2 líneas con problemas/).length).toBeGreaterThan(0);
    expect(qtyInput(1)).toHaveAttribute('aria-invalid', 'true');
    expect(qtyInput(1)).toHaveAccessibleDescription(/Solo quedan 2 EA/);
    await waitFor(() => expect(qtyInput(1)).toHaveFocus());
    // El stock pudo cambiar: se vuelve a pedir el picking, y lo tecleado se conserva.
    await waitFor(() => expect(almacen.getRqPicking).toHaveBeenCalledTimes(2));
    expect(qtyInput(1)).toHaveValue('5');
    expect(screen.getByLabelText(/Guía de remisión/)).toHaveValue('GR-7');
  });

  it('usa un mensaje propio si la línea inválida llega sin texto', async () => {
    almacen.deliverRqItems.mockRejectedValue(apiError(409, {
      detail: 'x', code: 'DELIVERY_LINES_INVALID', lines: [{ request_item_id: 11, line_number: 1, code: 'ITEM_OFF_CATALOG' }],
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(await within(row(11)).findByText('La línea está fuera de catálogo y no se entrega desde el almacén.')).toBeInTheDocument();
    expect(screen.getAllByText(/hay 1 línea con problemas/).length).toBeGreaterThan(0);
  });

  it('DUPLICATE_GUIDE se muestra en el campo de la guía', async () => {
    almacen.deliverRqItems.mockRejectedValue(apiError(409, {
      detail: 'Ya existe una entrega vigente con la guía GR-7.', code: 'DUPLICATE_GUIDE',
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1');
    const guide = screen.getByLabelText(/Guía de remisión/);
    await user.type(guide, 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    await waitFor(() => expect(guide).toHaveAttribute('aria-invalid', 'true'));
    expect(guide).toHaveAccessibleDescription(/Ya existe una entrega vigente con la guía GR-7/);
    await waitFor(() => expect(guide).toHaveFocus());
  });

  it('un error de validación del servidor se asigna a su campo', async () => {
    almacen.deliverRqItems.mockRejectedValue(apiError(400, {
      error: true, status_code: 400, code: 'invalid', detail: { notes: ['Asegúrese de que este campo no tenga más de 300 caracteres.'] },
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(await screen.findByText('Asegúrese de que este campo no tenga más de 300 caracteres.')).toBeInTheDocument();
    expect(screen.getByLabelText('Notas')).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    [403, { detail: 'Su rol no puede registrar entregas en este estado. Rol requerido: Almacén Central.', code: 'ROLE_NOT_ALLOWED', required_roles: ['CENTRAL_WAREHOUSE'] }, 'Su rol no puede registrar entregas en este estado. Rol requerido: Almacén Central.'],
    [409, { error: true, status_code: 409, detail: 'La entrega ya no se puede anular en este estado; corrígelo con el ciclo de reclamo.', code: 'RQ_NOT_REVERSIBLE_STATE', status: 'DELIVERED', allowed_statuses: ['IN_STOCK', 'QUALITY_APPROVED'] }, 'La entrega ya no se puede anular en este estado; corrígelo con el ciclo de reclamo.'],
    [409, { error: true, status_code: 409, detail: 'No se pudo completar la operación por un conflicto de datos.', code: 'INTEGRITY_CONFLICT' }, 'No se pudo completar la operación por un conflicto de datos.'],
    [409, { code: 'INTEGRITY_CONFLICT' }, 'No se pudo guardar porque otro cambio se cruzó con este. Actualice la pantalla e intente de nuevo.'],
    [409, { code: 'INVALID_STATE' }, 'El requerimiento ya no está en una etapa que admita esta operación. Actualice la pantalla.'],
    [400, { detail: 'Línea ajena.', code: 'INVALID_ITEM', item_ids: [12] }, 'Línea ajena.'],
    [429, {}, 'Demasiadas solicitudes seguidas. Espere unos segundos e intente de nuevo.'],
  ])('error %s del servidor: muestra un mensaje en español', async (status, data, message) => {
    almacen.deliverRqItems.mockRejectedValue(apiError(status, data));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    // Tras el error el botón vuelve a estar disponible.
    expect(screen.getByRole('button', { name: 'Registrar entrega' })).not.toHaveAttribute('aria-disabled');
  });

  it('INVALID_ITEM resalta la línea ajena', async () => {
    almacen.deliverRqItems.mockRejectedValue(apiError(400, { detail: 'Línea ajena.', code: 'INVALID_ITEM', item_ids: [12] }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(2), '1');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(await within(row(12)).findByText('Esta línea no pertenece a este requerimiento.')).toBeInTheDocument();
  });

  it('sin respuesta del servidor avisa de la conexión', async () => {
    almacen.deliverRqItems.mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect((await screen.findAllByText(/No se pudo conectar con el servidor/)).length).toBeGreaterThan(0);
  });

  it('no envía dos veces con doble clic mientras la entrega está en curso', async () => {
    let resolve;
    almacen.deliverRqItems.mockReturnValue(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.dblClick(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(almacen.deliverRqItems).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Registrando…' })).toHaveAttribute('aria-disabled', 'true');
    resolve({ data: { delivery: { id: 3, dispatch_number: 'DSP-0003' }, picking: makePicking() } });
    expect((await screen.findAllByText(/Entrega DSP-0003 registrada/)).length).toBeGreaterThan(0);
  });

  it('Enter en una cantidad envía el formulario', async () => {
    almacen.deliverRqItems.mockResolvedValue({ data: { delivery: { id: 3, dispatch_number: 'DSP-0003' }, picking: makePicking() } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.type(qtyInput(1), '2{Enter}');
    await waitFor(() => expect(almacen.deliverRqItems).toHaveBeenCalledTimes(1));
  });

  it('la fecha de la entrega no admite días futuros', async () => {
    renderPage();
    await screen.findByTestId('picking-row-11');
    expect(screen.getByLabelText('Fecha de la entrega')).toHaveAttribute('max', localISODate());
  });
});

describe('PickingPage — historial y anulaciones', () => {
  const withReversal = () => makePicking({
    deliveries: [{ ...DELIVERY_1, reversed_by: 2, can_reverse: false }, REVERSAL],
    items: [{ ...ITEM_CASCO, delivered: '0.000', remaining: '10.000', max_deliverable: '10.000', status: 'PENDING' }, ITEM_GUANTES, ITEM_TUBO, ITEM_LENTES],
  });

  it('marca las anulaciones y las entregas anuladas, la más reciente primero', async () => {
    almacen.getRqPicking.mockResolvedValue({ data: withReversal() });
    renderPage();
    await screen.findByTestId('picking-row-11');
    const history = screen.getByRole('region', { hidden: false, name: 'Historial de entregas' });
    const items = within(history).getAllByRole('listitem').filter((li) => li.className.includes('rounded-2xl'));
    expect(items[0]).toHaveTextContent('DSP-0002');
    expect(items[0]).toHaveTextContent('Anulación de DSP-0001');
    expect(items[1]).toHaveTextContent('DSP-0001');
    expect(items[1]).toHaveTextContent('Anulada por DSP-0002');
    // Ninguna de las dos se puede volver a anular.
    expect(screen.queryByRole('button', { name: /Anular entrega DSP/ })).not.toBeInTheDocument();
    expect(items[0]).toHaveTextContent('21/10/2026');
  });

  it('sin entregas muestra el estado vacío', async () => {
    almacen.getRqPicking.mockResolvedValue({ data: makePicking({ deliveries: [] }) });
    renderPage();
    expect(await screen.findByText('Aún no se registró ninguna entrega')).toBeInTheDocument();
  });

  it('el botón de anular solo aparece en entregas con can_reverse', async () => {
    almacen.getRqPicking.mockResolvedValue({ data: makePicking({ deliveries: [{ ...DELIVERY_1, can_reverse: false }] }) });
    renderPage();
    await screen.findByText('DSP-0001');
    expect(screen.queryByRole('button', { name: /Anular entrega/ })).not.toBeInTheDocument();
  });

  it('anula con motivo obligatorio y actualiza el picking', async () => {
    almacen.reverseRqDelivery.mockResolvedValue({ data: { delivery: { id: 2, dispatch_number: 'DSP-0002' }, picking: withReversal() } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    await user.click(screen.getByRole('button', { name: 'Anular entrega DSP-0001' }));
    const dialog = await screen.findByRole('dialog', { name: 'Anular entrega DSP-0001' });
    const reason = within(dialog).getByLabelText(/Motivo de la anulación/);
    expect(reason).toHaveFocus();

    // Sin motivo no llama a la API.
    await user.click(within(dialog).getByRole('button', { name: 'Anular entrega' }));
    expect(await within(dialog).findByText('Indique el motivo (mínimo 5 caracteres).')).toBeInTheDocument();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(almacen.reverseRqDelivery).not.toHaveBeenCalled();

    await user.type(reason, 'Guía mal digitada');
    await user.click(within(dialog).getByRole('button', { name: 'Anular entrega' }));
    await waitFor(() => expect(almacen.reverseRqDelivery).toHaveBeenCalledTimes(1));
    expect(almacen.reverseRqDelivery).toHaveBeenCalledWith('7', 1, { reason: 'Guía mal digitada' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByText('Entrega anulada: se registró la anulación DSP-0002.').length).toBeGreaterThan(0);
    expect(await screen.findByText('Anulación de DSP-0001')).toBeInTheDocument();
    expect(almacen.getRqPicking).toHaveBeenCalledTimes(1);
    // El botón que abrió el diálogo desapareció: el foco va al historial.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Historial de entregas' })).toHaveFocus());
  });

  it('el motivo se valida con un mínimo de 5 caracteres', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    await user.click(screen.getByRole('button', { name: 'Anular entrega DSP-0001' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'ab');
    await user.click(within(dialog).getByRole('button', { name: 'Anular entrega' }));
    expect(await within(dialog).findByText('Indique el motivo (mínimo 5 caracteres).')).toBeInTheDocument();
    expect(almacen.reverseRqDelivery).not.toHaveBeenCalled();
  });

  it('un error de anulación se muestra en el diálogo y se puede reintentar', async () => {
    almacen.reverseRqDelivery.mockRejectedValueOnce(apiError(409, { detail: 'No se pudo revertir el stock.', code: 'REVERSE_FAILED' }));
    almacen.reverseRqDelivery.mockResolvedValueOnce({ data: { delivery: { id: 2, dispatch_number: 'DSP-0002' }, picking: withReversal() } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    await user.click(screen.getByRole('button', { name: 'Anular entrega DSP-0001' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'Error de conteo');
    const submit = within(dialog).getByRole('button', { name: 'Anular entrega' });
    await user.click(submit);
    expect((await within(dialog).findAllByText('No se pudo revertir el stock.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ALREADY_REVERSED cierra el diálogo y recarga el picking', async () => {
    almacen.reverseRqDelivery.mockRejectedValue(apiError(409, { detail: 'Esta entrega ya fue anulada.', code: 'ALREADY_REVERSED' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    await user.click(screen.getByRole('button', { name: 'Anular entrega DSP-0001' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'Error de conteo');
    await user.click(within(dialog).getByRole('button', { name: 'Anular entrega' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(almacen.getRqPicking).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Esta entrega ya fue anulada.')).toBeInTheDocument();
  });

  it('Escape y Cancelar cierran el diálogo sin llamar a la API', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    const opener = screen.getByRole('button', { name: 'Anular entrega DSP-0001' });
    await user.click(opener);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    await user.click(opener);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(almacen.reverseRqDelivery).not.toHaveBeenCalled();
  });

  it('no envía dos veces la anulación con doble clic', async () => {
    let resolve;
    almacen.reverseRqDelivery.mockReturnValue(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    await user.click(screen.getByRole('button', { name: 'Anular entrega DSP-0001' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'Error de conteo');
    await user.dblClick(within(dialog).getByRole('button', { name: 'Anular entrega' }));
    expect(almacen.reverseRqDelivery).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Anulando…' })).toHaveAttribute('aria-disabled', 'true');
    resolve({ data: { delivery: { id: 2, dispatch_number: 'DSP-0002' }, picking: withReversal() } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('PickingPage — fechas y estados (revisión del backend)', () => {
  const invalidDate = (extra = {}) => apiError(400, {
    error: true, status_code: 400, code: 'INVALID_DATE', min_date: '2026-10-15',
    detail: 'La fecha no puede ser anterior a la creación del requerimiento.', ...extra,
  });

  it('INVALID_DATE al entregar se muestra en el campo de fecha, lo enfoca y fija el mínimo', async () => {
    almacen.deliverRqItems.mockRejectedValue(invalidDate());
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));

    const date = screen.getByLabelText('Fecha de la entrega');
    await waitFor(() => expect(date).toHaveAttribute('aria-invalid', 'true'));
    expect(date).toHaveAccessibleDescription(/anterior a la creación del requerimiento/);
    expect(date).toHaveAttribute('min', '2026-10-15');
    await waitFor(() => expect(date).toHaveFocus());
    // No recarga el picking: el estado no cambió.
    expect(almacen.getRqPicking).toHaveBeenCalledTimes(1);

    // Con el mínimo conocido, una fecha anterior ya no sale del navegador.
    almacen.deliverRqItems.mockClear();
    fireDate(date, '2026-10-10');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(await screen.findByText('La fecha no puede ser anterior al 15/10/2026.')).toBeInTheDocument();
    expect(almacen.deliverRqItems).not.toHaveBeenCalled();
  });

  it('INVALID_DATE sin detail usa un texto propio con la fecha mínima', async () => {
    almacen.deliverRqItems.mockRejectedValue(apiError(400, { code: 'INVALID_DATE', min_date: '2026-10-15T00:00:00-05:00' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(qtyInput(1), '1');
    await user.type(screen.getByLabelText(/Guía de remisión/), 'GR-7');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect((await screen.findAllByText('La fecha no puede ser anterior al 15/10/2026.')).length).toBeGreaterThan(0);
  });

  it('INVALID_DATE al anular se muestra en el campo de fecha del diálogo', async () => {
    almacen.reverseRqDelivery.mockRejectedValue(invalidDate({ detail: 'La anulación no puede ser anterior a la entrega.', min_date: '2026-10-20' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    await user.click(screen.getByRole('button', { name: 'Anular entrega DSP-0001' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'Error de conteo');
    fireDate(within(dialog).getByLabelText('Fecha de la anulación'), '2026-10-01');
    await user.click(within(dialog).getByRole('button', { name: 'Anular entrega' }));
    const date = within(dialog).getByLabelText('Fecha de la anulación');
    await waitFor(() => expect(date).toHaveAttribute('aria-invalid', 'true'));
    expect(date).toHaveAccessibleDescription(/anterior a la entrega/);
    expect(date).toHaveAttribute('min', '2026-10-20');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('RQ_NOT_REVERSIBLE_STATE cierra el diálogo, avisa y recarga (las entregas dejan de ser anulables)', async () => {
    almacen.reverseRqDelivery.mockRejectedValue(apiError(409, {
      error: true, status_code: 409, code: 'RQ_NOT_REVERSIBLE_STATE', status: 'DELIVERED',
      allowed_statuses: ['IN_STOCK', 'QUALITY_APPROVED'],
      detail: 'La entrega ya no se puede anular en este estado; corrígelo con el ciclo de reclamo.',
    }));
    almacen.getRqPicking
      .mockResolvedValueOnce({ data: makePicking() })
      .mockResolvedValueOnce({ data: makePicking({ request: { status: 'DELIVERED', deliverable_state: false, can_reverse: false }, deliveries: [{ ...DELIVERY_1, can_reverse: false }] }) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    await user.click(screen.getByRole('button', { name: 'Anular entrega DSP-0001' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'Error de conteo');
    await user.click(within(dialog).getByRole('button', { name: 'Anular entrega' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('La entrega ya no se puede anular en este estado; corrígelo con el ciclo de reclamo.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Anular entrega DSP-0001/ })).not.toBeInTheDocument());
    expect(almacen.getRqPicking).toHaveBeenCalledTimes(2);
  });

  it('INTEGRITY_CONFLICT al anular muestra el detalle del servidor y deja reintentar', async () => {
    almacen.reverseRqDelivery.mockRejectedValue(apiError(409, {
      error: true, status_code: 409, code: 'INTEGRITY_CONFLICT', detail: 'No se pudo completar la operación por un conflicto de datos.',
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('DSP-0001');
    await user.click(screen.getByRole('button', { name: 'Anular entrega DSP-0001' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'Error de conteo');
    await user.click(within(dialog).getByRole('button', { name: 'Anular entrega' }));
    expect((await within(dialog).findAllByText('No se pudo completar la operación por un conflicto de datos.')).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Anular entrega' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('PickingPage — actualizar', () => {
  it('«Actualizar» vuelve a pedir el picking y lo anuncia', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(almacen.getRqPicking).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.body.querySelector('[aria-live="polite"].sr-only')).toHaveTextContent('Lista de picking actualizada.'));
  });
});
