import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, configure } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequestCreatePage from './RequestCreatePage';
import { useAuth } from '../../context/useAuth';
import * as coreApi from '../../api/core';
import * as requestsApi from '../../api/requests';
import * as exportRQ from '../../utils/exportRQ';

// SYSPCC-026 (ronda 2). The server refuses an RQ with more than 200 lines (400 on `items`), and
// the form used to have no ceiling: "Agregar ítem" was unlimited, so the person found out at the
// very end. The form now stops adding rows at the same number and says why.
//
// Rendering 200 rows of this table in jsdom takes minutes (every click re-renders them all), so
// the mechanism is tested with a ceiling of 8 rows and the real number is checked separately.
configure({ asyncUtilTimeout: 4000 });
const TEST_LIMIT = 8;
vi.mock('../../data/requestCapture', async (importOriginal) => ({
  ...(await importOriginal()),
  MAX_REQUEST_ITEMS: 8,
}));
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/core');
vi.mock('../../api/requests');
vi.mock('../../utils/exportRQ');

const PROJECT = { id: 1, code: 'PRY-001', name: 'Proyecto Minera Yanaocha', frente: 'MINERA YANAOCHA' };
const user = {
  id: 1, first_name: 'Op', last_name: 'Erator', full_name: 'Op Erator',
  roles: [{
    role: 'REQUESTER', is_primary: true, project: PROJECT.id, project_code: PROJECT.code,
    project_name: PROJECT.name, project_frente: PROJECT.frente, department_obj: null,
    department_code: null, department_name: null, department_frente: null,
  }],
};

const addButton = () => screen.getByRole('button', { name: 'Agregar ítem' });
const rowsCount = () => screen.getAllByRole('combobox', { name: /Buscar producto del catálogo para el ítem/ }).length;

beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ currentUser: user });
  coreApi.getProjects.mockResolvedValue({ data: { results: [PROJECT] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [] } });
  exportRQ.exportRQToExcel.mockResolvedValue(undefined);
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 0, results: [] } });
});

describe('RequestCreatePage — tope de líneas por requerimiento', () => {
  it('el tope real del formulario es el mismo que el del servidor (200)', async () => {
    const actual = await vi.importActual('../../data/requestCapture');
    expect(actual.MAX_REQUEST_ITEMS).toBe(200);
  });

  it('bajo el tope el botón está activo y no hay aviso', async () => {
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');

    expect(addButton()).not.toHaveAttribute('aria-disabled');
    expect(addButton()).not.toHaveAttribute('aria-describedby');
    expect(document.getElementById('items-limit-note')).toBeNull();
    fireEvent.click(addButton());
    expect(rowsCount()).toBe(6);
  });

  it('al llegar al tope deja de agregar, lo explica y lo anuncia', async () => {
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');

    // 5 rows to begin with.
    for (let i = 0; i < TEST_LIMIT - 5; i += 1) fireEvent.click(addButton());

    expect(rowsCount()).toBe(TEST_LIMIT);
    expect(addButton()).toHaveAttribute('aria-disabled', 'true');
    expect(addButton()).toHaveAccessibleDescription(/Alcanzó el máximo de 8 ítems por requerimiento/);
    expect(screen.getAllByRole('status').some((el) => /Ítem 8 agregado\. Alcanzó el máximo de 8/.test(el.textContent))).toBe(true);

    fireEvent.click(addButton());
    expect(rowsCount()).toBe(TEST_LIMIT);
  });

  it('quitar una fila devuelve el botón a la normalidad', async () => {
    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');
    for (let i = 0; i < TEST_LIMIT - 5; i += 1) fireEvent.click(addButton());
    expect(addButton()).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar el ítem 1' }));

    expect(addButton()).not.toHaveAttribute('aria-disabled');
    expect(addButton()).not.toHaveAttribute('aria-describedby');
    expect(document.getElementById('items-limit-note')).toBeNull();
    fireEvent.click(addButton());
    expect(rowsCount()).toBe(TEST_LIMIT);
  });
});
