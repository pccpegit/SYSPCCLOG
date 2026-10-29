import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkerCombobox from './WorkerCombobox';
import { Field } from './ui';
import * as almacenApi from '../../api/almacen';

vi.mock('../../api/almacen');

const person = (id, name) => ({ id, full_name: name, position: 'Operario', project_code: 'OP' });

function Harness({ onChangeSpy, initial = null, ...props }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="worker">Trabajador</label>
      <WorkerCombobox id="worker" value={value} onChange={(v) => { setValue(v); onChangeSpy?.(v); }} {...props} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  almacenApi.lookupPersonal.mockResolvedValue({ data: [] });
});

afterEach(() => vi.restoreAllMocks());

describe('WorkerCombobox', () => {
  it('no consulta con menos de 3 letras', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Ap');
    await new Promise((r) => setTimeout(r, 500)); // más que el debounce
    expect(almacenApi.lookupPersonal).not.toHaveBeenCalled();
  });

  it('consulta una sola vez tras el debounce y muestra solo nombre y puesto (máx. 10)', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockResolvedValue({
      data: Array.from({ length: 15 }, (_, i) => person(i + 1, `Apellido Prueba ${i + 1}`)),
    });
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'Ape');

    const options = await screen.findAllByRole('option');
    expect(almacenApi.lookupPersonal).toHaveBeenCalledTimes(1);
    expect(almacenApi.lookupPersonal).toHaveBeenCalledWith('Ape');
    expect(options).toHaveLength(11); // 10 trabajadores + "Escribir manualmente"
    expect(options[0]).toHaveTextContent('Apellido Prueba 1');
    expect(options[0]).toHaveTextContent('Operario');
    expect(options[0]).not.toHaveTextContent(/dni/i);
  });

  it('al elegir un trabajador entrega su id y nombre', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    almacenApi.lookupPersonal.mockResolvedValue({ data: [person(7, 'Apellido Prueba Siete')] });
    render(<Harness onChangeSpy={spy} />);
    await user.type(screen.getByRole('combobox'), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));

    expect(spy).toHaveBeenCalledWith({ kind: 'personal', id: 7, name: 'Apellido Prueba Siete' });
    expect(screen.getByText('Apellido Prueba Siete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cambiar trabajador/i })).toBeInTheDocument();
  });

  it('sin coincidencias ofrece escribirlo manualmente y avisa que quedará como texto', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    await user.type(screen.getByRole('combobox'), 'Nadie Existe');

    expect((await screen.findAllByText(/no se encontraron trabajadores/i)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('option', { name: /escribir manualmente «Nadie Existe»/i }));

    expect(spy).toHaveBeenCalledWith({ kind: 'manual', name: 'Nadie Existe' });
    expect(screen.getByText(/no figura en personal; la entrega se registrará como texto/i)).toBeInTheDocument();
  });

  it('"Cambiar trabajador" vuelve a la búsqueda', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={{ kind: 'manual', name: 'Texto Libre' }} onChangeSpy={spy} />);
    await user.click(screen.getByRole('button', { name: /cambiar trabajador/i }));
    expect(spy).toHaveBeenCalledWith(null);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('informa el exceso de búsquedas (429) sin romper', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockRejectedValue({ response: { status: 429, data: {} } });
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'Muchas');
    await waitFor(() => expect(screen.getAllByText(/demasiadas búsquedas seguidas/i).length).toBeGreaterThan(0));
  });

  it('no guarda lo escrito ni los resultados en el almacenamiento del navegador', async () => {
    const user = userEvent.setup();
    const local = vi.spyOn(Storage.prototype, 'setItem');
    almacenApi.lookupPersonal.mockResolvedValue({ data: [person(1, 'Apellido Prueba Uno')] });
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'Apellido');
    await screen.findByRole('option', { name: /apellido prueba uno/i });
    expect(local).not.toHaveBeenCalled();
  });
});

// SYSPCC-025 · react-frontend ronda 1 — foco y nombre accesible tras elegir / cambiar trabajador.
describe('WorkerCombobox — foco y lectores de pantalla', () => {
  function FieldHarness({ onCancelSpy, ...props }) {
    const [value, setValue] = useState(null);
    return (
      <>
        <Field label="Trabajador" required>
          <WorkerCombobox value={value} onChange={setValue} {...props} />
        </Field>
        <button type="button" onClick={onCancelSpy}>Otro control</button>
      </>
    );
  }

  it('tras elegir un trabajador el foco pasa al recuadro del valor, que se anuncia con su nombre', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockResolvedValue({ data: [person(7, 'Apellido Prueba Siete')] });
    render(<FieldHarness />);
    await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));

    const group = await screen.findByRole('group', { name: /trabajador apellido prueba siete/i });
    expect(group).toHaveFocus();
  });

  it('con teclado (Enter sobre la opción activa) el foco también pasa al valor elegido', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockResolvedValue({ data: [person(7, 'Apellido Prueba Siete')] });
    render(<FieldHarness />);
    await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Siete');
    await screen.findByRole('option', { name: /apellido prueba siete/i });
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('group', { name: /apellido prueba siete/i })).toHaveFocus();
  });

  it('«Cambiar trabajador» devuelve el foco al campo de búsqueda', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockResolvedValue({ data: [person(7, 'Apellido Prueba Siete')] });
    render(<FieldHarness />);
    await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));
    await user.click(await screen.findByRole('button', { name: /cambiar trabajador/i }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /trabajador/i })).toHaveFocus());
  });

  it('no roba el foco al montarse si no se pide', () => {
    render(<FieldHarness />);
    expect(screen.getByRole('combobox', { name: /trabajador/i })).not.toHaveFocus();
  });

  it('con autoFocus enfoca la búsqueda al montarse (por ejemplo al abrirla desde «Vincular»)', () => {
    render(<FieldHarness autoFocus />);
    expect(screen.getByRole('combobox', { name: /trabajador/i })).toHaveFocus();
  });

  it('el mínimo de 3 letras es un texto visible ligado al campo, no solo el placeholder', () => {
    render(<FieldHarness />);
    const input = screen.getByRole('combobox', { name: /trabajador/i });
    expect(input).toHaveAccessibleDescription(/al menos 3 letras/i);
    expect(input).toHaveAttribute('placeholder', 'Apellidos y nombres');
  });

  it('mientras se escriben 1 o 2 letras avisa que faltan para buscar', async () => {
    const user = userEvent.setup();
    render(<FieldHarness />);
    await user.type(screen.getByRole('combobox', { name: /trabajador/i }), 'Ap');
    expect(screen.getByRole('status')).toHaveTextContent('Escriba al menos 3 letras para buscar.');
    expect(almacenApi.lookupPersonal).not.toHaveBeenCalled();
  });
});
