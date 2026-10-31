import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { authAs, cvConfig, listRow } from '../../test/cvFixtures';
import HRCVAnalysesListPage from './HRCVAnalysesListPage';
import * as hrApi from '../../api/hr';
import { useAuth } from '../../context/useAuth';
import { installMemoryLocalStorage } from '../../test/memoryStorage';

vi.mock('../../api/hr');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const page = (results, count = results.length) => ({ data: { count, results } });

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryLocalStorage();
  useAuth.mockReturnValue(authAs(['HR_MANAGER']));
  hrApi.getCVConfig.mockResolvedValue({ data: cvConfig() });
});

describe('HRCVAnalysesListPage', () => {
  it('muestra el estado de carga y luego las secciones En proceso y Completados', async () => {
    hrApi.getCVAnalyses.mockResolvedValue(
      page([
        listRow({ id: 1, name: 'Borrador A', status: 'EMPTY' }),
        listRow({ id: 2, name: 'Proceso B', status: 'COMPLETED', counts: { total: 38, done: 35, failed: 2, pending: 1 } }),
        listRow({ id: 3, name: 'Proceso C', status: 'COMPLETED_WITH_ERRORS', counts: { total: 10, done: 8, failed: 2, pending: 0 } }),
        listRow({ id: 4, name: 'Proceso D', status: 'PROCESSING', counts: { total: 5, done: 1, failed: 0, pending: 4 } }),
      ]),
    );
    renderWithProviders(<HRCVAnalysesListPage />);
    expect(screen.getByText('Cargando tus análisis…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Completados' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'En proceso' })).toBeInTheDocument();
    expect(screen.getByText('Proceso B')).toBeInTheDocument();
    expect(screen.getByText(/38 CVs/)).toBeInTheDocument();
    expect(screen.getByText('Completado con errores')).toBeInTheDocument();
  });

  it('"Continúa donde lo dejaste": un solo borrador/en curso, con el enlace al paso correcto', async () => {
    hrApi.getCVAnalyses.mockResolvedValue(
      page([
        listRow({ id: 7, name: 'Residente', status: 'EMPTY', has_requirements: true }),
        listRow({ id: 8, name: 'Otro borrador', status: 'EMPTY', has_requirements: false }),
      ]),
    );
    renderWithProviders(<HRCVAnalysesListPage />);
    const region = await screen.findByRole('region', { name: 'Continúa donde lo dejaste' });
    expect(within(region).getByText('Residente')).toBeInTheDocument();
    expect(within(region).getByText('Te falta subir los CVs.')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/rrhh/cvs/7/preparar?paso=2');
    // sin requisitos guardados el borrador vuelve al paso 1
    expect(screen.getByRole('link', { name: 'Otro borrador' })).toHaveAttribute('href', '/rrhh/cvs/8/preparar');
  });

  it('"sin convocatoria" recordado en este navegador reanuda en el paso 2', async () => {
    localStorage.setItem('hrcv:skip:8', '1');
    hrApi.getCVAnalyses.mockResolvedValue(page([listRow({ id: 8, name: 'Sin conv', status: 'EMPTY', has_requirements: false })]));
    renderWithProviders(<HRCVAnalysesListPage />);
    expect(await screen.findByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/rrhh/cvs/8/preparar?paso=2');
  });

  it('un análisis en curso ofrece "Ver avance" y lleva a los resultados', async () => {
    hrApi.getCVAnalyses.mockResolvedValue(
      page([listRow({ id: 9, name: 'Corriendo', status: 'PROCESSING', counts: { total: 5, done: 1, failed: 0, pending: 4 } })]),
    );
    renderWithProviders(<HRCVAnalysesListPage />);
    const link = await screen.findByRole('link', { name: 'Ver avance' });
    expect(link).toHaveAttribute('href', '/rrhh/cvs/9');
    expect(screen.getByText('Tu análisis sigue en marcha.')).toBeInTheDocument();
  });

  it('vacío para HR_MANAGER: un único botón primario "Empezar un análisis"', async () => {
    hrApi.getCVAnalyses.mockResolvedValue(page([]));
    renderWithProviders(<HRCVAnalysesListPage />);
    expect(await screen.findByText('Aún no hay análisis.')).toBeInTheDocument();
    expect(screen.getByText('Empieza con la convocatoria y sube los CVs.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Empezar un análisis' })).toHaveAttribute('href', '/rrhh/cvs/nuevo');
    expect(screen.queryByRole('link', { name: 'Nuevo análisis' })).not.toBeInTheDocument();
  });

  it('GENERAL_MANAGER: solo lectura, sin botón de nuevo análisis ni tarjeta de continuar', async () => {
    useAuth.mockReturnValue(authAs(['GENERAL_MANAGER']));
    hrApi.getCVAnalyses.mockResolvedValue(page([listRow({ id: 1, name: 'Borrador', status: 'EMPTY' })]));
    renderWithProviders(<HRCVAnalysesListPage />);
    expect(await screen.findByText('Consulta de análisis (solo lectura).')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /nuevo análisis/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Continúa donde lo dejaste')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Borrador' })).toBeInTheDocument();
  });

  it('GENERAL_MANAGER con lista vacía ve un mensaje sin acción de escritura', async () => {
    useAuth.mockReturnValue(authAs(['GENERAL_MANAGER']));
    hrApi.getCVAnalyses.mockResolvedValue(page([]));
    renderWithProviders(<HRCVAnalysesListPage />);
    expect(await screen.findByText('Aún no hay análisis para consultar.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('si falla la carga muestra una alerta con Reintentar que vuelve a pedir la lista', async () => {
    const user = userEvent.setup();
    hrApi.getCVAnalyses.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    hrApi.getCVAnalyses.mockResolvedValue(page([listRow({ id: 2, name: 'Proceso B', status: 'COMPLETED' })]));
    renderWithProviders(<HRCVAnalysesListPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/error del servidor/i);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Proceso B')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('el banner de modo de prueba aparece cuando el proveedor es simulado', async () => {
    hrApi.getCVConfig.mockResolvedValue({ data: cvConfig({ provider: 'fake', simulated: true }) });
    hrApi.getCVAnalyses.mockResolvedValue(page([]));
    renderWithProviders(<HRCVAnalysesListPage />);
    expect(await screen.findByText('Modo de prueba: los resultados son simulados.')).toBeInTheDocument();
  });

  it('con más de 6 análisis aparece la búsqueda y filtra por nombre sin acentos', async () => {
    const user = userEvent.setup();
    hrApi.getCVAnalyses.mockResolvedValue(
      page(Array.from({ length: 7 }, (_, i) => listRow({ id: i + 1, name: i === 3 ? 'Ingeniería civil' : `Proceso ${i}`, status: 'COMPLETED' }))),
    );
    renderWithProviders(<HRCVAnalysesListPage />);
    await user.type(await screen.findByRole('searchbox', { name: 'Buscar análisis' }), 'ingenieria');
    expect(screen.getByText('Ingeniería civil')).toBeInTheDocument();
    expect(screen.queryByText('Proceso 0')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Buscar análisis' }));
    await user.type(screen.getByRole('searchbox', { name: 'Buscar análisis' }), 'zzz');
    expect(screen.getByText('Ningún análisis coincide.')).toBeInTheDocument();
  });

  it('al buscar anuncia cuántos análisis quedan en una región de estado persistente', async () => {
    const user = userEvent.setup();
    hrApi.getCVAnalyses.mockResolvedValue(
      page(Array.from({ length: 7 }, (_, i) => listRow({ id: i + 1, name: i === 3 ? 'Ingeniería civil' : `Proceso ${i}`, status: 'COMPLETED' }))),
    );
    renderWithProviders(<HRCVAnalysesListPage />);
    const box = await screen.findByRole('searchbox', { name: 'Buscar análisis' });
    const region = () => screen.getAllByRole('status').find((el) => el.classList.contains('sr-only'));
    expect(region()).toBeEmptyDOMElement();
    await user.type(box, 'ingenieria');
    await waitFor(() => expect(region()).toHaveTextContent('Mostrando 1 de 7 análisis.'), { timeout: 2500 });
    await user.clear(box);
    await user.type(box, 'zzz');
    await waitFor(() => expect(region()).toHaveTextContent('Ningún análisis coincide.'), { timeout: 2500 });
  });

  it('"Mostrar más" pide la página siguiente y la agrega', async () => {
    const user = userEvent.setup();
    hrApi.getCVAnalyses
      .mockResolvedValueOnce(page([listRow({ id: 1, name: 'Primero', status: 'COMPLETED' })], 2))
      .mockResolvedValueOnce(page([listRow({ id: 2, name: 'Segundo', status: 'COMPLETED' })], 2));
    renderWithProviders(<HRCVAnalysesListPage />);
    await user.click(await screen.findByRole('button', { name: 'Mostrar más' }));
    expect(await screen.findByText('Segundo')).toBeInTheDocument();
    expect(screen.getByText('Primero')).toBeInTheDocument();
    expect(hrApi.getCVAnalyses).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.queryByRole('button', { name: 'Mostrar más' })).not.toBeInTheDocument();
  });
});
