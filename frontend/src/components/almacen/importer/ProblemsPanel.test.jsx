import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import ProblemsPanel from './ProblemsPanel';
import * as importApi from '../../../api/almacenImport';

vi.mock('../../../api/almacenImport');

// SYSPCC-025 · QA ronda 2 — tabla de problemas del libro: filtros, vacíos, errores y datos incompletos.
// Los mensajes del servidor nunca citan celdas; aquí tampoco hay nombres.

const SUMMARY = {
  sheets: { INGRESOS: { rows: 10 }, EGRESOS: { rows: 20 } },
  by_code: { VALE_VACIO: 12, FECHA_VACIA: 3 },
};

const problem = (overrides = {}) => ({
  code: 'VALE_VACIO', severity: 'warning', sheet: 'EGRESOS', row: 5, message: 'El egreso no trae N° de vale.', ...overrides,
});

const reply = (results, extra = {}) => ({ data: { count: results.length, results, meta: { total: results.length, truncated: false }, ...extra } });
const lastParams = () => importApi.getImportProblems.mock.lastCall[1];

const view = (props = {}) => renderWithProviders(<ProblemsPanel importId="imp-1" summary={SUMMARY} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  importApi.getImportProblems.mockResolvedValue(reply([problem()]));
});

describe('ProblemsPanel — filas', () => {
  it('muestra hoja, fila, gravedad, tipo y qué se hará con cada problema', async () => {
    view();
    const table = await screen.findByRole('table', { name: /problemas encontrados en el libro/i });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('EGRESOS')).toBeInTheDocument();
    expect(within(row).getByText('5')).toBeInTheDocument();
    expect(within(row).getByText('Advertencia')).toBeInTheDocument();
    expect(within(row).getByText('VALE_VACIO')).toBeInTheDocument();
    expect(within(row).getByText('El egreso no trae N° de vale.')).toBeInTheDocument();
    expect(within(row).getByText('Se importa con marca')).toBeInTheDocument();
  });

  it('un problema sin hoja ni fila (de todo el libro) muestra rayas, no «undefined»', async () => {
    importApi.getImportProblems.mockResolvedValue(reply([problem({ sheet: '', row: null, code: 'FILAS_IMPORTADAS_AUSENTES', message: 'Faltan filas.' })]));
    view();
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(table.textContent).not.toMatch(/undefined|null/);
  });

  it('una gravedad desconocida se trata como informativa en vez de romper la tabla', async () => {
    importApi.getImportProblems.mockResolvedValue(reply([problem({ severity: 'critical' })]));
    view();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Informativo')).toBeInTheDocument();
    expect(within(table).getByText('Solo informativo')).toBeInTheDocument();
  });

  it('la fila 0 se muestra como 0, no como raya', async () => {
    importApi.getImportProblems.mockResolvedValue(reply([problem({ row: 0 })]));
    view();
    const row = within(await screen.findByRole('table')).getAllByRole('row')[1];
    expect(within(row).getByText('0')).toBeInTheDocument();
  });

  it('avisa cuando el servidor recortó la lista a los problemas más graves', async () => {
    importApi.getImportProblems.mockResolvedValue(reply([problem()], { meta: { total: 5000, truncated: true } }));
    view();
    expect(await screen.findByText(/el libro tiene 5000 problemas; se guardaron los más graves/i)).toBeInTheDocument();
  });
});

describe('ProblemsPanel — estados', () => {
  it('sin problemas lo dice', async () => {
    importApi.getImportProblems.mockResolvedValue(reply([]));
    view();
    expect(await screen.findByText('El libro no tiene problemas.')).toBeInTheDocument();
  });

  it('con filtros activos y sin coincidencias lo dice distinto', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByRole('table');
    importApi.getImportProblems.mockResolvedValue(reply([]));
    await user.selectOptions(screen.getByLabelText('Gravedad'), 'Bloqueante');
    expect(await screen.findByText('Ningún problema coincide con los filtros.')).toBeInTheDocument();
  });

  it('el error se avisa y «Reintentar» vuelve a pedir los problemas', async () => {
    const user = userEvent.setup();
    importApi.getImportProblems.mockRejectedValueOnce(new Error('boom'));
    view();
    expect(await screen.findByText('No se pudieron cargar los problemas.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('ProblemsPanel — filtros', () => {
  it('gravedad, hoja y tipo viajan al servidor y vuelven a la página 1', async () => {
    const user = userEvent.setup();
    importApi.getImportProblems.mockResolvedValue({ data: { count: 60, results: [problem()], meta: { total: 60, truncated: false } } });
    view();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }));

    await user.selectOptions(screen.getByLabelText('Gravedad'), 'Error');
    await waitFor(() => expect(lastParams()).toMatchObject({ severity: 'error', page: 1 }));
    await user.selectOptions(screen.getByLabelText('Hoja'), 'EGRESOS');
    await waitFor(() => expect(lastParams()).toMatchObject({ severity: 'error', sheet: 'EGRESOS' }));
    await user.selectOptions(screen.getByLabelText('Tipo de problema'), 'VALE_VACIO');
    await waitFor(() => expect(lastParams()).toMatchObject({ severity: 'error', sheet: 'EGRESOS', code: 'VALE_VACIO' }));
  });

  it('volver a «Todas» quita el parámetro', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Hoja'), 'INGRESOS');
    await waitFor(() => expect(lastParams()).toMatchObject({ sheet: 'INGRESOS' }));
    await user.selectOptions(screen.getByLabelText('Hoja'), 'Todas');
    await waitFor(() => expect(lastParams()).not.toHaveProperty('sheet'));
  });

  it('las opciones de hoja y de tipo salen del resumen del libro, con el conteo de cada tipo', async () => {
    view();
    await screen.findByRole('table');
    expect(within(screen.getByLabelText('Hoja')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todas', 'INGRESOS', 'EGRESOS']);
    const types = within(screen.getByLabelText('Tipo de problema')).getAllByRole('option').map((o) => o.textContent);
    expect(types[0]).toBe('Todos');
    expect(types.some((t) => /\(12\)$/.test(t))).toBe(true);
    expect(types.some((t) => /\(3\)$/.test(t))).toBe(true);
  });

  it('sin resumen no hay opciones de hoja ni de tipo y no se rompe', async () => {
    view({ summary: undefined });
    await screen.findByRole('table');
    expect(within(screen.getByLabelText('Hoja')).getAllByRole('option')).toHaveLength(1);
    expect(within(screen.getByLabelText('Tipo de problema')).getAllByRole('option')).toHaveLength(1);
  });
});

describe('ProblemsPanel — informe descargable', () => {
  it('pide el informe con los mismos filtros que la tabla', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    importApi.exportImportProblems.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    view();
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Gravedad'), 'Advertencia');
    await waitFor(() => expect(lastParams()).toMatchObject({ severity: 'warning' }));
    await user.click(screen.getByRole('button', { name: /descargar informe de problemas/i }));
    await waitFor(() => expect(importApi.exportImportProblems).toHaveBeenCalledWith('imp-1', { severity: 'warning' }));
  });

  it('si la descarga falla avisa y la pantalla sigue usable', async () => {
    const user = userEvent.setup();
    importApi.exportImportProblems.mockRejectedValue(new Error('boom'));
    view();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /descargar informe de problemas/i }));
    expect(await screen.findByText('No se pudo descargar el informe. Intente nuevamente.')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
