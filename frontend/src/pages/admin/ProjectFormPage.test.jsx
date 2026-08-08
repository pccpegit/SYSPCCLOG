import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import ProjectFormPage from './ProjectFormPage';
import * as coreApi from '../../api/core';
import * as projectsApi from '../../api/projects';

vi.mock('../../api/core');
vi.mock('../../api/projects');

function renderRoute(initialEntry) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/proyectos/nuevo" element={<ProjectFormPage />} />
      <Route path="/admin/proyectos/:id" element={<ProjectFormPage />} />
      <Route path="/admin/proyectos" element={<div>Listado de proyectos</div>} />
    </Routes>,
    { initialEntries: [initialEntry] },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectFormPage — crear', () => {
  it('valida localmente los campos obligatorios sin llamar a la API', async () => {
    const user = userEvent.setup();
    renderRoute('/admin/proyectos/nuevo');

    await user.click(screen.getByRole('button', { name: /crear proyecto/i }));

    expect(await screen.findByText('El código es obligatorio.')).toBeInTheDocument();
    expect(projectsApi.createProject).not.toHaveBeenCalled();
  });

  it('camino feliz: crea el proyecto y vuelve al listado', async () => {
    const user = userEvent.setup();
    projectsApi.createProject.mockResolvedValue({ data: { id: 9, code: 'PRY-009' } });

    renderRoute('/admin/proyectos/nuevo');

    await user.type(screen.getByLabelText(/código/i), 'PRY-009');
    await user.type(screen.getByLabelText(/^nombre/i), 'Proyecto Nuevo');
    await user.click(screen.getByRole('button', { name: /crear proyecto/i }));

    expect(projectsApi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PRY-009', name: 'Proyecto Nuevo' }),
    );
    expect(await screen.findByText('Listado de proyectos')).toBeInTheDocument();
  });

  it('muestra el error de validación del backend en el campo correspondiente', async () => {
    const user = userEvent.setup();
    projectsApi.createProject.mockRejectedValue({
      response: {
        status: 400,
        data: { error: true, status_code: 400, code: 'error', detail: { code: ['Ya existe un proyecto con este código.'] } },
      },
    });

    renderRoute('/admin/proyectos/nuevo');

    await user.type(screen.getByLabelText(/código/i), 'PRY-DUP');
    await user.type(screen.getByLabelText(/^nombre/i), 'Proyecto Duplicado');
    await user.click(screen.getByRole('button', { name: /crear proyecto/i }));

    expect(await screen.findByText('Ya existe un proyecto con este código.')).toBeInTheDocument();
  });
});

describe('ProjectFormPage — editar', () => {
  it('activar/desactivar no aparece en el formulario, pero muestra los residentes asignados', async () => {
    coreApi.getProject.mockResolvedValue({
      data: {
        id: 3,
        code: 'PRY-003',
        name: 'Proyecto Tres',
        location: '',
        client: '',
        frente: '',
        total_budget: null,
        start_date: '',
        end_date: '',
        is_active: true,
        residents: [{ id: 42, username: 'resi', full_name: 'Residente Uno' }],
      },
    });

    renderRoute('/admin/proyectos/3');

    expect(await screen.findByText('Residente Uno')).toBeInTheDocument();
    expect(screen.getByText('@resi')).toBeInTheDocument();
  });
});
