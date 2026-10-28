import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { analysisDetail, cvConfig } from '../../test/cvFixtures';
import { installMemoryLocalStorage } from '../../test/memoryStorage';
import LocationProbe from '../../test/LocationProbe';
import HRCVWizardPage from './HRCVWizardPage';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

function renderWizard(entry = '/rrhh/cvs/nuevo') {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/rrhh/cvs/nuevo" element={<HRCVWizardPage />} />
        <Route path="/rrhh/cvs/:id/preparar" element={<HRCVWizardPage />} />
        <Route path="/rrhh/cvs/:id" element={<p>PANTALLA RESULTADOS</p>} />
        <Route path="/rrhh/cvs" element={<p>PANTALLA LISTA</p>} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: [entry] },
  );
}

const draft = (o = {}) => analysisDetail({ requirements: [], has_requirements: false, requirements_text: '', ...o });
const pdf = (name = 'convocatoria.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });
const cv = (name, size = 1000) => {
  const f = new File(['x'], name, { lastModified: 1 });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const user = () => userEvent.setup({ applyAccept: false });

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryLocalStorage();
  hrApi.getCVConfig.mockResolvedValue({ data: cvConfig() });
  hrApi.createCVAnalysis.mockResolvedValue({ data: draft() });
  hrApi.getCVAnalysis.mockResolvedValue({ data: draft() });
  hrApi.updateCVAnalysis.mockImplementation(async (id, payload) => ({ data: draft({ ...payload }) }));
});

describe('Paso 1 — archivo de la convocatoria', () => {
  it('al elegir un archivo el foco pasa a "Cambiar archivo" y se anuncia cuál se eligió', async () => {
    const u = user();
    renderWizard();
    await screen.findByLabelText('Nombre del análisis');
    // Como en el navegador: el botón "Elegir archivo" tiene el foco al abrirse el diálogo del sistema.
    await u.click(screen.getByRole('button', { name: 'Elegir archivo' }));
    fireEvent.change(screen.getByTestId('posting-file-input'), { target: { files: [pdf('aviso-residente.pdf')] } });
    const change = await screen.findByRole('button', { name: 'Cambiar archivo' });
    expect(change).toHaveFocus();
    const status = screen.getAllByRole('status').find((el) => /Archivo elegido/.test(el.textContent));
    expect(status).toHaveTextContent('Archivo elegido: aviso-residente.pdf');
  });

  it('al quitar el archivo el foco vuelve a "Elegir archivo"', async () => {
    const u = user();
    renderWizard();
    await screen.findByLabelText('Nombre del análisis');
    await u.upload(screen.getByTestId('posting-file-input'), pdf());
    await u.click(await screen.findByRole('button', { name: 'Quitar' }));
    expect(await screen.findByRole('button', { name: 'Elegir archivo' })).toHaveFocus();
  });

  it('un archivo con formato no admitido muestra el error con role="alert" y sin aria-invalid en el botón', async () => {
    const u = user();
    renderWizard();
    await screen.findByLabelText('Nombre del análisis');
    await u.upload(screen.getByTestId('posting-file-input'), new File(['x'], 'macro.exe'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Formato no admitido');
    expect(screen.getByRole('button', { name: 'Elegir archivo' })).not.toHaveAttribute('aria-invalid');
  });
});

describe('Paso 1 — leyendo la convocatoria', () => {
  afterEach(() => vi.useRealTimers());

  it('pasados ~30 s cambia el mensaje (no queda una promesa de tiempo incumplida)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ applyAccept: false, advanceTimers: vi.advanceTimersByTime });
    hrApi.extractCVPosting.mockImplementation(() => new Promise(() => {}));
    hrApi.uploadCVPosting.mockResolvedValue({ data: draft({ has_posting: true }) });
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    await u.upload(screen.getByTestId('posting-file-input'), pdf());
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    expect(await screen.findByText('Suele tardar menos de un minuto.')).toBeInTheDocument();
    expect(screen.queryByText(/tardando más de lo normal/)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30500);
    });
    const slow = screen.getByText('Está tardando más de lo normal. Puedes esperar o cancelar.');
    expect(slow.closest('[role="status"]')).not.toBeNull(); // dentro de la región viva
    expect(screen.queryByText('Suele tardar menos de un minuto.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });
});

describe('Paso 1 — requisitos', () => {
  const withProposal = {
    pathname: '/rrhh/cvs/5/preparar',
    search: '?paso=1',
    state: {
      proposal: {
        source: 'ai',
        position_title: null,
        requirements: [
          { id: 1, text: 'Ingeniero civil colegiado', weight: 3 },
          { id: 2, text: '5 años en obras viales', weight: 1 },
        ],
        warnings: [],
      },
    },
  };

  it('"Usar estos requisitos" no se deshabilita (aria-disabled) mientras guarda y no guarda dos veces', async () => {
    const u = user();
    let release;
    hrApi.getCVAnalysis.mockResolvedValue({ data: draft({ has_posting: true }) });
    hrApi.updateCVAnalysis.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: draft() }); }));
    renderWizard(withProposal);
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });
    const button = screen.getByRole('button', { name: 'Usar estos requisitos' });
    await u.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    await u.click(button);
    expect(hrApi.updateCVAnalysis).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it('quitar y deshacer devuelve el foco a la tarjeta restaurada y la fila de aviso es una región viva fija', async () => {
    const u = user();
    hrApi.getCVAnalysis.mockResolvedValue({ data: draft({ has_posting: true }) });
    renderWizard(withProposal);
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });
    await u.click(screen.getByRole('button', { name: 'Quitar requisito 1' }));
    const note = screen.getAllByRole('status').find((el) => el.textContent === 'Quitaste un requisito.');
    expect(note).toBeDefined();
    await u.click(screen.getByRole('button', { name: /deshacer/i }));
    await waitFor(() => expect(screen.getByLabelText('Requisito 1')).toHaveFocus());
    expect(screen.getByLabelText('Requisito 1')).toHaveValue('Ingeniero civil colegiado');
  });
});

describe('Paso 2 — subida', () => {
  const renderStep2 = (analysis = analysisDetail()) => {
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysis });
    return renderWizard('/rrhh/cvs/5/preparar?paso=2');
  };

  it('si la subida termina con resultado parcial, el foco va al aviso y no a <body>', async () => {
    const u = user();
    const cfg = cvConfig();
    cfg.limits.batch_size = 1;
    hrApi.getCVConfig.mockResolvedValue({ data: cfg });
    hrApi.uploadCVFiles.mockImplementation(async (id, files) => {
      if (files[0].name === 'b.pdf') throw { message: 'Network Error' };
      return { data: { accepted: files.map((f, i) => ({ id: i, original_name: f.name })), duplicates: [], rejected: [], counts: {} } };
    });
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 2 CVs' }));
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(/Se subieron 1 de 2/);
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('el botón "Reintentar" de un archivo con falla de red dice cuál archivo reintenta', async () => {
    const u = user();
    const cfg = cvConfig();
    cfg.limits.batch_size = 1;
    hrApi.getCVConfig.mockResolvedValue({ data: cfg });
    hrApi.uploadCVFiles.mockImplementation(async (id, files) => {
      if (files[0].name === 'b.pdf') throw { message: 'Network Error' };
      return { data: { accepted: files.map((f, i) => ({ id: i, original_name: f.name })), duplicates: [], rejected: [], counts: {} } };
    });
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 2 CVs' }));
    const retry = await screen.findByRole('button', { name: 'Reintentar b.pdf' }, { timeout: 3000 });
    expect(retry).toHaveTextContent('Reintentar');
  });

  it('los requisitos obligatorios del resumen dicen "Obligatorio:" con texto, no con aria-label sobre un icono', async () => {
    renderStep2();
    const summary = (await screen.findByText('Ver requisitos (2)')).closest('details');
    const list = within(summary).getByRole('list');
    expect(list.querySelectorAll('svg[aria-label]')).toHaveLength(0);
    expect(list).toHaveTextContent('Obligatorio: Ingeniero civil colegiado');
  });
});
