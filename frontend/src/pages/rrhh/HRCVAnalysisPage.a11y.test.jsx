import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { itemDetail } from '../../test/cvFixtures';
import { loc, setup } from '../../test/cvPageHarness';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  delete window.matchMedia;
  hrApi.saveBlob.mockImplementation(() => {});
  hrApi.getCVItem.mockImplementation(async (a, id) => ({ data: itemDetail(id) }));
});

// Persistent sr-only status region that reports what a filter left on screen.
const filterRegion = () =>
  screen.getAllByRole('status').find((el) => el.classList.contains('sr-only') && /candidatos?\.$|coincide/.test(el.textContent || '') ) ?? null;
const statusRegions = () => screen.getAllByRole('status').filter((el) => el.classList.contains('sr-only'));

describe('Resultados — anuncio de filtros y búsqueda', () => {
  it('la región de estado existe desde el principio, vacía', async () => {
    setup();
    await screen.findByRole('table');
    expect(statusRegions().some((el) => el.textContent === '')).toBe(true);
  });

  it('al cambiar un filtro rápido anuncia cuántos candidatos quedan', async () => {
    const u = userEvent.setup();
    setup();
    await screen.findByRole('table');
    await u.click(screen.getByRole('button', { name: /^Avanzar/ }));
    await waitFor(() => expect(filterRegion()).toHaveTextContent('Mostrando 1 de 4 candidatos.'), { timeout: 2500 });
  });

  it('al buscar anuncia una sola vez (con pausa) y avisa si ningún CV coincide', async () => {
    const u = userEvent.setup();
    setup();
    await screen.findByRole('table');
    await u.type(screen.getByRole('searchbox', { name: 'Buscar candidato' }), 'zzzz');
    // la tabla responde al instante...
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // ...pero el anuncio espera a que termine de escribir
    expect(statusRegions().every((el) => !/coincide/.test(el.textContent))).toBe(true);
    await waitFor(() => expect(filterRegion()).toHaveTextContent('Ningún CV coincide.'), { timeout: 2500 });
  });

  it('actualiza la URL con pausa (no en cada pulsación) y "Quitar filtros" limpia el cuadro', async () => {
    const u = userEvent.setup();
    setup();
    await screen.findByRole('table');
    const box = screen.getByRole('searchbox', { name: 'Buscar candidato' });
    await u.type(box, 'Ana');
    expect(loc()).not.toContain('q=');
    await waitFor(() => expect(loc()).toContain('q=Ana'), { timeout: 2000 });
    await u.click(screen.getAllByRole('button', { name: 'Quitar filtros' })[0]);
    expect(box).toHaveValue('');
    await waitFor(() => expect(loc()).not.toContain('q='));
  });
});

describe('Resultados — ficha y foco', () => {
  it('"Los 3 mejores" es un h3 dentro de la sección Resultados (jerarquía)', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 3, name: 'Los 3 mejores' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Resultados' })).toBeInTheDocument();
  });

  it('al cerrar la ficha abierta desde el Top 3, el foco vuelve al botón "Ver ficha" y no a la tabla', async () => {
    const u = userEvent.setup();
    setup();
    const region = await screen.findByRole('region', { name: 'Los 3 mejores' });
    const seeCard = within(region).getAllByRole('button', { name: 'Ver ficha' })[1];
    await u.click(seeCard);
    await screen.findByRole('dialog');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(seeCard).toHaveFocus());
  });

  it('al cerrar la ficha abierta desde la tabla, el foco vuelve al nombre del candidato', async () => {
    const u = userEvent.setup();
    setup();
    const name = await screen.findByRole('button', { name: 'Beto Ríos' });
    await u.click(name);
    await screen.findByRole('dialog');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Beto Ríos' })).toHaveFocus());
  });
});

describe('Resultados — textos accesibles de los guiones', () => {
  it('"Sin puntaje" y "Sin ranking" llegan como texto, no como aria-label sobre un span', async () => {
    setup();
    const table = await screen.findByRole('table');
    const failedRow = within(table).getByText('cv_4.pdf').closest('tr');
    expect(within(failedRow).getByText('Sin puntaje')).toBeInTheDocument();
    expect(within(failedRow).getByText('Sin ranking todavía')).toBeInTheDocument();
    expect(table.querySelectorAll('span[aria-label]')).toHaveLength(0);
  });
});
