import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeImport } from '../../test/almacenFixtures';
import ImportarPage from './ImportarPage';
import * as importApi from '../../api/almacenImport';
import * as almacenApi from '../../api/almacen';
import * as download from '../../utils/download';

// SYSPCC-025 · QA ronda 1 — importador: privacidad de los nombres, estados de error y casos límite.

vi.mock('../../api/almacenImport');
vi.mock('../../api/almacen');
vi.mock('../../utils/download', async () => {
  const actual = await vi.importActual('../../utils/download');
  return { ...actual, downloadResponse: vi.fn() };
});

const WORKER = { id: 7, full_name: 'Apellido Prueba Siete', position: 'Operario', project_code: 'OP' };
const DESTINATION = 'APELLIDO PRUEBA UNO';
const NAMES = [DESTINATION, 'Apellido Prueba Siete', 'APELLIDO', 'Prueba Siete'];

const PROBLEMS = {
  data: {
    count: 1,
    results: [{ code: 'VALE_VACIO', severity: 'warning', sheet: 'EGRESOS', row: 12, message: 'El egreso no tiene N° de vale.' }],
    meta: { total: 1, truncated: false },
  },
};

const RESULT = {
  catalog: { created: 254, updated: 0 }, groups: { initial: 0, entries: 4, exits: 403 },
  movements: { initial: 0, entries: 239, exits: 459 }, skipped: { rows_with_errors: 37, already_imported: 0 },
  stock_total: 6913, reconciled: true,
};

function xlsx(name = 'inventario.xlsx') {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: 2048 });
  return f;
}

const setup = () => userEvent.setup({ applyAccept: false });

async function analyze(user, file = xlsx()) {
  await user.upload(await screen.findByLabelText(/arrastre el libro/i), file);
  await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
  await screen.findByRole('heading', { name: /paso 2/i });
}

async function toStep3(user) {
  await user.selectOptions(screen.getByRole('combobox', { name: /on plant/i }), 'No asignar proyecto');
  await user.click(screen.getByRole('button', { name: /continuar a la confirmación/i }));
  await screen.findByRole('heading', { name: /paso 3/i });
}

async function acceptAll(user) {
  await user.click(screen.getByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
  await user.click(screen.getByRole('checkbox', { name: /entiendo que se omitirán/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  importApi.getImports.mockResolvedValue({ data: { results: [] } });
  importApi.uploadImport.mockResolvedValue({ data: makeImport() });
  importApi.getImportProblems.mockResolvedValue(PROBLEMS);
  importApi.confirmImport.mockResolvedValue({ data: makeImport({ status: 'CONFIRMED', result: RESULT }), headers: {} });
  importApi.cancelImport.mockResolvedValue({ data: { status: 'CANCELLED' } });
  almacenApi.lookupPersonal.mockResolvedValue({ data: [WORKER] });
});

afterEach(() => vi.restoreAllMocks());

describe('ImportarPage — los nombres de trabajadores solo viven en pantalla', () => {
  it('un recorrido completo con vinculación no los manda a consola, almacenamiento, URL ni cookies', async () => {
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i }));
    await user.type(screen.getByRole('combobox', { name: /trabajador para el destino/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));
    await toStep3(user);
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    await screen.findByText(/importación completada: 254 ítems/i);

    const everything = JSON.stringify([
      logs.flatMap((spy) => spy.mock.calls),
      setItem.mock.calls,
      push.mock.calls,
      replace.mock.calls,
      document.cookie,
      window.location.href,
    ]).toLowerCase();
    NAMES.forEach((name) => expect(everything).not.toContain(name.toLowerCase()));
  });

  it('al confirmar solo viaja la clave del destino y el id del trabajador, no su nombre', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i }));
    await user.type(screen.getByRole('combobox', { name: /trabajador para el destino/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));
    await toStep3(user);
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    await waitFor(() => expect(importApi.confirmImport).toHaveBeenCalled());
    const payload = importApi.confirmImport.mock.calls[0][1];
    expect(payload.destinationMap).toEqual({ 'apellido-prueba-uno': 7 });
    expect(JSON.stringify(payload).toLowerCase()).not.toContain('prueba siete');
  });

  it('tras importar, ni el resultado ni el DOM conservan los nombres', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await toStep3(user);
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    await screen.findByRole('heading', { name: 'Importación completada' });
    NAMES.forEach((name) => expect(document.body.textContent).not.toContain(name));
  });

  it('un destino vinculado puede volver a «dejar como texto» y no se envía', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i }));
    await user.type(screen.getByRole('combobox', { name: /trabajador para el destino/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));
    await user.click(screen.getByRole('button', { name: /dejar como texto/i }));
    expect(screen.getByText('Se guardará como texto.')).toBeInTheDocument();
    await toStep3(user);
    expect(screen.queryByText(/se vinculará a personal/i)).not.toBeInTheDocument();
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    await waitFor(() => expect(importApi.confirmImport).toHaveBeenCalled());
    expect(importApi.confirmImport.mock.calls[0][1].destinationMap).toEqual({});
  });
});

describe('ImportarPage — errores al confirmar', () => {
  async function toConfirmWithError(user, error) {
    importApi.confirmImport.mockRejectedValue(error);
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await toStep3(user);
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
  }

  it('una previsualización vencida explica qué hacer y ofrece volver a subir sin llamar a cancelar', async () => {
    const user = setup();
    await toConfirmWithError(user, { response: { status: 409, data: { code: 'import_expired', detail: 'vencida' } } });
    expect(await screen.findByText(/la previsualización venció/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^importar$/i })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: /volver a subir el archivo/i }));
    expect(await screen.findByRole('heading', { name: /paso 1/i })).toBeInTheDocument();
    expect(importApi.cancelImport).not.toHaveBeenCalled();
  });

  it.each([
    ['import_conflict', 'Otra importación modificó los mismos datos.'],
    ['import_file_missing', 'El libro de esta importación ya no está disponible.'],
    ['import_not_confirmable', 'La importación está cancelada; suba el libro otra vez.'],
  ])('%s obliga a volver a subir el libro y muestra el detalle del servidor', async (code, detail) => {
    const user = setup();
    await toConfirmWithError(user, { response: { status: 409, data: { code, detail } } });
    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /volver a subir el archivo/i })).toBeInTheDocument();
  });

  it('un 400 con bloqueantes muestra el detalle pero no obliga a subir de nuevo', async () => {
    const user = setup();
    await toConfirmWithError(user, { response: { status: 400, data: { code: 'blockers', detail: 'El libro tiene problemas bloqueantes.' } } });
    expect((await screen.findAllByText('El libro tiene problemas bloqueantes.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /volver a subir el archivo/i })).not.toBeInTheDocument();
  });

  it('un corte de red permite reintentar y la segunda vez funciona', async () => {
    const user = setup();
    importApi.confirmImport.mockRejectedValueOnce(new Error('timeout of 120000ms exceeded'));
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await toStep3(user);
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    expect(await screen.findByText('No se pudo completar la importación. Intente nuevamente.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    expect(await screen.findByRole('heading', { name: 'Importación completada' })).toBeInTheDocument();
    expect(importApi.confirmImport).toHaveBeenCalledTimes(2);
    expect(importApi.confirmImport.mock.calls[1][1].expectedPlanDigest).toBe('digest-abc');
  });
});

describe('ImportarPage — revisión', () => {
  it('«Subir otro archivo» descarta la previsualización pendiente y vuelve al paso 1', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /subir otro archivo/i }));
    expect(await screen.findByRole('heading', { name: /paso 1/i })).toBeInTheDocument();
    expect(importApi.cancelImport).toHaveBeenCalledWith(makeImport().id);
  });

  it('aunque falle descartar la previsualización, igual vuelve al paso 1', async () => {
    importApi.cancelImport.mockRejectedValue(new Error('boom'));
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /subir otro archivo/i }));
    expect(await screen.findByRole('heading', { name: /paso 1/i })).toBeInTheDocument();
  });

  it('si no se pudo cancelar, avisa y mantiene la revisión', async () => {
    importApi.cancelImport.mockRejectedValue({ response: { status: 409, data: { detail: 'Solo se puede cancelar una importación previsualizada.' } } });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /^cancelar importación$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^cancelar importación$/i }));
    expect(await screen.findByText('Solo se puede cancelar una importación previsualizada.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /paso 2/i })).toBeInTheDocument();
  });

  it('con más de 25 destinos muestra 25 y un botón para ver todos', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `dest-${i}`, display: `DESTINO PRUEBA ${i}`, rows: 1, candidates: 0 }));
    importApi.uploadImport.mockResolvedValue({ data: makeImport({ unmatched_destinations: many }) });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getAllByRole('button', { name: /^vincular el destino/i })).toHaveLength(25);
    await user.click(screen.getByRole('button', { name: 'Mostrar los 40 destinos' }));
    expect(screen.getAllByRole('button', { name: /^vincular el destino/i })).toHaveLength(40);
    await user.click(screen.getByRole('button', { name: 'Mostrar menos' }));
    expect(screen.getAllByRole('button', { name: /^vincular el destino/i })).toHaveLength(25);
  });

  it('un destino ambiguo se marca con el número de candidatos', async () => {
    importApi.uploadImport.mockResolvedValue({
      data: makeImport({ unmatched_destinations: [{ key: 'k', display: 'DESTINO DOBLE', rows: 2, candidates: 3 }] }),
    });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getByText('Ambiguo (3 trabajadores)')).toBeInTheDocument();
  });

  it('sin destinos ni proyectos no muestra esas secciones', async () => {
    importApi.uploadImport.mockResolvedValue({
      data: makeImport({
        unmatched_destinations: [],
        projects: [],
        requires: { accept_warnings: true, accept_skipped_rows: true, project_labels: [] },
      }),
    });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.queryByText(/destinos de egresos sin vincular/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/proyecto del libro/i)).not.toBeInTheDocument();
  });

  it('avisa de stock negativo proyectado', async () => {
    const imp = makeImport();
    imp.summary.stock = { ...imp.summary.stock, negative_items: 2 };
    importApi.uploadImport.mockResolvedValue({ data: imp });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getByText('2 ítems quedarían con stock negativo.')).toBeInTheDocument();
  });

  it('con un solo bloqueante lo dice en singular', async () => {
    const imp = makeImport({ can_confirm: false });
    imp.summary.counts = { ...imp.summary.counts, blocker: 1 };
    importApi.uploadImport.mockResolvedValue({ data: imp });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getByText(/1 problema bloqueante y no se puede importar/i)).toBeInTheDocument();
  });
});

describe('ImportarPage — tabla de problemas', () => {
  it('si no cargan los problemas ofrece reintentar', async () => {
    importApi.getImportProblems.mockRejectedValueOnce(new Error('boom'));
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(await screen.findByText('No se pudieron cargar los problemas.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText('El egreso no tiene N° de vale.')).toBeInTheDocument();
  });

  it('distingue «sin problemas» de «ningún problema coincide con los filtros»', async () => {
    importApi.getImportProblems.mockResolvedValue({ data: { count: 0, results: [], meta: { total: 0, truncated: false } } });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(await screen.findByText('El libro no tiene problemas.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Gravedad'), 'Error');
    expect(await screen.findByText('Ningún problema coincide con los filtros.')).toBeInTheDocument();
  });

  it('avisa cuando el servidor guardó solo los problemas más graves', async () => {
    importApi.getImportProblems.mockResolvedValue({
      data: { ...PROBLEMS.data, meta: { total: 7342, truncated: true } },
    });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(await screen.findByText(/el libro tiene 7342 problemas; se guardaron los más graves/i)).toBeInTheDocument();
  });

  it('cambiar un filtro vuelve a la página 1', async () => {
    importApi.getImportProblems.mockResolvedValue({
      data: { count: 45, results: PROBLEMS.data.results, meta: { total: 45, truncated: false } },
    });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await screen.findByText('El egreso no tiene N° de vale.');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(importApi.getImportProblems.mock.lastCall[1].page).toBe(2));
    await user.selectOptions(screen.getByLabelText('Gravedad'), 'Advertencia');
    await waitFor(() => expect(importApi.getImportProblems.mock.lastCall[1]).toMatchObject({ page: 1, severity: 'warning' }));
  });

  it('descarga el informe con los filtros activos y avisa si falla', async () => {
    download.downloadResponse.mockRejectedValueOnce(new Error('403'));
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await screen.findByText('El egreso no tiene N° de vale.');
    await user.selectOptions(screen.getByLabelText('Tipo de problema'), 'Egreso sin N° de vale (326)');
    await user.click(screen.getByRole('button', { name: /descargar informe de problemas/i }));
    await waitFor(() => expect(importApi.exportImportProblems).toHaveBeenCalledWith(makeImport().id, { code: 'VALE_VACIO' }));
    expect(await screen.findByText('No se pudo descargar el informe. Intente nuevamente.')).toBeInTheDocument();
  });
});

describe('ImportarPage — subida', () => {
  it('«Actualizar los ítems existentes» viaja al servidor', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await user.upload(await screen.findByLabelText(/arrastre el libro/i), xlsx());
    await user.click(screen.getByRole('checkbox', { name: /actualizar los datos de los ítems que ya existen/i }));
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    await waitFor(() => expect(importApi.uploadImport).toHaveBeenCalledWith(expect.any(File), { updateExisting: true }));
  });

  it('«Quitar archivo» olvida el libro y «Analizar» vuelve a pedirlo', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await user.upload(await screen.findByLabelText(/arrastre el libro/i), xlsx());
    await user.click(screen.getByRole('button', { name: /quitar archivo/i }));
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByText('Elija el libro de inventario (.xlsx).')).toBeInTheDocument();
    expect(importApi.uploadImport).not.toHaveBeenCalled();
  });

  it('un libro vacío (0 bytes) se rechaza sin llamar al servidor', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    const empty = new File([''], 'vacio.xlsx');
    await user.upload(await screen.findByLabelText(/arrastre el libro/i), empty);
    expect(await screen.findByText('El archivo está vacío.')).toBeInTheDocument();
  });

  it('el nombre con mayúsculas (.XLSX) se acepta', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await user.upload(await screen.findByLabelText(/arrastre el libro/i), xlsx('LIBRO.XLSX'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('LIBRO.XLSX')).toBeInTheDocument();
  });

  it('muestra el error del servidor cuando el libro es inválido y deja subir otro', async () => {
    importApi.uploadImport.mockRejectedValueOnce({ response: { status: 400, data: { code: 'ARCHIVO_INVALIDO', detail: 'El archivo no es un libro de Excel (.xlsx) válido.' } } });
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await user.upload(await screen.findByLabelText(/arrastre el libro/i), xlsx());
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByText('El archivo no es un libro de Excel (.xlsx) válido.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByRole('heading', { name: /paso 2/i })).toBeInTheDocument();
  });

  it('no sube dos veces si se pulsa de nuevo mientras analiza', async () => {
    let release;
    importApi.uploadImport.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await user.upload(await screen.findByLabelText(/arrastre el libro/i), xlsx());
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    await user.click(await screen.findByRole('button', { name: /analizando/i }));
    expect(importApi.uploadImport).toHaveBeenCalledTimes(1);
    release({ data: makeImport() });
    expect(await screen.findByRole('heading', { name: /paso 2/i })).toBeInTheDocument();
  });

  it('descarga la plantilla y avisa si falla', async () => {
    download.downloadResponse.mockRejectedValueOnce(new Error('x'));
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await user.click(await screen.findByRole('button', { name: /descargar plantilla/i }));
    expect(await screen.findByText('No se pudo descargar la plantilla. Intente nuevamente.')).toBeInTheDocument();
  });

  it('si el historial no carga, lo dice y no impide subir', async () => {
    importApi.getImports.mockRejectedValue(new Error('boom'));
    renderWithProviders(<ImportarPage />);
    expect(await screen.findByText('No se pudo cargar el historial.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analizar archivo/i })).toBeInTheDocument();
  });

  it('un historial sin importaciones lo dice', async () => {
    renderWithProviders(<ImportarPage />);
    expect(await screen.findByText('Todavía no se importó ningún libro.')).toBeInTheDocument();
  });
});
