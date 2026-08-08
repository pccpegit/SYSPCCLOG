import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import SuperUserRoute from './SuperUserRoute';
import { useAuth } from '../../context/AuthContext';

// SYSPCC-018 — SuperUserRoute is the strict gate for the Usuarios/Proyectos
// admin pages: Django `is_superuser` only, no business role stands in for
// it. `useAuth` is mocked directly (not the real AuthProvider) so each case
// can drive `isLoading`/`isAuthenticated`/`isSuperUser` independently
// without touching real CSRF-bootstrap/getMe network calls.
vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function renderProtectedRoute(initialEntry = '/admin/usuarios') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Pantalla de login</div>} />
      <Route path="/admin" element={<div>Menu de administracion</div>} />
      <Route
        path="/admin/usuarios"
        element={
          <SuperUserRoute>
            <div>Contenido protegido</div>
          </SuperUserRoute>
        }
      />
    </Routes>,
    { initialEntries: [initialEntry] },
  );
}

describe('SuperUserRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no renderiza nada mientras isLoading es true', () => {
    useAuth.mockReturnValue({ isLoading: true, isAuthenticated: false, isSuperUser: false });

    const { container } = renderProtectedRoute();

    expect(container).toBeEmptyDOMElement();
  });

  it('redirige a /login si no está autenticado', async () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, isSuperUser: false });

    renderProtectedRoute();

    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument();
  });

  it('redirige a /admin si está autenticado pero no es superusuario', async () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isSuperUser: false });

    renderProtectedRoute();

    expect(await screen.findByText('Menu de administracion')).toBeInTheDocument();
  });

  it('renderiza los children si es superusuario', async () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isSuperUser: true });

    renderProtectedRoute();

    expect(await screen.findByText('Contenido protegido')).toBeInTheDocument();
  });
});
