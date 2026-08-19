import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import RoleRoute from './RoleRoute';
import { useAuth } from '../../context/AuthContext';

// SYSPCC-018 (rediseño) — la prop `allowSuperuser` se eliminó por completo:
// era el mecanismo ad-hoc para que un superadmin sin rol de negocio entrara
// a AdminShell; ahora Usuarios/Proyectos viven en /sistema, gateado
// enteramente por SuperUserRoute (ver SuperUserRoute.test.jsx), así que
// RoleRoute vuelve a evaluar únicamente `requiredRoles` — el backend tampoco
// trata `is_superuser` como bypass de rol de negocio (HasRole,
// IsGeneralManager, etc. no lo consideran).
vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function renderRoute(requiredRoles = ['GENERAL_MANAGER'], initialEntry = '/target') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Pantalla de login</div>} />
      <Route path="/rq" element={<div>Fallback de rol</div>} />
      <Route
        path="/target"
        element={
          <RoleRoute requiredRoles={requiredRoles}>
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

  it('no renderiza nada mientras isLoading es true', () => {
    useAuth.mockReturnValue({ isLoading: true, isAuthenticated: false, userRoles: [] });

    const { container } = renderRoute();

    expect(container).toBeEmptyDOMElement();
  });

  it('un usuario con el rol requerido pasa', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      userRoles: ['GENERAL_MANAGER'],
    });

    renderRoute();

    expect(await screen.findByText('Contenido protegido')).toBeInTheDocument();
  });

  it('un usuario sin el rol requerido es redirigido a redirectTo (incluso si es superusuario)', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isSuperUser: true,
      userRoles: [],
    });

    renderRoute();

    expect(await screen.findByText('Fallback de rol')).toBeInTheDocument();
  });

  it('redirige a /login si no está autenticado', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      userRoles: [],
    });

    renderRoute();

    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument();
  });
});
