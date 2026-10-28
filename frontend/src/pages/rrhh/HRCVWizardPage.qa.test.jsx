// QA ronda 1 (SYSPCC-023, iteración 2): ramas de error y modos del asistente que
// los otros archivos del wizard no cubren.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { analysisDetail, cvConfig } from '../../test/cvFixtures';
import { installMemoryLocalStorage } from '../../test/memoryStorage';
import LocationProbe from '../../test/LocationProbe';
import HRCVWizardPage from './HRCVWizardPage';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

function renderAt(entry) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/rrhh/cvs/nuevo" element={<HRCVWizardPage />} />
        <Route path="/rrhh/cvs/:id/preparar" element={<HRCVWizardPage />} />
        <Route path="/rrhh/cvs/:id" element={<p>PANTALLA RESULTADOS</p>} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: [entry] },
  );
}

const draft = (o = {}) => analysisDetail({ requirements: [], has_requirements: false, requirements_text: '', ...o });
const proposal = (o = {}) => ({
  source: 'text',
  position_title: null,
  requirements: [{ id: 1, text: 'Ingeniero civil colegiado', weight: 3 }],
  requirements_text: 'Ingeniero civil colegiado (obligatorio)',
  warnings: [],
  usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
  ...o,
});
const user = () => userEvent.setup({ applyAccept: false });
const cv = (name) => {
  const f = new File(['x'], name, { lastModified: 1 });
  Object.defineProperty(f, 'size', { value: 1000 });
  return f;
};

async function pasteAndRead(u, text = 'Se requiere ingeniero civil colegiado') {
  await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
  await u.click(screen.getByRole('radio', { name: /pegar texto/i }));
  await u.type(screen.getByLabelText('Texto de la convocatoria'), text);
  await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryLocalStorage();
  hrApi.getCVConfig.mockResolvedValue({ data: cvConfig() });
  hrApi.createCVAnalysis.mockResolvedValue({ data: draft() });
  hrApi.getCVAnalysis.mockResolvedValue({ data: draft() });
  hrApi.updateCVAnalysis.mockImplementation(async (id, payload) => ({ data: draft({ ...payload }) }));
  hrApi.extractCVPosting.mockResolvedValue({ data: proposal() });
  hrApi.uploadCVFiles.mockImplementation(async (id, files) => ({
    data: { accepted: files.map((f, i) => ({ id: i, original_name: f.name })), duplicates: [], rejected: [], counts: {} },
  }));
});

describe('Paso 1 — convocatoria sin IA (sin clave de Anthropic)', () => {
  const noKey = () => cvConfig({ enabled: false, posting: { ...cvConfig().posting, extraction: 'text' } });

  it('avisa con amabilidad que falta la clave pero deja leer la convocatoria por texto', async () => {
    hrApi.getCVConfig.mockResolvedValue({ data: noKey() });
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    expect(await screen.findByText(/clave de Anthropic/i)).toBeInTheDocument();
    await pasteAndRead(u);
    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    expect(hrApi.extractCVPosting).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Requisito 1')).toHaveValue('Ingeniero civil colegiado');
  });

  it('el paso 2 sigue bloqueado: no se sube ningún CV sin clave', async () => {
    hrApi.getCVConfig.mockResolvedValue({ data: noKey() });
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail() });
    const u = user();
    renderAt('/rrhh/cvs/5/preparar?paso=2');
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf')]);
    await u.click(await screen.findByRole('button', { name: /Analizar 1 CV/ }));
    expect(hrApi.uploadCVFiles).not.toHaveBeenCalled();
  });
});

describe('Paso 1 — modo de prueba (proveedor simulado)', () => {
  it('muestra el aviso y deja avanzar de punta a punta sin la clave', async () => {
    const config = cvConfig({ provider: 'fake', simulated: true, posting: { ...cvConfig().posting, extraction: 'fake' } });
    hrApi.getCVConfig.mockResolvedValue({ data: config });
    hrApi.extractCVPosting.mockResolvedValue({ data: proposal({ source: 'fake', warnings: [{ code: 'simulated', detail: 'Modo de prueba: requisitos simulados.' }] }) });
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    expect(await screen.findByText(/modo de prueba/i)).toBeInTheDocument();
    await pasteAndRead(u);
    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    // el aviso "simulated" va una sola vez, en el banner, no repetido como aviso amable
    expect(screen.getAllByText(/modo de prueba/i)).toHaveLength(1);
  });
});

describe('Paso 1 — errores de la lectura', () => {
  it('si el servidor responde requirements_locked, pasa a la vista bloqueada con la salida a los resultados', async () => {
    hrApi.extractCVPosting.mockRejectedValue({
      response: { status: 409, data: { code: 'requirements_locked', detail: 'Ya hay CVs analizados con estos requisitos; la convocatoria ya no se puede cambiar.' } },
    });
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await pasteAndRead(u);
    expect(await screen.findByText('Ya hay CVs analizados con estos requisitos; la convocatoria ya no se puede cambiar.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /resultados/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); // sin edición
  });

  it('un corte de red o timeout muestra un mensaje en español, sin texto técnico, y permite reintentar', async () => {
    hrApi.extractCVPosting.mockRejectedValueOnce(Object.assign(new Error('timeout of 90000ms exceeded'), { code: 'ECONNABORTED' }));
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await pasteAndRead(u);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/timeout of|ECONNABORTED|Network Error/);
    hrApi.extractCVPosting.mockResolvedValue({ data: proposal() });
    await u.click(screen.getByRole('button', { name: 'Probar de nuevo' }));
    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    expect(hrApi.createCVAnalysis).toHaveBeenCalledTimes(1);
  });

  it('un doble clic en "Leer convocatoria" no crea dos análisis', async () => {
    let release;
    hrApi.createCVAnalysis.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: draft() }); }));
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    await u.click(screen.getByRole('radio', { name: /pegar texto/i }));
    await u.type(screen.getByLabelText('Texto de la convocatoria'), 'Se requiere ingeniero');
    const btn = screen.getByRole('button', { name: 'Leer convocatoria' });
    await u.dblClick(btn);
    release();
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });
    expect(hrApi.createCVAnalysis).toHaveBeenCalledTimes(1);
  });

  it('un nombre en blanco no llama al servidor', async () => {
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await u.type(await screen.findByLabelText('Nombre del análisis'), '     ');
    await u.click(screen.getByRole('radio', { name: /pegar texto/i }));
    await u.type(screen.getByLabelText('Texto de la convocatoria'), 'Se requiere ingeniero');
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    expect(hrApi.createCVAnalysis).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Nombre del análisis')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Paso 2 — límites y fallas del servidor', () => {
  async function pick() {
    const u = user();
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail() });
    renderAt('/rrhh/cvs/5/preparar?paso=2');
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 1 CV' }));
    return u;
  }

  it.each([
    [409, 'analysis_limit_reached', 'Este análisis llegó a su límite de CVs.'],
    [503, 'analysis_unavailable', 'Falta la clave de Anthropic. Avisa al administrador.'], // 5xx: texto propio, nunca el del backend
    [429, 'daily_limit_reached', 'Hoy llegaste al límite de CVs.'],
  ])('%s %s se explica con el mensaje del servidor, sin reintentos automáticos y sin salir del paso', async (status, code, detail) => {
    hrApi.uploadCVFiles.mockRejectedValue({ response: { status, data: { code, detail: status === 503 ? 'Texto del backend que no se muestra.' : detail } } });
    await pick();
    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(hrApi.uploadCVFiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('PANTALLA RESULTADOS')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Analizar|Reintentar/ })).toBeEnabled();
  });

  it('un 403 (rol sin permiso) muestra el aviso de permiso y no navega', async () => {
    hrApi.uploadCVFiles.mockRejectedValue({ response: { status: 403, data: { detail: 'x' } } });
    await pick();
    expect(await screen.findByText(/no tienes permiso/i)).toBeInTheDocument();
    expect(screen.queryByText('PANTALLA RESULTADOS')).not.toBeInTheDocument();
  });
});
