import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../context/ToastContext';

/**
 * SYSPCC-018 test helper — wraps a UI tree in the REAL `ToastProvider` (no
 * network calls, safe to use unmocked — success/error toasts become
 * assertable via `screen.findByText`) and a `MemoryRouter`.
 *
 * `AuthContext` is deliberately NOT wrapped here: every page/guard under
 * test in this module calls `useAuth()` directly, and each test mocks
 * `../../context/AuthContext` (`vi.mock` + `useAuth.mockReturnValue(...)`)
 * to control `currentUser`/`isSuperUser`/etc. per case, instead of driving
 * the real provider's CSRF-bootstrap/`getMe` side effects for every test.
 */
export function renderWithProviders(ui, { route = '/', initialEntries } = {}) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={initialEntries ?? [route]}>{ui}</MemoryRouter>
    </ToastProvider>,
  );
}
