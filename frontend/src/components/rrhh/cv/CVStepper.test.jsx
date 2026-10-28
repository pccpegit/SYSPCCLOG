import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import CVStepper from './CVStepper';

const nav = () => screen.getByRole('navigation', { name: /pasos del análisis/i });

describe('CVStepper', () => {
  it('marca el paso actual con aria-current y los futuros como pendientes (texto, no solo color)', () => {
    renderWithProviders(<CVStepper current={1} analysisId={5} completed={{}} />);
    const items = within(nav()).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Convocatoria').closest('[aria-current]')).toHaveAttribute('aria-current', 'step');
    expect(within(items[1]).getByText(/pendiente/i)).toBeInTheDocument();
    expect(within(nav()).queryAllByRole('link')).toHaveLength(0);
  });

  it('los pasos hechos son enlaces que llevan al paso, con texto "completado"', () => {
    renderWithProviders(<CVStepper current={3} analysisId={5} completed={{ 1: true, 2: true }} />);
    const links = within(nav()).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/rrhh/cvs/5/preparar?paso=1', '/rrhh/cvs/5/preparar?paso=2']);
    expect(links[0]).toHaveTextContent(/completado/i);
  });

  it('en solo lectura no hay enlaces', () => {
    renderWithProviders(<CVStepper current={3} analysisId={5} completed={{ 1: true, 2: true }} readOnly />);
    expect(within(nav()).queryAllByRole('link')).toHaveLength(0);
  });

  it('muestra "Paso N de 3" para pantallas pequeñas', () => {
    renderWithProviders(<CVStepper current={2} analysisId={5} completed={{ 1: true }} />);
    expect(screen.getByText('Paso 2 de 3 · CVs')).toBeInTheDocument();
  });

  it('en móvil el enlace de un paso hecho conserva su nombre ("Convocatoria"), solo se oculta visualmente', () => {
    renderWithProviders(<CVStepper current={3} analysisId={5} completed={{ 1: true, 2: true }} />);
    const [first, second] = within(nav()).getAllByRole('link');
    expect(first).toHaveAccessibleName(/Convocatoria/);
    expect(second).toHaveAccessibleName(/CVs/);
    const label = within(first).getByText('Convocatoria');
    expect(label.className).toMatch(/sr-only/);
    expect(label.className).not.toMatch(/(^|\s)hidden(\s|$)/); // display:none quitaría el nombre del árbol de accesibilidad
  });

  it('un paso pendiente conserva su nombre además de "pendiente"', () => {
    renderWithProviders(<CVStepper current={1} analysisId={5} completed={{}} />);
    const items = within(nav()).getAllByRole('listitem');
    expect(items[2]).toHaveTextContent('Resultados');
    expect(within(items[2]).getByText('Resultados').className).toMatch(/sr-only/);
  });

  it('la línea "Paso N de 3" no se oculta a los lectores de pantalla', () => {
    renderWithProviders(<CVStepper current={2} analysisId={5} completed={{ 1: true }} />);
    expect(screen.getByText('Paso 2 de 3 · CVs')).not.toHaveAttribute('aria-hidden');
  });
});
