import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authApi from '../api/auth';

const AuthContext = createContext(null);

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
