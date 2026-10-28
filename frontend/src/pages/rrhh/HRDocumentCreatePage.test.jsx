import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import { CONTRACT_SPEC, activeTemplate } from '../../test/hrFixtures';
import HRDocumentCreatePage from './HRDocumentCreatePage';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/rrhh/documentos/nuevo" element={<HRDocumentCreatePage />} />
      <Route path="/rrhh/documentos/:id" element={<p>Detalle del documento 99</p>} />
    </Routes>,
    { route: '/rrhh/documentos/nuevo' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hrApi.getDocumentTypes.mockResolvedValue({ data: [CONTRACT_SPEC] });
  hrApi.getTemplates.mockResolvedValue({ data: { results: [activeTemplate()] } });
  hrApi.getAssistantStatus.mockResolvedValue({ data: { enabled: false } });
});

async function fill(user, label, value) {
  const el = screen.getByLabelText(label);
  await user.clear(el);
  await user.type(el, value);
}

describe('HRDocumentCreatePage', () => {
  it('muestra errores por campo y marca aria-invalid al enviar vacío', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });

    await user.click(screen.getByRole('button', { name: /generar borrador/i }));

    const name = screen.getByLabelText(/nombre completo del trabajador/i);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('Este campo es obligatorio.').length).toBeGreaterThan(3);
    expect(hrApi.createDocument).not.toHaveBeenCalled();
    await waitFor(() => expect(name).toHaveFocus());
  });

  it('plazo fijo exige fecha de fin posterior a la de inicio', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });

    // Con plazo indeterminado no existe el campo de fecha fin.
    expect(screen.queryByLabelText(/fecha de fin/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/tipo de contrato/i), 'FIXED_TERM');
    expect(screen.getByLabelText(/fecha de fin/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/modalidad/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/fecha de inicio/i), '2026-11-10');
    await user.type(screen.getByLabelText(/fecha de fin/i), '2026-11-01');
    await user.click(screen.getByRole('button', { name: /generar borrador/i }));

    expect(await screen.findByText(/fecha de fin debe ser posterior/i)).toBeInTheDocument();
    expect(hrApi.createDocument).not.toHaveBeenCalled();
  });

  it('valida DNI y sueldo en el cliente', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });

    await fill(user, /dni \/ documento/i, '123');
    await fill(user, /sueldo/i, '-5');
    await user.click(screen.getByRole('button', { name: /generar borrador/i }));

    expect(await screen.findByText(/usa 8 dígitos/i)).toBeInTheDocument();
    expect(screen.getByText(/monto válido/i)).toBeInTheDocument();
  });

  it('envía el payload correcto y navega al detalle', async () => {
    const user = userEvent.setup();
    hrApi.createDocument.mockResolvedValue({ data: { id: 99 } });
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });

    await fill(user, /nombre completo del trabajador/i, 'Ana Pérez');
    await fill(user, /dni \/ documento/i, '12345678');
    await fill(user, /domicilio/i, 'Av. Lima 123');
    await fill(user, /^cargo/i, 'Asistente');
    await fill(user, /lugar de trabajo/i, 'Oficina central');
    await user.selectOptions(screen.getByLabelText(/tipo de contrato/i), 'INDEFINITE');
    await user.type(screen.getByLabelText(/fecha de inicio/i), '2026-11-01');
    await fill(user, /sueldo/i, '2000.00');
    await fill(user, /jornada|horario/i, '48 horas semanales');

    await user.click(screen.getByRole('button', { name: /generar borrador/i }));

    await screen.findByText(/detalle del documento 99/i);
    expect(hrApi.createDocument).toHaveBeenCalledTimes(1);
    const payload = hrApi.createDocument.mock.calls[0][0];
    expect(payload).toMatchObject({
      document_type: 'CONTRACT',
      template_id: 1,
      source: 'MANUAL',
    });
    expect(payload.data).toMatchObject({
      worker_full_name: 'Ana Pérez',
      worker_dni: '12345678',
      contract_type: 'INDEFINITE',
      gross_salary: '2000.00',
      currency: 'PEN',
      probation_months: 3,
    });
    expect(payload.data).not.toHaveProperty('end_date');
  });

  it('mapea errores 400 del backend al campo correspondiente', async () => {
    const user = userEvent.setup();
    hrApi.createDocument.mockRejectedValue({
      response: { status: 400, data: { error: true, status_code: 400, detail: { worker_dni: ['Documento inválido en servidor.'] } } },
    });
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });

    await fill(user, /nombre completo del trabajador/i, 'Ana Pérez');
    await fill(user, /dni \/ documento/i, '12345678');
    await fill(user, /domicilio/i, 'Av. Lima 123');
    await fill(user, /^cargo/i, 'Asistente');
    await fill(user, /lugar de trabajo/i, 'Oficina');
    await user.selectOptions(screen.getByLabelText(/tipo de contrato/i), 'INDEFINITE');
    await user.type(screen.getByLabelText(/fecha de inicio/i), '2026-11-01');
    await fill(user, /sueldo/i, '2000');
    await fill(user, /jornada|horario/i, '48 horas');
    await user.click(screen.getByRole('button', { name: /generar borrador/i }));

    expect(await screen.findByText('Documento inválido en servidor.')).toBeInTheDocument();
    expect(screen.getByLabelText(/dni \/ documento/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('avisa y deshabilita el envío si no hay plantilla activa', async () => {
    hrApi.getTemplates.mockResolvedValue({ data: { results: [] } });
    renderPage();
    expect(await screen.findByText(/no hay una plantilla activa/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ir a plantillas/i })).toHaveAttribute('href', '/rrhh/plantillas');
    expect(screen.getByRole('button', { name: /generar borrador/i })).toBeDisabled();
  });

  it('prellena desde Personal sin pisar lo ya tecleado y resalta faltantes', async () => {
    const user = userEvent.setup();
    hrApi.searchPersonal.mockResolvedValue({
      data: { results: [{ id: 5, dni: '87654321', apellidos_nombres: 'Quispe Luis', puesto: 'Maestro', estado: 'ACTIVO' }] },
    });
    hrApi.getPersonalPrefill.mockResolvedValue({
      data: {
        data: { worker_full_name: 'Quispe Luis', worker_dni: '87654321', position: 'Maestro' },
        sources: {},
        missing: [{ field: 'worker_address', label: 'Domicilio', question: '¿Cuál es el domicilio del trabajador?' }],
      },
    });
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });

    await fill(user, /^cargo/i, 'Capataz');
    await user.type(screen.getByLabelText(/buscar trabajador/i), 'Quispe');
    await user.click(await screen.findByRole('button', { name: /quispe luis/i }));

    await waitFor(() => expect(screen.getByLabelText(/nombre completo del trabajador/i)).toHaveValue('Quispe Luis'));
    expect(screen.getByLabelText(/^cargo/i)).toHaveValue('Capataz');
    expect(screen.getByLabelText(/domicilio/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/cuál es el domicilio del trabajador/i)).toBeInTheDocument();
  });

  it('prellena el período de prueba con el default del backend (constraints)', async () => {
    hrApi.getDocumentTypes.mockResolvedValue({
      data: [{ ...CONTRACT_SPEC, constraints: { min_wage: '1130.00', default_probation_months: 6 } }],
    });
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });
    expect(screen.getByLabelText(/período de prueba|periodo de prueba/i)).toHaveValue('6');
  });

  it('bloquea sueldo menor al mínimo con el monto formateado', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });
    await fill(user, /sueldo/i, '1129.99');
    await user.click(screen.getByRole('button', { name: /generar borrador/i }));
    expect(await screen.findByText(/menor a la remuneración mínima vital vigente \(S\/ 1,130\.00\)/i)).toBeInTheDocument();
    expect(hrApi.createDocument).not.toHaveBeenCalled();
  });

  it('acepta exactamente el mínimo (comparación decimal, sin floats)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });
    await fill(user, /sueldo/i, '1130');
    await user.click(screen.getByRole('button', { name: /generar borrador/i }));
    await screen.findAllByText('Este campo es obligatorio.');
    expect(screen.queryByText(/remuneración mínima/i)).not.toBeInTheDocument();
  });

  it('la modalidad "De temporada" aparece en el formulario (viene de document-types)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /nuevo contrato de trabajo/i });
    await user.selectOptions(screen.getByLabelText(/tipo de contrato/i), 'FIXED_TERM');
    expect(screen.getByRole('option', { name: 'De temporada' })).toHaveValue('TEMPORADA');
  });
});
