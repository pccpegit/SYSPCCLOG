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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// SYSPCC-018 (rediseño) — Usuarios/Proyectos se movieron al módulo separado
// /sistema (ver SystemSelectPage/SystemAdminShell). AdminMenuPage volvió a
// su forma pre-ticket: MODULES es siempre [PASAJES_MODULE, ...PLACEHOLDER_MODULES],
// sin leer isSuperUser (el componente ya no lo desestructura de useAuth).
describe('AdminMenuPage', () => {
  it('muestra el tile Pasajes y tiles "Próximamente", sin Usuarios ni Proyectos', async () => {
    useAuth.mockReturnValue(baseAuth());

    renderWithProviders(<AdminMenuPage />);

    expect(await screen.findByRole('button', { name: /pasajes/i })).toBeInTheDocument();
    expect(screen.getAllByText('Próximamente').length).toBeGreaterThan(0);

    // Regresión: Usuarios/Proyectos ahora viven en /sistema, no deben
    // reaparecer aquí.
    expect(screen.queryByRole('button', { name: /^usuarios/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^proyectos/i })).not.toBeInTheDocument();
  });
});
