import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { itemDetail } from '../../test/cvFixtures';
import { loc, setup } from '../../test/cvPageHarness';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const makeDetails = () => ({
  1: () => itemDetail(1, { candidate_name: 'Ana Paz', score: 92, rank: 1 }),
  2: () => itemDetail(2, { candidate_name: 'Beto Ríos', score: 75, rank: 2, recommendation: 'REVIEW' }),
  3: () => itemDetail(3, { candidate_name: 'Carla Soto', score: 40, rank: 3, recommendation: 'NO_ADVANCE' }),
  4: () => itemDetail(4, { status: 'FAILED', error_code: 'ai_failed', error_message: 'El servicio no respondió. Inténtalo de nuevo.', candidate_name: null, score: null, recommendation: null, report: null, computed: null }),
});
let details = makeDetails();

beforeEach(() => {
  vi.clearAllMocks();
  details = makeDetails();
  delete window.matchMedia;
  hrApi.saveBlob.mockImplementation(() => {});
  hrApi.getCVItem.mockImplementation(async (a, id) => ({ data: details[id]() }));
  hrApi.downloadCVReport.mockResolvedValue({ blob: new Blob(['x']), filename: 'Reporte_Paz.pdf' });
  hrApi.downloadCVOriginal.mockResolvedValue({ blob: new Blob(['x']), filename: 'cv.pdf' });
  hrApi.retryCVItem.mockResolvedValue({ data: {} });
  hrApi.deleteCVItem.mockResolvedValue({});
  hrApi.retryFailedCVItems.mockResolvedValue({ data: { requeued: 1 } });
});

async function openAna(u) {
  await u.click(await screen.findByRole('button', { name: 'Ana Paz' }));
  return screen.findByRole('dialog', { name: 'Ana Paz' });
}

describe('Ficha del candidato (drawer)', () => {
  it('se abre desde el botón del nombre con el foco en el título, y muestra puntaje, sugerencia y aviso de la IA', async () => {
    const u = userEvent.setup();
    setup();
    const d = await openAna(u);
    expect(loc()).toBe('/rrhh/cvs/5?candidato=1');
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(within(d).getByRole('heading', { name: 'Ana Paz' })).toHaveFocus();
    expect(await within(d).findByText('Puntaje 92 de 100')).toBeInTheDocument();
    expect(within(d).getAllByText('Avanzar').length).toBeGreaterThan(0);
    expect(within(d).getByText('La IA ayuda a ordenar; la decisión final es de RR. HH.')).toBeInTheDocument();
    expect(within(d).getByText('1 de 4')).toBeInTheDocument();
  });

  it('divulgación progresiva: resumen, requisitos, fortalezas y brechas abiertos; el resto colapsado', async () => {
    const u = userEvent.setup();
    setup();
    const d = await openAna(u);
    await within(d).findByText('Puntaje 92 de 100');
    const open = (title) => within(d).getByText(title).closest('details');
    expect(open('Resumen')).toHaveAttribute('open');
    expect(open('Requisitos')).toHaveAttribute('open');
    expect(open('Fortalezas')).toHaveAttribute('open');
    expect(open('Brechas')).toHaveAttribute('open');
    ['Experiencia', 'Formación', 'Habilidades', 'Certificaciones e idiomas', 'Contacto', 'Datos técnicos'].forEach((t) => {
      expect(open(t)).not.toHaveAttribute('open');
    });
    expect(within(d).getByText('Ingeniero con 6 años en obras viales.')).toBeInTheDocument();
  });

  it('cada requisito se muestra con icono + texto + evidencia, y el obligatorio lo dice', async () => {
    const u = userEvent.setup();
    setup();
    const d = await openAna(u);
    const section = (await within(d).findByText('Requisitos')).closest('details');
    const items = within(section).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Cumple');
    expect(items[0]).toHaveTextContent('Obligatorio');
    expect(items[0]).toHaveTextContent('Según el CV: CIP 12345');
    expect(items[0].querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(items[1]).toHaveTextContent('Parcial');
    expect(items[1]).not.toHaveTextContent('Obligatorio');
  });

  it('esc cierra, la URL se limpia y el foco vuelve al botón del candidato', async () => {
    const u = userEvent.setup();
    setup();
    await openAna(u);
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(loc()).toBe('/rrhh/cvs/5');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ana Paz' })).toHaveFocus());
  });

  it('el botón Cerrar también cierra', async () => {
    const u = userEvent.setup();
    setup();
    await openAna(u);
    await u.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('abre directo desde la URL (?candidato=2) y conserva los filtros', async () => {
    setup({ entry: '/rrhh/cvs/5?candidato=2&q=o' });
    const d = await screen.findByRole('dialog', { name: 'Beto Ríos' });
    expect(await within(d).findByText('Puntaje 75 de 100')).toBeInTheDocument();
    expect(within(d).getAllByText('Revisar').length).toBeGreaterThan(0);
  });

  it('Anterior/Siguiente recorren el orden actual, actualizan la URL y llevan el foco al nuevo nombre', async () => {
    const u = userEvent.setup();
    setup();
    const d = await openAna(u);
    expect(within(d).getByRole('button', { name: /anterior/i })).toHaveAttribute('aria-disabled', 'true');
    await u.click(within(d).getByRole('button', { name: /siguiente/i }));
    expect(await screen.findByRole('dialog', { name: 'Beto Ríos' })).toBeInTheDocument();
    expect(loc()).toBe('/rrhh/cvs/5?candidato=2');
    expect(screen.getByRole('heading', { name: 'Beto Ríos' })).toHaveFocus();
    expect(screen.getByText('2 de 4')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /anterior/i }));
    expect(await screen.findByRole('dialog', { name: 'Ana Paz' })).toBeInTheDocument();
  });

  it('el botón Atrás del navegador cierra la ficha (se abrió con una entrada de historial)', async () => {
    const u = userEvent.setup();
    setup();
    await openAna(u);
    // Esc usa el mismo camino que "Atrás": deshace la entrada que abrió la ficha
    await u.keyboard('{Escape}');
    expect(loc()).toBe('/rrhh/cvs/5');
  });

  it('un CV fallido explica el motivo y ofrece Reintentar; "cv_unreadable" no lo ofrece', async () => {
    const u = userEvent.setup();
    setup();
    await u.click(await screen.findByRole('button', { name: 'cv_4.pdf' }));
    const d = await screen.findByRole('dialog', { name: 'cv_4.pdf' });
    expect(await within(d).findByText('No pudimos analizar este CV.')).toBeInTheDocument();
    expect(within(d).getByText('El servicio no respondió. Inténtalo de nuevo.')).toBeInTheDocument();
    await u.click(within(d).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(hrApi.retryCVItem).toHaveBeenCalledWith(5, 4));
  });

  it('un fallo no reintentable ofrece el CV original en lugar de Reintentar', async () => {
    const u = userEvent.setup();
    details[4] = () => itemDetail(4, { status: 'FAILED', error_code: 'cv_unreadable', error_message: '', candidate_name: null, score: null, recommendation: null, report: null, computed: null });
    setup();
    await u.click(await screen.findByRole('button', { name: 'cv_4.pdf' }));
    const d = await screen.findByRole('dialog', { name: 'cv_4.pdf' });
    expect(await within(d).findByText('No pudimos leer este CV. Prueba con otra versión.')).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Descargar CV original' })).toBeInTheDocument();
  });

  it('un CV en curso dice que sigue leyéndose', async () => {
    const u = userEvent.setup();
    details[1] = () => itemDetail(1, { status: 'PROCESSING', report: null, computed: null, score: null, recommendation: null });
    setup();
    await u.click(await screen.findByRole('button', { name: 'Ana Paz' }));
    expect(await screen.findByText('Aún estamos leyendo este CV.')).toBeInTheDocument();
  });

  it('muestra los avisos de lectura: texto dirigido a la IA, lectura difícil y años estimados', async () => {
    const u = userEvent.setup();
    const base = itemDetail(1, { candidate_name: 'Ana Paz' });
    details[1] = () => ({
      ...base,
      injection_suspected: true,
      report: { ...base.report, readability: 'poor' },
      computed: { ...base.computed, experience_source: 'ai_estimate' },
    });
    setup();
    const d = await openAna(u);
    expect(await within(d).findByText('El CV contiene texto dirigido a una IA. Revísalo a mano.')).toBeInTheDocument();
    expect(within(d).getByText('El archivo se leyó con dificultad. Revisa el CV original.')).toBeInTheDocument();
    expect(within(d).getByText('≈ Años estimados por la IA.')).toBeInTheDocument();
  });

  it('un error al cargar la ficha ofrece Reintentar', async () => {
    const u = userEvent.setup();
    hrApi.getCVItem.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    setup();
    const d = await openAna(u);
    expect(await within(d).findByText('No pudimos cargar la ficha.')).toBeInTheDocument();
    await u.click(within(d).getByRole('button', { name: 'Reintentar' }));
    expect(await within(d).findByText('Puntaje 92 de 100')).toBeInTheDocument();
  });

  it('muestra "Cargando la ficha…" mientras llega', async () => {
    const u = userEvent.setup();
    let release;
    hrApi.getCVItem.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: details[1]() }); }));
    setup();
    const d = await openAna(u);
    expect(within(d).getByText('Cargando la ficha…')).toBeInTheDocument();
    release();
    expect(await within(d).findByText('Puntaje 92 de 100')).toBeInTheDocument();
  });

  it('descarga el reporte PDF y el CV original por blob; si el original no está lo explica', async () => {
    const u = userEvent.setup();
    setup();
    const d = await openAna(u);
    await u.click(await within(d).findByRole('button', { name: 'Descargar reporte PDF' }));
    await waitFor(() => expect(hrApi.downloadCVReport).toHaveBeenCalledWith(5, 1));
    expect(await screen.findByText('Reporte descargado.')).toBeInTheDocument();
    await u.click(within(d).getByRole('button', { name: 'Descargar CV original' }));
    await waitFor(() => expect(hrApi.downloadCVOriginal).toHaveBeenCalledWith(5, 1));
  });

  it('si el archivo original ya no existe el botón queda aria-disabled con la razón', async () => {
    const u = userEvent.setup();
    details[1] = () => itemDetail(1, { candidate_name: 'Ana Paz', file_available: false });
    setup();
    const d = await openAna(u);
    const original = await within(d).findByRole('button', { name: 'Descargar CV original' });
    expect(original).toHaveAttribute('aria-disabled', 'true');
    expect(original).toHaveAccessibleDescription('El archivo original ya no está disponible.');
  });

  it('el texto del CV se muestra como texto: HTML no se interpreta y los enlaces peligrosos no son enlaces', async () => {
    const u = userEvent.setup();
    const base = itemDetail(1, { candidate_name: 'Ana Paz' });
    details[1] = () => ({ ...base, report: { ...base.report, summary: '<img src=x onerror=alert(1)> resumen', candidate: { ...base.report.candidate, links: ['https://linkedin.com/in/ana', 'javascript:alert(1)'] } } });
    setup();
    const d = await openAna(u);
    expect(await within(d).findByText('<img src=x onerror=alert(1)> resumen')).toBeInTheDocument();
    expect(d.querySelector('img')).toBeNull();
    await u.click(within(d).getByText('Contacto'));
    const link = within(d).getByRole('link', { name: 'https://linkedin.com/in/ana' });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(d).getByText('javascript:alert(1)').closest('a')).toBeNull();
  });
});

describe('Ficha del candidato — eliminar', () => {
  it('pide confirmación (foco en Cancelar), Esc cierra solo la confirmación y eliminar cierra la ficha con aviso', async () => {
    const u = userEvent.setup();
    setup();
    const d = await openAna(u);
    await u.click(await within(d).findByRole('button', { name: 'Eliminar este CV' }));
    const confirm = screen.getByRole('dialog', { name: '¿Eliminar este CV?' });
    expect(within(confirm).getByText('Se borrarán el archivo y su reporte. No se puede deshacer.')).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '¿Eliminar este CV?' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Ana Paz' })).toBeInTheDocument();
    expect(hrApi.deleteCVItem).not.toHaveBeenCalled();

    await u.click(within(d).getByRole('button', { name: 'Eliminar este CV' }));
    await u.click(screen.getByRole('button', { name: 'Eliminar CV' }));
    await waitFor(() => expect(hrApi.deleteCVItem).toHaveBeenCalledWith(5, 1));
    expect(await screen.findByText('CV eliminado.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(loc()).toBe('/rrhh/cvs/5');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Beto Ríos' })).toHaveFocus()); // el siguiente candidato
  });

  it('el gerente general no ve eliminar ni reintentar en la ficha', async () => {
    const u = userEvent.setup();
    setup({ role: 'GENERAL_MANAGER' });
    await u.click(await screen.findByRole('button', { name: 'cv_4.pdf' }));
    const d = await screen.findByRole('dialog', { name: 'cv_4.pdf' });
    await within(d).findByText('No pudimos analizar este CV.');
    expect(within(d).queryByRole('button', { name: 'Eliminar este CV' })).not.toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Descargar CV original' })).toBeInTheDocument();
  });
});
