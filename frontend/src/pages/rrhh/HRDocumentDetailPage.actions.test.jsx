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

const issued = (o = {}) => documentDetail({
  status: 'ISSUED', status_label: 'Emitido', reference_number: 'CT-2026-0001',
  issued_at: '2026-10-05T11:00:00-05:00', issued_by_name: 'Gerente RRHH', pdf_available: true, warnings: [], ...o,
});

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/rrhh/documentos/:id" element={<HRDocumentDetailPage />} />
      <Route path="/rrhh/documentos" element={<p>Lista de documentos</p>} />
    </Routes>,
    { route: '/rrhh/documentos/7' },
  );
}

const httpError = (status, code, detail = null) => ({ response: { status, data: { code, detail } } });

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['HR_MANAGER'] });
  hrApi.getDocumentTypes.mockResolvedValue({ data: [CONTRACT_SPEC] });
  hrApi.getDocumentEvents.mockResolvedValue({ data: [] });
  hrApi.getDocument.mockResolvedValue({ data: documentDetail() });
});

describe('Emitir', () => {
  it('éxito: cierra el diálogo, avisa y recarga documento y bitácora', async () => {
    const user = userEvent.setup();
    hrApi.issueDocument.mockResolvedValue({ data: {} });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^emitir$/i }));
    hrApi.getDocument.mockResolvedValue({ data: issued() });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^emitir$/i }));

    expect(await screen.findByText('Documento emitido correctamente.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(/CT-2026-0001/)).toBeInTheDocument();
    expect(hrApi.getDocument).toHaveBeenCalledTimes(2);
    expect(hrApi.getDocumentEvents).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /^emitir$/i })).not.toBeInTheDocument();
  });

  it('409 invalid_state: mantiene el diálogo con el mensaje es-PE y refresca el documento', async () => {
    const user = userEvent.setup();
    hrApi.issueDocument.mockRejectedValue(httpError(409, 'invalid_state'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^emitir$/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^emitir$/i }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(/cambió de estado/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cambió de estado/i).closest('[aria-live="assertive"]')).not.toBeNull();
    await waitFor(() => expect(hrApi.getDocument).toHaveBeenCalledTimes(2));
    // Los botones vuelven a estar habilitados tras el error.
    expect(within(dialog).getByRole('button', { name: /^emitir$/i })).toBeEnabled();
  });

  it('error 500 muestra mensaje de servidor y NO recarga', async () => {
    const user = userEvent.setup();
    hrApi.issueDocument.mockRejectedValue(httpError(500, undefined, 'Traceback secreto'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^emitir$/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^emitir$/i }));
    expect(await screen.findByText(/error del servidor/i)).toBeInTheDocument();
    expect(screen.queryByText(/traceback/i)).not.toBeInTheDocument();
    expect(hrApi.getDocument).toHaveBeenCalledTimes(1);
  });

  it('en vuelo bloquea el cierre (Escape) y no emite dos veces (idempotencia de UI)', async () => {
    const user = userEvent.setup();
    hrApi.issueDocument.mockReturnValue(new Promise(() => {}));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^emitir$/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^emitir$/i }));

    const busyBtn = await within(dialog).findByRole('button', { name: /emitiendo/i });
    expect(busyBtn).toBeDisabled();
    await user.click(busyBtn);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(hrApi.issueDocument).toHaveBeenCalledTimes(1);
  });
});

describe('Eliminar borrador', () => {
  it('pide confirmación, cancelar no elimina y devuelve el foco', async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = await screen.findByRole('button', { name: /eliminar borrador/i });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: /eliminar borrador/i });
    expect(dialog).toHaveTextContent(/no se puede deshacer/i);
    await user.click(within(dialog).getByRole('button', { name: /cancelar/i }));
    expect(hrApi.deleteDocument).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('confirmar elimina, avisa y vuelve a la lista', async () => {
    const user = userEvent.setup();
    hrApi.deleteDocument.mockResolvedValue({});
    renderPage();
    await user.click(await screen.findByRole('button', { name: /eliminar borrador/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^eliminar$/i }));
    expect(await screen.findByText('Lista de documentos')).toBeInTheDocument();
    expect(hrApi.deleteDocument).toHaveBeenCalledWith('7');
  });

  it('error al eliminar deja el diálogo abierto con el mensaje y no navega', async () => {
    const user = userEvent.setup();
    hrApi.deleteDocument.mockRejectedValue(httpError(409, 'invalid_state'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /eliminar borrador/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^eliminar$/i }));
    expect(await within(screen.getByRole('dialog')).findByText(/cambió de estado/i)).toBeInTheDocument();
    expect(screen.queryByText('Lista de documentos')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /pérez ana/i })).toBeInTheDocument();
  });

  it('403 al eliminar muestra el mensaje de permiso', async () => {
    const user = userEvent.setup();
    hrApi.deleteDocument.mockRejectedValue({ response: { status: 403, data: { detail: 'Forbidden' } } });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /eliminar borrador/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^eliminar$/i }));
    expect(await screen.findByText(/no tienes permiso/i)).toBeInTheDocument();
  });
});

describe('Anular', () => {
  beforeEach(() => hrApi.getDocument.mockResolvedValue({ data: issued() }));

  it.each([
    ['vacío', ''],
    ['9 caracteres', '123456789'],
    ['solo espacios (>=10 pero recortado a <10)', '          x '],
  ])('motivo %s bloquea el envío', async (_n, text) => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^anular$/i }));
    const dialog = screen.getByRole('dialog');
    if (text) await user.type(within(dialog).getByLabelText(/motivo de la anulación/i), text);
    await user.click(within(dialog).getByRole('button', { name: /anular documento/i }));
    expect(await within(dialog).findByText(/al menos 10 caracteres/i)).toBeInTheDocument();
    expect(hrApi.voidDocument).not.toHaveBeenCalled();
  });

  it('exactamente 10 caracteres (recortado) se acepta y se envía recortado', async () => {
    const user = userEvent.setup();
    hrApi.voidDocument.mockResolvedValue({ data: {} });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^anular$/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/motivo de la anulación/i), '  0123456789  ');
    await user.click(within(dialog).getByRole('button', { name: /anular documento/i }));
    await waitFor(() => expect(hrApi.voidDocument).toHaveBeenCalledWith('7', '0123456789'));
    expect(await screen.findByText('Documento anulado.')).toBeInTheDocument();
  });

  it('reabrir el diálogo limpia motivo y error previos', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^anular$/i }));
    let dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/motivo de la anulación/i), 'corto');
    await user.click(within(dialog).getByRole('button', { name: /anular documento/i }));
    await user.click(within(dialog).getByRole('button', { name: /cancelar/i }));

    await user.click(screen.getByRole('button', { name: /^anular$/i }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/motivo de la anulación/i)).toHaveValue('');
    expect(within(dialog).queryByText(/al menos 10 caracteres/i)).not.toBeInTheDocument();
  });

  it('error 409 del backend se muestra en el diálogo', async () => {
    const user = userEvent.setup();
    hrApi.voidDocument.mockRejectedValue(httpError(409, 'invalid_state'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^anular$/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/motivo de la anulación/i), 'Motivo suficientemente largo');
    await user.click(within(dialog).getByRole('button', { name: /anular documento/i }));
    expect(await within(dialog).findByText(/cambió de estado/i)).toBeInTheDocument();
  });

  it('un documento anulado muestra el motivo y no ofrece acciones de escritura', async () => {
    hrApi.getDocument.mockResolvedValue({
      data: issued({ status: 'VOIDED', status_label: 'Anulado', voided_at: '2026-10-06T09:00:00-05:00', void_reason: 'Error en el sueldo' }),
    });
    renderPage();
    await screen.findByRole('heading', { name: /pérez ana/i });
    expect(screen.getByText(/error en el sueldo/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^anular$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^emitir$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /eliminar borrador/i })).not.toBeInTheDocument();
  });
});

describe('Descargas', () => {
  it('Word y PDF piden el formato correcto, guardan el blob con el nombre del servidor y refrescan la bitácora', async () => {
    const user = userEvent.setup();
    hrApi.getDocument.mockResolvedValue({ data: issued() });
    hrApi.downloadDocument.mockResolvedValue({ blob: new Blob(['pdf']), filename: 'CT-2026-0001.pdf' });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /descargar pdf/i }));
    await waitFor(() => expect(hrApi.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'CT-2026-0001.pdf'));
    expect(hrApi.downloadDocument).toHaveBeenCalledWith('7', 'pdf');
    await waitFor(() => expect(hrApi.getDocumentEvents).toHaveBeenCalledTimes(2));
  });

  it('error en la descarga (code re-leído del blob) muestra el mensaje es-PE en alerta y toast', async () => {
    const user = userEvent.setup();
    hrApi.getDocument.mockResolvedValue({ data: issued() });
    hrApi.downloadDocument.mockRejectedValue(httpError(404, 'pdf_not_available'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /descargar pdf/i }));
    // Banner de la página + toast: ambos con el mensaje es-PE.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    alerts.forEach((a) => expect(a).toHaveTextContent(/el pdf no está disponible para este documento/i));
    expect(hrApi.saveBlob).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeEnabled();
  });

  it('descarga fallida sin código (red) muestra mensaje de conexión', async () => {
    const user = userEvent.setup();
    hrApi.downloadDocument.mockRejectedValue(new Error('Network Error'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /descargar word/i }));
    const alerts = await screen.findAllByRole('alert');
    alerts.forEach((a) => expect(a).toHaveTextContent(/no hay conexión/i));
  });

  it('mientras descarga deshabilita ambos botones y no lanza una segunda petición', async () => {
    const user = userEvent.setup();
    hrApi.getDocument.mockResolvedValue({ data: issued() });
    hrApi.downloadDocument.mockReturnValue(new Promise(() => {}));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /descargar word/i }));
    expect(screen.getByRole('button', { name: /descargar word/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /descargar word/i }));
    expect(hrApi.downloadDocument).toHaveBeenCalledTimes(1);
  });
});

describe('Bitácora y datos', () => {
  it('lista los eventos con actor (o "Sistema") y fecha', async () => {
    hrApi.getDocumentEvents.mockResolvedValue({
      data: [
        { id: 1, action: 'CREATED', action_label: 'Creado', actor_name: 'Gerente', created_at: '2026-10-05T10:00:00-05:00' },
        { id: 2, action: 'PDF_RENDERED', action_label: 'PDF generado', actor_name: '', created_at: '2026-10-05T11:00:00-05:00' },
      ],
    });
    renderPage();
    const heading = await screen.findByRole('heading', { name: /bitácora/i });
    const section = heading.closest('section');
    expect(await within(section).findByText('Creado')).toBeInTheDocument();
    expect(within(section).getByText('PDF generado')).toBeInTheDocument();
    expect(within(section).getByText('Sistema')).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
  });

  it('acepta la bitácora paginada ({results})', async () => {
    hrApi.getDocumentEvents.mockResolvedValue({ data: { results: [{ id: 1, action: 'ISSUED', action_label: 'Emitido', actor_name: 'G', created_at: '2026-10-05T10:00:00-05:00' }] } });
    renderPage();
    expect(await screen.findByText('Emitido', { selector: 'span' })).toBeInTheDocument();
  });

  it('bitácora vacía', async () => {
    renderPage();
    expect(await screen.findByText(/sin eventos registrados/i)).toBeInTheDocument();
  });

  it('error en la bitácora no rompe el detalle y permite reintentar', async () => {
    const user = userEvent.setup();
    hrApi.getDocumentEvents.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/no se pudo cargar la bitácora/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /pérez ana/i })).toBeInTheDocument();
    hrApi.getDocumentEvents.mockResolvedValueOnce({ data: [{ id: 1, action: 'CREATED', action_label: 'Creado', actor_name: 'G', created_at: '2026-10-05T10:00:00-05:00' }] });
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText('Creado')).toBeInTheDocument();
  });

  it('si falla document-types muestra las claves en lugar de las etiquetas', async () => {
    hrApi.getDocumentTypes.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('worker_dni')).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();
  });

  it('un HTML en los datos se muestra como texto, no se interpreta', async () => {
    hrApi.getDocument.mockResolvedValue({
      data: documentDetail({ data: { worker_full_name: '<img src=x onerror=alert(1)>', worker_dni: '12345678' } }),
    });
    renderPage();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});
