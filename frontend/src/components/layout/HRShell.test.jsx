import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import HRShell from './HRShell';
import RoleRoute from '../auth/RoleRoute';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

function auth(roles, extra = {}) {
  return {
    isAuthenticated: true,
    isLoading: false,
    userRoles: roles,
    primaryRole: roles[0] ?? null,
    currentUser: { first_name: 'Gerente', last_name: 'Demo', username: 'gerente' },
    logout: vi.fn(),
    ...extra,
  };
}

// Réplica del árbol de rutas de App.jsx para /rrhh (guardas incluidas).
function Tree() {
  return (
    <Routes>
      <Route path="/" element={<p>Menú principal</p>} />
      <Route path="/login" element={<p>Pantalla de login</p>} />
      <Route
        path="/rrhh"
        element={(
          <RoleRoute requiredRoles={['HR_MANAGER', 'GENERAL_MANAGER']} redirectTo="/">
            <HRShell />
          </RoleRoute>
        )}
      >
        <Route path="documentos" element={<p>Lista de documentos</p>} />
        <Route
          path="documentos/nuevo"
          element={(
            <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/documentos">
              <p>Formulario nuevo contrato</p>
            </RoleRoute>
          )}
        />
        <Route
          path="plantillas"
          element={(
            <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/documentos">
              <p>Página de plantillas</p>
            </RoleRoute>
          )}
        />
      </Route>
    </Routes>
  );
}

const nav = () => screen.getByRole('navigation', { name: /secciones de rr\. hh\./i });

beforeEach(() => vi.clearAllMocks());

describe('HRShell / HRSidebar', () => {
  it('HR_MANAGER ve Documentos, Nuevo contrato y Plantillas', () => {
    useAuth.mockReturnValue(auth(['HR_MANAGER']));
    renderWithProviders(<Tree />, { route: '/rrhh/documentos' });
    expect(screen.getByText('Lista de documentos')).toBeInTheDocument();
    const n = within(nav());
    expect(n.getByRole('link', { name: /^documentos$/i })).toHaveAttribute('href', '/rrhh/documentos');
    expect(n.getByRole('link', { name: /nuevo contrato/i })).toHaveAttribute('href', '/rrhh/documentos/nuevo');
    expect(n.getByRole('link', { name: /plantillas/i })).toHaveAttribute('href', '/rrhh/plantillas');
    expect(n.getByText('Configuración')).toBeInTheDocument();
  });

  it('GENERAL_MANAGER solo ve Documentos (sin Nuevo contrato, Plantillas ni sección Configuración)', () => {
    useAuth.mockReturnValue(auth(['GENERAL_MANAGER']));
    renderWithProviders(<Tree />, { route: '/rrhh/documentos' });
    const n = within(nav());
    expect(n.getByRole('link', { name: /^documentos$/i })).toBeInTheDocument();
    expect(n.queryByRole('link', { name: /nuevo contrato/i })).not.toBeInTheDocument();
    expect(n.queryByRole('link', { name: /plantillas/i })).not.toBeInTheDocument();
    expect(n.queryByText('Configuración')).not.toBeInTheDocument();
  });

  it('usuario sin rol de RR. HH. es redirigido al menú principal', () => {
    useAuth.mockReturnValue(auth(['REQUESTER']));
    renderWithProviders(<Tree />, { route: '/rrhh/documentos' });
    expect(screen.getByText('Menú principal')).toBeInTheDocument();
    expect(screen.queryByText('Lista de documentos')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /secciones de rr\. hh\./i })).not.toBeInTheDocument();
  });

  it('usuario sin ningún rol es redirigido', () => {
    useAuth.mockReturnValue(auth([]));
    renderWithProviders(<Tree />, { route: '/rrhh/documentos' });
    expect(screen.getByText('Menú principal')).toBeInTheDocument();
  });

  it('no autenticado va a /login', () => {
    useAuth.mockReturnValue(auth(['HR_MANAGER'], { isAuthenticated: false }));
    renderWithProviders(<Tree />, { route: '/rrhh/documentos' });
    expect(screen.getByText('Pantalla de login')).toBeInTheDocument();
  });

  it('mientras restaura la sesión no muestra el contenido protegido', () => {
    useAuth.mockReturnValue(auth(['HR_MANAGER'], { isLoading: true }));
    renderWithProviders(<Tree />, { route: '/rrhh/documentos' });
    expect(screen.queryByText('Lista de documentos')).not.toBeInTheDocument();
    expect(screen.queryByText('Menú principal')).not.toBeInTheDocument();
  });

  it.each(['/rrhh/documentos/nuevo', '/rrhh/plantillas'])(
    'GENERAL_MANAGER que entra por URL a %s vuelve a la lista (ruta solo HR_MANAGER)',
    (route) => {
      useAuth.mockReturnValue(auth(['GENERAL_MANAGER']));
      renderWithProviders(<Tree />, { route });
      expect(screen.getByText('Lista de documentos')).toBeInTheDocument();
      expect(screen.queryByText(/formulario nuevo contrato|página de plantillas/i)).not.toBeInTheDocument();
    },
  );

  it('HR_MANAGER accede a las rutas de escritura', () => {
    useAuth.mockReturnValue(auth(['HR_MANAGER']));
    renderWithProviders(<Tree />, { route: '/rrhh/plantillas' });
    expect(screen.getByText('Página de plantillas')).toBeInTheDocument();
  });

  it('el enlace activo se marca con aria-current', () => {
    useAuth.mockReturnValue(auth(['HR_MANAGER']));
    renderWithProviders(<Tree />, { route: '/rrhh/plantillas' });
    expect(within(nav()).getByRole('link', { name: /plantillas/i })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('link', { name: /^documentos$/i })).not.toHaveAttribute('aria-current');
  });
});
