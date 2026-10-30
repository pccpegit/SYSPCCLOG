import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import PageLoader from './PageLoader';
import { isChunkLoadError, reloadOnceForChunkError } from '../../utils/chunkErrors';

/**
 * SYSPCC-036: error boundary for route content.
 *
 * - Stale chunk (new deployment, old tab): reloads the page ONCE automatically
 *   (guarded in sessionStorage so it can never loop); if it fails again it
 *   shows the message with a "Recargar página" button.
 * - Any other render error: message with the same button, instead of a blank
 *   screen.
 * - `resetKey` (e.g. the pathname) clears the error when it changes, so
 *   navigating away from a broken screen recovers the boundary.
 */
export default class ErrorBoundary extends Component {
  state = { error: null, reloading: false };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (isChunkLoadError(error)) {
      if (reloadOnceForChunkError()) {
        this.setState({ reloading: true });
        return;
      }
    } else {
      console.error('Error de renderizado:', error);
    }
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, reloading: false });
    }
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    if (reloading) return <PageLoader fullScreen={this.props.fullScreen} />;

    const stale = isChunkLoadError(error);
    return (
      <div
        role="alert"
        className={`flex items-center justify-center px-4 ${this.props.fullScreen ? 'min-h-screen bg-app' : 'py-20'}`}
      >
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-6 text-center shadow-sm">
          <AlertTriangle size={28} className="mx-auto text-amber-500" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-gray-900">
            {stale ? 'Hay una versión nueva de la aplicación' : 'No se pudo mostrar esta pantalla'}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {stale
              ? 'Recargue la página para continuar. Su sesión se mantiene.'
              : 'Ocurrió un error inesperado. Recargue la página e intente de nuevo.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 transition-colors"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Recargar página
          </button>
        </div>
      </div>
    );
  }
}
