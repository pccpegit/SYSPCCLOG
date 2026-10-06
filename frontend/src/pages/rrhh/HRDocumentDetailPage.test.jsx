import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import { CONTRACT_SPEC, documentDetail } from '../../test/hrFixtures';
import HRDocumentDetailPage from './HRDocumentDetailPage';
import { useAuth } from '../../context/AuthContext';
import * as hrApi from '../../api/hr';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/hr');

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/rrhh/documentos/:id" element={<HRDocumentDetailPage />} />
      <Route path="/rrhh/documentos" element={<p>Lista de documentos</p>} />
    </Routes>,
    { route: '/rrhh/documentos/7' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['HR_MANAGER'] });
  hrApi.getDocumentTypes.mockResolvedValue({ data: [CONTRACT_SPEC] });
  hrApi.getDocumentEvents.mockResolvedValue({
    data: [{ id: 1, action: 'CREATED', action_label: 'Creado', actor_name: 'Gerente', metadata: {}, created_at: '2026-10-05T10:00:00-05:00' }],
  });
  hrApi.getDocument.mockResolvedValue({ data: documentDetail() });
});

describe('HRDocumentDetailPage', () => {
  it('HR_MANAGER ve datos, advertencias, bitácora y acciones de borrador', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /pérez ana/i })).toBeInTheDocument();
    expect(screen.getByText(/menor a la remuneración mínima/i)).toBeInTheDocument();
    expect(await screen.findByText('Creado')).toBeInTheDocument();
    expect(await screen.findByText('A plazo indeterminado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^emitir$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /editar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /eliminar borrador/i })).toBeInTheDocument();
  });

  it('GENERAL_MANAGER es solo lectura: oculta Emitir, Editar, Eliminar y Anular', async () => {
    useAuth.mockReturnValue({ userRoles: ['GENERAL_MANAGER'] });
    renderPage();
    await screen.findByRole('heading', { name: /pérez ana/i });
    expect(screen.queryByRole('button', { name: /^emitir$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /editar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /eliminar borrador/i })).not.toBeInTheDocument();
    // La descarga sí está disponible (lectura).
    expect(screen.getByRole('button', { name: /descargar word/i })).toBeEnabled();
  });

  it('GENERAL_MANAGER no ve Anular en un documento emitido', async () => {
    useAuth.mockReturnValue({ userRoles: ['GENERAL_MANAGER'] });
    hrApi.getDocument.mockResolvedValue({
      data: documentDetail({ status: 'ISSUED', status_label: 'Emitido', reference_number: 'CT-2026-0001', issued_at: '2026-10-05T11:00:00-05:00', warnings: [] }),
    });
    renderPage();
    await screen.findByRole('heading', { name: /pérez ana/i });
    expect(screen.queryByRole('button', { name: /anular/i })).not.toBeInTheDocument();
  });

  it('PDF deshabilitado con explicación cuando no está disponible', async () => {
    useAuth.mockReturnValue({ userRoles: ['GENERAL_MANAGER'] });
    hrApi.getDocument.mockResolvedValue({
      data: documentDetail({ status: 'ISSUED', status_label: 'Emitido', reference_number: 'CT-2026-0001', pdf_available: false, warnings: [] }),
    });
    renderPage();
    const pdf = await screen.findByRole('button', { name: /descargar pdf/i });
    expect(pdf).toBeDisabled();
    expect(pdf).toHaveAccessibleDescription(/no está disponible para este documento/i);
  });

  it('Emitir pide confirmación y no emite al cancelar', async () => {
    const user = userEvent.setup();
    hrApi.issueDocument.mockResolvedValue({ data: {} });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^emitir$/i }));

    const dialog = screen.getByRole('dialog', { name: /emitir documento/i });
    expect(dialog).toHaveTextContent(/quedará inmutable/i);
    await user.click(within(dialog).getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hrApi.issueDocument).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^emitir$/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^emitir$/i }));
    await waitFor(() => expect(hrApi.issueDocument).toHaveBeenCalledWith('7'));
  });

  it('Anular exige motivo de al menos 10 caracteres y enfoca el campo', async () => {
    const user = userEvent.setup();
    hrApi.voidDocument.mockResolvedValue({ data: {} });
    hrApi.getDocument.mockResolvedValue({
      data: documentDetail({ status: 'ISSUED', status_label: 'Emitido', reference_number: 'CT-2026-0001', warnings: [] }),
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^anular$/i }));

    const dialog = screen.getByRole('dialog', { name: /anular documento/i });
    const reason = within(dialog).getByLabelText(/motivo de la anulación/i);
    await waitFor(() => expect(reason).toHaveFocus());

    await user.type(reason, 'corto');
    await user.click(within(dialog).getByRole('button', { name: /anular documento/i }));
    expect(await within(dialog).findByText(/al menos 10 caracteres/i)).toBeInTheDocument();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(hrApi.voidDocument).not.toHaveBeenCalled();

    await user.clear(reason);
    await user.type(reason, 'Error en el sueldo consignado');
    await user.click(within(dialog).getByRole('button', { name: /anular documento/i }));
    await waitFor(() => expect(hrApi.voidDocument).toHaveBeenCalledWith('7', 'Error en el sueldo consignado'));
  });

  it('Escape cierra el diálogo y devuelve el foco al botón que lo abrió', async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = await screen.findByRole('button', { name: /^emitir$/i });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('muestra estado de error con reintento si falla la carga', async () => {
    hrApi.getDocument.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'No encontrado.' } } });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/no encontrado/i);
    hrApi.getDocument.mockResolvedValueOnce({ data: documentDetail() });
    await userEvent.setup().click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByRole('heading', { name: /pérez ana/i })).toBeInTheDocument();
  });

  it('descarga Word por blob, sin enlaces directos', async () => {
    const user = userEvent.setup();
    hrApi.downloadDocument.mockResolvedValue({ blob: new Blob(['x']), filename: 'Contrato_Perez_borrador.docx' });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /descargar word/i }));
    await waitFor(() => expect(hrApi.saveBlob).toHaveBeenCalled());
    expect(hrApi.downloadDocument).toHaveBeenCalledWith('7', 'docx');
  });

  describe('Generar PDF', () => {
    const issued = (o = {}) => documentDetail({ status: 'ISSUED', status_label: 'Emitido', reference_number: 'CT-2026-0001', warnings: [], ...o });

    it('solo HR_MANAGER, sin PDF y no anulado', async () => {
      hrApi.getDocument.mockResolvedValue({ data: issued({ pdf_available: true }) });
      const { unmount } = renderPage();
      await screen.findByRole('heading', { name: /pérez ana/i });
      expect(screen.queryByRole('button', { name: /generar pdf/i })).not.toBeInTheDocument();
      unmount();

      hrApi.getDocument.mockResolvedValue({ data: issued({ status: 'VOIDED', status_label: 'Anulado', void_reason: 'motivo de prueba' }) });
      const second = renderPage();
      await screen.findByRole('heading', { name: /pérez ana/i });
      expect(screen.queryByRole('button', { name: /generar pdf/i })).not.toBeInTheDocument();
      second.unmount();

      useAuth.mockReturnValue({ userRoles: ['GENERAL_MANAGER'] });
      hrApi.getDocument.mockResolvedValue({ data: issued() });
      renderPage();
      await screen.findByRole('heading', { name: /pérez ana/i });
      expect(screen.queryByRole('button', { name: /generar pdf/i })).not.toBeInTheDocument();
    });

    it('genera el PDF con estado de carga y recarga el documento', async () => {
      const user = userEvent.setup();
      let resolve;
      hrApi.renderDocumentPdf.mockReturnValue(new Promise((r) => { resolve = r; }));
      hrApi.getDocument.mockResolvedValueOnce({ data: issued() });
      renderPage();
      await user.click(await screen.findByRole('button', { name: /generar pdf/i }));

      expect(hrApi.renderDocumentPdf).toHaveBeenCalledWith('7');
      expect(screen.getByRole('button', { name: /generando pdf/i })).toBeDisabled();

      hrApi.getDocument.mockResolvedValue({ data: issued({ pdf_available: true }) });
      resolve({ data: {} });
      await waitFor(() => expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeEnabled());
      expect(screen.queryByRole('button', { name: /generar pdf/i })).not.toBeInTheDocument();
    });

    it.each([
      ['409 invalid_state', 409, 'invalid_state', /cambió de estado/i],
      ['501 pdf_disabled (sin LibreOffice)', 501, 'pdf_disabled', /no está habilitada en este entorno/i],
      ['404 pdf_not_available', 404, 'pdf_not_available', /pdf no está disponible/i],
    ])('maneja %s con mensaje es-PE', async (_n, status, code, re) => {
      const user = userEvent.setup();
      hrApi.getDocument.mockResolvedValue({ data: issued() });
      hrApi.renderDocumentPdf.mockRejectedValue({ response: { status, data: { code, detail: null } } });
      renderPage();
      await user.click(await screen.findByRole('button', { name: /generar pdf/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(re);
      expect(screen.getByRole('button', { name: /generar pdf/i })).toBeEnabled();
    });
  });
});

describe('HRDocumentDetailPage — detail del backend', () => {
  it('Generar PDF muestra el detail es-PE específico del backend (409) en lugar del genérico', async () => {
    const user = userEvent.setup();
    hrApi.getDocument.mockResolvedValue({
      data: documentDetail({ status: 'ISSUED', status_label: 'Emitido', reference_number: 'CT-2026-0001', warnings: [] }),
    });
    hrApi.renderDocumentPdf.mockRejectedValue({
      response: { status: 409, data: { code: 'invalid_state', detail: 'El documento cambió mientras se generaba el PDF. Inténtalo de nuevo.' } },
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /generar pdf/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El documento cambió mientras se generaba el PDF. Inténtalo de nuevo.');
  });
});
