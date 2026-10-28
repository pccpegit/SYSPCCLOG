import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CVStatusChip from './CVStatusChip';
import CVRecommendationBadge from './CVRecommendationBadge';
import CVScoreBar from './CVScoreBar';
import CVAnalysisStatus from './CVAnalysisStatus';

describe('estados con icono + texto', () => {
  it.each([
    ['QUEUED', 'En cola'],
    ['PROCESSING', 'Leyendo'],
    ['DONE', 'Listo'],
    ['FAILED', 'Con error'],
    ['CANCELLED', 'Cancelado'],
  ])('CVStatusChip %s muestra "%s" como texto', (status, text) => {
    const { container } = render(<CVStatusChip status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });

  it.each([
    ['ADVANCE', 'Avanzar'],
    ['REVIEW', 'Revisar'],
    ['NO_ADVANCE', 'No avanzar'],
  ])('CVRecommendationBadge %s muestra "%s"', (value, text) => {
    render(<CVRecommendationBadge value={value} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('"No avanzar" no usa rojo (el rojo es para errores)', () => {
    const { container } = render(<CVRecommendationBadge value="NO_ADVANCE" />);
    expect(container.firstChild.className).not.toMatch(/red/);
  });

  it('sin sugerencia no renderiza nada', () => {
    const { container } = render(<CVRecommendationBadge value={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('el puntaje es número + texto oculto "de 100"; sin puntaje muestra una raya', () => {
    const { container, rerender } = render(<CVScoreBar score={86} />);
    expect(container).toHaveTextContent('86 de 100');
    rerender(<CVScoreBar score={null} />);
    expect(screen.getByText('Sin puntaje')).toBeInTheDocument();
  });

  it('el estado del análisis lleva texto', () => {
    render(<CVAnalysisStatus status="COMPLETED_WITH_ERRORS" />);
    expect(screen.getByText('Completado con errores')).toBeInTheDocument();
  });
});
