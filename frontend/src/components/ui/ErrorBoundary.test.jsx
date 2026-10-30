import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lazy, Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';
import PageLoader from './PageLoader';
import { CHUNK_RELOAD_KEY } from '../../utils/chunkErrors';

// SYSPCC-036 — chunk viejo tras un despliegue: el import() dinámico se rechaza.

const STALE = 'Failed to fetch dynamically imported module: https://x/assets/Page-old.js';

function Boom({ message }) {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  let reload;
  const realLocation = window.location;

  beforeEach(() => {
    window.sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    vi.restoreAllMocks();
  });

  it('muestra los hijos cuando no hay error', () => {
    render(<ErrorBoundary><p>contenido</p></ErrorBoundary>);
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('chunk viejo: recarga una sola vez y mientras tanto muestra "Cargando…"', () => {
    render(<ErrorBoundary><Boom message={STALE} /></ErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('chunk viejo por segunda vez seguida: no recarga, avisa con botón "Recargar página"', async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    render(<ErrorBoundary><Boom message={STALE} /></ErrorBoundary>);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Hay una versión nueva de la aplicación');
    await userEvent.click(screen.getByRole('button', { name: 'Recargar página' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('otro error de renderizado: mensaje genérico, sin recarga automática', () => {
    render(<ErrorBoundary><Boom message="otra cosa" /></ErrorBoundary>);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo mostrar esta pantalla');
    expect(screen.getByRole('button', { name: 'Recargar página' })).toBeInTheDocument();
  });

  it('se recupera cuando cambia resetKey (el usuario navega a otra pantalla)', () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Boom message={STALE} /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<ErrorBoundary resetKey="/b"><p>otra pantalla</p></ErrorBoundary>);
    expect(screen.getByText('otra pantalla')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('integración con React.lazy: el fallo del import llega al boundary', async () => {
    const Broken = lazy(() => Promise.reject(new Error(STALE)));
    render(
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Broken />
        </Suspense>
      </ErrorBoundary>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Cargando…');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
