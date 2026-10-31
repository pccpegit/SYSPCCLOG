import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import ErrorBoundary from './components/ui/ErrorBoundary';
import PageLoader from './components/ui/PageLoader';
import RoleRoute from './components/auth/RoleRoute';
import SuperUserRoute from './components/auth/SuperUserRoute';
import RequirePasswordChangeLayout from './components/auth/RequirePasswordChangeLayout';
import LoginPage           from './pages/auth/LoginPage';
import SystemSelectPage    from './pages/auth/SystemSelectPage';

// SYSPCC-036 — every module/screen is loaded on demand (one chunk each), so the
// bundle needed to paint /login and the module selector stays small. Kept eager:
// login, selector, the route guards and the providers. Shells are lazy too; each
// shell wraps its <Outlet /> in <RouteOutlet /> (Suspense + ErrorBoundary).
const AppShell                   = lazy(() => import('./components/layout/AppShell'));
const WarehouseShell             = lazy(() => import('./components/layout/WarehouseShell'));
const AdminShell                 = lazy(() => import('./components/layout/AdminShell'));
const SupportShell               = lazy(() => import('./components/layout/SupportShell'));
const SupportDashboardPage       = lazy(() => import('./pages/support/SupportDashboardPage'));
const TicketCreatePage           = lazy(() => import('./pages/support/TicketCreatePage'));
const TicketListPage             = lazy(() => import('./pages/support/TicketListPage'));
const TicketDetailPage           = lazy(() => import('./pages/support/TicketDetailPage'));
const AdminMenuPage              = lazy(() => import('./pages/admin/AdminMenuPage'));
const AdminDashboardPage         = lazy(() => import('./pages/admin/AdminDashboardPage'));
const PasajesPage                = lazy(() => import('./pages/admin/PasajesPage'));
const PagosPage                  = lazy(() => import('./pages/admin/PagosPage'));
const PoliticasPage              = lazy(() => import('./pages/admin/PoliticasPage'));
const ProveedoresPage            = lazy(() => import('./pages/admin/ProveedoresPage'));
const HRShell                    = lazy(() => import('./components/layout/HRShell'));
const HRDocumentsListPage        = lazy(() => import('./pages/rrhh/HRDocumentsListPage'));
const HRDocumentCreatePage       = lazy(() => import('./pages/rrhh/HRDocumentCreatePage'));
const HRDocumentDetailPage       = lazy(() => import('./pages/rrhh/HRDocumentDetailPage'));
const HRTemplatesPage            = lazy(() => import('./pages/rrhh/HRTemplatesPage'));
const HRCVAnalysesListPage       = lazy(() => import('./pages/rrhh/HRCVAnalysesListPage'));
const HRCVWizardPage             = lazy(() => import('./pages/rrhh/HRCVWizardPage'));
const HRCVAnalysisPage           = lazy(() => import('./pages/rrhh/HRCVAnalysisPage'));
const SystemAdminShell           = lazy(() => import('./components/layout/SystemAdminShell'));
const UsersPage                  = lazy(() => import('./pages/sistema/UsersPage'));
const UserFormPage               = lazy(() => import('./pages/sistema/UserFormPage'));
const ProjectsPage               = lazy(() => import('./pages/sistema/ProjectsPage'));
const ProjectFormPage            = lazy(() => import('./pages/sistema/ProjectFormPage'));
const ChangePasswordRequiredPage = lazy(() => import('./pages/auth/ChangePasswordRequiredPage'));
const AlmacenDashboardPage       = lazy(() => import('./pages/almacen/AlmacenDashboardPage'));
const InventarioPage             = lazy(() => import('./pages/almacen/InventarioPage'));
const KardexPage                 = lazy(() => import('./pages/almacen/KardexPage'));
const EntradaPage                = lazy(() => import('./pages/almacen/EntradaPage'));
const SalidaPage                 = lazy(() => import('./pages/almacen/SalidaPage'));
const VoucherPrint               = lazy(() => import('./pages/almacen/VoucherPrint'));
const MovimientosPage            = lazy(() => import('./pages/almacen/MovimientosPage'));
const PendientesPage             = lazy(() => import('./pages/almacen/PendientesPage'));
const PickingPage                = lazy(() => import('./pages/almacen/PickingPage'));
const ResumenPage                = lazy(() => import('./pages/almacen/ResumenPage'));
const TransferenciaPage          = lazy(() => import('./pages/almacen/TransferenciaPage'));
const ImportarPage               = lazy(() => import('./pages/almacen/ImportarPage'));
const DashboardPage              = lazy(() => import('./pages/dashboard/DashboardPage'));
const RequestCreatePage          = lazy(() => import('./pages/requests/RequestCreatePage'));
const RequestListPage            = lazy(() => import('./pages/requests/RequestListPage'));
const RequestDetailPage          = lazy(() => import('./pages/requests/RequestDetailPage'));
const RequestMasterPage          = lazy(() => import('./pages/requests/RequestMasterPage'));
const ApprovalsPage              = lazy(() => import('./pages/approvals/ApprovalsPage'));
const TechReviewPage             = lazy(() => import('./pages/approvals/TechReviewPage'));
const BudgetReviewPage           = lazy(() => import('./pages/approvals/BudgetReviewPage'));
const ManagerApprovalPage        = lazy(() => import('./pages/approvals/ManagerApprovalPage'));
const QuoteCostReviewPage        = lazy(() => import('./pages/approvals/QuoteCostReviewPage'));
const CostOverrunReviewPage      = lazy(() => import('./pages/approvals/CostOverrunReviewPage'));
const LogisticsPage              = lazy(() => import('./pages/operations/LogisticsPage'));
const LogisticsActionPage        = lazy(() => import('./pages/operations/LogisticsActionPage'));
const ReportsPage                = lazy(() => import('./pages/reports/ReportsPage'));
const SettingsPage               = lazy(() => import('./pages/settings/SettingsPage'));

// Outermost boundary: covers the lazy shells (before any layout is on screen) and
// recovers when the user navigates away from a screen that failed to load.
function RoutesBoundary({ children }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary fullScreen resetKey={pathname}>
      <Suspense fallback={<PageLoader fullScreen />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
    <AuthProvider>
      <BrowserRouter>
        <RoutesBoundary>
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
            <Route path="requests/draft/:draftId" element={<RequestCreatePage />} />
            <Route path="requests/:id" element={<RequestDetailPage />} />
            <Route path="master"       element={<RequestMasterPage />} />
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
            <Route path="pendientes/:id/picking" element={<PickingPage />}    />
            <Route path="resumen"             element={<ResumenPage />}       />
            <Route
              path="transferencia"
              element={
                <RoleRoute requiredRoles={['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE']} redirectTo="/almacen">
                  <TransferenciaPage />
                </RoleRoute>
              }
            />
            <Route
              path="importar"
              element={
                <RoleRoute requiredRoles={['CENTRAL_WAREHOUSE', 'LOGISTICS_CHIEF']} redirectTo="/almacen">
                  <ImportarPage />
                </RoleRoute>
              }
            />
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

          {/* HR — /rrhh (SYSPCC-022). HR_MANAGER writes; GENERAL_MANAGER is
              read-only (write actions are hidden per page, but the backend
              is what enforces it). */}
          <Route
            path="/rrhh"
            element={
              <RoleRoute requiredRoles={['HR_MANAGER', 'GENERAL_MANAGER']} redirectTo="/">
                <HRShell />
              </RoleRoute>
            }
          >
            <Route index element={<Navigate to="documentos" replace />} />
            <Route path="documentos" element={<HRDocumentsListPage />} />
            <Route
              path="documentos/nuevo"
              element={
                <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/documentos">
                  <HRDocumentCreatePage />
                </RoleRoute>
              }
            />
            <Route
              path="documentos/:id/editar"
              element={
                <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/documentos">
                  <HRDocumentCreatePage />
                </RoleRoute>
              }
            />
            <Route path="documentos/:id" element={<HRDocumentDetailPage />} />
            {/* SYSPCC-023 — CV analysis. Writing steps are HR_MANAGER only; results are read-only for GENERAL_MANAGER. */}
            <Route path="cvs" element={<HRCVAnalysesListPage />} />
            <Route
              path="cvs/nuevo"
              element={
                <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/cvs">
                  <HRCVWizardPage />
                </RoleRoute>
              }
            />
            <Route
              path="cvs/:id/preparar"
              element={
                <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/cvs">
                  <HRCVWizardPage />
                </RoleRoute>
              }
            />
            <Route path="cvs/:id" element={<HRCVAnalysisPage />} />
            <Route
              path="plantillas"
              element={
                <RoleRoute requiredRoles={['HR_MANAGER']} redirectTo="/rrhh/documentos">
                  <HRTemplatesPage />
                </RoleRoute>
              }
            />
          </Route>

          </Route>
          {/* ^ closes RequirePasswordChangeLayout — every authenticated
              route above this line is gated on must_change_password */}

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </RoutesBoundary>
      </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}
