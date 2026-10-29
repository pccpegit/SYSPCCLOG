import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockCheckPanel from './StockCheckPanel';
import * as requestsApi from '../../api/requests';

// SYSPCC-026 (QA ronda 2) — keyboard focus in the stock check, as found by the accessibility
// review in a real browser (handoff: "FASE 1 (ronda 2) — accessibility-ux", findings 🔴 2).
//
// The logistics clerk goes line by line with the keyboard. When the control that had the focus
// disappears (a "Confirmar…" button that is no longer needed, or an input that is disabled while
// the link is being saved) the focus must land on a control of the SAME line, never on <body>:
// otherwise every line sends the person back to the top of the page.
//
// jsdom keeps `document.activeElement` honest for removed and disabled elements, so these are
// real assertions, not class checks.
configure({ asyncUtilTimeout: 4000 });
vi.mock('../../api/requests');

const proposedProduct = (over = {}) => ({
  id: 11, line_number: 1, description: 'Casco blanco', quantity: '10.000', unit: 'UND',
  inventory_item: 5, inventory_item_code: 'EPP-0001', inventory_item_description: 'Casco de seguridad blanco',
  inventory_item_unit: 'UND', is_off_catalog: false, item_source: 'EPP', link_confirmed: false, ...over,
});
const proposedOffCatalog = (over = {}) => ({
  id: 13, line_number: 1, description: 'Servicio de flete', quantity: '1.000', unit: 'GLB',
  inventory_item: null, is_off_catalog: true, item_source: '', link_confirmed: false, ...over,
});
const row = (itemId, over = {}) => ({
  item_id: itemId, line_number: 1, description: '', unit: 'UND', requested: '10.000',
  inventory_item: null, link_status: 'UNLINKED', link_confirmed: false, available_central: null,
  committed_other_requests: null, available_net: null, shortfall: null, coverage: null, ...over,
});
const productRow = () => row(11, {
  link_status: 'LINKED',
  inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND' },
  available_central: '12.000', committed_other_requests: '0.000', available_net: '12.000', shortfall: '0.000',
  coverage: 'FULL',
});
const ready = (rows) => ({ status: 'ready', byItem: Object.fromEntries(rows.map((r) => [r.item_id, r])) });

const NEW_PRODUCT = { id: 9, product_code: 'EPP-0009', description: 'Casco amarillo', unit: 'UND', category: 'EPP', available: '3.000' };

function renderPanel({ items, availability, onLinkChange }) {
  return render(
    <StockCheckPanel
      items={items}
      availability={availability}
      onRetryAvailability={vi.fn()}
      onLinkChange={onLinkChange ?? vi.fn().mockResolvedValue({ ok: true })}
      submitting={false}
      notes=""
      onNotes={vi.fn()}
      onAction={vi.fn()}
    />,
  );
}

const active = () => document.activeElement;

/**
 * jsdom does not implement the browser's "focus fixup": when the focused control becomes
 * disabled, Chromium moves the focus to <body> (found by the accessibility review in a real
 * browser). This reproduces that rule so a control that is disabled while it saves is seen
 * for what it does to a keyboard user.
 */
let fixup;
function installFocusFixup() {
  fixup = new MutationObserver((records) => {
    records.forEach((record) => {
      const el = record.target;
      if (el.disabled && el === document.activeElement) {
        // jsdom's blur() ignores a disabled element (it is not a focusable area any more):
        // enable it for an instant, drop the focus and disable it again.
        el.disabled = false;
        el.blur();
        el.disabled = true;
      }
    });
  });
  fixup.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
}

afterEach(() => {
  fixup?.disconnect();
});

beforeEach(() => {
  vi.resetAllMocks();
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [NEW_PRODUCT] } });
});

describe('StockCheckPanel — el foco no cae al <body> al resolver un ítem', () => {
  it('tras "Confirmar producto" el foco queda en "Cambiar el producto vinculado" del mismo ítem', async () => {
    const user = userEvent.setup();
    renderPanel({ items: [proposedProduct()], availability: ready([productRow()]) });

    await user.click(screen.getByRole('button', { name: 'Confirmar el producto vinculado del ítem 1' }));
    await waitFor(() => expect(screen.queryByText(/Por confirmar/)).not.toBeInTheDocument());

    expect(active()).not.toBe(document.body);
    expect(active()).toBe(screen.getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' }));
  });

  it('tras "Confirmar fuera de catálogo" el foco queda en un control del mismo ítem', async () => {
    const user = userEvent.setup();
    renderPanel({
      items: [proposedOffCatalog()],
      availability: ready([row(13, { link_status: 'OFF_CATALOG' })]),
    });

    await user.click(screen.getByRole('button', { name: 'Confirmar el ítem 1 como fuera de catálogo' }));
    await waitFor(() => expect(screen.queryByText(/Por confirmar/)).not.toBeInTheDocument());

    expect(active()).not.toBe(document.body);
    expect(active()).toBe(screen.getByRole('button', { name: 'Vincular el ítem 1 a un producto del catálogo' }));
  });
});

describe('StockCheckPanel — un guardado fallido desde el buscador no deja al teclado sin foco', () => {
  it('el foco vuelve al buscador del ítem (el campo se deshabilita mientras guarda y lo pierde)', async () => {
    installFocusFixup();
    const user = userEvent.setup();
    let release;
    const onLinkChange = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    renderPanel({ items: [proposedProduct()], availability: ready([productRow()]), onLinkChange });

    await user.click(screen.getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' }));
    await user.type(screen.getByRole('combobox', { name: /Buscar el producto del catálogo/ }), 'amarillo');
    await user.click(await screen.findByRole('option', { name: /EPP-0009/ }));
    await screen.findByText('Guardando el vínculo…');

    release({ ok: false, message: 'El requerimiento ya está en un estado final y sus ítems no se pueden modificar.' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('estado final');

    const search = screen.getByRole('combobox', { name: /Buscar el producto del catálogo/ });
    expect(search).toBeEnabled();
    expect(active()).not.toBe(document.body);
    expect(active()).toBe(search);
  });

  it('el mensaje de error queda enlazado al buscador para quien lo vuelve a enfocar', async () => {
    const user = userEvent.setup();
    const onLinkChange = vi.fn().mockResolvedValue({ ok: false, message: 'Demasiadas solicitudes seguidas.' });
    renderPanel({ items: [proposedProduct()], availability: ready([productRow()]), onLinkChange });

    await user.click(screen.getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' }));
    await user.type(screen.getByRole('combobox', { name: /Buscar el producto del catálogo/ }), 'amarillo');
    await user.click(await screen.findByRole('option', { name: /EPP-0009/ }));
    await screen.findByRole('alert');

    const search = screen.getByRole('combobox', { name: /Buscar el producto del catálogo/ });
    expect(search).toHaveAttribute('aria-invalid', 'true');
    expect(search).toHaveAccessibleDescription(expect.stringContaining('Demasiadas solicitudes seguidas.'));
    expect(within(search.closest('li')).getByRole('alert')).toHaveTextContent('Demasiadas solicitudes seguidas.');
  });
});
