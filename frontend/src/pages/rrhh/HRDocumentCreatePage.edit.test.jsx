import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import { CONTRACT_SPEC, activeTemplate, documentDetail } from '../../test/hrFixtures';
import HRDocumentCreatePage from './HRDocumentCreatePage';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

const FULL_DATA = {
  worker_full_name: 'Pérez Ana',
  worker_dni: '12345678',
  worker_address: 'Av. Lima 123',
  position: 'Asistente',
  work_location: 'Oficina central',
  contract_type: 'INDEFINITE',
  start_date: '2026-11-01',
  gross_salary: '2000.00',
  currency: 'PEN',
  payment_frequency: 'MONTHLY',
  work_schedule: '48 horas semanales',
  probation_months: 3,
  issue_date: '2026-10-30',
};

function renderEdit() {
  return renderWithProviders(
    <Routes>
      <Route path="/rrhh/documentos/:id/editar" element={<HRDocumentCreatePage />} />
      <Route path="/rrhh/documentos/:id" element={<p>Detalle del documento 7</p>} />
    </Routes>,
    { route: '/rrhh/documentos/7/editar' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hrApi.getDocumentTypes.mockResolvedValue({ data: [CONTRACT_SPEC] });
  hrApi.getTemplates.mockResolvedValue({ data: { results: [activeTemplate()] } });
  hrApi.getAssistantStatus.mockResolvedValue({ data: { enabled: false } });
  hrApi.getDocument.mockResolvedValue({ data: documentDetail({ data: FULL_DATA }) });
});

describe('HRDocumentCreatePage — edición de borrador', () => {
  it('carga el borrador, precarga los valores y no ofrece el selector de trabajador', async () => {
    renderEdit();
    expect(await screen.findByRole('heading', { name: /editar borrador de contrato/i })).toBeInTheDocument();
    expect(hrApi.getDocument).toHaveBeenCalledWith('7');
    expect(screen.getByLabelText(/nombre completo del trabajador/i)).toHaveValue('Pérez Ana');
    expect(screen.getByLabelText(/^cargo/i)).toHaveValue('Asistente');
    expect(screen.getByLabelText(/sueldo/i)).toHaveValue('2000.00');
    expect(screen.queryByLabelText(/buscar trabajador/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /guardar borrador/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /generar borrador/i })).not.toBeInTheDocument();
  });

  it('guardar hace PATCH con {data, template_id} (sin personal_id/source) y vuelve al detalle', async () => {
    const user = userEvent.setup();
    hrApi.updateDocument.mockResolvedValue({ data: { id: 7 } });
    renderEdit();
    const position = await screen.findByLabelText(/^cargo/i);
    await user.clear(position);
    await user.type(position, 'Coordinadora');
    await user.click(screen.getByRole('button', { name: /guardar borrador/i }));

    await screen.findByText('Detalle del documento 7');
    expect(hrApi.createDocument).not.toHaveBeenCalled();
    expect(hrApi.updateDocument).toHaveBeenCalledTimes(1);
    const [id, payload] = hrApi.updateDocument.mock.calls[0];
    expect(id).toBe('7');
    expect(Object.keys(payload).sort()).toEqual(['data', 'template_id']);
    expect(payload.template_id).toBe(1);
    expect(payload.data).toMatchObject({ position: 'Coordinadora', worker_dni: '12345678', gross_salary: '2000.00' });
    expect(await screen.findByText('Detalle del documento 7')).toBeInTheDocument();
  });

  it('un documento emitido no se puede editar: error con reintento, sin formulario', async () => {
    hrApi.getDocument.mockResolvedValue({ data: documentDetail({ status: 'ISSUED', data: FULL_DATA }) });
    renderEdit();
    expect(await screen.findByText(/solo se pueden editar documentos en borrador/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /guardar borrador/i })).not.toBeInTheDocument();
  });

  it('404 al cargar el borrador muestra el mensaje y permite reintentar', async () => {
    const user = userEvent.setup();
    hrApi.getDocument.mockRejectedValueOnce({ response: { status: 404, data: {} } });
    renderEdit();
    expect(await screen.findByText(/no se encontró el recurso/i)).toBeInTheDocument();
    hrApi.getDocument.mockResolvedValueOnce({ data: documentDetail({ data: FULL_DATA }) });
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByRole('heading', { name: /editar borrador/i })).toBeInTheDocument();
  });

  it('error de validación del cliente al editar no llama a la API', async () => {
    const user = userEvent.setup();
    renderEdit();
    const dni = await screen.findByLabelText(/dni \/ documento/i);
    await user.clear(dni);
    await user.type(dni, '12');
    await user.click(screen.getByRole('button', { name: /guardar borrador/i }));
    expect(await screen.findByText(/usa 8 dígitos/i)).toBeInTheDocument();
    expect(hrApi.updateDocument).not.toHaveBeenCalled();
  });

  it('409 invalid_state al guardar muestra el banner es-PE y permanece en el formulario', async () => {
    const user = userEvent.setup();
    hrApi.updateDocument.mockRejectedValue({ response: { status: 409, data: { code: 'invalid_state', detail: null } } });
    renderEdit();
    await user.click(await screen.findByRole('button', { name: /guardar borrador/i }));
    expect(await screen.findByText(/cambió de estado/i)).toBeInTheDocument();
    expect(screen.queryByText('Detalle del documento 7')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /guardar borrador/i })).toBeEnabled();
  });

  it('400 por campo del backend al guardar se pinta en el campo', async () => {
    const user = userEvent.setup();
    hrApi.updateDocument.mockRejectedValue({
      response: { status: 400, data: { detail: { position: ['Cargo inválido en servidor.'] } } },
    });
    renderEdit();
    await user.click(await screen.findByRole('button', { name: /guardar borrador/i }));
    expect(await screen.findByText('Cargo inválido en servidor.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^cargo/i)).toHaveAttribute('aria-invalid', 'true'));
  });

  it('en vuelo deshabilita el botón y no duplica el guardado', async () => {
    const user = userEvent.setup();
    hrApi.updateDocument.mockReturnValue(new Promise(() => {}));
    renderEdit();
    await user.click(await screen.findByRole('button', { name: /guardar borrador/i }));
    const btn = await screen.findByRole('button', { name: /generando/i });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(hrApi.updateDocument).toHaveBeenCalledTimes(1);
  });

  it('si la plantilla del borrador ya no está activa, el select la muestra como versión anterior y envía ese mismo id', async () => {
    const user = userEvent.setup();
    hrApi.getTemplates.mockResolvedValue({ data: { results: [activeTemplate({ id: 2, version: 2, name: 'Contrato v2' })] } });
    hrApi.getDocument.mockResolvedValue({
      data: documentDetail({ data: FULL_DATA, template: { id: 1, name: 'Contrato v1', version: 1 } }),
    });
    hrApi.updateDocument.mockResolvedValue({ data: { id: 7 } });
    renderEdit();

    const select = await screen.findByLabelText(/plantilla activa/i);
    expect(select).toHaveValue('1');
    expect(screen.getByRole('option', { name: /contrato v1.*versión anterior, ya no activa/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /contrato v2 \(v2\)/i })).toBeInTheDocument();
    expect(screen.getByText(/ya no está activa/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await screen.findByText('Detalle del documento 7');
    expect(hrApi.updateDocument.mock.calls[0][1].template_id).toBe(1);
  });

  it('permite elegir explícitamente la plantilla activa y envía su id', async () => {
    const user = userEvent.setup();
    hrApi.getTemplates.mockResolvedValue({ data: { results: [activeTemplate({ id: 2, version: 2, name: 'Contrato v2' })] } });
    hrApi.getDocument.mockResolvedValue({
      data: documentDetail({ data: FULL_DATA, template: { id: 1, name: 'Contrato v1', version: 1 } }),
    });
    hrApi.updateDocument.mockResolvedValue({ data: { id: 7 } });
    renderEdit();

    await user.selectOptions(await screen.findByLabelText(/plantilla activa/i), '2');
    await user.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await screen.findByText('Detalle del documento 7');
    expect(hrApi.updateDocument.mock.calls[0][1].template_id).toBe(2);
  });
});
