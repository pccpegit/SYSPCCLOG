import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequestCreatePage from './RequestCreatePage';
import { useAuth } from '../../context/AuthContext';
import * as coreApi from '../../api/core';
import * as requestsApi from '../../api/requests';
import * as exportRQ from '../../utils/exportRQ';

// SYSPCC-019: RequestCreatePage — "Nuevo Requerimiento".
// AuthContext is mocked (see renderWithProviders.jsx doc comment) so each
// test controls currentUser.roles directly. exportRQ (ExcelJS + file-saver)
// is mocked because it isn't relevant to routing/flow behaviour and would
// otherwise try to fetch a real .xlsx template under jsdom.
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/core');
vi.mock('../../api/requests');
vi.mock('../../utils/exportRQ');

// ── Mocked catalog data ───────────────────────────────────────────────────
const PROJECT_MINERA = {
  id: 1,
  code: 'PRY-001',
  name: 'Proyecto Minera Yanaocha',
  frente: 'MINERA YANAOCHA',
};

// code='ADM' mirrors the real seed_demo department used by the frontend's
// legacy 'dept-oficina' fallback (RequestCreatePage.jsx handleSubmit).
const DEPT_ADM = { id: 10, code: 'ADM', name: 'Administración', frente: 'OFICINA CENTRAL' };
const DEPT_RRHH = { id: 11, code: 'RRHH', name: 'Recursos Humanos', frente: 'OFICINA CENTRAL' };

function mockCatalogs() {
  coreApi.getProjects.mockResolvedValue({ data: { results: [PROJECT_MINERA] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [DEPT_ADM, DEPT_RRHH] } });
}

function opsUser() {
  return {
    id: 1,
    first_name: 'Op',
    last_name: 'Erator',
    full_name: 'Op Erator',
    roles: [
      {
        role: 'REQUESTER',
        is_primary: true,
        project: PROJECT_MINERA.id,
        project_code: PROJECT_MINERA.code,
        project_name: PROJECT_MINERA.name,
        project_frente: PROJECT_MINERA.frente,
        department_obj: null,
        department_code: null,
        department_name: null,
        department_frente: null,
      },
    ],
  };
}

function departmentUser() {
  return {
    id: 2,
    first_name: 'Dep',
    last_name: 'User',
    full_name: 'Dep User',
    roles: [
      {
        role: 'REQUESTER',
        is_primary: true,
        project: null,
        project_code: null,
        project_name: null,
        project_frente: null,
        department_obj: DEPT_RRHH.id,
        department_code: DEPT_RRHH.code,
        department_name: DEPT_RRHH.name,
        department_frente: DEPT_RRHH.frente,
      },
    ],
  };
}

function globalAccessUser() {
  return {
    id: 3,
    first_name: 'Global',
    last_name: 'User',
    full_name: 'Global User',
    roles: [
      {
        role: 'GENERAL_MANAGER',
        is_primary: true,
        project: null,
        project_code: null,
        project_name: null,
        project_frente: null,
        department_obj: null,
        department_code: null,
        department_name: null,
        department_frente: null,
      },
    ],
  };
}

// The form's labels live in <td> cells with no htmlFor/id association (a
// pre-existing a11y gap, out of scope for SYSPCC-019 — see accessibilidad
// skill backlog). We locate controls by their visible label text, then walk
// to the adjacent value cell — this is a text-anchored query, not a CSS
// selector, and mirrors the only reliable way to target these fields.
function valueCellFor(labelText) {
  const [labelEl] = screen.getAllByText((content) => content.startsWith(labelText));
  return labelEl.closest('td').nextElementSibling;
}

async function fillCommonRequiredFields(user) {
  const rqInput = within(valueCellFor('N° Requerimiento:')).getByRole('textbox');
  await user.type(rqInput, '001');

  const areaSelect = within(valueCellFor('Área:')).getByRole('combobox');
  await user.selectOptions(areaSelect, 'Producción');

  // Native date inputs aren't reliably typeable via user-event under jsdom
  // (no real date-picker widget) — fireEvent.change is the documented
  // workaround for this one field; every other interaction below uses
  // user-event.
  const fechaEntregaInput = within(valueCellFor('Fecha entrega:')).getByDisplayValue('');
  fireEvent.change(fechaEntregaInput, { target: { value: '2026-12-31' } });

  const [firstItemDescripcion] = screen.getAllByPlaceholderText('Descripción del material...');
  await user.type(firstItemDescripcion, 'Papel bond A4');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCatalogs();
  exportRQ.exportRQToExcel.mockResolvedValue(undefined);
});

describe('RequestCreatePage — SYSPCC-019 frente Oficina Central', () => {
  it('usuario OPS con proyecto asignado: sin cambios, envía flow OPERATIONS con su proyecto', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: opsUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0001' } });

    renderWithProviders(<RequestCreatePage />);

    // Both the Servicio and Proyecto cells render the same
    // "code — name" text for a locked OPS user — scope to each cell
    // individually instead of a page-wide findByText (which matches twice).
    await screen.findByText('MINERA YANAOCHA');
    expect(
      within(valueCellFor('Servicio:')).getByText('PRY-001 — Proyecto Minera Yanaocha'),
    ).toBeInTheDocument();
    expect(
      within(valueCellFor('Proyecto:')).getByText('PRY-001 — Proyecto Minera Yanaocha'),
    ).toBeInTheDocument();
    expect(within(valueCellFor('Frente:')).getByText('MINERA YANAOCHA')).toBeInTheDocument();

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'OPERATIONS',
        project: PROJECT_MINERA.id,
        department: null,
        front_area: 'MINERA YANAOCHA',
        service: 'PRY-001 — Proyecto Minera Yanaocha',
      }),
    );
  });

  it('usuario con departamento propio (frente Oficina Central): Servicio/Proyecto fijos al montar, payload lleva su propio department', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: departmentUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0002' } });

    renderWithProviders(<RequestCreatePage />);

    // No interaction with frente/servicio needed — fetchData auto-fills
    // them from the user's own department as soon as the catalogs load.
    const servicioCell = await screen.findByText('Servicio:').then(() => valueCellFor('Servicio:'));
    expect(within(servicioCell).getByText('Oficina Central')).toBeInTheDocument();
    expect(within(servicioCell).queryByText('—')).not.toBeInTheDocument();

    const proyectoCell = valueCellFor('Proyecto:');
    expect(within(proyectoCell).getByText('Oficina Central')).toBeInTheDocument();
    expect(within(proyectoCell).queryByText('—')).not.toBeInTheDocument();

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'ADMINISTRATIVE',
        project: null,
        department: DEPT_RRHH.id,
        front_area: 'OFICINA CENTRAL',
        service: 'Oficina Central',
      }),
    );
  });

  it('usuario sin departamento ni proyecto elige "OFICINA CENTRAL" a mano: se desbloquea (no queda en "—") y el payload usa el departamento ADM', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: globalAccessUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0003' } });

    renderWithProviders(<RequestCreatePage />);

    const frenteSelect = await screen.findByText('Frente:').then(() =>
      within(valueCellFor('Frente:')).getByRole('combobox'),
    );
    await user.selectOptions(frenteSelect, 'OFICINA CENTRAL');

    const servicioCell = valueCellFor('Servicio:');
    expect(within(servicioCell).getByText('Oficina Central')).toBeInTheDocument();
    expect(within(servicioCell).queryByText('—')).not.toBeInTheDocument();

    const proyectoCell = valueCellFor('Proyecto:');
    expect(within(proyectoCell).getByText('Oficina Central')).toBeInTheDocument();
    expect(within(proyectoCell).queryByText('—')).not.toBeInTheDocument();

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    // Regression guard: this is exactly the bug reported — before the fix,
    // destinationKey stayed '' for a user with no department, and submit
    // was blocked by "Seleccione un servicio."
    expect(screen.queryByText('Seleccione un servicio.')).not.toBeInTheDocument();

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'ADMINISTRATIVE',
        project: null,
        department: DEPT_ADM.id,
        front_area: 'OFICINA CENTRAL',
        service: 'Oficina Central',
      }),
    );
  });

  it('regresión: otro frente con proyectos (MINERA YANAOCHA) sigue mostrando el dropdown de servicios, sin "Oficina Central" en ningún lado', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: globalAccessUser() });
    requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0004' } });

    renderWithProviders(<RequestCreatePage />);

    const frenteSelect = await screen.findByText('Frente:').then(() =>
      within(valueCellFor('Frente:')).getByRole('combobox'),
    );
    await user.selectOptions(frenteSelect, PROJECT_MINERA.frente);

    const servicioCell = valueCellFor('Servicio:');
    expect(within(servicioCell).queryByText('Oficina Central')).not.toBeInTheDocument();
    const servicioSelect = within(servicioCell).getByRole('combobox');
    await user.selectOptions(servicioSelect, `proj-${PROJECT_MINERA.id}`);

    const proyectoCell = valueCellFor('Proyecto:');
    expect(within(proyectoCell).getByText('PRY-001 — Proyecto Minera Yanaocha')).toBeInTheDocument();
    expect(within(proyectoCell).queryByText('Oficina Central')).not.toBeInTheDocument();

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'OPERATIONS',
        project: PROJECT_MINERA.id,
        department: null,
        front_area: 'MINERA YANAOCHA',
        service: 'PRY-001 — Proyecto Minera Yanaocha',
      }),
    );
  });

  it('error 400 {flow: [...]} del backend: el toast muestra el mensaje humano, no [object Object] ni JSON crudo', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ currentUser: opsUser() });
    requestsApi.createRequest.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: true,
          status_code: 400,
          code: 'error',
          detail: {
            flow: ['El frente "Oficina Central" debe registrarse por el flujo de Administración.'],
          },
        },
      },
    });

    renderWithProviders(<RequestCreatePage />);
    await screen.findByText('MINERA YANAOCHA');

    await fillCommonRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /enviar requerimiento/i }));

    expect(
      await screen.findByText('El frente "Oficina Central" debe registrarse por el flujo de Administración.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
  });
});
