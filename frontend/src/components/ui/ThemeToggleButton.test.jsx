import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeToggleButton from './ThemeToggleButton';
import { useTheme } from '../../context/ThemeContext';

// Isolated from ThemeProvider — mocks useTheme() directly, same pattern as
// ChangePasswordRequiredPage.test.jsx mocking useAuth(). This component is
// pure (all state comes from the hook), so it doesn't need the real
// provider/localStorage to be exercised here (that's ThemeContext.test.jsx).
vi.mock('../../context/ThemeContext', () => ({
  useTheme: vi.fn(),
}));

describe('ThemeToggleButton', () => {
  const toggleTheme = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el clic invoca toggleTheme() del contexto', async () => {
    const user = userEvent.setup();
    useTheme.mockReturnValue({ resolvedTheme: 'light', toggleTheme });

    render(<ThemeToggleButton />);
    await user.click(screen.getByRole('button'));

    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('con resolvedTheme="light", el botón ofrece pasar a oscuro (aria-label/aria-pressed)', () => {
    useTheme.mockReturnValue({ resolvedTheme: 'light', toggleTheme });

    render(<ThemeToggleButton />);
    const button = screen.getByRole('button', { name: 'Cambiar a modo oscuro' });

    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('con resolvedTheme="dark", el botón ofrece pasar a claro (aria-label/aria-pressed)', () => {
    useTheme.mockReturnValue({ resolvedTheme: 'dark', toggleTheme });

    render(<ThemeToggleButton />);
    const button = screen.getByRole('button', { name: 'Cambiar a modo claro' });

    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('un solo botón accesible por rol, sin importar el estado (no hay un tercer icono/estado visual)', () => {
    useTheme.mockReturnValue({ resolvedTheme: 'dark', toggleTheme });
    render(<ThemeToggleButton />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('mantiene el foco en el botón después del clic — no lo roba ni lo pierde', async () => {
    const user = userEvent.setup();
    useTheme.mockReturnValue({ resolvedTheme: 'light', toggleTheme });

    render(<ThemeToggleButton />);
    const button = screen.getByRole('button');
    await user.click(button);

    expect(button).toHaveFocus();
  });
});
