import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LAYOUT, makeItem } from '../../test/almacenFixtures';
import AssignLocationModal from './AssignLocationModal';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');

// SYSPCC-025 · QA ronda 1 — asignar ubicación exacta (fase 3), todo o nada.

const ITEMS = [
  makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco', floor: 2 }),
  makeItem({ id: 2, product_code: 'EPP000002', description: 'Guante', floor: 2 }),
];

function setup(props = {}) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const utils = renderWithProviders(
    <AssignLocationModal open items={ITEMS} onClose={onClose} onDone={onDone} {...props} />,
  );
  return { onClose, onDone, user: userEvent.setup(), ...utils };
}

async function pick(user, code = 'F3-2') {
  const [p, s, l] = [code[0], code.slice(1, code.indexOf('-')), code.slice(-1)];
  await user.selectOptions(await screen.findByLabelText('Pabellón'), p);
  await user.selectOptions(screen.getByLabelText('Sección'), s);
  await user.selectOptions(screen.getByLabelText('Nivel'), l);
}

const assign = () => screen.getByRole('button', { name: /^asignar$/i });

beforeEach(() => {
  vi.clearAllMocks();
  api.getLocationLayout.mockResolvedValue({ data: LAYOUT });
  api.assignLocations.mockResolvedValue({ data: { updated: 2 } });
});

describe('AssignLocationModal — presentación', () => {
  it('cerrado no pide el layout ni muestra nada', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.getLocationLayout).not.toHaveBeenCalled();
  });

  it('con un ítem el título es «Asignar ubicación»; con varios cuenta los ítems', async () => {
    const { unmount } = setup({ items: [ITEMS[0]] });
    expect(await screen.findByRole('heading', { name: 'Asignar ubicación' })).toBeInTheDocument();
    unmount();
    setup();
    expect(await screen.findByRole('heading', { name: 'Asignar ubicación a 2 ítems' })).toBeInTheDocument();
  });

  it('lista hasta cinco ítems y resume el resto', async () => {
    const many = Array.from({ length: 8 }, (_, i) => makeItem({ id: 50 + i, product_code: `EPP9000${i}`, floor: 2 }));
    setup({ items: many });
    const list = await screen.findByRole('list', { name: /ítems seleccionados/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(within(list).getByText('y 3 más…')).toBeInTheDocument();
  });

  it('mientras llega el layout muestra «Cargando layout…»', () => {
    api.getLocationLayout.mockReturnValue(new Promise(() => {}));
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando layout…');
  });

  it('si el layout no carga lo dice y deja cancelar', async () => {
    api.getLocationLayout.mockRejectedValue(new Error('boom'));
    const { user, onClose } = setup();
    expect(await screen.findByText('No se pudo cargar el layout del almacén.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('con todos los ítems en el mismo piso solo ofrece sus pabellones', async () => {
    setup();
    const select = await screen.findByLabelText('Pabellón');
    expect(within(select).queryByRole('option', { name: 'A' })).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'F' })).toBeInTheDocument();
  });

  it('con pisos distintos o sin piso ofrece todos los pabellones', async () => {
    setup({ items: [ITEMS[0], makeItem({ id: 3, floor: 1 })] });
    const select = await screen.findByLabelText('Pabellón');
    expect(within(select).getByRole('option', { name: 'A' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'F' })).toBeInTheDocument();
  });

  it('el layout se pide una sola vez aunque se reabra', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>alternar</button>
          <AssignLocationModal open={open} items={ITEMS} onClose={() => {}} onDone={() => {}} />
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await screen.findByLabelText('Pabellón');
    await user.click(screen.getByRole('button', { name: 'alternar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'alternar' }));
    await screen.findByLabelText('Pabellón');
    expect(api.getLocationLayout).toHaveBeenCalledTimes(1);
  });
});

describe('AssignLocationModal — guardar', () => {
  it('no envía nada hasta elegir los tres selectores', async () => {
    const { user } = setup();
    await screen.findByLabelText('Pabellón');
    await user.click(assign());
    expect(await screen.findByText('Escriba el código o elija pabellón, sección y nivel.')).toBeInTheDocument();
    expect(api.assignLocations).not.toHaveBeenCalled();
  });

  it('envía la misma ubicación para cada ítem y avisa al terminar', async () => {
    const { user, onDone } = setup();
    await pick(user, 'F3-2');
    await user.click(assign());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.assignLocations).toHaveBeenCalledWith([
      { inventory: 1, location: 'F3-2' }, { inventory: 2, location: 'F3-2' },
    ]);
    expect(await screen.findByText('Ubicación F3-2 asignada a 2 ítems.')).toBeInTheDocument();
  });

  it('con un solo ítem el aviso va en singular', async () => {
    const { user } = setup({ items: [ITEMS[0]] });
    await pick(user, 'G1-5');
    await user.click(assign());
    expect(await screen.findByText('Ubicación G1-5 asignada.')).toBeInTheDocument();
  });

  it('no envía dos veces si se pulsa de nuevo mientras guarda', async () => {
    let release;
    api.assignLocations.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { user, onDone } = setup();
    await pick(user);
    await user.click(assign());
    await user.click(await screen.findByRole('button', { name: /guardando/i }));
    expect(api.assignLocations).toHaveBeenCalledTimes(1);
    release({ data: { updated: 2 } });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('mientras guarda no se puede cancelar', async () => {
    api.assignLocations.mockReturnValue(new Promise(() => {}));
    const { user } = setup();
    await pick(user);
    await user.click(assign());
    expect(await screen.findByRole('button', { name: /cancelar/i })).toBeDisabled();
  });

  it('todo o nada: con errores por ítem no cierra y los indica con su código', async () => {
    api.assignLocations.mockRejectedValue({
      response: { status: 400, data: { errors: [{ index: 1, field: 'location', error: 'La ubicación F9-9 no existe.' }] } },
    });
    const { user, onDone } = setup();
    await pick(user);
    await user.click(assign());
    expect(await screen.findByText(/no se aplicó ningún cambio/i)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /errores por ítem/i });
    expect(within(list).getByText('EPP000002')).toBeInTheDocument();
    expect(within(list).getByText(/no existe/i)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('un error por ítem con índice desconocido no rompe la lista', async () => {
    api.assignLocations.mockRejectedValue({
      response: { status: 400, data: { errors: [{ index: 9, field: 'inventory', error: 'El ítem no existe.' }] } },
    });
    const { user } = setup();
    await pick(user);
    await user.click(assign());
    expect(await screen.findByText(/Ítem 10/)).toBeInTheDocument();
  });

  it('muestra el detalle del servidor cuando no hay lista de errores', async () => {
    api.assignLocations.mockRejectedValue({ response: { status: 403, data: { detail: 'Solo Almacén Central puede asignar.' } } });
    const { user } = setup();
    await pick(user);
    await user.click(assign());
    expect(await screen.findByText('Solo Almacén Central puede asignar.')).toBeInTheDocument();
  });

  it('ante un fallo de red usa el mensaje de respaldo y permite reintentar', async () => {
    api.assignLocations.mockRejectedValueOnce(new Error('Network Error'));
    const { user, onDone } = setup();
    await pick(user);
    await user.click(assign());
    expect(await screen.findByText('No se pudo asignar la ubicación. Intente nuevamente.')).toBeInTheDocument();
    await user.click(assign());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.assignLocations).toHaveBeenCalledTimes(2);
  });

  it('elegir otra ubicación borra el aviso anterior', async () => {
    const { user } = setup();
    await screen.findByLabelText('Pabellón');
    await user.click(assign());
    expect(await screen.findByText('Escriba el código o elija pabellón, sección y nivel.')).toBeInTheDocument();
    await pick(user);
    expect(screen.queryByText('Escriba el código o elija pabellón, sección y nivel.')).not.toBeInTheDocument();
  });
});

// SYSPCC-025 · react-frontend ronda 1 — ubicar muchos ítems seguidos (go-live: 254 pendientes).
describe('AssignLocationModal — código escrito, Enter y «Asignar y siguiente»', () => {
  const code = () => screen.getByLabelText('Código de ubicación');

  it('el foco inicial cae en el campo del código, no en «Cerrar»', async () => {
    setup({ items: [ITEMS[0]] });
    await screen.findByLabelText('Pabellón');
    expect(code()).toHaveFocus();
  });

  it('se puede escribir el código y Enter lo asigna (el cuerpo es un formulario)', async () => {
    const { user, onDone } = setup({ items: [ITEMS[0]] });
    await screen.findByLabelText('Pabellón');
    await user.type(code(), 'f3-2{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.assignLocations).toHaveBeenCalledWith([{ inventory: 1, location: 'F3-2' }]);
  });

  it('el código escrito mueve los selectores y viceversa', async () => {
    const { user } = setup({ items: [ITEMS[0]] });
    await screen.findByLabelText('Pabellón');
    await user.type(code(), 'G4-3');
    await waitFor(() => expect(screen.getByLabelText('Pabellón')).toHaveValue('G'));
    expect(screen.getByLabelText('Sección')).toHaveValue('4');
    expect(screen.getByLabelText('Nivel')).toHaveValue('3');

    await user.selectOptions(screen.getByLabelText('Nivel'), '5');
    expect(code()).toHaveValue('G4-5');
  });

  it.each([
    ['Z9-9', /el pabellón z no existe/i],
    ['F9-1', /tiene secciones del 1 al 6/i],
    ['F3', /use el formato/i],
  ])('un código inválido («%s») se explica y no se envía', async (text, message) => {
    const { user } = setup({ items: [ITEMS[0]] });
    await screen.findByLabelText('Pabellón');
    await user.type(code(), `${text}{Enter}`);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(code()).toBeInvalid();
    expect(api.assignLocations).not.toHaveBeenCalled();
  });

  it('con ítems del 2do piso rechaza un pabellón del 1er piso', async () => {
    const { user } = setup({ items: [ITEMS[0]] });
    await screen.findByLabelText('Pabellón');
    await user.type(code(), 'B3-2');
    expect(await screen.findByText(/el pabellón b no existe en ese piso/i)).toBeInTheDocument();
  });

  describe('con una cola de pendientes', () => {
    const QUEUE = [
      ITEMS[0],
      makeItem({ id: 3, product_code: 'EPP000003', description: 'Lentes', floor: 2 }),
      makeItem({ id: 4, product_code: 'EPP000004', description: 'Tapones', floor: 2 }),
    ];

    it('«Asignar y siguiente» asigna, avisa y deja el diálogo abierto en el próximo ítem', async () => {
      const onAssigned = vi.fn();
      const { user, onDone } = setup({ items: [QUEUE[0]], queue: QUEUE, onAssigned });
      await screen.findByLabelText('Pabellón');
      expect(screen.getByText(/quedan 2 ítems pendientes/i)).toBeInTheDocument();

      await user.type(code(), 'F3-2');
      await user.click(screen.getByRole('button', { name: /asignar y siguiente/i }));

      await waitFor(() => expect(api.assignLocations).toHaveBeenCalledWith([{ inventory: 1, location: 'F3-2' }]));
      expect(await screen.findByText('Ubicación F3-2 asignada.')).toBeInTheDocument();
      expect(onAssigned).toHaveBeenCalledTimes(1);
      expect(onDone).not.toHaveBeenCalled();

      // Ahora el diálogo muestra el siguiente ítem, con el formulario vacío y el foco en el código.
      expect(await screen.findByText('Lentes')).toBeInTheDocument();
      expect(screen.queryByText('Casco')).not.toBeInTheDocument();
      expect(code()).toHaveValue('');
      expect(screen.getByText(/queda 1 ítem pendiente/i)).toBeInTheDocument();
      await waitFor(() => expect(code()).toHaveFocus());
    });

    it('en el último pendiente ya no ofrece «Asignar y siguiente»', async () => {
      setup({ items: [QUEUE[2]], queue: [QUEUE[2]] });
      await screen.findByLabelText('Pabellón');
      expect(screen.queryByRole('button', { name: /asignar y siguiente/i })).not.toBeInTheDocument();
    });

    it('con varios ítems seleccionados no ofrece «Asignar y siguiente»', async () => {
      setup({ items: ITEMS, queue: QUEUE });
      await screen.findByLabelText('Pabellón');
      expect(screen.queryByRole('button', { name: /asignar y siguiente/i })).not.toBeInTheDocument();
    });

    it('si el servidor rechaza, no avanza al siguiente', async () => {
      api.assignLocations.mockRejectedValueOnce(new Error('Network Error'));
      const { user } = setup({ items: [QUEUE[0]], queue: QUEUE });
      await screen.findByLabelText('Pabellón');
      await user.type(code(), 'F3-2');
      await user.click(screen.getByRole('button', { name: /asignar y siguiente/i }));
      expect(await screen.findByText('No se pudo asignar la ubicación. Intente nuevamente.')).toBeInTheDocument();
      expect(screen.getByText('Casco')).toBeInTheDocument();
    });
  });

  it('si el layout no carga ofrece «Reintentar»', async () => {
    api.getLocationLayout.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: LAYOUT });
    const { user } = setup({ items: [ITEMS[0]] });
    expect(await screen.findByText('No se pudo cargar el layout del almacén.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Pabellón')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar el layout del almacén.')).not.toBeInTheDocument();
  });
});
