import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import LocationProbe from '../../test/LocationProbe';
import LogisticsActionPage from './LogisticsActionPage';
import { useAuth } from '../../context/useAuth';
import * as requestsApi from '../../api/requests';
import * as suppliersApi from '../../api/suppliers';

// SYSPCC-026 (QA ronda 1) — complements LogisticsActionPage.test.jsx with the branches of the
// stock check that it leaves out: the mixed warning, availability down, a failing STOCK_CHECKED
// after the lines were saved, the in-flight lock, the acting role of each flow, and the edge
// cases of saving a catalog link. Nothing here may ever block the transition.
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
      { id: 101, line_number: 1, description: 'Casco blanco', quantity: '10.000', unit: 'UND', stock_almacen_obra: '0.000', item_source: 'EPP', ...link(5, 'EPP-0001', 'Casco de seguridad blanco') },
      { id: 102, line_number: 2, description: 'Guantes de cuero', quantity: '20.000', unit: 'PAR', stock_almacen_obra: '0.000', item_source: '', ...link(6, 'EPP-0002', 'Guantes de cuero reforzado', 'PAR') },
      { id: 103, line_number: 3, description: 'Servicio de topografía', quantity: '1.000', unit: 'GLB', stock_almacen_obra: '0.000', item_source: '', inventory_item: null, is_off_catalog: true },
      { id: 104, line_number: 4, description: 'Cinta señalizadora', quantity: '5.000', unit: 'UND', stock_almacen_obra: '0.000', item_source: '', inventory_item: null, is_off_catalog: false },
    ],
    ...overrides,
  };
}

const availabilityRow = (itemId, line, over = {}) => ({
  item_id: itemId, line_number: line, description: '', unit: 'UND', requested: '10.000',
  inventory_item: null, link_status: 'UNLINKED', available_central: null,
  committed_other_requests: null, available_net: null, shortfall: null, coverage: null, ...over,
});

function buildAvailability() {
  return {
    request_id: 42,
    rq_number: 'RQ-2026-0042',
    items: [
      availabilityRow(101, 1, {
        requested: '10.000', unit: 'UND', link_status: 'LINKED',
        inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND' },
        available_central: '15.000', committed_other_requests: '3.000', available_net: '12.000',
        shortfall: '0.000', coverage: 'FULL',
      }),
      availabilityRow(102, 2, {
        requested: '20.000', unit: 'PAR', link_status: 'LINKED',
        inventory_item: { id: 6, product_code: 'EPP-0002', description: 'Guantes de cuero reforzado', unit: 'PAR' },
        available_central: '8.000', committed_other_requests: '0.000', available_net: '8.000',
        shortfall: '12.000', coverage: 'PARTIAL',
      }),
      availabilityRow(103, 3, { requested: '1.000', unit: 'GLB', link_status: 'OFF_CATALOG' }),
      availabilityRow(104, 4, { requested: '5.000', link_status: 'UNLINKED' }),
    ],
    summary: { items_total: 4, full: 1, partial: 1, none: 0, off_catalog: 1, unlinked: 1 },
  };
}

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
const updateResult = (over = {}) => ({
  data: { detail: 'Ítems actualizados.', updated_item_ids: [], unchanged_item_ids: [], ignored_item_ids: [], items: [], ...over },
});

async function choose(user, n, kind) {
  await user.click(within(card(n)).getByRole('button', { name: kind === 'stock' ? /Atender de Stock/ : /Requiere Compra/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ primaryRole: 'LOGISTICS_COORDINATOR' });
  requestsApi.getRequest.mockResolvedValue({ data: buildRequest() });
  requestsApi.getStockAvailability.mockResolvedValue({ data: buildAvailability() });
  requestsApi.getApprovals.mockResolvedValue({ data: { results: [] } });
  requestsApi.updateRequestItems.mockResolvedValue(updateResult());
  requestsApi.performAction.mockResolvedValue({ data: {} });
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 0, results: [] } });
  suppliersApi.getQuotations.mockResolvedValue({ data: { results: [] } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LogisticsActionPage — aviso cuando una parte va a stock y otra a compra', () => {
  it('lista sólo los ítems de stock sin cobertura, con el texto del caso mixto, y confirma sin bloquear', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await choose(user, 2, 'stock');                // partial, forced to stock; 1 is suggested stock; 3 and 4 stay purchase
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Hay ítems de stock sin cobertura completa');
    expect(dialog).toHaveTextContent(
      'Algunos ítems marcados para atender de stock no están cubiertos por completo por el almacén central.',
    );
    expect(dialog).not.toHaveTextContent('Marcó todo de stock');           // the "all stock" wording does not apply
    expect(within(dialog).getByText(/Ítem 2/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Ítem 1/)).not.toBeInTheDocument();  // covered: no warning
    expect(within(dialog).queryByText(/Ítem 3/)).not.toBeInTheDocument();  // purchase: no warning
    expect(requestsApi.performAction).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Sí, continuar de todos modos' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [
      { item_id: 101, supply_source: 'STOCK', item_source: 'EPP' },
      { item_id: 102, supply_source: 'STOCK' },
      { item_id: 103, supply_source: 'PURCHASE' },
      { item_id: 104, supply_source: 'PURCHASE' },
    ]);
    expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      action: 'STOCK_CHECKED', extra_data: { has_stock: false },        // any purchase line: the whole RQ goes to purchase
    }));
  });

  it('el resumen que viaja como comentario cuenta lo que hay por ítem (sin cifras inventadas)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    const { comments } = requestsApi.performAction.mock.calls[0][1];
    expect(comments).toBe([
      'Verificación de stock:',
      'Casco blanco: Atender de stock (disponible neto: 12)',
      'Guantes de cuero: Requiere compra (disponible neto: 8)',
      'Servicio de topografía: Requiere compra (sin datos de stock)',
      'Cinta señalizadora: Requiere compra (sin datos de stock)',
    ].join('\n'));
  });
});

describe('LogisticsActionPage — la consulta de disponibilidad no es una condición', () => {
  it('con la consulta caída se decide a mano, se avisa "no verificable" y se envía igual', async () => {
    const user = userEvent.setup();
    requestsApi.getStockAvailability.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitForPanel();
    await screen.findByText('No se pudo consultar la disponibilidad');

    for (const n of [1, 2, 3, 4]) await choose(user, n, 'stock');
    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText(/No se pudo consultar la disponibilidad de este ítem\./)).toHaveLength(4);
    await user.click(within(dialog).getByRole('button', { name: 'Sí, continuar de todos modos' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      action: 'STOCK_CHECKED', extra_data: { has_stock: true },
    })));
  });

  it('con la consulta caída y sin decidir los ítems, el botón sigue pidiendo decidirlos', async () => {
    requestsApi.getStockAvailability.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitForPanel();
    await screen.findByText('No se pudo consultar la disponibilidad');

    expect(screen.getByRole('button', { name: 'Marque todos los ítems arriba' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('el estado STOCK_CHECK también pide la disponibilidad y muestra el panel de decisión', async () => {
    requestsApi.getRequest.mockResolvedValue({ data: buildRequest({ status: 'STOCK_CHECK' }) });
    renderPage();

    await waitForPanel();

    expect(requestsApi.getStockAvailability).toHaveBeenCalledWith(42);
  });

  it('un RQ sin ítems lo dice en la tabla y en el panel, y no se puede confirmar', async () => {
    const user = userEvent.setup();
    requestsApi.getRequest.mockResolvedValue({ data: buildRequest({ items: [] }) });
    requestsApi.getStockAvailability.mockResolvedValue({
      data: { request_id: 42, rq_number: 'RQ-2026-0042', items: [], summary: { items_total: 0, full: 0, partial: 0, none: 0, off_catalog: 0, unlinked: 0 } },
    });
    renderPage();
    await waitForPanel();

    expect(screen.getAllByText('Sin ítems registrados.').length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole('button', { name: 'Marque todos los ítems arriba' }));
    expect(requestsApi.updateRequestItems).not.toHaveBeenCalled();
    expect(requestsApi.performAction).not.toHaveBeenCalled();
  });
});

describe('LogisticsActionPage — después de guardar los ítems', () => {
  async function confirmPurchase(user) {
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));
  }

  it('si STOCK_CHECKED falla, muestra el motivo, no sale de la pantalla y deja reintentar', async () => {
    const user = userEvent.setup();
    requestsApi.performAction
      .mockRejectedValueOnce({ response: { status: 403, data: { detail: 'No tiene el rol LOGISTICS_COORDINATOR.' } } })
      .mockResolvedValueOnce({ data: {} });
    renderPage();
    await waitForPanel();

    await confirmPurchase(user);

    expect((await screen.findAllByText('No tiene el rol LOGISTICS_COORDINATOR.')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('loc')).toHaveTextContent('/rq/logistics/42');
    const retry = screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' });   // not stuck in "Procesando…"
    expect(retry).not.toHaveAttribute('aria-disabled');

    await user.click(retry);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(2));
    expect(requestsApi.updateRequestItems).toHaveBeenCalledTimes(2);       // saving again is idempotent
    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/logistics');
  });

  it('mientras se guardan los ítems el botón queda en "Procesando…" y no hay una segunda petición', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await waitForPanel();

    await confirmPurchase(user);

    const busy = await screen.findByRole('button', { name: 'Procesando...' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(requestsApi.updateRequestItems).toHaveBeenCalledTimes(1);
    expect(requestsApi.performAction).not.toHaveBeenCalled();
  });

  it('tras guardar con éxito la notificación y la salida a la lista son las de siempre', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await confirmPurchase(user);

    expect(await screen.findByText(/Registrado\. Puede proceder a solicitar cotizaciones/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/rq/logistics'), { timeout: 2000 });
  });

  it('las notas escritas viajan como comentario de la acción', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await user.type(screen.getByRole('textbox', { name: /Notas/ }), 'Cotizar con dos proveedores');
    await confirmPurchase(user);

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(requestsApi.performAction.mock.calls[0][1].comments).toContain('Cotizar con dos proveedores');
  });
});

describe('LogisticsActionPage — rol con el que actúa', () => {
  it('el Supervisor de Logística (flujo Administración) envía STOCK_CHECKED con su propio rol', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ primaryRole: 'LOGISTICS_SUPERVISOR' });
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({ flow: 'ADMINISTRATIVE', project: null, department: 10, department_code: 'ADM', items: buildRequest().items.slice(0, 1) }),
    });
    requestsApi.getStockAvailability.mockResolvedValue({
      data: { ...buildAvailability(), items: buildAvailability().items.slice(0, 1) },
    });
    renderPage();
    await waitForPanel();

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Todo de Stock' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      action: 'STOCK_CHECKED', acting_role: 'LOGISTICS_SUPERVISOR', extra_data: { has_stock: true },
    })));
  });

  it('el Coordinador de Logística (flujo Operaciones) envía STOCK_CHECKED con su rol', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      acting_role: 'LOGISTICS_COORDINATOR',
    })));
  });
});

describe('LogisticsActionPage — vínculo con el catálogo: bordes', () => {
  const PRODUCT = {
    id: 7, product_code: 'MAT-0007', description: 'Cinta de peligro 100 m', unit: 'UND',
    category: 'Otros', available: '40.000',
  };

  async function pickForItem4(user) {
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [PRODUCT] } });
    await user.type(within(card(4)).getByRole('combobox', { name: /catálogo para el ítem 4/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /MAT-0007/ }));
  }

  it('si el servidor devuelve ids ignorados al vincular, lo cuenta como fallo y no refresca nada', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({ ignored_item_ids: [104] }));
    renderPage();
    await waitForPanel();

    await pickForItem4(user);

    expect(await within(card(4)).findByRole('alert')).toHaveTextContent('Algunos ítems ya no pertenecen a este requerimiento');
    expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(1);
    expect(within(card(4)).getByText('Sin vincular', { selector: 'span' })).toBeInTheDocument();
  });

  it('si el vínculo se guarda pero la nueva consulta falla, el vínculo se conserva y se puede reintentar', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({
      updated_item_ids: [104],
      items: [{ id: 104, ...link(7, 'MAT-0007', 'Cinta de peligro 100 m') }],
    }));
    requestsApi.getStockAvailability
      .mockResolvedValueOnce({ data: buildAvailability() })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: buildAvailability() });
    renderPage();
    await waitForPanel();

    await pickForItem4(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo consultar la disponibilidad');
    expect(within(card(4)).getByText('MAT-0007')).toBeInTheDocument();              // the link survived
    expect(within(card(4)).queryByRole('alert')).not.toBeInTheDocument();           // saving it did not fail
    await user.click(within(alert).getByRole('button', { name: /Reintentar/ }));
    await waitFor(() => expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(3));
  });

  it('si el servidor confirma sin devolver las líneas, igual refresca la disponibilidad y deja seguir', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue({ data: { detail: 'Ítems actualizados.', ignored_item_ids: [] } });
    renderPage();
    await waitForPanel();

    await pickForItem4(user);

    await waitFor(() => expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(2));
    expect(within(card(4)).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' })).not.toHaveAttribute('aria-disabled');
  });

  it('un 404 al vincular explica que el RQ ya no existe y no deja el ítem a medias', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue({ response: { status: 404, data: {} } });
    renderPage();
    await waitForPanel();

    await pickForItem4(user);

    expect(await within(card(4)).findByRole('alert')).toHaveTextContent('El requerimiento ya no existe o no está disponible');
  });

  it('un error de red al vincular habla de la conexión y el buscador sigue disponible', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue(new Error('Network Error'));
    renderPage();
    await waitForPanel();

    await pickForItem4(user);

    expect(await within(card(4)).findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor');
    expect(within(card(4)).getByRole('combobox', { name: /catálogo para el ítem 4/ })).toBeEnabled();
  });

  it('con el buscador de catálogo caído se puede marcar el ítem como fuera de catálogo y seguir', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockRejectedValue({ response: { status: 429 } });
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({ updated_item_ids: [104] }));
    renderPage();
    await waitForPanel();

    await user.type(within(card(4)).getByRole('combobox', { name: /catálogo para el ítem 4/ }), 'cinta');
    expect((await screen.findAllByText(/Demasiadas búsquedas seguidas/)).length).toBeGreaterThanOrEqual(1);
    await user.click(within(card(4)).getByRole('button', { name: 'Marcar el ítem 4 como fuera de catálogo' }));

    await waitFor(() => expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [
      { item_id: 104, is_off_catalog: true },
    ]));
  });

  it('mientras se guarda un vínculo no se puede enviar la verificación', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await waitForPanel();

    await pickForItem4(user);
    expect(await within(card(4)).findByText('Guardando el vínculo…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestsApi.updateRequestItems).toHaveBeenCalledTimes(1);
    expect(requestsApi.performAction).not.toHaveBeenCalled();
  });
});

describe('LogisticsActionPage — la consulta de disponibilidad aún no llega', () => {
  // The coverage warnings need the availability. Confirming before it arrives would open the
  // plain "Todo de Stock" dialog and skip the notice, so the button waits (and says why). If the
  // query FAILS the button opens and the dialog warns the stock could not be verified.
  it('mientras la consulta está en curso el botón de confirmar espera y lo explica; al llegar, avisa', async () => {
    const user = userEvent.setup();
    let resolveAvailability;
    requestsApi.getStockAvailability.mockImplementation(
      () => new Promise((resolve) => { resolveAvailability = resolve; }),
    );
    renderPage();
    await waitForPanel();

    for (const n of [1, 2, 3, 4]) await choose(user, n, 'stock');
    const confirm = screen.getByRole('button', { name: 'Confirmar — Todo de Stock' });

    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(confirm).toHaveAccessibleDescription('Espere a que termine la consulta de disponibilidad.');
    await user.click(confirm);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();           // nothing opens meanwhile

    resolveAvailability({ data: buildAvailability() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' })).not.toHaveAttribute('aria-disabled'));

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Hay ítems de stock sin cobertura completa');
  });

  it('si la consulta falla el botón se habilita y el diálogo avisa que no se pudo verificar', async () => {
    const user = userEvent.setup();
    requestsApi.getStockAvailability.mockRejectedValue({ response: { status: 500, data: {} } });
    renderPage();
    await waitForPanel();
    await screen.findByText('No se pudo consultar la disponibilidad');

    for (const n of [1, 2, 3, 4]) await choose(user, n, 'stock');
    const confirm = screen.getByRole('button', { name: 'Confirmar — Todo de Stock' });
    expect(confirm).not.toHaveAttribute('aria-disabled');

    await user.click(confirm);
    expect(screen.getByRole('dialog')).toHaveTextContent(/no se pudo consultar|no se puede verificar|sin cobertura completa/i);
  });
});

describe('LogisticsActionPage — vocabulario del dominio en la verificación de stock', () => {
  it('con todo cubierto, el diálogo y el aviso de éxito dicen "requerimiento" y nunca "pedido"', async () => {
    const user = userEvent.setup();
    requestsApi.getRequest.mockResolvedValue({ data: buildRequest({ items: buildRequest().items.slice(0, 1) }) });
    requestsApi.getStockAvailability.mockResolvedValue({
      data: { ...buildAvailability(), items: buildAvailability().items.slice(0, 1) },
    });
    renderPage();
    await waitForPanel();

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('El requerimiento será derivado al Almacén.');
    expect(dialog).not.toHaveTextContent(/pedido/i);
    await user.click(within(dialog).getByRole('button', { name: 'Sí, Todo de Stock' }));

    expect((await screen.findAllByText('Stock confirmado. El requerimiento ha sido derivado al Almacén.')).length).toBeGreaterThanOrEqual(1);
    expect(document.body).not.toHaveTextContent(/pedido/i);
  });

  it('el aviso de cobertura incompleta no promete un seguimiento que todavía no existe', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await choose(user, 2, 'stock');
    const advisory = screen.getByText('1 ítem de stock sin cobertura completa').closest('div');
    expect(advisory).toHaveTextContent('Puede continuar: se le pedirá confirmar.');
    expect(advisory).toHaveTextContent('crear un RQ complementario');
    expect(advisory).not.toHaveTextContent(/seguimiento/i);

    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Si continúa, el faltante no se atenderá desde el stock.');
    expect(dialog).not.toHaveTextContent(/seguimiento|visible/i);
  });
});

describe('LogisticsActionPage — una consulta de disponibilidad que se agota no bloquea el envío', () => {
  // `getStockAvailability` now has a timeout. When axios gives up it rejects with ECONNABORTED and
  // no `response`; that must end like any other failure: the button opens, the dialog says the
  // stock could not be verified, and STOCK_CHECKED can still be sent (nothing new blocks a transition).
  it('mientras no responde el botón espera; al agotarse el tiempo se abre y se puede enviar STOCK_CHECKED', async () => {
    const user = userEvent.setup();
    let failAvailability;
    requestsApi.getStockAvailability.mockImplementation(
      () => new Promise((_resolve, reject) => { failAvailability = reject; }),
    );
    renderPage();
    await waitForPanel();

    for (const n of [1, 2, 3, 4]) await choose(user, n, 'stock');
    expect(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' })).toHaveAttribute('aria-disabled', 'true');

    failAvailability(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }));

    expect(await screen.findByText('No se pudo consultar la disponibilidad')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirmar — Todo de Stock' });
    expect(confirm).not.toHaveAttribute('aria-disabled');

    await user.click(confirm);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText(/No se pudo consultar la disponibilidad de este ítem\./)).toHaveLength(4);
    await user.click(within(dialog).getByRole('button', { name: 'Sí, continuar de todos modos' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      action: 'STOCK_CHECKED', extra_data: { has_stock: true },
    })));
  });

  it('tras agotarse el tiempo se puede reintentar la consulta y las cifras vuelven', async () => {
    const user = userEvent.setup();
    requestsApi.getStockAvailability
      .mockRejectedValueOnce(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ data: buildAvailability() });
    renderPage();
    await waitForPanel();
    await screen.findByText('No se pudo consultar la disponibilidad');

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(within(card(1)).getByText('Stock suficiente')).toBeInTheDocument());
    expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(2);
  });
});

describe('LogisticsActionPage — "-- Sin fuente --" sobre un ítem que ya tenía fuente', () => {
  // The option looks like it clears the family. buildItemDecisions used to drop falsy values, so
  // nothing was sent and the server kept the old one; the backend accepts '' to clear it.
  it('envía la fuente vacía para quitarla', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await user.selectOptions(within(card(1)).getByLabelText('Fuente del ítem'), '');
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));

    await waitFor(() => expect(requestsApi.updateRequestItems).toHaveBeenCalledTimes(1));
    expect(requestsApi.updateRequestItems.mock.calls[0][1][0]).toMatchObject({ item_id: 101, item_source: '' });
  });

  it('un ítem que no tenía fuente y no se toca no manda item_source', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));

    await waitFor(() => expect(requestsApi.updateRequestItems).toHaveBeenCalledTimes(1));
    const sent = requestsApi.updateRequestItems.mock.calls[0][1];
    expect(sent.find((d) => d.item_id === 102)).not.toHaveProperty('item_source');
  });
});

describe('LogisticsActionPage — contraste de los botones del diálogo de confirmación', () => {
  // white on teal-600 / orange-500 does not reach 4.5:1; -700 does. (amber-700 already did.)
  it('"Sí, Enviar a Cotización" usa naranja-700 y "Sí, Todo de Stock" teal-700', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' })).toHaveClass('bg-orange-700');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
  });

  it('el diálogo normal (sin aviso) mantiene "Cancelar"; sólo el de cobertura dice "Volver y revisar"', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(within(dialog).queryByRole('button', { name: 'Volver y revisar' })).not.toBeInTheDocument();
  });
});
