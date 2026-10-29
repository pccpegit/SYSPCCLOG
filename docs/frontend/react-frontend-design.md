# SYSPCC — Diseño del Frontend React

**Stack:** React 19.2 + React Router 7.13 + Axios 1.7 + Tailwind CSS 4.2 + Vite 7.3 (pruebas con Vitest 3.2)
**Fecha:** 2026-10-29 (actualizado al código de `develop`)

Este documento describe `frontend/` tal como está. Las rutas salen de `frontend/src/App.jsx`; las constantes de roles, estados y fases, de `frontend/src/data/constants.js`.

---

## 1. Navegación y shells

Tras iniciar sesión el usuario llega al **selector de módulos** (`/`, `SystemSelectPage`), que muestra solo las tarjetas que sus roles permiten. Cada módulo tiene su propio shell (layout con `Header`, sidebar propio y `<Outlet/>`).

| Módulo | Ruta | Shell | Sidebar | Color de acento |
|--------|------|-------|---------|-----------------|
| Requerimientos | `/rq` | `AppShell` | `Sidebar` | azul |
| Almacén | `/almacen` | `WarehouseShell` | `WarehouseSidebar` | esmeralda |
| Administración (pasajes) | `/admin` | `AdminShell` (menú previo `AdminMenuPage`) | `AdminSidebar` | índigo |
| Administración del Sistema | `/sistema` | `SystemAdminShell` | `SystemSidebar` | rosa |
| Recursos Humanos | `/rrhh` | `HRShell` | `HRSidebar` | violeta |
| Soporte TI | `/soporte` | `SupportShell` | `SupportSidebar` | teal |

Rutas sin shell: `/login`, `/cambiar-password`, `/settings` (perfil, contraseña, firma, tema y conexión a OneDrive).

### 1.1 Layout común

```
+------------------------------------------------------------------+
| [☰]                        [Campana] [Tema] | Usuario · Rol  [⏻] |   ← Header
+------------+-----------------------------------------------------+
|            |                                                     |
|  Sidebar   |  <Outlet/>  (página activa)                         |
|  del       |                                                     |
|  módulo    |                                                     |
|            |                                                     |
+------------+-----------------------------------------------------+
```

- `Header` es compartido por todos los shells: muestra el rol primario (`ROLE_LABELS`), el botón de tema (`ThemeToggleButton`) y el cierre de sesión. El ícono de campana es estático: hoy ninguna página consume `api/notifications.js`.
- Cada shell redirige a `/login` si no hay sesión.

### 1.2 Selector de módulos (`SystemSelectPage`)

| Tarjeta | Ruta | Visible para |
|---------|------|--------------|
| Requerimientos | `/rq` | Todos |
| Almacén | `/almacen` | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE`, `LOGISTICS_COORDINATOR`, `LOGISTICS_SUPERVISOR`, `LOGISTICS_CHIEF` |
| Soporte TI | `/soporte` | Todos |
| Recursos Humanos | `/rrhh` | `HR_MANAGER`, `GENERAL_MANAGER` |
| Business Intelligence | `/bi` | Se muestra como no disponible |
| Administración | `/admin` | `ADMIN_MANAGER`, `GENERAL_MANAGER`, `PASAJES_MANAGER` |
| Administración del Sistema | `/sistema` | `is_superuser` |

---

## 2. Creación de RQ (`/rq/requests/new`, `RequestCreatePage`)

- **Destino:** un proyecto (flujo `OPERATIONS`) o un departamento (flujo `ADMINISTRATIVE`). El frente `OFICINA CENTRAL` usa el flujo administrativo con el departamento de código `ADM` (SYSPCC-019).
- **Cabecera:** área solicitante (`REQUESTING_AREAS`: OP, QC, HSE, ADM), frente, servicio, uso específico, tipo de pedido (`acquisition_type`) y fecha de necesidad. La prioridad se envía como `NORMAL`.
- **Ítems:** cada línea se elige del catálogo del almacén (`CatalogCombobox` → `GET /request-catalog/?search=`) o se marca **fuera de catálogo** con descripción propia; la **fuente** (`ITEM_SOURCES`) se propone según la categoría del producto y se puede corregir. Máximo `MAX_REQUEST_ITEMS` = 200 líneas. El solicitante nunca envía `supply_source` (lo define logística).
- **Envío:** `POST /requests/`. El backend crea el RQ ya en `SUBMITTED` (no hay borrador editable) y genera el número `RQ-YYYY-NNNN`. Al enviar, la página descarga el RQ en Excel con ExcelJS (`utils/exportRQ.js`).
- Los errores por campo del servidor se mapean a la fila del formulario (`utils/apiErrors.js`).

---

## 3. Pantallas de aprobación

Todas usan `getRequest` / `getApprovals` y ejecutan la acción con `performAction(id, { action, acting_role, comments, extra_data })`.

| Ruta | Página | Roles (`RoleRoute`) | Acciones que envía |
|------|--------|---------------------|--------------------|
| `/rq/approvals` | `ApprovalsPage` | — | Bandeja de pendientes |
| `/rq/approvals/tech-review/:id` | `TechReviewPage` | `PROJECT_RESIDENT` | `TECHNICAL_APPROVED` / `TECHNICAL_REJECTED` (la página también contempla `SUPERVISOR_APPROVED` / `SUPERVISOR_REJECTED`, pero la ruta solo admite `PROJECT_RESIDENT`) |
| `/rq/approvals/budget-review/:id` | `BudgetReviewPage` | `PROJECT_CONTROL`, `ADMIN_MANAGER` | OPS: `BUDGET_CLASSIFIED` / `BUDGET_REJECTED`; ADM: `ADMIN_BUDGET_REVIEWED` / `ADMIN_BUDGET_REJECTED` |
| `/rq/approvals/quote-cost-review/:id` | `QuoteCostReviewPage` | `PROJECT_CONTROL`, `ADMIN_MANAGER` | `QUOTE_COST_APPROVED` / `QUOTE_COST_REJECTED` (pasa a sobrecosto) |
| `/rq/approvals/manager/:id` | `ManagerApprovalPage` | `GENERAL_MANAGER` | `GM_APPROVED` / `GM_REJECTED` |
| `/rq/approvals/cost-overrun/:id` | `CostOverrunReviewPage` | `GENERAL_MANAGER` | `COST_OVERRUN_APPROVED` / `COST_OVERRUN_REJECTED` |
| `/rq/logistics`, `/rq/logistics/:id` | `LogisticsPage`, `LogisticsActionPage` | `LOGISTICS_COORDINATOR`, `LOGISTICS_SUPERVISOR` | `STOCK_CHECKED`, `QUOTE_REQUESTED`, `QUOTE_COMPARED`, `QUOTE_SELECTED`, `PO_GENERATED`, `RECEIVED`, `QUALITY_APPROVED` / `QUALITY_REJECTED`, `DISPATCHED`, `SUPPLIER_CLAIM_SENT` / `SUPPLIER_CLAIM_UPDATED` / `SUPPLIER_REPLACEMENT_RECEIVED`, `CLOSED` |

En la verificación de stock, `StockCheckPanel` muestra por línea la cobertura contra el pool central (`GET /requests/{id}/stock-availability/`, con `CoverageBadge`) y permite a logística confirmar el producto o marcar fuera de catálogo (`PATCH /requests/{id}/update-items/`).

La ruta `/rq/logistics` también lista en `requiredRoles` la cadena `'LOGISTICS'`, que no existe en `RoleChoices`; no otorga acceso a nadie.

Las acciones del almacén sobre un RQ (`DISPATCHED` desde `IN_STOCK`, `WAREHOUSE_RECORDS_UPDATED`) se ofrecen en el modal de `/almacen/pendientes` (`PendientesPage`). Ese modal lee `actions` de la respuesta de `available-actions/` (el backend devuelve la clave `available_actions`) y llama a `performAction` sin `acting_role`, que el backend exige (`CanPerformWorkflowAction`). `pages/operations/WarehouseActionPage.jsx` existe pero no tiene ruta en `App.jsx`.

---

## 4. Seguimiento del RQ

### 4.1 Lista (`/rq/requests`, `RequestListPage`)
Consulta `GET /requests/` con filtros; el backend devuelve solo los RQ que el usuario puede ver (`get_accessible_requests_queryset`).

### 4.2 Detalle (`/rq/requests/:id`, `RequestDetailPage`)
Muestra cabecera, ítems (`ItemProductCell` indica producto vinculado o fuera de catálogo), `LifecycleBar`, `ApprovalChain` (historial de `Approval`) y `ActivityLog`. Desde aquí el solicitante da conformidad o reclama (`acting_role: REQUESTER`).

### 4.3 Badges de estado
`StatusBadge` toma etiqueta y colores de `STATUS_CONFIG` (`data/constants.js`); si un estado no está en el mapa, muestra el código en gris. `PriorityBadge` usa `PRIORITY_CONFIG` (`URGENT`, `HIGH`, `NORMAL`, `LOW`).

### 4.4 Fases de `LifecycleBar` (`LIFECYCLE_PHASES`)

```
1 Solicitud    -> DRAFT, SUBMITTED
2 Validación   -> estados técnicos/presupuestales de OPS y ADM, GM_*, VALIDATED
3 Adquisición  -> STOCK_CHECK, IN_STOCK, REQUIRES_PURCHASE, QUOTING, QUOTE_COMPARISON,
                  QUOTE_SELECTED, COST_OVERRUN_*, PO_GENERATED
4 Entrega      -> RECEIVING, QUALITY_*, RECEPTION_*, DISPATCHED_TO_SITE, DELIVERED, WAREHOUSE_UPDATED
5 Cierre       -> USER_CONFORMITY, USER_CLAIM, CLAIM_IN_REVIEW, CLAIM_RESOLVED, CLOSED
```

`getPhaseForStatus('CANCELLED')` devuelve `-1`. Los estados del ciclo de reclamo al proveedor (`SUPPLIER_CLAIM_*`, `SUPPLIER_REPLACEMENT_RECEIVED`) y `QUOTE_COST_APPROVED` no figuran en ninguna fase, por lo que la barra no los ubica.

---

## 5. Estructura del proyecto React

```
frontend/
├── index.html                 # script anti-FOUC del tema (lee 'syspcc.theme.v1')
├── vite.config.js             # React + Tailwind; proxy /api y /media al backend
├── vitest.config.js           # jsdom, setup en src/test/setup.js
└── src/
    ├── main.jsx · App.jsx · index.css
    ├── api/
    │   ├── client.js          # instancia Axios, CSRF, interceptor 401
    │   ├── config.js          # API_BASE_URL, BACKEND_URL
    │   ├── auth.js · users.js · core.js · projects.js
    │   ├── requests.js · workflow.js · suppliers.js · claims.js · notifications.js
    │   ├── almacen.js · almacenImport.js · warehouse.js
    │   ├── administracion.js · hr.js · support.js
    │   └── index.js
    ├── context/
    │   ├── AuthContext.jsx    # sesión, roles, login/logout
    │   ├── ToastContext.jsx   # avisos
    │   └── ThemeContext.jsx   # tema claro/oscuro/automático
    ├── components/
    │   ├── layout/            # *Shell.jsx, *Sidebar.jsx, Header.jsx
    │   ├── auth/              # RoleRoute, SuperUserRoute, RequirePasswordChangeLayout
    │   ├── requests/          # CatalogCombobox, StockCheckPanel, CoverageBadge, ItemProductCell,
    │   │                      # ApprovalChain, ActivityLog, LifecycleBar
    │   ├── almacen/           # ItemCombobox, WorkerCombobox, LocationPicker, AssignLocationModal,
    │   │                      # ItemFormModal, importer/ (UploadStep, ReviewStep, ConfirmStep, ...)
    │   ├── rrhh/              # ContractForm, AssistantPanel, WorkerPicker, cv/ (wizard y resultados)
    │   ├── sistema/           # TemporaryPasswordModal
    │   └── ui/                # StatusBadge, PriorityBadge, SummaryCard, ConfirmModal,
    │                          # NumberInput, NotesField, ThemeToggleButton
    ├── pages/
    │   ├── auth/              # LoginPage, SystemSelectPage, ChangePasswordRequiredPage
    │   ├── dashboard/         # DashboardPage
    │   ├── requests/          # RequestListPage, RequestCreatePage, RequestDetailPage
    │   ├── approvals/         # ApprovalsPage, TechReview, BudgetReview, QuoteCostReview,
    │   │                      # ManagerApproval, CostOverrunReview
    │   ├── operations/        # LogisticsPage, LogisticsActionPage (y WarehousePage /
    │   │                      # WarehouseActionPage, sin ruta en App.jsx)
    │   ├── almacen/           # Dashboard, Inventario, Kardex, Entrada, Salida, VoucherPrint,
    │   │                      # Movimientos, Pendientes, Resumen, Transferencia, Importar
    │   ├── admin/             # AdminMenu, AdminDashboard, Pasajes, Pagos, Politicas, Proveedores
    │   ├── sistema/           # UsersPage, UserFormPage, ProjectsPage, ProjectFormPage
    │   ├── rrhh/              # HRDocumentsList/Create/Detail, HRTemplates, HRCVAnalysesList,
    │   │                      # HRCVWizard, HRCVAnalysis
    │   ├── support/           # SupportDashboard, TicketCreate, TicketList, TicketDetail
    │   ├── reports/           # ReportsPage
    │   └── settings/          # SettingsPage
    ├── hooks/                 # useApi, useCV*, useFileDownload, useMediaQuery, ...
    ├── utils/                 # format, exportRQ, stockCheck, almacen*, cv*, theme, ...
    ├── data/                  # constants.js, requestCapture.js, almacenConstants.js, almacenRoles.js, ...
    └── test/                  # setup.js, renderWithProviders.jsx, fixtures
```

---

## 6. Jerarquía de componentes

### 6.1 Árbol raíz (`App.jsx`)

```
ThemeProvider
  ToastProvider
    AuthProvider
      BrowserRouter
        Routes
          /login                       LoginPage
          /cambiar-password            ChangePasswordRequiredPage
          RequirePasswordChangeLayout  (redirige a /cambiar-password si must_change_password)
            /                          SystemSelectPage
            /rq          AppShell          → páginas de RQ, aprobaciones, logística, reportes
            /almacen     RoleRoute → WarehouseShell → páginas de almacén
            /admin       RoleRoute → AdminMenuPage  |  AdminShell → pasajes, pagos, políticas, proveedores
            /sistema     SuperUserRoute → SystemAdminShell → usuarios, proyectos
            /soporte     SupportShell      → tickets
            /settings    SettingsPage
            /rrhh        RoleRoute → HRShell → documentos, plantillas, cvs
          *                            Navigate → /
```

### 6.2 Almacén (`/almacen`)

| Ruta | Página | Restricción adicional |
|------|--------|-----------------------|
| `/almacen` | `AlmacenDashboardPage` | — |
| `inventario`, `inventario/:id` | `InventarioPage`, `KardexPage` | — |
| `resumen` | `ResumenPage` (resumen de movimiento / kardex) | — |
| `pendientes` | `PendientesPage` (RQ pendientes) | — |
| `entrada` | `EntradaPage` (ingreso de material) | — |
| `salida`, `salida/:id/voucher` | `SalidaPage` (entrega/egreso, incluida la entrega de EPP con vale), `VoucherPrint` | — |
| `movimientos` | `MovimientosPage` | — |
| `transferencia` | `TransferenciaPage` | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE` |
| `importar` | `ImportarPage` (importación del Excel en dos pasos) | `CENTRAL_WAREHOUSE`, `LOGISTICS_CHIEF` |

### 6.3 RR. HH. (`/rrhh`)

`documentos` (lista, `nuevo`, `:id`, `:id/editar`), `plantillas`, `cvs` (lista, `nuevo`, `:id/preparar`, `:id`). Las rutas de escritura exigen `HR_MANAGER`; `GENERAL_MANAGER` entra en modo lectura. La autorización real la hace el backend.

---

## 7. Estado e integración con la API

### 7.1 Autenticación (JWT en cookies)

```
Arranque de la app:
  AuthContext → GET /auth/csrf/                (cookie csrftoken, legible por JS)
             → GET /users/me/                  (restaura la sesión si hay cookie access_token)

Login:
  LoginPage → authApi.login(username, password)
            → POST /auth/login/  con header X-CSRFToken
            → el backend fija access_token (15 min) y refresh_token (1 día), httpOnly
            → el cuerpo trae el perfil (roles, is_superuser, must_change_password)
            → los tokens nunca llegan a JavaScript

Peticiones:
  client.js añade X-CSRFToken en POST/PUT/PATCH/DELETE
  403 con code 'must_change_password' → redirige a /cambiar-password
  401 → un único POST /auth/token/refresh/ (los 401 concurrentes esperan en cola) → reintento
```

Limitación conocida: `/auth/token/refresh/` es el `TokenRefreshView` estándar de SimpleJWT y lee `refresh` del cuerpo, mientras que el cliente envía `{}` (el refresh token está en una cookie httpOnly). Por eso el refresco silencioso no renueva la sesión: el refresh responde con error y la petición original se rechaza. La brecha está documentada en `backend/apps/core/tests/test_must_change_password_gate.py`.

### 7.2 Capa de API

```javascript
// src/api/client.js
const client = axios.create({
  baseURL: API_BASE_URL,            // VITE_API_URL ?? 'http://localhost:8000/api/v1/'
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});
client.interceptors.request.use(attachCsrfToken);
```

```javascript
// src/api/requests.js (extracto)
getRequests(params)              // GET  /requests/
getRequest(id)                   // GET  /requests/{id}/
createRequest(data)              // POST /requests/
performAction(id, actionData)    // POST /requests/{id}/action/
getAvailableActions(id)          // GET  /requests/{id}/available-actions/
getApprovals(id) · getActivity(id) · getAttachments(id)
updateRequestItems(id, decisions)// PATCH /requests/{id}/update-items/
getStockAvailability(id)         // GET  /requests/{id}/stock-availability/ (timeout 15 s)
searchRequestCatalog(search, { page, signal })  // GET /request-catalog/
```

En desarrollo, `vite.config.js` reenvía `/api` y `/media` al backend (`VITE_BACKEND_PROXY_TARGET` o `http://localhost:8000`).

### 7.3 Renderizado por rol

```javascript
// src/context/AuthContext.jsx (valores expuestos)
currentUser, isAuthenticated, isLoading,
primaryRole,      // rol con is_primary
userRoles,        // array de códigos de rol
isSuperUser,      // currentUser.is_superuser
login, logout
```

- `RoleRoute requiredRoles={[...]} redirectTo=...`: deja pasar si el usuario tiene **alguno** de los roles; si no, redirige (por defecto a `/rq`).
- `SuperUserRoute`: solo `is_superuser`.
- Las páginas de aprobación envían `acting_role` (rol primario o un rol fijo según la página); el backend vuelve a verificar que el usuario tenga ese rol.

### 7.4 Resumen del manejo de estado

| Aspecto | Enfoque | Ubicación |
|---------|---------|-----------|
| Sesión y roles | React Context | `context/AuthContext.jsx` |
| Avisos | React Context | `context/ToastContext.jsx` |
| Tema | React Context + `localStorage` (`syspcc.theme.v1`) | `context/ThemeContext.jsx`, `utils/theme.js` |
| Datos del servidor | `useState` + `useEffect` por página; hook genérico `useApi` | `pages/*`, `hooks/useApi.js` |
| Formularios | `useState` local | Páginas |
| Parámetros en URL | `useSearchParams` | Algunas páginas (`InventarioPage`, `EntradaPage`, páginas de CVs) |

No se usa Redux ni librerías de caché de datos.

---

## 8. Tema claro/oscuro (SYSPCC-020)

- Modos: `light`, `dark` y `auto` (por defecto `auto`, oscuro de 19:00 a 07:00, rango configurable en `/settings`).
- `ThemeContext` aplica la clase `.dark` en `<html>`; un script en `index.html` aplica el tema antes de montar React para evitar el parpadeo.
- `index.css` define la variante `@custom-variant dark (&:where(.dark, .dark *))`, los tokens de color en `@theme` (`--color-app-bg`, `--color-surface`, `--color-text-primary`, ...) y una capa que remapea `bg-white`, `bg-gray-*`, `text-gray-*` y `border-gray-*` cuando `.dark` está activo.

---

## 9. Pruebas

- `npm test` ejecuta `vitest run` (entorno jsdom, `src/test/setup.js`).
- Las pruebas de componentes usan Testing Library y `src/test/renderWithProviders.jsx`; la API se mockea.
- Hay archivos `*.contract.test.js` en `src/api/` que verifican los contratos con el backend.

---

## Apéndice: convenciones de estilo

- Tipografías definidas en `@theme`: `--font-display` (Urbanist) y `--font-body` (Figtree).
- Superficies y textos neutros se escriben con utilidades Tailwind estándar (`bg-white`, `bg-gray-50`, `text-gray-700`, `border-gray-200`); el modo oscuro las remapea vía tokens, sin clases `dark:` en cada componente.
- Los colores saturados o semánticos (badges de rol, toasts) llevan clases `dark:` explícitas.
- Íconos: Lucide React.
