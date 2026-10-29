import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SUMMARY } from '../../test/almacenFixtures';
import AlmacenDashboardPage from './AlmacenDashboardPage';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · QA ronda 2 — el tablero con fallos parciales, singular/plural y listas largas de alertas.

const alert = (n, stock) => ({
  id: n, product_code: `EPP${String(n).padStart(6, '0')}`, description: `Ítem ${n}`, unit: 'EA', min_stock: 5, current_stock: stock,
});

const kpi = (label) => screen.getByText(label).previousElementSibling;

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getSummary.mockResolvedValue({ data: SUMMARY });
  api.getAlerts.mockResolvedValue({ data: [] });
  api.getMovementSummary.mockResolvedValue({ data: { results: [], meta: { totals: { closing: 6857 } } } });
  api.getMovements.mockResolvedValue({ data: { count: 342, results: [] } });
});

describe('AlmacenDashboardPage — fallos parciales', () => {
  it('sin el resumen por ítem, «Unidades en stock» muestra una raya y los demás indicadores siguen', async () => {
    api.getMovementSummary.mockRejectedValue(new Error('boom'));
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Egresos sin vale');
    expect(kpi('Unidades en stock')).toHaveTextContent('—');
    expect(kpi('Ítems')).toHaveTextContent('254');
    expect(kpi('Egresos sin vale')).toHaveTextContent('342');
  });

  it('sin el conteo de egresos sin vale, ese indicador muestra una raya y no un 0 engañoso', async () => {
    api.getMovements.mockRejectedValue(new Error('boom'));
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Egresos sin vale');
    expect(kpi('Egresos sin vale')).toHaveTextContent('—');
    expect(kpi('Egresos sin vale')).not.toHaveTextContent('0');
    expect(kpi('Unidades en stock')).toHaveTextContent(/6[.,]857/);
  });

  it('un resumen sin totales deja la raya en «Unidades en stock»', async () => {
    api.getMovementSummary.mockResolvedValue({ data: { results: [] } });
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Egresos sin vale');
    expect(kpi('Unidades en stock')).toHaveTextContent('—');
  });

  it('un conteo de egresos sin vale en cero se muestra como 0, no como raya', async () => {
    api.getMovements.mockResolvedValue({ data: { count: 0, results: [] } });
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Egresos sin vale');
    expect(kpi('Egresos sin vale')).toHaveTextContent('0');
  });
});

describe('AlmacenDashboardPage — avisos y alertas', () => {
  it('un solo movimiento sin fecha usa el singular', async () => {
    api.getSummary.mockResolvedValue({ data: { ...SUMMARY, undated_movements: 1 } });
    renderWithProviders(<AlmacenDashboardPage />);
    expect(await screen.findByText(/1 movimiento no tiene fecha registrada/i)).toBeInTheDocument();
  });

  it('sin movimientos sin fecha no hay aviso', async () => {
    renderWithProviders(<AlmacenDashboardPage />);
    await screen.findByText('Egresos sin vale');
    expect(screen.queryByText(/fecha registrada/i)).not.toBeInTheDocument();
  });

  it('las alertas pueden llegar paginadas ({results})', async () => {
    api.getAlerts.mockResolvedValue({ data: { results: [alert(1, 2), alert(2, 0)] } });
    renderWithProviders(<AlmacenDashboardPage />);
    const low = await screen.findByRole('region', { name: 'Bajo mínimo' });
    expect(await within(low).findByText('EPP000001')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Sin stock' })).getByText('EPP000002')).toBeInTheDocument();
  });

  it('con más de 8 alertas el encabezado cuenta todas pero la tabla muestra las 8 primeras', async () => {
    api.getAlerts.mockResolvedValue({ data: Array.from({ length: 12 }, (_, i) => alert(i + 1, 1)) });
    renderWithProviders(<AlmacenDashboardPage />);
    const low = await screen.findByRole('region', { name: 'Bajo mínimo' });
    expect(await within(low).findByText('EPP000001')).toBeInTheDocument();
    expect(within(low).getByRole('heading', { name: /bajo mínimo \(12\)/i })).toBeInTheDocument();
    expect(within(low).getAllByRole('row')).toHaveLength(1 + 8);                    // cabecera + 8
    expect(within(low).queryByText('EPP000009')).not.toBeInTheDocument();
    expect(within(low).getByRole('link', { name: /ver todos/i })).toBeInTheDocument();
  });

  it('una alerta con stock negativo cuenta como «Sin stock», no como «Bajo mínimo»', async () => {
    api.getAlerts.mockResolvedValue({ data: [alert(1, -3)] });
    renderWithProviders(<AlmacenDashboardPage />);
    const none = await screen.findByRole('region', { name: 'Sin stock' });
    expect(await within(none).findByText('EPP000001')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Bajo mínimo' })).queryByText('EPP000001')).not.toBeInTheDocument();
  });
});
