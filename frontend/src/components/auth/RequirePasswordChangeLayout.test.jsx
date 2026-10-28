import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route, Outlet } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequirePasswordChangeLayout from './RequirePasswordChangeLayout';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function renderLayout(initialEntry = '/') {
  return renderWithProviders(
    <Routes>
      <Route path="/cambiar-password" element={<div>Pantalla de cambio de contrasena</div>} />
      <Route element={<RequirePasswordChangeLayout />}>
        <Route
          path="/"
          element={
            <div>
              Contenido normal
              <Outlet />
            </div>
          }
        />
      </Route>
    </Routes>,
    { initialEntries: [initialEntry] },
  );
}

describe('RequirePasswordChangeLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirige a /cambiar-password si must_change_password es true', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      currentUser: { must_change_password: true },
    });

    renderLayout('/');

    expect(await screen.findByText('Pantalla de cambio de contrasena')).toBeInTheDocument();
  });

  it('deja pasar (renderiza el Outlet) si must_change_password es false', async () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      currentUser: { must_change_password: false },
    });

    renderLayout('/');

    expect(await screen.findByText('Contenido normal')).toBeInTheDocument();
  });

  it('no renderiza nada mientras isLoading es true', () => {
    useAuth.mockReturnValue({ isLoading: true, isAuthenticated: false, currentUser: null });

    const { container } = renderLayout('/');

    expect(container).toBeEmptyDOMElement();
  });

  it('deja pasar si no hay usuario autenticado (nada que forzar)', async () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, currentUser: null });

    renderLayout('/');

    expect(await screen.findByText('Contenido normal')).toBeInTheDocument();
  });
});
