import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SUMMARY } from '../../test/almacenFixtures';
import { addDaysISO, localISODate } from '../../utils/almacen';
import AlmacenDashboardPage from './AlmacenDashboardPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const ALERTS = [
  { id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', min_stock: 5, current_stock: 2, deficit: 3 },
  { id: 2, product_code: 'EPP000002', description: 'Guantes de cuero', unit: 'PAR', min_stock: 0, current_stock: 0, deficit: 0 },
  { id: 3, product_code: 'EPP000003', description: 'Lentes claros', unit: 'EA', min_stock: 0, current_stock: 0, deficit: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getSummary.mockResolvedValue({ data: SUMMARY });
  api.getAlerts.mockResolvedValue({ data: ALERTS });
  api.getMovementSummary.mockResolvedValue({ data: { results: [], meta: { totals: { closing: 6857 } } } });
  api.getMovements.mockResolvedValue({ data: { count: 342, results: [] } });
});

describe('AlmacenDashboardPage', () => {
  it('muestra los indicadores del almacén', async () => {
    renderWithProviders(<AlmacenDashboardPage />);
    const pendientes = await screen.findByText('Pendientes de ubicar');
    expect(pendientes.previousElementSibling).toHaveTextContent('254');
    expect(screen.getByText('Ítems').previousElementSibling).toHaveTextContent('254');
    expect(screen.getByText('Unidades en stock').previousElementSibling).toHaveTextContent(/6[.,]857/);
    expect(screen.getByText('Egresos hoy').previousElementSibling).toHaveTextContent('5');
    const sinVale = screen.getByText('Egresos sin vale');
    expect(sinVale.previousElementSibling).toHaveTextContent('342');
    expect(screen.getByText('Últimos 30 días')).toBeInTheDocument();
  });

  it('cuenta los egresos sin vale de los últimos 30 días', async () => {
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Egresos sin vale');
    expect(api.getMovements).toHaveBeenCalledWith({
      no_voucher: 'true', date_from: addDaysISO(localISODate(), -30), page_size: 1,
    });
  });

  it('separa "Bajo mínimo" de "Sin stock"', async () => {
    renderWithProviders(<AlmacenDashboardPage />);
    const low = await screen.findByRole('region', { name: 'Bajo mínimo' });
    const none = screen.getByRole('region', { name: 'Sin stock' });
    // QA ronda 1: la región aparece antes que sus filas (carga de alertas); esperar la fila evita una carrera.
    expect(await within(low).findByText('EPP000001')).toBeInTheDocument();
    expect(within(low).queryByText('EPP000002')).not.toBeInTheDocument();
    expect(within(none).getByText('EPP000002')).toBeInTheDocument();
    expect(within(none).getByText('EPP000003')).toBeInTheDocument();
    expect(within(low).getByRole('link', { name: /ver todos/i })).toHaveAttribute('href', '/almacen/inventario?estado=low');
    expect(within(none).getByRole('link', { name: /ver todos/i })).toHaveAttribute('href', '/almacen/inventario?estado=none');
  });

  it('avisa de los movimientos sin fecha', async () => {
    api.getSummary.mockResolvedValue({ data: { ...SUMMARY, undated_movements: 268 } });
    renderWithProviders(<AlmacenDashboardPage />);
    expect(await screen.findByText(/268 movimientos no tienen fecha registrada/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /revisarlos/i })).toHaveAttribute('href', '/almacen/movimientos?sin_fecha=1');
  });

  it('los accesos rápidos dependen del rol', async () => {
    const { unmount } = renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Egresos sin vale');
    expect(screen.getByRole('link', { name: /importar excel/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /transferencia interna/i })).toBeInTheDocument();
    unmount();

    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    const second = renderWithProviders(<AlmacenDashboardPage />);
    await screen.findAllByText('Egresos sin vale');
    expect(screen.queryByRole('link', { name: /importar excel/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /registrar entrega/i })).toBeInTheDocument();
    second.unmount();

    useAuth.mockReturnValue({ userRoles: ['LOGISTICS_COORDINATOR'] });
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findAllByText('Egresos sin vale');
    expect(screen.queryByRole('link', { name: /registrar entrega/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /transferencia interna/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /registrar ingreso/i })).toBeInTheDocument();
  });

  it('muestra el error y reintenta', async () => {
    const user = userEvent.setup();
    api.getSummary.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<AlmacenDashboardPage />);
    expect(await screen.findByText('No se pudieron cargar los datos del dashboard.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText('Egresos sin vale')).toBeInTheDocument();
  });

  it('un fallo parcial (alertas) no tumba el resto del tablero', async () => {
    api.getAlerts.mockRejectedValue(new Error('boom'));
    renderWithProviders(<AlmacenDashboardPage />);
    expect(await screen.findByText('No se pudieron cargar las alertas de stock.')).toBeInTheDocument();
    expect(screen.getByText('Egresos sin vale')).toBeInTheDocument();
  });
});

// SYSPCC-025 · react-frontend ronda 1 — aviso destacado «Empezar a ubicar» para los ítems sin ubicación exacta.
describe('AlmacenDashboardPage — empezar a ubicar', () => {
  it('ofrece «Empezar a ubicar» al rol que puede asignar ubicaciones', async () => {
    renderWithProviders(<AlmacenDashboardPage />);
    const link = await screen.findByRole('link', { name: /empezar a ubicar/i });
    expect(link).toHaveAttribute('href', '/almacen/inventario?pendientes=1&ubicar=1');
    expect(screen.getByText(/sin ubicación exacta: 254/i)).toBeInTheDocument();
  });

  it('no lo ofrece a quien no puede asignar ubicaciones, pero conserva el indicador', async () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Pendientes de ubicar');
    expect(screen.queryByRole('link', { name: /empezar a ubicar/i })).not.toBeInTheDocument();
  });

  it('no lo muestra si no hay pendientes', async () => {
    api.getSummary.mockResolvedValue({ data: { ...SUMMARY, pending_location_count: 0 } });
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Pendientes de ubicar');
    expect(screen.queryByRole('link', { name: /empezar a ubicar/i })).not.toBeInTheDocument();
  });
});
