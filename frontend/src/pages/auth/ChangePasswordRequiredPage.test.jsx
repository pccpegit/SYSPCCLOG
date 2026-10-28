import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import ChangePasswordRequiredPage from './ChangePasswordRequiredPage';
import { useAuth } from '../../context/AuthContext';
import * as authApi from '../../api/auth';

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../../api/auth');

const switchRole = vi.fn();
const logout = vi.fn();

function baseAuth(overrides = {}) {
  return {
    currentUser: { id: 1, username: 'temporal', must_change_password: true },
    isAuthenticated: true,
    isLoading: false,
    switchRole,
    logout,
    ...overrides,
  };
}

function renderPage(initialEntry = '/cambiar-password') {
  return renderWithProviders(
    <Routes>
      <Route path="/cambiar-password" element={<ChangePasswordRequiredPage />} />
      <Route path="/" element={<div>Pagina de inicio</div>} />
      <Route path="/login" element={<div>Pantalla de login</div>} />
    </Routes>,
    { initialEntries: [initialEntry] },
  );
}

async function fillAndSubmit(user, { oldPassword, newPassword, newPasswordConfirm }) {
  if (oldPassword !== undefined) {
    await user.type(screen.getByLabelText(/contraseña actual/i), oldPassword);
  }
  if (newPassword !== undefined) {
    await user.type(screen.getByLabelText(/^nueva contraseña$/i), newPassword);
  }
  if (newPasswordConfirm !== undefined) {
    await user.type(screen.getByLabelText(/confirmar nueva contraseña/i), newPasswordConfirm);
  }
  await user.click(screen.getByRole('button', { name: /actualizar contraseña/i }));
}

describe('ChangePasswordRequiredPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('camino feliz: envia el formulario, llama a la API y navega a inicio', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue(baseAuth());
    authApi.changePassword.mockResolvedValue({ data: { detail: 'Contraseña actualizada exitosamente.' } });

    renderPage();

    await fillAndSubmit(user, {
      oldPassword: 'TempPass2026!',
      newPassword: 'NuevaPass2026super!',
      newPasswordConfirm: 'NuevaPass2026super!',
    });

    expect(authApi.changePassword).toHaveBeenCalledWith(
      'TempPass2026!',
      'NuevaPass2026super!',
      'NuevaPass2026super!',
    );
    expect(await screen.findByText('Pagina de inicio')).toBeInTheDocument();
    expect(switchRole).toHaveBeenCalledWith(
      expect.objectContaining({ must_change_password: false }),
    );
  });

  it('muestra el error de contraseña actual incorrecta que devuelve el backend', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue(baseAuth());
    // Matches the real (non-enveloped) shape of this specific endpoint's
    // manual old_password check — see apiErrors.js / ChangePasswordRequiredPage FASE 2 notes.
    authApi.changePassword.mockRejectedValue({
      response: { status: 400, data: { old_password: 'Contraseña actual incorrecta.' } },
    });

    renderPage();

    await fillAndSubmit(user, {
      oldPassword: 'esto-no-es-correcto',
      newPassword: 'NuevaPass2026super!',
      newPasswordConfirm: 'NuevaPass2026super!',
    });

    expect(await screen.findByText('Contraseña actual incorrecta.')).toBeInTheDocument();
    // Must NOT have navigated away or cleared the forced-change flag.
    expect(screen.queryByText('Pagina de inicio')).not.toBeInTheDocument();
    expect(switchRole).not.toHaveBeenCalled();
  });

  it('valida localmente que la nueva contraseña y la confirmación coincidan, sin llamar a la API', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue(baseAuth());

    renderPage();

    await fillAndSubmit(user, {
      oldPassword: 'TempPass2026!',
      newPassword: 'NuevaPass2026super!',
      newPasswordConfirm: 'OtraCosaDistinta!',
    });

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it('redirige a /login si no está autenticado', async () => {
    useAuth.mockReturnValue(baseAuth({ isAuthenticated: false, currentUser: null }));

    renderPage();

    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument();
  });

  it('redirige a inicio si el usuario ya no tiene must_change_password activo', async () => {
    useAuth.mockReturnValue(
      baseAuth({ currentUser: { id: 1, username: 'normal', must_change_password: false } }),
    );

    renderPage();

    expect(await screen.findByText('Pagina de inicio')).toBeInTheDocument();
  });
});
