import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import LocationProbe from '../../test/LocationProbe';
import RequestCreatePage from './RequestCreatePage';
import { useAuth } from '../../context/useAuth';
import * as coreApi from '../../api/core';
import * as requestsApi from '../../api/requests';
import * as exportRQ from '../../utils/exportRQ';

// SYSPCC-031: "Guardar borrador" really saves a draft (DRAFT) and the draft can be reopened
// ("Continuar") and sent from the same form. The API layer is mocked.
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/core');
vi.mock('../../api/requests');
vi.mock('../../utils/exportRQ');

const PROJECT = { id: 1, code: 'PRY-001', name: 'Proyecto Minera Yanaocha', frente: 'MINERA YANAOCHA' };

function opsUser({ department = 'Producción' } = {}) {
  return {
    id: 1,
    first_name: 'Op',
    last_name: 'Erator',
    full_name: 'Op Erator',
    department,
    roles: [{
      role: 'REQUESTER',
      is_primary: true,
      project: PROJECT.id,
      project_code: PROJECT.code,
      project_name: PROJECT.name,
      project_frente: PROJECT.frente,
      department_obj: null,
    }],
  };
}

function valueCellFor(labelText) {
  const [labelEl] = screen.getAllByText((content) => content.startsWith(labelText));
  return labelEl.closest('td').nextElementSibling;
}

async function fillOffCatalogItem(user, n = 1, description = 'Papel bond A4', source = 'UTILES', quantity = '3') {
  await user.click(screen.getByLabelText(`Ítem ${n}: Fuera de catálogo`));
  await user.type(screen.getByLabelText(`Descripción del ítem ${n} fuera de catálogo`), description);
  if (source) await user.selectOptions(screen.getByLabelText(`Fuente del ítem ${n}`), source);
  if (quantity) await user.type(screen.getByLabelText(`Cantidad del ítem ${n}`), quantity);
}

function renderNew() {
  return renderWithProviders(
    <Routes>
      <Route path="/rq/requests/new" element={<RequestCreatePage />} />
      <Route path="*" element={<LocationProbe />} />
    </Routes>,
    { route: '/rq/requests/new' },
  );
}

function renderDraft(id = 7) {
  return renderWithProviders(
    <Routes>
      <Route path="/rq/requests/draft/:draftId" element={<RequestCreatePage />} />
      <Route path="*" element={<LocationProbe />} />
    </Routes>,
    { route: `/rq/requests/draft/${id}` },
  );
}

const SAVED_DRAFT = {
  id: 7,
  rq_number: 'BOR-AB12CD34EF56',
  status: 'DRAFT',
  flow: 'OPERATIONS',
  project: 1,
  department: null,
  front_area: 'MINERA YANAOCHA',
  service: 'PRY-001 — Proyecto Minera Yanaocha',
  specific_use: 'Mantenimiento',
  requesting_area: 'QC',
  fecha_necesidad: '2026-12-31',
  items: [
    {
      id: 71, line_number: 1, description: 'Casco de seguridad blanco', quantity: '5.000', unit: 'UND',
      inventory_item: 501, inventory_item_code: 'EPP-0001', inventory_item_description: 'Casco de seguridad blanco',
      inventory_item_unit: 'UND', is_off_catalog: false, item_source: 'EPP',
      stock_almacen_obra: '0.000', stock_almacen_central: '0.000', presupuestado_adicional: 'P',
      rfi_fwo: '', comentarios: '',
    },
    {
      id: 72, line_number: 2, description: 'Servicio de topografía', quantity: '0.000', unit: 'GLB',
      inventory_item: null, inventory_item_code: null, inventory_item_description: null,
      inventory_item_unit: null, is_off_catalog: true, item_source: 'EQUIPOS',
      stock_almacen_obra: '0.000', stock_almacen_central: '0.000', presupuestado_adicional: 'P',
      rfi_fwo: '', comentarios: '',
    },
  ],
};

function mockSaved(overrides = {}) {
  requestsApi.getRequest.mockResolvedValue({ data: { ...SAVED_DRAFT, ...overrides } });
}

beforeEach(() => {
  vi.clearAllMocks();
  coreApi.getProjects.mockResolvedValue({ data: { results: [PROJECT] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [] } });
  exportRQ.exportRQToExcel.mockResolvedValue(undefined);
  useAuth.mockReturnValue({ currentUser: opsUser() });
});

describe('RequestCreatePage — Guardar borrador (SYSPCC-031)', () => {
  it('el botón secundario se llama "Guardar borrador" y ya no existe "Enviar sin Excel"', async () => {
    renderNew();
    await screen.findByText('MINERA YANAOCHA');

    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar sin Excel' })).not.toBeInTheDocument();
  });

  it('guarda con validación mínima: sin N°, área, fecha ni fuente; no envía, no descarga el Excel y avisa "Borrador guardado."', async () => {
    const user = userEvent.setup();
    requestsApi.createDraft.mockResolvedValue({ data: { id: 7, status: 'DRAFT' } });
    renderNew();
    await screen.findByText('MINERA YANAOCHA');
    await fillOffCatalogItem(user, 1, 'Papel bond A4', '', '');

    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    await screen.findByText('Borrador guardado.');
    expect(requestsApi.createDraft).toHaveBeenCalledTimes(1);
    const payload = requestsApi.createDraft.mock.calls[0][0];
    expect(payload).toMatchObject({
      flow: 'OPERATIONS', project: 1, requesting_area: '', fecha_necesidad: null,
    });
    expect(payload).not.toHaveProperty('rq_number');
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ description: 'Papel bond A4', is_off_catalog: true, quantity: 0, item_source: '' });
    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    expect(requestsApi.submitDraft).not.toHaveBeenCalled();
    expect(exportRQ.exportRQToExcel).not.toHaveBeenCalled();
  });

  it('sin ningún ítem resuelto no guarda y lo dice en el aviso', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText('MINERA YANAOCHA');

    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    expect(requestsApi.createDraft).not.toHaveBeenCalled();
    expect(screen.getByText(/Para guardar el borrador agregue al menos un ítem/)).toBeInTheDocument();
  });

  it('un ítem a medias no se guarda y el aviso lo cuenta', async () => {
    const user = userEvent.setup();
    requestsApi.createDraft.mockResolvedValue({ data: { id: 7, status: 'DRAFT' } });
    renderNew();
    await screen.findByText('MINERA YANAOCHA');
    await fillOffCatalogItem(user, 1, 'Papel bond A4', '', '');
    await user.type(screen.getByLabelText('Cantidad del ítem 2'), '4'); // tocada pero sin producto

    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    await screen.findByText('Borrador guardado. 1 ítem incompleto no se guardó.');
    expect(requestsApi.createDraft.mock.calls[0][0].items).toHaveLength(1);
  });

  it('tras guardar vuelve a la lista de requerimientos', async () => {
    const user = userEvent.setup();
    requestsApi.createDraft.mockResolvedValue({ data: { id: 7, status: 'DRAFT' } });
    renderNew();
    await screen.findByText('MINERA YANAOCHA');
    await fillOffCatalogItem(user, 1, 'Papel bond A4', '', '');

    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    expect(await screen.findByTestId('loc', {}, { timeout: 2000 })).toHaveTextContent('/rq/requests');
  });

  it('un 400 al guardar se muestra en el aviso y el botón queda disponible', async () => {
    const user = userEvent.setup();
    requestsApi.createDraft.mockRejectedValue({
      response: { status: 400, data: { error: true, detail: { items: [{ quantity: ['La cantidad no puede ser negativa.'] }] } } },
    });
    renderNew();
    await screen.findByText('MINERA YANAOCHA');
    await fillOffCatalogItem(user, 1, 'Papel bond A4', '', '');

    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    expect((await screen.findAllByText('Ítem 1 (Cantidad): La cantidad no puede ser negativa.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeEnabled();
  });

  it('el envío directo no cambió: createRequest sin borrador, con el Excel', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: opsUser({ department: '' }) });
    requestsApi.createRequest.mockResolvedValue({ data: { id: 9, rq_number: 'RQ-2026-0009' } });
    renderNew();
    await screen.findByText('MINERA YANAOCHA');
    await user.type(within(valueCellFor('N° Requerimiento:')).getByRole('textbox'), '010');
    await user.selectOptions(within(valueCellFor('Área (departamento):')).getByRole('combobox'), 'Producción');
    await user.selectOptions(screen.getByLabelText(/Área del RQ/), 'OP');
    fireEvent.change(within(valueCellFor('Fecha entrega:')).getByDisplayValue(''), { target: { value: '2026-12-31' } });
    await fillOffCatalogItem(user);

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createDraft).not.toHaveBeenCalled();
    expect(requestsApi.createRequest.mock.calls[0][0]).toMatchObject({ rq_number: 'REQ-010', fecha_necesidad: '2026-12-31' });
    expect(exportRQ.exportRQToExcel).toHaveBeenCalledWith(expect.objectContaining({ rqNumber: 'RQ-2026-0009' }));
  });
});

describe('RequestCreatePage — Continuar un borrador (SYSPCC-031)', () => {
  it('abre el formulario precargado: encabezado, producto del catálogo, ítem fuera de catálogo y fuente', async () => {
    mockSaved();
    renderDraft();

    expect(await screen.findByText('Borrador de requerimiento')).toBeInTheDocument();
    expect(requestsApi.getRequest).toHaveBeenCalledWith('7');
    expect(screen.getByLabelText(/Área del RQ/)).toHaveValue('QC');
    expect(screen.getByDisplayValue('Mantenimiento')).toBeInTheDocument();
    expect(screen.getByText('EPP-0001')).toBeInTheDocument();
    expect(screen.getByLabelText('Fuente del ítem 1')).toHaveValue('EPP');
    expect(screen.getByLabelText('Cantidad del ítem 1')).toHaveValue(5);
    expect(screen.getByLabelText('Descripción del ítem 2 fuera de catálogo')).toHaveValue('Servicio de topografía');
    expect(screen.getByLabelText('Cantidad del ítem 2')).toHaveValue(null); // 0 = todavía sin decidir
    expect(screen.getByText(/el sistema asigna el N° al enviarlo/i)).toBeInTheDocument();
  });

  it('Guardar borrador actualiza el mismo borrador (no crea otro) con todas las líneas', async () => {
    const user = userEvent.setup();
    mockSaved();
    requestsApi.updateRequest.mockResolvedValue({ data: SAVED_DRAFT });
    renderDraft();
    await screen.findByText('Borrador de requerimiento');

    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    await screen.findByText('Borrador guardado.');
    expect(requestsApi.createDraft).not.toHaveBeenCalled();
    const [id, payload] = requestsApi.updateRequest.mock.calls[0];
    expect(id).toBe('7');
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({ inventory_item: 501, quantity: 5, item_source: 'EPP' });
    expect(payload.items[1]).toMatchObject({ is_off_catalog: true, description: 'Servicio de topografía' });
    expect(payload.fecha_necesidad).toBe('2026-12-31');
  });

  it('Enviar exige las validaciones completas antes de llamar al servidor', async () => {
    const user = userEvent.setup();
    mockSaved({ fecha_necesidad: null });
    renderDraft();
    await screen.findByText('Borrador de requerimiento');

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    expect(requestsApi.updateRequest).not.toHaveBeenCalled();
    expect(requestsApi.submitDraft).not.toHaveBeenCalled();
    expect(screen.getAllByText('Ingrese la fecha de entrega.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ítem 2: Ingrese la cantidad (mayor que 0).').length).toBeGreaterThan(0);
  });

  it('Enviar guarda el borrador, ejecuta el envío y descarga el Excel con el N° oficial', async () => {
    const user = userEvent.setup();
    mockSaved();
    requestsApi.updateRequest.mockResolvedValue({ data: SAVED_DRAFT });
    requestsApi.submitDraft.mockResolvedValue({ data: { id: 7, status: 'SUBMITTED', rq_number: 'RQ-2026-0042' } });
    renderDraft();
    await screen.findByText('Borrador de requerimiento');
    await user.type(screen.getByLabelText('Cantidad del ítem 2'), '2');

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.updateRequest).toHaveBeenCalledWith('7', expect.objectContaining({ items: expect.any(Array) }));
    expect(requestsApi.submitDraft).toHaveBeenCalledWith('7');
    expect(requestsApi.createRequest).not.toHaveBeenCalled();
    expect(requestsApi.updateRequest.mock.invocationCallOrder[0])
      .toBeLessThan(requestsApi.submitDraft.mock.invocationCallOrder[0]);
    expect(exportRQ.exportRQToExcel).toHaveBeenCalledWith(expect.objectContaining({ rqNumber: 'RQ-2026-0042' }));
  });

  it('si el servidor rechaza el envío (400) muestra todos los mensajes, no descarga el Excel y deja reintentar', async () => {
    const user = userEvent.setup();
    mockSaved();
    requestsApi.updateRequest.mockResolvedValue({ data: SAVED_DRAFT });
    requestsApi.submitDraft.mockRejectedValue({
      response: {
        status: 400,
        data: { error: true, detail: { service: ['Seleccione un servicio.'], items: ['Ítem 2: Ingrese la cantidad (mayor que 0).'] } },
      },
    });
    renderDraft();
    await screen.findByText('Borrador de requerimiento');
    await user.type(screen.getByLabelText('Cantidad del ítem 2'), '2');

    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    expect((await screen.findAllByText('Seleccione un servicio.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ítem 2: Ingrese la cantidad (mayor que 0).').length).toBeGreaterThan(0);
    expect(exportRQ.exportRQToExcel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /enviar requerimiento/i })).toBeEnabled();
  });

  it('un requerimiento que ya no es borrador lleva a su detalle', async () => {
    mockSaved({ status: 'SUBMITTED', rq_number: 'RQ-2026-0042' });
    renderDraft();

    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/requests/RQ-2026-0042');
    expect(await screen.findByText('Este requerimiento ya fue enviado y no se puede editar.')).toBeInTheDocument();
  });

  it('un borrador que no existe muestra el aviso y un camino de regreso', async () => {
    const user = userEvent.setup();
    requestsApi.getRequest.mockRejectedValue({ response: { status: 404, data: { detail: 'No encontrado.' } } });
    renderDraft(99);

    expect(await screen.findByText('No se encontró el borrador')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ir a mis requerimientos' }));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/rq/requests');
  });
});
