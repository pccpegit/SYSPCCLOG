import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CatalogCombobox from './CatalogCombobox';
import * as requestsApi from '../../api/requests';

// SYSPCC-026 (ronda 2, hallazgo rojo de accesibilidad: foco que cae a <body>).
//
// Contract of the pick: `onSelect` may return a promise. If it settles with `false` / `{ok:false}`
// (or rejects) the pick was not applied: the typed text comes back and the keyboard stays in the
// input. While the parent saves it passes `busy`: the input is read-only, NOT disabled (a disabled
// control loses the focus in a browser), and further picks are ignored.
configure({ asyncUtilTimeout: 4000 });
vi.mock('../../api/requests');

const CASCO = { id: 1, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND', category: 'EPP', available: '12.000' };

function setup(props = {}) {
  const onQueryChange = vi.fn();
  render(<CatalogCombobox id="cat" label="Buscar producto" onQueryChange={onQueryChange} {...props} />);
  return { input: screen.getByRole('combobox', { name: 'Buscar producto' }), onQueryChange };
}

async function typeAndPick(user, input) {
  await user.type(input, 'casco');
  await user.click(await screen.findByRole('option', { name: /EPP-0001/ }));
}

beforeEach(() => {
  vi.resetAllMocks();
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [CASCO] } });
});

describe('CatalogCombobox — una elección que no se pudo aplicar', () => {
  it('con una promesa que resuelve false devuelve el texto escrito y mantiene el foco', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockResolvedValue(false);
    const { input, onQueryChange } = setup({ onSelect });

    await typeAndPick(user, input);

    await waitFor(() => expect(input).toHaveValue('casco'));
    expect(onSelect).toHaveBeenCalledWith(CASCO);
    expect(input).toHaveFocus();
    expect(onQueryChange).toHaveBeenLastCalledWith('casco');
  });

  it('con { ok: false } o con un rechazo también devuelve el texto', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error('boom'));
    const { input } = setup({ onSelect });

    await typeAndPick(user, input);
    await waitFor(() => expect(input).toHaveValue('casco'));

    await user.clear(input);
    await typeAndPick(user, input);
    await waitFor(() => expect(input).toHaveValue('casco'));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('si la elección se aplicó (true, { ok: true } o sin promesa) el campo queda vacío', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockResolvedValue(true);
    const { input } = setup({ onSelect });

    await typeAndPick(user, input);

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(input).toHaveValue('');
  });

  it('no pisa lo que la persona ya escribió mientras tanto', async () => {
    const user = userEvent.setup();
    let fail;
    const onSelect = vi.fn(() => new Promise((resolve) => { fail = resolve; }));
    const { input } = setup({ onSelect });

    await typeAndPick(user, input);
    await user.type(input, 'guantes');
    fail(false);

    await waitFor(() => expect(input).toHaveValue('guantes'));
  });

  it('no le quita el foco a otro control al que la persona ya se movió', async () => {
    const user = userEvent.setup();
    let fail;
    const onSelect = vi.fn(() => new Promise((resolve) => { fail = resolve; }));
    render(
      <>
        <CatalogCombobox id="cat" label="Buscar producto" onSelect={onSelect} />
        <button type="button">Otro control</button>
      </>,
    );
    const input = screen.getByRole('combobox', { name: 'Buscar producto' });

    await typeAndPick(user, input);
    await user.click(screen.getByRole('button', { name: 'Otro control' }));
    fail(false);

    await waitFor(() => expect(input).toHaveValue('casco'));
    expect(screen.getByRole('button', { name: 'Otro control' })).toHaveFocus();
  });
});

describe('CatalogCombobox — busy (el padre está guardando la elección)', () => {
  it('queda en solo lectura, sin deshabilitar, con aria-busy, y conserva el foco', async () => {
    const user = userEvent.setup();
    const { input } = setup({ onSelect: vi.fn(), busy: true });

    await user.click(input);
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveAttribute('aria-busy', 'true');
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
  });

  it('ignora el texto y las teclas, y Enter no llega a un formulario', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e) => e.preventDefault());
    const onSelect = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <CatalogCombobox id="cat" label="Buscar producto" onSelect={onSelect} busy />
      </form>,
    );
    const input = screen.getByRole('combobox', { name: 'Buscar producto' });

    await user.click(input);
    await user.keyboard('casco{ArrowDown}{Enter}');

    expect(input).toHaveValue('');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(requestsApi.searchRequestCatalog).not.toHaveBeenCalled();
  });

  it('Tab sigue funcionando: no atrapa el foco', async () => {
    const user = userEvent.setup();
    render(
      <>
        <CatalogCombobox id="cat" label="Buscar producto" onSelect={vi.fn()} busy />
        <button type="button">Siguiente</button>
      </>,
    );
    await user.click(screen.getByRole('combobox', { name: 'Buscar producto' }));

    await user.tab();

    expect(screen.getByRole('button', { name: 'Siguiente' })).toHaveFocus();
  });

  it('sin busy se comporta como siempre', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { input } = setup({ onSelect });

    expect(input).not.toHaveAttribute('readonly');
    await typeAndPick(user, input);

    expect(onSelect).toHaveBeenCalledWith(CASCO);
    expect(input).toHaveValue('');
  });
});
