import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import RoleRoute from './RoleRoute';
import { useAuth } from '../../context/AuthContext';

// SYSPCC-018 — `allowSuperuser` lets a Django superuser without any
// business role enter the /admin entry points, but must stay false
// everywhere else: the backend never treats `is_superuser` as a bypass for
// business-role gates (HasRole/IsGeneralManager, etc.), so a superadmin
// should NOT be able to walk into e.g. an approvals page just because
// `allowSuperuser` happens to default differently somewhere.
vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function renderRoute({ allowSuperuser, requiredRoles = ['GENERAL_MANAGER'] }, initialEntry = '/target') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Pantalla de login</div>} />
      <Route path="/rq" element={<div>Fallback de rol</div>} />
      <Route
        path="/target"
        element={
          <RoleRoute requiredRoles={requiredRoles} allowSuperuser={allowSuperuser}>
            <div>Contenido protegido</div>
          </RoleRoute>
        }
      />
    </Routes>,
    { initialEntries: [initialEntry] },
  );
}

describe('RoleRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con allowSuperuser=true, un superusuario sin roles de negocio pasa', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isSuperUser: true,
      userRoles: [],
    });

    renderRoute({ allowSuperuser: true });

    expect(await screen.findByText('Contenido protegido')).toBeInTheDocument();
  });

  it('sin la prop allowSuperuser, un superusuario sin el rol requerido NO pasa', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isSuperUser: true,
      userRoles: [],
    });

    renderRoute({ allowSuperuser: false });

    expect(await screen.findByText('Fallback de rol')).toBeInTheDocument();
  });

  it('un usuario con el rol requerido pasa, sin importar isSuperUser', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isSuperUser: false,
      userRoles: ['GENERAL_MANAGER'],
    });

    renderRoute({ allowSuperuser: false });

    expect(await screen.findByText('Contenido protegido')).toBeInTheDocument();
  });

  it('redirige a /login si no está autenticado', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      isSuperUser: false,
      userRoles: [],
    });

    renderRoute({ allowSuperuser: true });

    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument();
  });
});
