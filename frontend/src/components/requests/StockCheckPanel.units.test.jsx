import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockCheckPanel from './StockCheckPanel';
import * as requestsApi from '../../api/requests';

// SYSPCC-026 (ronda 4): unidades y líneas ya movidas.
//  - Las cifras de stock (disponible neto, comprometido, tomado por ítems anteriores) van rotuladas
//    con la unidad del PRODUCTO; "Solicitado" y "Faltante", con la de la línea.
//  - Con unidades distintas (unit_mismatch / NOT_COMPARABLE) el panel lo dice claro, no afirma
//    cobertura, no sugiere origen ni escribe "(sugerido)", y nunca bloquea.
//  - Las líneas que el servidor se negó a modificar (409) se marcan.
vi.mock('../../api/requests');

const line = (over = {}) => ({
  id: 11, line_number: 1, description: 'Casco blanco', quantity: '2.000', unit: 'CAJA',
  inventory_item: 5, inventory_item_code: 'EPP-0001', inventory_item_description: 'Casco de seguridad blanco',
  inventory_item_unit: 'EA', is_off_catalog: false, item_source: 'EPP', ...over,
});

const baseRow = (over = {}) => ({
  item_id: 11, line_number: 1, description: 'Casco blanco', unit: 'UND', requested: '10.000',
  link_status: 'LINKED', inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND' },
  available_central: '12.000', committed_other_requests: '0.000', committed_earlier_lines: '0.000',
  available_net: '12.000', shortfall: '0.000', coverage: 'FULL', product_unit: 'UND', unit_mismatch: false, ...over,
});

// Asked in CAJA, the product's stock is in EA: the server compares nothing.
const mismatchRow = (over = {}) => baseRow({
  unit: 'CAJA', requested: '2.000', product_unit: 'EA', unit_mismatch: true, coverage: 'NOT_COMPARABLE',
  inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'EA' },
  available_central: '10.000', available_net: '10.000', shortfall: null, ...over,
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
      items={[line({ quantity: '10.000', unit: 'UND', inventory_item_unit: 'UND' })]}
      availability={ready([baseRow()])}
      submitting={false}
      notes=""
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

// The «Stat» box of a figure: its label, value and unit are three paragraphs of one box.
const stat = (label) => screen.getByText(label).parentElement;
const group = (n = 1) => screen.getByRole('group', { name: `Origen de atención del ítem ${n}` });
const confirmButton = () => screen.getByRole('button', { name: /^(Confirmar —|Marque todos|Procesando)/ });

beforeEach(() => {
  vi.clearAllMocks();
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 0, results: [] } });
});

describe('StockCheckPanel — las cifras de stock van en la unidad del producto', () => {
  it('unidades equivalentes pero escritas distinto: el stock en UND, lo solicitado y el faltante en EA', () => {
    renderPanel({
      items: [line({ quantity: '10.000', unit: 'EA', inventory_item_unit: 'UND' })],
      availability: ready([baseRow({
        unit: 'EA', product_unit: 'UND', available_central: '15.000', committed_other_requests: '3.000',
        available_net: '4.000', shortfall: '6.000', coverage: 'PARTIAL',
      })]),
    });

    expect(stat('Solicitado')).toHaveTextContent('10EA');
    expect(stat('Disponible neto (almacén central)')).toHaveTextContent('4UND');
    expect(stat('Comprometido en otros RQ')).toHaveTextContent('3UND');
    expect(stat('Faltante')).toHaveTextContent('6EA');
    // The explanation also speaks the product's unit.
    expect(screen.getByText(/Hay 15 UND en el almacén central; el resto está comprometido con otros RQ\./)).toBeInTheDocument();
  });

  it('sin product_unit (API anterior) usa la unidad del producto vinculado, no la de la línea', () => {
    renderPanel({
      availability: ready([baseRow({
        unit: 'EA', product_unit: undefined, available_net: '12.000',
        inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco', unit: 'UND' },
      })]),
    });

    expect(stat('Disponible neto (almacén central)')).toHaveTextContent('12UND');
    expect(stat('Disponible neto (almacén central)')).not.toHaveTextContent('EA');
  });

  it('una cifra sin dato no lleva unidad', () => {
    renderPanel({
      availability: ready([baseRow({ available_net: null, committed_other_requests: null, shortfall: null, coverage: null })]),
    });

    expect(stat('Disponible neto (almacén central)')).toHaveTextContent('—');
    expect(stat('Disponible neto (almacén central)')).not.toHaveTextContent('UND');
    expect(stat('Comprometido en otros RQ')).not.toHaveTextContent('UND');
  });

  it('muestra lo que ya toman los ítems anteriores del mismo RQ, y la frase hace cuadrar la resta', () => {
    renderPanel({
      availability: ready([baseRow({
        available_central: '10.000', committed_other_requests: '3.000', committed_earlier_lines: '6.000',
        available_net: '1.000', shortfall: '9.000', coverage: 'PARTIAL',
      })]),
    });

    expect(stat('Tomado por los ítems anteriores de este RQ')).toHaveTextContent('6UND');
    expect(stat('Comprometido en otros RQ')).toHaveTextContent('3UND');
    expect(screen.getByText(
      /Hay 10 UND en el almacén central; 3 UND están comprometidas con otros RQ y 6 UND las toman los ítems anteriores de este RQ\./,
    )).toBeInTheDocument();
  });

  it('si ningún ítem anterior toma stock, esa cifra no aparece', () => {
    renderPanel({ availability: ready([baseRow({ committed_earlier_lines: '0.000' })]) });

    expect(screen.queryByText('Tomado por los ítems anteriores de este RQ')).not.toBeInTheDocument();
  });

  it('una fila de una API anterior (sin committed_earlier_lines) se ve igual que antes', () => {
    const old = baseRow({ available_central: '15.000', committed_other_requests: '3.000', available_net: '12.000' });
    delete old.committed_earlier_lines;
    renderPanel({ availability: ready([old]) });

    expect(screen.queryByText('Tomado por los ítems anteriores de este RQ')).not.toBeInTheDocument();
    expect(screen.getByText(/el resto está comprometido con otros RQ\./)).toBeInTheDocument();
  });
});

describe('StockCheckPanel — unidad distinta (NOT_COMPARABLE)', () => {
  const mismatchPanel = (props = {}) => renderPanel({
    items: [line()],
    availability: ready([mismatchRow()]),
    ...props,
  });

  it('dice claro que las unidades no coinciden, con las dos unidades', () => {
    mismatchPanel();

    expect(screen.getByText('Unidad distinta: el stock está en EA y el RQ pide en CAJA.')).toBeInTheDocument();
    expect(screen.getByText(/El sistema no convierte unidades/)).toBeInTheDocument();
    expect(screen.getByText('Unidad distinta', { selector: 'span.inline-flex' })).toBeInTheDocument();   // the badge
  });

  it('no afirma cobertura: ni insignia, ni frase, ni tono de faltante', () => {
    const { container } = mismatchPanel();

    expect(screen.queryByText('Stock suficiente')).not.toBeInTheDocument();
    expect(screen.queryByText(/Stock parcial|Sin stock/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lo disponible cubre|no alcanza/)).not.toBeInTheDocument();
    expect(stat('Faltante')).toHaveTextContent('—');
    expect(stat('Faltante').className).not.toMatch(/orange|green/);
    expect(container.querySelector('.bg-green-100')).toBeNull();
  });

  it('las cifras de stock se muestran en la unidad del producto (EA), informativas', () => {
    mismatchPanel();

    expect(stat('Solicitado')).toHaveTextContent('2CAJA');
    expect(stat('Disponible neto (almacén central)')).toHaveTextContent('10EA');
  });

  it('no sugiere ningún origen: ningún botón queda marcado y no aparece "(sugerido)"', () => {
    mismatchPanel();

    expect(within(group()).getByRole('button', { name: /Atender de Stock/ })).toHaveAttribute('aria-pressed', 'false');
    expect(within(group()).getByRole('button', { name: /Requiere Compra/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('(sugerido)')).not.toBeInTheDocument();
    // It asks logistics to decide, and says so.
    expect(confirmButton()).toHaveTextContent('Marque todos los ítems arriba');
    expect(screen.getByText('Indique de dónde se atiende cada ítem.')).toBeInTheDocument();
  });

  it('tampoco aparece "(sugerido)" cuando otro ítem sí tiene sugerencia: solo ese lo lleva', () => {
    renderPanel({
      items: [
        line(),
        line({ id: 12, line_number: 2, description: 'Guantes', quantity: '3.000', unit: 'PAR', inventory_item_unit: 'PAR' }),
      ],
      availability: ready([
        mismatchRow(),
        baseRow({ item_id: 12, line_number: 2, unit: 'PAR', product_unit: 'PAR', requested: '3.000', coverage: 'FULL' }),
      ]),
    });

    expect(screen.getAllByText('(sugerido)')).toHaveLength(1);
    expect(within(group(2)).getByText('(sugerido)')).toBeInTheDocument();
    expect(within(group(1)).queryByText('(sugerido)')).not.toBeInTheDocument();
  });

  it('elegir "Atender de Stock" sí se puede (nunca bloquea) pero avisa que no se pudo verificar', async () => {
    const user = userEvent.setup();
    const { onAction } = mismatchPanel();

    await user.click(within(group()).getByRole('button', { name: /Atender de Stock/ }));

    const heading = screen.getByText('1 ítem de stock sin cobertura completa');
    const warning = heading.closest('div');
    expect(within(warning).getByText(/Unidad distinta: el stock está en EA y el RQ pide en CAJA\. No se pudo verificar la cobertura\./)).toBeInTheDocument();
    expect(screen.queryByText('(sugerido)')).not.toBeInTheDocument();    // an explicit choice is not a suggestion either
    expect(confirmButton()).not.toHaveAttribute('aria-disabled');

    await user.click(confirmButton());

    expect(onAction).toHaveBeenCalledTimes(1);
    const [allFromStock, summary, decisions, warnings] = onAction.mock.calls[0];
    expect(allFromStock).toBe(true);
    expect(summary).toBe('Casco blanco: Atender de stock (unidad distinta: stock en EA, RQ en CAJA)');
    expect(decisions).toEqual([{ item_id: 11, supply_source: 'STOCK', item_source: 'EPP' }]);
    expect(warnings).toEqual([expect.objectContaining({ itemId: 11, line: 1, reason: 'NOT_COMPARABLE' })]);
  });

  it('elegir "Requiere Compra" no avisa nada y el resumen no inventa una comparación', async () => {
    const user = userEvent.setup();
    const { onAction } = mismatchPanel();

    await user.click(within(group()).getByRole('button', { name: /Requiere Compra/ }));

    expect(screen.queryByText(/sin cobertura completa/)).not.toBeInTheDocument();
    await user.click(confirmButton());

    const [allFromStock, summary, , warnings] = onAction.mock.calls[0];
    expect(allFromStock).toBe(false);
    expect(summary).toBe('Casco blanco: Requiere compra (unidad distinta: stock en EA, RQ en CAJA)');
    expect(warnings).toEqual([]);
  });

  it('con unit_mismatch pero una cobertura que no es NOT_COMPARABLE tampoco se cree la cobertura', () => {
    mismatchPanel({ availability: ready([mismatchRow({ coverage: 'FULL' })]) });

    expect(screen.getByText('Unidad distinta: el stock está en EA y el RQ pide en CAJA.')).toBeInTheDocument();
    expect(within(group()).getByRole('button', { name: /Atender de Stock/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('(sugerido)')).not.toBeInTheDocument();
  });

  it('una unidad en blanco se dice con palabras, sin dejar un hueco en la frase', () => {
    mismatchPanel({ availability: ready([mismatchRow({ product_unit: '', inventory_item: { id: 5, product_code: 'EPP-0001', description: 'Casco', unit: '' } })]) });

    expect(screen.getByText('Unidad distinta: el producto no tiene unidad definida y el RQ pide en CAJA.')).toBeInTheDocument();
  });

  it('un ítem con unidad distinta no impide decidir los demás ni confirmar', async () => {
    const user = userEvent.setup();
    const { onAction } = renderPanel({
      items: [
        line(),
        line({ id: 12, line_number: 2, description: 'Guantes', quantity: '3.000', unit: 'PAR', inventory_item_unit: 'PAR' }),
      ],
      availability: ready([
        mismatchRow(),
        baseRow({ item_id: 12, line_number: 2, unit: 'PAR', product_unit: 'PAR', requested: '3.000', coverage: 'FULL' }),
      ]),
    });

    await user.click(within(group(1)).getByRole('button', { name: /Requiere Compra/ }));
    await user.click(confirmButton());

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][2]).toEqual([
      { item_id: 11, supply_source: 'PURCHASE', item_source: 'EPP' },
      { item_id: 12, supply_source: 'STOCK', item_source: 'EPP' },
    ]);
  });
});

describe('StockCheckPanel — líneas que el servidor no deja modificar (409)', () => {
  it('marca solo las líneas recibidas, con su explicación, sin romper el resto', () => {
    renderPanel({
      items: [
        line({ quantity: '10.000', unit: 'UND', inventory_item_unit: 'UND' }),
        line({ id: 12, line_number: 2, description: 'Guantes', quantity: '3.000', unit: 'PAR', inventory_item_unit: 'PAR' }),
      ],
      availability: ready([baseRow(), baseRow({ item_id: 12, line_number: 2, unit: 'PAR', product_unit: 'PAR' })]),
      lockedItems: { 12: 'RECEIVED' },
    });

    const lines = screen.getAllByRole('listitem').filter((li) => li.querySelector('[role="group"]'));
    expect(lines[0]).not.toHaveTextContent('Ya se recibió en el almacén');
    expect(lines[0].className).not.toContain('ring-red');
    expect(lines[1]).toHaveTextContent('Ya se recibió en el almacén: su producto no se puede cambiar ni marcar como fuera de catálogo.');
    expect(lines[1].className).toContain('ring-red');
    // The panel still works: the origin can be chosen and the check confirmed.
    expect(within(lines[1]).getByRole('button', { name: /Atender de Stock/ })).toBeInTheDocument();
    expect(confirmButton()).not.toHaveAttribute('aria-disabled');
  });

  it('una línea con despachos lo dice con otra frase', () => {
    renderPanel({ lockedItems: { 11: 'DISPATCHED' } });

    expect(screen.getByText('Ya tiene despachos del almacén: no se puede modificar.')).toBeInTheDocument();
    expect(screen.queryByText(/Ya se recibió/)).not.toBeInTheDocument();
  });

  it('sin líneas marcadas no hay avisos (valor por defecto)', () => {
    renderPanel();

    expect(screen.queryByText(/Ya se recibió|Ya tiene despachos/)).not.toBeInTheDocument();
  });

  it('un id que no es de este RQ o con un motivo desconocido no marca nada ni revienta', () => {
    const { container } = renderPanel({ lockedItems: { 999: 'RECEIVED', 11: 'OTRO_MOTIVO', constructor: 'RECEIVED' } });

    expect(screen.queryByText(/Ya se recibió|Ya tiene despachos/)).not.toBeInTheDocument();
    expect(container.querySelector('[class*="ring-red"]')).toBeNull();
  });
});
