import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockCheckPanel from './StockCheckPanel';
import * as requestsApi from '../../api/requests';

// SYSPCC-026 (ronda 2) — complements StockCheckPanel.focus.test.jsx (the red findings of the
// accessibility review): what the search box keeps after a failed save, and focus requests that
// repeat on the same line or move from line to line.
configure({ asyncUtilTimeout: 4000 });
vi.mock('../../api/requests');

const line = (id, n, over = {}) => ({
  id, line_number: n, description: `Ítem ${n}`, quantity: '10.000', unit: 'UND',
  inventory_item: 5, inventory_item_code: `EPP-000${n}`, inventory_item_description: `Casco ${n}`,
  inventory_item_unit: 'UND', is_off_catalog: false, item_source: 'EPP', link_confirmed: false, ...over,
});
const row = (itemId, n) => ({
  item_id: itemId, line_number: n, description: '', unit: 'UND', requested: '10.000',
  inventory_item: { id: 5, product_code: `EPP-000${n}`, description: `Casco ${n}`, unit: 'UND' },
  link_status: 'LINKED', link_confirmed: false, available_central: '12.000',
  committed_other_requests: '0.000', available_net: '12.000', shortfall: '0.000', coverage: 'FULL',
});
const ready = (ids) => ({ status: 'ready', byItem: Object.fromEntries(ids.map((id, i) => [id, row(id, i + 1)])) });

const NEW_PRODUCT = { id: 9, product_code: 'EPP-0009', description: 'Casco amarillo', unit: 'UND', category: 'EPP', available: '3.000' };

function renderPanel({ items, onLinkChange }) {
  return render(
    <StockCheckPanel
      items={items}
      availability={ready(items.map((i) => i.id))}
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
const change = (n) => screen.getByRole('button', { name: `Cambiar el producto vinculado del ítem ${n}` });
const searchBox = (n) => screen.getByRole('combobox', { name: new RegExp(`Buscar el producto del catálogo para el ítem ${n}`) });

let fixup;
afterEach(() => fixup?.disconnect());

beforeEach(() => {
  vi.resetAllMocks();
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [NEW_PRODUCT] } });
});

describe('StockCheckPanel — tras un guardado fallido desde el buscador', () => {
  it('conserva el texto que la persona escribió y el foco queda en el buscador (aunque el navegador quite el foco a lo deshabilitado)', async () => {
    // Same browser rule as in StockCheckPanel.focus.test.jsx: a control that becomes disabled loses the focus.
    fixup = new MutationObserver((records) => {
      records.forEach(({ target: el }) => {
        if (el.disabled && el === document.activeElement) {
          el.disabled = false;
          el.blur();
          el.disabled = true;
        }
      });
    });
    fixup.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] });

    const user = userEvent.setup();
    let release;
    const onLinkChange = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    renderPanel({ items: [line(11, 1)], onLinkChange });

    await user.click(change(1));
    await user.type(searchBox(1), 'amarillo');
    await user.click(await screen.findByRole('option', { name: /EPP-0009/ }));
    await screen.findByText('Guardando el vínculo…');
    expect(active()).toBe(searchBox(1));

    release({ ok: false, message: 'No se pudo guardar el vínculo.' });
    await screen.findByRole('alert');

    await waitFor(() => expect(searchBox(1)).toHaveValue('amarillo'));
    expect(active()).toBe(searchBox(1));
    expect(searchBox(1)).toHaveAttribute('aria-invalid', 'true');
  });

  it('puede volver a elegir sin escribir de nuevo, solo con el teclado: la segunda elección sale con el mismo producto', async () => {
    const user = userEvent.setup();
    const onLinkChange = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'Demasiadas solicitudes seguidas.' })
      .mockResolvedValueOnce({ ok: true });
    renderPanel({ items: [line(11, 1)], onLinkChange });

    await user.click(change(1));
    await user.type(searchBox(1), 'amarillo');
    await user.click(await screen.findByRole('option', { name: /EPP-0009/ }));
    await screen.findByRole('alert');
    await waitFor(() => expect(searchBox(1)).toHaveValue('amarillo'));

    // The list stays closed (it would cover the error); the arrows open it on the same results.
    expect(screen.queryByRole('listbox', { name: 'Productos del catálogo' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onLinkChange).toHaveBeenCalledTimes(2));
    expect(onLinkChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 11 }), { inventory_item: 9 });
  });
});

describe('StockCheckPanel — el foco acompaña la resolución de cada línea', () => {
  it('cada "Confirmar producto" deja el foco en el "Cambiar…" de su propia línea', async () => {
    const user = userEvent.setup();
    renderPanel({ items: [line(11, 1), line(12, 2)] });

    await user.click(screen.getByRole('button', { name: 'Confirmar el producto vinculado del ítem 1' }));
    await waitFor(() => expect(active()).toBe(change(1)));

    await user.click(screen.getByRole('button', { name: 'Confirmar el producto vinculado del ítem 2' }));
    await waitFor(() => expect(active()).toBe(change(2)));
  });

  it('el foco se puede pedir dos veces seguidas para la misma línea (cambiar y cancelar, dos veces)', async () => {
    const user = userEvent.setup();
    renderPanel({ items: [line(11, 1, { link_confirmed: true })] });

    for (let i = 0; i < 2; i += 1) {
      await user.click(change(1));
      await user.click(screen.getByRole('button', { name: 'Cancelar el cambio de producto del ítem 1' }));
      await waitFor(() => expect(active()).toBe(change(1)));
    }
  });

  it('con el teclado: Enter sobre "Confirmar producto" deja el foco en la misma línea', async () => {
    const user = userEvent.setup();
    renderPanel({ items: [line(11, 1)] });

    screen.getByRole('button', { name: 'Confirmar el producto vinculado del ítem 1' }).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(active()).toBe(change(1)));
  });
});
