import { Route, Routes } from 'react-router-dom';
import LocationProbe from './LocationProbe';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { FINISHED_COUNTS, analysisDetail, authAs, cvConfig, finishedRows, progressResponse } from './cvFixtures';
import HRCVAnalysisPage from '../pages/rrhh/HRCVAnalysisPage';
import * as hrApi from '../api/hr';
import { useAuth } from '../context/useAuth';

// Shared harness for the results-page tests (the test file must vi.mock
// '../../api/hr' and '../../context/useAuth').
export function setup({ role = 'HR_MANAGER', detail, counts = FINISHED_COUNTS, rows = finishedRows(), progress, config = cvConfig(), entry = '/rrhh/cvs/5', analysisError = null, itemsError = null } = {}) {
  useAuth.mockReturnValue(authAs([role]));
  hrApi.getCVConfig.mockResolvedValue({ data: config });
  hrApi.getCVAnalysis.mockResolvedValue({ data: detail ?? analysisDetail({ status: 'COMPLETED_WITH_ERRORS', counts, cost_usd: 0.84 }) });
  hrApi.getCVProgress.mockResolvedValue({ data: progress ?? progressResponse(counts) });
  hrApi.getCVItems.mockResolvedValue({ data: { count: rows.length, results: rows } });
  if (analysisError) hrApi.getCVAnalysis.mockRejectedValueOnce(analysisError);
  if (itemsError) hrApi.getCVItems.mockRejectedValueOnce(itemsError);
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/rrhh/cvs/:id" element={<HRCVAnalysisPage />} />
        <Route path="/rrhh/cvs/:id/preparar" element={<p>PANTALLA PREPARAR</p>} />
        <Route path="/rrhh/cvs" element={<p>PANTALLA LISTA</p>} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: [entry] },
  );
}

export const loc = () => screen.getByTestId('loc').textContent;
export const rowNames = () => within(screen.getByRole('table')).getAllByRole('button', { name: /^(?!Ordenar)/ }).filter((b) => b.hasAttribute('data-item-id')).map((b) => b.textContent);

