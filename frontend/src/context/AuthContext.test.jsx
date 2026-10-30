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

    const { AuthProvider } = await import('./AuthContext');

    const { useAuth } = await import('./useAuth');
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

    const { AuthProvider } = await import('./AuthContext');

    const { useAuth } = await import('./useAuth');
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

// SYSPCC-034 — restoreSession: /users/me/ está excluido del refresh del
// interceptor, así que AuthContext debe intentar UNA renovación (refresh por
// cookie HttpOnly) cuando getMe() da 401 al recargar con la cookie de acceso
// ya expirada pero el refresh_token vigente.
describe('AuthContext — restauración de sesión con refresh (SYSPCC-034)', () => {
  const unauthorized = () => ({ response: { status: 401 } });
  const me = { data: { id: 7, username: 'ana', user_roles: [{ role: 'REQUESTER', is_primary: true }] } };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function mountProvider(authApi) {
    authApi.bootstrapCsrf.mockResolvedValue({});
    const { AuthProvider } = await import('./AuthContext');
    const { useAuth } = await import('./useAuth');
    const hook = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    return hook;
  }

  it('getMe 401 -> refresh OK -> getMe OK: restaura al usuario', async () => {
    const authApi = await import('../api/auth');
    authApi.getMe.mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(me);
    authApi.refreshSession.mockResolvedValue(undefined);

    const { result } = await mountProvider(authApi);

    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
    expect(authApi.getMe).toHaveBeenCalledTimes(2);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.currentUser.username).toBe('ana');
    expect(result.current.userRoles).toEqual(['REQUESTER']);
  });

  it('espera la cookie CSRF antes de refrescar (el refresh es un POST)', async () => {
    const authApi = await import('../api/auth');
    const order = [];
    authApi.bootstrapCsrf.mockImplementation(async () => {
      order.push('csrf');
    });
    authApi.getMe.mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(me);
    authApi.refreshSession.mockImplementation(async () => {
      order.push('refresh');
    });

    const { AuthProvider } = await import('./AuthContext');

    const { useAuth } = await import('./useAuth');
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(order).toEqual(['csrf', 'refresh']);
  });

  it('getMe 401 -> refresh 401: queda sin sesión y no reintenta', async () => {
    const authApi = await import('../api/auth');
    authApi.getMe.mockRejectedValue(unauthorized());
    authApi.refreshSession.mockRejectedValue(unauthorized());

    const { result } = await mountProvider(authApi);

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.currentUser).toBeNull();
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
    expect(authApi.getMe).toHaveBeenCalledTimes(1);
  });

  it('getMe 401 -> refresh OK -> getMe 401 otra vez: sin sesión, sin bucle', async () => {
    const authApi = await import('../api/auth');
    authApi.getMe.mockRejectedValue(unauthorized());
    authApi.refreshSession.mockResolvedValue(undefined);

    const { result } = await mountProvider(authApi);

    expect(result.current.isAuthenticated).toBe(false);
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
    expect(authApi.getMe).toHaveBeenCalledTimes(2);
  });

  it('getMe OK: no llama al refresh', async () => {
    const authApi = await import('../api/auth');
    authApi.getMe.mockResolvedValue(me);

    const { result } = await mountProvider(authApi);

    expect(result.current.isAuthenticated).toBe(true);
    expect(authApi.refreshSession).not.toHaveBeenCalled();
    expect(authApi.getMe).toHaveBeenCalledTimes(1);
  });

  it('un error distinto de 401 (p. ej. 500) no dispara refresh', async () => {
    const authApi = await import('../api/auth');
    authApi.getMe.mockRejectedValue({ response: { status: 500 } });

    const { result } = await mountProvider(authApi);

    expect(result.current.isAuthenticated).toBe(false);
    expect(authApi.refreshSession).not.toHaveBeenCalled();
  });
});
