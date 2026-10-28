import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
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
const proposal = (o = {}) => ({
  source: 'ai',
  position_title: null,
  requirements: [
    { id: 1, text: 'Ingeniero civil colegiado', weight: 3 },
    { id: 2, text: '5 años en obras viales', weight: 1 },
  ],
  requirements_text: 'Ingeniero civil colegiado (obligatorio)\n5 años en obras viales',
  warnings: [],
  usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 },
  ...o,
});
const pdf = (name = 'convocatoria.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });
const user = () => userEvent.setup({ applyAccept: false });
const loc = () => screen.getByTestId('loc').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryLocalStorage();
  hrApi.getCVConfig.mockResolvedValue({ data: cvConfig() });
  hrApi.createCVAnalysis.mockResolvedValue({ data: draft() });
  hrApi.getCVAnalysis.mockResolvedValue({ data: draft() });
  hrApi.updateCVAnalysis.mockImplementation(async (id, payload) => ({ data: draft({ ...payload }) }));
  hrApi.uploadCVPosting.mockResolvedValue({ data: draft({ has_posting: true, posting: { original_name: 'convocatoria.pdf', kind: 'PDF', size_bytes: 4, file_available: true } }) });
  hrApi.extractCVPosting.mockResolvedValue({ data: proposal() });
});

describe('Paso 1 — entrada', () => {
  it('valida sin deshabilitar el botón: error inline, foco en el primer campo inválido y ninguna llamada', async () => {
    const u = user();
    renderWizard();
    const button = await screen.findByRole('button', { name: 'Leer convocatoria' });
    expect(button).not.toBeDisabled();
    await u.click(button);
    expect(screen.getByText('Escribe un nombre de al menos 3 letras.')).toBeInTheDocument();
    const name = screen.getByLabelText('Nombre del análisis');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(hrApi.createCVAnalysis).not.toHaveBeenCalled();
    // con nombre pero sin archivo: el error pasa al archivo
    await u.type(name, 'Residente de obra');
    await u.click(button);
    expect(screen.getByText('Elige un archivo para continuar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir archivo' })).toHaveFocus();
    expect(hrApi.createCVAnalysis).not.toHaveBeenCalled();
  });

  it('modo texto sin texto pide pegarlo y enfoca el área', async () => {
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente');
    await u.click(screen.getByRole('radio', { name: /pegar texto/i }));
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    expect(screen.getByText('Pega el texto para continuar.')).toBeInTheDocument();
    expect(screen.getByLabelText('Texto de la convocatoria')).toHaveFocus();
  });

  it('muestra el contador de caracteres del texto pegado', async () => {
    const u = user();
    renderWizard();
    await u.click(await screen.findByRole('radio', { name: /pegar texto/i }));
    await u.type(screen.getByLabelText('Texto de la convocatoria'), 'hola');
    expect(screen.getByText(/^4 de 12[.,\s\u00a0\u202f]000$/)).toBeInTheDocument();
  });

  it('subir archivo: crea el análisis, sube la convocatoria, la lee y lleva a revisar los requisitos', async () => {
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    const file = pdf();
    await u.upload(screen.getByTestId('posting-file-input'), file);
    expect(screen.getByText('convocatoria.pdf')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));

    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    expect(hrApi.createCVAnalysis).toHaveBeenCalledWith({ name: 'Residente de obra' });
    expect(hrApi.uploadCVPosting).toHaveBeenCalledWith(5, file, expect.any(Object));
    expect(hrApi.extractCVPosting).toHaveBeenCalledWith(5, expect.objectContaining({ text: undefined }));
    expect(loc()).toBe('/rrhh/cvs/5/preparar?paso=1');
    expect(screen.getByText('Propuesta automática. Corrige lo que haga falta.')).toBeInTheDocument();
    expect(screen.getByText('2 de 15 requisitos')).toBeInTheDocument();
    expect(screen.getByLabelText('Requisito 1')).toHaveValue('Ingeniero civil colegiado');
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    // foco en el h2 y anuncio "N requisitos propuestos."
    expect(screen.getByRole('heading', { name: 'Revisa los requisitos' })).toHaveFocus();
    expect(screen.getByText('2 requisitos propuestos.')).toBeInTheDocument();
  });

  it('pegar texto: lee el texto sin subir archivo', async () => {
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    await u.click(screen.getByRole('radio', { name: /pegar texto/i }));
    await u.type(screen.getByLabelText('Texto de la convocatoria'), 'Se requiere ingeniero');
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });
    expect(hrApi.uploadCVPosting).not.toHaveBeenCalled();
    expect(hrApi.extractCVPosting).toHaveBeenCalledWith(5, expect.objectContaining({ text: 'Se requiere ingeniero' }));
  });

  it('la fuente por texto/heurística muestra su propio aviso', async () => {
    hrApi.extractCVPosting.mockResolvedValue({ data: proposal({ source: 'text' }) });
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    await u.click(screen.getByRole('radio', { name: /pegar texto/i }));
    await u.type(screen.getByLabelText('Texto de la convocatoria'), 'Se requiere ingeniero');
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    expect(await screen.findByText('Encontramos estos puntos en el documento. Revísalos.')).toBeInTheDocument();
  });

  it('"No tengo": crea el análisis, recuerda el salto y va al paso 2', async () => {
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Sin convocatoria');
    await u.click(screen.getByRole('radio', { name: /no tengo/i }));
    expect(screen.getByText(/sin requisitos no habrá puntaje/i)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Continuar sin convocatoria' }));
    await waitFor(() => expect(loc()).toBe('/rrhh/cvs/5/preparar?paso=2'));
    expect(hrApi.extractCVPosting).not.toHaveBeenCalled();
    expect(localStorage.getItem('hrcv:skip:5')).toBe('1');
    expect(await screen.findByRole('heading', { name: 'Paso 2 · CVs' })).toBeInTheDocument();
  });

  it('mientras lee muestra "Leyendo tu convocatoria…" y Cancelar vuelve a la entrada', async () => {
    let rejectExtract;
    hrApi.extractCVPosting.mockImplementation(
      (id, { signal }) =>
        new Promise((resolve, reject) => {
          rejectExtract = reject;
          signal.addEventListener('abort', () => reject({ code: 'ERR_CANCELED' }));
        }),
    );
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    await u.upload(screen.getByTestId('posting-file-input'), pdf());
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    expect(await screen.findByText('Leyendo tu convocatoria…')).toBeInTheDocument();
    expect(screen.getByText('Suele tardar menos de un minuto.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('button', { name: 'Leer convocatoria' })).toBeInTheDocument();
    expect(rejectExtract).toBeDefined();
    // el análisis ya existe y se reutiliza al volver a intentar (no se crea otro)
    hrApi.extractCVPosting.mockResolvedValue({ data: proposal() });
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });
    expect(hrApi.createCVAnalysis).toHaveBeenCalledTimes(1);
  });

  it('un archivo rechazado por el servidor muestra el motivo junto al campo y no intenta leer', async () => {
    hrApi.uploadCVPosting.mockRejectedValue({ response: { status: 400, data: { code: 'pdf_encrypted', detail: 'El PDF tiene contraseña. Quítala y vuelve a subirlo.' } } });
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    await u.upload(screen.getByTestId('posting-file-input'), pdf());
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    expect(await screen.findByText('El PDF tiene contraseña. Quítala y vuelve a subirlo.')).toBeInTheDocument();
    expect(hrApi.extractCVPosting).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Leer convocatoria' })).toBeInTheDocument();
  });

  it('rechaza en el cliente un formato o un tamaño no permitido', async () => {
    const u = user();
    renderWizard();
    await screen.findByLabelText('Nombre del análisis');
    await u.upload(screen.getByTestId('posting-file-input'), new File(['x'], 'virus.exe'));
    expect(await screen.findByText('Formato no admitido. Usa PDF, Word o imagen.')).toBeInTheDocument();
    const big = new File(['x'], 'grande.pdf');
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await u.upload(screen.getByTestId('posting-file-input'), big);
    expect(await screen.findByText('La convocatoria pesa más de 5 MB.')).toBeInTheDocument();
  });

  it('un error al crear con nombre inválido del servidor se muestra en el campo nombre', async () => {
    hrApi.createCVAnalysis.mockRejectedValue({ response: { status: 400, data: { detail: { name: ['Este nombre ya existe.'] } } } });
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Repetido');
    await u.click(screen.getByRole('radio', { name: /no tengo/i }));
    await u.click(screen.getByRole('button', { name: 'Continuar sin convocatoria' }));
    expect(await screen.findByText('Este nombre ya existe.')).toBeInTheDocument();
  });
});

describe('Paso 1 — fallas de lectura', () => {
  async function failRead(err) {
    hrApi.extractCVPosting.mockRejectedValue(err);
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    await u.upload(screen.getByTestId('posting-file-input'), pdf());
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    return u;
  }

  it('si no se pudo leer ofrece "Probar de nuevo" y "Escribir los requisitos a mano"', async () => {
    const u = await failRead({ response: { status: 422, data: { code: 'posting_unreadable', detail: 'No pude leer texto de la convocatoria.' } } });
    expect(await screen.findByRole('alert')).toHaveTextContent('No pude leer texto de la convocatoria.');
    // Probar de nuevo reutiliza el análisis y el archivo ya subido
    hrApi.extractCVPosting.mockResolvedValue({ data: proposal() });
    await u.click(screen.getByRole('button', { name: 'Probar de nuevo' }));
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });
    expect(hrApi.createCVAnalysis).toHaveBeenCalledTimes(1);
    expect(hrApi.uploadCVPosting).toHaveBeenCalledTimes(1);
  });

  it('"Escribir los requisitos a mano" abre la revisión con una tarjeta vacía', async () => {
    const u = await failRead({ response: { status: 502, data: { code: 'posting_ai_failed' } } });
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos leer la convocatoria ahora. Inténtalo de nuevo.');
    await u.click(screen.getByRole('button', { name: 'Escribir los requisitos a mano' }));
    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText('0 de 15 requisitos')).toBeInTheDocument();
  });

  it('sin requisitos en el documento: mensaje y "Agregar requisitos a mano"', async () => {
    hrApi.extractCVPosting.mockResolvedValue({
      data: proposal({ requirements: [], requirements_text: '', warnings: [{ code: 'no_requirements_found', detail: 'No encontré requisitos claros.' }] }),
    });
    const u = user();
    renderWizard();
    await u.type(await screen.findByLabelText('Nombre del análisis'), 'Residente de obra');
    await u.click(screen.getByRole('radio', { name: /pegar texto/i }));
    await u.type(screen.getByLabelText('Texto de la convocatoria'), 'texto sin requisitos claros');
    await u.click(screen.getByRole('button', { name: 'Leer convocatoria' }));
    expect(await screen.findByText('No encontramos requisitos en el documento.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir otra convocatoria' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Agregar requisitos a mano' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getAllByRole('textbox')[0]).toHaveFocus();
  });
});

describe('Paso 1 — revisión y autoguardado', () => {
  const withProposal = (state) => ({ pathname: '/rrhh/cvs/5/preparar', search: '?paso=1', state });

  async function review(extra = {}) {
    hrApi.getCVAnalysis.mockResolvedValue({ data: draft({ has_posting: true }) });
    renderWizard(withProposal({ proposal: proposal(extra) }));
    return screen.findByRole('heading', { name: 'Revisa los requisitos' });
  }

  it('autoguarda 1,5 s después de editar y muestra Guardando… → Guardado', async () => {
    const u = user();
    await review();
    const first = screen.getByLabelText('Requisito 1');
    await u.clear(first);
    await u.type(first, 'Arquitecto');
    expect(hrApi.updateCVAnalysis).not.toHaveBeenCalled();
    await waitFor(() => expect(hrApi.updateCVAnalysis).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(hrApi.updateCVAnalysis).toHaveBeenCalledWith(5, { requirements_text: 'Arquitecto (obligatorio)\n5 años en obras viales' });
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
  });

  it('guarda al salir de la tarjeta y al cambiar "Obligatorio"', async () => {
    const u = user();
    await review();
    await u.click(screen.getAllByRole('checkbox')[1]);
    await waitFor(() => expect(hrApi.updateCVAnalysis).toHaveBeenCalledWith(5, { requirements_text: 'Ingeniero civil colegiado (obligatorio)\n5 años en obras viales (obligatorio)' }));
  });

  it('si el guardado falla muestra el error con Reintentar y reintenta', async () => {
    const u = user();
    await review();
    hrApi.updateCVAnalysis.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    await u.click(screen.getAllByRole('checkbox')[1]);
    expect(await screen.findByText('No se pudo guardar.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
  });

  it('"Usar estos requisitos" guarda y lleva al paso 2 con el foco en su título', async () => {
    const u = user();
    await review();
    await u.click(screen.getByRole('button', { name: 'Usar estos requisitos' }));
    await waitFor(() => expect(loc()).toBe('/rrhh/cvs/5/preparar?paso=2'));
    expect(hrApi.updateCVAnalysis).toHaveBeenCalledWith(5, { requirements_text: 'Ingeniero civil colegiado (obligatorio)\n5 años en obras viales' });
    const h2 = await screen.findByRole('heading', { name: 'Paso 2 · CVs' });
    await waitFor(() => expect(h2).toHaveFocus());
  });

  it('con 0 requisitos el botón principal cambia a "Continuar sin requisitos" y recuerda el salto', async () => {
    const u = user();
    await review();
    await u.click(screen.getByRole('button', { name: 'Quitar requisito 1' }));
    await u.click(screen.getByRole('button', { name: 'Quitar requisito 1' }));
    expect(screen.getByText('Sin requisitos no habrá puntaje, solo la ficha de cada CV.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Continuar sin requisitos' }));
    await waitFor(() => expect(loc()).toBe('/rrhh/cvs/5/preparar?paso=2'));
    expect(hrApi.updateCVAnalysis).toHaveBeenLastCalledWith(5, { requirements_text: '' });
    expect(localStorage.getItem('hrcv:skip:5')).toBe('1');
  });

  it('muestra los avisos amables de la lectura (menos el de modo de prueba, que va en el banner)', async () => {
    await review({
      warnings: [
        { code: 'truncated_requirements', detail: 'Había más de 15 requisitos; muestro los 15 principales.' },
        { code: 'simulated', detail: 'Modo de prueba: requisitos simulados.' },
      ],
    });
    expect(screen.getByText('Había más de 15 requisitos; muestro los 15 principales.')).toBeInTheDocument();
    expect(screen.queryByText('Modo de prueba: requisitos simulados.')).not.toBeInTheDocument();
  });

  it('el título sugerido por la convocatoria se ofrece, no se impone', async () => {
    const u = user();
    await review({ position_title: 'Ingeniero Residente' });
    expect(hrApi.updateCVAnalysis).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: /usar «ingeniero residente» como nombre/i }));
    expect(hrApi.updateCVAnalysis).toHaveBeenCalledWith(5, { name: 'Ingeniero Residente' });
  });

  it('"Subir otra convocatoria" vuelve a la entrada sin borrar nada', async () => {
    const u = user();
    await review();
    await u.click(screen.getByRole('button', { name: 'Subir otra convocatoria' }));
    expect(await screen.findByRole('heading', { name: 'Paso 1 · Convocatoria' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del análisis')).toHaveValue('Residente de obra — Oct 2026');
  });

  it('con requisitos ya guardados (sin propuesta) abre la revisión con ellos', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail() });
    renderWizard('/rrhh/cvs/5/preparar?paso=1');
    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    expect(screen.getByLabelText('Requisito 2')).toHaveValue('5 años en obras viales');
    expect(screen.queryByText('Propuesta automática. Corrige lo que haga falta.')).not.toBeInTheDocument();
  });

  it('con CVs ya analizados los requisitos se ven bloqueados, sin edición', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({
      data: analysisDetail({ requirements_locked: true, counts: { total: 3, done: 3, failed: 0, pending: 0, queued: 0, processing: 0, cancelled: 0 } }),
    });
    renderWizard('/rrhh/cvs/5/preparar?paso=1');
    expect(await screen.findByText('Ya hay CVs analizados; los requisitos no se pueden cambiar.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a resultados' })).toHaveAttribute('href', '/rrhh/cvs/5');
    expect(screen.getByRole('link', { name: 'Crear un análisis nuevo' })).toHaveAttribute('href', '/rrhh/cvs/nuevo');
  });

  it('si el servidor responde requirements_locked al guardar, pasa a la vista bloqueada', async () => {
    const u = user();
    await review();
    hrApi.updateCVAnalysis.mockRejectedValue({ response: { status: 409, data: { code: 'requirements_locked', detail: 'Ya hay CVs analizados.' } } });
    await u.click(screen.getByRole('button', { name: 'Usar estos requisitos' }));
    // Muestra el motivo exacto del servidor y no persiste el candado en el estado local.
    expect(await screen.findByText('Ya hay CVs analizados.')).toBeInTheDocument();
  });

  it('con CVs en curso (bloqueo temporal) lo explica y "Actualizar" vuelve a consultar y reabre la edición', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({
      data: analysisDetail({ requirements_locked: true, counts: { total: 3, done: 0, failed: 0, pending: 3, queued: 2, processing: 1, cancelled: 0 } }),
    });
    const u = user();
    renderWizard('/rrhh/cvs/5/preparar?paso=1');
    expect(await screen.findByText('Espera a que terminen los CVs en curso para cambiar los requisitos.')).toBeInTheDocument();
    expect(screen.queryByText('Ya hay CVs analizados; los requisitos no se pueden cambiar.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Crear un análisis nuevo' })).not.toBeInTheDocument();
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail({ requirements_locked: false, counts: { total: 3, done: 0, failed: 3, pending: 0, queued: 0, processing: 0, cancelled: 0 } }) });
    await u.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByRole('heading', { name: 'Revisa los requisitos' })).toBeInTheDocument();
    expect(screen.getByLabelText('Requisito 1')).toBeInTheDocument();
  });

  it('muestra el aviso de atributos protegidos e instrucciones que devuelve el PATCH, sin bloquear', async () => {
    const u = user();
    await review();
    hrApi.updateCVAnalysis.mockImplementation(async (id, payload) => ({
      data: draft({
        ...payload,
        warnings: [
          { code: 'protected_requirement_detected', detail: 'Alguna línea parece pedir edad o sexo. Recomendamos quitarlas.' },
          { code: 'instruction_like_detected', detail: 'Alguna línea parece una instrucción para una IA.' },
        ],
      }),
    }));
    const first = screen.getByLabelText('Requisito 1');
    await u.clear(first);
    await u.type(first, 'Solo mujeres');
    expect(await screen.findByText('Alguna línea parece pedir edad o sexo. Recomendamos quitarlas.', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Alguna línea parece una instrucción para una IA.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar estos requisitos' })).not.toBeDisabled();
  });

  it('el aviso desaparece cuando el siguiente guardado ya no trae avisos', async () => {
    const u = user();
    await review();
    hrApi.updateCVAnalysis.mockResolvedValueOnce({
      data: draft({ warnings: [{ code: 'instruction_like_detected', detail: 'Alguna línea parece una instrucción para una IA.' }] }),
    });
    const first = screen.getByLabelText('Requisito 1');
    await u.type(first, ' x');
    await screen.findByText('Alguna línea parece una instrucción para una IA.', {}, { timeout: 3000 });
    await u.type(first, 'y');
    await waitFor(() => expect(screen.queryByText('Alguna línea parece una instrucción para una IA.')).not.toBeInTheDocument(), { timeout: 3000 });
  });
});

describe('Reanudar donde lo dejó', () => {
  it('con CVs subidos redirige a los resultados', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail({ counts: { total: 4, done: 4, failed: 0, pending: 0, queued: 0, processing: 0, cancelled: 0 } }) });
    renderWizard('/rrhh/cvs/5/preparar');
    expect(await screen.findByText('PANTALLA RESULTADOS')).toBeInTheDocument();
  });

  it('con requisitos guardados abre el paso 2', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail() });
    renderWizard('/rrhh/cvs/5/preparar');
    expect(await screen.findByRole('heading', { name: 'Paso 2 · CVs' })).toBeInTheDocument();
  });

  it('sin requisitos abre el paso 1; con "sin convocatoria" recordado abre el paso 2', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({ data: draft() });
    const first = renderWizard('/rrhh/cvs/5/preparar');
    expect(await screen.findByRole('heading', { name: 'Paso 1 · Convocatoria' })).toBeInTheDocument();
    first.unmount();
    localStorage.setItem('hrcv:skip:5', '1');
    renderWizard('/rrhh/cvs/5/preparar');
    expect(await screen.findByRole('heading', { name: 'Paso 2 · CVs' })).toBeInTheDocument();
  });

  it('?paso=2 explícito manda aunque ya haya CVs ("Agregar más CVs")', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail({ counts: { total: 4, done: 4, failed: 0, pending: 0, queued: 0, processing: 0, cancelled: 0 } }) });
    renderWizard('/rrhh/cvs/5/preparar?paso=2');
    expect(await screen.findByRole('heading', { name: 'Paso 2 · CVs' })).toBeInTheDocument();
    expect(screen.getByText('Ya tienes 4 CVs en este análisis.')).toBeInTheDocument();
  });

  it('el stepper muestra el paso actual y el paso 1 hecho como enlace cuando estás en el 2', async () => {
    hrApi.getCVAnalysis.mockResolvedValue({ data: analysisDetail() });
    renderWizard('/rrhh/cvs/5/preparar?paso=2');
    const nav = await screen.findByRole('navigation', { name: 'Pasos del análisis' });
    expect(within(nav).getByRole('link', { name: /convocatoria/i })).toHaveAttribute('href', '/rrhh/cvs/5/preparar?paso=1');
    expect(within(nav).getByText('CVs').closest('[aria-current]')).toHaveAttribute('aria-current', 'step');
  });

  it('un análisis inexistente muestra un mensaje claro con la salida', async () => {
    hrApi.getCVAnalysis.mockRejectedValue({ response: { status: 404, data: {} } });
    renderWizard('/rrhh/cvs/99/preparar');
    expect(await screen.findByRole('heading', { name: 'No encontramos este análisis.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a la lista' })).toHaveAttribute('href', '/rrhh/cvs');
  });

  it('si falla la carga ofrece reintentar', async () => {
    const u = user();
    hrApi.getCVAnalysis.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    hrApi.getCVAnalysis.mockResolvedValue({ data: draft() });
    renderWizard('/rrhh/cvs/5/preparar');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Paso 1 · Convocatoria' })).toBeInTheDocument();
  });

  it('siempre hay un bloque "¿Cómo funciona?" colapsado en el mismo lugar', async () => {
    renderWizard();
    const summary = await screen.findByText('¿Cómo funciona?');
    expect(summary.closest('details')).not.toHaveAttribute('open');
  });

  it('el banner de modo de prueba se ve en el asistente', async () => {
    hrApi.getCVConfig.mockResolvedValue({ data: cvConfig({ provider: 'fake', simulated: true }) });
    renderWizard();
    expect(await screen.findByText('Modo de prueba: los resultados son simulados.')).toBeInTheDocument();
  });
});
