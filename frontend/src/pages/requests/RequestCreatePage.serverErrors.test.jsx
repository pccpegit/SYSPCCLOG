import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import RequestCreatePage from './RequestCreatePage';
import { useAuth } from '../../context/useAuth';
import * as coreApi from '../../api/core';
import * as requestsApi from '../../api/requests';
import * as exportRQ from '../../utils/exportRQ';

// These pages render a long form / a list of cards and the tests type into them: on a busy machine
// (CI running jobs in parallel) the default 1000 ms of findBy*/waitFor can expire before the first
// render finishes. The limit only bounds how long a failing assertion keeps retrying.
configure({ asyncUtilTimeout: 4000 });

// SYSPCC-026 (QA ronda 2) — what the person sees when the creation is refused with the answers
// the backend (and the proxy in front of it) really give. The tests of the pure helpers are in
// utils/requestCapture.serverErrors.test.js and utils/apiErrors.test.js; these show that the
// message reaches the screen, in the error summary for a 400 and in a toast otherwise.
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/core');
vi.mock('../../api/requests');
vi.mock('../../utils/exportRQ');

const PROJECT = { id: 1, code: 'PRY-001', name: 'Proyecto Minera Yanaocha', frente: 'MINERA YANAOCHA' };

const opsUser = () => ({
  id: 1, first_name: 'Op', last_name: 'Erator', full_name: 'Op Erator',
  roles: [{
    role: 'REQUESTER', is_primary: true, project: PROJECT.id, project_code: PROJECT.code,
    project_name: PROJECT.name, project_frente: PROJECT.frente, department_obj: null,
    department_code: null, department_name: null, department_frente: null,
  }],
});

function valueCellFor(labelText) {
  const [labelEl] = screen.getAllByText((content) => content.startsWith(labelText));
  return labelEl.closest('td').nextElementSibling;
}

async function fillValidForm(user) {
  await user.type(within(valueCellFor('N° Requerimiento:')).getByRole('textbox'), '030');
  await user.selectOptions(within(valueCellFor('Área (departamento):')).getByRole('combobox'), 'Producción');
  await user.selectOptions(screen.getByLabelText(/Área del RQ/), 'OP');
  fireEvent.change(within(valueCellFor('Fecha entrega:')).getByDisplayValue(''), { target: { value: '2026-12-31' } });
  await user.click(screen.getByLabelText('Ítem 1: Fuera de catálogo'));
  await user.type(screen.getByLabelText('Descripción del ítem 1 fuera de catálogo'), 'Papel bond A4');
  await user.selectOptions(screen.getByLabelText('Fuente del ítem 1'), 'UTILES');
  await user.type(screen.getByLabelText('Cantidad del ítem 1'), '2');
}

const submitButton = () => screen.getByRole('button', { name: /enviar requerimiento/i });

function renderPage() {
  return renderWithProviders(<RequestCreatePage />);
}

beforeEach(() => {
  // reset (not just clear): a once-queued answer left by a failing test must not leak into the next.
  vi.resetAllMocks();
  useAuth.mockReturnValue({ currentUser: opsUser() });
  coreApi.getProjects.mockResolvedValue({ data: { results: [PROJECT] } });
  coreApi.getDepartments.mockResolvedValue({ data: { results: [] } });
  exportRQ.exportRQToExcel.mockResolvedValue(undefined);
  requestsApi.createRequest.mockResolvedValue({ data: { rq_number: 'RQ-2026-0300' } });
  requestsApi.searchRequestCatalog.mockResolvedValue({ data: { count: 0, results: [] } });
});

describe('RequestCreatePage — el servidor rechaza la creación', () => {
  it('el tope de 200 líneas se explica en el resumen de errores, no con un mensaje genérico', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          error: true,
          status_code: 400,
          detail: { items: { non_field_errors: ['Un requerimiento admite como máximo 200 ítems.'] } },
        },
      },
    });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillValidForm(user);

    await user.click(submitButton());

    const summary = await screen.findByRole('group', { name: 'Corrija 1 error antes de enviar' });
    expect(within(summary).getByText('Un requerimiento admite como máximo 200 ítems.')).toBeInTheDocument();
    expect(summary).toHaveFocus();
    expect(submitButton()).toBeEnabled();
  });

  it('una página HTML del proxy (413/502) no se muestra como un trozo de HTML, y se puede reintentar', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest
      .mockRejectedValueOnce({ response: { status: 413, data: '<html><head><title>413 Request Entity Too Large</title></head></html>' } })
      .mockResolvedValueOnce({ data: { rq_number: 'RQ-2026-0301' } });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillValidForm(user);

    await user.click(submitButton());

    expect(await screen.findByText('Error al guardar el requerimiento.')).toBeInTheDocument();
    expect(screen.queryByText('<')).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();

    await user.click(submitButton());
    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(requestsApi.createRequest).toHaveBeenCalledTimes(2);
  });

  it('una colisión del número de RQ (400 en rq_number) se muestra con su texto y no se confunde con el área', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { error: true, status_code: 400, detail: { rq_number: 'No se pudo generar el número de requerimiento, intente nuevamente.' } },
      },
    });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillValidForm(user);

    await user.click(submitButton());

    const summary = await screen.findByRole('group', { name: 'Corrija 1 error antes de enviar' });
    expect(within(summary).getByText('No se pudo generar el número de requerimiento, intente nuevamente.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Área del RQ/)).not.toHaveAttribute('aria-invalid', 'true');
    expect(submitButton()).toBeEnabled();
  });

  it('el mensaje del servidor se limpia al reintentar y no queda un resumen viejo si ahora se crea', async () => {
    const user = userEvent.setup();
    requestsApi.createRequest
      .mockRejectedValueOnce({
        response: { status: 400, data: { detail: { items: [{ quantity: ['La cantidad debe ser mayor que cero.'] }] } } },
      })
      .mockResolvedValueOnce({ data: { rq_number: 'RQ-2026-0302' } });
    renderPage();
    await screen.findByText('MINERA YANAOCHA');
    await fillValidForm(user);

    await user.click(submitButton());
    // Same text in the error summary and in the toast.
    expect((await screen.findAllByText('Ítem 1 (Cantidad): La cantidad debe ser mayor que cero.')).length).toBeGreaterThanOrEqual(1);
    await user.click(submitButton());

    await screen.findByText('Requerimiento enviado exitosamente. El Excel se ha descargado.');
    expect(screen.queryByRole('group', { name: /corrija/i })).not.toBeInTheDocument();
  });
});
