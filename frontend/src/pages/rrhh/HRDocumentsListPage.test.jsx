import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import HRDocumentsListPage from './HRDocumentsListPage';
import { useAuth } from '../../context/AuthContext';
import * as hrApi from '../../api/hr';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/hr');

const ROW = {
  id: 1, document_type: 'CONTRACT', document_type_label: 'Contrato de trabajo', subject_name: 'Pérez Ana',
  status: 'ISSUED', status_label: 'Emitido', reference_number: 'CT-2026-0001', created_by_name: 'Gerente',
  created_at: '2026-10-05T10:00:00-05:00', issued_at: '2026-10-05T11:00:00-05:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['HR_MANAGER'] });
});

describe('HRDocumentsListPage', () => {
  it('carga, lista documentos y ofrece Nuevo contrato a HR_MANAGER', async () => {
    hrApi.getDocuments.mockResolvedValue({ data: { results: [ROW], count: 1 } });
    renderWithProviders(<HRDocumentsListPage />);
    expect(screen.getByText(/cargando documentos/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /pérez ana/i })).toHaveAttribute('href', '/rrhh/documentos/1');
    expect(screen.getByText('CT-2026-0001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /nuevo contrato/i })).toBeInTheDocument();
  });

  it('GENERAL_MANAGER no ve el botón Nuevo contrato', async () => {
    useAuth.mockReturnValue({ userRoles: ['GENERAL_MANAGER'] });
    hrApi.getDocuments.mockResolvedValue({ data: { results: [ROW], count: 1 } });
    renderWithProviders(<HRDocumentsListPage />);
    await screen.findByRole('link', { name: /pérez ana/i });
    expect(screen.queryByRole('link', { name: /nuevo contrato/i })).not.toBeInTheDocument();
  });

  it('estado vacío', async () => {
    hrApi.getDocuments.mockResolvedValue({ data: { results: [], count: 0 } });
    renderWithProviders(<HRDocumentsListPage />);
    expect(await screen.findByText(/aún no hay documentos generados/i)).toBeInTheDocument();
  });

  it('estado de error con reintento', async () => {
    hrApi.getDocuments.mockRejectedValueOnce(new Error('network'));
    renderWithProviders(<HRDocumentsListPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    hrApi.getDocuments.mockResolvedValueOnce({ data: { results: [ROW], count: 1 } });
    await userEvent.setup().click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByRole('link', { name: /pérez ana/i })).toBeInTheDocument();
  });

  it('filtra por estado enviando el parámetro al backend', async () => {
    hrApi.getDocuments.mockResolvedValue({ data: { results: [ROW], count: 1 } });
    renderWithProviders(<HRDocumentsListPage />);
    await screen.findByRole('link', { name: /pérez ana/i });
    await userEvent.setup().selectOptions(screen.getByLabelText('Estado'), 'DRAFT');
    await waitFor(() =>
      expect(hrApi.getDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'DRAFT', page: 1 })),
    );
  });
});
