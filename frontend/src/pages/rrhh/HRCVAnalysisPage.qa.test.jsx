// QA ronda 1 (SYSPCC-023, iteración 2): ramas de error de la pantalla de resultados
// (polling fatal, reanudar que falla, configuración caída, modo de prueba).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { act, screen } from '@testing-library/react';
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

const counts = { total: 5, queued: 5, processing: 0, done: 0, failed: 0, cancelled: 0 };
const queued = (id) => itemRow(id, { status: 'QUEUED', score: null, recommendation: null, candidate_name: null, headline: null, experience_years: null, rank: null });

function mount({ role = 'HR_MANAGER', config = cvConfig(), progress = () => hrApi.getCVProgress.mockResolvedValue({ data: progressResponse(counts) }) } = {}) {
  useAuth.mockReturnValue(authAs([role]));
  hrApi.getCVConfig.mockImplementation(() => (config instanceof Error ? Promise.reject(config) : Promise.resolve({ data: config })));
  hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail({ status: 'PROCESSING', counts: { ...counts, pending: 5 } }) });
  hrApi.getCVItems.mockResolvedValue({ data: { count: 1, results: [queued(1)] } });
  progress();
  return renderWithProviders(
    <Routes>
      <Route path="/rrhh/cvs/:id" element={<HRCVAnalysisPage />} />
    </Routes>,
    { initialEntries: ['/rrhh/cvs/5'] },
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.clearAllMocks();
  delete window.matchMedia;
  hrApi.resumeCVAnalysis.mockResolvedValue({ data: { redispatched: 1 } });
});
afterEach(() => vi.useRealTimers());

describe('HRCVAnalysisPage — fallas del sondeo y la configuración', () => {
  it('si el análisis desaparece mientras se sondea (404) muestra "no encontramos" y deja de consultar', async () => {
    mount();
    await flush();
    hrApi.getCVProgress.mockReset();
    hrApi.getCVProgress.mockRejectedValue({ response: { status: 404, data: {}, headers: {} } });
    await flush(2000);
    expect(screen.getByRole('heading', { name: 'No encontramos este análisis.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver/i })).toHaveAttribute('href', '/rrhh/cvs');
    const calls = hrApi.getCVProgress.mock.calls.length;
    await flush(30000);
    expect(hrApi.getCVProgress.mock.calls.length).toBe(calls);
  });

  it('si reanudar automáticamente falla, no entra en bucle: un solo intento y el botón queda disponible', async () => {
    hrApi.resumeCVAnalysis.mockRejectedValue({ response: { status: 503, data: { code: 'analysis_unavailable' } } });
    mount({ progress: () => hrApi.getCVProgress.mockResolvedValue({ data: progressResponse(counts, { stalled: true }) }) });
    await flush();
    await flush(8000);
    expect(hrApi.resumeCVAnalysis).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Reanudar' }).length).toBeGreaterThan(0);
  });

  it('si falla la configuración, los resultados y el avance siguen visibles', async () => {
    mount({ config: new Error('Network Error') });
    await flush();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('en modo de prueba la pantalla de resultados lo dice (los datos son simulados)', async () => {
    mount({ config: cvConfig({ provider: 'fake', simulated: true }) });
    await flush();
    expect(screen.getByText('Modo de prueba: los resultados son simulados.')).toBeInTheDocument();
  });

  it('el gerente general ve el avance en vivo pero nunca llama a reanudar ni cancelar', async () => {
    mount({ role: 'GENERAL_MANAGER', progress: () => hrApi.getCVProgress.mockResolvedValue({ data: progressResponse(counts, { stalled: true }) }) });
    await flush();
    await flush(6000);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(hrApi.resumeCVAnalysis).not.toHaveBeenCalled();
    expect(hrApi.cancelCVAnalysis).not.toHaveBeenCalled();
  });

  it('el sondeo se detiene al salir de la pantalla', async () => {
    const { unmount } = mount();
    await flush();
    unmount();
    const calls = hrApi.getCVProgress.mock.calls.length;
    await flush(20000);
    expect(hrApi.getCVProgress.mock.calls.length).toBe(calls);
  });
});
