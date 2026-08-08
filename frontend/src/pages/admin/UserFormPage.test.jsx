import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import UserFormPage from './UserFormPage';
import * as coreApi from '../../api/core';
import * as usersApi from '../../api/users';

vi.mock('../../api/core');
vi.mock('../../api/users');

function renderRoute(initialEntry) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/usuarios/nuevo" element={<UserFormPage />} />
      <Route path="/admin/usuarios/:id" element={<UserFormPage />} />
      <Route path="/admin/usuarios" element={<div>Listado de usuarios</div>} />
    </Routes>,
    { initialEntries: [initialEntry] },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  coreApi.getProjects.mockResolvedValue({ data: { results: [] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [] } });
});

describe('UserFormPage — crear', () => {
  it('muestra los errores de validación del backend campo a campo', async () => {
    const user = userEvent.setup();
    usersApi.createUser.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: true,
          status_code: 400,
          code: 'error',
          detail: {
            username: ['Ya existe un usuario con estos datos.'],
            email: ['Introduzca una dirección de correo electrónico válida.'],
          },
        },
      },
    });

    renderRoute('/admin/usuarios/nuevo');

    await user.type(screen.getByLabelText(/^usuario/i), 'jdoe');
    await user.type(screen.getByLabelText(/^email/i), 'no-es-un-email');
    await user.type(screen.getByLabelText(/^nombres/i), 'John');
    await user.type(screen.getByLabelText(/^apellidos/i), 'Doe');
    await user.click(screen.getByRole('button', { name: /crear usuario/i }));

    expect(await screen.findByText('Ya existe un usuario con estos datos.')).toBeInTheDocument();
    expect(screen.getByText('Introduzca una dirección de correo electrónico válida.')).toBeInTheDocument();
  });

  it('valida localmente los campos obligatorios sin llamar a la API', async () => {
    const user = userEvent.setup();
    renderRoute('/admin/usuarios/nuevo');

    await user.click(screen.getByRole('button', { name: /crear usuario/i }));

    expect(await screen.findByText('El usuario es obligatorio.')).toBeInTheDocument();
    expect(usersApi.createUser).not.toHaveBeenCalled();
  });

  it('camino feliz: crea el usuario y muestra la contraseña temporal', async () => {
    const user = userEvent.setup();
    usersApi.createUser.mockResolvedValue({
      data: { id: 5, username: 'nuevo', temporary_password: 'xK9-mQ2pAbcd' },
    });

    renderRoute('/admin/usuarios/nuevo');

    await user.type(screen.getByLabelText(/^usuario/i), 'nuevo');
    await user.type(screen.getByLabelText(/^email/i), 'nuevo@test.com');
    await user.type(screen.getByLabelText(/^nombres/i), 'Nuevo');
    await user.type(screen.getByLabelText(/^apellidos/i), 'Usuario');
    await user.click(screen.getByRole('button', { name: /crear usuario/i }));

    expect(await screen.findByText('xK9-mQ2pAbcd')).toBeInTheDocument();
  });
});

describe('UserFormPage — editar', () => {
  function existingUser() {
    return {
      id: 7,
      username: 'existente',
      email: 'existente@test.com',
      first_name: 'Existente',
      last_name: 'Usuario',
      position: '',
      department: '',
      phone: '',
      user_roles: [
        { id: 100, role: 'REQUESTER', project: 1, department_obj: null, is_primary: true },
        { id: 101, role: 'PROJECT_RESIDENT', project: 2, department_obj: null, is_primary: false },
      ],
    };
  }

  it('envia los roles como reemplazo total tras quitar una fila', async () => {
    const user = userEvent.setup();
    coreApi.getUser.mockResolvedValue({ data: existingUser() });
    usersApi.updateUser.mockResolvedValue({ data: { id: 7 } });

    renderRoute('/admin/usuarios/7');

    // Wait for the two existing role rows to load.
    await screen.findByLabelText('Rol (fila 1)');
    const removeButtons = screen.getAllByRole('button', { name: /quitar rol/i });
    expect(removeButtons).toHaveLength(2);

    // Remove the second role row.
    await user.click(removeButtons[1]);

    await user.click(screen.getByRole('button', { name: /guardar cambios/i }));

    expect(usersApi.updateUser).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({
        roles: [{ role: 'REQUESTER', project: 1, department_obj: null, is_primary: true }],
      }),
    );
  });

  it('sin tocar los roles, el payload conserva ambas filas existentes', async () => {
    const user = userEvent.setup();
    coreApi.getUser.mockResolvedValue({ data: existingUser() });
    usersApi.updateUser.mockResolvedValue({ data: { id: 7 } });

    renderRoute('/admin/usuarios/7');

    await screen.findByLabelText('Rol (fila 1)');
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }));

    expect(usersApi.updateUser).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({
        roles: [
          { role: 'REQUESTER', project: 1, department_obj: null, is_primary: true },
          { role: 'PROJECT_RESIDENT', project: 2, department_obj: null, is_primary: false },
        ],
      }),
    );
  });
});
