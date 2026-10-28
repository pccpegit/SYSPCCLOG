import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import SystemSidebar from './SystemSidebar';

// SYSPCC-018 (rediseño) — SystemSidebar es el nav del módulo separado
// "Administración del Sistema" (/sistema). A diferencia de AdminSidebar, no
// lee useAuth: la lista es estática porque todo el árbol /sistema ya está
// gateado por SuperUserRoute a nivel de ruta (ver App.jsx / SuperUserRoute).
describe('SystemSidebar', () => {
  it('muestra los enlaces Usuarios y Proyectos', () => {
    renderWithProviders(<SystemSidebar isOpen onClose={vi.fn()} />);

    const usuarios = screen.getByRole('link', { name: 'Usuarios' });
    const proyectos = screen.getByRole('link', { name: 'Proyectos' });

    expect(usuarios).toBeInTheDocument();
    expect(usuarios).toHaveAttribute('href', '/sistema/usuarios');
    expect(proyectos).toBeInTheDocument();
    expect(proyectos).toHaveAttribute('href', '/sistema/proyectos');
  });

  it('muestra el badge "Administración del Sistema"', () => {
    renderWithProviders(<SystemSidebar isOpen onClose={vi.fn()} />);

    expect(screen.getAllByText('Administración del Sistema').length).toBeGreaterThan(0);
  });
});
