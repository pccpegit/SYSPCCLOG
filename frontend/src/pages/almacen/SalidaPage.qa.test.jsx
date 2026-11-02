import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeItem } from '../../test/almacenFixtures';
import {
  ITEM_CASCO, ITEM_GUANTES, apiError, deliverablePage, deliverableRow, makePicking,
} from '../../test/pickingFixtures';
import SalidaPage from './SalidaPage';
import { useAuth } from '../../context/useAuth';
import * as api from '../../api/almacen';
import { downloadResponse } from '../../utils/download';

vi.mock('../../api/almacen');
vi.mock('../../context/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../utils/download', async (importOriginal) => ({ ...(await importOriginal()), downloadResponse: vi.fn() }));

// SYSPCC-041 · FASE 4 (qa-engineer) — carreras entre respuestas del servidor y fallos de la descarga en Salida.

const RQ_A = deliverableRow();
const RQ_B = deliverableRow({ id: 8, rq_number: 'RQ-2026-0008', requested_by: 'Ana Prueba Tres' });
const ITEM_B1 = { ...ITEM_CASCO, id: 21, line_number: 1, description: 'Arnés de seguridad' };
const ITEM_B2 = { ...ITEM_GUANTES, id: 22, line_number: 2, description: 'Línea de vida' };
const PICKING_A = makePicking();
const PICKING_B = makePicking({ request: { id: 8, rq_number: 'RQ-2026-0008' }, items: [ITEM_B1, ITEM_B2] });
const DELIVERY = {
  id: 3, dispatch_number: 'SAL-2026-G0009', dispatch_guide_number: 'GR-2026-000042',
  movement_group_id: 43, first_movement_id: 430,
};

const include = (line) => screen.getByRole('checkbox', { name: `Incluir la línea ${line}` });
const submitBtn = () => screen.getByRole('button', { name: /^registrar entrega del requerimiento$/i });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function openCombo(user) {
  await screen.findByRole('combobox', { name: /ítem 1/i });
  await user.click(screen.getByRole('combobox', { name: /rq pendiente por entregar/i }));
}

beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ userRoles: ['CENTRAL_WAREHOUSE'] });
  api.getInventory.mockResolvedValue({ data: [makeItem({ id: 1, product_code: 'EPP000001', description: 'Casco blanco', unit: 'EA', total_stock: 3 })] });
  api.getMovements.mockResolvedValue({ data: { results: [] } });
  api.getDeliverableRequests.mockResolvedValue(deliverablePage([RQ_A, RQ_B]));
  api.getRqPicking.mockImplementation(async (id) => ({ data: id === 8 ? PICKING_B : PICKING_A }));
  api.deliverRqItems.mockResolvedValue({ data: { delivery: DELIVERY, picking: PICKING_A } });
});

describe('SalidaPage con RQ — respuestas que llegan tarde', () => {
  it('el picking de un RQ que ya se quitó no pisa el del RQ elegido después', async () => {
    const user = userEvent.setup();
    const slowA = deferred();
    api.getRqPicking.mockImplementation((id) => (id === 7 ? slowA.promise : Promise.resolve({ data: PICKING_B })));
    renderWithProviders(<SalidaPage />);
    await openCombo(user);
    await user.click(await screen.findByRole('option', { name: /RQ-2026-0007/ }));
    await user.click(screen.getByRole('button', { name: /quitar requerimiento/i }));
    await user.click(await screen.findByRole('option', { name: /RQ-2026-0008/ }));
    await screen.findByTestId('rq-line-21');

    slowA.resolve({ data: PICKING_A });
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    expect(screen.getByTestId('rq-line-21')).toBeInTheDocument();
    expect(screen.queryByTestId('rq-line-11')).not.toBeInTheDocument();
    expect(include(1)).toBeChecked();
    expect(submitBtn()).toHaveAttribute('aria-disabled', 'false');
  });

  // DEFECTO SYSPCC-041 (SalidaPage.jsx, reloadRqPicking ~l.156-166): la recarga disparada por un error del
  // servidor (DUPLICATE_DELIVERY / DELIVERY_LINES_INVALID) no comprueba que el RQ siga siendo el elegido.
  // Si el usuario cambia de RQ antes de que responda, escribe `rqLoad` con la clave del RQ anterior
  // («7:0») y `rqKey` del nuevo es «8:0»: la pantalla del RQ nuevo vuelve a «Cargando» sin salida, y
  // `setSelection` mezcla los ítems del RQ viejo sobre la selección del nuevo.
  it('la recarga de un RQ anterior (tras DUPLICATE_DELIVERY) no borra las líneas ni las casillas del RQ nuevo', async () => {
    const user = userEvent.setup();
    const slowReloadA = deferred();
    let callsA = 0;
    api.getRqPicking.mockImplementation((id) => {
      if (id === 8) return Promise.resolve({ data: PICKING_B });
      callsA += 1;
      return callsA === 1 ? Promise.resolve({ data: PICKING_A }) : slowReloadA.promise;
    });
    api.deliverRqItems.mockRejectedValue(apiError(409, {
      detail: 'Esta entrega ya se registró hace unos segundos. Revise el historial del requerimiento.',
      code: 'DUPLICATE_DELIVERY',
    }));
    renderWithProviders(<SalidaPage />);
    await openCombo(user);
    await user.click(await screen.findByRole('option', { name: /RQ-2026-0007/ }));
    await screen.findByTestId('rq-line-11');
    await user.click(submitBtn());
    await waitFor(() => expect(callsA).toBe(2));              // la recarga de A queda pendiente

    await user.click(screen.getByRole('button', { name: /quitar requerimiento/i }));
    await user.click(await screen.findByRole('option', { name: /RQ-2026-0008/ }));
    await screen.findByTestId('rq-line-21');
    expect(include(1)).toBeChecked();

    slowReloadA.resolve({ data: PICKING_A });
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    expect(screen.getByTestId('rq-line-21')).toBeInTheDocument();
    expect(include(1)).toBeChecked();
    expect(include(2)).toBeChecked();
  });
});

describe('SalidaPage con RQ — descarga del PDF', () => {
  it('si el PDF no se puede bajar avisa y la guía sigue a la vista', async () => {
    const user = userEvent.setup();
    api.downloadGroupPdf.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    downloadResponse.mockRejectedValue(new Error('boom'));
    renderWithProviders(<SalidaPage />);
    await openCombo(user);
    await user.click(await screen.findByRole('option', { name: /RQ-2026-0007/ }));
    await screen.findByTestId('rq-line-11');
    await user.click(submitBtn());
    await user.click(await screen.findByRole('button', { name: /descargar pdf/i }));

    expect(await screen.findByText(/no se pudo descargar el pdf/i)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Guía generada' })).toHaveTextContent('GR-2026-000042');
    expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeEnabled();
  });
});

describe('SalidaPage — sin RQ no pide nada al selector', () => {
  it('abrir la pantalla no consulta los RQ pendientes hasta usar el campo', async () => {
    renderWithProviders(<SalidaPage />);
    await screen.findByRole('combobox', { name: /ítem 1/i });
    expect(api.getDeliverableRequests).not.toHaveBeenCalled();
    expect(api.getRqPicking).not.toHaveBeenCalled();
  });
});
