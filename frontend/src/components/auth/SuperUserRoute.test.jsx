import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import SuperUserRoute from './SuperUserRoute';
import { useAuth } from '../../context/AuthContext';

// SYSPCC-018 (rediseño) — SuperUserRoute ahora gatea el módulo separado
// /sistema completo (Usuarios + Proyectos viven bajo un único shell,
// SystemAdminShell), no páginas sueltas de AdminShell: Django `is_superuser`
// únicamente, ningún rol de negocio lo sustituye. El default de
// `redirectTo` cambió de '/admin' a '/' (SystemSelectPage) porque /sistema
// ya no cuelga de /admin. `useAuth` se mockea directo (no el AuthProvider
// real) para poder variar `isLoading`/`isAuthenticated`/`isSuperUser` por
// caso sin tocar el bootstrap CSRF/getMe real.
vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function renderProtectedRoute(initialEntry = '/sistema/usuarios') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Pantalla de login</div>} />
      <Route path="/" element={<div>Selector de sistemas</div>} />
      <Route
        path="/sistema/usuarios"
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

  it('redirige a / si está autenticado pero no es superusuario', async () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isSuperUser: false });

    renderProtectedRoute();

    expect(await screen.findByText('Selector de sistemas')).toBeInTheDocument();
  });

  it('renderiza los children si es superusuario', async () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isSuperUser: true });

    renderProtectedRoute();

    expect(await screen.findByText('Contenido protegido')).toBeInTheDocument();
  });
});
