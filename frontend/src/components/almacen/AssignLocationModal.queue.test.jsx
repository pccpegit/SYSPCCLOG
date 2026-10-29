import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LAYOUT, makeItem } from '../../test/almacenFixtures';
import AssignLocationModal from './AssignLocationModal';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');

// SYSPCC-025 · QA ronda 2 — ubicar una cola de pendientes seguidos (el almacenero tiene 254 por ubicar).

const QUEUE = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', floor: 2 }),
  makeItem({ id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', floor: 2 }),
  makeItem({ id: 3, product_code: 'EPP000003', description: 'Lentes claros', floor: 2 }),
];

function setup(props = {}) {
  const handlers = { onClose: vi.fn(), onDone: vi.fn(), onAssigned: vi.fn() };
  renderWithProviders(<AssignLocationModal open items={[QUEUE[0]]} queue={QUEUE} {...handlers} {...props} />);
  return { ...handlers, user: userEvent.setup() };
}

const codeField = () => screen.findByRole('textbox', { name: /código de ubicación/i });

beforeEach(() => {
  vi.clearAllMocks();
  api.getLocationLayout.mockResolvedValue({ data: LAYOUT });
  api.assignLocations.mockResolvedValue({ data: { updated: 1 } });
});

describe('AssignLocationModal — escribir el código', () => {
  /**
   * DEFECTO QA-31 (accesibilidad ronda 2): `checkLocationCode` valida el texto entero en cada tecla, así
   * que con la primera letra («F») ya aparece «Use el formato Pabellón + Sección – Nivel…» y se anuncia
   * a un lector de pantalla mientras la persona todavía está escribiendo un código válido.
   */
  it.each(['F', 'F3', 'F3-'])('DEFECTO QA-31: no muestra error de formato mientras se escribe el prefijo válido «%s»', async (prefix) => {
    const user = userEvent.setup();
    setup();
    await user.type(await codeField(), prefix);
    expect(screen.queryByText(/use el formato/i)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /código de ubicación/i })).not.toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    ['F3-9', /el nivel debe estar entre 1 y 5/i],
    ['Z3-2', /el pabellón z no existe/i],
    ['F9-2', /secciones del 1 al 6/i],
  ])('un código completo pero inexistente (%s) sí se avisa', async (typed, message) => {
    const user = userEvent.setup();
    setup();
    await user.type(await codeField(), typed);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('un código válido en minúsculas se normaliza y habilita los selectores', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await codeField(), 'f3-2');
    expect(screen.getByRole('textbox', { name: /código de ubicación/i })).toHaveValue('F3-2');
    expect(screen.getByLabelText('Pabellón')).toHaveValue('F');
    expect(screen.getByLabelText('Nivel')).toHaveValue('2');
  });

  it('intentar guardar un prefijo incompleto sí muestra el error y no llama al servidor', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await codeField(), 'F3{Enter}');
    expect(await screen.findByText(/corrija el código de ubicación/i)).toBeInTheDocument();
    expect(api.assignLocations).not.toHaveBeenCalled();
  });
});

describe('AssignLocationModal — recorrer la cola', () => {
  it('«Asignar y siguiente» guarda, avisa a la lista y deja el diálogo abierto en el próximo ítem', async () => {
    const user = userEvent.setup();
    const { onAssigned, onDone } = setup();
    await user.type(await codeField(), 'F3-2');
    expect(screen.getByText(/quedan 2 ítems pendientes/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /asignar y siguiente/i }));
    await waitFor(() => expect(api.assignLocations).toHaveBeenCalledWith([{ inventory: 1, location: 'F3-2' }]));
    expect(onAssigned).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();

    const list = await screen.findByRole('list', { name: /ítems seleccionados/i });
    expect(within(list).getByText('EPP000002')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /código de ubicación/i })).toHaveValue('');
    await waitFor(() => expect(screen.getByRole('textbox', { name: /código de ubicación/i })).toHaveFocus());
    expect(screen.getByText(/queda 1 ítem pendiente/i)).toBeInTheDocument();
  });

  it('recorre toda la cola y, al llegar al último ítem, solo ofrece «Asignar»', async () => {
    const user = userEvent.setup();
    const { onDone } = setup();
    await user.type(await codeField(), 'F3-2');
    await user.click(screen.getByRole('button', { name: /asignar y siguiente/i }));
    await screen.findByText('EPP000002');
    await user.type(screen.getByRole('textbox', { name: /código de ubicación/i }), 'F3-3');
    await user.click(screen.getByRole('button', { name: /asignar y siguiente/i }));
    await screen.findByText('EPP000003');

    expect(screen.queryByRole('button', { name: /asignar y siguiente/i })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /código de ubicación/i }), 'F3-4');
    await user.click(screen.getByRole('button', { name: /^asignar$/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.assignLocations.mock.calls.map((c) => c[0][0].location)).toEqual(['F3-2', 'F3-3', 'F3-4']);
  });

  it('si el servidor rechaza el ítem actual no avanza y conserva lo escrito', async () => {
    const user = userEvent.setup();
    api.assignLocations.mockRejectedValue({
      response: { status: 400, data: { errors: [{ index: 0, field: 'location', error: 'La ubicación F3-2 no existe.' }] } },
    });
    const { onAssigned } = setup();
    await user.type(await codeField(), 'F3-2');
    await user.click(screen.getByRole('button', { name: /asignar y siguiente/i }));
    expect(await screen.findByText(/no se aplicó ningún cambio/i)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /ítems seleccionados/i });
    expect(within(list).getByText('EPP000001')).toBeInTheDocument();           // still on the same item
    expect(screen.getByRole('textbox', { name: /código de ubicación/i })).toHaveValue('F3-2');
    expect(onAssigned).not.toHaveBeenCalled();
  });

  /**
   * DEFECTO QA-32 (accesibilidad ronda 2): con la cola, Enter en el campo del código envía el formulario
   * como «Asignar» (cierra el diálogo) aunque «Asignar y siguiente» es lo que hace falta 254 veces seguidas:
   * obliga a usar el ratón o a tabular hasta el botón en cada ítem.
   */
  it('DEFECTO QA-32: Enter en el campo del código asigna y pasa al siguiente ítem sin cerrar', async () => {
    const user = userEvent.setup();
    const { onDone } = setup();
    await user.type(await codeField(), 'F3-2{Enter}');
    await waitFor(() => expect(api.assignLocations).toHaveBeenCalledTimes(1));
    await screen.findByText('EPP000002');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('sin cola (un ítem suelto) Enter asigna y cierra, como siempre', async () => {
    const user = userEvent.setup();
    const { onDone } = setup({ queue: [] });
    await user.type(await codeField(), 'F3-2{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});

describe('AssignLocationModal — corrección de QA-31 y QA-32', () => {
  it.each(['FF', 'F-', 'F3-2-', '3'])('«%s» ya no puede llegar a ser un código válido: se avisa sin esperar al envío', async (typed) => {
    const user = userEvent.setup();
    setup();
    await user.type(await codeField(), typed);
    expect(await screen.findByText(/use el formato/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /código de ubicación/i })).toHaveAttribute('aria-invalid', 'true');
  });

  it('el error de un código completo desaparece al corregirlo y no queda ninguno mientras se reescribe', async () => {
    const user = userEvent.setup();
    setup();
    const input = await codeField();
    await user.type(input, 'F3-9');
    expect(await screen.findByText(/el nivel debe estar entre 1 y 5/i)).toBeInTheDocument();
    await user.clear(input);
    expect(screen.queryByText(/el nivel debe estar entre/i)).not.toBeInTheDocument();
    await user.type(input, 'F3-');
    expect(screen.queryByText(/use el formato/i)).not.toBeInTheDocument();
    await user.type(input, '2');
    expect(screen.getByLabelText('Nivel')).toHaveValue('2');
  });

  it('con cola, «Asignar y siguiente» es la acción principal que envía el formulario y «Asignar y cerrar» cierra', async () => {
    const user = userEvent.setup();
    const { onDone } = setup();
    const primary = await screen.findByRole('button', { name: /asignar y siguiente/i });
    expect(primary).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button', { name: /asignar y cerrar/i })).toHaveAttribute('type', 'button');
    expect(screen.queryByRole('button', { name: /^asignar$/i })).not.toBeInTheDocument();

    await user.type(await codeField(), 'F3-2');
    await user.click(screen.getByRole('button', { name: /asignar y cerrar/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.assignLocations).toHaveBeenCalledWith([{ inventory: 1, location: 'F3-2' }]);
  });

  it('Enter en un ítem suelto (sin cola) sigue siendo «Asignar» y deja «Asignar» como único botón principal', async () => {
    setup({ queue: [] });
    expect(await screen.findByRole('button', { name: /^asignar$/i })).toHaveAttribute('type', 'submit');
    expect(screen.queryByRole('button', { name: /asignar y cerrar/i })).not.toBeInTheDocument();
  });

  it('al avanzar anuncia el ítem siguiente (código y descripción) en una región viva', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await codeField(), 'F3-2{Enter}');
    await screen.findByText('EPP000002');
    const live = document.body.querySelector('[aria-live="polite"].sr-only');
    expect(live).toHaveTextContent('Ítem siguiente: EPP000002, Guantes de cuero.');
  });
});
