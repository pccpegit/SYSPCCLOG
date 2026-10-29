import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { useAuth } from './context/AuthContext';

// SYSPCC-025 · QA ronda 1 — protección de rutas de /almacen a nivel de App.
// El servidor valida cada permiso igual; aquí se prueba que la UI no deje entrar ni muestre la
// pantalla equivocada. Las pantallas se sustituyen por marcadores: solo importa la redirección.

vi.mock('./context/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }) => children,
}));

vi.mock('./components/layout/WarehouseShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => (<div data-testid="shell"><Outlet /></div>) };
});

// Declaración de función (no const): vi.mock se eleva sobre el resto del módulo.
function stub(name) {
  return { default: () => <p>{name}</p> };
}
vi.mock('./pages/almacen/AlmacenDashboardPage', () => stub('PANTALLA Tablero'));
vi.mock('./pages/almacen/InventarioPage', () => stub('PANTALLA Inventario'));
vi.mock('./pages/almacen/KardexPage', () => stub('PANTALLA Kardex'));
vi.mock('./pages/almacen/EntradaPage', () => stub('PANTALLA Ingreso'));
vi.mock('./pages/almacen/SalidaPage', () => stub('PANTALLA Egreso'));
vi.mock('./pages/almacen/VoucherPrint', () => stub('PANTALLA Vale'));
vi.mock('./pages/almacen/MovimientosPage', () => stub('PANTALLA Movimientos'));
vi.mock('./pages/almacen/PendientesPage', () => stub('PANTALLA Pendientes'));
vi.mock('./pages/almacen/ResumenPage', () => stub('PANTALLA Resumen'));
vi.mock('./pages/almacen/TransferenciaPage', () => stub('PANTALLA Transferencia'));
vi.mock('./pages/almacen/ImportarPage', () => stub('PANTALLA Importar'));
vi.mock('./pages/auth/LoginPage', () => stub('PANTALLA Login'));
vi.mock('./pages/auth/SystemSelectPage', () => stub('PANTALLA Selector de sistema'));

const WAREHOUSE_ROLES = ['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE', 'LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR', 'LOGISTICS_CHIEF'];
const OTHER_ROLES = ['REQUESTER', 'PROJECT_RESIDENT', 'PROJECT_CONTROL', 'GENERAL_MANAGER', 'DIRECT_SUPERVISOR',
  'ADMIN_MANAGER', 'PASAJES_MANAGER', 'HR_MANAGER'];

function visit(path, roles, { authenticated = true, loading = false } = {}) {
  useAuth.mockReturnValue({
    isLoading: loading,
    isAuthenticated: authenticated,
    userRoles: roles,
    currentUser: authenticated ? { must_change_password: false } : null,
  });
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => vi.clearAllMocks());

describe('/almacen — acceso al módulo', () => {
  it.each(WAREHOUSE_ROLES)('%s entra al tablero', (role) => {
    visit('/almacen', [role]);
    expect(screen.getByText('PANTALLA Tablero')).toBeInTheDocument();
  });

  it.each(OTHER_ROLES)('%s no entra: vuelve al selector de sistema', (role) => {
    visit('/almacen/inventario', [role]);
    expect(screen.queryByText('PANTALLA Inventario')).not.toBeInTheDocument();
    expect(screen.getByText('PANTALLA Selector de sistema')).toBeInTheDocument();
  });

  it('sin sesión va al login', () => {
    visit('/almacen/resumen', [], { authenticated: false });
    expect(screen.getByText('PANTALLA Login')).toBeInTheDocument();
  });

  it('mientras se restaura la sesión no muestra nada (ni parpadea otra pantalla)', () => {
    visit('/almacen/importar', [], { loading: true });
    expect(screen.queryByText(/PANTALLA/)).not.toBeInTheDocument();
  });
});

describe('/almacen/importar — solo Almacén Central y Jefatura de Logística', () => {
  it.each(['CENTRAL_WAREHOUSE', 'LOGISTICS_CHIEF'])('%s ve la pantalla', (role) => {
    visit('/almacen/importar', [role]);
    expect(screen.getByText('PANTALLA Importar')).toBeInTheDocument();
  });

  it.each(['SITE_WAREHOUSE', 'LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR'])('%s vuelve al tablero', (role) => {
    visit('/almacen/importar', [role]);
    expect(screen.queryByText('PANTALLA Importar')).not.toBeInTheDocument();
    expect(screen.getByText('PANTALLA Tablero')).toBeInTheDocument();
  });

  it('un usuario con varios roles entra si alguno lo permite', () => {
    visit('/almacen/importar', ['SITE_WAREHOUSE', 'LOGISTICS_CHIEF']);
    expect(screen.getByText('PANTALLA Importar')).toBeInTheDocument();
  });
});

describe('/almacen/transferencia — solo Almacén Central y de Obra', () => {
  it.each(['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE'])('%s ve la pantalla', (role) => {
    visit('/almacen/transferencia', [role]);
    expect(screen.getByText('PANTALLA Transferencia')).toBeInTheDocument();
  });

  it.each(['LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR', 'LOGISTICS_CHIEF'])('%s vuelve al tablero', (role) => {
    visit('/almacen/transferencia', [role]);
    expect(screen.queryByText('PANTALLA Transferencia')).not.toBeInTheDocument();
    expect(screen.getByText('PANTALLA Tablero')).toBeInTheDocument();
  });
});

describe('/almacen — pantallas abiertas a los cinco roles', () => {
  const OPEN = [
    ['/almacen/inventario', 'Inventario'], ['/almacen/inventario/7', 'Kardex'], ['/almacen/entrada', 'Ingreso'],
    ['/almacen/salida', 'Egreso'], ['/almacen/salida/7/voucher', 'Vale'], ['/almacen/movimientos', 'Movimientos'],
    ['/almacen/pendientes', 'Pendientes'], ['/almacen/resumen', 'Resumen'],
  ];

  it.each(OPEN.flatMap(([path, name]) => WAREHOUSE_ROLES.map((role) => [path, name, role])))(
    '%s lo ve %s',
    (path, name, role) => {
      visit(path, [role]);
      expect(screen.getByText(`PANTALLA ${name}`)).toBeInTheDocument();
    },
  );
});

describe('/almacen — usuario que debe cambiar la contraseña', () => {
  it('no llega al módulo hasta cambiarla', () => {
    useAuth.mockReturnValue({
      isLoading: false, isAuthenticated: true, userRoles: ['CENTRAL_WAREHOUSE'],
      currentUser: { must_change_password: true },
    });
    window.history.pushState({}, '', '/almacen/resumen');
    render(<App />);
    expect(screen.queryByText('PANTALLA Resumen')).not.toBeInTheDocument();
  });
});
