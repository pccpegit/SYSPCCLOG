import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoucherCell } from './chips';

// SYSPCC-041 — un egreso nuevo no lleva vale físico: su identificador es la guía automática.

const cell = (movement) => render(<table><tbody><tr><td><VoucherCell movement={movement} /></td></tr></tbody></table>);

describe('VoucherCell', () => {
  it('muestra SIEMPRE la guía real primero y el vale físico solo como dato secundario', () => {
    cell({ movement_type: 'EXIT', voucher_number: '3425', internal_guide_number: 'GR-2026-000001' });
    const guide = screen.getByText('GR-2026-000001');
    expect(guide).toBeInTheDocument();
    expect(screen.getByText('Guía')).toHaveClass('sr-only');
    expect(screen.getByText(/vale físico:/i)).toHaveTextContent('3425');
    // La guía va antes que el vale en el orden del documento.
    expect(guide.compareDocumentPosition(screen.getByText('3425')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('un vale de texto libre que imita una guía no la suplanta', () => {
    cell({ movement_type: 'EXIT', voucher_number: 'GR-2026-000123', internal_guide_number: 'GR-2026-000007' });
    expect(screen.getByText('GR-2026-000007')).toBeInTheDocument();
    expect(screen.getByText(/vale físico:/i)).toHaveTextContent('GR-2026-000123');
    expect(screen.getByText('GR-2026-000007').closest('span.font-semibold')).not.toBeNull(); // la guía real es la destacada
  });

  it('un egreso nuevo sin vale muestra solo su guía y no la alerta «Sin vale»', () => {
    cell({ movement_type: 'EXIT', voucher_number: '', internal_guide_number: 'GR-2026-000001' });
    expect(screen.getByText('GR-2026-000001')).toBeInTheDocument();
    expect(screen.queryByText(/vale físico/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Sin vale')).not.toBeInTheDocument();
  });

  it('un egreso histórico con vale físico y sin guía muestra el vale', () => {
    cell({ movement_type: 'EXIT', voucher_number: '3425', internal_guide_number: null });
    expect(screen.getByText('3425')).toBeInTheDocument();
    expect(screen.queryByText(/vale físico/i)).not.toBeInTheDocument();
  });

  it('un egreso antiguo sin vale ni guía sigue avisando «Sin vale»', () => {
    cell({ movement_type: 'EXIT', voucher_number: null, internal_guide_number: null });
    expect(screen.getByText('Sin vale')).toBeInTheDocument();
  });

  it('un ingreso no lleva vale: guion', () => {
    cell({ movement_type: 'ENTRY', voucher_number: '', internal_guide_number: null });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Sin vale')).not.toBeInTheDocument();
  });
});
