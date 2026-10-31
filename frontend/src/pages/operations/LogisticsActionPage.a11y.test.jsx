import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import LogisticsActionPage from './LogisticsActionPage';
import { useAuth } from '../../context/useAuth';
import * as requestsApi from '../../api/requests';
import * as suppliersApi from '../../api/suppliers';

// SYSPCC-026 (QA ronda 2) — what the accessibility review found in a real browser, written as
// tests of the REAL page (parent and panel together, so the order in which the page updates its
// state is the real one):
//
//   1. keyboard focus: resolving a line must leave the focus on a control of that same line, never
//      on <body>;
//   2. dark theme: the zebra rows of the items table need a `dark:` counterpart, because
//      `bg-gray-50/40` is not covered by the dark layer (the "auto" theme is dark from 19:00 to 07:00).
//
// jsdom has no "focus fixup" (a control that becomes disabled loses the focus in a browser) and
// computes no CSS, so the first is emulated below and the second is checked on the classes.
configure({ asyncUtilTimeout: 4000 });
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

function buildRequest() {
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
      { id: 101, line_number: 1, description: 'Casco blanco', quantity: '10.000', unit: 'UND', stock_almacen_obra: '0.000', item_source: 'EPP', link_confirmed: false, ...link(5, 'EPP-0001', 'Casco de seguridad blanco') },
      { id: 102, line_number: 2, description: 'Guantes de cuero', quantity: '20.000', unit: 'PAR', stock_almacen_obra: '0.000', item_source: '', link_confirmed: true, ...link(6, 'EPP-0002', 'Guantes de cuero reforzado', 'PAR') },
      { id: 103, line_number: 3, description: 'Cinta señalizadora', quantity: '5.000', unit: 'UND', stock_almacen_obra: '0.000', item_source: '', inventory_item: null, is_off_catalog: false, link_confirmed: false },
    ],
  };
}

const linkedRow = (itemId, line, product, over = {}) => ({
  item_id: itemId, line_number: line, description: '', unit: 'UND', requested: '10.000',
  inventory_item: product, link_status: 'LINKED', link_confirmed: true,
  available_central: '15.000', committed_other_requests: '0.000', available_net: '15.000',
  shortfall: '0.000', coverage: 'FULL', ...over,
});
const unlinkedRow = (itemId, line) => ({
  item_id: itemId, line_number: line, description: '', unit: 'UND', requested: '5.000',
  inventory_item: null, link_status: 'UNLINKED', link_confirmed: false, available_central: null,
  committed_other_requests: null, available_net: null, shortfall: null, coverage: null,
});

const CASCO = { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND' };
const GUANTES = { id: 6, product_code: 'EPP-0002', description: 'Guantes de cuero reforzado', unit: 'PAR' };
const NEW_PRODUCT = { id: 9, product_code: 'EPP-0009', description: 'Cinta amarilla', unit: 'UND', category: 'Otros', available: '40.000' };

function availability(rows) {
  return { request_id: 42, rq_number: 'RQ-2026-0042', items: rows, summary: { items_total: rows.length } };
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/rq/logistics/:id" element={<LogisticsActionPage />} />
      <Route path="/rq/logistics" element={<p>Panel logístico</p>} />
    </Routes>,
    { route: '/rq/logistics/42' },
  );
}

const card = (n) => screen.getByRole('group', { name: `Origen de atención del ítem ${n}` }).closest('li');
const waitForPanel = () => screen.findByRole('heading', { name: 'Decisión por Ítem' });
const active = () => document.activeElement;

/** A browser moves the focus to <body> when the focused control becomes disabled. */
let fixup;
function installFocusFixup() {
  fixup = new MutationObserver((records) => {
    records.forEach((record) => {
      const el = record.target;
      if (el.disabled && el === document.activeElement) {
        el.disabled = false; // jsdom's blur() ignores a disabled element
        el.blur();
        el.disabled = true;
      }
    });
  });
  fixup.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
}

beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ primaryRole: 'LOGISTICS_COORDINATOR' });
  requestsApi.getRequest.mockResolvedValue({ data: buildRequest() });
  requestsApi.getStockAvailability.mockResolvedValue({
    data: availability([linkedRow(101, 1, CASCO, { link_confirmed: false }), linkedRow(102, 2, GUANTES), unlinkedRow(103, 3)]),
  });
  requestsApi.getApprovals.mockResolvedValue({ data: { results: [] } });
  requestsApi.performAction.mockResolvedValue({ data: {} });
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [NEW_PRODUCT] } });
  suppliersApi.getQuotations.mockResolvedValue({ data: { results: [] } });
  installFocusFixup();
});

afterEach(() => {
  fixup?.disconnect();
});

const saved = (over = {}) => ({
  data: { detail: 'Ítems actualizados.', updated_item_ids: [], unchanged_item_ids: [], ignored_item_ids: [], items: [], ...over },
});

describe('LogisticsActionPage — el foco queda en la misma línea al resolver un ítem', () => {
  it('confirmar el producto propuesto deja el foco en "Cambiar el producto vinculado" de esa línea', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(saved({
      updated_item_ids: [101],
      items: [{ id: 101, ...link(5, 'EPP-0001', 'Casco de seguridad blanco'), link_confirmed: true }],
    }));
    requestsApi.getStockAvailability
      .mockResolvedValueOnce({ data: availability([linkedRow(101, 1, CASCO, { link_confirmed: false }), linkedRow(102, 2, GUANTES), unlinkedRow(103, 3)]) })
      .mockResolvedValue({ data: availability([linkedRow(101, 1, CASCO), linkedRow(102, 2, GUANTES), unlinkedRow(103, 3)]) });
    renderPage();
    await waitForPanel();

    await user.click(within(card(1)).getByRole('button', { name: 'Confirmar el producto vinculado del ítem 1' }));
    await waitFor(() => expect(within(card(1)).queryByText(/Por confirmar/)).not.toBeInTheDocument());

    expect(active()).not.toBe(document.body);
    expect(active()).toBe(within(card(1)).getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' }));
  });

  it('vincular una línea sin vincular desde el buscador deja el foco en esa línea', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(saved({
      updated_item_ids: [103],
      items: [{ id: 103, ...link(9, 'EPP-0009', 'Cinta amarilla'), link_confirmed: true }],
    }));
    requestsApi.getStockAvailability
      .mockResolvedValueOnce({ data: availability([linkedRow(101, 1, CASCO), linkedRow(102, 2, GUANTES), unlinkedRow(103, 3)]) })
      .mockResolvedValue({ data: availability([linkedRow(101, 1, CASCO), linkedRow(102, 2, GUANTES), linkedRow(103, 3, NEW_PRODUCT, { requested: '5.000' })]) });
    renderPage();
    await waitForPanel();

    await user.type(within(card(3)).getByRole('combobox', { name: /Buscar el producto del catálogo para el ítem 3/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /EPP-0009/ }));
    await waitFor(() => expect(within(card(3)).getByText('EPP-0009')).toBeInTheDocument());

    expect(active()).not.toBe(document.body);
    expect(card(3).contains(active())).toBe(true);
  });

  it('cambiar el producto de una línea vinculada deja el foco en "Cambiar el producto vinculado"', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(saved({
      updated_item_ids: [102],
      items: [{ id: 102, ...link(9, 'EPP-0009', 'Cinta amarilla'), link_confirmed: true }],
    }));
    requestsApi.getStockAvailability
      .mockResolvedValueOnce({ data: availability([linkedRow(101, 1, CASCO), linkedRow(102, 2, GUANTES), unlinkedRow(103, 3)]) })
      .mockResolvedValue({ data: availability([linkedRow(101, 1, CASCO), linkedRow(102, 2, NEW_PRODUCT), unlinkedRow(103, 3)]) });
    renderPage();
    await waitForPanel();

    await user.click(within(card(2)).getByRole('button', { name: 'Cambiar el producto vinculado del ítem 2' }));
    await user.type(within(card(2)).getByRole('combobox', { name: /Buscar el producto del catálogo para el ítem 2/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /EPP-0009/ }));
    await waitFor(() => expect(within(card(2)).getByText('EPP-0009')).toBeInTheDocument());

    expect(active()).toBe(within(card(2)).getByRole('button', { name: 'Cambiar el producto vinculado del ítem 2' }));
  });

  it('marcar una línea vinculada como fuera de catálogo deja el foco en esa línea', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockResolvedValue(saved({
      updated_item_ids: [102],
      items: [{ id: 102, inventory_item: null, inventory_item_code: null, inventory_item_description: null, inventory_item_unit: null, is_off_catalog: true, link_confirmed: true }],
    }));
    requestsApi.getStockAvailability
      .mockResolvedValueOnce({ data: availability([linkedRow(101, 1, CASCO), linkedRow(102, 2, GUANTES), unlinkedRow(103, 3)]) })
      .mockResolvedValue({
        data: availability([
          linkedRow(101, 1, CASCO),
          { ...unlinkedRow(102, 2), link_status: 'OFF_CATALOG', link_confirmed: true },
          unlinkedRow(103, 3),
        ]),
      });
    renderPage();
    await waitForPanel();

    await user.click(within(card(2)).getByRole('button', { name: 'Marcar el ítem 2 como fuera de catálogo' }));
    await waitFor(() => expect(within(card(2)).getByText(/Fuera de catálogo: este ítem no pasa por el almacén/)).toBeInTheDocument());

    expect(active()).not.toBe(document.body);
    expect(card(2).contains(active())).toBe(true);
  });

  it('un guardado fallido desde el buscador devuelve el foco al buscador de esa línea', async () => {
    const user = userEvent.setup();
    requestsApi.updateRequestItems.mockRejectedValue({
      response: { status: 409, data: { detail: 'El requerimiento ya está en un estado final y sus ítems no se pueden modificar.', code: 'REQUEST_TERMINAL', item_ids: [] } },
    });
    renderPage();
    await waitForPanel();

    await user.type(within(card(3)).getByRole('combobox', { name: /Buscar el producto del catálogo para el ítem 3/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: /EPP-0009/ }));
    expect(await within(card(3)).findByRole('alert')).toHaveTextContent('estado final');

    const search = within(card(3)).getByRole('combobox', { name: /Buscar el producto del catálogo para el ítem 3/ });
    expect(search).toBeEnabled();
    expect(active()).not.toBe(document.body);
    expect(active()).toBe(search);
  });
});

describe('LogisticsActionPage — tema oscuro de la tabla de ítems', () => {
  it('toda fila con fondo propio (zebra) tiene su variante dark:', async () => {
    renderPage();
    await waitForPanel();

    const table = screen.getByRole('heading', { name: /Ítems del Requerimiento/ }).closest('div.bg-white').querySelector('table');
    const bodyRows = within(table).getAllByRole('row').slice(1); // without the header row
    expect(bodyRows.length).toBe(3);
    const withOwnBackground = bodyRows.filter((tr) => /(^|\s)bg-/.test(tr.className));
    expect(withOwnBackground.length).toBeGreaterThan(0);
    withOwnBackground.forEach((tr) => {
      expect(tr.className, `fila "${tr.textContent.slice(0, 30)}"`).toMatch(/(^|\s)dark:bg-/);
    });
  });
});
