import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// SYSPCC-015 — the CSRF bootstrap (GET /auth/csrf/) must fire on app mount
// and `login()` must await it, so the login POST never races the cookie.
//
// `vi.resetModules()` + dynamic import in each test gives AuthContext.jsx a
// fresh copy of its module-level `csrfReadyPromise` singleton per test —
// otherwise the promise cached by the first test would still be "resolved"
// in the second one and the ordering assertion below would be meaningless.
vi.mock('../api/auth');

describe('AuthContext — CSRF bootstrap integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('dispara bootstrapCsrf al montar el AuthProvider', async () => {
    const authApi = await import('../api/auth');
    authApi.bootstrapCsrf.mockResolvedValue({});
    authApi.getMe.mockRejectedValue({ response: { status: 401 } });

    const { AuthProvider, useAuth } = await import('./AuthContext');
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });

    await waitFor(() => expect(authApi.bootstrapCsrf).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('login() espera a que la cookie CSRF esté lista antes de hacer el POST de login', async () => {
    const authApi = await import('../api/auth');
    authApi.getMe.mockRejectedValue({ response: { status: 401 } });

    const callOrder = [];
    let resolveCsrfBootstrap;
    authApi.bootstrapCsrf.mockReturnValue(
      new Promise((resolve) => {
        resolveCsrfBootstrap = resolve;
      }).then(() => {
        callOrder.push('csrf-ready');
      }),
    );
    authApi.login.mockImplementation(async () => {
      callOrder.push('login-post');
      return { data: { user: { id: 1, username: 'demo', roles: [] } } };
    });

    const { AuthProvider, useAuth } = await import('./AuthContext');
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });

    let loginPromise;
    act(() => {
      loginPromise = result.current.login('demo', 'secret');
    });

    // The CSRF bootstrap triggered by mount is still pending — login must
    // not have issued its POST yet, or it would race an unset cookie.
    expect(authApi.login).not.toHaveBeenCalled();

    resolveCsrfBootstrap();
    await act(async () => {
      await loginPromise;
    });

    expect(callOrder).toEqual(['csrf-ready', 'login-post']);
    expect(authApi.login).toHaveBeenCalledWith('demo', 'secret');
  });
});
