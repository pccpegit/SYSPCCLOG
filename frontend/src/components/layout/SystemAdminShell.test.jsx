import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import SystemAdminShell from './SystemAdminShell';
import SuperUserRoute from '../auth/SuperUserRoute';
import { useAuth } from '../../context/AuthContext';

// SYSPCC-018 (rediseño) — SystemAdminShell es el shell del módulo separado
// "Administración del Sistema" (/sistema), calco estructural de AdminShell
// (que no tiene test propio, no hay precedente que copiar). `useAuth` se
// mockea directo para variar isLoading/isAuthenticated sin tocar el
// bootstrap CSRF/getMe real.
vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function baseAuth(overrides = {}) {
  return {
    isAuthenticated: true,
    isLoading: false,
    currentUser: null, // Header renders null without a currentUser — fine, not under test here.
    logout: vi.fn(),
    primaryRole: null,
    ...overrides,
  };
}

function renderShell(initialEntry = '/sistema/usuarios') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Pantalla de login</div>} />
      <Route path="/sistema" element={<SystemAdminShell />}>
        <Route path="usuarios" element={<div>Contenido de la página</div>} />
      </Route>
    </Routes>,
    { initialEntries: [initialEntry] },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SystemAdminShell', () => {
  it('no renderiza nada (además del spinner) mientras isLoading es true', () => {
    useAuth.mockReturnValue(baseAuth({ isLoading: true, isAuthenticated: false }));

    renderShell();

    expect(screen.queryByText('Contenido de la página')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
  });

  it('redirige a /login si no está autenticado', async () => {
    useAuth.mockReturnValue(baseAuth({ isAuthenticated: false }));

    renderShell();

    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument();
  });

  it('autenticado: renderiza el nav de SystemSidebar (Usuarios/Proyectos) y el contenido de la ruta', async () => {
    useAuth.mockReturnValue(baseAuth());

    renderShell();

    expect(await screen.findByText('Contenido de la página')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proyectos' })).toBeInTheDocument();
  });
});

// Integración de ruta completa: SuperUserRoute + SystemAdminShell + la
// redirección `index` de /sistema -> /sistema/usuarios, tal como está
// cableado en App.jsx. No usa las páginas reales (UsersPage/ProjectsPage)
// para no acoplar este test a sus llamadas de red — un stub basta para
// probar el gateo y el ruteo.
describe('/sistema — integración de ruta (SuperUserRoute + SystemAdminShell)', () => {
  function renderSystemTree(initialEntry) {
    return renderWithProviders(
      <Routes>
        <Route path="/login" element={<div>Pantalla de login</div>} />
        <Route path="/" element={<div>Selector de sistemas</div>} />
        <Route
          path="/sistema"
          element={
            <SuperUserRoute>
              <SystemAdminShell />
            </SuperUserRoute>
          }
        >
          <Route index element={<Navigate to="usuarios" replace />} />
          <Route path="usuarios" element={<div>Usuarios Page</div>} />
        </Route>
      </Routes>,
      { initialEntries: [initialEntry] },
    );
  }

  it('un usuario sin is_superuser termina en / (SystemSelectPage)', async () => {
    useAuth.mockReturnValue(baseAuth({ isSuperUser: false }));

    renderSystemTree('/sistema/usuarios');

    expect(await screen.findByText('Selector de sistemas')).toBeInTheDocument();
    expect(screen.queryByText('Usuarios Page')).not.toBeInTheDocument();
  });

  it('un superusuario ve UsersPage', async () => {
    useAuth.mockReturnValue(baseAuth({ isSuperUser: true }));

    renderSystemTree('/sistema/usuarios');

    expect(await screen.findByText('Usuarios Page')).toBeInTheDocument();
  });

  it('/sistema sin sufijo redirige al índice (usuarios) para un superusuario', async () => {
    useAuth.mockReturnValue(baseAuth({ isSuperUser: true }));

    renderSystemTree('/sistema');

    expect(await screen.findByText('Usuarios Page')).toBeInTheDocument();
  });
});
