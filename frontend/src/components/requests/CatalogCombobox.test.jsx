import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CatalogCombobox from './CatalogCombobox';
import * as requestsApi from '../../api/requests';

// SYSPCC-026: type-ahead over the warehouse catalog (GET /request-catalog/).
vi.mock('../../api/requests');

const CASCO = {
  id: 1, product_code: 'EPP-0001', description: 'Casco de seguridad blanco',
  unit: 'UND', category: 'EPP', available: '12.000',
};
const CASCO_AZUL = {
  id: 2, product_code: 'EPP-0002', description: 'Casco de seguridad azul',
  unit: 'UND', category: 'EPP', available: '0.500',
};

function answer(results, count = results.length) {
  return { data: { count, next: null, previous: null, results } };
}

// The message is shown in the popup AND spoken through the always-mounted live region.
async function expectShownAndAnnounced(text) {
  const matches = await screen.findAllByText(text);
  expect(matches.length).toBeGreaterThanOrEqual(2);
  expect(matches.some((el) => el.getAttribute('role') === 'status')).toBe(true);
}

function renderCombobox(props = {}) {
  const onSelect = vi.fn();
  const onQueryChange = vi.fn();
  render(
    <CatalogCombobox
      id="cat"
      label="Buscar producto del catálogo para el ítem 1"
      onSelect={onSelect}
      onQueryChange={onQueryChange}
      {...props}
    />,
  );
  return {
    onSelect,
    onQueryChange,
    input: screen.getByRole('combobox', { name: 'Buscar producto del catálogo para el ítem 1' }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CatalogCombobox — búsqueda', () => {
  it('no consulta con menos de 2 caracteres y lo explica', async () => {
    const user = userEvent.setup();
    const { input } = renderCombobox();

    await user.type(input, 'c');

    expect(await screen.findByText('Escriba al menos 2 caracteres para buscar.')).toBeInTheDocument();
    expect(requestsApi.searchRequestCatalog).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('espera a que termine de escribir: una sola consulta, con la señal para cancelar', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO]));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await screen.findByRole('option', { name: /EPP-0001/ });

    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(1);
    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledWith(
      'casco',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('muestra "Buscando…" y marca el campo ocupado mientras llega la respuesta', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockImplementation(() => new Promise(() => {}));
    const { input } = renderCombobox();

    await user.type(input, 'casco');

    expect(await screen.findByText('Buscando en el catálogo…')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-busy', 'true');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('lista código, descripción, unidad y disponible (como dato) con la semántica de combobox', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO, CASCO_AZUL]));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    const listbox = await screen.findByRole('listbox', { name: 'Productos del catálogo' });

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('EPP-0001');
    expect(options[0]).toHaveTextContent('Casco de seguridad blanco');
    expect(options[0]).toHaveTextContent('Unidad: UND');
    expect(options[0]).toHaveTextContent('Disponible en almacén central: 12 UND');
    expect(options[1]).toHaveTextContent('Disponible en almacén central: 0.5 UND');
    // Nothing is highlighted until the user moves with the arrows.
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('avisa cuando hay más resultados de los que se muestran', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO, CASCO_AZUL], 57));
    const { input } = renderCombobox();

    await user.type(input, 'casco');

    expect(await screen.findByText(/Mostrando 2 de 57 resultados/)).toBeInTheDocument();
  });

  it('sin coincidencias lo dice, sugiere "fuera de catálogo" y lo anuncia por la región de estado', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([]));
    const { input } = renderCombobox();

    await user.type(input, 'xyz');

    expect(await screen.findByText(/Sin resultados para «xyz»\. .*fuera de catálogo/)).toBeInTheDocument();
    const live = screen.getAllByRole('status').find((el) => el.textContent.startsWith('Sin resultados'));
    expect(live).toHaveTextContent('Sin resultados para «xyz».');
  });

  it('ignora la respuesta de una búsqueda ya superada y cancela su petición', async () => {
    const user = userEvent.setup();
    let resolveFirst;
    requestsApi.searchRequestCatalog
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(answer([CASCO_AZUL]));
    const { input } = renderCombobox();

    await user.type(input, 'ca');
    await waitFor(() => expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(1));
    const firstSignal = requestsApi.searchRequestCatalog.mock.calls[0][1].signal;

    await user.type(input, 'sc');
    await screen.findByRole('option', { name: /EPP-0002/ });
    expect(firstSignal.aborted).toBe(true);

    resolveFirst(answer([CASCO])); // late answer for the old term
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('option', { name: /EPP-0001/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
});

describe('CatalogCombobox — errores', () => {
  it('ante un fallo ofrece reintentar con Enter y se recupera', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(answer([CASCO]));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await expectShownAndAnnounced('No se pudo buscar en el catálogo. Presione Enter para reintentar.');

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('option', { name: /EPP-0001/ })).toBeInTheDocument();
    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(2);
  });

  it('ante el límite de peticiones (429) avisa y no reintenta solo', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockRejectedValue({ response: { status: 429 } });
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await expectShownAndAnnounced('Demasiadas búsquedas seguidas. Espere unos segundos y vuelva a intentar.');

    await new Promise((r) => setTimeout(r, 450));
    expect(requestsApi.searchRequestCatalog).toHaveBeenCalledTimes(1);
  });
});

describe('CatalogCombobox — teclado y selección', () => {
  async function openWithTwoResults(user) {
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO, CASCO_AZUL]));
    const view = renderCombobox();
    await user.type(view.input, 'casco');
    await screen.findByRole('listbox');
    return view;
  }

  it('las flechas recorren los resultados y Enter elige el resaltado', async () => {
    const user = userEvent.setup();
    const { input, onSelect, onQueryChange } = await openWithTwoResults(user);
    const [first, second] = screen.getAllByRole('option');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', second.id);
    expect(first).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowUp}{ArrowUp}'); // vuelve al primero y da la vuelta al último
    expect(input).toHaveAttribute('aria-activedescendant', second.id);

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(CASCO_AZUL);
    expect(input).toHaveValue('');
    expect(onQueryChange).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Enter sin ninguna opción resaltada no elige nada', async () => {
    const user = userEvent.setup();
    const { onSelect } = await openWithTwoResults(user);

    await user.keyboard('{Enter}');

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('con el mouse también se elige una opción', async () => {
    const user = userEvent.setup();
    const { onSelect } = await openWithTwoResults(user);

    await user.click(screen.getByRole('option', { name: /EPP-0001/ }));

    expect(onSelect).toHaveBeenCalledWith(CASCO);
  });

  it('Escape cierra la lista y un segundo Escape borra el texto', async () => {
    const user = userEvent.setup();
    const { input, onSelect, onQueryChange } = await openWithTwoResults(user);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('casco');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(onQueryChange).toHaveBeenLastCalledWith('');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Tab cierra la lista sin elegir y ArrowDown la vuelve a abrir', async () => {
    const user = userEvent.setup();
    const { input, onSelect } = await openWithTwoResults(user);

    await user.keyboard('{ArrowDown}{Tab}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    input.focus();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('informa el texto escrito mientras no se elige nada (para detectar "escrito pero sin elegir")', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([]));
    const { input, onQueryChange } = renderCombobox();

    await user.type(input, 'ab');

    expect(onQueryChange).toHaveBeenLastCalledWith('ab');
  });

  it('deshabilitado no permite escribir', () => {
    const { input } = renderCombobox({ disabled: true });
    expect(input).toBeDisabled();
  });

  it('marca el campo inválido y lo asocia al mensaje de error', () => {
    render(
      <>
        <CatalogCombobox id="c2" label="Buscar" onSelect={() => {}} invalid describedBy="err-1" />
        <p id="err-1">Seleccione un producto.</p>
      </>,
    );
    const input = screen.getByRole('combobox', { name: 'Buscar' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('err-1');
  });
});

describe('CatalogCombobox — contraste de los elementos no textuales (WCAG 1.4.11, 3:1)', () => {
  // gray-200 border = 1.2:1, blue-400 ring = 2.4-2.6:1. The control is the center of the task and
  // "which option is highlighted" depends on the ring, so both use the darker steps (≥ 4.8:1).
  it('el borde y el anillo de foco del campo son los oscuros', () => {
    const { input } = renderCombobox();
    expect(input).toHaveClass('border-gray-500', 'focus:ring-blue-600');
    expect(input).not.toHaveClass('border-gray-200');
    expect(input).not.toHaveClass('focus:ring-blue-400');
  });

  it('la opción resaltada lleva un anillo de 2 px oscuro (azul-600 / azul-400 en oscuro)', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockResolvedValue(answer([CASCO, CASCO_AZUL]));
    const { input } = renderCombobox();

    await user.type(input, 'casco');
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowDown}');

    const active = screen.getAllByRole('option').find((el) => el.getAttribute('aria-selected') === 'true');
    expect(active).toHaveClass('ring-2', 'ring-inset', 'ring-blue-600', 'dark:ring-blue-400');
    expect(active).not.toHaveClass('ring-blue-400');
  });
});
