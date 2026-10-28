import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * SYSPCC-018: layout route wrapping every authenticated route EXCEPT
 * `/login` and `/cambiar-password` itself (wrapping the latter would loop).
 *
 * Forces a user with `must_change_password: true` — set on the backend
 * when an admin creates their account or resets their password — through
 * the forced-change screen before they can reach anything else in the app,
 * no matter which authenticated route they land on first.
 *
 * This is UX routing, not the security boundary: the backend blocks every
 * request outside a small allowlist while the flag is set (see
 * `CookieJWTAuthentication.authenticate()`), and `api/client.js`'s response
 * interceptor redirects here too as a defense-in-depth fallback if this
 * layout is ever bypassed (e.g. a stale tab).
 */
export default function RequirePasswordChangeLayout() {
  const { isLoading, isAuthenticated, currentUser } = useAuth();

  // While the session is being restored, render nothing to avoid a flash
  if (isLoading) return null;

  if (isAuthenticated && currentUser?.must_change_password) {
    return <Navigate to="/cambiar-password" replace />;
  }

  return <Outlet />;
}
