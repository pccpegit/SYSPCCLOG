---
name: react-testing
description: Testing del frontend React de SYSPCC con Vitest + React Testing Library. Úsalo al escribir tests de componentes, páginas, formularios o hooks. Prueba comportamiento visible al usuario y estados de carga/error, con la API mockeada. Dispara ante "test frontend", "vitest", "testing library", "prueba de componente", "render".
---

# Testing frontend — SYSPCC (Vitest + RTL)

Stack: Vite 7 → usa **Vitest** + **@testing-library/react** + `@testing-library/user-event`. Si aún no está configurado, añádelo antes de escribir tests (`vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`) y un `setupTests` con los matchers.

## Principios
1. **Prueba comportamiento, no implementación.** Consulta por rol/texto que ve el usuario (`getByRole`, `getByText`, `findByRole`), no por clases CSS ni estado interno.
2. **Mockea la capa `api/`**, no `axios` global. Así testeas el componente aislado del backend.
3. **Cubre los 3 estados**: loading, error, y datos/empty — son justo donde fallan las páginas.
4. **Interacción con `user-event`**, no `fireEvent` salvo casos puntuales.
5. Envuelve en los providers reales (AuthContext, ToastContext, Router) con un helper `renderWithProviders`.

## Patrón
```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RequestsPage from './RequestsPage';
import * as api from '../api/requests';

vi.mock('../api/requests');

function renderWithProviders(ui) {
  return render(<AuthProvider><ToastProvider><MemoryRouter>{ui}</MemoryRouter></ToastProvider></AuthProvider>);
}

describe('RequestsPage', () => {
  it('muestra los RQs cuando la carga tiene éxito', async () => {
    api.listRequests.mockResolvedValue([{ id: 1, code: 'RQ-001', title: 'Cemento' }]);
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText('RQ-001')).toBeInTheDocument();
  });

  it('muestra estado de error si la API falla', async () => {
    api.listRequests.mockRejectedValue(new Error('boom'));
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText(/no se pudieron cargar/i)).toBeInTheDocument();
  });

  it('muestra estado vacío sin datos', async () => {
    api.listRequests.mockResolvedValue([]);
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText(/no hay rqs/i)).toBeInTheDocument();
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
- [ ] Providers reales vía helper.
