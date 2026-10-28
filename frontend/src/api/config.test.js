import { describe, it, expect, afterEach, vi } from 'vitest';

// SYSPCC-021 — config.js usa `??` (no `||`) a propósito para leer
// VITE_API_URL / VITE_BACKEND_URL: en el demo de Vercel, VITE_BACKEND_URL se
// define como '' (string vacío) para que las URLs de media queden relativas
// (mismo origen, vía el rewrite proxy de vercel.json hacia Render). Con `||`
// ese '' se trata como falsy y el valor cae al default de localhost,
// rompiendo el proxy en producción. Estos tests fijan ese contrato para que
// una futura reversión a `||` (o un cambio similar) falle aquí en vez de en
// el demo desplegado.
//
// El módulo lee `import.meta.env` en su nivel superior (const), así que
// cada caso debe stubear el env ANTES de importar y usar
// vi.resetModules() + import dinámico para forzar una re-evaluación del
// módulo con el env stubeado.
describe('api/config — fallbacks de variables de entorno', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('conserva VITE_BACKEND_URL="" en vez de caer a localhost (caso demo Vercel same-origin)', async () => {
    vi.stubEnv('VITE_BACKEND_URL', '');
    vi.resetModules();

    const { BACKEND_URL } = await import('./config.js');

    expect(BACKEND_URL).toBe('');
  });

  it('conserva VITE_API_URL="" en vez de caer a localhost', async () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.resetModules();

    const { API_BASE_URL } = await import('./config.js');

    expect(API_BASE_URL).toBe('');
  });

  it('usa el default de desarrollo local cuando VITE_BACKEND_URL no está definida', async () => {
    vi.stubEnv('VITE_BACKEND_URL', undefined);
    vi.resetModules();

    const { BACKEND_URL } = await import('./config.js');

    expect(BACKEND_URL).toBe('http://localhost:8000');
  });

  it('usa el default de desarrollo local cuando VITE_API_URL no está definida', async () => {
    vi.stubEnv('VITE_API_URL', undefined);
    vi.resetModules();

    const { API_BASE_URL } = await import('./config.js');

    expect(API_BASE_URL).toBe('http://localhost:8000/api/v1/');
  });

  it('respeta un valor explícito no vacío de VITE_BACKEND_URL', async () => {
    vi.stubEnv('VITE_BACKEND_URL', 'https://syspcc-demo-backend.onrender.com');
    vi.resetModules();

    const { BACKEND_URL } = await import('./config.js');

    expect(BACKEND_URL).toBe('https://syspcc-demo-backend.onrender.com');
  });
});
