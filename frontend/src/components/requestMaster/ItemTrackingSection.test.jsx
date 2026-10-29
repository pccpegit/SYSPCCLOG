import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../context/ToastContext';
import ItemTrackingSection from './ItemTrackingSection';
import * as masterApi from '../../api/requestMaster';
import { buildMasterRow, page } from '../../test/requestMasterFixtures';

// SYSPCC-030 — «Seguimiento por ítem» del detalle de un RQ (request-master/?request=<id>).
vi.mock('../../api/requestMaster');

const ok = (data) => Promise.resolve({ data, headers: {} });
const httpError = (status, data = {}) => Promise.reject({ response: { status, data } });

function renderSection() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <ItemTrackingSection requestId={42} />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  masterApi.getRequestMaster.mockImplementation(() => ok(page([
    buildMasterRow(),
    buildMasterRow({ id: 102, line_number: 2, description: 'Guantes de cuero', status: 'PENDIENTE', status_label: 'Pendiente', can_set_override: true }),
  ])));
});

describe('ItemTrackingSection', () => {
  it('consulta solo las líneas de ese RQ, sin filtros de proyecto, y las muestra sin la columna RQ', async () => {
    renderSection();

    const table = await screen.findByRole('table', { name: /Seguimiento por ítem/ });
    expect(screen.getByRole('heading', { name: 'Seguimiento por ítem' })).toBeInTheDocument();
    expect(masterApi.getRequestMaster).toHaveBeenCalledWith({
      request: 42, ordering: 'line_number', page: 1, page_size: 25,
    });
    expect(within(table).getByText('Casco blanco')).toBeInTheDocument();
    expect(within(table).getByText('Parcial')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^RQ/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole('link', { name: 'RQ-2026-0042' })).not.toBeInTheDocument();
    // cantidades: solicitado, atendido y faltante
    const row = within(table).getByText('Casco blanco').closest('tr');
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByText('4')).toBeInTheDocument();
    expect(within(row).getByText('6')).toBeInTheDocument();
  });

  it('muestra la carga con una región viva y luego el contenido', async () => {
    let resolve;
    masterApi.getRequestMaster.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderSection();

    expect(screen.getByText('Cargando el seguimiento por ítem…', { selector: 'span' })).toBeInTheDocument();
    expect(document.body.querySelector('[aria-live="polite"].sr-only')).toHaveTextContent('Cargando el seguimiento por ítem…');

    resolve({ data: page([buildMasterRow()]), headers: {} });
    expect(await screen.findByText('Casco blanco')).toBeInTheDocument();
  });

  it('error: alerta y reintento', async () => {
    masterApi.getRequestMaster.mockImplementationOnce(() => httpError(500, 'boom'));
    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el Master de RQ');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Casco blanco')).toBeInTheDocument();
  });

  it('un RQ sin ítems muestra el estado vacío', async () => {
    masterApi.getRequestMaster.mockImplementation(() => ok(page([])));
    renderSection();
    expect(await screen.findByText('Este RQ aún no tiene ítems en seguimiento')).toBeInTheDocument();
  });

  it('ordena por columna sin salir de la página', async () => {
    renderSection();
    await screen.findByText('Casco blanco');

    await userEvent.click(within(screen.getByRole('columnheader', { name: /Faltante/ })).getByRole('button'));

    await waitFor(() => expect(masterApi.getRequestMaster).toHaveBeenLastCalledWith(expect.objectContaining({ request: 42, ordering: 'missing' })));
    expect(screen.getByRole('columnheader', { name: /Faltante/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('Stand by desde el detalle: actualiza la fila con el ítem devuelto', async () => {
    masterApi.setItemAttentionOverride.mockImplementation(() => ok({
      detail: 'Ítem puesto en stand by.', changed: true,
      item: buildMasterRow({ id: 102, line_number: 2, description: 'Guantes de cuero', status: 'STAND_BY', status_label: 'Stand by', attention_override: 'STAND_BY', can_set_override: true }),
    }));
    renderSection();
    await screen.findByText('Guantes de cuero');

    await userEvent.click(screen.getByRole('button', { name: 'Poner en stand by la línea 2 de RQ-2026-0042' }));
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Espera al cliente');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Poner en stand by' }));

    await waitFor(() => expect(masterApi.setItemAttentionOverride).toHaveBeenCalledWith(
      42, 102, { override: 'STAND_BY', note: 'Espera al cliente' },
    ));
    const table = screen.getByRole('table', { name: /Seguimiento por ítem/ });
    await waitFor(() => expect(within(within(table).getByText('Guantes de cuero').closest('tr')).getByText('Stand by')).toBeInTheDocument());
    expect(await screen.findByText('Ítem puesto en stand by.')).toBeInTheDocument();
  });

  it('con más de 25 líneas pagina dentro de la sección', async () => {
    masterApi.getRequestMaster.mockImplementation((params) => ok(page([buildMasterRow()], {
      count: 40, next: params.page < 2 ? 'x' : null,
    })));
    renderSection();
    await screen.findByText('Casco blanco');

    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    await waitFor(() => expect(masterApi.getRequestMaster).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
  });
});
