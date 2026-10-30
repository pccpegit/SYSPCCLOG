import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import WarehouseSidebar from './WarehouseSidebar';
import { useAuth } from '../../context/useAuth';

vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));

// SYSPCC-025 · QA ronda 2 — navegación del menú de almacén: enlace activo, cierre en móvil y salidas del módulo.

function view({ route = '/almacen/inventario', isOpen = true, onClose = vi.fn() } = {}) {
  renderWithProviders(
    <Routes>
      <Route path="/almacen/*" element={<WarehouseSidebar isOpen={isOpen} onClose={onClose} />} />
      <Route path="/" element={<p>Menú principal de la aplicación</p>} />
      <Route path="/settings" element={<p>Pantalla de configuración</p>} />
    </Routes>,
    { route },
  );
  return { onClose, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
});

describe('WarehouseSidebar — enlace activo', () => {
  it('solo el enlace de la pantalla actual se anuncia como página actual', () => {
    view({ route: '/almacen/movimientos' });
    expect(screen.getByRole('link', { name: 'Movimientos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Resumen de movimiento' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('una subpantalla (kardex de un ítem) mantiene activo «Inventario»', () => {
    view({ route: '/almacen/inventario/5' });
    expect(screen.getByRole('link', { name: 'Inventario' })).toHaveAttribute('aria-current', 'page');
  });

  it('en una ruta sin enlace propio ninguno queda marcado', () => {
    view({ route: '/almacen/ruta-que-no-existe' });
    expect(screen.getAllByRole('link').some((l) => l.getAttribute('aria-current') === 'page')).toBe(false);
  });
});

describe('WarehouseSidebar — cierre en pantallas angostas', () => {
  it('elegir un enlace cierra el menú', async () => {
    const { user, onClose } = view();
    await user.click(screen.getByRole('link', { name: 'Entrega / Egreso' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('el botón «Cerrar menú» lo cierra', async () => {
    const { user, onClose } = view();
    await user.click(screen.getByRole('button', { name: 'Cerrar menú' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('el fondo oscuro solo existe con el menú abierto y al tocarlo lo cierra', async () => {
    const { user, onClose } = view();
    const backdrop = document.querySelector('div[aria-hidden="true"].fixed');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('con el menú cerrado no hay fondo oscuro', () => {
    view({ isOpen: false });
    expect(document.querySelector('div[aria-hidden="true"].fixed')).toBeNull();
  });
});

describe('WarehouseSidebar — salidas del módulo', () => {
  it('«Menú principal» cierra el menú y vuelve al inicio de la aplicación', async () => {
    const { user, onClose } = view();
    await user.click(screen.getByRole('button', { name: /menú principal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Menú principal de la aplicación')).toBeInTheDocument();
  });

  it('«Configuración» cierra el menú y abre la configuración', async () => {
    const { user, onClose } = view();
    expect(screen.getByRole('button', { name: 'Configuración' })).toBeInTheDocument();   // con tilde
    await user.click(screen.getByRole('button', { name: /configuraci[oó]n/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Pantalla de configuración')).toBeInTheDocument();
  });
});

describe('WarehouseSidebar — roles ausentes', () => {
  it('si todavía no hay roles cargados muestra solo los enlaces comunes y no falla', () => {
    useAuth.mockReturnValue({ userRoles: undefined });
    view();
    expect(screen.getByRole('link', { name: 'Inventario' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Importar Excel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Transferencia interna' })).not.toBeInTheDocument();
  });

  it('una sección sin enlaces visibles se omite entera', () => {
    useAuth.mockReturnValue({ userRoles: ['SITE_WAREHOUSE'] });
    view();
    expect(screen.queryByText('Administración')).not.toBeInTheDocument();
    expect(screen.getByText('Consultas')).toBeInTheDocument();
  });
});
