import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequestCreatePage from './RequestCreatePage';
import { useAuth } from '../../context/useAuth';
import * as coreApi from '../../api/core';
import * as requestsApi from '../../api/requests';
import * as exportRQ from '../../utils/exportRQ';

// SYSPCC-019: RequestCreatePage — "Nuevo Requerimiento".
// AuthContext is mocked (see renderWithProviders.jsx doc comment) so each
// test controls currentUser.roles directly. exportRQ (ExcelJS + file-saver)
// is mocked because it isn't relevant to routing/flow behaviour and would
// otherwise try to fetch a real .xlsx template under jsdom.
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/core');
vi.mock('../../api/requests');
vi.mock('../../utils/exportRQ');

// ── Mocked catalog data ───────────────────────────────────────────────────
const PROJECT_MINERA = {
  id: 1,
  code: 'PRY-001',
  name: 'Proyecto Minera Yanaocha',
  frente: 'MINERA YANAOCHA',
};

// code='ADM' mirrors the real seed_demo department used by the frontend's
// legacy 'dept-oficina' fallback (RequestCreatePage.jsx handleSubmit).
const DEPT_ADM = { id: 10, code: 'ADM', name: 'Administración', frente: 'OFICINA CENTRAL' };
const DEPT_RRHH = { id: 11, code: 'RRHH', name: 'Recursos Humanos', frente: 'OFICINA CENTRAL' };

function mockCatalogs() {
  coreApi.getProjects.mockResolvedValue({ data: { results: [PROJECT_MINERA] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [DEPT_ADM, DEPT_RRHH] } });
}

function opsUser() {
  return {
    id: 1,
    first_name: 'Op',
    last_name: 'Erator',
    full_name: 'Op Erator',
    roles: [
      {
        role: 'REQUESTER',
        is_primary: true,
        project: PROJECT_MINERA.id,
        project_code: PROJECT_MINERA.code,
        project_name: PROJECT_MINERA.name,
        project_frente: PROJECT_MINERA.frente,
        department_obj: null,
        department_code: null,
        department_name: null,
        department_frente: null,
      },
    ],
  };
}

function departmentUser() {
  return {
    id: 2,
    first_name: 'Dep',
    last_name: 'User',
    full_name: 'Dep User',
    roles: [
      {
        role: 'REQUESTER',
        is_primary: true,
        project: null,
        project_code: null,
        project_name: null,
        project_frente: null,
        department_obj: DEPT_RRHH.id,
        department_code: DEPT_RRHH.code,
        department_name: DEPT_RRHH.name,
        department_frente: DEPT_RRHH.frente,
      },
    ],
  };
}

function globalAccessUser() {
  return {
    id: 3,
    first_name: 'Global',
    last_name: 'User',
    full_name: 'Global User',
    roles: [
      {
        role: 'GENERAL_MANAGER',
        is_primary: true,
        project: null,
        project_code: null,
        project_name: null,
        project_frente: null,
        department_obj: null,
        department_code: null,
        department_name: null,
        department_frente: null,
      },
    ],
  };
}

// The form's labels live in <td> cells with no htmlFor/id association (a
// pre-existing a11y gap, out of scope for SYSPCC-019 — see accessibilidad
// skill backlog). We locate controls by their visible label text, then walk
// to the adjacent value cell — this is a text-anchored query, not a CSS
// selector, and mirrors the only reliable way to target these fields.
function valueCellFor(labelText) {
  const [labelEl] = screen.getAllByText((content) => content.startsWith(labelText));
  return labelEl.closest('td').nextElementSibling;
}

// SYSPCC-026: every line is a catalog product or an explicit "fuera de catálogo",
// and carries a "Fuente". The helper fills the first line as off-catalog.
async function fillOffCatalogItem(user, n = 1, description = 'Papel bond A4', source = 'UTILES', quantity = '1') {
  await user.click(screen.getByLabelText(`Ítem ${n}: Fuera de catálogo`));
  await user.type(screen.getByLabelText(`Descripción del ítem ${n} fuera de catálogo`), description);
  await user.selectOptions(screen.getByLabelText(`Fuente del ítem ${n}`), source);
  if (quantity) await user.type(screen.getByLabelText(`Cantidad del ítem ${n}`), quantity);
}

async function fillCommonRequiredFields(user) {
  const rqInput = within(valueCellFor('N° Requerimiento:')).getByRole('textbox');
  await user.type(rqInput, '001');

  const areaSelect = within(valueCellFor('Área (departamento):')).getByRole('combobox');
  await user.selectOptions(areaSelect, 'Producción');

  await user.selectOptions(screen.getByLabelText(/Área del RQ/), 'OP');

  // Native date inputs aren't reliably typeable via user-event under jsdom
  // (no real date-picker widget) — fireEvent.change is the documented
  // workaround for this one field; every other interaction below uses
  // user-event.
  const fechaEntregaInput = within(valueCellFor('Fecha entrega:')).getByDisplayValue('');
  fireEvent.change(fechaEntregaInput, { target: { value: '2026-12-31' } });

  await fillOffCatalogItem(user);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCatalogs();
  exportRQ.exportRQToExcel.mockResolvedValue(undefined);
});

describe('RequestCreatePage — SYSPCC-019 frente Oficina Central', () => {
  it('usuario OPS con proyecto asignado: sin cambios, envía flow OPERATIONS con su proyecto', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: opsUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0001' } });

    renderWithProviders(<RequestCreatePage />);

    // Both the Servicio and Proyecto cells render the same
    // "code — name" text for a locked OPS user — scope to each cell
    // individually instead of a page-wide findByText (which matches twice).
    await screen.findByText('MINERA YANAOCHA');
    expect(
      within(valueCellFor('Servicio:')).getByText('PRY-001 — Proyecto Minera Yanaocha'),
    ).toBeInTheDocument();
    expect(
      within(valueCellFor('Proyecto:')).getByText('PRY-001 — Proyecto Minera Yanaocha'),
    ).toBeInTheDocument();
    expect(within(valueCellFor('Frente:')).getByText('MINERA YANAOCHA')).toBeInTheDocument();

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'OPERATIONS',
        project: PROJECT_MINERA.id,
        department: null,
        front_area: 'MINERA YANAOCHA',
        service: 'PRY-001 — Proyecto Minera Yanaocha',
      }),
    );
  });

  it('usuario con departamento propio (frente Oficina Central): Servicio/Proyecto fijos al montar, payload lleva su propio department', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: departmentUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0002' } });

    renderWithProviders(<RequestCreatePage />);

    // No interaction with frente/servicio needed — fetchData auto-fills
    // them from the user's own department as soon as the catalogs load.
    const servicioCell = await screen.findByText('Servicio:').then(() => valueCellFor('Servicio:'));
    expect(within(servicioCell).getByText('Oficina Central')).toBeInTheDocument();
    expect(within(servicioCell).queryByText('—')).not.toBeInTheDocument();

    const proyectoCell = valueCellFor('Proyecto:');
    expect(within(proyectoCell).getByText('Oficina Central')).toBeInTheDocument();
    expect(within(proyectoCell).queryByText('—')).not.toBeInTheDocument();

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'ADMINISTRATIVE',
        project: null,
        department: DEPT_RRHH.id,
        front_area: 'OFICINA CENTRAL',
        service: 'Oficina Central',
      }),
    );
  });

  it('usuario sin departamento ni proyecto elige "OFICINA CENTRAL" a mano: se desbloquea (no queda en "—") y el payload usa el departamento ADM', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: globalAccessUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0003' } });

    renderWithProviders(<RequestCreatePage />);

    const frenteSelect = await screen.findByText('Frente:').then(() =>
      within(valueCellFor('Frente:')).getByRole('combobox'),
    );
    await user.selectOptions(frenteSelect, 'OFICINA CENTRAL');

    const servicioCell = valueCellFor('Servicio:');
    expect(within(servicioCell).getByText('Oficina Central')).toBeInTheDocument();
    expect(within(servicioCell).queryByText('—')).not.toBeInTheDocument();

    const proyectoCell = valueCellFor('Proyecto:');
    expect(within(proyectoCell).getByText('Oficina Central')).toBeInTheDocument();
    expect(within(proyectoCell).queryByText('—')).not.toBeInTheDocument();

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    // Regression guard: this is exactly the bug reported — before the fix,
    // destinationKey stayed '' for a user with no department, and submit
    // was blocked by "Seleccione un servicio."
    expect(screen.queryByText('Seleccione un servicio.')).not.toBeInTheDocument();

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'ADMINISTRATIVE',
        project: null,
        department: DEPT_ADM.id,
        front_area: 'OFICINA CENTRAL',
        service: 'Oficina Central',
      }),
    );
  });

  it('regresión: otro frente con proyectos (MINERA YANAOCHA) sigue mostrando el dropdown de servicios, sin "Oficina Central" en ningún lado', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: globalAccessUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0004' } });

    renderWithProviders(<RequestCreatePage />);

    const frenteSelect = await screen.findByText('Frente:').then(() =>
      within(valueCellFor('Frente:')).getByRole('combobox'),
    );
    await user.selectOptions(frenteSelect, PROJECT_MINERA.frente);

    const servicioCell = valueCellFor('Servicio:');
    expect(within(servicioCell).queryByText('Oficina Central')).not.toBeInTheDocument();
    const servicioSelect = within(servicioCell).getByRole('combobox');
    await user.selectOptions(servicioSelect, `proj-${PROJECT_MINERA.id}`);

    const proyectoCell = valueCellFor('Proyecto:');
    expect(within(proyectoCell).getByText('PRY-001 — Proyecto Minera Yanaocha')).toBeInTheDocument();
    expect(within(proyectoCell).queryByText('Oficina Central')).not.toBeInTheDocument();

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'OPERATIONS',
        project: PROJECT_MINERA.id,
        department: null,
        front_area: 'MINERA YANAOCHA',
        service: 'PRY-001 — Proyecto Minera Yanaocha',
      }),
    );
  });

  it('error 400 {flow: [...]} del backend: el toast muestra el mensaje humano, no [object Object] ni JSON crudo', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: opsUser() });
    requestsApi.createRequest.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: true,
          status_code: 400,
          code: 'error',
          detail: {
            flow: ['El frente "Oficina Central" debe registrarse por el flujo de Administración.'],
          },
        },
      },
    });

    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    // The human message reaches the toast AND the error summary (a toast alone disappears).
    const matches = await screen.findAllByText('El frente "Oficina Central" debe registrarse por el flujo de Administración.');
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
  });
});

// ── SYSPCC-026: captura con catálogo, Área del RQ y Fuente ─────────────────
const CASCO = {
  id: 501,
  product_code: 'EPP-0001',
  description: 'Casco de seguridad blanco',
  unit: 'UND',
  category: 'EPP',
  available: '12.000',
};
const CEMENTO = {
  id: 502,
  product_code: 'MAT-0100',
  description: 'Cemento Portland Tipo I',
  unit: 'BOLSA',
  category: 'Otros',
  available: '0.000',
};

function lastCreatePayload() {
  return requestsApi.createRequest.mock.calls.at(-1)[0];
}

async function fillHeader(user, { area = 'OP' } = {}) {
  await user.type(within(valueCellFor('N° Requerimiento:')).getByRole('textbox'), '010');
  await user.selectOptions(within(valueCellFor('Área (departamento):')).getByRole('combobox'), 'Producción');
  if (area) await user.selectOptions(screen.getByLabelText(/Área del RQ/), area);
  fireEvent.change(within(valueCellFor('Fecha entrega:')).getByDisplayValue(''), {
    target: { value: '2026-12-31' },
  });
}

async function pickProduct(user, n, text, product) {
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 1, results: [product] } });
  await user.type(screen.getByRole('combobox', { name: new RegExp(`catálogo para el ítem ${n}$`) }), text);
  await user.click(await screen.findByRole('option', { name: new RegExp(product.product_code) }));
}

describe('RequestCreatePage — SYSPCC-026 catálogo, Área y Fuente', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ currentUser: opsUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0100' } });
  });

  it('un ítem elegido del catálogo viaja con inventory_item, la fuente propuesta por la categoría y sin supply_source', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);

    await pickProduct(user, 1, 'casco', CASCO);

    // Product summary replaces the search box; the stock is shown as information only.
    expect(screen.getByText('EPP-0001')).toBeInTheDocument();
    expect(screen.getByText(/Disponible en almacén central: 12 UND \(informativo\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Fuente del ítem 1')).toHaveValue('EPP');
    expect(screen.getByText('Propuesta según el producto')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Cantidad del ítem 1'), '5');
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');

    const payload = lastCreatePayload();
    expect(payload.requesting_area).toBe('OP');
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      line_number: 1,
      description: 'Casco de seguridad blanco',
      unit: 'UND',
      quantity: 5,
      item_source: 'EPP',
      inventory_item: 501,
    });
    expect(payload.items[0]).not.toHaveProperty('is_off_catalog');
    expect(payload.items[0]).not.toHaveProperty('supply_source');
    expect(payload).not.toHaveProperty('supply_source');
  });

  it('el ítem fuera de catálogo viaja con is_off_catalog y sin inventory_item', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalogItem(user, 1, 'Servicio de topografía', 'EQUIPOS');

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');

    const [item] = lastCreatePayload().items;
    expect(item).toMatchObject({
      description: 'Servicio de topografía',
      is_off_catalog: true,
      item_source: 'EQUIPOS',
    });
    expect(item).not.toHaveProperty('inventory_item');
  });

  it('envía el stock declarado como stock_almacen_central (el nombre stock_almacen_principal no existe en la API)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalogItem(user);

    const stock = screen.getByLabelText('Stock declarado en el almacén principal (central) del ítem 1');
    await user.clear(stock);
    await user.type(stock, '7');
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');

    const [item] = lastCreatePayload().items;
    expect(item.stock_almacen_central).toBe(7);
    expect(item).not.toHaveProperty('stock_almacen_principal');
  });

  it('no deja enviar sin el Área del RQ y lleva el foco al resumen de errores', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user, { area: '' });
    await fillOffCatalogItem(user);

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    const summary = screen.getByRole('group', { name: /corrija \d+ error(es)? antes de enviar/i });
    expect(summary).toHaveFocus();
    expect(within(summary).getByText('Seleccione el área del RQ (OP, QC, HSE o ADM).')).toBeInTheDocument();
    expect(screen.getByLabelText(/Área del RQ/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('un ítem con datos pero sin producto ni "fuera de catálogo" bloquea el envío con un mensaje claro', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalogItem(user); // ítem 1 válido
    await user.type(screen.getByLabelText('Cantidad del ítem 2'), '3'); // ítem 2 tocado, sin resolver

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    const summary = screen.getByRole('group', { name: /corrija \d+ error(es)? antes de enviar/i });
    expect(
      within(summary).getByText(
        'Ítem 2: Seleccione un producto del catálogo o márquelo como fuera de catálogo.',
      ),
    ).toBeInTheDocument();
    // The same message sits next to the line, tied to the search box.
    const search = screen.getByRole('combobox', { name: /catálogo para el ítem 2$/ });
    expect(search).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(search.getAttribute('aria-describedby').split(' ')[0])).toHaveTextContent(
      'Seleccione un producto del catálogo',
    );
  });

  it('un ítem sin Fuente bloquea el envío, y el mensaje desaparece al elegirla', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalogItem(user);
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), '');

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    expect(screen.getAllByText('Seleccione la fuente del ítem.').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'MATERIALES');
    expect(screen.queryByText('Seleccione la fuente del ítem.')).not.toBeInTheDocument();
  });

  it('sin ningún ítem resuelto pide agregar al menos uno', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Agregue al menos un ítem: elija un producto del catálogo o márquelo como fuera de catálogo\./),
    ).toBeInTheDocument();
  });

  it('un doble clic en Enviar crea el RQ una sola vez y deja el botón deshabilitado', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest.mockImplementation(() => new Promise(() => {})); // nunca responde
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalogItem(user);

    // Two clicks in the same tick: React has not re-rendered yet, so the button is
    // still enabled for the second one — only the in-flight lock stops it.
    const submit = screen.getByRole('button', { name: /enviar requerimiento/i });
    act(() => {
      submit.click();
      submit.click();
    });

    expect(requestsApi.createRequest).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /enviando/i })).toBeDisabled();
  });

  it('un 400 del backend sobre requesting_area se muestra junto al campo y en el aviso', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest.mockRejectedValue({
      response: {
        status: 400,
        data: { error: true, status_code: 400, detail: { requesting_area: ['Este campo es obligatorio.'] } },
      },
    });
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    await fillHeader(user);
    await fillOffCatalogItem(user);

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    expect((await screen.findAllByText('Este campo es obligatorio.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Área del RQ: Este campo es obligatorio.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar requerimiento/i })).toBeEnabled();
  });

  it('"Cambiar" quita el producto, devuelve el buscador con el foco y retira la fuente que sólo estaba propuesta', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');

    await pickProduct(user, 1, 'casco', CASCO);
    expect(screen.getByLabelText('Fuente del ítem 1')).toHaveValue('EPP');

    await user.click(screen.getByRole('button', { name: /^Cambiar el producto del ítem 1 \(/ }));

    const search = screen.getByRole('combobox', { name: /catálogo para el ítem 1$/ });
    expect(search).toHaveFocus();
    expect(screen.getByLabelText('Fuente del ítem 1')).toHaveValue('');
  });

  it('una fuente elegida a mano se conserva al cambiar de producto', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');

    await pickProduct(user, 1, 'casco', CASCO);
    await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'CONSUMIBLES');
    await user.click(screen.getByRole('button', { name: /^Cambiar el producto del ítem 1 \(/ }));
    await pickProduct(user, 1, 'cemento', CEMENTO);

    expect(screen.getByLabelText('Fuente del ítem 1')).toHaveValue('CONSUMIBLES');
    expect(screen.queryByText('Propuesta según el producto')).not.toBeInTheDocument();
  });
});
