import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import HRSidebar from './HRSidebar';
import RoleRoute from '../auth/RoleRoute';
import { authAs } from '../../test/cvFixtures';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const nav = () => screen.getByRole('navigation', { name: /secciones de rr\. hh\./i });

describe('HRSidebar — Análisis de CVs', () => {
  it.each(['HR_MANAGER', 'GENERAL_MANAGER'])('el ítem es visible para %s, entre Documentos y Nuevo contrato', (role) => {
    useAuth.mockReturnValue(authAs([role]));
    renderWithProviders(<HRSidebar isOpen onClose={() => {}} />, { route: '/rrhh/documentos' });
    const links = within(nav()).getAllByRole('link').map((l) => l.textContent);
    expect(links).toContain('Análisis de CVs');
    expect(within(nav()).getByRole('link', { name: 'Análisis de CVs' })).toHaveAttribute('href', '/rrhh/cvs');
    expect(links.indexOf('Análisis de CVs')).toBe(links.indexOf('Documentos') + 1);
    if (role === 'HR_MANAGER') expect(links.indexOf('Nuevo contrato')).toBe(links.indexOf('Análisis de CVs') + 1);
  });

  it('queda activo en las subrutas del módulo y el subtítulo dice "Documentos y CVs"', () => {
    useAuth.mockReturnValue(authAs(['HR_MANAGER']));
    renderWithProviders(<HRSidebar isOpen onClose={() => {}} />, { route: '/rrhh/cvs/5' });
    expect(within(nav()).getByRole('link', { name: 'Análisis de CVs' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('link', { name: 'Documentos' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Documentos y CVs')).toBeInTheDocument();
  });
});

// Réplica de las rutas de App.jsx para /rrhh/cvs (guardas incluidas).
function Tree() {
  return (
    <Routes>
      <Route path="/" element={<p>Menú principal</p>} />
      <Route path="/rrhh/cvs" element={<p>Lista de análisis</p>} />
      <Route
        path="/rrhh/cvs/nuevo"
        element={(
          <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/cvs"><p>Asistente nuevo</p></RoleRoute>
        )}
      />
      <Route
        path="/rrhh/cvs/:id/preparar"
        element={(
          <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/cvs"><p>Asistente preparar</p></RoleRoute>
        )}
      />
      <Route path="/rrhh/cvs/:id" element={<p>Resultados</p>} />
    </Routes>
  );
}

describe('Rutas /rrhh/cvs', () => {
  it('HR_MANAGER entra al asistente', () => {
    useAuth.mockReturnValue(authAs(['HR_MANAGER']));
    renderWithProviders(<Tree />, { route: '/rrhh/cvs/nuevo' });
    expect(screen.getByText('Asistente nuevo')).toBeInTheDocument();
  });

  it.each(['/rrhh/cvs/nuevo', '/rrhh/cvs/5/preparar'])('GENERAL_MANAGER es redirigido de %s a la lista', (route) => {
    useAuth.mockReturnValue(authAs(['GENERAL_MANAGER']));
    renderWithProviders(<Tree />, { route });
    expect(screen.getByText('Lista de análisis')).toBeInTheDocument();
  });

  it('GENERAL_MANAGER sí ve los resultados', () => {
    useAuth.mockReturnValue(authAs(['GENERAL_MANAGER']));
    renderWithProviders(<Tree />, { route: '/rrhh/cvs/5' });
    expect(screen.getByText('Resultados')).toBeInTheDocument();
  });
});
