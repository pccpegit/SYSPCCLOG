import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import VoucherPrint from './VoucherPrint';
import * as api from '../../api/almacen';

vi.mock('../../api/almacen');

// SYSPCC-025 · QA ronda 1 — forma real de `GET movements/{id}/voucher/`
// (apps/warehouse/views.py, MovementViewSet.voucher).
const voucher = (overrides = {}) => ({
  movement_number: 'SAL-2026-G0042-01',
  movement_type: 'EXIT',
  date: '16/10/2026 10:30',
  movement_date: '2026-10-05',
  voucher_number: '3425',
  warehouse: 'Almacén Central',
  destination_type: 'EMPLOYEE',
  destination_detail: 'Persona Ficticia Uno',
  requested_by: '',
  registered_by: 'Operador Prueba',
  notes: '',
  group_number: 'SAL-2026-G0042',
  items: [
    { product_code: 'EPP000001', description: 'Guante de cuero T: L', unit: 'EA', quantity: 2 },
    { product_code: 'EPP000002', description: 'Casco blanco', unit: 'EA', quantity: 1 },
  ],
  ...overrides,
});

function renderVoucher() {
  return renderWithProviders(
    <Routes>
      <Route path="/almacen/salida/:id/voucher" element={<VoucherPrint />} />
      <Route path="/almacen/movimientos" element={<p>Listado de movimientos</p>} />
    </Routes>,
    { route: '/almacen/salida/42/voucher' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getVoucher.mockResolvedValue({ data: voucher() });
});

describe('VoucherPrint', () => {
  it('pide el vale del movimiento de la URL y muestra sus líneas', async () => {
    renderVoucher();
    expect(await screen.findByText('EPP000001')).toBeInTheDocument();
    expect(api.getVoucher).toHaveBeenCalledWith('42');
    expect(screen.getByText('Guante de cuero T: L')).toBeInTheDocument();
    expect(screen.getByText('Casco blanco')).toBeInTheDocument();
    expect(screen.getByText('Persona Ficticia Uno')).toBeInTheDocument();
  });

  it('muestra la fecha operativa del movimiento y el N° de vale físico', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(screen.getByText('05/10/2026')).toBeInTheDocument();
    expect(screen.getByText('3425')).toBeInTheDocument();
  });

  it('el documento se titula «Vale de Egreso», como el resto de la aplicación (no «Vale de Salida»)', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher() });
    renderVoucher();
    expect(await screen.findByText('Vale de Egreso')).toBeInTheDocument();
    expect(screen.queryByText(/vale de salida/i)).not.toBeInTheDocument();
  });

  it('un egreso con guía automática la imprime y no dice «Sin vale» (SYSPCC-041)', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ voucher_number: '', internal_guide_number: 'GR-2026-000007' }) });
    renderVoucher();
    expect(await screen.findByText('N° de guía:')).toBeInTheDocument();
    expect(screen.getByText('GR-2026-000007')).toBeInTheDocument();
    expect(screen.queryByText('Sin vale')).not.toBeInTheDocument();
  });

  it('un vale sin número físico dice «Sin vale»', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ voucher_number: '' }) });
    renderVoucher();
    expect(await screen.findByText('Sin vale')).toBeInTheDocument();
  });

  // DEFECTO QA-12: para un movimiento importado SIN fecha (`movement_date: null`) la pantalla cae a
  // `formatDateLong(voucher.date)`, pero el servidor entrega `date` como «dd/mm/aaaa HH:MM», que
  // `new Date()` no entiende: se imprime «Invalid Date» (o, con día ≤ 12, el mes equivocado).
  it('un movimiento importado sin fecha no imprime «Invalid Date» ni un mes equivocado', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ movement_date: null, date: '16/10/2026 10:30' }) });
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(document.body.textContent).not.toMatch(/invalid date/i);
  });

  it('un movimiento sin fecha con día ≤ 12 no se lee con el mes y el día invertidos', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ movement_date: null, date: '05/10/2026 08:00' }) });
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(document.body.textContent).not.toMatch(/mayo/i);        // 05/10 es 5 de octubre, no 10 de mayo
  });

  it('un vale sin líneas muestra «Sin ítems»', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ items: [] }) });
    renderVoucher();
    expect(await screen.findByText('Sin ítems')).toBeInTheDocument();
  });

  it('muestra el error de carga con un botón para volver', async () => {
    api.getVoucher.mockRejectedValue(new Error('boom'));
    renderVoucher();
    expect(await screen.findByText('No se pudo cargar el vale de egreso.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument();
  });

  it('imprime con window.print y vuelve a movimientos', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const user = userEvent.setup();
    renderVoucher();
    await screen.findByText('EPP000001');
    await user.click(screen.getByRole('button', { name: /imprimir/i }));
    expect(print).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /volver a movimientos/i }));
    expect(await screen.findByText('Listado de movimientos')).toBeInTheDocument();
    print.mockRestore();
  });

  it('el pie del vale no imprime la secuencia literal \\u2014', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(document.body.textContent).not.toContain('\\u2014');
  });
});

// SYSPCC-025 · react-frontend ronda 1 — el vale es un documento firmado: legible en tema oscuro,
// con la cabecera visible al imprimir sin «gráficos de fondo» y con ortografía correcta.
describe('VoucherPrint — tema oscuro e impresión', () => {
  const printStyles = () => document.querySelector('style').textContent;

  it('en pantalla no usa franjas odd/even ni fondos con alfa que el tema oscuro no adapta', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    const html = document.querySelector('#voucher-print').innerHTML;
    expect(html).not.toMatch(/odd:|even:|bg-gray-50\/|bg-white\//);
  });

  it('la cabecera de la tabla no depende de un relleno oscuro que el navegador no imprime', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    const head = document.querySelector('#voucher-print thead tr');
    expect(head.className).not.toContain('bg-gray-900');
    expect(head.className).not.toContain('text-white');
    // Se distingue por borde y negrita, que sí se imprimen.
    expect(head.className).toContain('border-b-2');
  });

  it('el borde de la cabecera del vale tiene variante clara para el tema oscuro', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    const header = document.querySelector('#voucher-print h1').closest('div').parentElement;
    expect(header.className).toContain('border-gray-900');
    expect(header.className).toContain('dark:border-gray-300');
  });

  it('al imprimir fuerza texto negro sobre blanco aunque el tema sea oscuro', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    const css = printStyles();
    expect(css).toContain('@media print');
    expect(css).toMatch(/#voucher-print, #voucher-print \* \{[^}]*color: #111 !important/);
    expect(css).toMatch(/#voucher-print \{[^}]*background: #fff !important/);
    expect(css).toMatch(/\*:not\(#voucher-print\) \{ background: transparent !important/);
    expect(css).toMatch(/html, body \{ background: #fff !important/);
    expect(css).toContain('print-color-adjust: exact');
  });

  it('con la clase .dark en la raíz el documento sigue siendo el mismo (los colores se fuerzan por CSS de impresión)', async () => {
    document.documentElement.classList.add('dark');
    try {
      renderVoucher();
      await screen.findByText('EPP000001');
      expect(printStyles()).toContain('color: #111 !important');
      expect(document.querySelector('#voucher-print')).toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });
});

describe('VoucherPrint — fecha y ortografía', () => {
  it('un movimiento sin fecha muestra la fecha de registro tal cual la entrega el servidor', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ movement_date: null, date: '05/10/2026 08:00' }) });
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(screen.getByText('05/10/2026 08:00 (fecha de registro)')).toBeInTheDocument();
  });

  it('sin fecha de ningún tipo muestra una raya, no «Invalid Date»', async () => {
    api.getVoucher.mockResolvedValue({ data: voucher({ movement_date: null, date: '' }) });
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(document.body.textContent).not.toMatch(/invalid date/i);
  });

  it('el documento lleva tildes: Código, Descripción, Almacén, Entregó, Recibió, Autorizó', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    const text = document.querySelector('#voucher-print').textContent;
    for (const word of ['Código', 'Descripción', 'Almacén', 'Entregó', 'Recibió', 'Autorizó', 'Construcción', 'Gestión de Almacén']) {
      expect(text).toContain(word);
    }
    expect(text).not.toMatch(/Codigo|Descripcion|Almacen\b|Entrego|Recibio|Autorizo|Construccion|Gestion/);
  });

  it('el pie usa la raya larga real, no la secuencia de escape', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(document.querySelector('#voucher-print').textContent).toContain('PCC S.A.C. — Sistema de Gestión de Almacén — Generado el');
  });

  it('la tabla tiene título y columnas con scope', async () => {
    renderVoucher();
    await screen.findByText('EPP000001');
    expect(screen.getByRole('table', { name: /materiales despachados/i })).toBeInTheDocument();
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col');
    }
  });

  it('los botones son de tipo «button» y el indicador de carga se anuncia', async () => {
    let release;
    api.getVoucher.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderVoucher();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando el vale…');
    release({ data: voucher() });
    await screen.findByText('EPP000001');
    expect(screen.getByRole('button', { name: /imprimir/i })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: /volver a movimientos/i })).toHaveAttribute('type', 'button');
  });

  it('el error de carga se anuncia como alerta', async () => {
    api.getVoucher.mockRejectedValue(new Error('boom'));
    renderVoucher();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el vale de egreso.');
  });
});
