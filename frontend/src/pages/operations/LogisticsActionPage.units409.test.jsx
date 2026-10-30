import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import LocationProbe from '../../test/LocationProbe';
import LogisticsActionPage from './LogisticsActionPage';
import { useAuth } from '../../context/useAuth';
import * as requestsApi from '../../api/requests';
import * as suppliersApi from '../../api/suppliers';

// SYSPCC-026 (ronda 4) — la verificación de stock ante las novedades de la API:
//  - una línea pedida en otra unidad que la del producto (coverage NOT_COMPARABLE): se dice, no se
//    sugiere nada y no se afirma cobertura, en la tabla y en el panel;
//  - el 409 ITEMS_ALREADY_RECEIVED (y el de despachos) marca las líneas afectadas, explica por qué
//    y deja la pantalla utilizable.
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/requests');
vi.mock('../../api/suppliers');

const link = (id, code, description, unit) => ({
  inventory_item: id, inventory_item_code: code, inventory_item_description: description,
  inventory_item_unit: unit, is_off_catalog: false,
});

function buildRequest() {
  return {
    id: 42, rq_number: 'RQ-2026-0042', status: 'VALIDATED', flow: 'OPERATIONS',
    description: 'Material para frente 3', priority: 'NORMAL', project: 1, project_code: 'PRY-001',
    project_name: 'Minera Yanaocha', requested_by_name: 'Op Erator', fecha_necesidad: '2026-12-31',
    items: [
      { id: 101, line_number: 1, description: 'Casco blanco', quantity: '2.000', unit: 'CAJA', stock_almacen_obra: '0.000', item_source: 'EPP', ...link(5, 'EPP-0001', 'Casco de seguridad blanco', 'EA') },
      { id: 102, line_number: 2, description: 'Guantes de cuero', quantity: '4.000', unit: 'PAR', stock_almacen_obra: '0.000', item_source: '', ...link(6, 'EPP-0002', 'Guantes de cuero reforzado', 'PAR') },
      { id: 104, line_number: 3, description: 'Cinta señalizadora', quantity: '5.000', unit: 'UND', stock_almacen_obra: '0.000', item_source: '', inventory_item: null, is_off_catalog: false },
    ],
  };
}

const availabilityRow = (itemId, line, over = {}) => ({
  item_id: itemId, line_number: line, description: '', unit: 'UND', requested: '10.000',
  inventory_item: null, link_status: 'UNLINKED', available_central: null, committed_other_requests: null,
  committed_earlier_lines: null, product_unit: null, unit_mismatch: false, available_net: null,
  shortfall: null, coverage: null, ...over,
});

function buildAvailability() {
  return {
    request_id: 42,
    items: [
      // Asked in CAJA, the stock is in EA: nothing is compared.
      availabilityRow(101, 1, {
        requested: '2.000', unit: 'CAJA', link_status: 'LINKED', product_unit: 'EA', unit_mismatch: true,
        inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'EA' },
        available_central: '10.000', committed_other_requests: '0.000', committed_earlier_lines: '0.000',
        available_net: '10.000', shortfall: null, coverage: 'NOT_COMPARABLE',
      }),
      availabilityRow(102, 2, {
        requested: '4.000', unit: 'PAR', link_status: 'LINKED', product_unit: 'PAR',
        inventory_item: { id: 6, product_code: 'EPP-0002', description: 'Guantes de cuero reforzado', unit: 'PAR' },
        available_central: '8.000', committed_other_requests: '0.000', committed_earlier_lines: '0.000',
        available_net: '8.000', shortfall: '0.000', coverage: 'FULL',
      }),
      availabilityRow(104, 3, { requested: '5.000', link_status: 'UNLINKED' }),
    ],
    summary: { items_total: 3, full: 1, partial: 0, none: 0, not_comparable: 1, off_catalog: 0, unlinked: 1 },
  };
}

const failure = (status, data) => ({ response: { status, data } });

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
const choose = (user, n, kind) =>
  user.click(within(card(n)).getByRole('button', { name: kind === 'stock' ? /Atender de Stock/ : /Requiere Compra/ }));

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

describe('LogisticsActionPage — línea pedida en otra unidad que la del producto', () => {
  it('la tabla muestra "Unidad distinta" y la cifra del stock con la unidad del producto', async () => {
    renderPage();
    await waitForPanel();

    const table = screen.getByRole('table');
    const row = within(table).getByText('Casco blanco').closest('tr');
    expect(within(row).getByText('Unidad distinta')).toBeInTheDocument();          // badge
    expect(within(row).queryByText(/Stock suficiente|Stock parcial|Sin stock/)).not.toBeInTheDocument();
    expect(within(row).getByText('EA')).toBeInTheDocument();                       // the figure's unit (the line's column says CAJA)
    expect(within(row).getByText('CAJA')).toBeInTheDocument();
    // A line in the same unit shows no extra unit next to its figure.
    const normal = within(table).getByText('Guantes de cuero').closest('tr');
    expect(within(normal).getAllByText('PAR')).toHaveLength(1);
  });

  it('el panel lo explica, no lo sugiere y pide decidir; las demás líneas siguen sugiriendo', async () => {
    renderPage();
    await waitForPanel();

    const mismatch = card(1);
    expect(within(mismatch).getByText('Unidad distinta: el stock está en EA y el RQ pide en CAJA.')).toBeInTheDocument();
    expect(within(mismatch).queryByText('(sugerido)')).not.toBeInTheDocument();
    expect(within(card(2)).getByText('(sugerido)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marque todos los ítems arriba' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('todo de stock con esa línea: el diálogo avisa que no se pudo verificar y el comentario no inventa una cifra', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await choose(user, 1, 'stock');
    await choose(user, 2, 'stock');
    await choose(user, 3, 'stock');
    await user.click(screen.getByRole('button', { name: 'Confirmar — Todo de Stock' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Hay ítems de stock sin cobertura completa');
    expect(within(dialog).getByText(/Ítem 1/).closest('li')).toHaveTextContent(
      'Unidad distinta: el stock está en EA y el RQ pide en CAJA. No se pudo verificar la cobertura.',
    );
    expect(within(dialog).queryByText(/Ítem 2/)).not.toBeInTheDocument();           // covered: no warning
    expect(requestsApi.performAction).not.toHaveBeenCalled();                       // asks, never blocks

    await user.click(within(dialog).getByRole('button', { name: 'Sí, continuar de todos modos' }));

    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
    const { comments, extra_data: extra } = requestsApi.performAction.mock.calls[0][1];
    expect(extra).toEqual({ has_stock: true });
    expect(comments).toContain('Casco blanco: Atender de stock (unidad distinta: stock en EA, RQ en CAJA)');
    expect(comments).toContain('Guantes de cuero: Atender de stock (disponible neto: 8)');
  });

  it('mandarla a compra no pide confirmación extra', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPanel();

    await choose(user, 1, 'purchase');
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));

    expect(screen.getByRole('dialog')).not.toHaveTextContent('sin cobertura completa');
  });
});

describe('LogisticsActionPage — 409 de update-items: líneas ya recibidas o despachadas', () => {
  const PRODUCT = { id: 7, product_code: 'MAT-0007', description: 'Cinta de peligro 100 m', unit: 'UND', category: 'Otros', available: '40.000' };
  const RECEIVED_DETAIL = 'Algunos ítems ya fueron recibidos en el almacén y no se puede cambiar su producto de catálogo ni marcarlos como fuera de catálogo.';

  async function pickForItem3(user) {
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [PRODUCT] } });
    await user.type(within(card(3)).getByRole('combobox', { name: /catálogo para el ítem 3/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /MAT-0007/ }));
  }

  it('al cambiar el producto de una línea ya recibida: la marca, dice cuál y por qué, y la pantalla sigue en pie', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue(
      failure(409, { detail: RECEIVED_DETAIL, code: 'ITEMS_ALREADY_RECEIVED', item_ids: [104] }),
    );
    renderPage();
    await waitForPanel();

    await pickForItem3(user);

    const target = card(3);
    expect(await within(target).findByRole('alert')).toHaveTextContent(
      'El ítem 3 ya fue recibido en el almacén: no se puede cambiar su producto ni marcarlo como fuera de catálogo.',
    );
    // Marked (with text, not only color) and only that line.
    expect(target).toHaveTextContent('Ya se recibió en el almacén: su producto no se puede cambiar ni marcar como fuera de catálogo.');
    expect(target.className).toContain('ring-red');
    expect(card(1)).not.toHaveTextContent('Ya se recibió');
    expect(card(2)).not.toHaveTextContent('Ya se recibió');
    // Nothing broke: same page, the search box is usable again and the check can still be sent.
    expect(screen.getByTestId('loc')).toHaveTextContent('/rq/logistics/42');
    expect(within(target).getByRole('combobox', { name: /catálogo para el ítem 3/ })).toBeEnabled();
    expect(requestsApi.getStockAvailability).toHaveBeenCalledTimes(1);               // nothing was refreshed as if it had saved
    await choose(user, 1, 'purchase');
    await choose(user, 3, 'purchase');
    expect(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' })).not.toHaveAttribute('aria-disabled');
  });

  it('un 409 sin texto del servidor igual explica qué pasó (nunca muestra el código)', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue(
      failure(409, { code: 'ITEMS_ALREADY_RECEIVED', item_ids: [] }),
    );
    renderPage();
    await waitForPanel();

    await pickForItem3(user);

    const alert = await within(card(3)).findByRole('alert');
    expect(alert).toHaveTextContent(/^Algunos ítems ya fueron recibidos en el almacén/);
    expect(document.body).not.toHaveTextContent('ITEMS_ALREADY_RECEIVED');
  });

  it('si el 409 llega al confirmar con varias líneas, se marcan todas, no se envía y se puede reintentar', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems
      .mockRejectedValueOnce(failure(409, {
        detail: 'Algunos ítems ya tienen despachos de almacén y no se pueden modificar.',
        code: 'ITEMS_ALREADY_DISPATCHED', item_ids: [101, 102],
      }))
      .mockResolvedValueOnce(updateResult());
    renderPage();
    await waitForPanel();

    await choose(user, 1, 'purchase');
    await choose(user, 2, 'purchase');
    await choose(user, 3, 'purchase');
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));

    expect((await screen.findAllByText(/la verificación de stock no se envió/)).length).toBeGreaterThanOrEqual(1);
    expect(requestsApi.performAction).not.toHaveBeenCalled();
    expect(card(1)).toHaveTextContent('Ya tiene despachos del almacén: no se puede modificar.');
    expect(card(2)).toHaveTextContent('Ya tiene despachos del almacén: no se puede modificar.');
    expect(card(3)).not.toHaveTextContent('Ya tiene despachos');

    // Same click again: it saves and sends exactly once.
    await user.click(screen.getByRole('button', { name: 'Confirmar — Enviar a Cotización' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, Enviar a Cotización' }));
    await waitFor(() => expect(requestsApi.performAction).toHaveBeenCalledTimes(1));
  });

  it('otro 409 (RQ en estado final) no marca ninguna línea', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue(failure(409, {
      detail: 'El requerimiento ya está en un estado final y sus ítems no se pueden modificar.',
      code: 'REQUEST_TERMINAL', item_ids: [],
    }));
    renderPage();
    await waitForPanel();

    await pickForItem3(user);

    expect(await within(card(3)).findByRole('alert')).toHaveTextContent('El requerimiento ya está en un estado final');
    expect(document.body).not.toHaveTextContent(/Ya se recibió|Ya tiene despachos/);
  });
});
