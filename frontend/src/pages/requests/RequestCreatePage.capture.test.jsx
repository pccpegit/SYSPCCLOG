import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import LocationProbe from '../../test/LocationProbe';
import RequestCreatePage from './RequestCreatePage';
import { useAuth } from '../../context/useAuth';
import * as coreApi from '../../api/core';
import * as requestsApi from '../../api/requests';
import * as exportRQ from '../../utils/exportRQ';

// These pages render a long form / a list of cards and the tests type into them: on a busy machine
// (CI running jobs in parallel) the default 1000 ms of findBy*/waitFor can expire before the first
// render finishes. The limit only bounds how long a failing assertion keeps retrying.
configure({ asyncUtilTimeout: 4000 });

// SYSPCC-026 (QA ronda 1) — complements RequestCreatePage.test.jsx: rows added/removed, the
// way back from "fuera de catálogo", failures of the server and of the catalog, what is NOT sent,
// and the exit after a successful submit.
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/core');
vi.mock('../../api/requests');
vi.mock('../../utils/exportRQ');

const PROJECT = { id: 1, code: 'PRY-001', name: 'Proyecto Minera Yanaocha', frente: 'MINERA YANAOCHA' };
const CASCO = { id: 501, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND', category: 'EPP', available: '12.000' };
const CEMENTO = { id: 502, product_code: 'MAT-0100', description: 'Cemento Portland Tipo I', unit: 'BOLSA', category: 'Otros', available: '0.000' };

const opsUser = () => ({
  id: 1, first_name: 'Op', last_name: 'Erator', full_name: 'Op Erator',
  roles: [{
    role: 'REQUESTER', is_primary: true, project: PROJECT.id, project_code: PROJECT.code,
    project_name: PROJECT.name, project_frente: PROJECT.frente, department_obj: null,
    department_code: null, department_name: null, department_frente: null,
  }],
});

// The form's labels sit in <td> cells with no htmlFor (a pre-existing gap): locate by visible text.
function valueCellFor(labelText) {
  const [labelEl] = screen.getAllByText((content) => content.startsWith(labelText));
  return labelEl.closest('td').nextElementSibling;
}

async function fillHeader(user, { area = 'OP' } = {}) {
  await user.type(within(valueCellFor('N° Requerimiento:')).getByRole('textbox'), '020');
  await user.selectOptions(within(valueCellFor('Área (departamento):')).getByRole('combobox'), 'Producción');
  if (area) await user.selectOptions(screen.getByLabelText(/Área del RQ/), area);
  fireEvent.change(within(valueCellFor('Fecha entrega:')).getByDisplayValue(''), { target: { value: '2026-12-31' } });
}

async function fillOffCatalog(user, n, description, source = 'UTILES', quantity = '1') {
  await user.click(screen.getByLabelText(`Ítem ${n}: Fuera de catálogo`));
  await user.type(screen.getByLabelText(`Descripción del ítem ${n} fuera de catálogo`), description);
  await user.selectOptions(screen.getByLabelText(`Fuente del ítem ${n}`), source);
  if (quantity) await user.type(screen.getByLabelText(`Cantidad del ítem ${n}`), quantity);
}

async function pickProduct(user, n, text, product) {
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [product] } });
  await user.type(screen.getByRole('combobox', { name: new RegExp(`catálogo para el ítem ${n}$`) }), text);
  await user.click(await screen.findByRole('option', { name: new RegExp(product.product_code) }));
}

const submitButton = () => screen.getByRole('button', { name: /enviar requerimiento/i });
const lastPayload = () => requestsApi.createRequest.mock.calls.at(-1)[0];

function renderPage() {
  return renderWithProviders(<><RequestCreatePage /><LocationProbe /></>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ currentUser: opsUser() });
  coreApi.getProjects.mockResolvedValue({ data: { results: [PROJECT] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [] } });
  exportRQ.exportRQToExcel.mockResolvedValue(undefined);
  requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0200' } });
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 0, results: [] } });
});

describe('RequestCreatePage — filas', () => {
  it('"Agregar ítem" suma una fila con su propio buscador, y sólo viajan las líneas resueltas, numeradas en orden', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    expect(screen.getByText(/5 filas/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /agregar ítem/i }));

    expect(screen.getByText(/6 filas/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /catálogo para el ítem 6$/ })).toBeInTheDocument();

    await fillOffCatalog(user, 2, 'Servicio de flete', 'EQUIPOS');       // line 1 of the payload
    await pickProduct(user, 6, 'casco', CASCO);                           // line 2 of the payload
    await user.type(screen.getByLabelText('Cantidad del ítem 6'), '4');
    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');

    const { items } = lastPayload();
    expect(items.map((i) => [i.line_number, i.description])).toEqual([
      [1, 'Servicio de flete'],
      [2, 'Casco de seguridad blanco'],
    ]);
    expect(items[1]).toMatchObject({ inventory_item: 501, quantity: 4, item_source: 'EPP' });
  });

  it('"Eliminar" quita la fila y renumera; la última fila que queda no se puede eliminar', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');

    await user.click(screen.getByRole('button', { name: 'Eliminar el ítem 5' }));
    expect(screen.getByText(/4 filas/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Cantidad del ítem 5')).not.toBeInTheDocument();

    for (let n = 4; n >= 2; n -= 1) await user.click(screen.getByRole('button', { name: `Eliminar el ítem ${n}` }));

    expect(screen.getByText(/1 fila(?!s)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar el ítem 1' })).toBeDisabled();
  });

  it('quitar una fila con producto elegido no arrastra su producto a la siguiente', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await pickProduct(user, 1, 'casco', CASCO);

    await user.click(screen.getByRole('button', { name: 'Eliminar el ítem 1' }));

    expect(screen.queryByText('EPP-0001')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /catálogo para el ítem 1$/ })).toBeInTheDocument();
  });
});

describe('RequestCreatePage — de "fuera de catálogo" al catálogo y viceversa', () => {
  it('desmarcar "fuera de catálogo" borra la descripción tipeada y devuelve el buscador con el foco', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');

    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
    await user.type(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo'), 'Servicio');
    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));

    expect(screen.queryByLabelText('Descripción del ítem 1 fuera de catálogo')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /catálogo para el ítem 1$/ })).toHaveFocus();
    expect(screen.getByLabelText('Ítem 1: Fuera de catálogo')).not.toBeChecked();
  });

  it('para pasar una fila con producto a "fuera de catálogo" hay que soltar el producto: no viajan las dos cosas', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await pickProduct(user, 1, 'casco', CASCO);
    await user.type(screen.getByLabelText('Cantidad del ítem 1'), '2');
    expect(screen.queryByLabelText('Ítem 1: Fuera de catálogo')).not.toBeInTheDocument();   // linked: no checkbox

    await user.click(screen.getByRole('button', { name: /^Cambiar el producto del ítem 1 \(/ }));
    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
    await user.type(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo'), 'Casco especial');
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'EPP');
    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');

    const [item] = lastPayload().items;
    expect(item).toMatchObject({ description: 'Casco especial', is_off_catalog: true, quantity: 2 });
    expect(item).not.toHaveProperty('inventory_item');
  });

  it('un producto con disponible 0 se puede pedir igual: el disponible es sólo informativo', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);

    await pickProduct(user, 1, 'cemento', CEMENTO);

    expect(screen.getByText(/Disponible en almacén central: 0 BOLSA \(informativo\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Fuente del ítem 1')).toHaveValue('');     // "Otros" proposes no family
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'MATERIALES');
    await user.type(screen.getByLabelText('Cantidad del ítem 1'), '100');
    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');

    expect(lastPayload().items[0]).toMatchObject({ inventory_item: 502, unit: 'BOLSA', quantity: 100 });
  });

  it('la unidad de un producto vinculado la fija el catálogo: no hay lista para cambiarla', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');

    await pickProduct(user, 1, 'cemento', CEMENTO);

    expect(screen.queryByLabelText('Unidad del ítem 1')).not.toBeInTheDocument();
    expect(screen.getAllByText('BOLSA').length).toBeGreaterThan(0);
  });
});

describe('RequestCreatePage — bloqueos de la propia pantalla', () => {
  it('texto escrito en el buscador sin elegir producto bloquea el envío y marca el campo', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4');
    await user.type(screen.getByRole('combobox', { name: /catálogo para el ítem 2$/ }), 'caj');

    await user.click(submitButton());

    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    const summary = screen.getByRole('group', { name: /corrija \d+ error(es)? antes de enviar/i });
    expect(within(summary).getByText(/Ítem 2: Seleccione un producto del catálogo/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /catálogo para el ítem 2$/ })).toHaveAttribute('aria-invalid', 'true');
  });

  it('"fuera de catálogo" sin descripción pide describirlo (no basta marcarlo)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'UTILES');

    await user.click(submitButton());

    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    expect(screen.getAllByText('Describa el ítem fuera de catálogo.').length).toBeGreaterThan(0);
  });

  it('el selector de Área ofrece sólo OP, QC, HSE y ADM, además de la opción vacía', async () => {
    renderPage();
    await screen.findByText('MINERA YANAOCHA');

    const select = screen.getByLabelText(/Área del RQ/);
    const options = within(select).getAllByRole('option').map((o) => o.value);

    expect(options).toEqual(['', 'OP', 'QC', 'HSE', 'ADM']);
    expect(select).toHaveValue('');
  });

  it('las 9 fuentes del backend están en la lista de cada ítem', async () => {
    renderPage();
    await screen.findByText('MINERA YANAOCHA');

    const options = within(screen.getByLabelText('Fuente del ítem 1')).getAllByRole('option').map((o) => o.value);

    expect(options).toEqual(['', 'EPP', 'HERRAMIENTAS', 'MATERIALES', 'EQUIPOS', 'FORMATERIA', 'CONSUMIBLES', 'UNIDADES', 'UTILES', 'GASES']);
  });
});

describe('RequestCreatePage — fallos del servidor y del catálogo', () => {
  it('si el servidor falla, avisa, libera el envío y un segundo intento sí crea el RQ', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest
      .mockRejectedValueOnce({ response: { status: 500, data: {} } })
      .mockResolvedValueOnce({ data: { rq_number: 'RQ-2026-0201' } });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4');

    await user.click(submitButton());

    expect(await screen.findByText('Error al guardar el requerimiento.')).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    expect(screen.getByTestId('loc')).toHaveTextContent('/');            // did not leave the form

    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledTimes(2);
  });

  it('un 400 sobre una línea nombra la línea y el campo, y deja corregir y reenviar', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { error: true, status_code: 400, detail: { items: [{}, { item_source: ['"X" no es una opción válida.'] }] } },
      },
    });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4');

    await user.click(submitButton());

    // A 400 is something to fix: it goes in the error summary (not only in a toast that
    // disappears) and the focus moves there, where the user can read it.
    const summary = await screen.findByRole('group', { name: 'Corrija 1 error antes de enviar' });
    expect(within(summary).getByText('Ítem 2 (Fuente): "X" no es una opción válida.')).toBeInTheDocument();
    expect(summary).toHaveFocus();
    expect(submitButton()).toBeEnabled();

    // Sending again clears the old server message.
    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(screen.queryByRole('group', { name: /corrija/i })).not.toBeInTheDocument();
  });

  it('un 400 nombra el ítem por su fila del formulario, aunque las filas vacías no viajen', async () => {
    const user = userEvent.setup();
    // Only row 3 is filled: it is position 0 of the payload, but the user sees it as "Ítem 3".
    requestsApi.createRequest.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { error: true, status_code: 400, detail: { items: [{ rfi_fwo: ['Asegúrese de que este campo no tenga más de 50 caracteres.'] }] } },
      },
    });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 3, 'Papel bond A4');

    await user.click(submitButton());

    const summary = await screen.findByRole('group', { name: 'Corrija 1 error antes de enviar' });
    expect(within(summary).getByText('Ítem 3 (RFI/FWO): Asegúrese de que este campo no tenga más de 50 caracteres.')).toBeInTheDocument();
    expect(summary).not.toHaveTextContent(/rfi_fwo|Línea/);
  });

  it('un 429 al crear no se muestra como un error de validación', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest.mockRejectedValueOnce({
      response: { status: 429, data: { detail: 'Demasiadas solicitudes. Intente más tarde.' } },
    });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4');

    await user.click(submitButton());

    expect(await screen.findByText('Demasiadas solicitudes. Intente más tarde.')).toBeInTheDocument();
    expect(screen.queryByText(/Área del RQ: Demasiadas/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Área del RQ/)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('con el buscador de catálogo caído se puede enviar el RQ con ítems fuera de catálogo', async () => {
    const user = userEvent.setup();
    requestsApi.searchRequestCatalog.mockRejectedValue({ response: { status: 429 } });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);

    await user.type(screen.getByRole('combobox', { name: /catálogo para el ítem 1$/ }), 'casco');
    expect((await screen.findAllByText(/Demasiadas búsquedas seguidas/)).length).toBeGreaterThan(0);
    await user.clear(screen.getByRole('combobox', { name: /catálogo para el ítem 1$/ }));
    await fillOffCatalog(user, 1, 'Papel bond A4');
    await user.click(submitButton());

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(lastPayload().items[0]).toMatchObject({ is_off_catalog: true });
  });

  it('si la descarga del Excel falla, el RQ ya creado no se da por perdido', async () => {
    const user = userEvent.setup();
    exportRQ.exportRQToExcel.mockRejectedValue(new Error('excel'));
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4');

    await user.click(submitButton());

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledTimes(1);
  });

  it('tras enviar con éxito vuelve a la lista de requerimientos', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4');

    await user.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/rq/requests'), { timeout: 2000 });
  });
});

describe('RequestCreatePage — lo que NO se envía', () => {
  it('nunca envía supply_source ni la clave heredada stock_almacen_principal, en ninguna línea', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4');
    await pickProduct(user, 2, 'casco', CASCO);
    await user.type(screen.getByLabelText('Cantidad del ítem 2'), '3');

    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');

    const payload = lastPayload();
    expect(JSON.stringify(payload)).not.toMatch(/supply_source|stock_almacen_principal/);
    for (const item of payload.items) {
      expect(item.inventory_item !== undefined).not.toBe(item.is_off_catalog === true);   // exactly one of the two
    }
  });

  it('el RFI/FWO no deja escribir más de 50 caracteres (el servidor no los aceptaría)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');

    const rfi = screen.getByLabelText('RFI o FWO del ítem 1');
    expect(rfi).toHaveAttribute('maxlength', '50');
    await user.type(rfi, 'R'.repeat(60));
    expect(rfi).toHaveValue('R'.repeat(50));
  });

  it('las filas vacías del formulario no generan líneas', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 3, 'Papel bond A4');

    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');

    expect(lastPayload().items).toHaveLength(1);
    expect(lastPayload().items[0].line_number).toBe(1);
  });
});

describe('RequestCreatePage — la cantidad es obligatoria', () => {
  // A resolved line left without quantity used to be created with 0 units (parseFloat('') || 0) and
  // stayed "pending" forever in the follow-up. The catalog autofills description and unit, which
  // made forgetting the quantity easier than before.
  it('una línea resuelta sin cantidad no se envía: marca el campo y lo explica', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4', 'UTILES', '');            // quantity left blank on purpose

    await user.click(submitButton());

    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    const quantity = screen.getByLabelText('Cantidad del ítem 1');
    expect(quantity).toHaveAttribute('aria-required', 'true');
    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    expect(quantity).toHaveAccessibleDescription('Ingrese la cantidad (mayor que 0).');
    const summary = screen.getByRole('group', { name: 'Corrija 1 error antes de enviar' });
    expect(within(summary).getByText('Ítem 1: Ingrese la cantidad (mayor que 0).')).toBeInTheDocument();
  });

  it('con cantidad 0 tampoco, y al corregirla el mensaje desaparece y el RQ se envía', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalog(user, 1, 'Papel bond A4', 'UTILES', '0');

    await user.click(submitButton());
    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Ingrese la cantidad \(mayor que 0\)\./).length).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText('Cantidad del ítem 1'));
    await user.type(screen.getByLabelText('Cantidad del ítem 1'), '2');
    expect(screen.queryByText(/Ingrese la cantidad/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Cantidad del ítem 1')).not.toHaveAttribute('aria-invalid');

    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(lastPayload().items[0].quantity).toBe(2);
  });

  it('la columna Cantidad lleva el asterisco de obligatoria', async () => {
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    const header = screen.getByRole('columnheader', { name: /cantidad/i });
    expect(header).toHaveTextContent('*');
  });
});
