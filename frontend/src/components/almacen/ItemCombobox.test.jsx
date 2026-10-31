import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ItemCombobox from './ItemCombobox';
import { exactItem, makeItem } from '../../test/almacenFixtures';

const ITEMS = [
  exactItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', total_stock: 12 }),
  makeItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', total_stock: 0, stocks: [] }),
  makeItem({ id: 3, product_code: 'TMT000003', description: 'Cinta métrica', unit: 'M2', total_stock: 4 }),
];

function Harness({ onSubmit = () => {}, onChangeSpy, ...props }) {
  const [value, setValue] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <label htmlFor="cb">Ítem</label>
      <ItemCombobox
        id="cb"
        items={ITEMS}
        value={value}
        onChange={(v) => { setValue(v); onChangeSpy?.(v); }}
        {...props}
      />
    </form>
  );
}

describe('ItemCombobox', () => {
  it('expone el patrón combobox y lista los ítems al enfocar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /ítem/i });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(screen.getByText('3 resultados')).toBeInTheDocument();
  });

  it('filtra por código o descripción sin distinguir acentos', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'metrica');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('TMT000003');
  });

  it('elige con clic y muestra el ítem elegido', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /casco blanco/i }));
    expect(spy).toHaveBeenCalledWith('1');
    expect(screen.getByRole('combobox')).toHaveValue('EPP000001 — Casco blanco');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('con flechas y Enter elige el ítem sin enviar el formulario; Escape cierra', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const spy = vi.fn();
    render(<Harness onSubmit={onSubmit} onChangeSpy={spy} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(spy).toHaveBeenCalledWith('2'); // la opción activa pasa del índice 0 al 1
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('con requireStock deshabilita los ítems sin stock y no los deja elegir', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness requireStock onChangeSpy={spy} />);
    await user.click(screen.getByRole('combobox'));
    const noStock = screen.getByRole('option', { name: /guantes de cuero/i });
    expect(noStock).toHaveAttribute('aria-disabled', 'true');
    expect(noStock).toHaveTextContent('Sin stock');
    await user.click(noStock);
    expect(spy).not.toHaveBeenCalled();
  });

  it('indica cuando no hay resultados y mientras carga', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'zzzz');
    expect(screen.getByText('No se encontraron ítems.')).toBeInTheDocument();

    rerender(<Harness loading />);
    expect(screen.getByText('Cargando ítems…')).toBeInTheDocument();
  });

  it('muestra "Pendiente de ubicar" o la ubicación exacta de cada ítem', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /casco blanco/i })).toHaveTextContent('Ubicación F3-2');
    expect(screen.getByRole('option', { name: /cinta métrica/i })).toHaveTextContent('Pendiente de ubicar');
  });
});
