import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CVModeBanner from './CVModeBanner';
import { cvConfig } from '../../../test/cvFixtures';

describe('CVModeBanner', () => {
  it('avisa del modo de prueba cuando el backend usa el proveedor simulado', () => {
    render(<CVModeBanner config={cvConfig({ provider: 'fake', simulated: true })} />);
    expect(screen.getByRole('note')).toHaveTextContent('Modo de prueba: los resultados son simulados.');
    expect(screen.getByRole('note')).toHaveTextContent('No los uses para decidir.');
  });

  it('avisa con amabilidad cuando falta la clave de Anthropic', () => {
    render(<CVModeBanner config={cvConfig({ enabled: false })} />);
    expect(screen.getByRole('note')).toHaveTextContent('Para analizar CVs falta la clave de Anthropic.');
    expect(screen.getByRole('note')).toHaveTextContent('Pide al administrador que la configure.');
  });

  it('no muestra nada con la configuración normal ni mientras carga', () => {
    const { container, rerender } = render(<CVModeBanner config={cvConfig()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CVModeBanner config={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('si falla la configuración muestra una alerta con Reintentar', async () => {
    const onRetry = vi.fn();
    render(<CVModeBanner config={null} isError onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
