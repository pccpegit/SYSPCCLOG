import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import AdminMenuPage from './AdminMenuPage';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function baseAuth(overrides = {}) {
  return {
    currentUser: { id: 1, username: 'demo' },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
    isSuperUser: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminMenuPage — tiles condicionados a isSuperUser', () => {
  it('muestra los tiles Usuarios y Proyectos cuando isSuperUser es true', async () => {
    useAuth.mockReturnValue(baseAuth({ isSuperUser: true }));

    renderWithProviders(<AdminMenuPage />);

    expect(await screen.findByRole('button', { name: /usuarios/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /proyectos/i })).toBeInTheDocument();
  });

  it('muestra tiles "Próximamente" en vez de Usuarios/Proyectos cuando isSuperUser es false', async () => {
    useAuth.mockReturnValue(baseAuth({ isSuperUser: false }));

    renderWithProviders(<AdminMenuPage />);

    // "Pasajes" is always present regardless of role.
    expect(await screen.findByRole('button', { name: /pasajes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^usuarios/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^proyectos/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('Próximamente').length).toBeGreaterThan(0);
  });
});
