---
name: react-testing
description: Testing del frontend React de SYSPCC con Vitest + React Testing Library. Úsalo al escribir tests de componentes, páginas, formularios o hooks. Prueba comportamiento visible al usuario y estados de carga/error, con la API mockeada. Dispara ante "test frontend", "vitest", "testing library", "prueba de componente", "render".
---

# Testing frontend — SYSPCC (Vitest + RTL)

Stack: Vite 7 → **Vitest** + **@testing-library/react** + `@testing-library/user-event`, ya configurado: `frontend/vitest.config.js` (entorno `jsdom`, `globals: true`, separado de `vite.config.js`), setup en `src/test/setup.js` (matchers de `jest-dom`, limpieza de cookies entre tests, polyfill de `localStorage`) y helpers/fixtures en `src/test/`. Los tests van junto al archivo que prueban (`Componente.test.jsx`).

Ejecuta desde `frontend/`: `npm test` (`vitest run`) o `npm run test:watch`.

## Principios
1. **Prueba comportamiento, no implementación.** Consulta por rol/texto que ve el usuario (`getByRole`, `getByText`, `findByRole`), no por clases CSS ni estado interno.
2. **Mockea la capa `api/`**, no `axios` global. Así testeas el componente aislado del backend.
3. **Cubre los 3 estados**: loading, error, y datos/empty — son justo donde fallan las páginas.
4. **Interacción con `user-event`**, no `fireEvent` salvo casos puntuales.
5. Usa el helper real `renderWithProviders` (`src/test/renderWithProviders.jsx`): envuelve en el `ToastProvider` real + `MemoryRouter` (`{ route, initialEntries }`). **No** envuelve `AuthContext`: cada test mockea `context/AuthContext` (`vi.mock` + `useAuth.mockReturnValue(...)`) para fijar el usuario y sus roles.

## Patrón
```jsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api/requests';
import MisRQsPage from './MisRQsPage';            // página ilustrativa con estados loading/error/empty

vi.mock('../../api/requests');
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

beforeEach(() => {
  useAuth.mockReturnValue({ currentUser: { id: 1 }, primaryRole: 'REQUESTER', isAuthenticated: true });
});

describe('MisRQsPage', () => {
  it('muestra los RQs cuando la carga tiene éxito', async () => {
    // las funciones de api/ devuelven la respuesta de Axios; las listas vienen paginadas
    api.getRequests.mockResolvedValue({ data: { count: 1, results: [{ id: 1, rq_number: 'RQ-2026-0001' }] } });
    renderWithProviders(<MisRQsPage />);
    expect(await screen.findByText('RQ-2026-0001')).toBeInTheDocument();
  });

  it('muestra estado de error si la API falla', async () => {
    api.getRequests.mockRejectedValue(new Error('boom'));
    renderWithProviders(<MisRQsPage />);
    expect(await screen.findByText(/no se pudieron cargar/i)).toBeInTheDocument();
  });

  it('muestra estado vacío sin datos', async () => {
    api.getRequests.mockResolvedValue({ data: { count: 0, results: [] } });
    renderWithProviders(<MisRQsPage />);
    expect(await screen.findByText(/no hay/i)).toBeInTheDocument();
  });

  it('deshabilita submit mientras envía el formulario', async () => {
    const user = userEvent.setup();
    api.createRequest.mockImplementation(() => new Promise(() => {}));  // nunca resuelve
    renderWithProviders(<NewRequestForm />);
    await user.click(screen.getByRole('button', { name: /crear/i }));
    expect(screen.getByRole('button', { name: /crear/i })).toBeDisabled();
  });
});
```

## Qué probar por tipo
- **Páginas de lista**: loading → datos, error, empty.
- **Formularios**: validación de campos, submit deshabilitado en vuelo, mapeo de errores 400 del backend.
- **Componentes por rol**: que las acciones no permitidas no se rendericen.
- **Hooks**: con `renderHook`.

## Checklist
- [ ] Consultas por rol/texto, no por CSS.
- [ ] Capa `api/` mockeada.
- [ ] Estados loading/error/empty cubiertos.
- [ ] Interacciones con `user-event`.
- [ ] `ToastProvider` + router vía `renderWithProviders`; `AuthContext` mockeado por test.