import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * SYSPCC-018: strict gate for pages that require Django `is_superuser` —
 * the Usuarios/Proyectos admin pages. There is no business-level
 * SUPERADMIN role in RoleChoices, so this checks the raw superuser flag
 * directly instead of going through RoleRoute's role-list matching.
 *
 * The backend enforces the same rule independently (`IsSuperUser`
 * permission on every write action of UserViewSet/ProjectViewSet) — this
 * guard is UX only, hiding the page shell, not a security boundary.
 */
export default function SuperUserRoute({ children, redirectTo = '/admin' }) {
  const { isLoading, isAuthenticated, isSuperUser } = useAuth();

  // While the session is being restored, render nothing to avoid a flash
  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperUser) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
