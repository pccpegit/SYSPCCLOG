import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function RoleRoute({
  requiredRoles = [],
  allowSuperuser = false,
  children,
  redirectTo = '/rq',
}) {
  const { isLoading, isAuthenticated, userRoles, isSuperUser } = useAuth();

  // While the session is being restored, render nothing to avoid a flash
  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // SYSPCC-018: superusers don't carry a business role, so for the routes
  // that opt in (the /admin entry points), let is_superuser stand in for
  // any required business role. Everywhere else this stays false — a
  // superadmin should NOT bypass e.g. approval-role gates in /rq.
  if (allowSuperuser && isSuperUser) {
    return children;
  }

  // Check if the user has ANY of the required roles
  const hasRole = requiredRoles.some((r) => userRoles.includes(r));

  if (!hasRole) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
