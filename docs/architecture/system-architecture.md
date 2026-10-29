# SYSPCC — Arquitectura del Sistema

**Proyecto:** Sistema de Gestión de Requerimientos de Abastecimiento (SYSPCC)
**Stack:** Django 5.1 + DRF | React 19 + Vite 7.3 + Tailwind CSS 4 | Redis + Celery | SQLite (desarrollo) / PostgreSQL (producción)
**Fecha:** 2026-10-29 (actualizado al código de `develop`, tickets SYSPCC-001 a SYSPCC-026)
**Alcance:** estado actual del código. Los flujos de RQ y el ciclo del almacén los define gerencia y su fuente de verdad es `CLAUDE.md` (secciones *DO NOT MODIFY*); este documento describe cómo están implementados.

---

## 1. Vista general del sistema

```
┌──────────────────────────────────────────────────────────────────────────┐
│                React 19 SPA (Vite 7.3 + Tailwind CSS 4)                  │
│  Selector de módulos (/) → AppShell (/rq) · WarehouseShell (/almacen)    │
│  AdminShell (/admin) · SystemAdminShell (/sistema) · HRShell (/rrhh)     │
│  SupportShell (/soporte) · /settings · /cambiar-password                 │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ REST /api/v1/* (JSON)
                                │ JWT en cookies httpOnly + CSRF double-submit
┌───────────────────────────────▼──────────────────────────────────────────┐
│                     Django 5.1 + Django REST Framework                   │
│   core │ rq │ warehouse │ administracion │ hr │ support                  │
│   Servicios: WorkflowEngine, BudgetValidator, SLACalculator, ...         │
└───────┬───────────────────────────┬──────────────────────────┬───────────┘
        │                           │                          │
┌───────▼─────────┐   ┌─────────────▼─────────────┐   ┌────────▼────────────┐
│ Base de datos   │   │ Redis                     │   │ Celery              │
│ SQLite (dev)    │   │ caché + sesiones (DB 0)   │   │ worker (cola default│
│ PostgreSQL      │   │ broker Celery (DB 1)      │   │ worker hr_cv (CVs)  │
│ (production.py) │   │ resultados Celery (DB 2)  │   │ beat (programadas)  │
└─────────────────┘   └───────────────────────────┘   └─────────────────────┘
```

Fuentes: `backend/config/settings/base.py` (apps, caché, sesiones, Celery), `backend/config/settings/production.py` (PostgreSQL), `frontend/src/App.jsx` (rutas y shells), `docker-compose.yml` (servicios `redis`, `backend`, `frontend`, `celery_worker`, `celery_worker_hr`, `celery_beat`).

### Principios de diseño (verificados en el código)
- **Capa de servicios:** las vistas DRF delegan la lógica de negocio en `apps/<app>/services/` (por ejemplo `WorkflowEngine` en `apps/rq/services/workflow_engine.py`).
- **RBAC en dos niveles:** clases de permiso DRF en las vistas (`apps/core/permissions.py`, `apps/rq/permissions.py`, `apps/warehouse/permissions.py`) y validación del rol dentro de `WorkflowEngine` (`_validate_acting_role`, `_check_role_permission`).
- **Trazabilidad:** cada transición crea un registro `Approval` (rol, estado previo y nuevo) y un `ActivityLog`; las transiciones automáticas se registran con rol `SYSTEM`.
- **Autenticación por cookies:** JWT (SimpleJWT) en cookies `access_token` / `refresh_token` httpOnly, leídas por `CookieJWTAuthentication`; CSRF obligatorio en métodos que modifican datos.
- **Concurrencia controlada:** `WorkflowEngine.execute` bloquea la fila del RQ (`select_for_update`) y el stock nunca puede quedar negativo (`CheckConstraint inventory_stock_quantity_gte_0`).

---

## 2. Módulos del sistema

### 2.1 Backend (`INSTALLED_APPS` locales)

| # | App Django | Responsabilidad | Modelos principales |
|---|-----------|-----------------|---------------------|
| 1 | `apps.core` | Usuarios, roles, autenticación, proyectos, departamentos, plan anual, personal | `User`, `UserRole`, `Project`, `ProjectBudgetLine`, `Department`, `AnnualPlan`, `AnnualPlanLine`, `Personal` |
| 2 | `apps.rq` | Requerimientos, máquina de estados, aprobaciones, proveedores, cotizaciones, órdenes de compra, reclamos, notificaciones, adjuntos | `Request`, `RequestItem`, `Approval`, `WorkflowStep`, `AcquisitionTypeConfig`, `Supplier`, `Quotation`, `QuotationItem`, `PurchaseOrder`, `PurchaseOrderItem`, `Claim`, `Notification`, `ActivityLog`, `Attachment` |
| 3 | `apps.warehouse` | Catálogo e inventario, movimientos y vales, kardex, recepciones y despachos ligados a RQ, importación del Excel de EPP, OneDrive | `Inventory`, `InventoryStock`, `MovementGroup`, `InventoryMovement`, `WarehouseReceipt(Item)`, `WarehouseDispatch(Item)`, `InventoryImport`, `OneDriveToken` |
| 4 | `apps.administracion` | Pasajes del personal, pagos, políticas de devolución, proveedores de pasajes, puestos | `Pasaje`, `PoliticaPasajeDevoluciones`, `ProveedorPasajes`, `Puesto` |
| 5 | `apps.hr` | RR. HH.: generador de contratos desde plantillas Word y análisis masivo de CVs | `DocumentTemplate`, `GeneratedDocument`, `DocumentEvent`, `CVAnalysis`, `CVAnalysisItem` |
| 6 | `apps.support` | Mesa de ayuda TI (tickets y comentarios) | `Ticket`, `TicketComment` |

### 2.2 Frontend (módulos visibles en el selector `/`)

| Módulo | Ruta | Shell | Acceso en el frontend |
|--------|------|-------|-----------------------|
| Requerimientos | `/rq/*` | `AppShell` | Todo usuario autenticado (subrutas con `RoleRoute`) |
| Almacén | `/almacen/*` | `WarehouseShell` | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE`, `LOGISTICS_COORDINATOR`, `LOGISTICS_SUPERVISOR`, `LOGISTICS_CHIEF` |
| Soporte TI | `/soporte/*` | `SupportShell` | Todo usuario autenticado |
| Recursos Humanos | `/rrhh/*` | `HRShell` | `HR_MANAGER`, `GENERAL_MANAGER` (este último solo lectura) |
| Administración (pasajes) | `/admin`, `/admin/*` | `AdminMenuPage` / `AdminShell` | `ADMIN_MANAGER`, `GENERAL_MANAGER`, `PASAJES_MANAGER` |
| Administración del Sistema | `/sistema/*` | `SystemAdminShell` | Solo `is_superuser` (`SuperUserRoute`) |
| Business Intelligence | `/bi` | — | Tarjeta marcada como no disponible (`available: false` en `SystemSelectPage.jsx`) |

---

## 3. Ciclo de vida del RQ — Máquina de estados

Implementación: `backend/apps/rq/services/workflow_engine.py` (lista `TRANSITIONS`, 71 entradas: 34 de `OPERATIONS`, 33 de `ADMINISTRATIVE` y 4 válidas para ambos flujos). La copia literal de esa tabla está congelada en `backend/apps/rq/tests/test_workflow_snapshot.py` (SYSPCC-026): cualquier cambio no autorizado hace fallar la suite.

### 3.1 Estados

`RQStatusChoices` (`backend/apps/core/enums.py`) define **47 estados**. **37** participan en `TRANSITIONS` (incluidos los destinos que fijan los handlers condicionales). **10** están definidos pero ninguna transición los alcanza: `TECHNICAL_REVIEW`, `BUDGET_REVIEW`, `SUPERVISOR_REVIEW`, `ADMIN_BUDGET_REVIEW`, `STOCK_CHECK`, `QUALITY_CHECK`, `RECEPTION_CONFORMITY`, `RECEPTION_CLAIM`, `USER_CLAIM`, `CLAIM_RESOLVED`.

Estados terminales (`Request.is_terminal`): `CLOSED`, `CANCELLED`, `TECHNICAL_REJECTED`, `SUPERVISOR_REJECTED`, `GM_REJECTED`, `COST_OVERRUN_REJECTED`.

### 3.2 Fases

```
FASE 1  Solicitud          DRAFT → SUBMITTED
FASE 2  Validación         OPS: Residente → Control de Proyecto (dentro de propuesta / adicional → GG)
                           ADM: Jefe Directo → Gte. Administrativo (plan anual / fuera de plan → GG)
                           → VALIDATED (automático desde WITHIN_PROPOSAL, WITHIN_ANNUAL_PLAN o GM_APPROVED)
FASE 3  Logística/Compras  stock (IN_STOCK | REQUIRES_PURCHASE) → QUOTING → QUOTE_COMPARISON
                           → QUOTE_SELECTED → costo aprobado | sobrecosto (GG) → PO_GENERATED
FASE 4  Recepción/Entrega  RECEIVING → QC (QUALITY_APPROVED | QUALITY_REJECTED → reclamo al proveedor)
                           → DISPATCHED_TO_SITE → DELIVERED (ADM: → WAREHOUSE_UPDATED)
FASE 5  Conformidad/Cierre USER_CONFORMITY → CLOSED   |   CLAIM_IN_REVIEW → SUPPLIER_CLAIM_SENT
Universal                  cualquier estado no terminal → CANCELLED
```

### 3.3 Reglas de transición (tal como están en `TRANSITIONS`)

La acción es un valor de `ApprovalActionChoices`. "Sistema" = transición automática (`system_action`), ejecutada por `_execute_system_chain`. "—" = la transición no existe en ese flujo.

| Desde | Acción | OPERATIONS: rol → destino | ADMINISTRATIVE: rol → destino |
|-------|--------|---------------------------|-------------------------------|
| `DRAFT` | `SUBMITTED` | `REQUESTER` → `SUBMITTED` | `REQUESTER` → `SUBMITTED` |
| `SUBMITTED` | `TECHNICAL_APPROVED` | `PROJECT_RESIDENT` → `TECHNICAL_APPROVED` | — |
| `SUBMITTED` | `TECHNICAL_REJECTED` | `PROJECT_RESIDENT` → `TECHNICAL_REJECTED` | — |
| `TECHNICAL_APPROVED` | `BUDGET_CLASSIFIED` | `PROJECT_CONTROL` → `WITHIN_PROPOSAL` o `ADDITIONAL_REQ` (handler) | — |
| `TECHNICAL_APPROVED` | `BUDGET_REJECTED` | `PROJECT_CONTROL` → `TECHNICAL_REJECTED` | — |
| `ADDITIONAL_REQ` | `TECHNICAL_APPROVED` | `PROJECT_RESIDENT` → `GM_REVIEW` | — |
| `ADDITIONAL_REQ` | `TECHNICAL_REJECTED` | `PROJECT_RESIDENT` → `TECHNICAL_REJECTED` | — |
| `WITHIN_PROPOSAL` | `VALIDATED` | Sistema → `VALIDATED` | — |
| `SUBMITTED` | `SUPERVISOR_APPROVED` | — | `DIRECT_SUPERVISOR` → `SUPERVISOR_APPROVED` |
| `SUBMITTED` | `SUPERVISOR_REJECTED` | — | `DIRECT_SUPERVISOR` → `SUPERVISOR_REJECTED` |
| `SUPERVISOR_APPROVED` | `ADMIN_BUDGET_REVIEWED` | — | `ADMIN_MANAGER` → `WITHIN_ANNUAL_PLAN` o `OUT_OF_ANNUAL_PLAN` (handler) |
| `SUPERVISOR_APPROVED` | `ADMIN_BUDGET_REJECTED` | — | `ADMIN_MANAGER` → `SUPERVISOR_REJECTED` |
| `OUT_OF_ANNUAL_PLAN` | `SUPERVISOR_APPROVED` | — | `DIRECT_SUPERVISOR` → `GM_REVIEW` |
| `OUT_OF_ANNUAL_PLAN` | `SUPERVISOR_REJECTED` | — | `DIRECT_SUPERVISOR` → `SUPERVISOR_REJECTED` |
| `WITHIN_ANNUAL_PLAN` | `VALIDATED` | — | Sistema → `VALIDATED` |
| `GM_REVIEW` | `GM_APPROVED` | `GENERAL_MANAGER` → `GM_APPROVED` | `GENERAL_MANAGER` → `GM_APPROVED` |
| `GM_REVIEW` | `GM_REJECTED` | `GENERAL_MANAGER` → `GM_REJECTED` | `GENERAL_MANAGER` → `GM_REJECTED` |
| `GM_APPROVED` | `VALIDATED` | Sistema → `VALIDATED` | Sistema → `VALIDATED` |
| `VALIDATED` | `STOCK_CHECKED` | `LOGISTICS_COORDINATOR` → `IN_STOCK` o `REQUIRES_PURCHASE` (handler) | `LOGISTICS_SUPERVISOR` → `IN_STOCK` o `REQUIRES_PURCHASE` (handler) |
| `REQUIRES_PURCHASE` | `QUOTE_REQUESTED` | `LOGISTICS_COORDINATOR` → `QUOTING` | `LOGISTICS_SUPERVISOR` → `QUOTING` |
| `QUOTING` | `QUOTE_COMPARED` | `LOGISTICS_COORDINATOR` → `QUOTE_COMPARISON` | `LOGISTICS_CHIEF` → `QUOTE_COMPARISON` |
| `QUOTE_COMPARISON` | `QUOTE_SELECTED` | `LOGISTICS_COORDINATOR` → `QUOTE_SELECTED` | `LOGISTICS_CHIEF` → `QUOTE_SELECTED` |
| `QUOTE_SELECTED` | `QUOTE_COST_APPROVED` | `PROJECT_CONTROL` → `QUOTE_COST_APPROVED` | `ADMIN_MANAGER` → `QUOTE_COST_APPROVED` |
| `QUOTE_SELECTED` | `QUOTE_COST_REJECTED` | `PROJECT_CONTROL` → `COST_OVERRUN_REVIEW` | `ADMIN_MANAGER` → `COST_OVERRUN_REVIEW` |
| `COST_OVERRUN_REVIEW` | `COST_OVERRUN_APPROVED` | `GENERAL_MANAGER` → `COST_OVERRUN_APPROVED` | `GENERAL_MANAGER` → `COST_OVERRUN_APPROVED` |
| `COST_OVERRUN_REVIEW` | `COST_OVERRUN_REJECTED` | `GENERAL_MANAGER` → `COST_OVERRUN_REJECTED` | `GENERAL_MANAGER` → `COST_OVERRUN_REJECTED` |
| `QUOTE_COST_APPROVED` | `PO_GENERATED` | `LOGISTICS_COORDINATOR` → `PO_GENERATED` | `LOGISTICS_SUPERVISOR` → `PO_GENERATED` |
| `COST_OVERRUN_APPROVED` | `PO_GENERATED` | `LOGISTICS_COORDINATOR` → `PO_GENERATED` | `LOGISTICS_SUPERVISOR` → `PO_GENERATED` |
| `PO_GENERATED` | `RECEIVED` | `LOGISTICS_COORDINATOR` → `RECEIVING` | `LOGISTICS_SUPERVISOR` → `RECEIVING` |
| `IN_STOCK` | `DISPATCHED` | `CENTRAL_WAREHOUSE` → `DISPATCHED_TO_SITE` | `CENTRAL_WAREHOUSE` → `DELIVERED` |
| `RECEIVING` | `QUALITY_APPROVED` | `LOGISTICS_COORDINATOR` → `QUALITY_APPROVED` | `LOGISTICS_SUPERVISOR` → `QUALITY_APPROVED` |
| `RECEIVING` | `QUALITY_REJECTED` | `LOGISTICS_COORDINATOR` → `QUALITY_REJECTED` | `LOGISTICS_SUPERVISOR` → `QUALITY_REJECTED` |
| `QUALITY_APPROVED` | `DISPATCHED` | `LOGISTICS_COORDINATOR` → `DISPATCHED_TO_SITE` | `LOGISTICS_SUPERVISOR` → `DISPATCHED_TO_SITE` |
| `DISPATCHED_TO_SITE` | `WAREHOUSE_RECORDS_UPDATED` | `SITE_WAREHOUSE` → `DELIVERED` | `CENTRAL_WAREHOUSE` → `DELIVERED` |
| `QUALITY_REJECTED` | `SUPPLIER_CLAIM_SENT` | `LOGISTICS_COORDINATOR` → `SUPPLIER_CLAIM_SENT` | `LOGISTICS_SUPERVISOR` → `SUPPLIER_CLAIM_SENT` |
| `SUPPLIER_CLAIM_SENT` | `SUPPLIER_CLAIM_UPDATED` | `LOGISTICS_COORDINATOR` → `SUPPLIER_CLAIM_PENDING` | — |
| `SUPPLIER_CLAIM_PENDING` | `SUPPLIER_REPLACEMENT_RECEIVED` | `LOGISTICS_COORDINATOR` → `SUPPLIER_REPLACEMENT_RECEIVED` | — |
| `SUPPLIER_CLAIM_SENT` | `SUPPLIER_REPLACEMENT_RECEIVED` | `LOGISTICS_COORDINATOR` → `SUPPLIER_REPLACEMENT_RECEIVED` | `LOGISTICS_SUPERVISOR` → `SUPPLIER_REPLACEMENT_RECEIVED` |
| `SUPPLIER_REPLACEMENT_RECEIVED` | `QUALITY_APPROVED` | `LOGISTICS_COORDINATOR` → `QUALITY_APPROVED` | `LOGISTICS_SUPERVISOR` → `QUALITY_APPROVED` |
| `SUPPLIER_REPLACEMENT_RECEIVED` | `QUALITY_REJECTED` | `LOGISTICS_COORDINATOR` → `QUALITY_REJECTED` | `LOGISTICS_SUPERVISOR` → `QUALITY_REJECTED` |
| `DELIVERED` | `WAREHOUSE_RECORDS_UPDATED` | — | `CENTRAL_WAREHOUSE` → `WAREHOUSE_UPDATED` |
| `DELIVERED` | `USER_CONFIRMED` | `REQUESTER` → `USER_CONFORMITY` | — |
| `DELIVERED` | `USER_CLAIMED` | `REQUESTER` → `CLAIM_IN_REVIEW` | — |
| `WAREHOUSE_UPDATED` | `USER_CONFIRMED` | — | `REQUESTER` → `USER_CONFORMITY` |
| `WAREHOUSE_UPDATED` | `USER_CLAIMED` | — | `REQUESTER` → `CLAIM_IN_REVIEW` |
| `CLAIM_IN_REVIEW` | `SUPPLIER_CLAIM_SENT` | `LOGISTICS_COORDINATOR` → `SUPPLIER_CLAIM_SENT` | `LOGISTICS_SUPERVISOR` → `SUPPLIER_CLAIM_SENT` |
| `USER_CONFORMITY` | `CLOSED` | `LOGISTICS_COORDINATOR` → `CLOSED` | `LOGISTICS_SUPERVISOR` → `CLOSED` |
| Cualquier no terminal | `CANCELLED` | `handle_cancellation` → `CANCELLED` | `handle_cancellation` → `CANCELLED` |

Nota sobre la Fase 1: `POST /api/v1/requests/` (`RequestCreateSerializer.create`) crea el RQ directamente en `SUBMITTED` y registra un `Approval` `DRAFT` → `SUBMITTED`, sin pasar por `WorkflowEngine`. La transición `DRAFT` → `SUBMITTED` de la tabla aplica a un RQ que esté en `DRAFT`.

Datos que exigen los handlers condicionales (`extra_data` del endpoint `POST /api/v1/requests/{id}/action/`):
- `handle_ops_budget_classification`: `classification` = `BC_WITHIN_PROPOSAL` | `BC_ADDITIONAL`.
- `handle_adm_budget_review`: `within_plan` = `true` | `false`.
- `handle_stock_check`: `has_stock` = `true` | `false`.
- `handle_cancellation`: no requiere datos; rechaza si el RQ ya es terminal. La entrada de cancelación no fija `required_role`, por lo que basta con que el usuario pueda ver el RQ y tenga el `acting_role` que declara.

Efectos secundarios (`_apply_side_effects`):
- Al llegar a `VALIDATED`: calcula `fecha_estimada_entrega` (`SLACalculator`) y compromete presupuesto (`BudgetValidator.commit_budget`, sin bloquear la transición si falla).
- Al llegar a `CANCELLED` o a un rechazo terminal: libera el presupuesto comprometido.
- Acción `RECEIVED`: crea un vale de ingreso al almacén `CENTRAL` (`register_entry_batch`) y un `WarehouseReceipt`, omitiendo ítems atendidos de stock y los marcados fuera de catálogo.
- Acción `DISPATCHED`: crea un vale de egreso (`register_exit_batch`) y un `WarehouseDispatch`.
- Siempre: `Approval`, `ActivityLog` y notificaciones in-app (`NotificationService.notify_on_transition`).

---

## 4. Arquitectura de servicios

### 4.1 Stack tecnológico

| Capa | Tecnología (versión fijada) | Fuente |
|------|-----------------------------|--------|
| Frontend | React 19.2.4, React Router 7.13.1, Axios 1.7.9, Lucide React 0.577.0, ExcelJS 4.4.0 | `frontend/package.json` |
| Build / estilos | Vite 7.3.1, Tailwind CSS 4.2.1 (`@tailwindcss/vite`) | `frontend/package.json` |
| Pruebas frontend | Vitest 3.2.4 + Testing Library | `frontend/package.json` |
| Backend | Django 5.1.4, DRF 3.15.2, django-filter 24.3, drf-spectacular 0.27.2 | `backend/requirements.txt` |
| Auth | djangorestframework-simplejwt 5.3.1 (con blacklist) | `backend/requirements.txt` |
| Tareas asíncronas | Celery 5.4.0, django-celery-beat 2.7.0 | `backend/requirements.txt` |
| Caché / broker | Redis (imagen `redis:7-alpine` en Docker), django-redis 5.4.0 | `docker-compose.yml`, `requirements.txt` |
| Base de datos | SQLite por defecto; PostgreSQL en `production.py` (psycopg2-binary 2.9.10) | `config/settings/` |
| Archivos | `FileSystemStorage`; S3/Spaces opcional si se define `AWS_STORAGE_BUCKET_NAME` | `production.py` |
| Excel (backend) | openpyxl 3.1.5 (importación de inventario y exportaciones) | `apps/warehouse/services/imports/parser.py`, `apps/warehouse/services/exports.py` |
| PDF | ReportLab 4.2.5 (vales); LibreOffice opcional para contratos | `apps/warehouse/services/pdf_generator.py`, `backend/Dockerfile` |
| RR. HH. | docxtpl, python-docx, pypdf, anthropic 1.11.0 | `backend/requirements.txt` |
| Runtime | Python 3.12 (`python:3.12-slim`), Node 22 (`engines`) | `backend/Dockerfile`, `frontend/package.json` |

### 4.2 Estructura del proyecto

```
SYSPCCLOG/
├── docker-compose.yml            # redis, backend, frontend, celery_worker, celery_worker_hr, celery_beat
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── conftest.py               # fixtures globales de pytest
│   ├── config/
│   │   ├── settings/{base,development,production,demo,guards}.py
│   │   ├── urls.py               # /mgmt-panel/, /api/v1/, /api/schema|docs|redoc/
│   │   └── celery.py
│   └── apps/
│       ├── core/        models/ serializers/ views/ urls/ services/ authentication.py permissions.py throttling.py middleware.py enums.py
│       ├── rq/          models/ serializers/ views/ services/ permissions.py filters.py tasks.py tests/
│       ├── warehouse/   models/ services/ (imports/) views.py views_imports.py views_personal.py permissions.py tasks.py
│       ├── administracion/  models.py serializers.py services.py views.py
│       ├── hr/          models/ services/ views/ documents/ storage.py middleware.py tasks.py
│       └── support/     models.py serializers.py services.py views.py
└── frontend/
    ├── package.json
    ├── vite.config.js            # proxy /api y /media al backend en desarrollo
    └── src/
        ├── App.jsx               # rutas y shells
        ├── api/                  # cliente Axios + un módulo por dominio
        ├── context/              # AuthContext, ToastContext, ThemeContext
        ├── components/           # layout/, auth/, requests/, almacen/, rrhh/, sistema/, ui/
        ├── pages/                # auth, dashboard, requests, approvals, operations, almacen, admin, sistema, rrhh, support, reports, settings
        ├── hooks/ · utils/ · data/
        └── test/
```

---

## 5. API — Responsabilidades

Todas las rutas cuelgan de `/api/v1/` (`backend/config/urls.py`). Resumen por namespace; el detalle está en `docs/backend/django-backend-design.md`.

| Namespace | Prefijo | Recursos |
|-----------|---------|----------|
| `auth` | `/auth/` | `csrf/`, `login/`, `token/refresh/`, `token/verify/`, `logout/` |
| `users` | `/` | `users/` (+ `me/`, `me/change-password/`, `me/signature/`, `reset-password/`, `activate/`, `deactivate/`), `user-roles/` |
| `projects` | `/` | `projects/` (+ `activate/`, `deactivate/`), `project-budget-lines/` |
| `departments` | `/` | `departments/`, `annual-plans/`, `annual-plan-lines/` |
| `personal` | `/` | `personal/` (+ `buscar-dni/`, `export/`) |
| `rq` | `/` | `requests/` (+ `action/`, `available-actions/`, `approvals/`, `activity/`, `attachments/`, `update-items/`, `stock-availability/`), `request-catalog/`, `suppliers/`, `quotations/` (+ `select/`), `purchase-orders/`, `claims/`, `notifications/`, `activity-logs/`, `attachments/`, `acquisition-type-configs/`, `workflow-steps/` |
| `warehouse` | `/warehouse/` | `inventory/`, `movements/`, `pending-requests/`, `personal-lookup/`, `imports/`, `onedrive/` |
| `administracion` | `/administracion/` | `tipo-cambio/`, `pasajes/`, `proveedores-pasajes/`, `politicas-devolucion/`, `puestos/` |
| `hr` | `/hr/` | `templates/`, `documents/`, `cv-analyses/` (+ `items/`), `document-types/`, `personal/`, `assistant/` |
| `support` | `/support/` | `tickets/` (+ `change-status/`, `add-comment/`, `my-stats/`) |

Fuera de `/api/v1/`: `/mgmt-panel/` (admin de Django), `/api/schema/`, `/api/docs/` (Swagger) y `/api/redoc/` (las tres con `IsAdminUser`), y `/healthz/` (respondido por `HealthCheckMiddleware`).

---

## 6. Roles y control de acceso

`RoleChoices` define **13 roles**. Un usuario puede tener varios (`UserRole`), opcionalmente acotados a un proyecto (`project`) o departamento (`department_obj`). No existe un rol de superadministrador de negocio: la administración del sistema se reserva a `is_superuser` (`IsSuperUser`, SYSPCC-018).

| Rol | Etiqueta | Uso principal |
|-----|----------|---------------|
| `REQUESTER` | Solicitante | Crea, envía, da conformidad o reclama |
| `PROJECT_RESIDENT` | Residente de Proyecto | Validación técnica (OPS) y adicionales |
| `PROJECT_CONTROL` | Control de Proyecto | Clasificación presupuestal y aprobación de costo (OPS) |
| `GENERAL_MANAGER` | Gerente General | Adicionales, fuera de plan y sobrecostos; lectura en RR. HH. |
| `LOGISTICS_COORDINATOR` | Coordinador Logístico | Fases 3–5 del flujo OPS |
| `CENTRAL_WAREHOUSE` | Almacén Central | Despacho desde stock; registros de almacén (ADM); importación |
| `SITE_WAREHOUSE` | Almacén de Obra | Recepción en obra (OPS); almacén de obra |
| `DIRECT_SUPERVISOR` | Jefe Directo | Validación administrativa (ADM) |
| `ADMIN_MANAGER` | Gerente Administrativo | Plan anual y aprobación de costo (ADM); pasajes |
| `LOGISTICS_SUPERVISOR` | Supervisor Logístico | Fases 3–5 del flujo ADM |
| `LOGISTICS_CHIEF` | Jefe Logístico | Comparación y selección de cotizaciones (ADM); importación de inventario |
| `PASAJES_MANAGER` | Gestor de Pasajes | Módulo de pasajes |
| `HR_MANAGER` | Gestor de RR. HH. | Contratos y análisis de CVs |

Visibilidad de RQ (`get_accessible_requests_queryset`, `apps/rq/permissions.py`):
- `is_staff` / `is_superuser` y roles de acceso amplio (`GENERAL_MANAGER`, `LOGISTICS_COORDINATOR`, `LOGISTICS_SUPERVISOR`, `LOGISTICS_CHIEF`, `CENTRAL_WAREHOUSE`): todos los RQ.
- `PROJECT_RESIDENT`, `PROJECT_CONTROL`, `SITE_WAREHOUSE`: los RQ del proyecto de su `UserRole`.
- `DIRECT_SUPERVISOR`, `ADMIN_MANAGER`: los RQ del departamento de su `UserRole`.
- Resto (p. ej. `REQUESTER`): solo los RQ que creó.

| Recurso | Quién puede |
|---------|-------------|
| Acción de workflow | Rol requerido por `TRANSITIONS`, declarado como `acting_role` y asignado al usuario (`CanPerformWorkflowAction` + `WorkflowEngine`) |
| `update-items` / `stock-availability` del RQ | `IsLogisticsStaff` (coordinador, supervisor, jefe logístico) |
| Escritura de cotizaciones y OC | `IsLogisticsStaff` |
| Almacén (módulo) | `IsWarehouseRole` (2 roles de almacén + 3 de logística) |
| Importar inventario / asignar ubicaciones / vincular personal | `CENTRAL_WAREHOUSE`, `LOGISTICS_CHIEF` |
| Entrega de EPP | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE` |
| Pasajes | `ADMIN_MANAGER`, `GENERAL_MANAGER`, `PASAJES_MANAGER` o `is_staff` |
| RR. HH. (escritura / lectura) | `HR_MANAGER` / `HR_MANAGER` + `GENERAL_MANAGER` (sin bypass por `is_staff`) |
| Usuarios y proyectos (escritura) | `is_superuser` |
| Tickets de soporte | Cada usuario ve los suyos; `is_staff` ve todos |

---

## 7. Pantallas (rutas de `frontend/src/App.jsx`)

| Ruta | Página | Restricción |
|------|--------|-------------|
| `/login` | `LoginPage` | Pública |
| `/cambiar-password` | `ChangePasswordRequiredPage` | Cambio de contraseña forzado (SYSPCC-018) |
| `/` | `SystemSelectPage` | Autenticado |
| `/rq` | `DashboardPage` | — |
| `/rq/requests`, `/rq/requests/new`, `/rq/requests/:id` | Lista, creación y detalle de RQ | — |
| `/rq/approvals` | `ApprovalsPage` | — |
| `/rq/approvals/tech-review/:id` | `TechReviewPage` | `PROJECT_RESIDENT` |
| `/rq/approvals/budget-review/:id` | `BudgetReviewPage` | `PROJECT_CONTROL`, `ADMIN_MANAGER` |
| `/rq/approvals/quote-cost-review/:id` | `QuoteCostReviewPage` | `PROJECT_CONTROL`, `ADMIN_MANAGER` |
| `/rq/approvals/manager/:id` | `ManagerApprovalPage` | `GENERAL_MANAGER` |
| `/rq/approvals/cost-overrun/:id` | `CostOverrunReviewPage` | `GENERAL_MANAGER` |
| `/rq/reports` | `ReportsPage` | `GENERAL_MANAGER` |
| `/rq/logistics`, `/rq/logistics/:id` | `LogisticsPage`, `LogisticsActionPage` | `LOGISTICS_COORDINATOR`, `LOGISTICS_SUPERVISOR` |
| `/almacen` (+ `inventario`, `inventario/:id`, `entrada`, `salida`, `salida/:id/voucher`, `movimientos`, `pendientes`, `resumen`) | Almacén | Roles de almacén y logística |
| `/almacen/transferencia` | `TransferenciaPage` | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE` |
| `/almacen/importar` | `ImportarPage` | `CENTRAL_WAREHOUSE`, `LOGISTICS_CHIEF` |
| `/admin`, `/admin/{dashboard,pasajes,pagos,politicas,proveedores}` | Administración (pasajes) | `ADMIN_MANAGER`, `GENERAL_MANAGER`, `PASAJES_MANAGER` |
| `/sistema/{usuarios,proyectos}` (+ `nuevo`, `:id`) | Administración del Sistema | `is_superuser` |
| `/rrhh/documentos`, `/rrhh/cvs`, `/rrhh/plantillas` (+ subrutas) | RR. HH. | `HR_MANAGER`; `GENERAL_MANAGER` solo lectura |
| `/soporte`, `/soporte/{dashboard,tickets,tickets/:id}` | Soporte TI | Autenticado |
| `/settings` | `SettingsPage` | Autenticado |

---

## 8. Evolución del sistema

El historial de cambios se registra en `TICKETS.md` (un ticket `SYSPCC-NNN` por cambio sustantivo, con rama y PR hacia `develop`). Hitos relevantes para la arquitectura:

| Ticket | Cambio |
|--------|--------|
| SYSPCC-006, 007, 011 | Control de acceso por alcance, locks de concurrencia y `CanPerformWorkflowAction` |
| SYSPCC-015 | CSRF obligatorio con autenticación por cookies |
| SYSPCC-016 | Cifrado en reposo de tokens de OneDrive |
| SYSPCC-018 | Módulo Administración del Sistema (`/sistema`) y cambio de contraseña forzado |
| SYSPCC-020 | Tema claro/oscuro |
| SYSPCC-022, 023 | Módulo RR. HH.: contratos y análisis masivo de CVs (cola Celery `hr_cv`) |
| SYSPCC-025 | Almacén adaptado al inventario real de EPP e importación del Excel |
| SYSPCC-026 | Ítems de RQ vinculados al catálogo del almacén y test de snapshot del flujo |

---

## 9. Decisiones clave de diseño

| Decisión | Elección | Motivo |
|----------|----------|--------|
| Autenticación | JWT (SimpleJWT) en cookies httpOnly + CSRF double-submit | El token no queda accesible a JavaScript; CSRF cubre el envío automático de cookies |
| Máquina de estados | Tabla Python propia (`TRANSITIONS`) + test de snapshot literal | Flujo fijado por gerencia; cualquier cambio debe ser explícito |
| Monolito vs. microservicios | Monolito Django multi-app | Un solo despliegue; dominios separados por app |
| Estado en frontend | Context (`AuthContext`, `ToastContext`, `ThemeContext`), sin Redux | Estado global mínimo; los datos se piden por página |
| Estilos | Tailwind CSS 4, tema oscuro por clase `.dark` en `<html>` | Variante `dark` definida con `@custom-variant` en `index.css` |
| Formato de API | REST con DRF y OpenAPI (drf-spectacular) | Ecosistema DRF |
| Excel | openpyxl en el backend (importación y exportaciones); ExcelJS en el frontend (exportación de RQ, `utils/exportRQ.js`) | Validación del archivo en el servidor; exportaciones de listas en el cliente |
| Tareas en segundo plano | Celery + Redis; cola dedicada `hr_cv` para CVs | El análisis de CVs no compite con SLA y recordatorios |
| Archivos de RR. HH. | Almacenamiento privado fuera de `MEDIA_ROOT` (`HR_PRIVATE_ROOT`) | Contratos y CVs contienen datos personales |
