import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import SystemSelectPage from './SystemSelectPage';
import { useAuth } from '../../context/AuthContext';

// SYSPCC-018 (rediseño) — SystemSelectPage es el punto de entrada donde
// aparece la tarjeta nueva "Administración del Sistema" (/sistema),
// gateada por el flag crudo `is_superuser` de Django, no por `userRoles`
// (no existe rol SUPERADMIN de negocio en RoleChoices — ver decisión 4 de
// FASE 0b). `useAuth` se mockea directo para variar isSuperUser/userRoles
// sin tocar el bootstrap CSRF/getMe real.
vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const logout = vi.fn();

function baseAuth(overrides = {}) {
  return {
    currentUser: { id: 1, username: 'demo', first_name: 'Ana', full_name: 'Ana Torres' },
    isAuthenticated: true,
    isLoading: false,
    logout,
    userRoles: [],
    primaryRole: null,
    isSuperUser: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SystemSelectPage — tarjeta "Administración del Sistema"', () => {
  it('se muestra cuando isSuperUser es true', async () => {
    useAuth.mockReturnValue(baseAuth({ isSuperUser: true }));

    renderWithProviders(<SystemSelectPage />);

    expect(await screen.findByText('Administración del Sistema')).toBeInTheDocument();
  });

  it('se oculta para un usuario con rol de negocio ADMIN_MANAGER sin is_superuser', async () => {
    useAuth.mockReturnValue(baseAuth({
      userRoles: ['ADMIN_MANAGER'],
      primaryRole: 'ADMIN_MANAGER',
      isSuperUser: false,
    }));

    renderWithProviders(<SystemSelectPage />);

    // La tarjeta de negocio "Administracion" sí es visible para este rol...
    expect(await screen.findByText('Administracion')).toBeInTheDocument();
    // ...pero la tarjeta exclusiva de superadmin no.
    expect(screen.queryByText('Administración del Sistema')).not.toBeInTheDocument();
  });

  it('se oculta para un usuario con rol de negocio GENERAL_MANAGER sin is_superuser', async () => {
    useAuth.mockReturnValue(baseAuth({
      userRoles: ['GENERAL_MANAGER'],
      primaryRole: 'GENERAL_MANAGER',
      isSuperUser: false,
    }));

    renderWithProviders(<SystemSelectPage />);

    expect(await screen.findByText('Requerimientos')).toBeInTheDocument();
    expect(screen.queryByText('Administración del Sistema')).not.toBeInTheDocument();
  });

  it('se oculta para un usuario sin ningún rol de negocio ni is_superuser', async () => {
    useAuth.mockReturnValue(baseAuth());

    renderWithProviders(<SystemSelectPage />);

    expect(await screen.findByText('Requerimientos')).toBeInTheDocument();
    expect(screen.queryByText('Administración del Sistema')).not.toBeInTheDocument();
  });
});
