import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';
import { useAuth } from '../../context/AuthContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { ToastProvider } from '../../context/ToastContext';
import { THEME_STORAGE_KEY } from '../../utils/theme';

// SYSPCC-020 — Apariencia tab. AuthContext is mocked (same pattern as
// ChangePasswordRequiredPage.test.jsx) since these tests only care about
// the theme controls, not profile/auth data fetching. ThemeContext and
// ToastContext are the REAL providers — no network calls, and it's the
// real localStorage read/write path (via ThemeContext -> utils/theme.js)
// that these tests actually want to exercise end to end.
vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function baseAuth(overrides = {}) {
  return {
    currentUser: {
      id: 1,
      username: 'ana.torres',
      full_name: 'Ana Torres',
      email: 'ana.torres@syspcc.test',
      is_staff: false, // keeps the OneDrive tab (adminOnly) out of the tab list
      roles: [{ role: 'REQUESTER', is_primary: true }],
    },
    primaryRole: 'REQUESTER',
    isAuthenticated: true,
    isLoading: false,
    ...overrides,
  };
}

function renderSettingsPage() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

async function renderAppearanceTab() {
  const user = userEvent.setup();
  renderSettingsPage();
  await user.click(screen.getByRole('button', { name: 'Apariencia' }));
  return user;
}

function storedTheme() {
  return JSON.parse(localStorage.getItem(THEME_STORAGE_KEY));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue(baseAuth());
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'theme-transitioning');
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'theme-transitioning');
});

describe('SettingsPage — tab Apariencia', () => {
  it('seleccionar "Claro" marca la opción, actualiza localStorage y aplica el tema', async () => {
    const user = await renderAppearanceTab();

    await user.click(screen.getByRole('radio', { name: 'Claro' }));

    expect(screen.getByRole('radio', { name: 'Claro' })).toHaveAttribute('aria-checked', 'true');
    expect(storedTheme().mode).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('seleccionar "Oscuro" marca la opción, actualiza localStorage y aplica el tema', async () => {
    const user = await renderAppearanceTab();

    await user.click(screen.getByRole('radio', { name: 'Oscuro' }));

    expect(screen.getByRole('radio', { name: 'Oscuro' })).toHaveAttribute('aria-checked', 'true');
    expect(storedTheme().mode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('en modo "Automático" aparecen los dos selectores de hora; en Claro/Oscuro no', async () => {
    const user = await renderAppearanceTab();

    await user.click(screen.getByRole('radio', { name: 'Claro' }));
    expect(screen.queryByLabelText('Inicio del modo oscuro')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fin del modo oscuro')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Automático' }));
    expect(screen.getByLabelText('Inicio del modo oscuro')).toBeInTheDocument();
    expect(screen.getByLabelText('Fin del modo oscuro')).toBeInTheDocument();
    expect(storedTheme().mode).toBe('auto');
  });

  it('cambiar la hora de inicio del rango automático persiste en localStorage', async () => {
    await renderAppearanceTab(); // default localStorage is empty -> starts in 'auto' already

    const startInput = screen.getByLabelText('Inicio del modo oscuro');
    // <input type="time"> has no native jsdom picker UI and user-event's
    // character-by-character typing is unreliable for it (same documented
    // exception as type="date" fields elsewhere in this repo's tests) —
    // fireEvent.change is the deliberate, narrow escape hatch here.
    fireEvent.change(startInput, { target: { value: '20:15' } });

    expect(storedTheme().autoRange).toMatchObject({ startHour: 20, startMinute: 15 });
    expect(startInput).toHaveValue('20:15');
  });

  it('cambiar la hora de fin del rango automático persiste en localStorage', async () => {
    await renderAppearanceTab();

    const endInput = screen.getByLabelText('Fin del modo oscuro');
    fireEvent.change(endInput, { target: { value: '06:45' } });

    expect(storedTheme().autoRange).toMatchObject({ endHour: 6, endMinute: 45 });
    expect(endInput).toHaveValue('06:45');
  });

  it('ArrowRight en el radiogroup mueve el foco y la selección a la siguiente opción', async () => {
    const user = await renderAppearanceTab();
    // Anchor to a known mode first — with the default 'auto' the specific
    // wrap-around index would make this assertion less obvious to read.
    await user.click(screen.getByRole('radio', { name: 'Claro' }));

    await user.keyboard('{ArrowRight}');

    const oscuro = screen.getByRole('radio', { name: 'Oscuro' });
    expect(oscuro).toHaveFocus();
    expect(oscuro).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Claro' })).toHaveAttribute('aria-checked', 'false');
    expect(storedTheme().mode).toBe('dark');
  });

  it('ArrowLeft desde la primera opción hace wraparound a la última ("Automático")', async () => {
    const user = await renderAppearanceTab();
    await user.click(screen.getByRole('radio', { name: 'Claro' }));

    await user.keyboard('{ArrowLeft}');

    const automatico = screen.getByRole('radio', { name: 'Automático' });
    expect(automatico).toHaveFocus();
    expect(automatico).toHaveAttribute('aria-checked', 'true');
    expect(storedTheme().mode).toBe('auto');
  });

  it('solo la opción marcada participa del orden de Tab (roving tabindex)', async () => {
    const user = await renderAppearanceTab();
    await user.click(screen.getByRole('radio', { name: 'Oscuro' }));

    expect(screen.getByRole('radio', { name: 'Oscuro' })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('radio', { name: 'Claro' })).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByRole('radio', { name: 'Automático' })).toHaveAttribute('tabIndex', '-1');
  });

  it('la línea de estado en vivo refleja resolvedTheme según el modo elegido', async () => {
    const user = await renderAppearanceTab();

    await user.click(screen.getByRole('radio', { name: 'Claro' }));
    expect(screen.getByText('Ahora mismo se está aplicando el modo claro.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Oscuro' }));
    expect(screen.getByText('Ahora mismo se está aplicando el modo oscuro.')).toBeInTheDocument();
    expect(screen.queryByText('Ahora mismo se está aplicando el modo claro.')).not.toBeInTheDocument();
  });

  it('la línea de estado en vivo está en una región aria-live="polite"', async () => {
    const user = await renderAppearanceTab();
    await user.click(screen.getByRole('radio', { name: 'Oscuro' }));

    const status = screen.getByText('Ahora mismo se está aplicando el modo oscuro.');
    expect(status.closest('[aria-live="polite"]')).toBeInTheDocument();
  });
});
