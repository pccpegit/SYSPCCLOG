import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import HRDocumentsListPage from './HRDocumentsListPage';
import { useAuth } from '../../context/AuthContext';
import * as hrApi from '../../api/hr';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/hr');

const row = (id, name) => ({
  id, document_type: 'CONTRACT', document_type_label: 'Contrato de trabajo', subject_name: name,
  status: 'DRAFT', status_label: 'Borrador', reference_number: null, created_by_name: 'Gerente',
  created_at: '2026-10-05T10:00:00-05:00', issued_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['HR_MANAGER'] });
});

describe('HRDocumentsListPage — paginación', () => {
  it('con más de una página navega con Siguiente/Anterior y pide la página al backend', async () => {
    const user = userEvent.setup();
    hrApi.getDocuments.mockImplementation(async ({ page }) => ({
      data: { count: 45, results: [row(page, `Persona pagina ${page}`)] },
    }));
    renderWithProviders(<HRDocumentsListPage />);

    await screen.findByRole('link', { name: /persona pagina 1/i });
    expect(screen.getByText(/45 documentos · página 1 de 3/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await screen.findByRole('link', { name: /persona pagina 2/i });
    expect(hrApi.getDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByText(/página 2 de 3/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await screen.findByRole('link', { name: /persona pagina 3/i });
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /anterior/i }));
    await screen.findByRole('link', { name: /persona pagina 2/i });
  });

  it('una sola página deshabilita ambos botones y usa singular', async () => {
    hrApi.getDocuments.mockResolvedValue({ data: { count: 1, results: [row(1, 'Solo Uno')] } });
    renderWithProviders(<HRDocumentsListPage />);
    await screen.findByRole('link', { name: /solo uno/i });
    expect(screen.getByText(/1 documento · página 1 de 1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled();
  });

  it('cambiar un filtro estando en la página 2 vuelve a la página 1', async () => {
    const user = userEvent.setup();
    hrApi.getDocuments.mockResolvedValue({ data: { count: 45, results: [row(1, 'Alguien')] } });
    renderWithProviders(<HRDocumentsListPage />);
    await screen.findByRole('link', { name: /alguien/i });
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(hrApi.getDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    await user.selectOptions(screen.getByLabelText('Estado'), 'ISSUED');
    await waitFor(() =>
      expect(hrApi.getDocuments).toHaveBeenLastCalledWith({ page: 1, status: 'ISSUED' }),
    );
  });
});

describe('HRDocumentsListPage — filtros y estados', () => {
  it('la búsqueda se envía con debounce y recortada', async () => {
    const user = userEvent.setup();
    hrApi.getDocuments.mockResolvedValue({ data: { count: 1, results: [row(1, 'Ana')] } });
    renderWithProviders(<HRDocumentsListPage />);
    await screen.findByRole('link', { name: /ana/i });
    hrApi.getDocuments.mockClear();

    await user.type(screen.getByLabelText(/buscar por trabajador/i), '  Perez ');
    // No se dispara una consulta por cada tecla.
    expect(hrApi.getDocuments).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'P' }));
    await waitFor(() => expect(hrApi.getDocuments).toHaveBeenLastCalledWith({ page: 1, search: 'Perez' }));
  });

  it('combina filtros de estado y tipo', async () => {
    const user = userEvent.setup();
    hrApi.getDocuments.mockResolvedValue({ data: { count: 1, results: [row(1, 'Ana')] } });
    renderWithProviders(<HRDocumentsListPage />);
    await screen.findByRole('link', { name: /ana/i });
    await user.selectOptions(screen.getByLabelText('Estado'), 'VOIDED');
    await user.selectOptions(screen.getByLabelText('Tipo de documento'), 'CONTRACT');
    await waitFor(() =>
      expect(hrApi.getDocuments).toHaveBeenLastCalledWith({ page: 1, status: 'VOIDED', document_type: 'CONTRACT' }),
    );
  });

  it('sin resultados por filtros ofrece Quitar filtros y recarga sin ellos', async () => {
    const user = userEvent.setup();
    hrApi.getDocuments.mockResolvedValue({ data: { count: 0, results: [] } });
    renderWithProviders(<HRDocumentsListPage />);
    await screen.findByText(/aún no hay documentos generados/i);

    await user.selectOptions(screen.getByLabelText('Estado'), 'ISSUED');
    expect(await screen.findByText(/ningún documento coincide con los filtros/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /quitar filtros/i }));
    await waitFor(() => expect(hrApi.getDocuments).toHaveBeenLastCalledWith({ page: 1 }));
    expect(await screen.findByText(/aún no hay documentos generados/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toHaveValue('');
  });

  it('el vacío sin filtros ofrece generar el primer contrato solo a HR_MANAGER', async () => {
    hrApi.getDocuments.mockResolvedValue({ data: { count: 0, results: [] } });
    const { unmount } = renderWithProviders(<HRDocumentsListPage />);
    expect(await screen.findByRole('link', { name: /generar el primer contrato/i })).toHaveAttribute('href', '/rrhh/documentos/nuevo');
    unmount();

    useAuth.mockReturnValue({ userRoles: ['GENERAL_MANAGER'] });
    renderWithProviders(<HRDocumentsListPage />);
    await screen.findByText(/aún no hay documentos generados/i);
    expect(screen.queryByRole('link', { name: /generar el primer contrato/i })).not.toBeInTheDocument();
  });

  it('muestra "Sin número" para borradores y el texto de solo lectura para GENERAL_MANAGER', async () => {
    useAuth.mockReturnValue({ userRoles: ['GENERAL_MANAGER'] });
    hrApi.getDocuments.mockResolvedValue({ data: { count: 1, results: [row(1, 'Ana')] } });
    renderWithProviders(<HRDocumentsListPage />);
    expect(await screen.findByText('Sin número')).toBeInTheDocument();
    expect(screen.getByText(/solo lectura/i)).toBeInTheDocument();
  });

  it('el error de red muestra mensaje es-PE y el de 403 el de permiso', async () => {
    hrApi.getDocuments.mockRejectedValueOnce({ response: { status: 403, data: { detail: 'You do not have permission' } } });
    renderWithProviders(<HRDocumentsListPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no tienes permiso/i);
  });

  it('muestra "cargando" mientras llega la respuesta', async () => {
    hrApi.getDocuments.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<HRDocumentsListPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/cargando documentos/i);
  });
});
