import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RqCombobox from './RqCombobox';
import * as api from '../../api/almacen';
import { apiError, deliverablePage, deliverableRow } from '../../test/pickingFixtures';

vi.mock('../../api/almacen');

// SYSPCC-041 · FASE 4 (qa-engineer) — respuestas fuera de orden, foco y teclado del selector de RQ.

const RQ_A = deliverableRow();
const RQ_B = deliverableRow({ id: 8, rq_number: 'RQ-2026-0008', requested_by: 'Ana Prueba Tres' });

function Harness({ onPick = () => {} }) {
  const [value, setValue] = useState(null);
  return (
    <div>
      <label id="rq-test-label" htmlFor="rq-test">RQ pendiente</label>
      <RqCombobox id="rq-test" value={value} onChange={(rq) => { onPick(rq); setValue(rq); }} />
      <button type="button">Otro control</button>
    </div>
  );
}

const combo = () => screen.getByRole('combobox', { name: 'RQ pendiente' });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getDeliverableRequests.mockResolvedValue(deliverablePage([RQ_A, RQ_B]));
});

describe('RqCombobox — respuestas fuera de orden', () => {
  it('una respuesta lenta de una búsqueda anterior no reemplaza la del texto actual', async () => {
    const user = userEvent.setup();
    const slow = deferred();
    api.getDeliverableRequests.mockImplementation(({ search }) => {
      if (search === 'A') return slow.promise;
      return Promise.resolve(deliverablePage([RQ_B]));
    });
    render(<Harness />);
    await user.click(combo());
    await screen.findAllByRole('option');
    await user.type(combo(), 'A');
    await waitFor(() => expect(api.getDeliverableRequests).toHaveBeenCalledWith({ search: 'A', page_size: 20 }));
    await user.type(combo(), 'n');                                     // texto final «An»
    expect(await screen.findByRole('option', { name: /RQ-2026-0008/ })).toBeInTheDocument();

    slow.resolve(deliverablePage([RQ_A, RQ_A, RQ_A]));
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('RQ-2026-0008');
  });

  it('un error tardío de una búsqueda anterior no tapa los resultados vigentes', async () => {
    const user = userEvent.setup();
    const slow = deferred();
    api.getDeliverableRequests.mockImplementation(({ search }) => (
      search === 'A' ? slow.promise : Promise.resolve(deliverablePage([RQ_B]))
    ));
    render(<Harness />);
    await user.click(combo());
    await screen.findAllByRole('option');
    await user.type(combo(), 'A');
    await waitFor(() => expect(api.getDeliverableRequests).toHaveBeenCalledWith({ search: 'A', page_size: 20 }));
    await user.type(combo(), 'n');
    await screen.findByRole('option', { name: /RQ-2026-0008/ });

    slow.reject(apiError(500, { detail: 'boom' }));
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    expect(screen.getByRole('option', { name: /RQ-2026-0008/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
  });
});

describe('RqCombobox — foco y teclado', () => {
  it('al salir del campo con Tab cierra la lista sin elegir', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await user.click(combo());
    await screen.findAllByRole('option');

    await user.tab();

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combo()).toHaveAttribute('aria-expanded', 'false');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Enter mientras busca o sin resultados no elige nada', async () => {
    const user = userEvent.setup();
    const slow = deferred();
    const onPick = vi.fn();
    api.getDeliverableRequests.mockReturnValue(slow.promise);
    render(<Harness onPick={onPick} />);
    await user.click(combo());
    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();

    slow.resolve(deliverablePage([]));
    expect(await screen.findByText(/no hay requerimientos pendientes de entrega/i)).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();
    expect(combo()).toBeInTheDocument();
  });

  it('con la lista abierta Enter NUNCA envía el formulario (cargando, vacía, con error o con resultados)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e) => e.preventDefault());
    const slow = deferred();
    api.getDeliverableRequests.mockReturnValue(slow.promise);
    render(
      <form onSubmit={onSubmit}>
        <Harness />
        <button type="submit">Enviar</button>
      </form>,
    );
    await user.click(combo());
    await user.keyboard('{Enter}');                       // cargando
    expect(onSubmit).not.toHaveBeenCalled();

    slow.resolve(deliverablePage([]));
    await screen.findByText(/no hay requerimientos pendientes de entrega/i); // vacío
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');                       // cerrada: Enter sí envía (comportamiento normal del formulario)
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('con error de búsqueda Enter tampoco envía el formulario', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e) => e.preventDefault());
    api.getDeliverableRequests.mockRejectedValue(apiError(500, '<html>'));
    render(<form onSubmit={onSubmit}><Harness /></form>);
    await user.click(combo());
    await screen.findByRole('button', { name: 'Reintentar' });
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('con resultados Enter elige la opción activa y no envía el formulario', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e) => e.preventDefault());
    const onPick = vi.fn();
    render(<form onSubmit={onSubmit}><Harness onPick={onPick} /></form>);
    await user.click(combo());
    await screen.findAllByRole('option');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(RQ_A);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('«Reintentar» se alcanza con Tab sin que la lista se cierre, y reintenta con el teclado', async () => {
    const user = userEvent.setup();
    api.getDeliverableRequests.mockRejectedValueOnce(apiError(500, '<html>'));
    render(<Harness />);
    await user.click(combo());
    const retry = await screen.findByRole('button', { name: 'Reintentar' });

    await user.tab();
    expect(retry).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument(); // sigue montado

    await user.keyboard('{Enter}');
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(api.getDeliverableRequests).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(combo()).toHaveFocus()); // el foco no se pierde en el body
  });

  it('al salir de «Reintentar» con Tab el estado de error se cierra', async () => {
    const user = userEvent.setup();
    api.getDeliverableRequests.mockRejectedValue(apiError(500, '<html>'));
    render(<Harness />);
    await user.click(combo());
    await screen.findByRole('button', { name: 'Reintentar' });
    await user.tab();      // Reintentar
    await user.tab();      // Otro control
    expect(screen.getByRole('button', { name: 'Otro control' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('el texto con solo espacios cuenta como vacío: pide la lista sin filtro', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(combo());
    await screen.findAllByRole('option');
    api.getDeliverableRequests.mockClear();

    await user.type(combo(), '   ');

    await screen.findAllByRole('option');
    for (const [params] of api.getDeliverableRequests.mock.calls) expect(params).not.toHaveProperty('search');
  });

  it('con el campo deshabilitado no se abre ni consulta', async () => {
    const user = userEvent.setup();
    render(<RqCombobox id="rq-off" value={null} onChange={() => {}} disabled />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(api.getDeliverableRequests).not.toHaveBeenCalled();
  });
});
