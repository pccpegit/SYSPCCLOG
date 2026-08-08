import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import AdminSidebar from './AdminSidebar';

// SYSPCC-018 (rediseño) — Usuarios/Proyectos ya no viven bajo AdminShell
// (movidos al módulo separado /sistema, ver SystemSidebar). AdminSidebar
// volvió a su forma pre-ticket: NAV_ITEMS estático, sin leer useAuth ni
// condicionar nada por isSuperUser. Este test solo confirma que el nav de
// negocio (Pasajes, Dashboard, Pagos, Politicas, Proveedores) sigue ahí y
// que Usuarios/Proyectos no reaparecen por regresión.
describe('AdminSidebar', () => {
  it('muestra el nav de negocio y no incluye Usuarios ni Proyectos', () => {
    renderWithProviders(<AdminSidebar isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Pasajes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pagos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Politicas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proveedores' })).toBeInTheDocument();

    // Regresión: Usuarios/Proyectos ahora viven en /sistema (SystemSidebar),
    // no deben reaparecer aquí.
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Proyectos' })).not.toBeInTheDocument();
  });
});
