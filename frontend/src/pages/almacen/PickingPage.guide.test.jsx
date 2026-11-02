import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import { DELIVERY_1, makePicking } from '../../test/pickingFixtures';
import PickingPage from './PickingPage';
import * as almacen from '../../api/almacen';
import { downloadResponse } from '../../utils/download';

vi.mock('../../api/almacen');
vi.mock('../../utils/download', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadResponse: vi.fn(),
}));

// SYSPCC-041 — la guía de cada entrega la genera el servidor: el historial la muestra y permite bajar su PDF.

const renderPage = () => renderWithProviders(
  <Routes>
    <Route path="/almacen/pendientes/:id/picking" element={<PickingPage />} />
  </Routes>,
  { route: '/almacen/pendientes/7/picking' },
);

const historyItem = (number) => screen.getByText(number).closest('li');

beforeEach(() => {
  vi.resetAllMocks();
  almacen.getRqPicking.mockResolvedValue({ data: makePicking() });
  downloadResponse.mockResolvedValue('GR-2026-000001.pdf');
});

describe('PickingPage — guía automática en el historial', () => {
  it('cada entrega muestra su «N° de guía»', async () => {
    renderPage();
    await screen.findByTestId('picking-row-11');
    const entry = within(historyItem('DSP-0001'));
    expect(entry.getByText('N° de guía')).toBeInTheDocument();
    expect(entry.getByText('GR-2026-000001')).toBeInTheDocument();
    expect(screen.queryByText('Guía de remisión')).not.toBeInTheDocument();
  });

  it('una entrega antigua sin guía muestra un guion y conserva el resto', async () => {
    almacen.getRqPicking.mockResolvedValue({
      data: makePicking({ deliveries: [{ ...DELIVERY_1, dispatch_guide_number: '', movement_group_id: null, first_movement_id: null }] }),
    });
    renderPage();
    await screen.findByTestId('picking-row-11');
    const entry = within(historyItem('DSP-0001'));
    expect(entry.getByText('N° de guía').nextElementSibling).toHaveTextContent('—');
    expect(entry.queryByRole('button', { name: /descargar pdf/i })).not.toBeInTheDocument();
  });

  it('«Descargar PDF» pide el PDF del grupo de movimientos y lo guarda con el N° de guía', async () => {
    const user = userEvent.setup();
    almacen.downloadGroupPdf.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.click(screen.getByRole('button', { name: 'Descargar PDF de la entrega DSP-0001' }));

    await waitFor(() => expect(downloadResponse).toHaveBeenCalledTimes(1));
    expect(almacen.downloadGroupPdf).toHaveBeenCalledWith(41);
    expect(downloadResponse.mock.calls[0][1]).toBe('GR-2026-000001.pdf');
  });

  it('si el PDF no se puede descargar avisa y no rompe la pantalla', async () => {
    const user = userEvent.setup();
    downloadResponse.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.click(screen.getByRole('button', { name: 'Descargar PDF de la entrega DSP-0001' }));
    expect(await screen.findByText('No se pudo descargar el PDF de la entrega. Intente nuevamente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar PDF de la entrega DSP-0001' })).toBeInTheDocument();
  });

  it('tras registrar una tanda el aviso lleva la guía generada y el historial su botón de PDF', async () => {
    const created = {
      ...DELIVERY_1, id: 3, dispatch_number: 'DSP-0003', dispatch_guide_number: 'GR-2026-000002', movement_group_id: 43, notes: '',
    };
    almacen.deliverRqItems.mockResolvedValue({
      data: { delivery: created, picking: makePicking({ deliveries: [DELIVERY_1, created] }) },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(screen.getByRole('textbox', { name: 'Cantidad a entregar de la línea 1' }), '2');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));

    expect((await screen.findAllByText('Entrega DSP-0003 registrada con la guía GR-2026-000002.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Descargar PDF de la entrega DSP-0003' })).toBeInTheDocument();
    const payload = almacen.deliverRqItems.mock.calls[0][1];
    expect(payload).not.toHaveProperty('dispatch_guide_number');
  });

  it('si el servidor no devolvió guía el aviso no la inventa', async () => {
    almacen.deliverRqItems.mockResolvedValue({
      data: { delivery: { id: 3, dispatch_number: 'DSP-0003' }, picking: makePicking() },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('picking-row-11');
    await user.type(screen.getByRole('textbox', { name: 'Cantidad a entregar de la línea 1' }), '2');
    await user.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect((await screen.findAllByText('Entrega DSP-0003 registrada.')).length).toBeGreaterThan(0);
  });
});
