import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FINISHED_COUNTS, analysisDetail, finishedRows, itemRow } from '../../test/cvFixtures';
import { loc, rowNames, setup } from '../../test/cvPageHarness';
import HRCVAnalysisPage from './HRCVAnalysisPage';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  hrApi.saveBlob.mockImplementation(() => {});
  hrApi.downloadCVXlsx.mockResolvedValue({ blob: new Blob(['x']), filename: 'Candidatos.xlsx' });
  hrApi.downloadCVZip.mockResolvedValue({ blob: new Blob(['x']), filename: 'CVs.zip' });
  hrApi.retryFailedCVItems.mockResolvedValue({ data: { requeued: 1 } });
  hrApi.retryCVItem.mockResolvedValue({ data: {} });
  hrApi.cancelCVAnalysis.mockResolvedValue({ data: { cancelled: 2 } });
  hrApi.resumeCVAnalysis.mockResolvedValue({ data: { redispatched: 1 } });
  hrApi.deleteCVAnalysis.mockResolvedValue({});
  delete window.matchMedia;
});

describe('HRCVAnalysisPage — análisis terminado', () => {
  it('muestra cabecera, aviso de la IA, stepper en el paso 3 y los requisitos colapsados', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Residente de obra — Oct 2026' })).toBeInTheDocument();
    expect(screen.getByText('Completado con errores')).toBeInTheDocument();
    expect(screen.getByText('Costo: US$ 0.84')).toBeInTheDocument();
    expect(screen.getAllByText('La IA ayuda a ordenar; la decisión final es de RR. HH.').length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: 'Pasos del análisis' });
    expect(within(nav).getByText('Resultados').closest('[aria-current]')).toHaveAttribute('aria-current', 'step');
    expect(within(nav).getAllByRole('link')).toHaveLength(2);
    const reqs = screen.getByText('Requisitos (2)').closest('details');
    expect(reqs).not.toHaveAttribute('open');
    expect(within(reqs).getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/rrhh/cvs/5/preparar?paso=1');
    document.title.includes('Residente') && expect(document.title).toContain('RR. HH.');
  });

  it('aplica el ranking una sola vez: tabla ordenada por ranking, errores al final', async () => {
    setup();
    await screen.findByRole('table');
    expect(rowNames()).toEqual(['Ana Paz', 'Beto Ríos', 'Carla Soto', 'cv_4.pdf']);
    const table = screen.getByRole('table', { name: 'Candidatos del análisis Residente de obra — Oct 2026' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Ranking', 'Candidato', 'Puntaje', 'Sugerencia', 'Estado']);
    expect(within(table).getByRole('columnheader', { name: /ranking/i })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('cada fila lleva estado y sugerencia con texto, y el error muestra su motivo con Reintentar', async () => {
    setup();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('Listo')).toHaveLength(3);
    expect(within(table).getByText('Avanzar')).toBeInTheDocument();
    expect(within(table).getByText('Revisar')).toBeInTheDocument();
    expect(within(table).getByText('No avanzar')).toBeInTheDocument();
    expect(within(table).getByText('Con error')).toBeInTheDocument();
    expect(within(table).getByText(/El servicio no respondió/)).toBeInTheDocument();
    expect(within(table).getByText('Arquitecta · ≈ 2 años')).toBeInTheDocument();
  });

  it('Los 3 mejores: tarjetas con posición, puntaje y "Ver ficha"', async () => {
    setup();
    const region = await screen.findByRole('region', { name: 'Los 3 mejores' });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('1.º');
    expect(items[0]).toHaveTextContent('Ana Paz');
    expect(items[0]).toHaveTextContent('Puntaje 92 de 100');
    expect(items[2]).toHaveTextContent('Carla Soto');
    expect(within(region).getByText('Ordenados por puntaje.')).toBeInTheDocument();
  });

  it('sin requisitos: no hay Top 3 ni columnas de ranking, puntaje ni sugerencia', async () => {
    const rows = [itemRow(1, { score: null, recommendation: null, rank: null }), itemRow(2, { score: null, recommendation: null, rank: null })];
    setup({
      detail: analysisDetail({ requirements: [], has_requirements: false, status: 'COMPLETED', counts: { ...FINISHED_COUNTS, total: 2, done: 2, failed: 0 } }),
      counts: { total: 2, queued: 0, processing: 0, done: 2, failed: 0, cancelled: 0 },
      rows,
    });
    const table = await screen.findByRole('table');
    expect(screen.queryByText('Los 3 mejores')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Candidato', 'Estado']);
    expect(screen.queryByRole('button', { name: /avanzar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /todos \(2\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /con error \(0\)/i })).toBeInTheDocument();
  });

  it('los encabezados ordenables cambian el orden y lo anuncian con aria-sort', async () => {
    const u = userEvent.setup();
    setup();
    await screen.findByRole('table');
    await u.click(screen.getByRole('button', { name: 'Ordenar por Candidato' }));
    expect(rowNames()).toEqual(['Ana Paz', 'Beto Ríos', 'Carla Soto', 'cv_4.pdf']);
    expect(screen.getByRole('columnheader', { name: /candidato/i })).toHaveAttribute('aria-sort', 'ascending');
    await u.click(screen.getByRole('button', { name: 'Ordenar por Candidato' }));
    expect(rowNames()).toEqual(['cv_4.pdf', 'Carla Soto', 'Beto Ríos', 'Ana Paz']);
    expect(loc()).toContain('orden=-candidate_name');
    await u.click(screen.getByRole('button', { name: 'Ordenar por Puntaje' }));
    expect(rowNames()).toEqual(['Ana Paz', 'Beto Ríos', 'Carla Soto', 'cv_4.pdf']); // puntaje: primero el mayor, sin puntaje al final
    expect(screen.getByRole('columnheader', { name: /puntaje/i })).toHaveAttribute('aria-sort', 'descending');
  });

  it('filtros rápidos con conteos y aria-pressed; el estado queda en la URL', async () => {
    const u = userEvent.setup();
    setup();
    const group = await screen.findByRole('group', { name: 'Filtrar por sugerencia' });
    expect(within(group).getByRole('button', { name: 'Todos (4)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Avanzar (1)' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Revisar (1)' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'No avanzar (1)' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Con error (1)' })).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: /en curso/i })).not.toBeInTheDocument();
    await u.click(within(group).getByRole('button', { name: 'Revisar (1)' }));
    expect(rowNames()).toEqual(['Beto Ríos']);
    expect(loc()).toContain('sugerencia=REVIEW');
    expect(within(group).getByRole('button', { name: 'Revisar (1)' })).toHaveAttribute('aria-pressed', 'true');
    await u.click(within(group).getByRole('button', { name: 'Con error (1)' }));
    expect(rowNames()).toEqual(['cv_4.pdf']);
    expect(loc()).toContain('estado=FAILED');
    expect(loc()).not.toContain('sugerencia');
  });

  it('restaura filtros y búsqueda desde la URL al recargar', async () => {
    setup({ entry: '/rrhh/cvs/5?sugerencia=ADVANCE&q=ana' });
    await screen.findByRole('table');
    expect(rowNames()).toEqual(['Ana Paz']);
    expect(screen.getByRole('searchbox', { name: 'Buscar candidato' })).toHaveValue('ana');
    expect(screen.getByRole('button', { name: 'Avanzar (1)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('busca por nombre sin distinguir acentos y ofrece "Quitar filtros" si nada coincide', async () => {
    const u = userEvent.setup();
    setup();
    await screen.findByRole('table');
    await u.type(screen.getByRole('searchbox', { name: 'Buscar candidato' }), 'rios');
    expect(rowNames()).toEqual(['Beto Ríos']);
    await u.clear(screen.getByRole('searchbox', { name: 'Buscar candidato' }));
    await u.type(screen.getByRole('searchbox', { name: 'Buscar candidato' }), 'zzzz');
    expect(await screen.findByText('Ningún CV coincide.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(rowNames()).toHaveLength(4);
    expect(loc()).not.toContain('q=');
  });

  it('en pantallas angostas se muestran tarjetas y no la tabla (solo una variante)', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    setup();
    await screen.findByRole('button', { name: 'Ana Paz' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
  });

  it('un análisis terminado no muestra la celebración al reabrirlo', async () => {
    setup();
    await screen.findByRole('table');
    expect(screen.queryByText(/¡Listo!/)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('HRCVAnalysisPage — acciones', () => {
  it('con errores, la acción principal es "Reintentar fallidos (1)" y Excel pasa a secundaria', async () => {
    const u = userEvent.setup();
    const { container } = setup();
    const retry = await screen.findByRole('button', { name: 'Reintentar fallidos (1)' });
    expect([...container.querySelectorAll('button.bg-violet-600, a.bg-violet-600')]).toEqual([retry]);
    expect(screen.getByRole('button', { name: 'Descargar Excel' }).className).not.toMatch(/bg-violet-600/);
    await u.click(retry);
    await waitFor(() => expect(hrApi.retryFailedCVItems).toHaveBeenCalledWith('5'));
    expect(await screen.findByText('Reintentando 1 CV.')).toBeInTheDocument();
    await waitFor(() => expect(hrApi.getCVProgress.mock.calls.length).toBeGreaterThan(1));
  });

  it('terminado sin errores: Excel es la acción principal y hay ZIP y "Agregar más CVs"', async () => {
    const counts = { total: 3, queued: 0, processing: 0, done: 3, failed: 0, cancelled: 0 };
    const { container } = setup({ counts, rows: finishedRows().filter((r) => r.status === 'DONE'), detail: analysisDetail({ status: 'COMPLETED', counts }) });
    const excel = await screen.findByRole('button', { name: 'Descargar Excel' });
    expect([...container.querySelectorAll('button.bg-violet-600, a.bg-violet-600')]).toEqual([excel]);
    expect(screen.getByRole('button', { name: 'Descargar ZIP de PDFs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agregar más CVs' })).toHaveAttribute('href', '/rrhh/cvs/5/preparar?paso=2');
  });

  it('descarga el Excel como blob, avisa con un toast y evita el doble clic mientras prepara', async () => {
    const u = userEvent.setup();
    let release;
    hrApi.downloadCVXlsx.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ blob: new Blob(['x']), filename: 'Candidatos_x.xlsx' }); }));
    setup();
    await u.click(await screen.findByRole('button', { name: 'Descargar Excel' }));
    const busy = await screen.findByRole('button', { name: 'Preparando…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true'); // no `disabled`: el foco no se pierde
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    release();
    expect(await screen.findByText('Excel descargado.')).toBeInTheDocument();
    expect(hrApi.downloadCVXlsx).toHaveBeenCalledTimes(1);
    expect(hrApi.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'Candidatos_x.xlsx');
  });

  it('si la descarga falla muestra una alerta persistente y permite reintentar', async () => {
    const u = userEvent.setup();
    hrApi.downloadCVZip.mockRejectedValueOnce({ response: { status: 409, data: { code: 'nothing_to_download', detail: 'Aún no hay CVs listos para descargar.' } } });
    setup();
    await u.click(await screen.findByRole('button', { name: 'Descargar ZIP de PDFs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Aún no hay CVs listos para descargar.');
    const actions = screen.getByRole('group', { name: 'Acciones del análisis' });
    await u.click(within(actions).getByRole('button', { name: 'Reintentar descarga de ZIP de PDFs' }));
    expect(await screen.findByText('ZIP descargado.')).toBeInTheDocument();
  });

  it('sin ningún CV listo las descargas quedan aria-disabled con la razón visible', async () => {
    const u = userEvent.setup();
    const counts = { total: 1, queued: 0, processing: 0, done: 0, failed: 1, cancelled: 0 };
    setup({ counts, rows: [finishedRows()[2]], detail: analysisDetail({ status: 'COMPLETED_WITH_ERRORS', counts }) });
    const excel = await screen.findByRole('button', { name: 'Descargar Excel' });
    expect(excel).toHaveAttribute('aria-disabled', 'true');
    expect(excel).toHaveAccessibleDescription('Disponible cuando haya un CV listo.');
    await u.click(excel);
    expect(hrApi.downloadCVXlsx).not.toHaveBeenCalled();
  });

  it('reintentar un CV desde la tabla', async () => {
    const u = userEvent.setup();
    setup();
    const table = await screen.findByRole('table');
    const retryBtn = within(table).getByRole('button', { name: /^Reintentar .+/ });
    expect(retryBtn).toHaveTextContent('Reintentar'); // el texto visible va contenido en el nombre (2.5.3)
    await u.click(retryBtn);
    await waitFor(() => expect(hrApi.retryCVItem).toHaveBeenCalledWith('5', 4));
    expect(await screen.findByText('Reintentando 1 CV.')).toBeInTheDocument();
  });

  it('un error de acción se muestra y no se descarta solo', async () => {
    const u = userEvent.setup();
    hrApi.retryFailedCVItems.mockRejectedValue({ response: { status: 503, data: { code: 'analysis_unavailable', detail: 'x' } } });
    setup();
    await u.click(await screen.findByRole('button', { name: 'Reintentar fallidos (1)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/falta la clave de anthropic/i);
  });

  it('eliminar el análisis pide confirmación (foco inicial en Cancelar) y luego vuelve a la lista', async () => {
    const u = userEvent.setup();
    setup();
    await screen.findByRole('table');
    await u.click(screen.getByText('Más opciones'));
    await u.click(screen.getByRole('button', { name: 'Eliminar análisis' }));
    const dialog = screen.getByRole('dialog', { name: '¿Eliminar este análisis?' });
    expect(within(dialog).getByText('Se borrarán los archivos y reportes. No se puede deshacer.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(hrApi.deleteCVAnalysis).not.toHaveBeenCalled();
    await u.click(within(dialog).getByRole('button', { name: 'Eliminar todo' }));
    await waitFor(() => expect(hrApi.deleteCVAnalysis).toHaveBeenCalledWith('5'));
    expect(await screen.findByText('PANTALLA LISTA')).toBeInTheDocument();
  });

  it('cancelar la confirmación no borra nada', async () => {
    const u = userEvent.setup();
    setup();
    await screen.findByRole('table');
    await u.click(screen.getByText('Más opciones'));
    await u.click(screen.getByRole('button', { name: 'Eliminar análisis' }));
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hrApi.deleteCVAnalysis).not.toHaveBeenCalled();
  });

  it('reanuda las canceladas con un reintento por CV (máx. 5 a la vez)', async () => {
    const u = userEvent.setup();
    const counts = { total: 3, queued: 0, processing: 0, done: 1, failed: 0, cancelled: 2 };
    const rows = [itemRow(1), itemRow(2, { status: 'CANCELLED', score: null, recommendation: null, candidate_name: null }), itemRow(3, { status: 'CANCELLED', score: null, recommendation: null, candidate_name: null })];
    setup({ counts, rows, detail: analysisDetail({ status: 'COMPLETED', counts }) });
    await u.click(await screen.findByRole('button', { name: 'Reanudar canceladas (2)' }));
    await waitFor(() => expect(hrApi.retryCVItem).toHaveBeenCalledTimes(2));
    expect(hrApi.retryCVItem.mock.calls.map((c) => c[1]).sort()).toEqual([2, 3]);
  });
});

describe('HRCVAnalysisPage — solo lectura y estados', () => {
  it('GENERAL_MANAGER: ve resultados y descargas, sin acciones de escritura ni enlaces del stepper', async () => {
    setup({ role: 'GENERAL_MANAGER' });
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar ZIP de PDFs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agregar más CVs' })).not.toBeInTheDocument();
    expect(screen.queryByText('Más opciones')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Pasos del análisis' })).queryAllByRole('link')).toHaveLength(0);
  });

  it('análisis vacío: tarjeta "Aún no hay CVs." con "Subir CVs" como única acción primaria', async () => {
    const counts = { total: 0, queued: 0, processing: 0, done: 0, failed: 0, cancelled: 0 };
    const { container } = setup({ counts, rows: [], detail: analysisDetail({ counts }) });
    const cta = await screen.findByRole('link', { name: 'Subir CVs' });
    expect(screen.getByText('Aún no hay CVs.')).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/rrhh/cvs/5/preparar?paso=2');
    expect([...container.querySelectorAll('button.bg-violet-600, a.bg-violet-600')]).toEqual([cta]);
  });

  it('análisis vacío para el gerente general: solo el mensaje', async () => {
    const counts = { total: 0, queued: 0, processing: 0, done: 0, failed: 0, cancelled: 0 };
    setup({ role: 'GENERAL_MANAGER', counts, rows: [], detail: analysisDetail({ counts }) });
    expect(await screen.findByText('Aún no hay CVs en este análisis.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Subir CVs' })).not.toBeInTheDocument();
  });

  it('un análisis inexistente muestra "No encontramos este análisis." con la salida', async () => {
    setup({ analysisError: { response: { status: 404, data: {} } } });
    expect(await screen.findByRole('heading', { name: 'No encontramos este análisis.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a la lista' })).toHaveAttribute('href', '/rrhh/cvs');
  });

  it('mientras carga muestra "Cargando el análisis…"', async () => {
    setup();
    expect(screen.getByText('Cargando el análisis…')).toBeInTheDocument();
    await screen.findByRole('table');
  });

  it('un error de carga del análisis ofrece Reintentar y lo recupera', async () => {
    const u = userEvent.setup();
    setup({ analysisError: { response: { status: 500, data: {} } } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Residente de obra — Oct 2026' })).toBeInTheDocument();
  });

  it('si falla la lista de candidatos muestra el error con Reintentar y lo recupera', async () => {
    const u = userEvent.setup();
    setup({ itemsError: { response: { status: 500, data: {} } } });
    expect(await screen.findByText(/error del servidor|No pudimos cargar los candidatos/i)).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    await u.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
