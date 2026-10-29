import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockCheckPanel from './StockCheckPanel';
import * as requestsApi from '../../api/requests';

// SYSPCC-026 (QA ronda 1): the stock-check panel on its own, with explicit props.
// The page-level behaviour (abort when update-items fails, confirmation modal) lives in
// LogisticsActionPage.test.jsx; here: what the panel decides and hands to its parent.
vi.mock('../../api/requests');

const linked = (over = {}) => ({
  id: 11, line_number: 1, description: 'Casco blanco', quantity: '10.000', unit: 'UND',
  inventory_item: 5, inventory_item_code: 'EPP-0001', inventory_item_description: 'Casco de seguridad blanco',
  inventory_item_unit: 'UND', is_off_catalog: false, item_source: 'EPP', ...over,
});
const unlinked = (over = {}) => ({
  id: 12, line_number: 2, description: 'Cinta señalizadora', quantity: '5.000', unit: 'UND',
  inventory_item: null, is_off_catalog: false, item_source: '', ...over,
});

const row = (itemId, line, over = {}) => ({
  item_id: itemId, line_number: line, description: '', unit: 'UND', requested: '10.000',
  inventory_item: null, link_status: 'UNLINKED', available_central: null,
  committed_other_requests: null, available_net: null, shortfall: null, coverage: null, ...over,
});
const fullRow = (over = {}) => row(11, 1, {
  link_status: 'LINKED', inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND' },
  available_central: '12.000', committed_other_requests: '0.000', available_net: '12.000', shortfall: '0.000',
  coverage: 'FULL', ...over,
});

const ready = (rows = []) => ({ status: 'ready', byItem: Object.fromEntries(rows.map((r) => [r.item_id, r])) });

function renderPanel(props = {}) {
  const handlers = {
    onRetryAvailability: vi.fn(),
    onLinkChange: vi.fn().mockResolvedValue({ ok: true }),
    onNotes: vi.fn(),
    onAction: vi.fn(),
  };
  const view = render(
    <StockCheckPanel
      items={[linked(), unlinked()]}
      availability={ready([fullRow(), row(12, 2)])}
      submitting={false}
      notes=""
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

const group = (n) => screen.getByRole('group', { name: `Origen de atención del ítem ${n}` });
const confirmButton = () => screen.getByRole('button', { name: /^(Confirmar —|Marque todos|Procesando)/ });

beforeEach(() => {
  vi.clearAllMocks();
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 0, results: [] } });
});

describe('StockCheckPanel — confirmar', () => {
  it('sin ítems lo dice y no hay nada que confirmar', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({ items: [], availability: ready() });

    expect(screen.getByText('Sin ítems registrados.')).toBeInTheDocument();
    expect(confirmButton()).toHaveTextContent('Marque todos los ítems arriba');
    await user.click(confirmButton());
    expect(onAction).not.toHaveBeenCalled();
  });

  it('mientras falte decidir un ítem el botón avisa por qué y no envía', async () => {
    const user = userEvent.setup();
    // Item 1 is covered (suggested), item 2 has no data at all: nothing suggested for it.
    const { onAction } = renderPanel({ availability: { status: 'ready', byItem: { 11: fullRow() } } });

    expect(confirmButton()).toHaveTextContent('Marque todos los ítems arriba');
    expect(confirmButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Indique de dónde se atiende cada ítem.')).toBeInTheDocument();
    expect(confirmButton()).toHaveAccessibleDescription('Indique de dónde se atiende cada ítem.');

    await user.click(confirmButton());
    expect(onAction).not.toHaveBeenCalled();

    await user.click(within(group(2)).getByRole('button', { name: /Requiere Compra/ }));
    expect(confirmButton()).toHaveTextContent('Confirmar — Enviar a Cotización');
    expect(confirmButton()).not.toHaveAttribute('aria-disabled');
  });

  it('entrega al padre la decisión, el resumen por ítem, las decisiones y los avisos', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel();

    await user.click(confirmButton());

    expect(onAction).toHaveBeenCalledTimes(1);
    const [allFromStock, summary, decisions, warnings] = onAction.mock.calls[0];
    expect(allFromStock).toBe(false);                                  // item 2 goes to purchase
    expect(summary).toBe(
      'Casco blanco: Atender de stock (disponible neto: 12)\nCinta señalizadora: Requiere compra (sin datos de stock)',
    );
    expect(decisions).toEqual([
      { item_id: 11, supply_source: 'STOCK', item_source: 'EPP' },
      { item_id: 12, supply_source: 'PURCHASE' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('con todo cubierto y de stock la decisión es "todo de stock"', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({ items: [linked()], availability: ready([fullRow()]) });

    expect(screen.getByText('Todos los ítems se pueden atender de stock.')).toBeInTheDocument();
    await user.click(confirmButton());

    expect(onAction.mock.calls[0][0]).toBe(true);
    expect(onAction.mock.calls[0][3]).toEqual([]);
  });

  it('forzar stock en un ítem sin vincular avisa de él (y sólo de él) sin impedir continuar', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel();

    await user.click(within(group(2)).getByRole('button', { name: /Atender de Stock/ }));

    expect(screen.getByText('1 ítem de stock sin cobertura completa')).toBeInTheDocument();
    const live = screen.getAllByRole('status').find((el) => el.textContent.startsWith('Atención'));
    expect(live).toHaveTextContent('Atención: 1 ítem marcado para atender de stock no está cubierto por completo.');

    await user.click(confirmButton());                                  // not blocked
    const [allFromStock, , , warnings] = onAction.mock.calls[0];
    expect(allFromStock).toBe(true);
    expect(warnings).toEqual([
      expect.objectContaining({ itemId: 12, line: 2, reason: 'UNLINKED', description: 'Cinta señalizadora' }),
    ]);
  });

  it('varios ítems sin cobertura se anuncian en plural y el aviso se retira al pasarlos a compra', async () => {
    const user = userEvent.setup();
    renderPanel({
      items: [linked(), unlinked(), unlinked({ id: 13, line_number: 3, description: 'Servicio', is_off_catalog: true })],
      availability: ready([fullRow(), row(12, 2), row(13, 3, { link_status: 'OFF_CATALOG' })]),
    });

    await user.click(within(group(2)).getByRole('button', { name: /Atender de Stock/ }));
    await user.click(within(group(3)).getByRole('button', { name: /Atender de Stock/ }));

    expect(screen.getByText('2 ítems de stock sin cobertura completa')).toBeInTheDocument();
    expect(screen.getByText('Fuera de catálogo: no pasa por el almacén.')).toBeInTheDocument();
    const live = screen.getAllByRole('status').find((el) => el.textContent.startsWith('Atención'));
    expect(live).toHaveTextContent('2 ítems marcados para atender de stock no están cubiertos por completo.');

    await user.click(within(group(2)).getByRole('button', { name: /Requiere Compra/ }));
    await user.click(within(group(3)).getByRole('button', { name: /Requiere Compra/ }));

    expect(screen.queryByText(/ítems? de stock sin cobertura completa/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').find((el) => el.textContent.startsWith('Atención'))).toBeUndefined();
  });

  it('un stock parcial dice cuánto hay, cuánto se pidió y cuánto falta', async () => {
    const user = userEvent.setup();
    renderPanel({
      items: [linked()],
      availability: ready([fullRow({
        coverage: 'PARTIAL', available_central: '8.000', available_net: '8.000', shortfall: '2.000',
      })]),
    });

    await user.click(within(group(1)).getByRole('button', { name: /Atender de Stock/ }));

    expect(screen.getByText(/Stock parcial: hay 8 de 10 UND \(faltan 2\)\./)).toBeInTheDocument();
  });

  it('mientras el padre envía, el botón dice "Procesando…" y no vuelve a enviar', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({ submitting: true });

    expect(confirmButton()).toHaveTextContent('Procesando...');
    expect(confirmButton()).toHaveAttribute('aria-disabled', 'true');
    await user.click(confirmButton());
    expect(onAction).not.toHaveBeenCalled();
  });

  it('la fuente (familia) elegida viaja con la decisión y el texto libre de notas llega al padre', async () => {
    const user = userEvent.setup();
    const { onAction, onNotes } = renderPanel({ items: [unlinked({ id: 12 })], availability: ready([row(12, 2)]) });

    await user.selectOptions(screen.getByLabelText('Fuente del ítem'), 'HERRAMIENTAS');
    await user.type(screen.getByRole('textbox', { name: /Notas/ }), 'x');
    await user.click(within(group(1)).getByRole('button', { name: /Requiere Compra/ }));
    await user.click(confirmButton());

    expect(onNotes).toHaveBeenCalledWith('x');
    expect(onAction.mock.calls[0][2]).toEqual([
      { item_id: 12, supply_source: 'PURCHASE', item_source: 'HERRAMIENTAS' },
    ]);
  });
});

describe('StockCheckPanel — consulta de disponibilidad', () => {
  it('mientras llega marca la lista como ocupada y cada ítem dice "Consultando…"', () => {
    renderPanel({ availability: { status: 'loading', byItem: {} } });

    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByText('Consultando la disponibilidad…')).toHaveLength(2);
  });

  it('si falla muestra el aviso con "Reintentar", que pide la consulta de nuevo', async () => {
    const user = userEvent.setup();
    const { onRetryAvailability } = renderPanel({ availability: { status: 'error', byItem: {} } });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('No se pudo consultar la disponibilidad');
    await user.click(within(alert).getByRole('button', { name: /Reintentar/ }));

    expect(onRetryAvailability).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Sin datos de disponibilidad para este ítem.')).toHaveLength(2);
  });

  it('con la consulta caída, marcar stock se avisa como "no verificable" y aun así se puede continuar', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({ availability: { status: 'error', byItem: {} } });

    await user.click(within(group(1)).getByRole('button', { name: /Atender de Stock/ }));
    await user.click(within(group(2)).getByRole('button', { name: /Atender de Stock/ }));

    expect(screen.getAllByText(/No se pudo consultar la disponibilidad de este ítem\./)).toHaveLength(2);
    await user.click(confirmButton());
    expect(onAction.mock.calls[0][0]).toBe(true);
    expect(onAction.mock.calls[0][3].map((w) => w.reason)).toEqual(['UNKNOWN', 'UNKNOWN']);
  });

  it('una línea cuyo vínculo viene del RQ (sin fila de disponibilidad) muestra su código', () => {
    renderPanel({ items: [linked()], availability: { status: 'error', byItem: {} } });

    expect(screen.getByText('EPP-0001')).toBeInTheDocument();
    expect(screen.getByText('Casco de seguridad blanco')).toBeInTheDocument();
  });

  it('un vínculo sin código no rompe: muestra un guion', () => {
    renderPanel({
      items: [linked({ inventory_item_code: undefined, inventory_item_description: undefined })],
      availability: { status: 'error', byItem: {} },
    });

    expect(screen.getByText('Producto del catálogo').parentElement).toHaveTextContent('—');
  });
});

describe('StockCheckPanel — guardar el vínculo', () => {
  async function typeAndPick(user, product) {
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [product] } });
    await user.type(screen.getByRole('combobox', { name: /catálogo para el ítem 2/ }), 'cinta');
    await user.click(await screen.findByRole('option', { name: new RegExp(product.product_code) }));
  }

  const CINTA = { id: 9, product_code: 'MAT-0009', description: 'Cinta de peligro', unit: 'UND', category: 'Otros', available: '40.000' };

  it('mientras se guarda bloquea el botón de confirmar y deja el buscador en solo lectura (no deshabilitado: perdería el foco), y lo explica', async () => {
    const user = userEvent.setup();
    let finish;
    const onLinkChange = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { onAction } = renderPanel({ onLinkChange });

    await typeAndPick(user, CINTA);

    expect(await screen.findByText('Guardando el vínculo…')).toBeInTheDocument();
    expect(onLinkChange).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }), { inventory_item: 9 });
    const search = screen.getByRole('combobox', { name: /catálogo para el ítem 2/ });
    expect(search).toHaveAttribute('readonly');
    expect(search).toHaveAttribute('aria-busy', 'true');
    expect(search).toBeEnabled();
    expect(search).toHaveFocus();
    await user.keyboard('abc');
    expect(search).toHaveValue('');
    expect(screen.getByText('Espere a que termine de guardarse el vínculo.')).toBeInTheDocument();
    await user.click(confirmButton());
    expect(onAction).not.toHaveBeenCalled();

    finish({ ok: true });
    await waitFor(() => expect(screen.queryByText('Guardando el vínculo…')).not.toBeInTheDocument());
    expect(screen.getAllByRole('status').some((el) => el.textContent === 'Producto vinculado: MAT-0009.')).toBe(true);
  });

  it('un fallo sin mensaje usa uno por defecto y deja el campo inválido y asociado al error', async () => {
    const user = userEvent.setup();
    renderPanel({ onLinkChange: vi.fn().mockResolvedValue({ ok: false }) });

    await typeAndPick(user, CINTA);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo guardar el vínculo.');
    const search = screen.getByRole('combobox', { name: /catálogo para el ítem 2/ });
    expect(search).toHaveAttribute('aria-invalid', 'true');
    expect(search.getAttribute('aria-describedby')).toContain(alert.id);
    expect(search).toBeEnabled();                      // the user can pick another product
  });

  it('marcar fuera de catálogo guarda sólo is_off_catalog y lo anuncia', async () => {
    const user = userEvent.setup();
    const { onLinkChange } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Marcar el ítem 2 como fuera de catálogo' }));

    await waitFor(() => expect(onLinkChange).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }), { is_off_catalog: true }));
    await waitFor(() => expect(
      screen.getAllByRole('status').some((el) => el.textContent === 'Ítem marcado como fuera de catálogo.'),
    ).toBe(true));
  });

  it('un producto EPP propone la fuente EPP, pero nunca pisa la que el ítem ya tiene', async () => {
    const user = userEvent.setup();
    const epp = { ...CINTA, id: 10, product_code: 'EPP-0010', category: 'EPP' };
    renderPanel({ items: [linked(), unlinked({ item_source: 'GASES' })] });

    await typeAndPick(user, epp);

    await waitFor(() => expect(
      screen.getAllByRole('status').some((el) => el.textContent === 'Producto vinculado: EPP-0010.'),
    ).toBe(true));
    expect(screen.getAllByLabelText('Fuente del ítem')[1]).toHaveValue('GASES');
    expect(screen.queryByText('Propuesta según el producto.')).not.toBeInTheDocument();
  });

  it('un producto EPP propone la fuente EPP cuando el ítem no tiene ninguna', async () => {
    const user = userEvent.setup();
    const epp = { ...CINTA, id: 10, product_code: 'EPP-0010', category: 'EPP' };
    renderPanel();

    await typeAndPick(user, epp);

    await waitFor(() => expect(screen.getAllByLabelText('Fuente del ítem')[1]).toHaveValue('EPP'));
    expect(screen.getByText('Propuesta según el producto.')).toBeInTheDocument();
  });

  it('con el cambio cancelado no se guarda nada', async () => {
    const user = userEvent.setup();
    const { onLinkChange } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar el cambio de producto del ítem 1' }));

    expect(onLinkChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' })).toHaveFocus();
  });
});

describe('StockCheckPanel — consulta de disponibilidad en curso', () => {
  it('no deja confirmar hasta que llegue (los avisos de cobertura dependen de ella) y lo explica', async () => {
    const user = userEvent.setup();
    const { onAction, rerender } = renderPanel({
      items: [linked()],
      availability: { status: 'loading', byItem: {} },
    });
    await user.click(within(group(1)).getByRole('button', { name: /Atender de Stock/ }));

    expect(confirmButton()).toHaveAttribute('aria-disabled', 'true');
    expect(confirmButton()).toHaveAccessibleDescription('Espere a que termine la consulta de disponibilidad.');
    await user.click(confirmButton());
    expect(onAction).not.toHaveBeenCalled();

    rerender(
      <StockCheckPanel
        items={[linked()]}
        availability={ready([fullRow()])}
        submitting={false}
        notes=""
        onRetryAvailability={() => {}}
        onLinkChange={() => Promise.resolve({ ok: true })}
        onNotes={() => {}}
        onAction={onAction}
      />,
    );
    expect(confirmButton()).not.toHaveAttribute('aria-disabled');
    await user.click(confirmButton());
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('si la consulta falla el botón se habilita (se decide sin cifras)', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({
      items: [linked()],
      availability: { status: 'error', byItem: {} },
    });
    await user.click(within(group(1)).getByRole('button', { name: /Atender de Stock/ }));

    expect(confirmButton()).not.toHaveAttribute('aria-disabled');
    await user.click(confirmButton());
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('StockCheckPanel — producto propuesto por el solicitante ("Por confirmar")', () => {
  const proposedRow = (over = {}) => fullRow({ link_confirmed: false, ...over });
  const card = (n) => group(n).closest('li');

  it('lo marca "Por confirmar", ofrece confirmarlo y avisa cuántos faltan (sin bloquear nada)', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({
      items: [linked()],
      availability: ready([proposedRow()]),
    });

    expect(within(card(1)).getByText(/Por confirmar: este producto lo propuso el solicitante\./)).toBeInTheDocument();
    expect(screen.getByText('1 producto por confirmar')).toBeInTheDocument();
    expect(screen.getByText(/Puede continuar sin confirmarlo\./)).toBeInTheDocument();

    // It is a notice, not a lock: the stock check can be confirmed as it is.
    expect(confirmButton()).not.toHaveAttribute('aria-disabled');
    await user.click(confirmButton());
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('"Confirmar producto" reenvía el mismo vínculo (así lo confirma el servidor) y retira el aviso', async () => {
    const user = userEvent.setup();
    const { onLinkChange } = renderPanel({
      items: [linked()],
      availability: ready([proposedRow()]),
    });

    await user.click(within(card(1)).getByRole('button', { name: 'Confirmar el producto vinculado del ítem 1' }));

    expect(onLinkChange).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), { inventory_item: 5 });
    await waitFor(() => expect(screen.queryByText(/Por confirmar/)).not.toBeInTheDocument());
    expect(screen.queryByText('1 producto por confirmar')).not.toBeInTheDocument();
    expect(screen.getByText('Producto confirmado: EPP-0001.')).toBeInTheDocument();
  });

  it('si el servidor rechaza la confirmación sigue por confirmar y muestra el motivo', async () => {
    const user = userEvent.setup();
    const { onLinkChange } = renderPanel({
      items: [linked()],
      availability: ready([proposedRow()]),
    });
    onLinkChange.mockResolvedValueOnce({ ok: false, message: 'El requerimiento ya está cerrado.' });

    await user.click(within(card(1)).getByRole('button', { name: 'Confirmar el producto vinculado del ítem 1' }));

    expect(await screen.findByText('El requerimiento ya está cerrado.')).toBeInTheDocument();
    expect(within(card(1)).getByText(/Por confirmar/)).toBeInTheDocument();
  });

  it('el ítem fuera de catálogo propuesto también se confirma, con is_off_catalog', async () => {
    const user = userEvent.setup();
    const offItem = { id: 13, line_number: 3, description: 'Servicio de flete', quantity: '1.000', unit: 'GLB', inventory_item: null, is_off_catalog: true, item_source: '' };
    const { onLinkChange } = renderPanel({
      items: [offItem],
      availability: ready([row(13, 3, { link_status: 'OFF_CATALOG', link_confirmed: false })]),
    });

    expect(screen.getByText(/el solicitante lo marcó fuera de catálogo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar el ítem 1 como fuera de catálogo' }));

    expect(onLinkChange).toHaveBeenCalledWith(expect.objectContaining({ id: 13 }), { is_off_catalog: true });
    await waitFor(() => expect(screen.queryByText(/Por confirmar/)).not.toBeInTheDocument());
  });

  it('elegir otro producto también cuenta como confirmación de logística', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue({
      data: { count: 1, results: [{ id: 9, product_code: 'EPP-0009', description: 'Casco amarillo', unit: 'UND', category: 'EPP', available: '3.000' }] },
    });
    const { onLinkChange } = renderPanel({ items: [linked()], availability: ready([proposedRow()]) });

    await user.click(within(card(1)).getByRole('button', { name: 'Cambiar el producto vinculado del ítem 1' }));
    await user.type(screen.getByRole('combobox', { name: /Buscar el producto del catálogo/ }), 'amarillo');
    await user.click(await screen.findByRole('option', { name: /EPP-0009/ }));

    expect(onLinkChange).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), { inventory_item: 9 });
    await waitFor(() => expect(screen.queryByText('1 producto por confirmar')).not.toBeInTheDocument());
  });

  it('una API que no manda la marca (o la manda en true) no muestra nada nuevo', () => {
    renderPanel({ items: [linked()], availability: ready([fullRow()]) });
    expect(screen.queryByText(/Por confirmar/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar el producto vinculado/ })).not.toBeInTheDocument();
  });
});

describe('StockCheckPanel — contraste del texto blanco (WCAG 1.4.3)', () => {
  // white on teal-600 / orange-500 is 3.7:1 / 2.9:1 (4.5:1 needed); -700 gives 5.4:1 / 5.2:1.
  it('los botones elegidos y el de confirmar usan -700 y "(sugerido)" no baja de 12 px', async () => {
    const user = userEvent.setup();
    renderPanel({ items: [linked()], availability: ready([fullRow()]) });

    const stock = within(group(1)).getByRole('button', { name: /Atender de Stock/ });
    expect(stock).toHaveClass('bg-teal-700', 'text-white');
    expect(stock).not.toHaveClass('bg-teal-600');
    expect(within(stock).getByText('(sugerido)')).toHaveClass('text-xs');
    expect(within(stock).getByText('(sugerido)').className).not.toMatch(/text-\[10px\]/);
    expect(confirmButton()).toHaveClass('bg-teal-700');

    await user.click(within(group(1)).getByRole('button', { name: /Requiere Compra/ }));
    expect(within(group(1)).getByRole('button', { name: /Requiere Compra/ })).toHaveClass('bg-orange-700', 'text-white');
    expect(confirmButton()).toHaveClass('bg-orange-700');
    expect(confirmButton()).not.toHaveClass('bg-orange-500');
  });
});

