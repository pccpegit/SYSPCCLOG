import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeImport } from '../../../test/almacenFixtures';
import ReviewStep from './ReviewStep';
import * as importApi from '../../../api/almacenImport';
import * as almacenApi from '../../../api/almacen';
import { ToastProvider } from '../../../context/ToastContext';

vi.mock('../../../api/almacenImport');
vi.mock('../../../api/almacen');

const baseSummary = () => makeImport().summary;

function setup(overrides = {}, props = {}) {
  const handlers = {
    onProjectChange: vi.fn(), onLink: vi.fn(), onUnlink: vi.fn(), onContinue: vi.fn(), onCancel: vi.fn(),
    onRestart: vi.fn(),
  };
  const imp = makeImport(overrides);
  render(
    <ToastProvider>
      <ReviewStep imp={imp} projectMap={{}} destinationLinks={{}} {...handlers} {...props} />
    </ToastProvider>,
  );
  return { ...handlers, user: userEvent.setup() };
}

const MATCH = { id: 7, code: 'OP', name: 'On Plant' };
const continueButton = () => screen.getByRole('button', { name: /continuar a la confirmación/i });

beforeEach(() => {
  vi.clearAllMocks();
  importApi.getImportProblems.mockResolvedValue({ data: { count: 0, results: [], meta: { total: 0, truncated: false } } });
  almacenApi.lookupPersonal.mockResolvedValue({ data: [] });
});

describe('ReviewStep — veredicto', () => {
  it('con el libro importable dice «Sí» y pide elegir el proyecto antes de continuar', async () => {
    const { user, onContinue } = setup();
    expect(screen.getByText(/¿se puede importar\? sí/i)).toBeInTheDocument();
    expect(continueButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Para continuar, elija el proyecto del libro.')).toBeInTheDocument();
    await user.click(continueButton());
    expect(onContinue).not.toHaveBeenCalled();
  });

  it.each([[1, '1 problema bloqueante'], [3, '3 problemas bloqueantes']])(
    'con %i bloqueante(s) lo dice con singular/plural y no deja continuar aunque el proyecto esté elegido',
    async (blockers, text) => {
      const summary = { ...baseSummary(), counts: { blocker: blockers, error: 0, warning: 0, info: 0 } };
      const { user, onContinue } = setup({ can_confirm: false, summary }, { projectMap: { 'ON PLANT': null } });
      expect(screen.getByRole('alert')).toHaveTextContent(text);
      expect(screen.getByText('No se puede continuar: el libro tiene problemas bloqueantes.')).toBeInTheDocument();
      await user.click(continueButton());
      expect(onContinue).not.toHaveBeenCalled();
    },
  );

  it('con el proyecto decidido el botón continúa y se quita el motivo', async () => {
    const { user, onContinue } = setup({}, { projectMap: { 'ON PLANT': null } });
    expect(continueButton()).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText(/para continuar, elija el proyecto/i)).not.toBeInTheDocument();
    await user.click(continueButton());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('«Cancelar importación» y «Subir otro archivo» siempre están disponibles', async () => {
    const { user, onCancel, onRestart } = setup({ can_confirm: false });
    await user.click(screen.getByRole('button', { name: /cancelar importación/i }));
    await user.click(screen.getByRole('button', { name: /subir otro archivo/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});

describe('ReviewStep — veredicto con reservas', () => {
  const clean = () => ({
    ...baseSummary(),
    counts: { blocker: 0, error: 0, warning: 5, info: 0 },
    skipped_rows: 0,
    stock: { projected_total: 100, sheet_total: 100, mismatched_items: 0, negative_items: 0 },
    by_code: { VALE_VACIO: 5 },
  });

  it('con filas omitidas y stock distinto al libro dice «Sí, con reservas» en ámbar y nombra cada reserva', () => {
    setup({});
    const verdict = screen.getByText(/¿se puede importar\? sí, con reservas/i);
    expect(verdict).toBeInTheDocument();
    const banner = verdict.closest('div[class*="ring-1"]');
    expect(banner).toHaveTextContent(/se omitirán 37 filas con errores y 17 ítems quedarían con stock distinto al del libro/i);
    expect(banner.className).toMatch(/amber/);
    expect(banner.className).not.toMatch(/emerald/);
  });

  it('con solo advertencias, sin omitidas ni diferencias, queda el «Sí» en verde', () => {
    setup({ summary: clean() });
    const banner = screen.getByText(/¿se puede importar\? sí\. revise las advertencias/i).closest('div[class*="ring-1"]');
    expect(banner.className).toMatch(/emerald/);
    expect(screen.queryByText(/con reservas/i)).not.toBeInTheDocument();
  });

  it.each([
    [{ skipped_rows: 1 }, /se omitirán 1 fila con errores/i],
    [{ stock: { projected_total: 10, sheet_total: 9, mismatched_items: 1, negative_items: 0 } }, /1 ítem quedaría con stock distinto/i],
  ])('una sola reserva (%j) también pasa el veredicto a ámbar, en singular', (patch, pattern) => {
    setup({ summary: { ...clean(), ...patch } });
    expect(screen.getByText(/sí, con reservas/i)).toBeInTheDocument();
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  it('movimientos importados que el libro ya no trae: reserva ámbar y aviso de que no se actualizan', () => {
    setup({ summary: { ...clean(), by_code: { FILAS_IMPORTADAS_AUSENTES: 1 } } });
    expect(screen.getByText(/sí, con reservas/i)).toBeInTheDocument();
    expect(screen.getByText(/el libro ya no trae movimientos que se importaron antes/i)).toBeInTheDocument();
    expect(screen.getByText(/las filas que ya se importaron no se actualizan ni se borran/i)).toBeInTheDocument();
  });

  it('sin movimientos ausentes no muestra ese aviso', () => {
    setup({ summary: clean() });
    expect(screen.queryByText(/no se actualizan ni se borran/i)).not.toBeInTheDocument();
  });

  it('un libro bloqueado sigue en rojo y no habla de reservas', () => {
    setup({ can_confirm: false });
    expect(screen.getByRole('alert')).toHaveTextContent(/problemas? bloqueantes?/i);
    expect(screen.queryByText(/sí, con reservas/i)).not.toBeInTheDocument();
  });
});

describe('ReviewStep — resumen por tipo de problema', () => {
  it('lista cada tipo con su cantidad, del más frecuente al menos, con rótulos legibles', () => {
    setup({ summary: { ...baseSummary(), by_code: { CANTIDAD_VACIA: 13, VALE_VACIO: 326, STOCK_EXCEDIDO: 1 } } });
    const items = within(screen.getByRole('region', { name: /resumen por tipo de problema/i })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Egreso sin N° de vale: 326',
      'Cantidad vacía: 13',
      'El stock superaría el máximo permitido: 1',
    ]);
  });

  it('sin problemas no muestra el resumen', () => {
    setup({ summary: { ...baseSummary(), by_code: {} } });
    expect(screen.queryByRole('region', { name: /resumen por tipo de problema/i })).not.toBeInTheDocument();
  });
});

describe('ReviewStep — cifras', () => {
  it('suma las filas ya importadas de ingresos y egresos para que no parezca que se duplican', () => {
    const summary = {
      ...baseSummary(),
      entries: { to_import: 0, already_imported: 4, skipped_error: 0, groups: 0 },
      exits: { to_import: 0, already_imported: 6, skipped_error: 0, groups: 0 },
    };
    setup({ summary });
    const card = screen.getByText('Ya importadas').closest('div');
    expect(within(card).getByText('10')).toBeInTheDocument();
    expect(within(card).getByText('No se duplican ni se actualizan')).toBeInTheDocument();
  });

  it.each([[1, '1 ítem quedaría con stock negativo.'], [2, '2 ítems quedarían con stock negativo.']])(
    'avisa del stock negativo proyectado (%i)',
    (negative, text) => {
      const summary = { ...baseSummary(), stock: { projected_total: 10, sheet_total: 10, mismatched_items: 0, negative_items: negative } };
      setup({ summary });
      expect(screen.getByText(text)).toBeInTheDocument();
    },
  );

  it('sin stock negativo no muestra ese aviso', () => {
    setup();
    expect(screen.queryByText(/con stock negativo/)).not.toBeInTheDocument();
  });

  it('muestra las cifras aunque el servidor no mande una sección del resumen', () => {
    setup({ summary: {} });
    expect(screen.getByText('Ítems nuevos')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(3);
  });
});

describe('ReviewStep — proyecto del libro', () => {
  const withMatches = (matches, items = 251) => ({
    projects: [{ label: 'ON PLANT', items, matches, suggested_id: null }],
  });

  it('sin coincidencias explica cómo crear el proyecto y ofrece «No asignar proyecto»', async () => {
    const { user, onProjectChange } = setup(withMatches([]));
    expect(screen.getByText(/no existe un proyecto «on plant» en el sistema/i)).toBeInTheDocument();
    expect(screen.getByText('Elija una opción para poder continuar.')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /on plant/i }), 'No asignar proyecto');
    expect(onProjectChange).toHaveBeenCalledWith('ON PLANT', null);
  });

  it('con coincidencias lista «código — nombre» y entrega el id elegido', async () => {
    const { user, onProjectChange } = setup(withMatches([MATCH]));
    await user.selectOptions(screen.getByRole('combobox', { name: /on plant/i }), 'OP — On Plant');
    expect(onProjectChange).toHaveBeenCalledWith('ON PLANT', 7);
    expect(screen.queryByText(/no existe un proyecto/i)).not.toBeInTheDocument();
  });

  it('un proyecto sugerido por el servidor queda preseleccionado y sin aviso de pendiente', () => {
    setup({ projects: [{ label: 'ON PLANT', items: 1, matches: [MATCH], suggested_id: 7 }] });
    const select = screen.getByRole('combobox', { name: /on plant/i });
    expect(select).toHaveValue('7');
    expect(select).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText(/· 1 ítem$/)).toBeInTheDocument();                       // singular
  });

  it('una decisión previa «no asignar» se conserva al volver a este paso', () => {
    setup(withMatches([MATCH]), { projectMap: { 'ON PLANT': null } });
    expect(screen.getByRole('combobox', { name: /on plant/i })).toHaveValue('none');
  });

  it('un libro sin proyectos no muestra la sección', () => {
    setup({ projects: [], requires: { accept_warnings: false, accept_skipped_rows: false, project_labels: [] } });
    expect(screen.queryByText('Proyecto del libro')).not.toBeInTheDocument();
    expect(continueButton()).toHaveAttribute('aria-disabled', 'false');
  });
});

describe('ReviewStep — destinos sin vincular', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({
    key: `destino-${i}`, display: `DESTINO INVENTADO ${i}`, rows: i + 1, candidates: i % 2 ? 2 : 0,
  }));

  it('muestra solo los primeros 25 y permite ver todos y volver a plegar', async () => {
    const { user } = setup({ unmatched_destinations: many(30) });
    expect(screen.getAllByRole('button', { name: /^vincular el destino/i })).toHaveLength(25);
    await user.click(screen.getByRole('button', { name: /mostrar los 30 destinos/i }));
    expect(screen.getAllByRole('button', { name: /^vincular el destino/i })).toHaveLength(30);
    await user.click(screen.getByRole('button', { name: /mostrar menos/i }));
    expect(screen.getAllByRole('button', { name: /^vincular el destino/i })).toHaveLength(25);
  });

  it('distingue «Sin coincidencia» de «Ambiguo (2 trabajadores)» con texto', () => {
    setup({ unmatched_destinations: many(2) });
    expect(screen.getByText('Sin coincidencia')).toBeInTheDocument();
    expect(screen.getByText('Ambiguo (2 trabajadores)')).toBeInTheDocument();
  });

  it('un destino vinculado muestra a quién y permite dejarlo como texto devolviendo el foco', async () => {
    const { user, onUnlink } = setup(
      { unmatched_destinations: many(1) },
      { destinationLinks: { 'destino-0': { id: 4, name: 'TRABAJADOR INVENTADO' } } },
    );
    expect(screen.getByText('Vinculado a TRABAJADOR INVENTADO')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /dejar como texto/i }));
    expect(onUnlink).toHaveBeenCalledWith('destino-0');
  });

  it('«Vincular» abre el buscador y «Cancelar» lo cierra sin vincular', async () => {
    const { user, onLink } = setup({ unmatched_destinations: many(1) });
    await user.click(screen.getByRole('button', { name: /vincular el destino destino inventado 0/i }));
    expect(await screen.findByRole('combobox', { name: /trabajador para el destino destino inventado 0/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }));
    expect(screen.queryByRole('combobox', { name: /trabajador para el destino/i })).not.toBeInTheDocument();
    expect(onLink).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /vincular el destino destino inventado 0/i })).toHaveFocus();
  });

  it('los nombres de los destinos no se escriben en el almacenamiento del navegador', () => {
    const setItem = vi.spyOn(Object.getPrototypeOf(window.localStorage), 'setItem');
    setup({ unmatched_destinations: many(3) });
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
