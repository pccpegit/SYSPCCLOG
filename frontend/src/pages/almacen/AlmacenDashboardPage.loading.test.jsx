import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SUMMARY } from '../../test/almacenFixtures';
import AlmacenDashboardPage from './AlmacenDashboardPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const NEVER = () => new Promise(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getSummary.mockResolvedValue({ data: SUMMARY });
  api.getAlerts.mockResolvedValue({ data: [] });
  api.getMovementSummary.mockResolvedValue({ data: { results: [], meta: { totals: { closing: 6857 } } } });
  api.getMovements.mockResolvedValue({ data: { count: 0, results: [] } });
});

describe('AlmacenDashboardPage — mientras carga', () => {
  /**
   * DEFECTO QA-30 (lo pidió accesibilidad ronda 2): mientras las alertas no llegan, la lista está
   * vacía y las dos tablas afirman «Ningún ítem está bajo su stock mínimo» y «Todos los ítems tienen
   * stock», que son afirmaciones falsas hasta que el servidor responda (y un lector de pantalla las lee).
   */
  it('DEFECTO QA-30: no afirma que todos los ítems tienen stock mientras las alertas cargan', async () => {
    api.getSummary.mockImplementation(NEVER);
    api.getAlerts.mockImplementation(NEVER);
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByRole('heading', { name: 'Dashboard' });

    expect(screen.queryByText('Todos los ítems tienen stock.')).not.toBeInTheDocument();
    expect(screen.queryByText('Ningún ítem está bajo su stock mínimo.')).not.toBeInTheDocument();
  });

  it('cuando termina de cargar y no hay alertas, sí lo dice', async () => {
    renderWithProviders(<AlmacenDashboardPage />);
    expect(await screen.findByText('Todos los ítems tienen stock.')).toBeInTheDocument();
    expect(screen.getByText('Ningún ítem está bajo su stock mínimo.')).toBeInTheDocument();
  });

  it('mientras cargan, cada tabla de alertas muestra su carga (con nombre) y no un conteo «(0)»', async () => {
    api.getAlerts.mockImplementation(NEVER);
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByRole('heading', { name: 'Dashboard' });

    const low = screen.getByRole('region', { name: 'Bajo mínimo' });
    const none = screen.getByRole('region', { name: 'Sin stock' });
    expect(within(low).getByRole('status', { name: 'Cargando Bajo mínimo' })).toBeInTheDocument();
    expect(within(none).getByRole('status', { name: 'Cargando Sin stock' })).toBeInTheDocument();
    expect(within(low).queryByText('(0)')).not.toBeInTheDocument();
    expect(within(none).queryByText('(0)')).not.toBeInTheDocument();
    expect(within(none).queryByRole('table')).not.toBeInTheDocument();
  });

  it('al llegar las alertas la carga desaparece y aparecen los conteos y las filas', async () => {
    api.getAlerts.mockResolvedValue({
      data: [{ id: 1, product_code: 'EPP000001', description: 'Casco blanco', current_stock: 0, min_stock: 5 }],
    });
    renderWithProviders(<AlmacenDashboardPage />);
    const none = await screen.findByRole('region', { name: 'Sin stock' });
    expect(await within(none).findByText('EPP000001')).toBeInTheDocument();
    expect(within(none).getByText('(1)')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /^cargando (bajo mínimo|sin stock)/i })).not.toBeInTheDocument();
  });

  it('si las alertas fallan no dice «todo bien»: avisa del error', async () => {
    api.getAlerts.mockRejectedValue(new Error('boom'));
    renderWithProviders(<AlmacenDashboardPage />);
    expect(await screen.findByText('No se pudieron cargar las alertas de stock.')).toBeInTheDocument();
    expect(screen.queryByText('Todos los ítems tienen stock.')).not.toBeInTheDocument();
  });

  it('los indicadores muestran su carga con rol «status» y no una cifra inventada', async () => {
    api.getSummary.mockImplementation(NEVER);
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.getAllByRole('status', { name: /^cargando/i }).length).toBeGreaterThanOrEqual(4);
  });

  it('si el resumen falla, ofrece reintentar y no muestra indicadores', async () => {
    api.getSummary.mockRejectedValue(new Error('boom'));
    renderWithProviders(<AlmacenDashboardPage />);
    expect(await screen.findByText('No se pudieron cargar los datos del dashboard.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
    expect(screen.queryByText('Ítems')).not.toBeInTheDocument();
  });
});
