import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeImport } from '../../test/almacenFixtures';
import ImportarPage from './ImportarPage';
import * as importApi from '../../api/almacenImport';
import * as almacenApi from '../../api/almacen';

vi.mock('../../api/almacenImport');
vi.mock('../../api/almacen');

const PROBLEMS = {
  data: {
    count: 2,
    results: [
      { code: 'CANTIDAD_VACIA', severity: 'error', sheet: 'INGRESOS', row: 23, message: 'La cantidad está vacía.' },
      { code: 'VALE_VACIO', severity: 'warning', sheet: 'EGRESOS', row: 12, message: 'El egreso no tiene N° de vale.' },
    ],
    meta: { total: 2, truncated: false },
  },
};

// Forma REAL de `POST imports/{id}/confirm/` -> `result` (apps/warehouse/services/imports/applier.py):
// `groups`, `movements` y `skipped` son objetos, no números (defecto QA-11).
const RESULT = {
  catalog: { created: 254, updated: 0 },
  groups: { initial: 0, entries: 4, exits: 403 },
  movements: { initial: 0, entries: 239, exits: 459 },
  skipped: { rows_with_errors: 37, already_imported: 0 },
  stock_total: 6913,
  reconciled: false,
};

function xlsx(name = 'inventario.xlsx', size = 2048) {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const setup = () => userEvent.setup({ applyAccept: false });

async function upload(user, file = xlsx()) {
  await user.upload(await screen.findByLabelText(/arrastre el libro/i), file);
}

async function analyze(user, file) {
  await upload(user, file);
  await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
  await screen.findByRole('heading', { name: /paso 2/i });
}

/** Pasa al paso 3 eligiendo "No asignar proyecto" (sin proyecto elegido el paso 2 no deja continuar). */
async function toConfirmStep(user) {
  await user.selectOptions(screen.getByRole('combobox', { name: /on plant/i }), 'No asignar proyecto');
  await user.click(screen.getByRole('button', { name: /continuar a la confirmación/i }));
  await screen.findByRole('heading', { name: /paso 3/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  importApi.getImports.mockResolvedValue({ data: { results: [] } });
  importApi.uploadImport.mockResolvedValue({ data: makeImport() });
  importApi.getImportProblems.mockResolvedValue(PROBLEMS);
  importApi.confirmImport.mockResolvedValue({ data: makeImport({ status: 'CONFIRMED', result: RESULT }), headers: {} });
  importApi.cancelImport.mockResolvedValue({ data: { status: 'CANCELLED' } });
  almacenApi.lookupPersonal.mockResolvedValue({ data: [] });
});

describe('ImportarPage — paso 1 (subir)', () => {
  it('rechaza .xlsm y .xls sin llamar al servidor', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await upload(user, xlsx('libro.xlsm'));
    expect(await screen.findByText(/los archivos \.xlsm no se admiten/i)).toBeInTheDocument();
    await upload(user, xlsx('libro.xls'));
    expect(await screen.findByText(/los archivos \.xls no se admiten/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(importApi.uploadImport).not.toHaveBeenCalled();
  });

  it('rechaza archivos de más de 10 MB y de otro formato', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await upload(user, xlsx('grande.xlsx', 10 * 1024 * 1024 + 1));
    expect(await screen.findByText('El archivo supera los 10 MB.')).toBeInTheDocument();
    await upload(user, xlsx('datos.csv'));
    expect(await screen.findByText('El archivo debe ser un libro de Excel (.xlsx).')).toBeInTheDocument();
  });

  it('sin archivo, "Analizar archivo" pide elegir el libro', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await screen.findByLabelText(/arrastre el libro/i);
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByText('Elija el libro de inventario (.xlsx).')).toBeInTheDocument();
    expect(importApi.uploadImport).not.toHaveBeenCalled();
  });

  it('sube el libro válido y pasa a la revisión (sin guardar nada)', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    const file = xlsx();
    await analyze(user, file);
    expect(importApi.uploadImport).toHaveBeenCalledWith(file, { updateExisting: false });
    expect(importApi.confirmImport).not.toHaveBeenCalled();
    expect(screen.getByText(/todavía no se guardó nada/i)).toBeInTheDocument();
  });

  it('traduce los errores de subida (límite por hora, libro ya importado)', async () => {
    const user = setup();
    importApi.uploadImport.mockRejectedValueOnce({ response: { status: 429, data: {} } });
    renderWithProviders(<ImportarPage />);
    await upload(user);
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByText(/máximo 10 por hora/i)).toBeInTheDocument();

    importApi.uploadImport.mockRejectedValueOnce({ response: { status: 409, data: { code: 'file_already_imported', detail: 'x' } } });
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByText(/este libro ya se importó antes/i)).toBeInTheDocument();
  });

  it('muestra el historial reciente', async () => {
    importApi.getImports.mockResolvedValue({
      data: { results: [{ id: 'a', status: 'CONFIRMED', uploaded_by_name: 'Usuario de prueba', created_at: '2026-10-16T10:00:00-05:00' }] },
    });
    renderWithProviders(<ImportarPage />);
    expect(await screen.findByText('Confirmada')).toBeInTheDocument();
    expect(screen.getByText(/16\/10\/2026 · Usuario de prueba/)).toBeInTheDocument();
  });
});

describe('ImportarPage — paso 2 (revisar)', () => {
  it('resume lo que se importaría y lista los problemas', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);

    const summary = screen.getByText('Ingresos a importar').closest('dl');
    expect(within(summary).getByText('Ingresos a importar').nextElementSibling).toHaveTextContent('239');
    expect(within(summary).getByText('Egresos a importar').nextElementSibling).toHaveTextContent('459');
    expect(within(summary).getByText('Con errores').nextElementSibling).toHaveTextContent('37');
    expect(within(summary).getByText('Con advertencias').nextElementSibling).toHaveTextContent(/967/);

    const table = await screen.findByRole('table', { name: /problemas encontrados/i });
    expect(within(table).getByText('La cantidad está vacía.')).toBeInTheDocument();
    expect(within(table).getByText('La fila se omite', { exact: false })).toBeInTheDocument();
    expect(within(table).getByText('Advertencia')).toBeInTheDocument();
  });

  it('filtra los problemas por gravedad, hoja y código y descarga el informe', async () => {
    const user = setup();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    importApi.exportImportProblems.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await screen.findByRole('table', { name: /problemas encontrados/i });

    await user.selectOptions(screen.getByLabelText('Gravedad'), 'Error');
    await waitFor(() => expect(importApi.getImportProblems).toHaveBeenLastCalledWith(makeImport().id, { severity: 'error', page: 1, page_size: 20 }));
    await user.selectOptions(screen.getByLabelText('Hoja'), 'EGRESOS');
    await user.selectOptions(screen.getByLabelText('Tipo de problema'), 'Egreso sin N° de vale (326)');
    await waitFor(() => expect(importApi.getImportProblems).toHaveBeenLastCalledWith(
      makeImport().id, { severity: 'error', sheet: 'EGRESOS', code: 'VALE_VACIO', page: 1, page_size: 20 },
    ));

    await user.click(screen.getByRole('button', { name: /descargar informe de problemas/i }));
    await waitFor(() => expect(importApi.exportImportProblems).toHaveBeenCalledWith(
      makeImport().id, { severity: 'error', sheet: 'EGRESOS', code: 'VALE_VACIO' },
    ));
  });

  it('con problemas bloqueantes no se puede continuar', async () => {
    const user = setup();
    importApi.uploadImport.mockResolvedValue({
      data: makeImport({ can_confirm: false, summary: { ...makeImport().summary, counts: { blocker: 1, error: 0, warning: 0, info: 0 } } }),
    });
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getByText(/1 problema bloqueante y no se puede importar/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continuar a la confirmación/i }));
    expect(screen.queryByRole('heading', { name: /paso 3/i })).not.toBeInTheDocument();
  });

  it('un proyecto con coincidencia única se preselecciona; sin coincidencia explica qué hacer', async () => {
    const user = setup();
    importApi.uploadImport.mockResolvedValue({
      data: makeImport({ projects: [{ label: 'ON PLANT', items: 251, matches: [{ id: 4, code: 'OP', name: 'ON PLANT' }], suggested_id: 4 }] }),
    });
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getByRole('combobox', { name: /on plant/i })).toHaveValue('4');
  });

  it('sin coincidencia pide crear el proyecto o elegir «No asignar proyecto»', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getByText(/pida a un administrador crearlo en sistema → proyectos/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /on plant/i })).toHaveValue('');
  });

  it('permite vincular un destino con un trabajador de Personal', async () => {
    const user = setup();
    almacenApi.lookupPersonal.mockResolvedValue({ data: [{ id: 7, full_name: 'Apellido Prueba Siete', position: 'Operario', project_code: 'OP' }] });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderWithProviders(<ImportarPage />);
    await analyze(user);

    expect(screen.getByText('APELLIDO PRUEBA UNO')).toBeInTheDocument();
    expect(screen.getByText('Sin coincidencia')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i }));
    await user.type(screen.getByRole('combobox', { name: /trabajador para el destino/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));
    expect(screen.getByText('Vinculado a Apellido Prueba Siete')).toBeInTheDocument();

    await toConfirmStep(user);
    expect(screen.getByText(/1 destino se vinculará a personal/i)).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled(); // los nombres no van al almacenamiento del navegador
  });
});

describe('ImportarPage — paso 3 (confirmar)', () => {
  async function toStep3(user) {
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await toConfirmStep(user);
  }

  it('bloquea "Importar" hasta aceptar las advertencias y las filas omitidas', async () => {
    const user = setup();
    await toStep3(user);
    const button = screen.getByRole('button', { name: /^importar$/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(importApi.confirmImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se omitirán 37 filas con errores/i }));
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });

  it('no deja continuar sin elegir el proyecto y dice por qué', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    const next = screen.getByRole('button', { name: /continuar a la confirmación/i });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveAccessibleDescription(/elija el proyecto del libro/i);
    const select = screen.getByRole('combobox', { name: /on plant/i });
    expect(select).toBeInvalid();
    expect(select).toHaveAccessibleDescription(/elija una opción para poder continuar/i);

    await user.click(next);
    expect(screen.queryByRole('heading', { name: /paso 3/i })).not.toBeInTheDocument();

    await user.selectOptions(select, 'No asignar proyecto');
    expect(next).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText(/elija una opción para poder continuar/i)).not.toBeInTheDocument();
  });

  it('no pide casillas cuando el servidor no las exige', async () => {
    const user = setup();
    importApi.uploadImport.mockResolvedValue({
      data: makeImport({ requires: { accept_warnings: false, accept_skipped_rows: false, project_labels: [] }, projects: [], unmatched_destinations: [] }),
    });
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /continuar a la confirmación/i }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^importar$/i })).toHaveAttribute('aria-disabled', 'false');
  });

  it('confirma con el digest, el mapa de proyectos y las aceptaciones y anuncia el resultado', async () => {
    const user = setup();
    await toStep3(user);
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se omitirán/i }));
    await user.click(screen.getByRole('button', { name: /^importar$/i }));

    await waitFor(() => expect(importApi.confirmImport).toHaveBeenCalledTimes(1));
    expect(importApi.confirmImport).toHaveBeenCalledWith(makeImport().id, {
      expectedPlanDigest: 'digest-abc',
      projectMap: { 'ON PLANT': null },
      destinationMap: {},
      acceptWarnings: true,
      acceptSkippedRows: true,
    });

    const status = await screen.findByRole('status', { name: '' });
    expect(status).toHaveTextContent('Importación completada: 254 ítems, 407 vales, 698 movimientos. 37 filas omitidas.');
    expect(screen.getByText(/difiere del del libro/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver resumen de movimiento/i })).toHaveAttribute('href', '/almacen/resumen');
    expect(screen.getByRole('link', { name: /ítems pendientes de ubicar/i })).toHaveAttribute('href', '/almacen/inventario?pendientes=1');
    // Ya confirmada: los nombres de los destinos dejan de mostrarse.
    expect(screen.queryByText('APELLIDO PRUEBA UNO')).not.toBeInTheDocument();
  });

  it('no confirma dos veces si se pulsa de nuevo mientras importa', async () => {
    const user = setup();
    let release;
    importApi.confirmImport.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await toStep3(user);
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se omitirán/i }));
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    await user.click(await screen.findByRole('button', { name: /importando/i }));
    expect(importApi.confirmImport).toHaveBeenCalledTimes(1);
    release({ data: makeImport({ status: 'CONFIRMED', result: RESULT }), headers: {} });
    expect(await screen.findByText(/importación completada: 254 ítems/i)).toBeInTheDocument();
  });

  it('si el plan cambió, explica y obliga a volver a subir el archivo', async () => {
    const user = setup();
    importApi.confirmImport.mockRejectedValue({ response: { status: 409, data: { code: 'plan_changed', detail: 'x' } } });
    await toStep3(user);
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se omitirán/i }));
    await user.click(screen.getByRole('button', { name: /^importar$/i }));

    expect(await screen.findByText(/el inventario cambió desde que se previsualizó/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^importar$/i })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: /volver a subir el archivo/i }));
    expect(await screen.findByLabelText(/arrastre el libro/i)).toBeInTheDocument();
  });

  it('muestra el detalle del servidor ante otros errores de confirmación', async () => {
    const user = setup();
    importApi.confirmImport.mockRejectedValue({ response: { status: 400, data: { code: 'project_map_required', detail: 'Indique el proyecto de la etiqueta ON PLANT.' } } });
    await toStep3(user);
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se omitirán/i }));
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    expect(await screen.findByText('Indique el proyecto de la etiqueta ON PLANT.')).toBeInTheDocument();
  });

  it('una importación ya confirmada (replay) lo indica', async () => {
    const user = setup();
    importApi.confirmImport.mockResolvedValue({
      data: makeImport({ status: 'CONFIRMED', result: RESULT }), headers: { 'idempotent-replay': 'true' },
    });
    await toStep3(user);
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se omitirán/i }));
    await user.click(screen.getByRole('button', { name: /^importar$/i }));
    expect(await screen.findByRole('heading', { name: /esta importación ya estaba confirmada/i })).toBeInTheDocument();
  });
});

describe('ImportarPage — cancelar', () => {
  it('pide confirmación, cancela en el servidor y vuelve al paso 1', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /^cancelar importación$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/no se guardó ningún dato/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^cancelar importación$/i }));

    await waitFor(() => expect(importApi.cancelImport).toHaveBeenCalledWith(makeImport().id));
    expect(await screen.findByLabelText(/arrastre el libro/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('"Seguir revisando" cierra el diálogo sin cancelar', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /^cancelar importación$/i }));
    await user.click(await screen.findByRole('button', { name: /seguir revisando/i }));
    expect(importApi.cancelImport).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /paso 2/i })).toBeInTheDocument();
  });
});
