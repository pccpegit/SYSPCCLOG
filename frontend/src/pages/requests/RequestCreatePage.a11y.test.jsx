import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequestCreatePage from './RequestCreatePage';
import { useAuth } from '../../context/AuthContext';
import * as coreApi from '../../api/core';
import * as requestsApi from '../../api/requests';
import * as exportRQ from '../../utils/exportRQ';

// SYSPCC-026 (ronda 1, accesibilidad) — "Nuevo Requerimiento" para teclado y lector de pantalla:
// campos con etiqueta real, errores enlazados al campo, resumen de errores que lleva el foco al
// control, anuncios cuando el control que tenía el foco se desmonta, ayuda de "Fuera de catálogo"
// y los dos "Área" que ya no se confunden.
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/core');
vi.mock('../../api/requests');
vi.mock('../../utils/exportRQ');

const PROJECT = { id: 1, code: 'PRY-001', name: 'Proyecto Minera Yanaocha', frente: 'MINERA YANAOCHA' };
const CASCO = { id: 501, product_code: 'EPP-0001', description: 'Casco de seguridad blanco', unit: 'UND', category: 'EPP', available: '12.000' };

const role = (over = {}) => ({
  role: 'REQUESTER', is_primary: true, project: null, project_code: null, project_name: null,
  project_frente: null, department_obj: null, department_code: null, department_name: null,
  department_frente: null, ...over,
});
const opsUser = () => ({
  id: 1, first_name: 'Op', last_name: 'Erator', full_name: 'Op Erator',
  roles: [role({ project: PROJECT.id, project_code: PROJECT.code, project_name: PROJECT.name, project_frente: PROJECT.frente })],
});
const globalUser = () => ({ id: 2, first_name: 'Glo', last_name: 'Bal', full_name: 'Glo Bal', roles: [role()] });

const submitButton = () => screen.getByRole('button', { name: /enviar requerimiento/i });

async function pickProduct(user, n, text, product) {
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [product] } });
  await user.type(screen.getByRole('combobox', { name: new RegExp(`catálogo para el ítem ${n}$`) }), text);
  await user.click(await screen.findByRole('option', { name: new RegExp(product.product_code) }));
}

async function renderOps() {
  useAuth.mockReturnValue({ currentUser: opsUser() });
  renderWithProviders(<RequestCreatePage />);
  await screen.findByText('MINERA YANAOCHA');
}

beforeEach(() => {
  vi.clearAllMocks();
  coreApi.getProjects.mockResolvedValue({ data: { results: [PROJECT] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [] } });
  exportRQ.exportRQToExcel.mockResolvedValue(undefined);
  requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0300' } });
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 0, results: [] } });
});

describe('RequestCreatePage — cada campo del encabezado tiene nombre', () => {
  it('los campos editables tienen una etiqueta asociada (label for)', async () => {
    await renderOps();

    expect(screen.getByRole('textbox', { name: 'N° Requerimiento:' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Uso específico:' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Fecha de requerimiento:/)).toHaveAttribute('type', 'date');
    expect(screen.getByRole('combobox', { name: 'Área (departamento):' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Fecha entrega:/)).toHaveAttribute('type', 'date');
    expect(screen.getByRole('combobox', { name: 'Área del RQ (OP / QC / HSE / ADM):' })).toBeInTheDocument();
  });

  it('Frente y Servicio también (cuando son listas, para quien no tiene proyecto fijo)', async () => {
    useAuth.mockReturnValue({ currentUser: globalUser() });
    renderWithProviders(<RequestCreatePage />);
    await screen.findByRole('option', { name: 'MINERA YANAOCHA' });

    const frente = screen.getByRole('combobox', { name: 'Frente:' });
    await userEvent.setup().selectOptions(frente, 'MINERA YANAOCHA');
    expect(screen.getByRole('combobox', { name: 'Servicio:' })).toBeInTheDocument();
  });

  it('los valores fijos (proyecto asignado) no inventan una etiqueta hacia un control que no existe', async () => {
    await renderOps();
    expect(document.querySelector('label[for="frente"]')).toBeNull();
    expect(document.querySelector('label[for="servicio"]')).toBeNull();
  });
});

describe('RequestCreatePage — los dos "Área" ya no se confunden', () => {
  it('el heredado dice que es el departamento y el nuevo lista sus cuatro valores', async () => {
    await renderOps();
    expect(screen.getByText('Área (departamento):')).toBeInTheDocument();
    expect(screen.getByText('Área del RQ (OP / QC / HSE / ADM):')).toBeInTheDocument();
    expect(screen.queryByText('Área:')).not.toBeInTheDocument();
  });

  it('la aclaración está pegada al select y se lee junto con él, también cuando hay error', async () => {
    const user = userEvent.setup();
    await renderOps();
    const select = screen.getByLabelText(/Área del RQ/);

    expect(select).toHaveAccessibleDescription(/No es el departamento/);

    await user.click(submitButton());

    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription(/No es el departamento.*Seleccione el área del RQ/s);
    // The help sits in the select's own cell, not in another column.
    expect(select.closest('td')).toContainElement(document.getElementById('requestingArea-help'));
  });
});

describe('RequestCreatePage — errores enlazados a su campo', () => {
  it('cada campo con error queda aria-invalid y apunta a su mensaje', async () => {
    const user = userEvent.setup();
    await renderOps();

    await user.click(submitButton());

    const cases = [
      [screen.getByRole('textbox', { name: 'N° Requerimiento:' }), 'Ingrese el N° de Requerimiento.'],
      [screen.getByRole('combobox', { name: 'Área (departamento):' }), 'Seleccione el área.'],
      [screen.getByLabelText(/^Fecha entrega:/), 'Ingrese la fecha de entrega.'],
    ];
    for (const [control, message] of cases) {
      expect(control).toHaveAttribute('aria-required', 'true');
      expect(control).toHaveAttribute('aria-invalid', 'true');
      expect(control).toHaveAccessibleDescription(message);
    }
  });

  it('al corregirlo el campo deja de marcarse como inválido', async () => {
    const user = userEvent.setup();
    await renderOps();
    await user.click(submitButton());
    const rq = screen.getByRole('textbox', { name: 'N° Requerimiento:' });
    expect(rq).toHaveAttribute('aria-invalid', 'true');

    await user.type(rq, '021');

    expect(rq).not.toHaveAttribute('aria-invalid');
    expect(rq).not.toHaveAttribute('aria-describedby');
  });
});

describe('RequestCreatePage — resumen de errores', () => {
  it('el título cuenta los errores y la lista es parte de su descripción', async () => {
    const user = userEvent.setup();
    await renderOps();

    await user.click(submitButton());

    const summary = screen.getByRole('group', { name: /^Corrija \d+ errores antes de enviar$/ });
    expect(summary).toHaveFocus();
    const count = Number(/\d+/.exec(within(summary).getByText(/^Corrija \d+ errores/).textContent)[0]);
    expect(within(summary).getAllByRole('button')).toHaveLength(count);
    expect(summary).toHaveAccessibleDescription(/Ingrese el N° de Requerimiento\./);
  });

  it('en singular cuando hay uno solo', async () => {
    const user = userEvent.setup();
    await renderOps();
    // Everything valid except the quantity of the only line.
    await user.type(screen.getByRole('textbox', { name: 'N° Requerimiento:' }), '021');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Área (departamento):' }), 'Producción');
    await user.selectOptions(screen.getByLabelText(/Área del RQ/), 'OP');
    fireEvent.change(screen.getByLabelText(/^Fecha entrega:/), { target: { value: '2026-12-31' } });
    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
    await user.type(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo'), 'Flete');
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'EQUIPOS');

    await user.click(submitButton());

    expect(screen.getByRole('group', { name: 'Corrija 1 error antes de enviar' })).toBeInTheDocument();
  });

  it('cada mensaje es un botón que lleva el foco al control que lo corrige', async () => {
    const user = userEvent.setup();
    await renderOps();
    await user.type(screen.getByLabelText('Cantidad del ítem 2'), '3');           // line 2 touched, unresolved
    await user.click(submitButton());
    const summary = screen.getByRole('group', { name: /^Corrija \d+ errores antes de enviar$/ });

    await user.click(within(summary).getByRole('button', { name: 'Ingrese el N° de Requerimiento.' }));
    expect(screen.getByRole('textbox', { name: 'N° Requerimiento:' })).toHaveFocus();

    await user.click(within(summary).getByRole('button', { name: 'Seleccione el área del RQ (OP, QC, HSE o ADM).' }));
    expect(screen.getByLabelText(/Área del RQ/)).toHaveFocus();

    await user.click(within(summary).getByRole('button', { name: 'Ingrese la fecha de entrega.' }));
    expect(screen.getByLabelText(/^Fecha entrega:/)).toHaveFocus();

    await user.click(within(summary).getByRole('button', { name: /^Ítem 2: Seleccione un producto del catálogo/ }));
    expect(screen.getByRole('combobox', { name: /catálogo para el ítem 2$/ })).toHaveFocus();

    await user.click(within(summary).getByRole('button', { name: 'Ítem 2: Seleccione la fuente del ítem.' }));
    expect(screen.getByLabelText('Fuente del ítem 2')).toHaveFocus();
  });

  it('el mensaje de cantidad lleva al campo Cantidad de esa línea, y el de "ningún ítem" al primer buscador', async () => {
    const user = userEvent.setup();
    await renderOps();
    await user.click(submitButton());
    await user.click(within(screen.getByRole('group', { name: /^Corrija/ })).getByRole('button', { name: /^Agregue al menos un ítem/ }));
    expect(screen.getByRole('combobox', { name: /catálogo para el ítem 1$/ })).toHaveFocus();

    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
    await user.type(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo'), 'Flete');
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'EQUIPOS');
    await user.click(submitButton());
    await user.click(within(screen.getByRole('group', { name: /^Corrija/ })).getByRole('button', { name: 'Ítem 1: Ingrese la cantidad (mayor que 0).' }));
    expect(screen.getByLabelText('Cantidad del ítem 1')).toHaveFocus();
  });

  it('un 400 del servidor mueve el foco al resumen (no depende del toast)', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest.mockRejectedValueOnce({
      response: { status: 400, data: { error: true, status_code: 400, detail: { items: [{ quantity: ['Valor no válido.'] }] } } },
    });
    await renderOps();
    await user.type(screen.getByRole('textbox', { name: 'N° Requerimiento:' }), '021');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Área (departamento):' }), 'Producción');
    await user.selectOptions(screen.getByLabelText(/Área del RQ/), 'OP');
    fireEvent.change(screen.getByLabelText(/^Fecha entrega:/), { target: { value: '2026-12-31' } });
    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
    await user.type(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo'), 'Flete');
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'EQUIPOS');
    await user.type(screen.getByLabelText('Cantidad del ítem 1'), '2');
    submitButton().focus();

    await user.click(submitButton());

    const summary = await screen.findByRole('group', { name: 'Corrija 1 error antes de enviar' });
    expect(summary).toHaveFocus();
    expect(within(summary).getByText('Ítem 1 (Cantidad): Valor no válido.')).toBeInTheDocument();
  });

  it('un 500 no es algo que el usuario deba corregir: sólo el aviso, sin resumen', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    await renderOps();
    await user.type(screen.getByRole('textbox', { name: 'N° Requerimiento:' }), '021');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Área (departamento):' }), 'Producción');
    await user.selectOptions(screen.getByLabelText(/Área del RQ/), 'OP');
    fireEvent.change(screen.getByLabelText(/^Fecha entrega:/), { target: { value: '2026-12-31' } });
    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
    await user.type(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo'), 'Flete');
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'EQUIPOS');
    await user.type(screen.getByLabelText('Cantidad del ítem 1'), '2');

    await user.click(submitButton());

    await screen.findByText('Error al guardar el requerimiento.');
    expect(screen.queryByRole('group', { name: /corrija/i })).not.toBeInTheDocument();
  });
});

describe('RequestCreatePage — "Fuera de catálogo": ayuda visible y nombre accesible', () => {
  it('la explicación está a la vista y cada casilla la usa como descripción', async () => {
    await renderOps();
    const help = screen.getByText(/Marque "Fuera de catálogo" solo para servicios u otros ítems que no pasan por el almacén/);
    expect(help).toBeVisible();

    const box = screen.getByLabelText('Ítem 1: Fuera de catálogo');
    expect(box).toHaveAccessibleDescription(help.textContent);
    // The name contains the visible text (WCAG 2.5.3) and no longer hides it with aria-hidden.
    screen.getAllByText('Fuera de catálogo', { selector: 'span' }).forEach((el) => {
      expect(el).not.toHaveAttribute('aria-hidden');
    });
    expect(screen.getAllByRole('checkbox', { name: /^Ítem \d: Fuera de catálogo$/ })).toHaveLength(5);
  });

  it('marcarla lleva el foco a la descripción y lo anuncia', async () => {
    const user = userEvent.setup();
    await renderOps();

    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));

    expect(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo')).toHaveFocus();
    expect(screen.getByText('Ítem 1: fuera de catálogo. Describa el ítem.')).toBeInTheDocument();
  });

  it('desmarcarla devuelve el foco al buscador y lo anuncia', async () => {
    const user = userEvent.setup();
    await renderOps();
    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));

    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));

    expect(screen.getByRole('combobox', { name: /catálogo para el ítem 1$/ })).toHaveFocus();
    expect(screen.getByText('Ítem 1: vuelve al catálogo. Busque el producto.')).toBeInTheDocument();
  });

  it('el foco pedido para una línea no se queda pegado a otra', async () => {
    const user = userEvent.setup();
    await renderOps();
    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
    await user.click(screen.getByLabelText('Ítem 3: Fuera de catálogo'));

    expect(screen.getByLabelText('Descripción del ítem 3 fuera de catálogo')).toHaveFocus();
    expect(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo')).not.toHaveFocus();
  });
});

describe('RequestCreatePage — lo que se oye al elegir o cambiar el producto', () => {
  it('elegir un producto anuncia cuál quedó y la fuente propuesta; el botón nombra el código', async () => {
    const user = userEvent.setup();
    await renderOps();

    await pickProduct(user, 1, 'casco', CASCO);

    expect(screen.getByText('Ítem 1: EPP-0001 – Casco de seguridad blanco elegido. Fuente propuesta: EPP.')).toBeInTheDocument();
    const change = screen.getByRole('button', { name: 'Cambiar el producto del ítem 1 (EPP-0001)' });
    expect(change).toHaveFocus();
  });

  it('si la fuente ya la eligió una persona no dice que la propuso', async () => {
    const user = userEvent.setup();
    await renderOps();
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'CONSUMIBLES');

    await pickProduct(user, 1, 'casco', CASCO);

    const note = screen.getByText('Ítem 1: EPP-0001 – Casco de seguridad blanco elegido.');
    expect(note).toBeInTheDocument();
    expect(note).not.toHaveTextContent('Fuente propuesta');
  });

  it('"Cambiar" anuncia que el producto se quitó', async () => {
    const user = userEvent.setup();
    await renderOps();
    await pickProduct(user, 1, 'casco', CASCO);

    await user.click(screen.getByRole('button', { name: /^Cambiar el producto del ítem 1/ }));

    expect(screen.getByText('Ítem 1: producto quitado. Busque otro producto del catálogo.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /catálogo para el ítem 1$/ })).toHaveFocus();
  });

  it('el número de ítem del anuncio sigue a la fila aunque se hayan quitado otras', async () => {
    const user = userEvent.setup();
    await renderOps();
    await user.click(screen.getByRole('button', { name: 'Eliminar el ítem 1' }));            // old item 2 is now item 1

    await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));

    expect(screen.getByText('Ítem 1: fuera de catálogo. Describa el ítem.')).toBeInTheDocument();
  });

  it('la región viva está siempre montada, aunque todavía no diga nada', async () => {
    await renderOps();
    const live = screen.getAllByRole('status').filter((el) => el.classList.contains('sr-only') && el.textContent === '');
    expect(live.length).toBeGreaterThan(0);
  });
});
