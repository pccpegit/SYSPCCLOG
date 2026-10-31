import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RqCombobox from './RqCombobox';
import * as api from '../../api/almacen';
import { apiError, deliverablePage, deliverableRow } from '../../test/pickingFixtures';

vi.mock('../../api/almacen');

// SYSPCC-041 — selector OPCIONAL de «RQ pendientes por entregar».

const RQ_A = deliverableRow();
const RQ_B = deliverableRow({
  id: 8, rq_number: 'RQ-2026-0008', project: null, project_code: null, department: 'Administración',
  requested_by: 'Ana Prueba Tres', items_pending: 3, items_partial: 0, items_deliverable: 3, percent: null,
});

function Harness({ onPick = () => {}, initial = null }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <label id="rq-test-label" htmlFor="rq-test">RQ pendiente</label>
      <RqCombobox id="rq-test" value={value} onChange={(rq) => { onPick(rq); setValue(rq); }} />
    </div>
  );
}

const combo = () => screen.getByRole('combobox', { name: 'RQ pendiente' });

beforeEach(() => {
  vi.resetAllMocks();
  api.getDeliverableRequests.mockResolvedValue(deliverablePage([RQ_A, RQ_B]));
});

describe('RqCombobox — lista y búsqueda', () => {
  it('al abrir el campo lista los RQ pendientes sin escribir, con su resumen', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(api.getDeliverableRequests).not.toHaveBeenCalled(); // opcional: no pide nada hasta usarlo
    await user.click(combo());

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(api.getDeliverableRequests).toHaveBeenCalledWith({ page_size: 20 });
    expect(options[0]).toHaveTextContent('RQ-2026-0007');
    expect(options[0]).toHaveTextContent('Proyecto Prueba · PRU-01');
    expect(options[0]).toHaveTextContent('Luis Prueba Dos');
    expect(options[0]).toHaveTextContent('2 ítems pendientes');
    expect(options[0]).toHaveTextContent('37.5% atendido');
    // Sin proyecto cae al departamento; sin porcentaje no lo inventa.
    expect(options[1]).toHaveTextContent('Administración');
    expect(options[1]).toHaveTextContent('3 ítems pendientes');
    expect(options[1]).not.toHaveTextContent('%');
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    expect(combo()).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  it('busca con una pausa: una sola petición con el texto final', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(combo());
    await screen.findAllByRole('option');
    api.getDeliverableRequests.mockClear();
    api.getDeliverableRequests.mockResolvedValue(deliverablePage([RQ_B]));

    await user.type(combo(), 'Ana');
    await waitFor(() => expect(api.getDeliverableRequests).toHaveBeenCalledWith({ search: 'Ana', page_size: 20 }));
    expect(api.getDeliverableRequests).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('RQ-2026-0008');
  });

  it('avisa cuando hay más resultados que los mostrados', async () => {
    const user = userEvent.setup();
    api.getDeliverableRequests.mockResolvedValue(deliverablePage([RQ_A], 45));
    render(<Harness />);
    await user.click(combo());
    expect(await screen.findByText('Se muestran 1 de 45. Escriba más para afinar la búsqueda.')).toBeInTheDocument();
  });

  it('si el servidor recortó los candidatos (truncated) pide afinar la búsqueda', async () => {
    const user = userEvent.setup();
    const page = deliverablePage([RQ_A], 1);
    api.getDeliverableRequests.mockResolvedValue({ data: { ...page.data, truncated: true } });
    render(<Harness />);
    await user.click(combo());
    expect(await screen.findByText(/hay más requerimientos de los que se pueden listar/i)).toBeInTheDocument();
  });

  it('sin resultados lo dice y no abre la lista', async () => {
    const user = userEvent.setup();
    api.getDeliverableRequests.mockResolvedValue(deliverablePage([]));
    render(<Harness />);
    await user.click(combo());
    expect(await screen.findByText('No hay requerimientos pendientes de entrega.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combo()).toHaveAttribute('aria-expanded', 'false');

    await user.type(combo(), 'zzz');
    expect(await screen.findByText('No hay requerimientos pendientes de entrega que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('si la búsqueda falla muestra el error y «Reintentar» vuelve a pedirla', async () => {
    const user = userEvent.setup();
    api.getDeliverableRequests.mockRejectedValueOnce(apiError(500, '<html>'));
    render(<Harness />);
    await user.click(combo());
    expect(await screen.findByText('No se pudo cargar los requerimientos pendientes. Intente nuevamente.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(api.getDeliverableRequests).toHaveBeenCalledTimes(2);
  });

  it('distingue el límite de peticiones y la falta de permiso', async () => {
    const user = userEvent.setup();
    api.getDeliverableRequests.mockRejectedValueOnce(apiError(429, {}));
    const { unmount } = render(<Harness />);
    await user.click(combo());
    expect(await screen.findByText('Demasiadas búsquedas seguidas. Espere unos segundos.')).toBeInTheDocument();
    unmount();

    api.getDeliverableRequests.mockRejectedValueOnce(apiError(403, {}));
    render(<Harness />);
    await user.click(combo());
    expect(await screen.findByText('Su rol no puede ver los requerimientos pendientes de entrega.')).toBeInTheDocument();
  });
});

describe('RqCombobox — teclado y selección', () => {
  it('flechas mueven la opción activa, Enter elige y el foco pasa al RQ elegido', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    combo().focus();
    await screen.findAllByRole('option');
    const [first, second] = screen.getAllByRole('option');
    expect(combo()).toHaveAttribute('aria-activedescendant', first.id);

    await user.keyboard('{ArrowDown}');
    expect(combo()).toHaveAttribute('aria-activedescendant', second.id);
    expect(second).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}'); // da la vuelta
    expect(combo()).toHaveAttribute('aria-activedescendant', first.id);
    await user.keyboard('{ArrowUp}');
    expect(combo()).toHaveAttribute('aria-activedescendant', second.id);

    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(RQ_B);
    const chosen = screen.getByRole('group', { name: /rq pendiente/i });
    expect(chosen).toHaveTextContent('RQ-2026-0008');
    await waitFor(() => expect(chosen).toHaveFocus());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('Escape cierra la lista sin elegir nada; las flechas la vuelven a abrir', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    combo().focus();
    await screen.findAllByRole('option');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combo()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowDown}');
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('con el ratón también se elige', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await user.click(combo());
    await user.click(await screen.findByRole('option', { name: /RQ-2026-0007/ }));
    expect(onPick).toHaveBeenCalledWith(RQ_A);
  });

  it('«Quitar requerimiento» limpia la elección y devuelve el foco al buscador', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initial={RQ_A} onPick={onPick} />);
    expect(screen.getByRole('group', { name: /rq pendiente/i })).toHaveTextContent('RQ-2026-0007');
    await user.click(screen.getByRole('button', { name: 'Quitar requerimiento' }));
    expect(onPick).toHaveBeenCalledWith(null);
    await waitFor(() => expect(combo()).toHaveFocus());
  });
});
