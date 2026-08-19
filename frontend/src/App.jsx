import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import AppShell from './components/layout/AppShell';
import WarehouseShell from './components/layout/WarehouseShell';
import AdminShell from './components/layout/AdminShell';
import SupportShell from './components/layout/SupportShell';
import SupportDashboardPage from './pages/support/SupportDashboardPage';
import TicketCreatePage from './pages/support/TicketCreatePage';
import TicketListPage from './pages/support/TicketListPage';
import TicketDetailPage from './pages/support/TicketDetailPage';
import AdminMenuPage      from './pages/admin/AdminMenuPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import PasajesPage        from './pages/admin/PasajesPage';
import PagosPage          from './pages/admin/PagosPage';
import PoliticasPage      from './pages/admin/PoliticasPage';
import ProveedoresPage    from './pages/admin/ProveedoresPage';
import SystemAdminShell   from './components/layout/SystemAdminShell';
import UsersPage          from './pages/sistema/UsersPage';
import UserFormPage       from './pages/sistema/UserFormPage';
import ProjectsPage       from './pages/sistema/ProjectsPage';
import ProjectFormPage    from './pages/sistema/ProjectFormPage';
import RoleRoute from './components/auth/RoleRoute';
import SuperUserRoute from './components/auth/SuperUserRoute';
import RequirePasswordChangeLayout from './components/auth/RequirePasswordChangeLayout';
import ChangePasswordRequiredPage from './pages/auth/ChangePasswordRequiredPage';
import AlmacenDashboardPage from './pages/almacen/AlmacenDashboardPage';
import InventarioPage       from './pages/almacen/InventarioPage';
import KardexPage           from './pages/almacen/KardexPage';
import EntradaPage          from './pages/almacen/EntradaPage';
import SalidaPage           from './pages/almacen/SalidaPage';
import VoucherPrint         from './pages/almacen/VoucherPrint';
import MovimientosPage      from './pages/almacen/MovimientosPage';
import PendientesPage       from './pages/almacen/PendientesPage';
import LoginPage           from './pages/auth/LoginPage';
import SystemSelectPage    from './pages/auth/SystemSelectPage';
import DashboardPage       from './pages/dashboard/DashboardPage';
import RequestCreatePage   from './pages/requests/RequestCreatePage';
import RequestListPage     from './pages/requests/RequestListPage';
import RequestDetailPage   from './pages/requests/RequestDetailPage';
import ApprovalsPage       from './pages/approvals/ApprovalsPage';
import TechReviewPage      from './pages/approvals/TechReviewPage';
import BudgetReviewPage    from './pages/approvals/BudgetReviewPage';
import ManagerApprovalPage from './pages/approvals/ManagerApprovalPage';
import QuoteCostReviewPage from './pages/approvals/QuoteCostReviewPage';
import CostOverrunReviewPage from './pages/approvals/CostOverrunReviewPage';
import LogisticsPage        from './pages/operations/LogisticsPage';
import LogisticsActionPage  from './pages/operations/LogisticsActionPage';
import ReportsPage         from './pages/reports/ReportsPage';
import SettingsPage        from './pages/settings/SettingsPage';

export default function App() {
  return (
    <ToastProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />

          {/* SYSPCC-018 — forced password change, standalone: must stay
              OUTSIDE the RequirePasswordChangeLayout wrapper below, or a
              user who needs it would be redirected back to itself in a
              loop. Everything else authenticated goes inside that layout. */}
          <Route path="/cambiar-password" element={<ChangePasswordRequiredPage />} />

          <Route element={<RequirePasswordChangeLayout />}>

          {/* System selection — after login, before entering any module */}
          <Route path="/" element={<SystemSelectPage />} />

          {/* RQ System — all routes under /rq */}
          <Route path="/rq" element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="requests"     element={<RequestListPage />}   />
            <Route path="requests/new" element={<RequestCreatePage />} />
            <Route path="requests/:id" element={<RequestDetailPage />} />
            <Route path="approvals"    element={<ApprovalsPage />}     />

            <Route
              path="approvals/tech-review/:id"
              element={
                <RoleRoute requiredRoles={['PROJECT_RESIDENT']}>
                  <TechReviewPage />
                </RoleRoute>
              }
            />

            <Route
              path="approvals/budget-review/:id"
              element={
                <RoleRoute requiredRoles={['PROJECT_CONTROL', 'ADMIN_MANAGER']}>
                  <BudgetReviewPage />
                </RoleRoute>
              }
            />

            <Route
              path="approvals/quote-cost-review/:id"
              element={
                <RoleRoute requiredRoles={['PROJECT_CONTROL', 'ADMIN_MANAGER']}>
                  <QuoteCostReviewPage />
                </RoleRoute>
              }
            />

            <Route
              path="approvals/manager/:id"
              element={
                <RoleRoute requiredRoles={['GENERAL_MANAGER']}>
                  <ManagerApprovalPage />
                </RoleRoute>
              }
            />

            <Route
              path="approvals/cost-overrun/:id"
              element={
                <RoleRoute requiredRoles={['GENERAL_MANAGER']}>
                  <CostOverrunReviewPage />
                </RoleRoute>
              }
            />

            <Route
              path="reports"
              element={
                <RoleRoute requiredRoles={['GENERAL_MANAGER']}>
                  <ReportsPage />
                </RoleRoute>
              }
            />

            <Route
              path="logistics"
              element={
                <RoleRoute requiredRoles={['LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR', 'LOGISTICS']}>
                  <LogisticsPage />
                </RoleRoute>
              }
            />

            <Route
              path="logistics/:id"
              element={
                <RoleRoute requiredRoles={['LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR']}>
                  <LogisticsActionPage />
                </RoleRoute>
              }
            />

          </Route>

          {/* Warehouse System — /almacen */}
          <Route
            path="/almacen"
            element={
              <RoleRoute requiredRoles={['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE', 'LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR', 'LOGISTICS_CHIEF']} redirectTo="/">
                <WarehouseShell />
              </RoleRoute>
            }
          >
            <Route index element={<AlmacenDashboardPage />} />
            <Route path="inventario"          element={<InventarioPage />}    />
            <Route path="inventario/:id"      element={<KardexPage />}        />
            <Route path="entrada"             element={<EntradaPage />}       />
            <Route path="salida"              element={<SalidaPage />}        />
            <Route path="salida/:id/voucher"  element={<VoucherPrint />}      />
            <Route path="movimientos"         element={<MovimientosPage />}   />
            <Route path="pendientes"          element={<PendientesPage />}    />
          </Route>

          {/* Admin — module selector (full screen, no sidebar, like "/") */}
          <Route
            path="/admin"
            element={
              <RoleRoute
                requiredRoles={['ADMIN_MANAGER', 'GENERAL_MANAGER', 'PASAJES_MANAGER']}
                redirectTo="/"
              >
                <AdminMenuPage />
              </RoleRoute>
            }
          />

          {/* Admin — Pasajes module workspace (with sidebar) */}
          <Route
            path="/admin"
            element={
              <RoleRoute
                requiredRoles={['ADMIN_MANAGER', 'GENERAL_MANAGER', 'PASAJES_MANAGER']}
                redirectTo="/"
              >
                <AdminShell />
              </RoleRoute>
            }
          >
            <Route path="dashboard"   element={<AdminDashboardPage />} />
            <Route path="pasajes"     element={<PasajesPage />}     />
            <Route path="pagos"       element={<PagosPage />}       />
            <Route path="politicas"   element={<PoliticasPage />}   />
            <Route path="proveedores" element={<ProveedoresPage />} />
          </Route>

          {/* Administración del Sistema — /sistema, exclusive to Django
              is_superuser (no business SUPERADMIN role exists). Separate
              module from /admin (business admin: Pasajes/Pagos/etc.) — the
              whole shell is gated by a single SuperUserRoute, so pages
              underneath don't need their own per-route guard. */}
          <Route
            path="/sistema"
            element={
              <SuperUserRoute>
                <SystemAdminShell />
              </SuperUserRoute>
            }
          >
            <Route index element={<Navigate to="usuarios" replace />} />
            <Route path="usuarios"        element={<UsersPage />} />
            <Route path="usuarios/nuevo"  element={<UserFormPage />} />
            <Route path="usuarios/:id"    element={<UserFormPage />} />
            <Route path="proyectos"       element={<ProjectsPage />} />
            <Route path="proyectos/nuevo" element={<ProjectFormPage />} />
            <Route path="proyectos/:id"   element={<ProjectFormPage />} />
          </Route>

          {/* Support System — /soporte */}
          <Route path="/soporte" element={<SupportShell />}>
            <Route index element={<TicketCreatePage />} />
            <Route path="dashboard"     element={<SupportDashboardPage />} />
            <Route path="tickets"       element={<TicketListPage />}     />
            <Route path="tickets/:id"   element={<TicketDetailPage />}   />
          </Route>

          {/* Settings — standalone, not tied to any module */}
          <Route path="/settings" element={<SettingsPage />} />

          {/* Future systems placeholder */}
          {/* <Route path="/rrhh" element={<RRHHShell />} /> */}

          </Route>
          {/* ^ closes RequirePasswordChangeLayout — every authenticated
              route above this line is gated on must_change_password */}

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
  );
}
