import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeImport } from '../../test/almacenFixtures';
import ImportarPage from './ImportarPage';
import * as importApi from '../../api/almacenImport';
import * as almacenApi from '../../api/almacen';

vi.mock('../../api/almacenImport');
vi.mock('../../api/almacen');

// SYSPCC-025 · react-frontend ronda 1 — el asistente de importación mueve el foco entre pasos, anuncia
// lo que pasa, explica por qué no se puede continuar y usa nombres legibles para los problemas.

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

const RESULT = {
  catalog: { created: 254, updated: 0 },
  groups: { initial: 0, entries: 4, exits: 403 },
  movements: { initial: 0, entries: 239, exits: 459 },
  skipped: { rows_with_errors: 37, already_imported: 5 },
  stock_total: 6913,
  reconciled: true,
};

function xlsx(name = 'inventario.xlsx', size = 2048) {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const setup = () => userEvent.setup({ applyAccept: false });

// `user.upload` enfoca el input oculto y falsearía las pruebas de foco: se elige el archivo como en el navegador.
async function chooseFile(file = xlsx()) {
  const input = await screen.findByLabelText(/arrastre el libro/i);
  fireEvent.change(input, { target: { files: [file] } });
}

async function analyze(user) {
  await chooseFile();
  await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
  await screen.findByRole('heading', { name: /paso 2/i });
}

const pickProject = (user) => user.selectOptions(screen.getByRole('combobox', { name: /on plant/i }), 'No asignar proyecto');

beforeEach(() => {
  vi.clearAllMocks();
  importApi.getImports.mockResolvedValue({ data: { results: [] } });
  importApi.uploadImport.mockResolvedValue({ data: makeImport() });
  importApi.getImportProblems.mockResolvedValue(PROBLEMS);
  importApi.confirmImport.mockResolvedValue({ data: makeImport({ status: 'CONFIRMED', result: RESULT }), headers: {} });
  importApi.cancelImport.mockResolvedValue({ data: { status: 'CANCELLED' } });
  almacenApi.lookupPersonal.mockResolvedValue({ data: [] });
});

describe('Asistente de importación — foco entre pasos', () => {
  it('al abrir la página no roba el foco al título del paso 1', async () => {
    renderWithProviders(<ImportarPage />);
    const heading = await screen.findByRole('heading', { name: /paso 1/i });
    expect(heading).not.toHaveFocus();
  });

  it('«Analizar archivo» lleva el foco al título del paso 2', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: /paso 2/i })).toHaveFocus());
  });

  it('«Continuar» lleva el foco al título del paso 3 y «Volver» al del paso 2', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await pickProject(user);
    await user.click(screen.getByRole('button', { name: /continuar a la confirmación/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /paso 3/i })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: /volver a la revisión/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /paso 2/i })).toHaveFocus());
  });

  it('al volver a empezar («Subir otro archivo») el foco va al título del paso 1', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /subir otro archivo/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /paso 1/i })).toHaveFocus());
  });

  it('tras importar, el título del resultado recibe el foco y describe los totales reales', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await pickProject(user);
    await user.click(screen.getByRole('button', { name: /continuar a la confirmación/i }));
    await user.click(await screen.findByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
    await user.click(screen.getByRole('checkbox', { name: /entiendo que se omitirán/i }));
    await user.click(screen.getByRole('button', { name: /^importar$/i }));

    const heading = await screen.findByRole('heading', { name: 'Importación completada' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAccessibleDescription(/254 ítems, 407 vales, 698 movimientos\. 37 filas omitidas\. 5 filas ya estaban importadas/i);
  });
});

describe('Asistente de importación — paso 1', () => {
  it('anuncia el archivo elegido en una región viva que ya estaba montada', async () => {
    renderWithProviders(<ImportarPage />);
    await screen.findByLabelText(/arrastre el libro/i);
    const live = screen.getAllByRole('status').find((el) => el.className.includes('sr-only'));
    expect(live).toBeDefined();
    expect(live).toHaveTextContent('');

    await chooseFile(xlsx('inventario_pcc.xlsx', 2048));
    await waitFor(() => expect(live).toHaveTextContent('Archivo elegido: inventario_pcc.xlsx, 2'));
  });

  it('anuncia que está analizando', async () => {
    const user = setup();
    let release;
    importApi.uploadImport.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderWithProviders(<ImportarPage />);
    await chooseFile();
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    await waitFor(() => expect(screen.getAllByRole('status').some((el) => /analizando el archivo…/i.test(el.textContent))).toBe(true));
    release({ data: makeImport() });
    await screen.findByRole('heading', { name: /paso 2/i });
  });
});

describe('Asistente de importación — indicador de pasos', () => {
  it('el paso hecho lleva un ✓, el actual está marcado y se lee «(completado)» / «(paso actual)»', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    const steps = within(screen.getByRole('list', { name: /pasos de la importación/i })).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('Subir archivo (completado)');
    expect(steps[0].querySelector('svg')).not.toBeNull();
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toHaveTextContent('Revisar (paso actual)');
    expect(steps[1].querySelector('svg')).toBeNull();
    expect(steps[2].querySelector('svg')).toBeNull();
  });
});

describe('Asistente de importación — paso 2', () => {
  it('sin elegir proyecto «Continuar» queda desactivado, dice por qué y el campo se marca inválido', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    const next = screen.getByRole('button', { name: /continuar a la confirmación/i });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Para continuar, elija el proyecto del libro.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /on plant/i })).toBeInvalid();

    await pickProject(user);
    expect(next).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText('Para continuar, elija el proyecto del libro.')).not.toBeInTheDocument();
  });

  it('con problemas bloqueantes el motivo también se muestra junto al botón', async () => {
    const user = setup();
    importApi.uploadImport.mockResolvedValue({
      data: makeImport({ can_confirm: false, summary: { ...makeImport().summary, counts: { blocker: 2, error: 0, warning: 0, info: 0 } } }),
    });
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getByText('No se puede continuar: el libro tiene problemas bloqueantes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuar a la confirmación/i })).toHaveAccessibleDescription(/problemas bloqueantes/i);
  });

  it('resume primero «¿Se puede importar?»', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    expect(screen.getByText(/¿se puede importar\? sí/i)).toBeInTheDocument();
  });

  it('los problemas se rotulan con un nombre legible y el código queda como dato secundario', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    const table = await screen.findByRole('table', { name: /problemas encontrados/i });
    const valeRow = within(table).getByText('El egreso no tiene N° de vale.').closest('tr');
    expect(within(valeRow).getByText('Egreso sin N° de vale')).toBeInTheDocument();
    expect(within(valeRow).getByText('VALE_VACIO')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Tipo de problema' })).toBeInTheDocument();
  });

  it('el filtro de tipos usa los nombres legibles y los cambios se anuncian', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await screen.findByRole('table', { name: /problemas encontrados/i });

    const select = screen.getByLabelText('Tipo de problema');
    expect(within(select).getByRole('option', { name: 'Egreso sin N° de vale (326)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Cantidad vacía (13)' })).toBeInTheDocument();

    await user.selectOptions(select, 'Egreso sin N° de vale (326)');
    const announcer = await screen.findByText(/mostrando 2 problemas\./i, {}, { timeout: 2000 });
    expect(announcer.closest('[role="status"]')).not.toBeNull();
  });
});

describe('Asistente de importación — vincular destinos con el teclado', () => {
  const WORKER = { id: 7, full_name: 'Apellido Prueba Siete', position: 'Operario', project_code: 'OP' };

  it('«Vincular» abre la búsqueda ya enfocada y «Cancelar» devuelve el foco a «Vincular»', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);

    await user.click(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i }));
    const search = screen.getByRole('combobox', { name: /trabajador para el destino/i });
    expect(search).toHaveFocus();

    await user.click(screen.getByRole('button', { name: /^cancelar$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i })).toHaveFocus());
  });

  it('tras vincular el foco pasa a «Dejar como texto» y al desvincular vuelve a «Vincular»', async () => {
    const user = setup();
    almacenApi.lookupPersonal.mockResolvedValue({ data: [WORKER] });
    renderWithProviders(<ImportarPage />);
    await analyze(user);

    await user.click(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i }));
    await user.type(screen.getByRole('combobox', { name: /trabajador para el destino/i }), 'Siete');
    await user.click(await screen.findByRole('option', { name: /apellido prueba siete/i }));

    const unlink = await screen.findByRole('button', { name: /dejar como texto/i });
    await waitFor(() => expect(unlink).toHaveFocus());

    await user.click(unlink);
    await waitFor(() => expect(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i })).toHaveFocus());
  });

  it('el campo de búsqueda explica el mínimo de 3 letras con texto visible', async () => {
    const user = setup();
    renderWithProviders(<ImportarPage />);
    await analyze(user);
    await user.click(screen.getByRole('button', { name: /vincular el destino apellido prueba uno/i }));
    expect(screen.getByRole('combobox', { name: /trabajador para el destino/i })).toHaveAccessibleDescription(/al menos 3 letras/i);
  });
});
