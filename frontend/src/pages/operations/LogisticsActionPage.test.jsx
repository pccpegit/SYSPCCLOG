import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import LocationProbe from '../../test/LocationProbe';
import LogisticsActionPage from './LogisticsActionPage';
import { useAuth } from '../../context/AuthContext';
import * as requestsApi from '../../api/requests';
import * as suppliersApi from '../../api/suppliers';

// SYSPCC-026 — verificación de stock del Coordinador Logístico: disponibilidad
// real por ítem, vínculo con el catálogo, aborto si update-items falla y aviso
// (sin bloqueo) cuando se marca stock para un ítem que el almacén no cubre.
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
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

/** The decision card of line `n` (found through its origin toggle group). */
function card(n) {
  return screen.getByRole('group', { name: `Origen de atención del ítem ${n}` }).closest('li');
}

async function waitForPanel() {
  await screen.findByRole('heading', { name: 'Decisión por Ítem' });
}

const updateResult = (over = {}) => ({
  data: { detail: 'Ítems actualizados.', updated_item_ids: [], unchanged_item_ids: [], ignored_item_ids: [], items: [], ...over },
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ primaryRole: 'LOGISTICS_COORDINATOR' });
  requestsApi.getRequest.mockResolvedValue({ data: buildRequest() });
  requestsApi.getStockAvailability.mockResolvedValue({ data: buildAvailability() });
  requestsApi.getApprovals.mockResolvedValue({ data: { results: [] } });
  requestsApi.updateRequestItems.mockResolvedValue(updateResult());
  requestsApi.performAction.mockResolvedValue({ data: {} });
  suppliersApi.getQuotations.mockResolvedValue({ data: { results: [] } });
});

describe('LogisticsActionPage — disponibilidad por ítem', () => {
  it('pide la disponibilidad real del RQ (ya no el check-stock por texto)', async () => {
    renderPage();
    await waitForPanel();

    expect(requestsApi.getStockAvailability).toHaveBeenCalledWith(42);
  });

  it('muestra solicitado vs disponible neto, comprometido y faltante de un ítem vinculado', async () => {
    renderPage();
    await waitForPanel();

    const partial = within(card(2));
    expect(partial.getByText('Stock parcial')).toBeInTheDocument();
    expect(partial.getByText('EPP-0002')).toBeInTheDocument();
    expect(partial.getByText('Solicitado').nextElementSibling).toHaveTextContent('20');
    expect(partial.getByText('Disponible neto (almacén central)').nextElementSibling).toHaveTextContent('8');
    expect(partial.getByText('Faltante').nextElementSibling).toHaveTextContent('12');
    expect(partial.getByText(/no alcanza para todo lo solicitado/)).toBeInTheDocument();

    const full = within(card(1));
    expect(full.getByText('Stock suficiente')).toBeInTheDocument();
    expect(full.getByText('Comprometido en otros RQ').nextElementSibling).toHaveTextContent('3');
    expect(full.getByText(/Hay 15 UND en el almacén central; el resto está comprometido con otros RQ\./)).toBeInTheDocument();
  });

  it('distingue "fuera de catálogo" y "sin vincular" sin inventar cifras de stock', async () => {
    renderPage();
    await waitForPanel();

    const off = within(card(3));
    expect(off.getByText('Fuera de catálogo', { selector: 'span' })).toBeInTheDocument();
    expect(off.getByText(/este ítem no pasa por el almacén/)).toBeInTheDocument();
    expect(off.getByText('Disponible neto (almacén central)').nextElementSibling).toHaveTextContent('—');

    const unlinked = within(card(4));
    expect(unlinked.getByText('Sin vincular', { selector: 'span' })).toBeInTheDocument();
    expect(unlinked.getByText(/Sin vincular: busque el producto del catálogo/)).toBeInTheDocument();
    expect(unlinked.getByRole('combobox', { name: /catálogo para el ítem 4/ })).toBeInTheDocument();
  });

  it('mientras llega muestra "Consultando…" y la página sigue usable', async () => {
    requestsApi.getStockAvailability.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await waitForPanel();

    expect(within(card(1)).getByText('Consultando la disponibilidad…')).toBeInTheDocument();
    expect(screen.getByRole('list', { hidden: false, busy: true })).toBeInTheDocument();
  });

  it('si la consulta falla avisa, ofrece reintentar y no bloquea la decisión', async () => {
    const user = userEvent.setup();
    requestsApi.getStockAvailability.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    await waitForPanel();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo consultar la disponibilidad');
    expect(within(card(1)).getByText('Sin datos de disponibilidad para este ítem.')).toBeInTheDocument();

    // Logistics can still decide by hand.
    await user.click(within(card(1)).getByRole('button', { name: /Atender de Stock/ }));
    expect(within(card(1)).getByRole('button', { name: /Atender de Stock/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(alert).getByRole('button', { name: /Reintentar/ }));

    await waitFor(() => expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(2));
    expect(await within(card(1)).findByText('Stock suficiente')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo consultar la disponibilidad')).not.toBeInTheDocument();
  });
});

describe('LogisticsActionPage — sugerencia y decisión', () => {
  it('sugiere stock sólo para lo cubierto y compra para el resto, marcándolo como "sugerido"', async () => {
    renderPage();
    await waitForPanel();

    expect(within(card(1)).getByRole('button', { name: /Atender de Stock/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card(1)).getByText('(sugerido)')).toBeInTheDocument();
    for (const n of [2, 3, 4]) {
      expect(within(card(n)).getByRole('button', { name: /Requiere Compra/ })).toHaveAttribute('aria-pressed', 'true');
    }

    const user = userEvent.setup();
    await user.click(within(card(1)).getByRole('button', { name: /Requiere Compra/ }));
    expect(within(card(1)).queryByText('(sugerido)')).not.toBeInTheDocument();
  });

  it('guarda las decisiones por ítem ANTES de enviar STOCK_CHECKED y envía la acción del flujo de siempre', async () => {
    const user = userEvent.setup();
    const order = [];
    requestsApi.updateRequestItems.mockImplementation(async () => { order.push('update-items'); return updateResult(); });
    requestsApi.performAction.mockImplementation(async () => { order.push('perform-action'); return { data: {} }; });
    renderPage();
    await waitForPanel();

    await user.selectOptions(within(card(2)).getByLabelText('Fuente del ítem'), 'CONSUMIBLES');
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Confirmar — Ítems Requieren Compra');
    await user.click(within(dialog).getByRole('button', { name: 'Sí, Enviar a Cotización' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['update-items', 'perform-action']);
    expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [
      { item_id: 101, supply_source: 'STOCK', item_source: 'EPP' },
      { item_id: 102, supply_source: 'PURCHASE', item_source: 'CONSUMIBLES' },
      { item_id: 103, supply_source: 'PURCHASE' },
      { item_id: 104, supply_source: 'PURCHASE' },
    ]);
    expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      action: 'STOCK_CHECKED',
      acting_role: 'LOGISTICS_COORDINATOR',
      extra_data: { has_stock: false },
    }));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/logistics');
  });
});

describe('LogisticsActionPage — aborta si update-items falla', () => {
  async function confirmPurchaseFlow(user) {
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));
  }

  it('un 409 (ítems ya despachados) NO envía STOCK_CHECKED y muestra el motivo', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue({
      response: {
        status: 409,
        data: { detail: 'Hay ítems con despachos de almacén y ya no se pueden modificar.', code: 'ITEMS_ALREADY_DISPATCHED', item_ids: [101] },
      },
    });
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);

    // Same message in the page banner and in the toast.
    const messages = await screen.findAllByText(/la verificación de stock no se envió/);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    messages.forEach((m) => expect(m).toHaveTextContent('Hay ítems con despachos de almacén y ya no se pueden modificar.'));
    expect(requestsApi.performAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc')).toHaveTextContent('/rq/logistics/42'); // sigue en la pantalla
    // Not stuck "Procesando…": logistics can fix and retry.
    expect(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' })).toBeInTheDocument();
  });

  it('un error de red tampoco envía STOCK_CHECKED', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue(new Error('Network Error'));
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);

    expect((await screen.findAllByText(/No se pudo conectar con el servidor/)).length).toBeGreaterThanOrEqual(1);
    expect(requestsApi.performAction).not.toHaveBeenCalled();
  });

  it('ids devueltos en ignored_item_ids cuentan como fallo (no se guardó todo)', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({ ignored_item_ids: [104] }));
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);

    expect((await screen.findAllByText(/Algunos ítems ya no pertenecen a este requerimiento/)).length).toBeGreaterThanOrEqual(1);
    expect(requestsApi.performAction).not.toHaveBeenCalled();
  });

  it('el aviso queda en una región de alerta para lectores de pantalla', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue({ response: { status: 403, data: {} } });
    renderPage();
    await waitForPanel();

    await confirmPurchaseFlow(user);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent.includes('No tiene permiso para modificar los ítems'))).toBe(true);
  });
});

describe('LogisticsActionPage — stock sin cobertura completa (aviso, no bloqueo)', () => {
  async function markEverythingAsStock(user) {
    for (const n of [1, 2, 3, 4]) {
      await user.click(within(card(n)).getByRole('button', { name: /Atender de Stock/ }));
    }
  }

  it('si marca "todo de stock" con ítems no cubiertos avisa en pantalla y pide confirmación explícita', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await markEverythingAsStock(user);

    expect(screen.getByText('3 ítems de stock sin cobertura completa')).toBeInTheDocument();
    expect(screen.getByText(/Stock parcial: hay 8 de 20 PAR \(faltan 12\)\./)).toBeInTheDocument();
    expect(screen.getByText(/Fuera de catálogo: no pasa por el almacén\./)).toBeInTheDocument();
    expect(screen.getByText(/Sin producto vinculado: no se puede verificar el stock\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Hay ítems de stock sin cobertura completa');
    expect(within(dialog).getByText(/Ítem 2/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Ítem 3/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Ítem 4/)).toBeInTheDocument();
    // Nothing is sent until the explicit confirmation.
    expect(requestsApi.updateRequestItems).not.toHaveBeenCalled();
    expect(requestsApi.performAction).not.toHaveBeenCalled();

    // The safe option has the focus. It is not called "Cancelar": in a flow that has a
    // CANCELADO state that reads as "cancel the RQ".
    expect(within(dialog).getByRole('button', { name: 'Volver y revisar' })).toHaveFocus();
    expect(within(dialog).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    // A screen reader that lands on that button also hears WHICH items are not covered.
    expect(dialog).toHaveAccessibleDescription(/Ítem 2.*Ítem 3.*Ítem 4/s);
  });

  it('cancelar vuelve a la pantalla sin enviar nada', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();
    await markEverythingAsStock(user);

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Volver y revisar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestsApi.updateRequestItems).not.toHaveBeenCalled();
    expect(requestsApi.performAction).not.toHaveBeenCalled();
    // Focus goes back to the button that opened the dialog.
    expect(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' })).toHaveFocus();
  });

  it('confirmar de todos modos NO bloquea: la acción del flujo es la misma (has_stock = true)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();
    await markEverythingAsStock(user);

    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, continuar de todos modos' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    expect(requestsApi.performAction).toHaveBeenCalledWith(42, expect.objectContaining({
      action: 'STOCK_CHECKED',
      extra_data: { has_stock: true },
    }));
    expect(requestsApi.updateRequestItems.mock.calls[0][1].every((d) => d.supply_source === 'STOCK')).toBe(true);
  });

  it('con todo cubierto no hay aviso y el modal es el de siempre', async () => {
    const user = userEvent.setup();
    requestsApi.getStockAvailability.mockResolvedValue({
      data: {
        ...buildAvailability(),
        items: buildAvailability().items.slice(0, 1),
      },
    });
    requestsApi.getRequest.mockResolvedValue({
      data: buildRequest({ items: buildRequest().items.slice(0, 1) }),
    });
    renderPage();
    await waitForPanel();

    expect(screen.queryByText(/sin cobertura completa/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Confirmar — Todo de Stock');
    expect(within(dialog).getByRole('button', { name: 'Sí, Todo de Stock' })).toBeInTheDocument();
  });
});

describe('LogisticsActionPage — vínculo con el catálogo', () => {
  const PRODUCT = {
    id: 7, product_code: 'MAT-0007', description: 'Cinta de peligro 100 m', unit: 'UND',
    category: 'Otros', available: '40.000',
  };

  it('vincula un ítem sin vincular: guarda al elegirlo y vuelve a consultar la disponibilidad', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [PRODUCT] } });
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({
      updated_item_ids: [104],
      items: [{ id: 104, ...link(7, 'MAT-0007', 'Cinta de peligro 100 m'), is_off_catalog: false }],
    }));
    const refreshed = buildAvailability();
    refreshed.items[3] = availabilityRow(104, 4, {
      requested: '5.000', link_status: 'LINKED',
      inventory_item: { id: 7, product_code: 'MAT-0007', description: 'Cinta de peligro 100 m', unit: 'UND' },
      available_central: '40.000', committed_other_requests: '0.000', available_net: '40.000',
      shortfall: '0.000', coverage: 'FULL',
    });
    requestsApi.getStockAvailability
      .mockResolvedValueOnce({ data: buildAvailability() })
      .mockResolvedValueOnce({ data: refreshed });
    renderPage();
    await waitForPanel();

    await user.type(within(card(4)).getByRole('combobox', { name: /catálogo para el ítem 4/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /MAT-0007/ }));

    await waitFor(() => expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [
      { item_id: 104, inventory_item: 7 },
    ]));
    expect(await within(card(4)).findByText('Stock suficiente')).toBeInTheDocument();
    expect(within(card(4)).getByText('MAT-0007')).toBeInTheDocument();
    expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(2);
    // The suggestion follows the new coverage and the family is NOT invented for a non-EPP product.
    expect(within(card(4)).getByRole('button', { name: /Atender de Stock/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card(4)).getByLabelText('Fuente del ítem')).toHaveValue('');
    // Focus lands on the new "Cambiar producto" button.
    expect(within(card(4)).getByRole('button', { name: 'Cambiar el producto vinculado del ítem 4' })).toHaveFocus();
  });

  it('un producto EPP propone la fuente EPP sin pisar una ya elegida', async () => {
    const user = userEvent.setup();
    const epp = { ...PRODUCT, id: 8, product_code: 'EPP-0008', category: 'EPP' };
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [epp] } });
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({ updated_item_ids: [104] }));
    renderPage();
    await waitForPanel();

    await user.type(within(card(4)).getByRole('combobox', { name: /catálogo para el ítem 4/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /EPP-0008/ }));

    await waitFor(() => expect(within(card(4)).getByLabelText('Fuente del ítem')).toHaveValue('EPP'));
    expect(within(card(4)).getByText('Propuesta según el producto.')).toBeInTheDocument();
  });

  it('si guardar el vínculo falla muestra el motivo junto al ítem y no cambia nada', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [PRODUCT] } });
    requestsApi.updateRequestItems.mockRejectedValue({
      response: { status: 409, data: { detail: 'El requerimiento ya está cerrado.', code: 'REQUEST_TERMINAL', item_ids: [] } },
    });
    renderPage();
    await waitForPanel();

    await user.type(within(card(4)).getByRole('combobox', { name: /catálogo para el ítem 4/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /MAT-0007/ }));

    expect(await within(card(4)).findByRole('alert')).toHaveTextContent('El requerimiento ya está cerrado.');
    expect(within(card(4)).getByText('Sin vincular', { selector: 'span' })).toBeInTheDocument();
    expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(1); // sin refresco
  });

  it('marca un ítem vinculado como fuera de catálogo', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({ updated_item_ids: [101] }));
    renderPage();
    await waitForPanel();

    await user.click(within(card(1)).getByRole('button', { name: 'Marcar el ítem 1 como fuera de catálogo' }));

    await waitFor(() => expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [
      { item_id: 101, is_off_catalog: true },
    ]));
  });

  it('"Cambiar producto" abre el buscador con el foco y "Cancelar" lo cierra devolviendo el foco', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await user.click(within(card(1)).getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' }));
    expect(within(card(1)).getByRole('combobox', { name: /catálogo para el ítem 1/ })).toHaveFocus();

    await user.click(within(card(1)).getByRole('button', { name: 'Cancelar el cambio de producto del ítem 1' }));
    expect(within(card(1)).queryByRole('combobox', { name: /catálogo para el ítem 1/ })).not.toBeInTheDocument();
    expect(within(card(1)).getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' })).toHaveFocus();
    expect(requestsApi.updateRequestItems).not.toHaveBeenCalled();
  });

  it('un ítem fuera de catálogo puede vincularse a un producto', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [PRODUCT] } });
    requestsApi.updateRequestItems.mockResolvedValue(updateResult({ updated_item_ids: [103] }));
    renderPage();
    await waitForPanel();

    await user.click(within(card(3)).getByRole('button', { name: 'Vincular el ítem 3 a un producto del catálogo' }));
    await user.type(within(card(3)).getByRole('combobox', { name: /catálogo para el ítem 3/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /MAT-0007/ }));

    await waitFor(() => expect(requestsApi.updateRequestItems).toHaveBeenCalledWith(42, [
      { item_id: 103, inventory_item: 7 },
    ]));
  });
});

describe('LogisticsActionPage — otros estados', () => {
  it('fuera de la verificación de stock no consulta la disponibilidad', async () => {
    requestsApi.getRequest.mockResolvedValue({ data: buildRequest({ status: 'REQUIRES_PURCHASE' }) });
    renderPage();

    expect(await screen.findByText('Solicitud de Compra', { selector: 'span' })).toBeInTheDocument();
    expect(requestsApi.getStockAvailability).not.toHaveBeenCalled();
  });

  it('un RQ inexistente muestra "no encontrado"', async () => {
    requestsApi.getRequest.mockRejectedValue({ response: { status: 404 } });
    renderPage();

    expect(await screen.findByText('Requerimiento no encontrado')).toBeInTheDocument();
  });
});
