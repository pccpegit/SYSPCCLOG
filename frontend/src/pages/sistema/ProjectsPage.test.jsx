import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import ProjectsPage from './ProjectsPage';
import * as coreApi from '../../api/core';
import * as projectsApi from '../../api/projects';

vi.mock('../../api/core');
vi.mock('../../api/projects');

function projectRow(overrides = {}) {
  return {
    id: 1,
    code: 'PRY-001',
    name: 'Proyecto Uno',
    client: 'Cliente Uno',
    location: 'Lima',
    is_active: true,
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectsPage', () => {
  it('renderiza la tabla con los proyectos cargados', async () => {
    coreApi.getProjects.mockResolvedValue({
      data: { results: [projectRow()], count: 1, next: null, previous: null },
    });

    renderWithProviders(<ProjectsPage />);

    expect(await screen.findByText('Proyecto Uno')).toBeInTheDocument();
    expect(screen.getByText('PRY-001')).toBeInTheDocument();
  });

  it('estado de error con botón de reintentar', async () => {
    coreApi.getProjects.mockRejectedValueOnce(new Error('network down'));

    renderWithProviders(<ProjectsPage />);

    expect(await screen.findByText(/no se pudieron cargar los proyectos/i)).toBeInTheDocument();

    coreApi.getProjects.mockResolvedValueOnce({
      data: { results: [projectRow()], count: 1, next: null, previous: null },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Proyecto Uno')).toBeInTheDocument();
  });

  it('estado vacío sin proyectos', async () => {
    coreApi.getProjects.mockResolvedValue({ data: { results: [], count: 0, next: null, previous: null } });

    renderWithProviders(<ProjectsPage />);

    expect(await screen.findByText(/no hay proyectos registrados/i)).toBeInTheDocument();
  });

  it('desactivar confirma y llama a la API de desactivar con el id correcto', async () => {
    coreApi.getProjects.mockResolvedValue({
      data: { results: [projectRow()], count: 1, next: null, previous: null },
    });
    projectsApi.deactivateProject.mockResolvedValue({ data: {} });

    const user = userEvent.setup();
    renderWithProviders(<ProjectsPage />);
    await screen.findByText('Proyecto Uno');

    await user.click(screen.getByRole('button', { name: /desactivar proyecto pry-001/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^desactivar$/i }));

    await waitFor(() => expect(projectsApi.deactivateProject).toHaveBeenCalledWith(1));
    expect(projectsApi.activateProject).not.toHaveBeenCalled();
  });

  it('activar un proyecto inactivo llama a la API de activar', async () => {
    coreApi.getProjects.mockResolvedValue({
      data: { results: [projectRow({ is_active: false })], count: 1, next: null, previous: null },
    });
    projectsApi.activateProject.mockResolvedValue({ data: {} });

    const user = userEvent.setup();
    renderWithProviders(<ProjectsPage />);
    await screen.findByText('Proyecto Uno');

    await user.click(screen.getByRole('button', { name: /activar proyecto pry-001/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /^activar$/i }));

    await waitFor(() => expect(projectsApi.activateProject).toHaveBeenCalledWith(1));
    expect(projectsApi.deactivateProject).not.toHaveBeenCalled();
  });
});
