import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { CONTRACT_SPEC, activeTemplate } from '../../test/hrFixtures';
import HRTemplatesPage from './HRTemplatesPage';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

beforeEach(() => {
  vi.clearAllMocks();
  hrApi.getDocumentTypes.mockResolvedValue({ data: [CONTRACT_SPEC] });
});

describe('HRTemplatesPage', () => {
  it('bloquea la activación de versiones con variables desconocidas y lo explica', async () => {
    hrApi.getTemplates.mockResolvedValue({
      data: {
        count: 2,
        results: [
          activeTemplate({ id: 1, version: 1, is_active: true }),
          activeTemplate({ id: 2, version: 2, is_active: false, unknown_variables: ['sueldo_mensual'], missing_required_variables: ['dni_trabajador'] }),
        ],
      },
    });
    renderWithProviders(<HRTemplatesPage />);

    const activate = await screen.findByRole('button', { name: /activar esta versión/i });
    expect(activate).toBeDisabled();
    expect(activate).toHaveAccessibleDescription(/variables que el sistema no reconoce/i);
    expect(screen.getByText('{{ sueldo_mensual }}')).toBeInTheDocument();
    expect(screen.getByText(/obligatorias que la plantilla no usa/i)).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
  });

  it('activa una versión válida y recarga la lista', async () => {
    hrApi.getTemplates.mockResolvedValue({
      data: { count: 1, results: [activeTemplate({ id: 3, version: 3, is_active: false })] },
    });
    hrApi.activateTemplate.mockResolvedValue({ data: {} });
    renderWithProviders(<HRTemplatesPage />);

    await userEvent.setup().click(await screen.findByRole('button', { name: /activar esta versión/i }));
    await waitFor(() => expect(hrApi.activateTemplate).toHaveBeenCalledWith(3));
    await waitFor(() => expect(hrApi.getTemplates).toHaveBeenCalledTimes(2));
  });

  it('valida nombre y archivo .docx antes de subir', async () => {
    hrApi.getTemplates.mockResolvedValue({ data: { count: 0, results: [] } });
    const user = userEvent.setup();
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);

    await user.click(screen.getByRole('button', { name: /subir plantilla/i }));
    expect(screen.getByText(/escribe un nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nombre/i)).toHaveAttribute('aria-invalid', 'true');
    expect(hrApi.uploadTemplate).not.toHaveBeenCalled();
  });

  it('muestra el error es-PE del backend al subir un archivo con macros', async () => {
    hrApi.getTemplates.mockResolvedValue({ data: { count: 0, results: [] } });
    hrApi.uploadTemplate.mockRejectedValue({ response: { status: 400, data: { code: 'macros_not_allowed', detail: null } } });
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);

    await user.type(screen.getByLabelText(/^nombre/i), 'Contrato v2');
    await user.upload(screen.getByLabelText(/archivo word/i), new File(['x'], 'c.docx'));
    await user.click(screen.getByRole('button', { name: /subir plantilla/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/contiene macros/i);
  });

  it('error al listar usa la concordancia correcta en plural', async () => {
    hrApi.getTemplates.mockRejectedValue({ response: { status: 400, data: {} } });
    renderWithProviders(<HRTemplatesPage />);
    expect(await screen.findByText(/no se pudieron cargar las plantillas/i)).toBeInTheDocument();
  });
});
