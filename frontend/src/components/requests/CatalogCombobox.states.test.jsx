import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CatalogCombobox, { CATALOG_DEBOUNCE_MS, CATALOG_MIN_CHARS } from './CatalogCombobox';
import * as requestsApi from '../../api/requests';

// SYSPCC-026 (QA ronda 1) — complements CatalogCombobox.test.jsx: the exact debounce, what the
// control does with odd server answers, keyboard edges, several instances on one page, cleanup
// on unmount and where the popup is drawn.
vi.mock('../../api/requests');

const CASCO = { id: 1, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND', category: 'EPP', available: '12.000' };
const GUANTE = { id: 2, product_code: 'EPP-0002', description: 'Guantes de cuero', unit: 'PAR', category: 'EPP', available: '3.000' };
const answer = (results, count = results.length) => ({ data: { count, next: null, previous: null, results } });

function renderCombobox(props = {}) {
  const onSelect = vi.fn();
  render(<CatalogCombobox id="cat" label="Buscar producto" onSelect={onSelect} {...props} />);
  return { onSelect, input: screen.getByRole('combobox', { name: 'Buscar producto' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CatalogCombobox — debounce exacto', () => {
  it('no consulta antes de que termine la pausa y consulta una sola vez, con el último texto', async () => {
    vi.useFakeTimers();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO]));
    const { input } = renderCombobox();

    fireEvent.change(input, { target: { value: 'cas' } });
    await act(async () => { vi.advanceTimersByTime(CATALOG_DEBOUNCE_MS - 1); });
    expect(requestsApi.searchRequestCatalog).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(1);
    expect(requestsApi.searchRequestCatalog).toHaveBeenLastCalledWith('cas', expect.any(Object));

    // Typing again restarts the wait: the intermediate text is never searched.
    fireEvent.change(input, { target: { value: 'casc' } });
    await act(async () => { vi.advanceTimersByTime(CATALOG_DEBOUNCE_MS - 100); });
    fireEvent.change(input, { target: { value: 'cascos' } });
    await act(async () => { vi.advanceTimersByTime(CATALOG_DEBOUNCE_MS - 1); });
    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(2);
    expect(requestsApi.searchRequestCatalog).toHaveBeenLastCalledWith('cascos', expect.any(Object));
  });

  it('el mínimo de caracteres y la pausa son los que documenta el contrato', () => {
    expect(CATALOG_MIN_CHARS).toBe(2);
    expect(CATALOG_DEBOUNCE_MS).toBeGreaterThanOrEqual(250);       // the handoff asks for >= 250 ms
  });

  it('un texto de sólo espacios no consulta ni abre nada', async () => {
    vi.useFakeTimers();
    const { input } = renderCombobox();

    fireEvent.change(input, { target: { value: '     ' } });
    await act(async () => { vi.advanceTimersByTime(CATALOG_DEBOUNCE_MS * 3); });

    expect(requestsApi.searchRequestCatalog).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Escriba al menos/, { selector: 'p:not(.sr-only)' })).not.toBeInTheDocument();
  });

  it('los espacios alrededor no viajan al servidor', async () => {
    vi.useFakeTimers();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([]));
    const { input } = renderCombobox();

    fireEvent.change(input, { target: { value: '  casco  ' } });
    await act(async () => { vi.advanceTimersByTime(CATALOG_DEBOUNCE_MS); });

    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledWith('casco', expect.any(Object));
  });

  it('un carácter rodeado de espacios sigue siendo un carácter: no consulta', async () => {
    vi.useFakeTimers();
    const { input } = renderCombobox();

    fireEvent.change(input, { target: { value: '  c  ' } });
    await act(async () => { vi.advanceTimersByTime(CATALOG_DEBOUNCE_MS * 2); });

    expect(requestsApi.searchRequestCatalog).not.toHaveBeenCalled();
  });
});

describe('CatalogCombobox — respuestas del servidor', () => {
  it('un solo resultado se anuncia en singular y varios en plural', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValueOnce(answer([CASCO])).mockResolvedValueOnce(answer([CASCO, GUANTE]));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await screen.findByRole('option');
    expect(screen.getByRole('status')).toHaveTextContent('1 resultado disponible. Use las flechas para recorrerlos.');

    await user.type(input, 's');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent('2 resultados disponibles.');
  });

  it.each([
    ['sin results', { data: { count: 0 } }],
    ['results que no es una lista', { data: { count: 1, results: 'x' } }],
    ['data nulo', { data: null }],
    ['respuesta vacía', {}],
  ])('una respuesta rara (%s) se trata como "sin resultados" y no rompe', async (_label, response) => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(response);
    const { input } = renderCombobox();

    await user.type(input, 'casco');

    expect((await screen.findAllByText(/Sin resultados para «casco»/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('sin "count" no muestra el pie "Mostrando X de Y"', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue({ data: { results: [CASCO, GUANTE] } });
    const { input } = renderCombobox();

    await user.type(input, 'casco');

    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument();
  });

  it('un producto sin categoría no deja un separador colgando', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([{ ...CASCO, category: '' }]));
    const { input } = renderCombobox();

    await user.type(input, 'casco');

    const option = await screen.findByRole('option');
    expect(option).toHaveTextContent('Unidad: UND');
    expect(option.textContent).not.toContain('·');
  });

  it('un producto con categoría la muestra tras la unidad', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO]));
    const { input } = renderCombobox();

    await user.type(input, 'casco');

    expect(await screen.findByRole('option')).toHaveTextContent('Unidad: UND · EPP');
  });

  it('un error 500 usa el mensaje general (no el del límite de peticiones)', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockRejectedValue({ response: { status: 500 } });
    const { input } = renderCombobox();

    await user.type(input, 'casco');

    expect((await screen.findAllByText('No se pudo buscar en el catálogo. Presione Enter para reintentar.')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Demasiadas búsquedas/)).not.toBeInTheDocument();
  });

  it('si el reintento también falla, sigue en error y sólo cuenta un intento por Enter', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockRejectedValue(new Error('network'));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await screen.findAllByText(/No se pudo buscar/);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText(/No se pudo buscar/)).length).toBeGreaterThanOrEqual(1);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(2);          // no automatic loop
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('escribir otro texto tras un error limpia el aviso y busca el texto nuevo', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(answer([GUANTE]));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await screen.findAllByText(/No se pudo buscar/);
    await user.clear(input);
    await user.type(input, 'guante');

    expect(await screen.findByRole('option', { name: /EPP-0002/ })).toBeInTheDocument();
    expect(screen.queryByText(/No se pudo buscar/)).not.toBeInTheDocument();
  });

  it('con el aviso de error, las flechas no resaltan nada ni rompen', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockRejectedValue(new Error('network'));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await screen.findAllByText(/No se pudo buscar/);
    await user.keyboard('{ArrowDown}{ArrowUp}');

    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('CatalogCombobox — teclado en los bordes', () => {
  async function openWith(user, rows) {
    requestsApi.searchRequestCatalog.mockResolvedValue(answer(rows));
    const view = renderCombobox();
    await user.type(view.input, 'casco');
    await screen.findByRole('listbox');
    return view;
  }

  it('ArrowUp sin nada resaltado va al último y ArrowDown en el último vuelve al primero', async () => {
    const user = userEvent.setup();
    const { input } = await openWith(user, [CASCO, GUANTE]);
    const [first, last] = screen.getAllByRole('option');

    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', last.id);

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
  });

  it('con una sola opción las flechas la mantienen resaltada', async () => {
    const user = userEvent.setup();
    const { input } = await openWith(user, [CASCO]);
    const [only] = screen.getAllByRole('option');

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');

    expect(input).toHaveAttribute('aria-activedescendant', only.id);
  });

  it('escribir de nuevo quita el resaltado: Enter ya no elige lo que se veía antes', async () => {
    const user = userEvent.setup();
    const { input, onSelect } = await openWith(user, [CASCO, GUANTE]);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant');

    await user.type(input, 's');

    expect(input).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('elegir con el mouse devuelve el producto tal cual lo envió el servidor, una sola vez', async () => {
    const user = userEvent.setup();
    const { onSelect } = await openWith(user, [CASCO, GUANTE]);

    await user.click(screen.getByRole('option', { name: /EPP-0002/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(GUANTE);
  });

  it('al salir del campo se cierra la lista y al volver a enfocarlo se reabre con lo mismo', async () => {
    const user = userEvent.setup();
    const { input } = await openWith(user, [CASCO]);

    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.tab({ shift: true });
    expect(input).toHaveFocus();
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(1);          // reused: no new request
  });

  it('el puntero sobre la lista no le quita el foco al campo (ni con su barra de desplazamiento)', async () => {
    const user = userEvent.setup();
    const { input } = await openWith(user, [CASCO]);
    const popup = screen.getByRole('listbox').parentElement;

    const notPrevented = fireEvent.mouseDown(popup);

    expect(notPrevented).toBe(false);                 // preventDefault was called
    expect(input).toHaveFocus();
  });

  it('ArrowDown con la lista cerrada la abre y resalta la primera opción', async () => {
    const user = userEvent.setup();
    const { input } = await openWith(user, [CASCO, GUANTE]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.keyboard('{ArrowDown}');

    const [first] = await screen.findAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
  });

  it('ArrowUp con la lista cerrada la abre y resalta la última opción', async () => {
    const user = userEvent.setup();
    const { input } = await openWith(user, [CASCO, GUANTE]);
    await user.keyboard('{Escape}');

    await user.keyboard('{ArrowUp}');

    const options = await screen.findAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', options.at(-1).id);
  });

  it('un rechazo sin objeto de error (undefined) también se trata como fallo general', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockImplementation(() => Promise.reject(undefined));
    const { input } = renderCombobox();

    await user.type(input, 'casco');

    expect((await screen.findAllByText(/No se pudo buscar en el catálogo/)).length).toBeGreaterThanOrEqual(1);
  });

  it('funciona sin onQueryChange', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO]));
    const { input, onSelect } = renderCombobox({ onQueryChange: undefined });

    await user.type(input, 'casco');
    await user.click(await screen.findByRole('option'));
    await user.type(input, 'x');
    await user.keyboard('{Escape}{Escape}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('');
  });

  it('autoFocus enfoca el campo al montar', () => {
    const { input } = renderCombobox({ autoFocus: true });

    expect(input).toHaveFocus();
  });
});

describe('CatalogCombobox — respuestas tardías y limpieza', () => {
  it('si se borra el texto antes de que llegue la respuesta, ésta no vuelve a abrir la lista', async () => {
    const user = userEvent.setup();
    let resolve;
    requestsApi.searchRequestCatalog.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await waitFor(() => expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(1));
    const { signal } = requestsApi.searchRequestCatalog.mock.calls[0][1];
    await user.clear(input);

    expect(signal.aborted).toBe(true);
    resolve(answer([CASCO]));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('al desmontar con una consulta en curso la cancela y no deja avisos de React', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolve;
    requestsApi.searchRequestCatalog.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const view = render(<CatalogCombobox id="u" label="Buscar" onSelect={() => {}} />);

    await user.type(screen.getByRole('combobox', { name: 'Buscar' }), 'casco');
    await waitFor(() => expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(1));
    const { signal } = requestsApi.searchRequestCatalog.mock.calls[0][1];
    view.unmount();

    expect(signal.aborted).toBe(true);
    resolve(answer([CASCO]));
    await new Promise((r) => setTimeout(r, 30));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('al desmontar antes de que pase la pausa no llega a consultar', () => {
    vi.useFakeTimers();
    const view = render(<CatalogCombobox id="u2" label="Buscar" onSelect={() => {}} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Buscar' }), { target: { value: 'casco' } });
    view.unmount();
    vi.advanceTimersByTime(CATALOG_DEBOUNCE_MS * 2);

    expect(requestsApi.searchRequestCatalog).not.toHaveBeenCalled();
  });
});

describe('CatalogCombobox — varias instancias en una página', () => {
  it('cada instancia sin id propio tiene su lista y sus opciones con ids distintos', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO]));
    render(
      <>
        <CatalogCombobox label="Buscar uno" onSelect={() => {}} />
        <CatalogCombobox label="Buscar dos" onSelect={() => {}} />
      </>,
    );
    const [one, two] = [screen.getByRole('combobox', { name: 'Buscar uno' }), screen.getByRole('combobox', { name: 'Buscar dos' })];
    expect(one.id).not.toBe(two.id);

    await user.type(one, 'casco');
    const listbox = await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}');

    expect(one).toHaveAttribute('aria-controls', listbox.id);
    expect(two).not.toHaveAttribute('aria-controls');
    expect(one.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option').id);
    expect(listbox.id.startsWith(one.id)).toBe(true);
  });

  it('abrir una no abre la otra', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO]));
    render(
      <>
        <CatalogCombobox label="Buscar uno" onSelect={() => {}} />
        <CatalogCombobox label="Buscar dos" onSelect={() => {}} />
      </>,
    );

    await user.type(screen.getByRole('combobox', { name: 'Buscar dos' }), 'casco');
    await screen.findByRole('listbox');

    expect(screen.getByRole('combobox', { name: 'Buscar uno' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
  });
});

describe('CatalogCombobox — dónde se dibuja la lista', () => {
  const originalHeight = window.innerHeight;
  const originalWidth = window.innerWidth;

  function setViewport(width, height) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  afterEach(() => {
    setViewport(originalWidth, originalHeight);
  });

  async function openAt(rect) {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO]));
    const { input } = renderCombobox();
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      ...rect, right: rect.left + rect.width, height: rect.bottom - rect.top, x: rect.left, y: rect.top,
    });
    await user.type(input, 'casco');
    return (await screen.findByRole('listbox')).parentElement;
  }

  it('con espacio debajo la dibuja debajo del campo', async () => {
    setViewport(1000, 800);

    const popup = await openAt({ left: 100, top: 100, bottom: 124, width: 400 });

    expect(popup.style.top).toBe('128px');
    expect(popup.style.bottom).toBe('');
    expect(popup.style.left).toBe('100px');
    expect(popup.style.width).toBe('400px');
    expect(popup.style.maxHeight).toBe('320px');
  });

  it('sin espacio debajo y más arriba la dibuja encima del campo', async () => {
    setViewport(1000, 600);

    const popup = await openAt({ left: 100, top: 500, bottom: 524, width: 200 });

    expect(popup.style.bottom).toBe('104px');                 // 600 - 500 + 4
    expect(popup.style.top).toBe('');
    expect(popup.style.width).toBe('340px');                  // never narrower than the minimum
  });

  it('no se sale de la ventana por la derecha ni por la izquierda', async () => {
    setViewport(1000, 800);

    const right = await openAt({ left: 900, top: 100, bottom: 124, width: 100 });
    expect(right.style.left).toBe('652px');                   // 1000 - 340 - 8
  });

  it('en una ventana angosta ocupa el ancho disponible con un margen a cada lado', async () => {
    setViewport(300, 800);

    const popup = await openAt({ left: 150, top: 100, bottom: 124, width: 120 });

    expect(popup.style.width).toBe('284px');                  // 300 - 2 * 8
    expect(popup.style.left).toBe('8px');
  });

  it('la altura máxima se ajusta al espacio disponible', async () => {
    setViewport(1000, 400);

    const popup = await openAt({ left: 50, top: 100, bottom: 124, width: 300 });

    expect(popup.style.top).toBe('128px');
    expect(popup.style.maxHeight).toBe('264px');              // 400 - 124 - 12
  });
});
