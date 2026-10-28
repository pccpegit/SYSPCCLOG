import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authApi from '../api/auth';

const AuthContext = createContext(null);

// ─── CSRF bootstrap ─────────────────────────────────────────────────────────
// Module-level singleton (not component state) so it survives StrictMode's
// double-mount in dev and is shared by every AuthProvider instance: the GET
// /auth/csrf/ call fires exactly once per page load, as soon as this module
// is evaluated — well before the login page can be submitted — and every
// caller (restoreSession below, or login()) can `await` the same promise to
// guarantee the csrftoken cookie exists before the first mutating request.
let csrfReadyPromise = null;
function ensureCsrfReady() {
  if (!csrfReadyPromise) {
    csrfReadyPromise = authApi.bootstrapCsrf().catch((err) => {
      // Don't poison the singleton on failure — let a later caller retry
      // (e.g. transient network error before the backend is reachable).
      csrfReadyPromise = null;
      throw err;
    });
  }
  return csrfReadyPromise;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading]     = useState(true);

  // Normalize user object — /users/me/ returns `user_roles`, login returns `roles`
  function normalizeUser(user) {
    if (!user) return null;
    const roles = user.roles ?? user.user_roles ?? [];
    return { ...user, roles };
  }

  // ─── Restore session on app load ───────────────────────────────────────────
  useEffect(() => {
    // Fire-and-forget here: getMe() is a GET and doesn't need the CSRF
    // cookie, but kicking this off on mount means it's almost always
    // settled by the time a user finishes typing their credentials.
    ensureCsrfReady().catch(() => {
      // Swallowed — login() below awaits the same promise and will
      // surface a fresh attempt/error at submit time if this one failed.
    });

    const restoreSession = async () => {
      try {
        const { data: user } = await authApi.getMe();
        setCurrentUser(normalizeUser(user));
      } catch {
        setCurrentUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    restoreSession();
  }, []);

  // ─── Login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async (username, password) => {
    // Guarantee the csrftoken cookie is set before this mutating request —
    // if the mount-time bootstrap is still in flight (or failed), this
    // awaits/retries it instead of racing the login POST against it.
    await ensureCsrfReady();
    const { data } = await authApi.login(username, password);
    const raw = data.user ?? (await authApi.getMe()).data;
    const user = normalizeUser(raw);
    setCurrentUser(user);
    return user;
  }, []);

  // ─── Logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore API errors — always clear local state
    } finally {
      setCurrentUser(null);
    }
  }, []);

  // ─── Switch role (demo/testing helper) ───────────────────────────────────────
  const switchRole = useCallback((user) => {
    setCurrentUser(user);
  }, []);

  // ─── Role helpers ────────────────────────────────────────────────────────────
  // The API returns currentUser.roles as an array of role objects:
  // [{ role: 'REQUESTER', project: 5, department_obj: null, is_primary: true }]
  //
  // primaryRole  — string of the primary role (e.g. 'REQUESTER')
  // userRoles    — array of role strings
  // hasRole(r)   — true if user holds the given role

  const primaryRole = currentUser?.roles?.find((r) => r.is_primary)?.role
    ?? currentUser?.roles?.[0]?.role
    ?? null;

  const userRoles = (currentUser?.roles ?? []).map((r) => r.role);

  const hasRole = useCallback(
    (role) => userRoles.includes(role),
    [userRoles]
  );

  // SYSPCC-018: derived from the `is_superuser` flag the backend now sends
  // both at login and on /users/me/ — gates the admin-only Usuarios/
  // Proyectos pages. There is no business-level SUPERADMIN role.
  const isSuperUser = !!currentUser?.is_superuser;

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        isLoading,
        login,
        logout,
        switchRole,
        primaryRole,
        userRoles,
        hasRole,
        isSuperUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
