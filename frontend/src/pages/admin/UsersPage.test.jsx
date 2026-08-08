import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import UsersPage from './UsersPage';
import { useAuth } from '../../context/AuthContext';
import * as coreApi from '../../api/core';
import * as usersApi from '../../api/users';

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../../api/core');
vi.mock('../../api/users');

function userRow(overrides = {}) {
  return {
    id: 1,
    username: 'jdoe',
    email: 'jdoe@test.com',
    full_name: 'John Doe',
    is_active: true,
    is_superuser: false,
    roles: [
      { id: 10, role: 'REQUESTER', role_display: 'Solicitante', project_code: 'PRY-1', is_primary: true },
    ],
    ...overrides,
  };
}

function mockFilterSources() {
  coreApi.getProjects.mockResolvedValue({ data: { results: [] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ currentUser: { id: 99, username: 'superadmin' } });
  mockFilterSources();
});

describe('UsersPage', () => {
  it('estado de carga y luego tabla con datos', async () => {
    coreApi.getUsers.mockResolvedValue({
      data: { results: [userRow()], count: 1, next: null, previous: null },
    });

    renderWithProviders(<UsersPage />);

    expect(screen.getByText(/cargando usuarios/i)).toBeInTheDocument();

    expect(await screen.findByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('@jdoe')).toBeInTheDocument();
    // "Solicitante" also appears as a <option> in the role filter select —
    // assert the role badge specifically renders inside the table row.
    expect(within(screen.getByRole('table')).getByText('Solicitante')).toBeInTheDocument();
  });

  it('estado de error con botón de reintentar', async () => {
    coreApi.getUsers.mockRejectedValueOnce(new Error('network down'));

    renderWithProviders(<UsersPage />);

    expect(await screen.findByText(/no se pudieron cargar los usuarios/i)).toBeInTheDocument();

    coreApi.getUsers.mockResolvedValueOnce({
      data: { results: [userRow()], count: 1, next: null, previous: null },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('John Doe')).toBeInTheDocument();
  });

  it('estado vacío sin usuarios', async () => {
    coreApi.getUsers.mockResolvedValue({ data: { results: [], count: 0, next: null, previous: null } });

    renderWithProviders(<UsersPage />);

    expect(await screen.findByText(/no hay usuarios registrados/i)).toBeInTheDocument();
  });

  it('restablecer contraseña abre confirmación y luego muestra el modal con la contraseña temporal', async () => {
    coreApi.getUsers.mockResolvedValue({
      data: { results: [userRow()], count: 1, next: null, previous: null },
    });
    usersApi.resetPassword.mockResolvedValue({ data: { temporary_password: 'xK9-mQ2pAbcd' } });

    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);
    await screen.findByText('John Doe');

    await user.click(screen.getByRole('button', { name: /restablecer contraseña de john doe/i }));

    // Confirmation dialog first — the API must not be called yet.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/se generará una nueva contraseña temporal/i)).toBeInTheDocument();
    expect(usersApi.resetPassword).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^restablecer$/i }));

    await waitFor(() => expect(usersApi.resetPassword).toHaveBeenCalledWith(1));
    expect(await screen.findByText('xK9-mQ2pAbcd')).toBeInTheDocument();
  });
});
