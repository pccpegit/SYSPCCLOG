import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import AdminSidebar from './AdminSidebar';
import { useAuth } from '../../context/AuthContext';

// SYSPCC-018 — nav is UX only (the backend independently gates every
// write action with `IsSuperUser`); this just proves the "Usuarios" /
// "Proyectos" entries don't render for a non-superuser admin.
vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminSidebar', () => {
  it('muestra los enlaces Usuarios y Proyectos cuando isSuperUser es true', () => {
    useAuth.mockReturnValue({ isSuperUser: true });

    renderWithProviders(<AdminSidebar isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proyectos' })).toBeInTheDocument();
  });

  it('no muestra los enlaces Usuarios ni Proyectos cuando isSuperUser es false', () => {
    useAuth.mockReturnValue({ isSuperUser: false });

    renderWithProviders(<AdminSidebar isOpen onClose={vi.fn()} />);

    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Proyectos' })).not.toBeInTheDocument();
    // The base nav (available to everyone) still renders.
    expect(screen.getByRole('link', { name: 'Pasajes' })).toBeInTheDocument();
  });
});
