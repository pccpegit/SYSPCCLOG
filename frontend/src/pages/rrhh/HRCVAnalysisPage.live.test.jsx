import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { act, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { analysisDetail, authAs, cvConfig, itemRow, progressResponse } from '../../test/cvFixtures';
import HRCVAnalysisPage from './HRCVAnalysisPage';
import * as hrApi from '../../api/hr';
import { useAuth } from '../../context/useAuth';

vi.mock('../../api/hr');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const queuedRow = (id) =>
  itemRow(id, { status: 'QUEUED', score: null, recommendation: null, candidate_name: null, headline: null, experience_years: null, rank: null });

function mount({ role = 'HR_MANAGER', progressSeq, rows, counts }) {
  useAuth.mockReturnValue(authAs([role]));
  hrApi.getCVConfig.mockResolvedValue({ data: cvConfig() });
  hrApi.getCVAnalysis.mockResolvedValue({
    data: analysisDetail({ status: 'PROCESSING', counts: { ...counts, pending: counts.queued + counts.processing } }),
  });
  hrApi.getCVItems.mockResolvedValue({ data: { count: rows.length, results: rows } });
  progressSeq.forEach((p, i) => {
    if (i < progressSeq.length - 1) hrApi.getCVProgress.mockResolvedValueOnce({ data: p });
    else hrApi.getCVProgress.mockResolvedValue({ data: p });
  });
  return renderWithProviders(
    <Routes>
      <Route path="/rrhh/cvs/:id" element={<HRCVAnalysisPage />} />
    </Routes>,
    { initialEntries: ['/rrhh/cvs/5'] },
  );
}

const names = () =>
  within(screen.getByRole('table'))
    .getAllByRole('button')
    .filter((b) => b.hasAttribute('data-item-id'))
    .map((b) => b.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.clearAllMocks();
  delete window.matchMedia;
  hrApi.resumeCVAnalysis.mockResolvedValue({ data: { redispatched: 1 } });
  hrApi.cancelCVAnalysis.mockResolvedValue({ data: { cancelled: 2 } });
});
afterEach(() => vi.useRealTimers());

describe('HRCVAnalysisPage — en curso', () => {
  const runningCounts = { total: 40, queued: 27, processing: 0, done: 12, failed: 1, cancelled: 0 };

  it('muestra el avance: conteo grande, barra accesible, tiempo y la nota del ranking; sin acción principal', async () => {
    const rows = [queuedRow(1), queuedRow(2), itemRow(3, { score: 90, rank: 1 })];
    mount({ progressSeq: [progressResponse(runningCounts)], rows, counts: runningCounts });
    await flush();
    const panel = screen.getByRole('region', { name: /analizando tus cvs/i });
    expect(within(panel).getByText('12 de 40 listos')).toBeInTheDocument();
    expect(within(panel).getByText('1 con error · 27 en cola')).toBeInTheDocument();
    const bar = within(panel).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '33');
    expect(bar).toHaveAttribute('aria-valuetext', '12 de 40 listos');
    expect(within(panel).getByText('Calculando el tiempo…')).toBeInTheDocument();
    expect(screen.getByText('El ranking se ordena al terminar.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Cancelar pendientes (27)' })).toBeInTheDocument();
    // ninguna acción principal mientras corre
    expect(document.querySelectorAll('button.bg-violet-600, a.bg-violet-600')).toHaveLength(0);
  });

  it('la tabla no se reordena en vivo: orden de subida y ranking "—" mientras haya CVs en curso', async () => {
    const rows = [itemRow(1, { score: 40, rank: 3, candidate_name: 'Carla' }), itemRow(2, { score: 92, rank: 1, candidate_name: 'Ana' }), queuedRow(3)];
    mount({ progressSeq: [progressResponse(runningCounts)], rows, counts: runningCounts });
    await flush();
    expect(names()).toEqual(['Carla', 'Ana', 'cv_3.pdf']);
    expect(within(screen.getByRole('table')).getAllByText('Sin ranking todavía')).toHaveLength(3);
  });

  it('parcha las filas con los datos del sondeo sin recargar la lista', async () => {
    const rows = [queuedRow(1), queuedRow(2)];
    const first = progressResponse({ total: 2, queued: 2 });
    const second = progressResponse(
      { total: 2, queued: 1, done: 1 },
      { items: [{ id: 1, status: 'DONE', candidate_name: 'Ana Paz', score: 88, recommendation: 'ADVANCE', error_code: '' }] },
    );
    mount({ progressSeq: [first, second], rows, counts: { total: 2, queued: 2, processing: 0, done: 0, failed: 0, cancelled: 0 } });
    await flush();
    expect(screen.queryByText('Ana Paz')).not.toBeInTheDocument();
    await flush(2000);
    expect(screen.getByRole('button', { name: 'Ana Paz' })).toBeInTheDocument();
    expect(names()).toEqual(['Ana Paz', 'cv_2.pdf']); // sigue en orden de subida
  });

  it('recarga la lista 3 s después de que terminan CVs (no antes)', async () => {
    const rows = [queuedRow(1), queuedRow(2)];
    const first = progressResponse({ total: 2, queued: 2 });
    const second = progressResponse({ total: 2, queued: 1, done: 1 });
    mount({ progressSeq: [first, second], rows, counts: { total: 2, queued: 2, processing: 0, done: 0, failed: 0, cancelled: 0 } });
    await flush();
    const initial = hrApi.getCVItems.mock.calls.length;
    await flush(2000); // llega el segundo sondeo: done 0 -> 1
    expect(hrApi.getCVItems.mock.calls.length).toBe(initial);
    await flush(2999);
    expect(hrApi.getCVItems.mock.calls.length).toBe(initial);
    await flush(1);
    expect(hrApi.getCVItems.mock.calls.length).toBe(initial + 1);
  });

  it('al terminar en esta sesión: celebración breve, panel fuera, ranking aplicado una vez y lista recargada', async () => {
    const before = { total: 40, queued: 0, processing: 2, done: 36, failed: 2, cancelled: 0 };
    const after = { total: 40, queued: 0, processing: 0, done: 38, failed: 2, cancelled: 0 };
    const rowsRunning = [itemRow(1, { score: 40, rank: 2, candidate_name: 'Carla' }), itemRow(2, { score: 92, rank: 1, candidate_name: 'Ana' })];
    mount({ progressSeq: [progressResponse(before), progressResponse(after)], rows: rowsRunning, counts: before });
    await flush();
    expect(names()).toEqual(['Carla', 'Ana']);
    await flush(2000);
    // La celebración es solo refuerzo visual; el fin se anuncia en la región viva persistente.
    const banner = screen.getByText('¡Listo! Analizamos 38 de 40 CVs.');
    expect(banner.closest('[role="status"]')).toBeNull();
    await flush(1);
    expect(screen.getByText('Análisis terminado: 38 listos, 2 con error.').closest('[aria-live="polite"]')).toBeInTheDocument();
    expect(screen.getByText('2 tuvieron problemas. Puedes reintentarlos.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /analizando tus cvs/i })).not.toBeInTheDocument();
    expect(names()).toEqual(['Ana', 'Carla']); // ranking aplicado al terminar
    await flush(1);
    expect(hrApi.getCVItems.mock.calls.length).toBeGreaterThan(1);
    // la celebración no se descarta sola
    await flush(60000);
    expect(screen.getByText('¡Listo! Analizamos 38 de 40 CVs.')).toBeInTheDocument();
  });

  it('anuncia solo hitos (25 %) en una única región viva que no vive dentro del panel', async () => {
    const c = { total: 40, queued: 28, processing: 0, done: 10, failed: 0, cancelled: 0 };
    mount({ progressSeq: [progressResponse(c)], rows: [queuedRow(1)], counts: c });
    await flush();
    await flush(10);
    const panel = screen.getByRole('region', { name: /analizando tus cvs/i });
    expect(panel.querySelector('[aria-live]')).toBeNull();
    const live = screen.getByText('Van 10 de 40 listos.');
    expect(live.closest('[aria-live="polite"]')).not.toBeNull();
    expect(panel.contains(live)).toBe(false);
  });

  it('el fin del análisis se anuncia aunque el panel de progreso se desmonte en el mismo render', async () => {
    const before = { total: 4, queued: 0, processing: 1, done: 2, failed: 0, cancelled: 0 };
    const after = { total: 4, queued: 0, processing: 0, done: 3, failed: 1, cancelled: 0 };
    mount({ progressSeq: [progressResponse(before), progressResponse(after)], rows: [queuedRow(1)], counts: before });
    await flush();
    expect(screen.queryByText(/Análisis terminado/)).not.toBeInTheDocument();
    await flush(2000);
    await flush(1);
    expect(screen.queryByRole('region', { name: /analizando tus cvs/i })).not.toBeInTheDocument();
    expect(screen.getByText('Análisis terminado: 3 listos, 1 con error.')).toBeInTheDocument();
  });

  it('el hito cuenta también los CVs con error (llega al 100 %)', async () => {
    const start = { total: 4, queued: 3, processing: 1, done: 0, failed: 0, cancelled: 0 };
    const mid = { total: 4, queued: 1, processing: 1, done: 0, failed: 2, cancelled: 0 };
    mount({ progressSeq: [progressResponse(start), progressResponse(mid)], rows: [queuedRow(1)], counts: start });
    await flush();
    await flush(2000);
    await flush(1);
    expect(screen.getByText('Van 0 de 4 listos.')).toBeInTheDocument(); // 50 % ya resueltos (2 de 4)
  });

  it('detenido: avisa, reanuda una sola vez automáticamente y ofrece "Reanudar"', async () => {
    const c = { total: 5, queued: 5, processing: 0, done: 0, failed: 0, cancelled: 0 };
    mount({ progressSeq: [progressResponse(c, { stalled: true })], rows: [queuedRow(1)], counts: c });
    await flush();
    expect(hrApi.resumeCVAnalysis).toHaveBeenCalledTimes(1);
    expect(hrApi.resumeCVAnalysis).toHaveBeenCalledWith('5');
    expect(screen.getByText('El análisis se detuvo.')).toBeInTheDocument();
    await flush(6000);
    expect(hrApi.resumeCVAnalysis).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Reanudar' })).toHaveLength(1); // solo el del panel
  });

  it('detenido para el gerente general: solo avisa que avise a RR. HH., sin reanudar', async () => {
    const c = { total: 5, queued: 5, processing: 0, done: 0, failed: 0, cancelled: 0 };
    mount({ role: 'GENERAL_MANAGER', progressSeq: [progressResponse(c, { stalled: true })], rows: [queuedRow(1)], counts: c });
    await flush();
    expect(screen.getByText('El análisis se detuvo. Avisa a RR. HH.')).toBeInTheDocument();
    expect(hrApi.resumeCVAnalysis).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Reanudar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancelar pendientes/i })).not.toBeInTheDocument();
  });

  it('tras 3 errores seguidos muestra "Sin conexión. Reintentando…" con "Reintentar ahora"', async () => {
    const c = { total: 5, queued: 5, processing: 0, done: 0, failed: 0, cancelled: 0 };
    mount({ progressSeq: [progressResponse(c)], rows: [queuedRow(1)], counts: c });
    await flush();
    hrApi.getCVProgress.mockReset();
    hrApi.getCVProgress.mockRejectedValue({ response: { status: 503, data: {}, headers: {} } });
    await flush(2000);
    await flush(5000);
    await flush(9000);
    expect(screen.getByText('Sin conexión. Reintentando…')).toBeInTheDocument();
    hrApi.getCVProgress.mockResolvedValue({ data: progressResponse(c) });
    await act(async () => {
      screen.getByRole('button', { name: 'Reintentar ahora' }).click();
    });
    await flush();
    expect(screen.queryByText('Sin conexión. Reintentando…')).not.toBeInTheDocument();
  });

  it('"Cancelar pendientes" no pide confirmación (es reversible) y refresca el avance', async () => {
    const c = { total: 5, queued: 3, processing: 0, done: 2, failed: 0, cancelled: 0 };
    mount({ progressSeq: [progressResponse(c)], rows: [queuedRow(1)], counts: c });
    await flush();
    const calls = hrApi.getCVProgress.mock.calls.length;
    await act(async () => {
      screen.getByRole('button', { name: 'Cancelar pendientes (3)' }).click();
    });
    await flush();
    expect(hrApi.cancelCVAnalysis).toHaveBeenCalledWith('5');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hrApi.getCVProgress.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe('HRCVAnalysisPage — foco en el avance mientras corre', () => {
  const c = { total: 6, queued: 3, processing: 1, done: 2, failed: 0, cancelled: 0 };

  it('el panel de progreso va ANTES de las acciones, que se reducen a "Agregar más CVs"', async () => {
    mount({ progressSeq: [progressResponse(c)], rows: [queuedRow(1)], counts: c });
    await flush();
    const panel = screen.getByRole('region', { name: /analizando tus cvs/i });
    const actions = screen.getByRole('group', { name: 'Acciones del análisis' });
    expect(panel.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(actions).getAllByRole('link')).toHaveLength(1);
    expect(within(actions).getByRole('link', { name: 'Agregar más CVs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descargar Excel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descargar ZIP de PDFs' })).not.toBeInTheDocument();
  });

  it('el gerente general no ve barra de acciones mientras corre', async () => {
    mount({ role: 'GENERAL_MANAGER', progressSeq: [progressResponse(c)], rows: [queuedRow(1)], counts: c });
    await flush();
    expect(screen.queryByRole('group', { name: 'Acciones del análisis' })).not.toBeInTheDocument();
  });

  it('detenido: el único "Reanudar" es la acción principal del panel', async () => {
    mount({ progressSeq: [progressResponse(c, { stalled: true })], rows: [queuedRow(1)], counts: c });
    await flush();
    const panel = screen.getByRole('region', { name: /analizando tus cvs/i });
    const resume = within(panel).getByRole('button', { name: 'Reanudar' });
    expect(resume.className).toMatch(/bg-violet-600/);
    expect(screen.getAllByRole('button', { name: 'Reanudar' })).toHaveLength(1);
  });

  it('mientras una acción está en curso el botón usa aria-disabled (no disabled) y no se dispara dos veces', async () => {
    let release;
    hrApi.cancelCVAnalysis.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: { cancelled: 3 } }); }));
    mount({ progressSeq: [progressResponse(c)], rows: [queuedRow(1)], counts: c });
    await flush();
    const button = screen.getByRole('button', { name: 'Cancelar pendientes (3)' });
    button.focus();
    await act(async () => {
      button.click();
    });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus(); // el foco no se pierde
    await act(async () => {
      button.click();
    });
    expect(hrApi.cancelCVAnalysis).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });
});
