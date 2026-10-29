import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { summaryRow } from '../../test/almacenFixtures';
import ResumenPage from './ResumenPage';
import * as api from '../../api/almacen';
import * as core from '../../api/core';

vi.mock('../../api/almacen');
vi.mock('../../api/core');

// SYSPCC-025 · QA ronda 2 — resumen de movimiento: búsqueda, catálogos opcionales caídos y paginación.

const ROWS = [summaryRow({ inventory_id: 1, product_code: 'EPP000001', initial_stock: 5, entries: 10, exits: 3, closing_stock: 12 })];
const META = { totals: { initial: 5, entries: 10, exits: 3, closing: 12 }, undated_movements: 0 };
const lastParams = () => api.getMovementSummary.mock.lastCall[0];

beforeEach(() => {
  vi.clearAllMocks();
  api.getMovementSummary.mockResolvedValue({ data: { count: 120, results: ROWS, meta: META } });
  api.getCategories.mockResolvedValue({ data: ['EPP', 'Otros'] });
  core.getProjects.mockResolvedValue({ data: { results: [{ id: 4, code: 'OP', name: 'ON PLANT' }] } });
});

describe('ResumenPage — búsqueda', () => {
  it('el texto buscado viaja como «search» (con una breve espera) y vuelve a la página 1', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }));

    await user.type(screen.getByLabelText('Buscar'), 'casco');
    await waitFor(() => expect(lastParams()).toMatchObject({ search: 'casco', page: 1 }), { timeout: 3000 });
  });

  it('borrar el texto quita el parámetro', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Buscar'), 'x');
    await waitFor(() => expect(lastParams()).toMatchObject({ search: 'x' }), { timeout: 3000 });
    await user.clear(screen.getByLabelText('Buscar'));
    await waitFor(() => expect(lastParams()).not.toHaveProperty('search'), { timeout: 3000 });
  });
});

describe('ResumenPage — catálogos opcionales que fallan', () => {
  it('sin categorías la lista queda en «Todas» y la tabla se ve igual', async () => {
    api.getCategories.mockRejectedValue(new Error('boom'));
    renderWithProviders(<ResumenPage />);
    const table = await screen.findByRole('table', { name: /resumen de movimiento por ítem/i });
    expect(within(table).getByText('EPP000001')).toBeInTheDocument();
    const select = screen.getByLabelText('Categoría');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todas']);
  });

  it('sin proyectos el filtro «Proyecto» no se ofrece y el resto funciona', async () => {
    core.getProjects.mockRejectedValue({ response: { status: 403 } });
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    await waitFor(() => expect(core.getProjects).toHaveBeenCalled());
    expect(screen.queryByLabelText('Proyecto')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Piso')).toBeInTheDocument();
  });

  it('una respuesta de categorías con otra forma no rompe la pantalla', async () => {
    api.getCategories.mockResolvedValue({ data: { detail: 'no es una lista' } });
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    expect(within(screen.getByLabelText('Categoría')).getAllByRole('option')).toHaveLength(1);
  });
});

describe('ResumenPage — paginación', () => {
  it('con 120 ítems hay 3 páginas de 50 y se puede avanzar y retroceder', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResumenPage />);
    await screen.findByRole('table');
    expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ page: 1, page_size: 50 });

    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /anterior/i }));
    expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument();
  });
});
