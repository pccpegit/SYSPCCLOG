import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import WarehouseSidebar from './WarehouseSidebar';
import { useAuth } from '../../context/useAuth';

vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

const link = (name) => screen.queryByRole('link', { name });

beforeEach(() => vi.clearAllMocks());

describe('WarehouseSidebar', () => {
  it('Almacén Central ve todas las pantallas, incluida Importar Excel', () => {
    useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
    renderWithProviders(<WarehouseSidebar isOpen onClose={vi.fn()} />);
    expect(link('Resumen de movimiento')).toHaveAttribute('href', '/almacen/resumen');
    expect(link('Ingreso de Material')).toHaveAttribute('href', '/almacen/entrada');
    expect(link('Entrega / Egreso')).toHaveAttribute('href', '/almacen/salida');
    expect(link('Transferencia interna')).toHaveAttribute('href', '/almacen/transferencia');
    expect(link('Importar Excel')).toHaveAttribute('href', '/almacen/importar');
    expect(screen.getByText('Administración')).toBeInTheDocument();
  });

  it('Almacén de Obra no ve Importar Excel ni la sección Administración', () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    renderWithProviders(<WarehouseSidebar isOpen onClose={vi.fn()} />);
    expect(link('Importar Excel')).not.toBeInTheDocument();
    expect(screen.queryByText('Administración')).not.toBeInTheDocument();
    expect(link('Transferencia interna')).toBeInTheDocument();
  });

  it('un rol de logística no ve Transferencia interna ni Importar Excel', () => {
    useAuth.mockReturnValue({ userRoles: ['LOGISTICS_COORDINATOR'] });
    renderWithProviders(<WarehouseSidebar isOpen onClose={vi.fn()} />);
    expect(link('Transferencia interna')).not.toBeInTheDocument();
    expect(link('Importar Excel')).not.toBeInTheDocument();
    expect(link('Movimientos')).toBeInTheDocument();
  });

  it('Jefatura de Logística sí ve Importar Excel', () => {
    useAuth.mockReturnValue({ userRoles: ['LOGISTICS_CHIEF'] });
    renderWithProviders(<WarehouseSidebar isOpen onClose={vi.fn()} />);
    expect(link('Importar Excel')).toBeInTheDocument();
  });
});
