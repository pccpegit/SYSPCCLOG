import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import UploadStep from './UploadStep';
import * as importApi from '../../../api/almacenImport';
import { makeImport } from '../../../test/almacenFixtures';

vi.mock('../../../api/almacenImport');

function workbook(name = 'inventario.xlsx', size = 2048) {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

// The label's text changes while dragging, so it is found by the input it belongs to.
const dropZone = () => document.querySelector('label[for="import-file"]');

/** jsdom has no DataTransfer: a plain object with the parts the hook reads. */
function drop(files) {
  const dataTransfer = { types: ['Files'], files, items: [] };
  fireEvent.dragEnter(dropZone(), { dataTransfer });
  fireEvent.drop(dropZone(), { dataTransfer });
}

beforeEach(() => {
  vi.clearAllMocks();
  importApi.getImports.mockResolvedValue({ data: { results: [] } });
  importApi.uploadImport.mockResolvedValue({ data: makeImport() });
});

describe('UploadStep — arrastrar y soltar', () => {
  it('al arrastrar un archivo cambia el texto (no solo el color) y al soltar lo elige', async () => {
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');

    const dataTransfer = { types: ['Files'], files: [], items: [] };
    fireEvent.dragEnter(dropZone(), { dataTransfer });
    expect(screen.getByText('Suelte el libro para analizarlo')).toBeInTheDocument();

    drop([workbook('inventario.xlsx')]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/archivo elegido: inventario\.xlsx/i));
    expect(screen.queryByText('Suelte el libro para analizarlo')).not.toBeInTheDocument();
  });

  it('arrastrar algo que no es un archivo no activa la zona', async () => {
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    fireEvent.dragEnter(dropZone(), { dataTransfer: { types: ['text/plain'], files: [], items: [] } });
    expect(screen.queryByText('Suelte el libro para analizarlo')).not.toBeInTheDocument();
  });

  it('salir de la zona con el archivo vuelve al texto normal', async () => {
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    const dataTransfer = { types: ['Files'], files: [], items: [] };
    fireEvent.dragEnter(dropZone(), { dataTransfer });
    fireEvent.dragLeave(dropZone(), { dataTransfer });
    expect(screen.queryByText('Suelte el libro para analizarlo')).not.toBeInTheDocument();
  });

  it('el evento dragover sobre archivos se cancela para permitir soltar', async () => {
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    const event = createEvent.dragOver(dropZone(), { dataTransfer: { types: ['Files'], files: [], items: [] } });
    fireEvent(dropZone(), event);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['libro.xlsm', /los archivos \.xlsm no se admiten/i],
    ['libro.xls', /los archivos \.xls no se admiten/i],
    ['notas.csv', /debe ser un libro de excel \(\.xlsx\)/i],
  ])('rechaza %s al soltarlo y no llama al servidor', async (name, message) => {
    const user = userEvent.setup();
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    drop([workbook(name)]);
    expect(await screen.findByText(message)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(importApi.uploadImport).not.toHaveBeenCalled();
  });

  it('rechaza un libro vacío o de más de 10 MB', async () => {
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    drop([workbook('vacio.xlsx', 0)]);
    expect(await screen.findByText('El archivo está vacío.')).toBeInTheDocument();
    drop([workbook('enorme.xlsx', 11 * 1024 * 1024)]);
    expect(await screen.findByText('El archivo supera los 10 MB.')).toBeInTheDocument();
  });

  it('si se sueltan varios archivos toma solo el primero', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    const first = workbook('primero.xlsx');
    drop([first, workbook('segundo.xlsx')]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/primero\.xlsx/));
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    await waitFor(() => expect(importApi.uploadImport).toHaveBeenCalledTimes(1));
    expect(importApi.uploadImport.mock.calls[0][0]).toBe(first);
  });

  it('un archivo válido tras uno inválido borra el error', async () => {
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    drop([workbook('mal.xls')]);
    expect(await screen.findByText(/los archivos \.xls no se admiten/i)).toBeInTheDocument();
    drop([workbook('bien.xlsx')]);
    await waitFor(() => expect(screen.queryByText(/los archivos \.xls no se admiten/i)).not.toBeInTheDocument());
  });
});

describe('UploadStep — análisis', () => {
  it('sin archivo, «Analizar» explica qué falta y no llama al servidor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByText('Elija el libro de inventario (.xlsx).')).toBeInTheDocument();
    expect(screen.getByLabelText(/arrastre el libro/i)).toHaveAttribute('aria-invalid', 'true');
    expect(importApi.uploadImport).not.toHaveBeenCalled();
  });

  it('envía la opción «actualizar los ítems que ya existen» solo si se marca', async () => {
    const user = userEvent.setup();
    const onPreviewed = vi.fn();
    renderWithProviders(<UploadStep onPreviewed={onPreviewed} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    drop([workbook()]);
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    await waitFor(() => expect(onPreviewed).toHaveBeenCalledTimes(1));
    expect(importApi.uploadImport.mock.calls[0][1]).toMatchObject({ updateExisting: false });

    await user.click(screen.getByRole('checkbox', { name: /actualizar los datos de los ítems que ya existen/i }));
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    await waitFor(() => expect(importApi.uploadImport).toHaveBeenCalledTimes(2));
    expect(importApi.uploadImport.mock.calls[1][1]).toMatchObject({ updateExisting: true });
  });

  it('mientras analiza anuncia el avance, no deja soltar otro archivo ni analizar dos veces', async () => {
    const user = userEvent.setup();
    importApi.uploadImport.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    drop([workbook()]);
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Analizando el archivo…');

    await user.click(screen.getByRole('button', { name: /analizando el archivo/i }));
    expect(importApi.uploadImport).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/arrastre el libro/i)).toBeDisabled();
  });

  it.each([
    [{ response: { status: 429, data: {} } }, /demasiadas subidas seguidas/i],
    [{ response: { status: 409, data: { code: 'file_already_imported' } } }, /ya se importó antes/i],
    [{ response: { status: 400, data: { code: 'ARCHIVO_INVALIDO', detail: 'El archivo no es un libro de Excel (.xlsx) válido.' } } }, /no es un libro de excel/i],
    [new Error('red caída'), /no se pudo analizar el archivo/i],
  ])('muestra un mensaje claro cuando falla el análisis (%#)', async (failure, message) => {
    const user = userEvent.setup();
    importApi.uploadImport.mockRejectedValue(failure);
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    drop([workbook()]);
    await user.click(screen.getByRole('button', { name: /analizar archivo/i }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    // the screen recovers: the button can be used again
    expect(screen.getByRole('button', { name: /analizar archivo/i })).toBeInTheDocument();
  });

  it('«Quitar archivo» olvida el archivo elegido', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    drop([workbook('inventario.xlsx')]);
    await user.click(await screen.findByRole('button', { name: /quitar archivo/i }));
    expect(screen.queryByRole('button', { name: /quitar archivo/i })).not.toBeInTheDocument();
  });
});

describe('UploadStep — historial reciente', () => {
  it('lista las últimas importaciones con su estado en texto', async () => {
    importApi.getImports.mockResolvedValue({
      data: {
        results: [
          { id: 'a', status: 'CONFIRMED', created_at: '2026-10-16T10:00:00Z', uploaded_by_name: 'Usuario Prueba' },
          { id: 'b', status: 'EXPIRED', created_at: '2026-10-15T10:00:00Z', uploaded_by_name: '' },
          { id: 'c', status: 'ALGO_NUEVO', created_at: '2026-10-14T10:00:00Z', uploaded_by_name: 'Otra Persona' },
        ],
      },
    });
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    expect(await screen.findByText('Confirmada')).toBeInTheDocument();
    expect(screen.getByText('Vencida')).toBeInTheDocument();
    expect(screen.getByText('ALGO_NUEVO')).toBeInTheDocument();           // an unknown status is shown as is, never hidden
    expect(screen.getByText(/· Usuario$/)).toBeInTheDocument();           // a missing name falls back to "Usuario"
  });

  it('si el historial falla, el resto del paso sigue usable', async () => {
    importApi.getImports.mockRejectedValue(new Error('boom'));
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    expect(await screen.findByText('No se pudo cargar el historial.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analizar archivo/i })).toBeInTheDocument();
  });
});

describe('UploadStep — aviso de filas ya importadas', () => {
  it('advierte antes de subir que las filas ya importadas no se actualizan y cómo corregirlas', async () => {
    renderWithProviders(<UploadStep onPreviewed={() => {}} />);
    await screen.findByText('Todavía no se importó ningún libro.');
    expect(screen.getByText('Importe el libro cuando esté completo.')).toBeInTheDocument();
    expect(screen.getByText(/las filas ya importadas no se actualizan/i)).toBeInTheDocument();
    expect(screen.getByText(/registre un ajuste en el sistema/i)).toBeInTheDocument();
  });
});
