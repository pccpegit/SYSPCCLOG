import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { analysisDetail, cvConfig } from '../../test/cvFixtures';
import { installMemoryLocalStorage } from '../../test/memoryStorage';
import LocationProbe from '../../test/LocationProbe';
import HRCVWizardPage from './HRCVWizardPage';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

function renderStep2(analysis = analysisDetail(), config = cvConfig()) {
  hrApi.getCVAnalysis.mockResolvedValue({ data: analysis });
  hrApi.getCVConfig.mockResolvedValue({ data: config });
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/rrhh/cvs/:id/preparar" element={<HRCVWizardPage />} />
        <Route path="/rrhh/cvs/:id" element={<p>PANTALLA RESULTADOS</p>} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: ['/rrhh/cvs/5/preparar?paso=2'] },
  );
}

const cv = (name, size = 1000) => {
  const f = new File(['x'], name, { lastModified: 1 });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const user = () => userEvent.setup({ applyAccept: false });
const ok = (files) => ({ data: { accepted: files.map((f, i) => ({ id: i, original_name: f.name })), duplicates: [], rejected: [], counts: {} } });

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryLocalStorage();
  hrApi.uploadCVFiles.mockImplementation(async (id, files) => ok(files));
});

describe('Paso 2 — archivos', () => {
  it('muestra el resumen del análisis, los requisitos colapsados y el dropzone como grupo con botones reales', async () => {
    renderStep2();
    const group = await screen.findByRole('group', { name: 'Arrastra aquí los CVs' });
    expect(within(group).getByRole('button', { name: 'Elegir archivos' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Elegir carpeta' })).toBeInTheDocument();
    expect(within(group).getByText('PDF, Word o imagen · hasta 10 MB cada uno')).toBeInTheDocument();
    expect(screen.getByText('Análisis: Residente de obra — Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Ver requisitos (2)').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Analizar CVs' })).toBeInTheDocument();
  });

  it('filtra en el cliente: lista las que sirven, deja visibles los problemas con motivo e ignora archivos del sistema', async () => {
    const u = user();
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.docx'), cv('virus.exe'), cv('vacio.pdf', 0), cv('gigante.pdf', 11 * 1024 * 1024), cv('.DS_Store'), cv('Thumbs.db'), cv('~$x.docx')]);
    expect(screen.getByRole('heading', { name: /2 CVs listos para analizar/ })).toBeInTheDocument();
    expect(screen.getByText('3 con problema')).toBeInTheDocument();
    expect(screen.getByText('virus.exe')).toBeInTheDocument();
    expect(screen.getByText('Formato no admitido. Usa PDF, Word o imagen.')).toBeInTheDocument();
    expect(screen.getByText('El archivo está vacío.')).toBeInTheDocument();
    expect(screen.getByText('Pesa más de 10 MB.')).toBeInTheDocument();
    expect(screen.getByText('Ignoramos 3 archivos del sistema.')).toBeInTheDocument();
    expect(screen.getByText('Agregaste 2 archivos. 3 no se pueden usar.')).toBeInTheDocument();
    // los correctos van colapsados
    const details = screen.getByText('Ver los 2 archivos').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Analizar 2 CVs' })).toBeInTheDocument();
  });

  it('una carpeta (webkitdirectory) se procesa igual que archivos sueltos', async () => {
    const u = user();
    renderStep2();
    await screen.findByTestId('cv-folder-input');
    expect(screen.getByTestId('cv-folder-input')).toHaveAttribute('webkitdirectory');
    await u.upload(screen.getByTestId('cv-folder-input'), [cv('uno.pdf'), cv('dos.png')]);
    expect(screen.getByRole('heading', { name: /2 CVs listos/ })).toBeInTheDocument();
  });

  it('arrastrar encima cambia el texto a "Suelta para agregar" y soltar agrega los archivos', async () => {
    renderStep2();
    const group = await screen.findByRole('group', { name: 'Arrastra aquí los CVs' });
    const file = cv('arrastrado.pdf');
    fireEvent.dragEnter(group, { dataTransfer: { types: ['Files'], files: [file], items: [] } });
    expect(screen.getByRole('group', { name: 'Suelta para agregar' })).toBeInTheDocument();
    fireEvent.drop(group, { dataTransfer: { types: ['Files'], files: [file], items: [] } });
    expect(await screen.findByRole('heading', { name: /1 CV listo para analizar/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Arrastra aquí los CVs' })).toBeInTheDocument();
  });

  it('se puede quitar un archivo y vaciar la lista', async () => {
    const u = user();
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('malo.exe')]);
    await u.click(screen.getByRole('button', { name: 'Quitar malo.exe' }));
    expect(screen.queryByText('malo.exe')).not.toBeInTheDocument();
    await u.upload(screen.getByTestId('cv-files-input'), [cv('b.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Vaciar lista' }));
    expect(screen.queryByRole('heading', { name: /listos para analizar/ })).not.toBeInTheDocument();
  });

  it('sin archivos, el botón principal enfoca el dropzone con "Primero agrega al menos un CV."', async () => {
    const u = user();
    renderStep2();
    await u.click(await screen.findByRole('button', { name: 'Analizar CVs' }));
    expect(screen.getByText('Primero agrega al menos un CV.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Arrastra aquí los CVs' })).toHaveFocus();
    expect(hrApi.uploadCVFiles).not.toHaveBeenCalled();
  });

  it('estima el costo por CV y avisa que es orientativo; en modo de prueba no cuesta', async () => {
    const u = user();
    const first = renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf'), cv('c.pdf')]);
    expect(screen.getByText('Costo estimado: US$ 0.09–0.24 (aprox.)')).toBeInTheDocument();
    expect(screen.getByText('La IA ayuda a ordenar; la decisión final es de RR. HH.')).toBeInTheDocument();
    first.unmount();
    renderStep2(analysisDetail(), cvConfig({ provider: 'fake', simulated: true }));
    expect(await screen.findByText('Modo de prueba: sin costo.')).toBeInTheDocument();
  });
});

describe('Paso 2 — topes', () => {
  it('si lo elegido no cabe en el tope diario avisa antes de subir y permite usar los primeros', async () => {
    const u = user();
    const cfg = cvConfig();
    cfg.limits.daily_remaining = 2;
    renderStep2(analysisDetail(), cfg);
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf'), cv('c.pdf')]);
    expect(screen.getByText('Elegiste 3; ahora caben 2.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Analizar 3 CVs' }));
    expect(hrApi.uploadCVFiles).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'Usar los primeros 2' }));
    expect(screen.queryByText('Elegiste 3; ahora caben 2.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analizar 2 CVs' })).toBeInTheDocument();
  });

  it('el tope por análisis descuenta los CVs ya subidos', async () => {
    const u = user();
    const cfg = cvConfig();
    cfg.limits.max_items_per_analysis = 5;
    renderStep2(analysisDetail({ counts: { total: 4, done: 4, failed: 0, pending: 0, queued: 0, processing: 0, cancelled: 0 } }), cfg);
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf')]);
    expect(screen.getByText('Elegiste 2; ahora caben 1.')).toBeInTheDocument();
  });

  it('con el tope agotado explica el motivo sin ofrecer "usar los primeros 0"', async () => {
    const u = user();
    const cfg = cvConfig();
    cfg.limits.daily_remaining = 0;
    renderStep2(analysisDetail(), cfg);
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf')]);
    expect(screen.getByText('Hoy llegaste al límite de CVs. Sigue mañana.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /usar los primeros/i })).not.toBeInTheDocument();
  });
});

describe('Paso 2 — sin clave de Anthropic', () => {
  it('bloquea con una razón visible y deja el botón accesible por teclado', async () => {
    const u = user();
    renderStep2(analysisDetail(), cvConfig({ enabled: false }));
    const group = await screen.findByRole('group', { name: 'Arrastra aquí los CVs' });
    expect(group).toHaveAttribute('aria-disabled', 'true');
    expect(within(group).getByRole('button', { name: 'Elegir archivos' })).toBeDisabled();
    const primary = screen.getByRole('button', { name: 'Analizar CVs' });
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    expect(primary).toHaveAccessibleDescription(/falta la clave de anthropic/i);
    await u.click(primary);
    expect(hrApi.uploadCVFiles).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Pide al administrador que la configure/).length).toBeGreaterThan(0);
  });
});

describe('Paso 2 — subida', () => {
  it('sube en tandas, muestra el progreso, avisa y navega a los resultados', async () => {
    const u = user();
    const cfg = cvConfig();
    cfg.limits.batch_size = 2;
    renderStep2(analysisDetail(), cfg);
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf'), cv('c.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 3 CVs' }));
    expect(await screen.findByText('PANTALLA RESULTADOS')).toBeInTheDocument();
    expect(hrApi.uploadCVFiles).toHaveBeenCalledTimes(2);
    expect(hrApi.uploadCVFiles.mock.calls.map((c) => c[1].length).sort()).toEqual([1, 2]);
    expect(await screen.findByText('3 CVs en cola.')).toBeInTheDocument();
  });

  it('mientras sube muestra "Subiendo N de M CVs…", un progressbar y "Detener subida"', async () => {
    const u = user();
    let release;
    hrApi.uploadCVFiles.mockImplementation((id, files) => new Promise((resolve) => { release = () => resolve(ok(files)); }));
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 2 CVs' }));
    expect(await screen.findByText('Subiendo 0 de 2 CVs…')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    expect(screen.getByText('Lo ya subido queda guardado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detener subida' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /analizar/i })).not.toBeInTheDocument();
    release();
    await screen.findByText('PANTALLA RESULTADOS');
  });

  it('solo avisa al salir (beforeunload) mientras sube', async () => {
    const u = user();
    let release;
    hrApi.uploadCVFiles.mockImplementation((id, files) => new Promise((resolve) => { release = () => resolve(ok(files)); }));
    renderStep2();
    await screen.findByTestId('cv-files-input');
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 1 CV' }));
    await screen.findByRole('progressbar');
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    release();
    await screen.findByText('PANTALLA RESULTADOS');
  });

  it('falla parcial: se queda en el paso 2 con "Se subieron 1 de 2. Faltan 1." y reintenta solo lo que falta', async () => {
    const u = user();
    const cfg = cvConfig();
    cfg.limits.batch_size = 1;
    hrApi.uploadCVFiles.mockImplementation(async (id, files) => {
      if (files[0].name === 'b.pdf') throw { message: 'Network Error' };
      return ok(files);
    });
    renderStep2(analysisDetail(), cfg);
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 2 CVs' }));
    expect(await screen.findByText(/Se subieron 1 de 2\. Faltan 1\./)).toBeInTheDocument();
    expect(screen.getByText('Falló la red')).toBeInTheDocument();
    expect(screen.queryByText('PANTALLA RESULTADOS')).not.toBeInTheDocument();
    hrApi.uploadCVFiles.mockClear();
    hrApi.uploadCVFiles.mockImplementation(async (id, files) => ok(files));
    await u.click(screen.getByRole('button', { name: 'Reintentar subida (1)' }));
    await screen.findByText('PANTALLA RESULTADOS');
    expect(hrApi.uploadCVFiles).toHaveBeenCalledTimes(1);
    expect(hrApi.uploadCVFiles.mock.calls[0][1].map((f) => f.name)).toEqual(['b.pdf']);
  });

  it('si el servidor rechaza algunos CVs, se queda en el paso con el aviso y un botón para continuar', async () => {
    const u = user();
    hrApi.uploadCVFiles.mockImplementation(async () => ({
      data: {
        accepted: [{ id: 1, original_name: 'a.pdf' }],
        duplicates: [],
        rejected: [{ original_name: 'b.pdf', code: 'pdf_encrypted', detail: 'El PDF tiene contraseña. Quítala y vuelve a subirlo.' }],
      },
    }));
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('b.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 2 CVs' }));
    expect(await screen.findByText(/1 archivo no se pudo usar/)).toBeInTheDocument();
    expect(screen.getByText('El PDF tiene contraseña. Quítala y vuelve a subirlo.')).toBeInTheDocument();
    expect(screen.queryByText('PANTALLA RESULTADOS')).not.toBeInTheDocument();
    expect(hrApi.uploadCVFiles).toHaveBeenCalledTimes(1);
    await u.click(screen.getByRole('link', { name: 'Continuar a resultados' }));
    await screen.findByText('PANTALLA RESULTADOS');
  });

  it('los archivos descartados en el cliente también se avisan antes de ir a resultados', async () => {
    const u = user();
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('virus.exe'), cv('b.pdf', 11 * 1024 * 1024)]);
    await u.click(screen.getByRole('button', { name: 'Analizar 1 CV' }));
    expect(await screen.findByText(/2 archivos no se pudieron usar/)).toBeInTheDocument();
    expect(screen.queryByText('PANTALLA RESULTADOS')).not.toBeInTheDocument();
  });

  it('si todo es rechazado se queda con el motivo y "Ningún archivo se pudo usar."', async () => {
    const u = user();
    hrApi.uploadCVFiles.mockImplementation(async () => ({
      data: { accepted: [], duplicates: [], rejected: [{ original_name: 'a.pdf', code: 'pdf_corrupt', detail: 'El PDF está dañado. Prueba con otra copia.' }] },
    }));
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 1 CV' }));
    expect(await screen.findByText('Ningún archivo se pudo usar.')).toBeInTheDocument();
    expect(screen.getByText('El PDF está dañado. Prueba con otra copia.')).toBeInTheDocument();
    expect(screen.queryByText('PANTALLA RESULTADOS')).not.toBeInTheDocument();
  });

  it('los repetidos se muestran como "Ya estaba subido" (neutral) y avanzan', async () => {
    const u = user();
    hrApi.uploadCVFiles.mockImplementation(async () => ({
      data: { accepted: [], duplicates: [{ original_name: 'a.pdf', duplicate_of: 3 }], rejected: [] },
    }));
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 1 CV' }));
    await screen.findByText('PANTALLA RESULTADOS');
  });

  it('un límite del servidor (429 daily_limit_reached) se explica con el mensaje del backend', async () => {
    const u = user();
    hrApi.uploadCVFiles.mockRejectedValue({ response: { status: 429, data: { code: 'daily_limit_reached', detail: 'Hoy llegaste al límite de CVs.' } } });
    renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf')]);
    await u.click(screen.getByRole('button', { name: 'Analizar 1 CV' }));
    expect(await screen.findByText('Hoy llegaste al límite de CVs.')).toBeInTheDocument();
    expect(hrApi.uploadCVFiles).toHaveBeenCalledTimes(1);
  });

  it('muestra "Ya tienes N CVs" con enlace a los resultados cuando ya hay subidos', async () => {
    renderStep2(analysisDetail({ counts: { total: 35, done: 35, failed: 0, pending: 0, queued: 0, processing: 0, cancelled: 0 } }));
    expect(await screen.findByText('Ya tienes 35 CVs en este análisis.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver resultados' })).toHaveAttribute('href', '/rrhh/cvs/5');
  });

  it('"Atrás" vuelve al paso 1', async () => {
    renderStep2();
    expect(await screen.findByRole('link', { name: 'Atrás' })).toHaveAttribute('href', '/rrhh/cvs/5/preparar?paso=1');
  });

  it('solo hay un botón primario relleno en la pantalla', async () => {
    const u = user();
    const { container } = renderStep2();
    await screen.findByTestId('cv-files-input');
    await u.upload(screen.getByTestId('cv-files-input'), [cv('a.pdf'), cv('x.exe')]);
    const primaries = [...container.querySelectorAll('button.bg-violet-600, a.bg-violet-600')];
    expect(primaries).toHaveLength(1);
    await waitFor(() => expect(primaries[0]).toHaveTextContent('Analizar 1 CV'));
  });
});
