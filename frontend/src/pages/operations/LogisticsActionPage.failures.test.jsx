import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import LocationProbe from '../../test/LocationProbe';
import LogisticsActionPage from './LogisticsActionPage';
import { useAuth } from '../../context/useAuth';
import * as requestsApi from '../../api/requests';
import * as suppliersApi from '../../api/suppliers';

// These pages render a long form / a list of cards and the tests type into them: on a busy machine
// (CI running jobs in parallel) the default 1000 ms of findBy*/waitFor can expire before the first
// render finishes. The limit only bounds how long a failing assertion keeps retrying.
configure({ asyncUtilTimeout: 4000 });

// SYSPCC-026 (QA ronda 2) — the stock check when things go wrong, with the answers the
// backend really gives (texts copied from apps/rq/services/request_items.py and the
// update-items view), and with RQs that come from before the capture fields existed.
//
// Rule under test: if saving the decisions fails, STOCK_CHECKED is NOT sent, the reason is
// on screen, the page is not stuck, and the same click works again once the cause is gone.
// Nothing here is a new gate on the transition: it protects the data, not the workflow.
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/requests');
vi.mock('../../api/suppliers');

const link = (id, code, description, unit = 'UND') => ({
  inventory_item: id,
  inventory_item_code: code,
  inventory_item_description: description,
  inventory_item_unit: unit,
  is_off_catalog: false,
});

function buildRequest(overrides = {}) {
  return {
    id: 42,
    rq_number: 'RQ-2026-0042',
    status: 'VALIDATED',
    flow: 'OPERATIONS',
    description: 'Material para frente 3',
    priority: 'NORMAL',
    project: 1,
    project_code: 'PRY-001',
    project_name: 'Minera Yanaocha',
    requested_by_name: 'Op Erator',
    fecha_necesidad: '2026-12-31',
    items: [
      { id: 101, line_number: 1, description: 'Casco blanco', quantity: '10.000', unit: 'UND', stock_almacen_obra: '0.000', item_source: 'EPP', link_confirmed: true, ...link(5, 'EPP-0001', 'Casco de seguridad blanco') },
      { id: 102, line_number: 2, description: 'Guantes de cuero', quantity: '20.000', unit: 'PAR', stock_almacen_obra: '0.000', item_source: '', link_confirmed: true, ...link(6, 'EPP-0002', 'Guantes de cuero reforzado', 'PAR') },
    ],
    ...overrides,
  };
}

const row = (itemId, line, over = {}) => ({
  item_id: itemId, line_number: line, description: '', unit: 'UND', requested: '10.000',
  inventory_item: null, link_status: 'UNLINKED', link_confirmed: false, available_central: null,
  committed_other_requests: null, available_net: null, shortfall: null, coverage: null, ...over,
});

function buildAvailability() {
  return {
    request_id: 42,
    rq_number: 'RQ-2026-0042',
    items: [
      row(101, 1, {
        link_status: 'LINKED', link_confirmed: true,
        inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND' },
        available_central: '15.000', committed_other_requests: '0.000', available_net: '15.000',
        shortfall: '0.000', coverage: 'FULL',
      }),
      row(102, 2, {
        requested: '20.000', unit: 'PAR', link_status: 'LINKED', link_confirmed: true,
        inventory_item: { id: 6, product_code: 'EPP-0002', description: 'Guantes de cuero reforzado', unit: 'PAR' },
        available_central: '8.000', committed_other_requests: '0.000', available_net: '8.000',
        shortfall: '12.000', coverage: 'PARTIAL',
      }),
    ],
    summary: { items_total: 2, full: 1, partial: 1, none: 0, off_catalog: 0, unlinked: 0 },
  };
}

const updateResult = (over = {}) => ({
  data: { detail: 'Ítems actualizados.', updated_item_ids: [], unchanged_item_ids: [], ignored_item_ids: [], items: [], ...over },
});

function renderPage() {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/rq/logistics/:id" element={<LogisticsActionPage />} />
        <Route path="/rq/logistics" element={<p>Panel logístico</p>} />
      </Routes>
      <LocationProbe />
    </>,
    { route: '/rq/logistics/42' },
  );
}

const card = (n) => screen.getByRole('group', { name: `Origen de atención del ítem ${n}` }).closest('li');
const waitForPanel = () => screen.findByRole('heading', { name: 'Decisión por Ítem' });

async function confirmPurchaseFlow(user) {
  await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));
}

const failure = (status, data) => ({ response: { status, data } });

beforeEach(() => {
  // reset (not just clear): a once-queued answer left by a failing test must not leak into the next.
  vi.resetAllMocks();
  useAuth.mockReturnValue({ primaryRole: 'LOGISTICS_COORDINATOR' });
  requestsApi.getRequest.mockResolvedValue({ data: buildRequest() });
  requestsApi.getStockAvailability.mockResolvedValue({ data: buildAvailability() });
  requestsApi.getApprovals.mockResolvedValue({ data: { results: [] } });
  requestsApi.updateRequestItems.mockResolvedValue(updateResult());
  requestsApi.performAction.mockResolvedValue({ data: {} });
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 0, results: [] } });
  suppliersApi.getQuotations.mockResolvedValue({ data: { results: [] } });
});

// ───────────────────────── each failure of update-items aborts the step ─────────────────────────

const SAVE_FAILURES = [
  ['409 RQ en estado final',
    failure(409, { detail: 'El requerimiento ya está en un estado final y sus ítems no se pueden modificar.', code: 'REQUEST_TERMINAL', item_ids: [] }),
    'El requerimiento ya está en un estado final y sus ítems no se pueden modificar.'],
  ['409 RQ fuera de la ventana de edición',
    failure(409, { detail: 'Los ítems solo se pueden modificar desde la validación del requerimiento hasta antes del despacho. Estado actual: Despachado a obra.', code: 'REQUEST_STATE_NOT_EDITABLE', item_ids: [] }),
    'Los ítems solo se pueden modificar desde la validación del requerimiento hasta antes del despacho. Estado actual: Despachado a obra.'],
  ['409 ítems ya despachados',
    failure(409, { detail: 'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.', code: 'ITEMS_ALREADY_DISPATCHED', item_ids: [101] }),
    'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.'],
  ['409 los datos cambiaron (integridad)',
    failure(409, { detail: 'No se pudieron guardar los cambios porque los datos cambiaron. Actualice la página e intente nuevamente.', code: 'INTEGRITY_ERROR' }),
    'No se pudieron guardar los cambios porque los datos cambiaron. Actualice la página e intente nuevamente.'],
  ['409 sin texto del servidor', failure(409, {}),
    'Los ítems no se pueden modificar porque el requerimiento cambió. Actualice la página.'],
  ['403 sin permiso', failure(403, { detail: 'No tiene permiso para realizar esta acción.' }),
    'No tiene permiso para modificar los ítems de este requerimiento.'],
  ['404 el RQ ya no existe', failure(404, { detail: 'El requerimiento ya no existe.' }),
    'El requerimiento ya no existe o no está disponible. Actualice la página.'],
  ['429 demasiadas solicitudes', failure(429, { detail: 'Demasiadas solicitudes.' }),
    'Demasiadas solicitudes seguidas. Espere unos segundos e intente de nuevo.'],
  ['400 payload inválido por línea', failure(400, { error: true, status_code: 400, detail: { items: [{ item_id: ['Un entero válido es requerido.'] }] } }),
    'Los datos de los ítems no son válidos.'],
  ['400 con texto', failure(400, { detail: 'Indique al menos un campo a actualizar.' }),
    'Indique al menos un campo a actualizar.'],
  ['500 con texto del servidor', failure(500, { detail: 'Error interno del servidor.' }),
    'Error interno del servidor.'],
  ['500 sin cuerpo', failure(500, undefined),
    'No se pudieron guardar los ítems. Intente nuevamente.'],
  ['502 del proxy con una página HTML', failure(502, '<html><body><h1>502 Bad Gateway</h1></body></html>'),
    'No se pudieron guardar los ítems. Intente nuevamente.'],
];

describe('LogisticsActionPage — si update-items falla no se envía STOCK_CHECKED', () => {
  it.each(SAVE_FAILURES)('%s', async (_label, rejection, expectedReason) => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue(rejection);
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);

    const messages = await screen.findAllByText(/la verificación de stock no se envió/);
    messages.forEach((m) => expect(m).toHaveTextContent(expectedReason));
    expect(requestsApi.performAction).not.toHaveBeenCalled();
    expect(requestsApi.updateRequestItems).toHaveBeenCalledTimes(1);
    // The page is not stuck: same screen, button back to its label, ready to retry.
    expect(screen.getByTestId('loc')).toHaveTextContent('/rq/logistics/42');
    expect(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' })).toBeInTheDocument();
  });

  it('una vez resuelta la causa, el mismo clic guarda y envía STOCK_CHECKED una sola vez', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems
      .mockRejectedValueOnce(failure(409, { detail: 'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.', code: 'ITEMS_ALREADY_DISPATCHED', item_ids: [101] }))
      .mockResolvedValueOnce(updateResult());
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);
    await screen.findAllByText(/la verificación de stock no se envió/);
    await confirmPurchaseFlow(user);

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(requestsApi.updateRequestItems).toHaveBeenCalledTimes(2);
    expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({ action: 'STOCK_CHECKED' }));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/logistics');
  });

  it('el mensaje del fallo se limpia al reintentar con éxito', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems
      .mockRejectedValueOnce(failure(403, {}))
      .mockResolvedValueOnce(updateResult());
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);
    await screen.findAllByText(/la verificación de stock no se envió/);
    await confirmPurchaseFlow(user);

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalled());
    // The banner is gone (the toast of the first failure may still be fading out on its own).
    expect(screen.queryByText('Error al procesar la acción')).not.toBeInTheDocument();
  });

  it('con el aviso de cobertura el fallo de guardado tampoco envía nada, y "Volver y revisar" sigue disponible', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue(failure(409, { detail: 'El requerimiento ya está en un estado final y sus ítems no se pueden modificar.', code: 'REQUEST_TERMINAL', item_ids: [] }));
    renderPage();
    await waitForPanel();
    // Line 2 is only partially covered: choosing stock for it raises the coverage warning.
    await user.click(within(card(2)).getByRole('button', { name: /Atender de Stock/ }));

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Hay ítems de stock sin cobertura completa');
    await user.click(within(dialog).getByRole('button', { name: 'Sí, continuar de todos modos' }));

    expect((await screen.findAllByText(/la verificación de stock no se envió/)).length).toBeGreaterThan(0);
    expect(requestsApi.performAction).not.toHaveBeenCalled();
  });
});

// ───────────────────────── STOCK_CHECKED itself failing (engine answers) ─────────────────────────

const ENGINE_FAILURES = [
  ['400 transición inválida (texto)', failure(400, { detail: 'La acción STOCK_CHECKED no es válida desde el estado Enviado.' }),
    'La acción STOCK_CHECKED no es válida desde el estado Enviado.'],
  ['403 rol incorrecto para el flujo', failure(403, { detail: 'El usuario jperez no tiene el rol requerido "LOGISTICS_SUPERVISOR" para esta acción.' }),
    'El usuario jperez no tiene el rol requerido "LOGISTICS_SUPERVISOR" para esta acción.'],
  ['400 con detalle por campos', failure(400, { detail: { has_stock: ['Obligatorio.'] } }),
    '{"has_stock":["Obligatorio."]}'],
  ['sin respuesta (red caída)', new Error('Network Error'),
    'Error al procesar la acción.'],
];

describe('LogisticsActionPage — STOCK_CHECKED rechazado por el motor', () => {
  it.each(ENGINE_FAILURES)('%s: muestra el motivo, no sale de la pantalla y deja reintentar', async (_label, rejection, expected) => {
    const user = userEvent.setup();
    requestsApi.performAction.mockRejectedValueOnce(rejection).mockResolvedValueOnce({ data: {} });
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);

    expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('loc')).toHaveTextContent('/rq/logistics/42');
    expect(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' })).toBeInTheDocument();

    // Retry: the lines were saved the first time; saving them again is harmless and the action goes through.
    await confirmPurchaseFlow(user);
    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/logistics');
  });
});

// ───────────────────────── saving ONE link (on pick) fails ─────────────────────────

describe('LogisticsActionPage — guardar un vínculo suelto falla', () => {
  const CASCO = { id: 501, product_code: 'EPP-0900', description: 'Casco minero', unit: 'UND', category: 'EPP', available: '3.000' };

  async function tryToChangeLine1(user) {
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [CASCO] } });
    await user.click(within(card(1)).getByRole('button', { name: /Cambiar el producto vinculado del ítem 1/ }));
    await user.type(screen.getByRole('combobox', { name: /Buscar el producto del catálogo para el ítem 1/ }), 'casco');
    await user.click(await screen.findByRole('option', { name: /EPP-0900/ }));
  }

  it.each([
    ['409 fuera de la ventana de edición',
      failure(409, { detail: 'Los ítems solo se pueden modificar desde la validación del requerimiento hasta antes del despacho. Estado actual: Entregado.', code: 'REQUEST_STATE_NOT_EDITABLE', item_ids: [] }),
      'Estado actual: Entregado.'],
    ['409 ítem ya despachado',
      failure(409, { detail: 'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.', code: 'ITEMS_ALREADY_DISPATCHED', item_ids: [101] }),
      'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.'],
    ['403', failure(403, {}), 'No tiene permiso para modificar los ítems de este requerimiento.'],
    ['429', failure(429, {}), 'Demasiadas solicitudes seguidas. Espere unos segundos e intente de nuevo.'],
  ])('%s: lo dice junto al ítem, no cambia el vínculo mostrado y no toca el resto', async (_label, rejection, expected) => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue(rejection);
    renderPage();
    await waitForPanel();

    await tryToChangeLine1(user);

    expect(await within(card(1)).findByRole('alert')).toHaveTextContent(expected);
    expect(within(card(2)).queryByRole('alert')).not.toBeInTheDocument();
    expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [{ item_id: 101, inventory_item: 501 }]);
    expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(1); // no refresh for a link that was not saved
    expect(requestsApi.performAction).not.toHaveBeenCalled();
  });

  it('tras el fallo se puede elegir otra vez y el aviso desaparece al guardarse', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems
      .mockRejectedValueOnce(failure(429, {}))
      .mockResolvedValueOnce(updateResult({
        updated_item_ids: [101],
        items: [{ id: 101, inventory_item: 501, inventory_item_code: 'EPP-0900', inventory_item_description: 'Casco minero', inventory_item_unit: 'UND', is_off_catalog: false, link_confirmed: true }],
      }));
    // After the second save the server reports line 1 on the new product.
    const afterSave = buildAvailability();
    afterSave.items[0] = {
      ...afterSave.items[0],
      inventory_item: { id: 501, product_code: 'EPP-0900', description: 'Casco minero', unit: 'UND' },
    };
    requestsApi.getStockAvailability
      .mockResolvedValueOnce({ data: buildAvailability() })
      .mockResolvedValue({ data: afterSave });
    renderPage();
    await waitForPanel();

    await tryToChangeLine1(user);
    await within(card(1)).findByRole('alert');
    await user.type(screen.getByRole('combobox', { name: /Buscar el producto del catálogo para el ítem 1/ }), 'ca');
    await user.click(await screen.findByRole('option', { name: /EPP-0900/ }));

    await waitFor(() => expect(within(card(1)).queryByRole('alert')).not.toBeInTheDocument());
    expect(within(card(1)).getByText('EPP-0900')).toBeInTheDocument();
  });
});

// ───────────────────────── RQs from before the capture fields ─────────────────────────

describe('LogisticsActionPage — RQs históricos (sin área, fuente, vínculo ni marca de confirmación)', () => {
  // What an RQ created before SYSPCC-026 looks like when the lines carry none of the new keys.
  const bareItems = [
    { id: 201, line_number: 1, description: 'Cemento Portland', quantity: '10.000', unit: 'BLS', stock_almacen_obra: '0.000' },
    { id: 202, line_number: 2, description: 'Servicio de flete', quantity: '1.000', unit: 'GLB', stock_almacen_obra: '0.000' },
  ];
  const bareAvailability = () => ({
    request_id: 42,
    rq_number: 'RQ-2026-0042',
    items: [
      { item_id: 201, line_number: 1, description: 'Cemento Portland', unit: 'BLS', requested: '10.000', inventory_item: null, link_status: 'UNLINKED', link_confirmed: false, available_central: null, committed_other_requests: null, available_net: null, shortfall: null, coverage: null },
      { item_id: 202, line_number: 2, description: 'Servicio de flete', unit: 'GLB', requested: '1.000', inventory_item: null, link_status: 'UNLINKED', link_confirmed: false, available_central: null, committed_other_requests: null, available_net: null, shortfall: null, coverage: null },
    ],
    summary: { items_total: 2, full: 0, partial: 0, none: 0, off_catalog: 0, unlinked: 2 },
  });

  beforeEach(() => {
    requestsApi.getRequest.mockResolvedValue({ data: buildRequest({ items: bareItems }) });
    requestsApi.getStockAvailability.mockResolvedValue({ data: bareAvailability() });
  });

  it('la pantalla se arma y cada línea se ofrece vincular, sin avisos de "por confirmar"', async () => {
    renderPage();
    await waitForPanel();

    for (const n of [1, 2]) {
      expect(within(card(n)).getByText(/Sin vincular: busque el producto del catálogo/)).toBeInTheDocument();
      expect(within(card(n)).queryByText(/Por confirmar/)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/por confirmar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined|NaN|null/)).not.toBeInTheDocument();
  });

  it('se decide y se envía: solo viaja el origen de atención, sin claves vacías ni "undefined"', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [
      { item_id: 201, supply_source: 'PURCHASE' },
      { item_id: 202, supply_source: 'PURCHASE' },
    ]);
    expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      action: 'STOCK_CHECKED', extra_data: { has_stock: false },
    }));
  });

  it('marcar todo "de stock" sin poder verificarlo avisa, pide confirmación y no bloquea', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();
    await user.click(within(card(1)).getByRole('button', { name: /Atender de Stock/ }));
    await user.click(within(card(2)).getByRole('button', { name: /Atender de Stock/ }));

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Hay ítems de stock sin cobertura completa');
    expect(dialog).toHaveTextContent('Sin producto vinculado: no se puede verificar el stock.');
    await user.click(within(dialog).getByRole('button', { name: 'Sí, continuar de todos modos' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      extra_data: { has_stock: true },
    }));
  });

  it('un servidor antiguo que no manda link_confirmed no activa ningún aviso en líneas ya vinculadas', async () => {
    const legacyLinked = [{
      id: 301, line_number: 1, description: 'Casco', quantity: '5.000', unit: 'UND', stock_almacen_obra: '0.000',
      ...link(5, 'EPP-0001', 'Casco de seguridad blanco'),
    }];
    const legacyAvailability = {
      request_id: 42, rq_number: 'RQ-2026-0042',
      items: [{
        item_id: 301, line_number: 1, description: 'Casco', unit: 'UND', requested: '5.000',
        inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND' },
        link_status: 'LINKED', available_central: '9.000', committed_other_requests: '0.000', available_net: '9.000',
        shortfall: '0.000', coverage: 'FULL',
      }],
      summary: { items_total: 1, full: 1, partial: 0, none: 0, off_catalog: 0, unlinked: 0 },
    };
    requestsApi.getRequest.mockResolvedValue({ data: buildRequest({ items: legacyLinked }) });
    requestsApi.getStockAvailability.mockResolvedValue({ data: legacyAvailability });
    renderPage();
    await waitForPanel();

    expect(screen.queryByText(/Por confirmar/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar el producto vinculado/ })).not.toBeInTheDocument();
  });
});

// ───────────────────────── proposals the requester made: warn, never block ─────────────────────────

describe('LogisticsActionPage — productos propuestos por el solicitante', () => {
  beforeEach(() => {
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({
        items: buildRequest().items.map((it) => ({ ...it, link_confirmed: false })),
      }),
    });
    const availability = buildAvailability();
    availability.items = availability.items.map((r) => ({ ...r, link_confirmed: false }));
    requestsApi.getStockAvailability.mockResolvedValue({ data: availability });
  });

  it('avisa cuántos faltan por confirmar y se puede seguir sin confirmar ninguno', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    expect(screen.getByText('2 productos por confirmar')).toBeInTheDocument();
    expect(screen.getByText(/Puede continuar sin confirmarlos/)).toBeInTheDocument();

    await confirmPurchaseFlow(user);

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    // The origin goes; the proposals stay proposals (sending the origin does not confirm them).
    expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [
      { item_id: 101, supply_source: 'STOCK', item_source: 'EPP' },
      { item_id: 102, supply_source: 'PURCHASE' },
    ]);
  });

  it('confirmar un producto reenvía el mismo vínculo, retira su aviso y deja el otro pendiente', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({
      updated_item_ids: [101],
      items: [{ id: 101, inventory_item: 5, inventory_item_code: 'EPP-0001', inventory_item_description: 'Casco de seguridad blanco', inventory_item_unit: 'UND', is_off_catalog: false, link_confirmed: true }],
    }));
    const confirmedRows = buildAvailability();
    confirmedRows.items[1] = { ...confirmedRows.items[1], link_confirmed: false };
    requestsApi.getStockAvailability
      .mockResolvedValueOnce({ data: (() => { const a = buildAvailability(); a.items = a.items.map((r) => ({ ...r, link_confirmed: false })); return a; })() })
      .mockResolvedValue({ data: confirmedRows });
    renderPage();
    await waitForPanel();

    await user.click(within(card(1)).getByRole('button', { name: 'Confirmar el producto vinculado del ítem 1' }));

    await waitFor(() => expect(within(card(1)).queryByText(/Por confirmar/)).not.toBeInTheDocument());
    expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [{ item_id: 101, inventory_item: 5 }]);
    expect(within(card(2)).getByText(/Por confirmar/)).toBeInTheDocument();
    expect(await screen.findByText('1 producto por confirmar')).toBeInTheDocument();
    expect(requestsApi.performAction).not.toHaveBeenCalled(); // confirming a link is not the stock check
  });
});

// ───────────────────────── the same non-blocking warning in the ADMINISTRATIVE flow ─────────────────────────

describe('LogisticsActionPage — aviso de cobertura en el flujo Administración', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ primaryRole: 'LOGISTICS_SUPERVISOR' });
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({ flow: 'ADMINISTRATIVE', project: null, project_code: null, project_name: null, department: 7 }),
    });
  });

  it('con stock parcial el Supervisor ve el aviso, confirma de todos modos y la acción lleva su propio rol', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();
    await user.click(within(card(2)).getByRole('button', { name: /Atender de Stock/ }));

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Hay ítems de stock sin cobertura completa');
    expect(dialog).toHaveTextContent('Stock parcial: hay 8 de 20 PAR (faltan 12).');
    await user.click(within(dialog).getByRole('button', { name: 'Sí, continuar de todos modos' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      action: 'STOCK_CHECKED',
      acting_role: 'LOGISTICS_SUPERVISOR',
      extra_data: { has_stock: true },
    }));
  });

  it('"Volver y revisar" no envía nada y deja cambiar de opinión hacia compra', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();
    await user.click(within(card(2)).getByRole('button', { name: /Atender de Stock/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Volver y revisar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestsApi.updateRequestItems).not.toHaveBeenCalled();
    expect(requestsApi.performAction).not.toHaveBeenCalled();

    await user.click(within(card(2)).getByRole('button', { name: /Requiere Compra/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      acting_role: 'LOGISTICS_SUPERVISOR',
      extra_data: { has_stock: false },
    }));
  });
});
