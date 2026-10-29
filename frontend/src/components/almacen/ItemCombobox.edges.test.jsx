import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ItemCombobox from './ItemCombobox';
import { makeItem } from '../../test/almacenFixtures';

// SYSPCC-025 · QA ronda 2 — catálogos largos, flechas con vuelta y existencias en cero del combobox de ítems.

const MANY = Array.from({ length: 60 }, (_, i) => makeItem({
  id: i + 1, product_code: `EPP${String(i + 1).padStart(6, '0')}`, description: `Guante de prueba ${i + 1}`, total_stock: i % 2 ? 0 : 3,
}));

function Harness({ items = MANY, onChangeSpy, ...props }) {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="cb">Ítem</label>
      <ItemCombobox id="cb" items={items} value={value} onChange={(v) => { setValue(v); onChangeSpy?.(v); }} {...props} />
    </>
  );
}

const box = () => screen.getByRole('combobox', { name: /ítem/i });

describe('ItemCombobox — catálogos largos', () => {
  it('con más ítems de los que caben avisa cuántos se ven y pide acotar la búsqueda', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    expect(await screen.findByText(/mostrando \d+ de 60\. siga escribiendo para acotar/i)).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBeLessThan(60);
  });

  it('al acotar la búsqueda el aviso desaparece', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), 'prueba 7');
    await screen.findAllByRole('option');
    expect(screen.queryByText(/siga escribiendo para acotar/i)).not.toBeInTheDocument();
  });

  it('mientras carga no se anuncia un recorte que todavía no es cierto', async () => {
    const user = userEvent.setup();
    render(<Harness loading />);
    await user.click(box());
    expect(screen.queryByText(/siga escribiendo para acotar/i)).not.toBeInTheDocument();
  });
});

describe('ItemCombobox — teclado y existencias', () => {
  it('ArrowUp desde el primero salta al último de los visibles y Enter lo elige', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const items = MANY.slice(0, 3);
    render(<Harness items={items} onChangeSpy={spy} />);
    await user.click(box());
    await user.keyboard('{ArrowUp}{Enter}');
    expect(spy).toHaveBeenCalledWith('3');
  });

  it('las flechas sin resultados no rompen ni abren la lista', async () => {
    const user = userEvent.setup();
    render(<Harness items={MANY.slice(0, 3)} />);
    await user.type(box(), 'zzzz');
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(box()).toHaveAttribute('aria-expanded', 'true');           // sigue abierto con el aviso de «sin resultados»
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('un ítem sin existencias dice «Sin stock» en vez de «0 EA»', async () => {
    const user = userEvent.setup();
    render(<Harness items={[MANY[1]]} />);
    await user.click(box());
    const option = await screen.findByRole('option');
    expect(within(option).getByText('Sin stock')).toBeInTheDocument();
    expect(within(option).queryByText(/^0/)).not.toBeInTheDocument();
  });

  it('getStock personalizado decide qué ítems se pueden elegir con requireStock', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const items = [MANY[0], MANY[2]];
    render(<Harness items={items} requireStock getStock={(item) => (item.id === 1 ? 0 : 5)} onChangeSpy={spy} />);
    await user.click(box());
    const [first, second] = await screen.findAllByRole('option');
    expect(first).toHaveAttribute('aria-disabled', 'true');
    await user.click(first);
    expect(spy).not.toHaveBeenCalled();
    await user.click(second);
    expect(spy).toHaveBeenCalledWith('3');
  });

  it('Enter con la lista cerrada o sin ítem activo no elige nada', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness items={[]} onChangeSpy={spy} />);
    await user.click(box());
    await user.keyboard('{Enter}');
    expect(spy).not.toHaveBeenCalled();
  });
});
