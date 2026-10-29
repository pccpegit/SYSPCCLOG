import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../context/ToastContext';
import LocationProbe from '../../test/LocationProbe';
import RequestMasterPage from './RequestMasterPage';
import * as masterApi from '../../api/requestMaster';
import * as coreApi from '../../api/core';
import { saveBlob } from '../../utils/download';
import { buildMasterRow, buildSummaryRow, buildKpis, page } from '../../test/requestMasterFixtures';

// SYSPCC-030 — Master de RQ: pestañas, filtros <-> URL, orden, paginación, Excel y Stand by.
vi.mock('../../api/requestMaster');
vi.mock('../../api/core');
vi.mock('../../utils/download', async (importOriginal) => ({
  ...(await importOriginal()),
  saveBlob: vi.fn(),
}));

const ok = (data, headers = {}) => Promise.resolve({ data, headers });
const httpError = (status, data = {}) => Promise.reject({ response: { status, data } });

const ROW = buildMasterRow();
const OVERRIDABLE = buildMasterRow({
  id: 102, line_number: 2, description: 'Guantes de cuero', status: 'PENDIENTE', status_label: 'Pendiente',
  can_set_override: true, quantity_attended: '0.000', quantity_missing: '10.000',
  alerts: [{ code: 'DISCREPANCIA', label: 'Discrepancia con el almacén' }],
});

function renderPage(route = '/rq/master') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[route]}>
        <RequestMasterPage />
        <LocationProbe />
      </MemoryRouter>
    </ToastProvider>,
  );
}

const itemRow = (text) => within(screen.getByRole('table', { name: /Seguimiento por ítem/ })).getByText(text).closest('tr');
// Espera a que la lista y los KPIs terminen de cargar (evita actualizaciones fuera de act al salir).
const settled = () => waitFor(() => {
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
  expect(document.querySelector('section[aria-labelledby="master-kpis-title"]')).toHaveAttribute('aria-busy', 'false');
});
const lastCall = (fn) => fn.mock.calls.at(-1)[0];
const loc = () => screen.getByTestId('loc').textContent;

beforeEach(() => {
  vi.resetAllMocks();
  coreApi.getProjects.mockImplementation(() => ok({ results: [{ id: 7, code: 'PRY-001', name: 'Proyecto Demo Uno' }] }));
  masterApi.getRequestMaster.mockImplementation(() => ok(page([ROW, OVERRIDABLE])));
  masterApi.getRequestMasterSummary.mockImplementation(() => ok({ ...page([buildSummaryRow()]), kpis: buildKpis() }));
});

describe('RequestMasterPage — carga y estados', () => {
  it('muestra KPIs, la tabla por ítem con estado en texto y consulta con los valores por defecto', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Master de RQ' })).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Casco blanco')).toBeInTheDocument();
    expect(within(table).getByText('Guantes de cuero')).toBeInTheDocument();
    expect(within(table).getByText('Parcial')).toBeInTheDocument();
    expect(within(table).getByText('Pendiente')).toBeInTheDocument();
    expect(within(table).getByText('Discrepancia con el almacén')).toBeInTheDocument();
    expect(within(table).getAllByRole('link', { name: 'RQ-2026-0042' })[0]).toHaveAttribute('href', '/rq/requests/42');

    // cantidades sin ceros sobrantes y fecha dd/mm/aaaa sin correr el día
    const row = within(table).getByText('Casco blanco').closest('tr');
    expect(within(row).getByText('01/10/2026')).toBeInTheDocument();
    expect(within(row).getByText('20/10/2026')).toBeInTheDocument();

    expect(lastCall(masterApi.getRequestMaster)).toEqual({ page: 1, page_size: 25 });

    // KPIs del servidor
    await waitFor(() => expect(screen.getByText('RQs abiertos').nextElementSibling).toHaveTextContent('9'));
    expect(screen.getByText('Ítems pendientes').nextElementSibling).toHaveTextContent('30');
    expect(screen.getByText('Ítems atendidos').nextElementSibling).toHaveTextContent('40');
    expect(screen.getByText('Avance promedio').nextElementSibling).toHaveTextContent('55.5 %');
    expect(screen.getByText('Vinculados al catálogo').nextElementSibling).toHaveTextContent('90 %');
    expect(lastCall(masterApi.getRequestMasterSummary)).toEqual({ page_size: 1 });
  });

  it('anuncia la carga en una región viva y muestra el estado de carga', async () => {
    masterApi.getRequestMaster.mockImplementation(() => new Promise(() => {}));
    renderPage();

    const live = document.body.querySelector('[aria-live="polite"].sr-only');
    expect(live).toHaveTextContent('Cargando el Master de RQ…');
    expect(screen.getByText('Cargando el Master de RQ…', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('section[aria-labelledby="master-kpis-title"]')).toHaveAttribute('aria-busy', 'false'));
  });

  it('error de carga: alerta con el motivo y «Reintentar» vuelve a consultar', async () => {
    masterApi.getRequestMaster.mockImplementationOnce(() => httpError(500, 'boom'));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo cargar el Master de RQ. Intente nuevamente.');

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Casco blanco')).toBeInTheDocument();
    expect(masterApi.getRequestMaster).toHaveBeenCalledTimes(2);
  });

  it('un 400 por filtros inválidos muestra el detalle del servidor', async () => {
    masterApi.getRequestMaster.mockImplementation(() => httpError(400, { detail: { approved_to: ['La fecha final es anterior a la inicial.'] } }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha final es anterior a la inicial.');
  });

  it('página inexistente (404): ofrece volver a la primera página', async () => {
    masterApi.getRequestMaster.mockImplementationOnce(() => httpError(404, { detail: 'Invalid page.' }));
    renderPage('/rq/master?page=9');

    expect(await screen.findByRole('alert')).toHaveTextContent('La página solicitada ya no existe');
    await userEvent.click(screen.getByRole('button', { name: 'Ir a la primera página' }));
    expect(await screen.findByText('Casco blanco')).toBeInTheDocument();
    expect(loc()).toBe('/rq/master');
  });

  it('vacío sin filtros y vacío con filtros (con «Limpiar filtros»)', async () => {
    masterApi.getRequestMaster.mockImplementation(() => ok(page([])));
    const { unmount } = renderPage();
    expect(await screen.findByText('No hay ítems para mostrar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument();
    unmount();

    renderPage('/rq/master?stage=CERRADO&with_alerts=1');
    expect(await screen.findByText('No hay ítems para mostrar')).toBeInTheDocument();
    const clear = screen.getAllByRole('button', { name: 'Limpiar filtros' });
    await userEvent.click(clear[clear.length - 1]);
    await waitFor(() => expect(loc()).toBe('/rq/master'));
    expect(lastCall(masterApi.getRequestMaster)).toEqual({ page: 1, page_size: 25 });
  });
});

describe('RequestMasterPage — pestañas', () => {
  it('«Por RQ» consulta el resumen, escribe tab=rq en la URL y muestra avance con barra', async () => {
    renderPage();
    await screen.findByText('Casco blanco');

    await userEvent.click(screen.getByRole('tab', { name: 'Por RQ' }));

    expect(loc()).toBe('/rq/master?tab=rq');
    expect(await screen.findByRole('progressbar', { name: 'Avance de RQ-2026-0042' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('tab', { name: 'Por RQ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Por RQ');
    expect(screen.getByText('Aprobado · Adicional')).toBeInTheDocument();
    expect(masterApi.getRequestMasterSummary.mock.calls.map((c) => c[0])).toContainEqual({ page: 1, page_size: 25 });
    await settled();
  });

  it('al cambiar de pestaña no pinta las filas de la otra vista mientras carga', async () => {
    renderPage();
    await screen.findByText('Casco blanco');
    masterApi.getRequestMasterSummary.mockImplementation(() => new Promise(() => {}));

    await userEvent.click(screen.getByRole('tab', { name: 'Por RQ' }));

    expect(await screen.findByText('Cargando el Master de RQ…', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Casco blanco')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('las flechas del teclado cambian de pestaña', async () => {
    renderPage();
    await screen.findByText('Casco blanco');
    screen.getByRole('tab', { name: 'Por ítem' }).focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Por RQ' })).toHaveFocus();
    expect(loc()).toBe('/rq/master?tab=rq');

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Por ítem' })).toHaveFocus();
    expect(loc()).toBe('/rq/master');
    await settled();
  });

  it('abre directo en «Por RQ» si la URL lo pide y conserva los filtros al cambiar de pestaña', async () => {
    renderPage('/rq/master?tab=rq&project=7&ordering=-percent');
    await screen.findByRole('progressbar');
    expect(masterApi.getRequestMasterSummary.mock.calls.map((c) => c[0])).toContainEqual(
      { project: '7', ordering: '-percent', page: 1, page_size: 25 },
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Por ítem' }));
    expect(loc()).toBe('/rq/master?project=7'); // el orden de una vista no vale en la otra
  });
});

describe('RequestMasterPage — filtros sincronizados con la URL', () => {
  it('los filtros de la URL llegan a los controles y a la API', async () => {
    renderPage('/rq/master?project=7&area=HSE&source=EPP&item_status=PARCIAL&stage=POR_ENTREGAR&approved_from=2026-10-01&with_shortage=1&with_alerts=1&search=casco');
    await screen.findByText('Casco blanco');

    expect(screen.getByLabelText('Proyecto')).toHaveValue('7');
    expect(screen.getByLabelText('Área')).toHaveValue('HSE');
    expect(screen.getByLabelText('Fuente')).toHaveValue('EPP');
    expect(screen.getByLabelText('Estado del ítem')).toHaveValue('PARCIAL');
    expect(screen.getByLabelText('Etapa')).toHaveValue('POR_ENTREGAR');
    expect(screen.getByLabelText('Aprobado desde')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Solo con faltante')).toBeChecked();
    expect(screen.getByLabelText('Solo con alertas')).toBeChecked();
    expect(screen.getByLabelText('Buscar')).toHaveValue('casco');
    expect(lastCall(masterApi.getRequestMaster)).toEqual({
      project: '7', area: 'HSE', source: 'EPP', item_status: 'PARCIAL', stage: 'POR_ENTREGAR',
      approved_from: '2026-10-01', with_shortage: 'true', with_alerts: 'true', search: 'casco', page: 1, page_size: 25,
    });
  });

  it('cambiar un filtro actualiza la URL, vuelve a la página 1 y consulta de nuevo', async () => {
    renderPage('/rq/master?page=3');
    await screen.findByText('Casco blanco');

    await userEvent.selectOptions(screen.getByLabelText('Proyecto'), '7');
    await userEvent.selectOptions(screen.getByLabelText('Estado del ítem'), 'PENDIENTE');
    await userEvent.click(screen.getByLabelText('Solo con faltante'));

    expect(loc()).toBe('/rq/master?project=7&item_status=PENDIENTE&with_shortage=1');
    await waitFor(() => expect(lastCall(masterApi.getRequestMaster)).toEqual({
      project: '7', item_status: 'PENDIENTE', with_shortage: 'true', page: 1, page_size: 25,
    }));
  });

  it('la búsqueda espera a que se deje de teclear antes de tocar la URL y la API', async () => {
    renderPage();
    await screen.findByText('Casco blanco');
    const calls = masterApi.getRequestMaster.mock.calls.length;

    await userEvent.type(screen.getByLabelText('Buscar'), 'casco');
    expect(masterApi.getRequestMaster).toHaveBeenCalledTimes(calls);
    expect(loc()).toBe('/rq/master');

    await waitFor(() => expect(loc()).toBe('/rq/master?search=casco'));
    await waitFor(() => expect(lastCall(masterApi.getRequestMaster)).toEqual({ search: 'casco', page: 1, page_size: 25 }));
    expect(masterApi.getRequestMaster).toHaveBeenCalledTimes(calls + 1);
  });

  it('«Limpiar filtros» vacía la URL y los controles, incluida la búsqueda', async () => {
    renderPage('/rq/master?project=7&search=guantes');
    await screen.findByText('Casco blanco');
    expect(screen.getByRole('heading', { name: 'Filtros (2)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));

    expect(loc()).toBe('/rq/master');
    expect(screen.getByLabelText('Proyecto')).toHaveValue('');
    expect(screen.getByLabelText('Buscar')).toHaveValue('');
  });

  it('ignora valores inválidos de la URL en vez de enviarlos', async () => {
    renderPage('/rq/master?area=XX&page=abc&stage=nada');
    await screen.findByText('Casco blanco');
    expect(lastCall(masterApi.getRequestMaster)).toEqual({ page: 1, page_size: 25 });
  });
});

describe('RequestMasterPage — orden y paginación', () => {
  it('ordena por columna: ascendente, descendente y de vuelta al orden por defecto', async () => {
    renderPage();
    await screen.findByText('Casco blanco');
    const header = () => screen.getByRole('columnheader', { name: /Solicitado/ });
    expect(header()).toHaveAttribute('aria-sort', 'none');

    await userEvent.click(within(header()).getByRole('button'));
    expect(loc()).toBe('/rq/master?ordering=quantity');
    await waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'ascending'));
    expect(lastCall(masterApi.getRequestMaster)).toMatchObject({ ordering: 'quantity' });

    await userEvent.click(within(header()).getByRole('button'));
    expect(loc()).toBe('/rq/master?ordering=-quantity');
    await waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'descending'));

    await userEvent.click(within(header()).getByRole('button'));
    expect(loc()).toBe('/rq/master');
  });

  it('pagina con Siguiente/Anterior y cambia las filas por página', async () => {
    masterApi.getRequestMaster.mockImplementation((params) => ok(page([ROW], {
      count: 60, next: params.page < 3 ? 'x' : null, previous: params.page > 1 ? 'y' : null,
    })));
    renderPage();
    await screen.findByText('Casco blanco');
    expect(screen.getByText('1–25')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(loc()).toBe('/rq/master?page=2');
    await waitFor(() => expect(lastCall(masterApi.getRequestMaster)).toMatchObject({ page: 2 }));
    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument();
    expect(screen.getByText('26–50')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Anterior/ }));
    expect(loc()).toBe('/rq/master');

    await userEvent.selectOptions(screen.getByLabelText('Filas por página'), '50');
    expect(loc()).toBe('/rq/master?page_size=50');
    await waitFor(() => expect(lastCall(masterApi.getRequestMaster)).toMatchObject({ page: 1, page_size: 50 }));
  });

  it('«Anterior» no actúa en la primera página (aria-disabled)', async () => {
    renderPage();
    await screen.findByText('Casco blanco');
    const prev = screen.getByRole('button', { name: /Anterior/ });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(prev);
    expect(loc()).toBe('/rq/master');
  });
});

describe('RequestMasterPage — fila expandible', () => {
  it('muestra entregas (con reversa), comentario, aprobación de gerencia y P/A', async () => {
    renderPage();
    await screen.findByText('Casco blanco');

    const toggle = screen.getByRole('button', { name: 'Ver detalle de la línea 1 de RQ-2026-0042' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Ocultar detalle de la línea 1 de RQ-2026-0042' })).toHaveAttribute('aria-expanded', 'true');
    const entregas = screen.getByRole('table', { name: 'Entregas del almacén' });
    expect(within(entregas).getByText('DSP-0009')).toBeInTheDocument();
    expect(within(entregas).getByText('Reversa')).toBeInTheDocument();
    expect(within(entregas).getByText('-1')).toBeInTheDocument();
    expect(screen.getByText('Entregar en el frente 3')).toBeInTheDocument();
    expect(screen.getByText('Aprobación de gerencia general').nextElementSibling).toHaveTextContent('No aplica');
    expect(screen.getByText('Presupuesto (P/A)').nextElementSibling).toHaveTextContent('P — Dentro de propuesta');

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar detalle de la línea 1 de RQ-2026-0042' }));
    expect(screen.queryByRole('table', { name: 'Entregas del almacén' })).not.toBeInTheDocument();
  });
});

describe('RequestMasterPage — descarga del Excel', () => {
  const blob = new Blob(['x']);

  it('descarga con los filtros activos (sin página ni orden) y el nombre que da el servidor', async () => {
    masterApi.exportRequestMaster.mockImplementation(() => ok(blob, {
      'content-disposition': 'attachment; filename="master_rq_2026-10-29.xlsx"',
      'x-export-truncated': 'false',
    }));
    renderPage('/rq/master?project=7&with_shortage=1&ordering=-quantity&page=2');
    await screen.findByText('Casco blanco');

    await userEvent.click(screen.getByRole('button', { name: 'Descargar Master (Excel)' }));

    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, 'master_rq_2026-10-29.xlsx'));
    expect(masterApi.exportRequestMaster).toHaveBeenCalledWith({ project: '7', with_shortage: 'true' });
    expect(await screen.findByText('Master descargado.')).toBeInTheDocument();
    expect(screen.queryByText(/incompleto/)).not.toBeInTheDocument();
  });

  it('avisa cuando el servidor truncó el archivo', async () => {
    masterApi.exportRequestMaster.mockImplementation(() => ok(blob, {
      'content-disposition': 'attachment; filename="master.xlsx"',
      'x-export-truncated': 'true',
    }));
    renderPage();
    await screen.findByText('Casco blanco');

    await userEvent.click(screen.getByRole('button', { name: 'Descargar Master (Excel)' }));

    expect(await screen.findAllByText(/se generó incompleto/)).not.toHaveLength(0);
    expect(saveBlob).toHaveBeenCalledWith(blob, 'master.xlsx');
  });

  it('429: explica que hay que esperar y no guarda ningún archivo', async () => {
    masterApi.exportRequestMaster.mockImplementation(() => httpError(429, new Blob(['{}'])));
    renderPage();
    await screen.findByText('Casco blanco');

    await userEvent.click(screen.getByRole('button', { name: 'Descargar Master (Excel)' }));

    expect(await screen.findAllByText(/demasiadas descargas seguidas/)).not.toHaveLength(0);
    expect(saveBlob).not.toHaveBeenCalled();
    // el botón vuelve a estar disponible
    expect(screen.getByRole('button', { name: 'Descargar Master (Excel)' })).toHaveAttribute('aria-disabled', 'false');
  });

  it('ignora clics repetidos mientras la descarga sigue en curso', async () => {
    let resolve;
    masterApi.exportRequestMaster.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderPage();
    await screen.findByText('Casco blanco');

    await userEvent.click(screen.getByRole('button', { name: 'Descargar Master (Excel)' }));
    const busy = await screen.findByRole('button', { name: 'Preparando Excel…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(busy);
    expect(masterApi.exportRequestMaster).toHaveBeenCalledTimes(1);

    resolve({ data: blob, headers: {} });
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, 'master_rq.xlsx'));
  });
});

describe('RequestMasterPage — Stand by / Desestimar / Quitar', () => {
  const overrideItem = (over = {}) => ({
    ...OVERRIDABLE, status: 'STAND_BY', status_label: 'Stand by', attention_override: 'STAND_BY',
    attention_override_label: 'Stand by', attention_note: 'Falta aprobación del cliente', ...over,
  });

  it('solo las filas con can_set_override ofrecen la acción', async () => {
    renderPage();
    await screen.findByText('Casco blanco');

    expect(screen.getByRole('button', { name: 'Poner en stand by la línea 2 de RQ-2026-0042' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desestimar la línea 2 de RQ-2026-0042' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Poner en stand by la línea 1 de RQ-2026-0042' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desestimar la línea 1 de RQ-2026-0042' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quitar el seguimiento/ })).not.toBeInTheDocument();
  });

  it('sin ninguna fila editable no aparece la columna de seguimiento', async () => {
    masterApi.getRequestMaster.mockImplementation(() => ok(page([ROW])));
    renderPage();
    await screen.findByText('Casco blanco');
    expect(screen.queryByRole('columnheader', { name: 'Seguimiento' })).not.toBeInTheDocument();
  });

  it('exige el motivo, lo envía y actualiza la fila con el ítem devuelto', async () => {
    masterApi.setItemAttentionOverride.mockImplementation(() => ok({ detail: 'Ítem puesto en stand by.', changed: true, item: overrideItem() }));
    renderPage();
    await screen.findByText('Guantes de cuero');

    await userEvent.click(screen.getByRole('button', { name: 'Poner en stand by la línea 2 de RQ-2026-0042' }));
    const dialog = screen.getByRole('dialog', { name: 'Poner en stand by' });
    const note = within(dialog).getByLabelText(/Motivo/);
    await waitFor(() => expect(note).toHaveFocus());

    // sin motivo: error en línea, foco al campo y ninguna llamada
    await userEvent.click(within(dialog).getByRole('button', { name: 'Poner en stand by' }));
    expect(within(dialog).getByText('Indique el motivo para fijar el seguimiento manual.')).toBeInTheDocument();
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveFocus();
    expect(masterApi.setItemAttentionOverride).not.toHaveBeenCalled();

    await userEvent.type(note, '  Falta aprobación del cliente  ');
    expect(within(dialog).getByText('32/300')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Poner en stand by' }));

    await waitFor(() => expect(masterApi.setItemAttentionOverride).toHaveBeenCalledWith(
      42, 102, { override: 'STAND_BY', note: 'Falta aprobación del cliente' },
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Ítem puesto en stand by.')).toBeInTheDocument();

    const row = itemRow('Guantes de cuero');
    expect(within(row).getByText('Stand by')).toBeInTheDocument();
    expect(within(row).queryByText('Pendiente')).not.toBeInTheDocument();
    // ahora ofrece «Quitar» y ya no «Stand by»
    expect(within(row).getByRole('button', { name: 'Quitar el seguimiento manual de la línea 2 de RQ-2026-0042' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Poner en stand by/ })).not.toBeInTheDocument();
    // los KPIs se recalculan
    await waitFor(() => expect(masterApi.getRequestMasterSummary.mock.calls.length).toBeGreaterThan(1));
  });

  it('«Quitar» confirma sin pedir motivo y envía override vacío', async () => {
    masterApi.getRequestMaster.mockImplementation(() => ok(page([overrideItem()])));
    masterApi.setItemAttentionOverride.mockImplementation(() => ok({
      detail: 'Se quitó el seguimiento manual.', changed: true,
      item: { ...OVERRIDABLE, attention_override: '', attention_note: '' },
    }));
    renderPage();
    await screen.findByText('Guantes de cuero');

    await userEvent.click(screen.getByRole('button', { name: 'Quitar el seguimiento manual de la línea 2 de RQ-2026-0042' }));
    const dialog = screen.getByRole('dialog', { name: 'Quitar seguimiento manual' });
    expect(within(dialog).queryByLabelText(/Motivo/)).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar' }));

    await waitFor(() => expect(masterApi.setItemAttentionOverride).toHaveBeenCalledWith(42, 102, { override: '', note: '' }));
    expect(await screen.findByText('Se quitó el seguimiento manual.')).toBeInTheDocument();
  });

  it.each([
    [409, { code: 'REQUEST_TERMINAL', detail: 'El RQ ya está cerrado: no admite cambios.' }, 'El RQ ya está cerrado: no admite cambios.'],
    [403, { detail: 'No autorizado.' }, 'No tiene permiso para cambiar el seguimiento de este ítem.'],
    [400, { detail: { note: ['El motivo es demasiado largo.'] } }, 'El motivo es demasiado largo.'],
  ])('error %s: lo explica dentro del diálogo, no lo cierra y la fila no cambia', async (status, body, message) => {
    masterApi.setItemAttentionOverride.mockImplementation(() => httpError(status, body));
    renderPage();
    await screen.findByText('Guantes de cuero');

    await userEvent.click(screen.getByRole('button', { name: 'Desestimar la línea 2 de RQ-2026-0042' }));
    const dialog = screen.getByRole('dialog', { name: 'Desestimar ítem' });
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Ya no se usa');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desestimar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(itemRow('Guantes de cuero')).getByText('Pendiente')).toBeInTheDocument();
    // se puede reintentar: el botón vuelve a estar activo
    expect(within(dialog).getByRole('button', { name: 'Desestimar' })).toHaveAttribute('aria-disabled', 'false');
  });

  it('bloquea el doble envío mientras se guarda', async () => {
    let resolve;
    masterApi.setItemAttentionOverride.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderPage();
    await screen.findByText('Guantes de cuero');

    await userEvent.click(screen.getByRole('button', { name: 'Desestimar la línea 2 de RQ-2026-0042' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Duplicado');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desestimar' }));
    const saving = await within(dialog).findByRole('button', { name: 'Guardando…' });
    expect(saving).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(saving);
    expect(masterApi.setItemAttentionOverride).toHaveBeenCalledTimes(1);

    resolve({ data: { detail: 'Listo.', changed: true, item: overrideItem({ status: 'DESESTIMADO', status_label: 'Desestimado', attention_override: 'DESESTIMADO' }) }, headers: {} });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Escape cierra el diálogo y devuelve el foco al botón que lo abrió', async () => {
    renderPage();
    await screen.findByText('Guantes de cuero');
    const opener = screen.getByRole('button', { name: 'Desestimar la línea 2 de RQ-2026-0042' });

    await userEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(masterApi.setItemAttentionOverride).not.toHaveBeenCalled();
  });

  it('Tab no sale del diálogo', async () => {
    renderPage();
    await screen.findByText('Guantes de cuero');
    await userEvent.click(screen.getByRole('button', { name: 'Desestimar la línea 2 de RQ-2026-0042' }));
    const dialog = screen.getByRole('dialog');

    // Ciclo completo de Tab: siempre termina dentro del diálogo.
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement);
    }
    await userEvent.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement);
  });
});
