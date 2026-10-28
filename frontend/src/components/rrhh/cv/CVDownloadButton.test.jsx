import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import CVDownloadButton from './CVDownloadButton';
import * as hrApi from '../../../api/hr';

vi.mock('../../../api/hr');

const blob = () => ({ blob: new Blob(['x']), filename: 'archivo.bin' });

beforeEach(() => {
  vi.clearAllMocks();
  hrApi.saveBlob.mockImplementation(() => {});
  hrApi.downloadCVXlsx.mockResolvedValue(blob());
  hrApi.downloadCVZip.mockResolvedValue(blob());
  hrApi.downloadCVReport.mockResolvedValue(blob());
  hrApi.downloadCVOriginal.mockResolvedValue(blob());
  hrApi.downloadCVPosting.mockResolvedValue(blob());
});
afterEach(() => vi.useRealTimers());

describe('CVDownloadButton', () => {
  it.each([
    ['xlsx', 'downloadCVXlsx', [5], 'Excel descargado.'],
    ['zip', 'downloadCVZip', [5], 'ZIP descargado.'],
    ['report', 'downloadCVReport', [5, 9], 'Reporte descargado.'],
    ['original', 'downloadCVOriginal', [5, 9], 'CV descargado.'],
    ['posting', 'downloadCVPosting', [5], 'Convocatoria descargada.'],
  ])('%s llama al endpoint correcto, guarda el blob y avisa con un toast', async (kind, fn, args, toast) => {
    const u = userEvent.setup();
    renderWithProviders(<CVDownloadButton kind={kind} analysisId={5} itemId={9} label="Descargar" />);
    await u.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(await screen.findByText(toast)).toBeInTheDocument();
    expect(hrApi[fn]).toHaveBeenCalledWith(...args);
    expect(hrApi.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'archivo.bin');
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
  });

  it('con una razón para deshabilitar queda enfocable, la explica y no descarga', async () => {
    const u = userEvent.setup();
    renderWithProviders(<CVDownloadButton kind="xlsx" analysisId={5} label="Descargar Excel" disabledReason="Aún no hay CVs listos." />);
    const btn = screen.getByRole('button', { name: 'Descargar Excel' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAccessibleDescription('Aún no hay CVs listos.');
    btn.focus();
    expect(btn).toHaveFocus();
    await u.click(btn);
    await u.keyboard('{Enter}');
    expect(hrApi.downloadCVXlsx).not.toHaveBeenCalled();
  });

  it('un clic repetido mientras prepara no dispara una segunda descarga', async () => {
    const u = userEvent.setup();
    let release;
    hrApi.downloadCVReport.mockImplementation(() => new Promise((resolve) => { release = () => resolve(blob()); }));
    renderWithProviders(<CVDownloadButton kind="report" analysisId={5} itemId={9} label="Descargar reporte" />);
    await u.click(screen.getByRole('button', { name: 'Descargar reporte' }));
    const busy = screen.getByRole('button', { name: 'Preparando…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled(); // sigue enfocable: el foco no se pierde
    await u.click(busy);
    expect(hrApi.downloadCVReport).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(await screen.findByText('Reporte descargado.')).toBeInTheDocument();
  });

  it('si falla muestra el motivo en una alerta, el botón pasa a "Reintentar" y reintentar limpia el error', async () => {
    const u = userEvent.setup();
    hrApi.downloadCVOriginal.mockRejectedValueOnce({ response: { status: 404, data: { code: 'file_missing', detail: 'El archivo original ya no está.' } } });
    renderWithProviders(<CVDownloadButton kind="original" analysisId={5} itemId={9} label="Descargar CV original" />);
    await u.click(screen.getByRole('button', { name: 'Descargar CV original' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El archivo original ya no está.');
    expect(hrApi.saveBlob).not.toHaveBeenCalled();
    // el nombre accesible conserva qué archivo se reintenta (el texto visible sigue siendo "Reintentar")
    const retry = screen.getByRole('button', { name: 'Reintentar descarga de CV original' });
    expect(retry).toHaveTextContent('Reintentar');
    await u.click(retry);
    expect(await screen.findByText('CV descargado.')).toBeInTheDocument();
    expect(screen.queryByText('El archivo original ya no está.')).not.toBeInTheDocument();
  });

  it('un error sin respuesta del servidor (sin red) muestra un mensaje en español, no un texto técnico', async () => {
    const u = userEvent.setup();
    hrApi.downloadCVXlsx.mockRejectedValueOnce(new Error('Network Error'));
    renderWithProviders(<CVDownloadButton kind="xlsx" analysisId={5} label="Descargar Excel" />);
    await u.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/Network Error/);
    expect(alert.textContent.length).toBeGreaterThan(10);
  });

  it('el ZIP avisa "Puede tardar un poco" solo tras 3 s de espera', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    hrApi.downloadCVZip.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<CVDownloadButton kind="zip" analysisId={5} label="Descargar ZIP" />);
    await u.click(screen.getByRole('button', { name: 'Descargar ZIP' }));
    expect(screen.queryByText('Puede tardar un poco.')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(screen.getByText('Puede tardar un poco.')).toBeInTheDocument();
  });

  it('el Excel (rápido) nunca muestra el aviso de demora', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    hrApi.downloadCVXlsx.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<CVDownloadButton kind="xlsx" analysisId={5} label="Descargar Excel" />);
    await u.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText('Puede tardar un poco.')).not.toBeInTheDocument();
  });

  it('si se desmonta con la descarga en curso no deja timers ni actualiza el estado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let release;
    hrApi.downloadCVZip.mockImplementation(() => new Promise((resolve) => { release = () => resolve(blob()); }));
    const { unmount } = renderWithProviders(<CVDownloadButton kind="zip" analysisId={5} label="Descargar ZIP" />);
    await u.click(screen.getByRole('button', { name: 'Descargar ZIP' }));
    unmount();
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(4000); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
