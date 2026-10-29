import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkerCombobox from './WorkerCombobox';
import * as almacenApi from '../../api/almacen';

vi.mock('../../api/almacen');

// SYSPCC-025 · QA ronda 2 — teclado, otros errores de búsqueda y formas de respuesta del buscador de trabajadores.
// Todos los nombres son inventados; nada se escribe a la consola ni al almacenamiento.

const person = (id, name) => ({ id, full_name: name, position: 'Operario', project_code: 'OP' });

function Harness({ onChangeSpy, ...props }) {
  const [value, setValue] = useState(null);
  return (
    <>
      <label htmlFor="worker">Trabajador</label>
      <WorkerCombobox id="worker" value={value} onChange={(v) => { setValue(v); onChangeSpy?.(v); }} {...props} />
    </>
  );
}

const box = () => screen.getByRole('combobox', { name: /trabajador/i });

beforeEach(() => {
  vi.clearAllMocks();
  almacenApi.lookupPersonal.mockResolvedValue({
    data: [person(1, 'Apellido Prueba Uno'), person(2, 'Apellido Prueba Dos'), person(3, 'Apellido Prueba Tres')],
  });
});

afterEach(() => vi.restoreAllMocks());

describe('WorkerCombobox — teclado', () => {
  it('ArrowDown y ArrowUp recorren las opciones con vuelta y Enter elige la activa', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    await user.type(box(), 'Apellido');
    await screen.findByRole('option', { name: /prueba uno/i });

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{ArrowUp}');                                  // vuelve al final: «Escribir manualmente»
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenCalledWith({ kind: 'manual', name: 'Apellido' });
  });

  it('Enter sobre la primera opción elige al primer trabajador', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    await user.type(box(), 'Apellido');
    await screen.findByRole('option', { name: /prueba uno/i });
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenCalledWith({ kind: 'personal', id: 1, name: 'Apellido Prueba Uno' });
  });

  it('Escape cierra la lista sin elegir a nadie', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    await user.type(box(), 'Apellido');
    await screen.findByRole('option', { name: /prueba uno/i });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
    expect(box()).toHaveValue('Apellido');
  });

  it('las flechas sin opciones (menos de 3 letras) no hacen nada ni abren una lista', async () => {
    const user = userEvent.setup();
    render(<Harness allowManual={false} />);
    await user.type(box(), 'Ap{ArrowDown}{ArrowUp}');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Enter con la lista cerrada no elige nada', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    await user.type(box(), 'Apellido');
    await screen.findByRole('option', { name: /prueba uno/i });
    await user.keyboard('{Escape}{Enter}');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('WorkerCombobox — respuestas y errores del servidor', () => {
  it('un error que no es 429 muestra el mensaje del servidor', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockRejectedValue({ response: { status: 400, data: { detail: 'Escriba al menos 3 letras o números.' } } });
    render(<Harness />);
    await user.type(box(), 'Apellido');
    await waitFor(() => expect(screen.getAllByText(/escriba al menos 3 letras o números/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/demasiadas búsquedas/i)).not.toBeInTheDocument();
  });

  it('un fallo de red usa el mensaje genérico y no deja la lista a medias', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockRejectedValue(new Error('Network Error'));
    render(<Harness />);
    await user.type(box(), 'Apellido');
    await waitFor(() => expect(screen.getAllByText(/no se pudo buscar trabajadores/i).length).toBeGreaterThan(0));
    expect(screen.queryByRole('option', { name: /prueba uno/i })).not.toBeInTheDocument();
  });

  it('la respuesta puede venir paginada ({results})', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockResolvedValue({ data: { results: [person(9, 'Apellido Prueba Nueve')] } });
    render(<Harness />);
    await user.type(box(), 'Nueve');
    expect(await screen.findByRole('option', { name: /apellido prueba nueve/i })).toBeInTheDocument();
  });

  it('una respuesta con otra forma se trata como «sin resultados»', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockResolvedValue({ data: { detail: 'algo' } });
    render(<Harness />);
    await user.type(box(), 'Nadie');
    expect((await screen.findAllByText(/no se encontraron trabajadores/i)).length).toBeGreaterThan(0);
  });

  it('sin permitir texto libre, una búsqueda sin resultados no ofrece «Escribir manualmente»', async () => {
    const user = userEvent.setup();
    almacenApi.lookupPersonal.mockResolvedValue({ data: [] });
    render(<Harness allowManual={false} />);
    await user.type(box(), 'Nadie');
    await screen.findAllByText(/no se encontraron trabajadores/i);
    expect(screen.queryByRole('option', { name: /escribir manualmente/i })).not.toBeInTheDocument();
  });
});
