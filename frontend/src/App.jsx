import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import AppShell from './components/layout/AppShell';
import RoleRoute from './components/auth/RoleRoute';
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
import LogisticsPage        from './pages/operations/LogisticsPage';
import LogisticsActionPage  from './pages/operations/LogisticsActionPage';
import WarehousePage        from './pages/operations/WarehousePage';
import WarehouseActionPage  from './pages/operations/WarehouseActionPage';
import ReportsPage         from './pages/reports/ReportsPage';

export default function App() {
  return (
    <ToastProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />

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
              path="approvals/manager/:id"
              element={
                <RoleRoute requiredRoles={['GENERAL_MANAGER']}>
                  <ManagerApprovalPage />
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

            <Route
              path="warehouse"
              element={
                <RoleRoute requiredRoles={['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE']}>
                  <WarehousePage />
                </RoleRoute>
              }
            />

            <Route
              path="warehouse/:id"
              element={
                <RoleRoute requiredRoles={['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE']}>
                  <WarehouseActionPage />
                </RoleRoute>
              }
            />
          </Route>

          {/* Future systems placeholder */}
          {/* <Route path="/warehouse-system" element={<WarehouseSystemShell />} /> */}
          {/* <Route path="/rrhh" element={<RRHHShell />} /> */}

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
  );
}
