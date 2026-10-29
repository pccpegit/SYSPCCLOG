import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import LocationPicker from './LocationPicker';
import { LAYOUT } from '../../test/almacenFixtures';

// SYSPCC-025 · QA ronda 1 — selector de ubicación {Pabellón}{Sección}-{Nivel} (fase 3, almacenamiento).

const optionLabels = (select) => within(select).getAllByRole('option').map((o) => o.textContent);
const pavilion = () => screen.getByLabelText('Pabellón');
const section = () => screen.getByLabelText('Sección');
const level = () => screen.getByLabelText('Nivel');

function setup(props = {}) {
  const onChange = vi.fn();
  render(<LocationPicker layout={LAYOUT} onChange={onChange} idPrefix="t" {...props} />);
  return { onChange, user: userEvent.setup() };
}

describe('LocationPicker — elección', () => {
  it('la sección está deshabilitada hasta elegir pabellón', () => {
    setup();
    expect(section()).toBeDisabled();
    expect(pavilion()).toBeEnabled();
  });

  it('emite el código solo cuando los tres selectores están elegidos', async () => {
    const { onChange, user } = setup();
    await user.selectOptions(pavilion(), 'F');
    expect(onChange).toHaveBeenLastCalledWith('');
    await user.selectOptions(section(), '3');
    expect(onChange).toHaveBeenLastCalledWith('');
    await user.selectOptions(level(), '2');
    expect(onChange).toHaveBeenLastCalledWith('F3-2');
    expect(screen.getByText('F3-2')).toBeInTheDocument();
  });

  it.each([['A', 7], ['B', 7], ['C', 4], ['D', 4], ['E', 6], ['F', 6], ['K', 6]])(
    'el pabellón %s ofrece %i secciones',
    async (code, count) => {
      const { user } = setup();
      await user.selectOptions(pavilion(), code);
      expect(optionLabels(section())).toEqual(['—', ...Array.from({ length: count }, (_, i) => String(i + 1))]);
    },
  );

  it('ofrece los niveles 1 a 5 y ninguno más', () => {
    setup();
    expect(optionLabels(level())).toEqual(['—', '1', '2', '3', '4', '5']);
  });

  it('cambiar a un pabellón con menos secciones descarta la sección fuera de rango', async () => {
    const { onChange, user } = setup({ value: 'B7-2' });
    expect(section()).toHaveValue('7');
    await user.selectOptions(pavilion(), 'C');
    expect(section()).toHaveValue('');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('cambiar de pabellón conserva la sección si sigue siendo válida', async () => {
    const { onChange, user } = setup({ value: 'B3-2' });
    await user.selectOptions(pavilion(), 'C');
    expect(section()).toHaveValue('3');
    expect(onChange).toHaveBeenLastCalledWith('C3-2');
  });

  it('volver a la opción vacía del pabellón limpia el código', async () => {
    const { onChange, user } = setup({ value: 'B3-2' });
    await user.selectOptions(pavilion(), '');
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(section()).toBeDisabled();
  });
});

describe('LocationPicker — piso y valor inicial', () => {
  it('con piso 1 solo ofrece los pabellones A a E', () => {
    setup({ floor: 1 });
    expect(optionLabels(pavilion())).toEqual(['—', 'A', 'B', 'C', 'D', 'E']);
  });

  it('con piso 2 solo ofrece los pabellones F a K', () => {
    setup({ floor: '2' });
    expect(optionLabels(pavilion())).toEqual(['—', 'F', 'G', 'H', 'I', 'J', 'K']);
  });

  it('sin piso ofrece los dos pisos agrupados', () => {
    setup();
    expect(within(pavilion()).getAllByRole('group').map((g) => g.getAttribute('label'))).toEqual(['1er piso', '2do piso']);
  });

  it('preselecciona un valor válido', () => {
    setup({ value: 'f3-2' });
    expect([pavilion().value, section().value, level().value]).toEqual(['F', '3', '2']);
  });

  it.each(['Estante rojo', 'PISO 2', '', null, undefined, 'F3', 'F3-0'])(
    'un valor que no es del formato oficial («%s») deja todo sin elegir',
    (value) => {
      setup({ value });
      expect([pavilion().value, section().value, level().value]).toEqual(['', '', '']);
    },
  );

  it('deshabilitado bloquea los tres selectores', () => {
    setup({ disabled: true, value: 'F3-2' });
    expect([pavilion(), section(), level()].every((el) => el.disabled)).toBe(true);
  });

  it('anuncia el formato mientras falta alguna parte y la ubicación al completarla', async () => {
    const { user } = setup();
    expect(screen.getByText(/formato: pabellón \+ sección/i)).toBeInTheDocument();
    await user.selectOptions(pavilion(), 'B');
    await user.selectOptions(section(), '3');
    await user.selectOptions(level(), '2');
    expect(screen.getByText('B3-2').closest('p')).toHaveAttribute('aria-live', 'polite');
  });

  it('sin layout no se rompe y no ofrece pabellones', () => {
    setup({ layout: null });
    expect(optionLabels(pavilion())).toEqual(['—']);
    expect(optionLabels(level())).toEqual(['—', '1', '2', '3', '4', '5']);
  });

  it('si el layout no trae niveles usa 1 a 5', () => {
    setup({ layout: { floors: LAYOUT.floors } });
    expect(optionLabels(level())).toEqual(['—', '1', '2', '3', '4', '5']);
  });

  it('un padre que reinicia con key vuelve a empezar vacío', async () => {
    function Parent() {
      const [key, setKey] = useState(0);
      return (
        <>
          <LocationPicker key={key} layout={LAYOUT} value="" onChange={() => {}} idPrefix="r" />
          <button type="button" onClick={() => setKey((k) => k + 1)}>reiniciar</button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Parent />);
    await user.selectOptions(pavilion(), 'F');
    await user.click(screen.getByRole('button', { name: 'reiniciar' }));
    expect(pavilion()).toHaveValue('');
  });
});
