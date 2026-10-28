import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { CONTRACT_SPEC, activeTemplate } from '../../test/hrFixtures';
import HRTemplatesPage from './HRTemplatesPage';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

const empty = { data: { count: 0, results: [] } };
const err = (status, code, detail = null) => ({ response: { status, data: { code, detail } } });

function fileOfSize(name, size) {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

async function fillUpload(user, file, name = 'Contrato v2') {
  await user.type(screen.getByLabelText(/^nombre/i), name);
  if (file) await user.upload(screen.getByLabelText(/archivo word/i), file);
  await user.click(screen.getByRole('button', { name: /subir plantilla/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  hrApi.getDocumentTypes.mockResolvedValue({ data: [CONTRACT_SPEC] });
  hrApi.getTemplates.mockResolvedValue(empty);
});

describe('HRTemplatesPage — subida', () => {
  it('sube un .docx válido con los campos limpios y recorta nombre/slug/notas', async () => {
    const user = userEvent.setup({ applyAccept: false });
    hrApi.uploadTemplate.mockResolvedValue({ data: { version: 2, unknown_variables: [] } });
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);

    const file = new File(['x'], 'contrato.docx');
    await user.type(screen.getByLabelText(/^nombre/i), '  Contrato v2  ');
    await user.type(screen.getByLabelText(/notas/i), '  nota  ');
    await user.upload(screen.getByLabelText(/archivo word/i), file);
    await user.click(screen.getByRole('button', { name: /subir plantilla/i }));

    await waitFor(() => expect(hrApi.uploadTemplate).toHaveBeenCalledTimes(1));
    expect(hrApi.uploadTemplate).toHaveBeenCalledWith({
      document_type: 'CONTRACT', name: 'Contrato v2', slug: undefined, notes: 'nota', file,
    });
    expect(await screen.findByText(/versión 2 subida\. revisa las variables/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^nombre/i)).toHaveValue('');
    await waitFor(() => expect(hrApi.getTemplates).toHaveBeenCalledTimes(2));
  });

  it('rechaza una extensión distinta de .docx sin llamar a la API y enfoca el archivo', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);
    await fillUpload(user, new File(['x'], 'contrato.pdf'));
    expect(await screen.findByText(/debe ser un documento word \(\.docx\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/archivo word/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/archivo word/i)).toHaveFocus();
    expect(hrApi.uploadTemplate).not.toHaveBeenCalled();
  });

  it('la extensión se valida sin distinguir mayúsculas (.DOCX)', async () => {
    const user = userEvent.setup({ applyAccept: false });
    hrApi.uploadTemplate.mockResolvedValue({ data: { version: 1, unknown_variables: [] } });
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);
    await fillUpload(user, new File(['x'], 'CONTRATO.DOCX'));
    await waitFor(() => expect(hrApi.uploadTemplate).toHaveBeenCalled());
  });

  it('rechaza archivos de más de 5 MB y acepta exactamente 5 MB', async () => {
    const user = userEvent.setup({ applyAccept: false });
    hrApi.uploadTemplate.mockResolvedValue({ data: { version: 1, unknown_variables: [] } });
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);

    await fillUpload(user, fileOfSize('grande.docx', 5 * 1024 * 1024 + 1));
    expect(await screen.findByText(/supera el tamaño máximo permitido \(5 MB\)/i)).toBeInTheDocument();
    expect(hrApi.uploadTemplate).not.toHaveBeenCalled();

    await user.upload(screen.getByLabelText(/archivo word/i), fileOfSize('justo.docx', 5 * 1024 * 1024));
    await user.click(screen.getByRole('button', { name: /subir plantilla/i }));
    await waitFor(() => expect(hrApi.uploadTemplate).toHaveBeenCalledTimes(1));
  });

  it('sin nombre enfoca el nombre; sin archivo pide seleccionar uno', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);
    await user.click(screen.getByRole('button', { name: /subir plantilla/i }));
    expect(screen.getByLabelText(/^nombre/i)).toHaveFocus();
    expect(screen.getByText(/selecciona un archivo \.docx/i)).toBeInTheDocument();
  });

  it('la subida con variables desconocidas avisa que no se podrá activar', async () => {
    const user = userEvent.setup({ applyAccept: false });
    hrApi.uploadTemplate.mockResolvedValue({ data: { version: 3, unknown_variables: ['sueldo_mensual'] } });
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);
    await fillUpload(user, new File(['x'], 'c.docx'));
    expect(await screen.findByText(/versión 3 subida, pero tiene variables desconocidas/i)).toBeInTheDocument();
  });

  it.each([
    ['invalid_docx', 400, /no es un documento word/i],
    ['file_too_large', 413, /supera el tamaño máximo/i],
    ['external_links_not_allowed', 400, /vínculos externos/i],
    ['template_syntax_error', 400, /error en sus variables/i],
    ['template_version_conflict', 409, /al mismo tiempo/i],
  ])('error %s del backend se muestra en una alerta es-PE y conserva lo tecleado', async (code, status, re) => {
    const user = userEvent.setup({ applyAccept: false });
    hrApi.uploadTemplate.mockRejectedValue(err(status, code));
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);
    await fillUpload(user, new File(['x'], 'c.docx'), 'Mi plantilla');
    expect(await screen.findByRole('alert')).toHaveTextContent(re);
    expect(screen.getByLabelText(/^nombre/i)).toHaveValue('Mi plantilla');
    expect(screen.getByRole('button', { name: /subir plantilla/i })).toBeEnabled();
  });

  it('en vuelo muestra "Subiendo…" y no permite doble envío', async () => {
    const user = userEvent.setup({ applyAccept: false });
    hrApi.uploadTemplate.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByText(/aún no hay plantillas/i);
    await fillUpload(user, new File(['x'], 'c.docx'));
    const btn = await screen.findByRole('button', { name: /subiendo/i });
    expect(btn).toBeDisabled();
    expect(hrApi.uploadTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('HRTemplatesPage — lista, activación y descarga', () => {
  it('estado de carga, error con reintento y vacío', async () => {
    const user = userEvent.setup();
    hrApi.getTemplates.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<HRTemplatesPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    hrApi.getTemplates.mockResolvedValueOnce(empty);
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText(/aún no hay plantillas/i)).toBeInTheDocument();
  });

  it('solo las versiones inactivas ofrecen Activar', async () => {
    hrApi.getTemplates.mockResolvedValue({
      data: { count: 2, results: [activeTemplate({ id: 1, version: 2, is_active: true }), activeTemplate({ id: 2, version: 1, is_active: false })] },
    });
    renderWithProviders(<HRTemplatesPage />);
    await screen.findAllByRole('button', { name: /descargar \.docx/i });
    expect(screen.getAllByRole('button', { name: /activar esta versión/i })).toHaveLength(1);
  });

  it('una activación fallida muestra el error es-PE y no recarga como éxito', async () => {
    const user = userEvent.setup();
    hrApi.getTemplates.mockResolvedValue({ data: { count: 1, results: [activeTemplate({ id: 3, is_active: false })] } });
    hrApi.activateTemplate.mockRejectedValue(err(400, 'template_has_unknown_variables'));
    renderWithProviders(<HRTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: /activar esta versión/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/variables que el sistema no reconoce/i);
    expect(hrApi.getTemplates).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /activar esta versión/i })).toBeEnabled();
  });

  it('no permite activar con variables desconocidas aunque se haga click', async () => {
    const user = userEvent.setup();
    hrApi.getTemplates.mockResolvedValue({
      data: { count: 1, results: [activeTemplate({ id: 4, is_active: false, unknown_variables: ['x_y'] })] },
    });
    renderWithProviders(<HRTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: /activar esta versión/i }));
    expect(hrApi.activateTemplate).not.toHaveBeenCalled();
  });

  it('descarga la plantilla por blob; si falla muestra el error', async () => {
    const user = userEvent.setup();
    hrApi.getTemplates.mockResolvedValue({ data: { count: 1, results: [activeTemplate({ id: 5 })] } });
    hrApi.downloadTemplate.mockResolvedValueOnce({ blob: new Blob(['x']), filename: 'plantilla.docx' });
    renderWithProviders(<HRTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: /descargar \.docx/i }));
    await waitFor(() => expect(hrApi.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'plantilla.docx'));
    expect(hrApi.downloadTemplate).toHaveBeenCalledWith(5);

    hrApi.downloadTemplate.mockRejectedValueOnce(err(404, 'template_file_missing'));
    await user.click(screen.getByRole('button', { name: /descargar \.docx/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se encontró el archivo de la plantilla/i);
  });

  it('con más de una página pagina las plantillas', async () => {
    const user = userEvent.setup();
    hrApi.getTemplates.mockImplementation(async ({ page }) => ({
      data: { count: 25, results: [activeTemplate({ id: page, version: page, is_active: false })] },
    }));
    renderWithProviders(<HRTemplatesPage />);
    await screen.findByRole('button', { name: /activar esta versión/i });
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(hrApi.getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('muestra la guía de variables agrupada desde document-types', async () => {
    renderWithProviders(<HRTemplatesPage />);
    const summary = await screen.findByText(/guía de variables para el word/i);
    expect(summary).toBeInTheDocument();
    const details = summary.closest('details');
    expect(within(details).getAllByRole('list').length).toBeGreaterThan(0);
  });

  it('si falla document-types la página sigue funcionando sin guía', async () => {
    hrApi.getDocumentTypes.mockRejectedValue(new Error('boom'));
    renderWithProviders(<HRTemplatesPage />);
    expect(await screen.findByText(/aún no hay plantillas/i)).toBeInTheDocument();
    expect(screen.queryByText(/guía de variables/i)).not.toBeInTheDocument();
  });
});
