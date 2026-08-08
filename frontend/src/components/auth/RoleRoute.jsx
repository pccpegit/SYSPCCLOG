import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function RoleRoute({
  requiredRoles = [],
  children,
  redirectTo = '/rq',
}) {
  const { isLoading, isAuthenticated, userRoles } = useAuth();

  // While the session is being restored, render nothing to avoid a flash
  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check if the user has ANY of the required roles
  const hasRole = requiredRoles.some((r) => userRoles.includes(r));

  if (!hasRole) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
