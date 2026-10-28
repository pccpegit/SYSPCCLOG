// QA ronda 2 (SYSPCC-023, iteración 2): respuestas nuevas del servidor tras los fixes de la ronda 1
// (candado de lectura, topes de IA, avisos de la lectura) vistas desde el asistente.
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
  source: 'ai',
  position_title: null,
  requirements: [{ id: 1, text: 'Ingeniero civil colegiado', weight: 3 }],
  requirements_text: 'Ingeniero civil colegiado (obligatorio)',
  warnings: [],
  usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 },
  ...o,
});
const user = () => userEvent.setup({ applyAccept: false });
const rejection = (status, code, detail) => ({ response: { status, data: { error: true, status_code: status, code, detail } } });

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
});

describe('Paso 1 — lectura bloqueada o con tope (429)', () => {
  it('extraction_in_progress: muestra el motivo del servidor y deja reintentar sin crear otro análisis', async () => {
    hrApi.extractCVPosting.mockRejectedValueOnce(
      rejection(429, 'extraction_in_progress', 'Ya estamos leyendo una convocatoria. Espera a que termine.'),
    );
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await pasteAndRead(u);
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya estamos leyendo una convocatoria. Espera a que termine.');
    await u.click(screen.getByRole('button', { name: 'Probar de nuevo' }));
    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    expect(hrApi.createCVAnalysis).toHaveBeenCalledTimes(1);
    expect(hrApi.extractCVPosting).toHaveBeenCalledTimes(2);
  });

  it('posting_limit_reached: explica el tope y "Escribir los requisitos a mano" sigue funcionando', async () => {
    hrApi.extractCVPosting.mockRejectedValue(
      rejection(429, 'posting_limit_reached',
        'Llegaste al límite de lecturas con IA de la convocatoria. Escribe o pega los requisitos a mano.'),
    );
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await pasteAndRead(u);
    expect(await screen.findByRole('alert')).toHaveTextContent('Llegaste al límite de lecturas con IA');
    await u.click(screen.getByRole('button', { name: 'Escribir los requisitos a mano' }));
    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('un 429 sin detalle del servidor cae al mensaje genérico en español', async () => {
    hrApi.extractCVPosting.mockRejectedValue({ response: { status: 429, data: {} } });
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await pasteAndRead(u);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/[a-zñáéíóú]/i);
    expect(alert.textContent).not.toMatch(/429|undefined|\[object/);
  });

  it('un 409 requirements_locked durante la lectura no deja texto técnico y no ofrece editar', async () => {
    hrApi.extractCVPosting.mockRejectedValue(
      rejection(409, 'requirements_locked', 'Espera a que terminen los CVs en curso para cambiar la convocatoria.'),
    );
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await pasteAndRead(u);
    expect(await screen.findByRole('link', { name: /resultados/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leer convocatoria' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('Paso 1 — avisos de la lectura', () => {
  it('muestra los avisos nuevos (atributo protegido, instrucción omitida, texto recortado), cada uno una vez', async () => {
    hrApi.extractCVPosting.mockResolvedValue({
      data: proposal({
        warnings: [
          { code: 'protected_attribute_omitted', detail: 'Omití una condición de edad o sexo; no se usa para evaluar.' },
          { code: 'instruction_like_omitted', detail: 'Omití una línea que parecía una orden a la IA.' },
          { code: 'truncated_text', detail: 'La convocatoria era muy larga; leí solo el inicio.' },
          { code: 'simulated', detail: 'Modo de prueba: requisitos simulados.' },
        ],
      }),
    });
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await pasteAndRead(u);
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });
    expect(screen.getByText('Omití una condición de edad o sexo; no se usa para evaluar.')).toBeInTheDocument();
    expect(screen.getByText('Omití una línea que parecía una orden a la IA.')).toBeInTheDocument();
    expect(screen.getByText('La convocatoria era muy larga; leí solo el inicio.')).toBeInTheDocument();
    expect(screen.queryByText('Modo de prueba: requisitos simulados.')).not.toBeInTheDocument();
  });

  it('el aviso de requisitos truncados convive con la lista editable', async () => {
    hrApi.extractCVPosting.mockResolvedValue({
      data: proposal({ source: 'text', warnings: [{ code: 'truncated_requirements', detail: 'Había más de 15 requisitos; muestro los 15 principales.' }] }),
    });
    const u = user();
    renderAt('/rrhh/cvs/nuevo');
    await pasteAndRead(u);
    await screen.findByText('Había más de 15 requisitos; muestro los 15 principales.');
    expect(screen.getByLabelText('Requisito 1')).toHaveValue('Ingeniero civil colegiado');
  });
});

describe('Paso 1 — autoguardado con el servidor ocupado', () => {
  it('si al guardar el servidor dice que hay CVs en curso (409), pasa a la vista bloqueada con salida a resultados', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({
      data: analysisDetail({ id: 5, requirements: [{ id: 1, text: 'AutoCAD', weight: 1 }], requirements_text: 'AutoCAD' }),
    });
    hrApi.updateCVAnalysis.mockRejectedValue(
      rejection(409, 'requirements_locked', 'Espera a que terminen los CVs en curso para cambiar los requisitos.'),
    );
    const u = user();
    renderAt('/rrhh/cvs/5/preparar?paso=1');
    const card = await screen.findByLabelText('Requisito 1');
    await u.type(card, ' avanzado');
    await u.click(screen.getByRole('button', { name: /usar estos requisitos/i }));
    expect(await screen.findByRole('link', { name: /resultados/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Requisito 1')).not.toBeInTheDocument();
  });

  it('un análisis con requirements_locked=true (CVs en curso) entra directo a la vista bloqueada', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({
      data: analysisDetail({ id: 5, requirements_locked: true, requirements: [{ id: 1, text: 'AutoCAD', weight: 1 }], requirements_text: 'AutoCAD' }),
    });
    renderAt('/rrhh/cvs/5/preparar?paso=1');
    expect(await screen.findByRole('link', { name: /resultados/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leer convocatoria' })).not.toBeInTheDocument();
    expect(hrApi.extractCVPosting).not.toHaveBeenCalled();
  });
});
