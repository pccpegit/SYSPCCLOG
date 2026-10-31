/**
 * SYSPCC-036: Suspense fallback for lazy-loaded screens.
 *
 * Discreet on purpose: it fades in after a short delay, so a chunk that
 * arrives fast never flashes a spinner. `fullScreen` is for the outermost
 * boundary (no shell on screen yet); the default fits inside a shell's main
 * area, keeping the sidebar and header in place.
 */
export default function PageLoader({ fullScreen = false, label = 'Cargando…' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center ${fullScreen ? 'min-h-screen bg-app' : 'py-24'}`}
    >
      <div className="page-fade-in flex flex-col items-center gap-3" style={{ animationDelay: '150ms' }}>
        <div
          aria-hidden="true"
          className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600"
        />
        <p className="text-sm text-gray-400">{label}</p>
      </div>
    </div>
  );
}
