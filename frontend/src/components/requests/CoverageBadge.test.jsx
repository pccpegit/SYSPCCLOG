import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoverageBadge from './CoverageBadge';

// SYSPCC-026 — the coverage hint is always text, never color alone.
describe('CoverageBadge', () => {
  it.each([
    ['FULL', 'LINKED', false, 'Stock suficiente'],
    ['PARTIAL', 'LINKED', false, 'Stock parcial'],
    ['NONE', 'LINKED', false, 'Sin stock'],
    [null, 'UNLINKED', false, 'Sin vincular'],
    [null, 'OFF_CATALOG', false, 'Fuera de catálogo'],
    [null, 'LINKED', true, 'Consultando…'],
    [null, 'LINKED', false, 'Sin datos de stock'],
  ])('coverage %s / %s / loading=%s dice "%s"', (coverage, linkStatus, loading, text) => {
    render(<CoverageBadge coverage={coverage} linkStatus={linkStatus} loading={loading} />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('el punto de color es decorativo: el lector de pantalla sólo oye el texto', () => {
    const { container } = render(<CoverageBadge coverage="PARTIAL" linkStatus="LINKED" />);

    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot.textContent).toBe('');
    expect(container.textContent).toBe('Stock parcial');
  });

  it('acepta una clase extra sin perder el estilo base', () => {
    render(<CoverageBadge coverage="FULL" linkStatus="LINKED" className="shrink-0" />);

    expect(screen.getByText('Stock suficiente').className).toContain('shrink-0');
    expect(screen.getByText('Stock suficiente').className).toContain('rounded-full');
  });

  it('la cobertura gana sobre el estado de carga', () => {
    render(<CoverageBadge coverage="FULL" linkStatus="LINKED" loading />);

    expect(screen.getByText('Stock suficiente')).toBeInTheDocument();
    expect(screen.queryByText('Consultando…')).not.toBeInTheDocument();
  });
});
