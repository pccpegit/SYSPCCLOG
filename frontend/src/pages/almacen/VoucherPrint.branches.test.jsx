import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import VoucherPrint from './VoucherPrint';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');

// SYSPCC-025 · QA ronda 2 — observaciones del vale, botón Imprimir y formas alternativas de las líneas.

const voucher = (overrides = {}) => ({
  movement_number: 'SAL-2026-G0042-01', movement_type: 'EXIT', date: '16/10/2026 10:30', movement_date: '2026-10-05',
  voucher_number: '3425', warehouse: 'Almacén Central', destination_type: 'EMPLOYEE',
  destination_detail: 'Persona Ficticia Uno', requested_by: '', registered_by: 'Operador Prueba', notes: '',
  group_number: 'SAL-2026-G0042',
  items: [{ product_code: 'EPP000001', description: 'Guante de cuero T: L', unit: 'EA', quantity: 2 }],
  ...overrides,
});

function renderVoucher() {
  return renderWithProviders(
    <Routes><Route path="/almacen/salida/:id/voucher" element={<VoucherPrint />} /></Routes>,
    { route: '/almacen/salida/42/voucher' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getVoucher.mockResolvedValue({ data: voucher() });
});

afterEach(() => vi.restoreAllMocks());

describe('VoucherPrint — observaciones e impresión', () => {
  it('muestra las observaciones del movimiento cuando existen', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ notes: 'Entrega de mostrador, talla confirmada' }) });
    renderVoucher();
    expect(await screen.findByText('Entrega de mostrador, talla confirmada')).toBeInTheDocument();
    expect(screen.getByText(/observaciones:/i)).toBeInTheDocument();
  });

  it('sin observaciones no dibuja el recuadro vacío', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(screen.queryByText(/observaciones:/i)).not.toBeInTheDocument();
  });

  it('«Imprimir» abre el diálogo de impresión del navegador una sola vez', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderVoucher();
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /imprimir/i }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('las observaciones con marcado se muestran como texto, no como HTML', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ notes: '<img src=x onerror=alert(1)><b>negrita</b>' }) });
    const { container } = renderVoucher();
    expect(await screen.findByText('<img src=x onerror=alert(1)><b>negrita</b>')).toBeInTheDocument();
    expect(container.querySelector('#voucher-print img')).toBeNull();
    expect(container.querySelector('#voucher-print b')).toBeNull();
  });
});

describe('VoucherPrint — formas alternativas de las líneas', () => {
  it('un vale de un solo ítem (clave «item») se dibuja como una fila', async () => {
    api.getVoucher.mockResolvedValue({
      data: voucher({ items: undefined, item: { product_code: 'EPP000009', description: 'Lente claro', unit: 'ea', quantity: 4 } }),
    });
    renderVoucher();
    expect(await screen.findByText('EPP000009')).toBeInTheDocument();
    expect(screen.getByText('Lente claro')).toBeInTheDocument();
    expect(screen.getByText('Ea')).toBeInTheDocument();                       // unidad con inicial mayúscula
    expect(screen.queryByText('Sin ítems')).not.toBeInTheDocument();
  });

  it('las líneas con claves «code» y «name» también se leen', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ items: [{ code: 'EPP000010', name: 'Tapón auditivo', unit: 'PAR', quantity: 6 }] }) });
    renderVoucher();
    expect(await screen.findByText('EPP000010')).toBeInTheDocument();
    expect(screen.getByText('Tapón auditivo')).toBeInTheDocument();
  });

  it('un vale sin líneas lo dice en vez de dejar la tabla vacía', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ items: [] }) });
    renderVoucher();
    expect(await screen.findByText('Sin ítems')).toBeInTheDocument();
  });

  it('un vale que llega sin cuerpo no rompe la pantalla', async () => {
    api.getVoucher.mockResolvedValue({ data: null });
    renderVoucher();
    expect(await screen.findByText('Sin ítems')).toBeInTheDocument();
  });
});
