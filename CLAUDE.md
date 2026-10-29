# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ignored Paths — DO NOT READ unless explicitly asked
- `rle/`
- `cv_pcc.md`

## Project

Supply Request Management System (SYSPCC) — internal enterprise app for a construction/engineering company. Django 5.1 + DRF backend, React 19 + Vite 7.3 + Tailwind CSS 4 frontend, Redis for cache/Celery, SQLite (dev) / PostgreSQL (prod).

## Modo de trabajo — Equipo multiagente (SIEMPRE)

Este proyecto se opera **por defecto como un equipo multiagente**. Para toda tarea sustantiva (nueva funcionalidad, cambio de comportamiento, bugfix no trivial, refactor, cambio de esquema, o trabajo de seguridad), actúa como **Tech Lead / orquestador** siguiendo el skill **`orquestador-syspcc`**: invócalo al inicio y delega en los 13 agentes de `.claude/agents/` a través del pipeline de 7 fases, numeradas de la 0 a la 6 (Diseño → Backend → Frontend → Seguridad → Pruebas → Revisión → Entrega), respetando los quality gates y el protocolo de handoff.

Reglas del modo equipo:
- El **orquestador es la sesión principal**, no un subagente. Los subagentes corren aislados; la comunicación entre ellos es hub-and-spoke (el orquestador relaya la salida de cada fase a la entrada de la siguiente) más el archivo de handoff `.claude/handoffs/<feature>.md` (p.ej. `SYSPCC-025-almacen-epp-real.md`; local, no versionado).
- **No se cierra ninguna fase** sin cumplir su gate (tests en verde, code-review sin 🔴, reglas DO-NOT-MODIFY intactas).
- **Escape hatch:** preguntas conversacionales, de solo lectura o ediciones triviales (typo, un renombrado, "¿qué hace esto?") se responden directo, sin desplegar el equipo. Ante la duda de si algo es trivial, trátalo como sustantivo y usa el equipo.

Detalle completo (roster, fases, gates, handoff): skill `orquestador-syspcc`.

## Flujo de trabajo Git — Ramas, tickets y PRs (SIEMPRE)

**Cada cambio sustantivo va en su propia rama con ticket y PR.** No se commitea trabajo sustantivo directo sobre `develop` ni `main`. (Aplica el mismo escape hatch que el modo equipo: preguntas de solo lectura o ediciones triviales no requieren rama.)

Procedimiento por cada cambio:
1. **Ticket**: toma el próximo `SYSPCC-NNN` de `TICKETS.md` (mayor ID + 1) y registra la fila (tipo, rama, descripción, estado).
2. **Rama** desde `develop`: `<tipo>/SYSPCC-NNN-<slug-en-kebab>`. Tipos: `feature`, `fix`, `chore`, `refactor`, `perf`, `docs`, `test`. Ej: `feature/SYSPCC-014-validacion-presupuesto`.
3. **Commit** en Conventional Commits (`tipo(scope): descripción`), cuerpo con `Refs SYSPCC-NNN`. **Sin atribución:** los commits no llevan `Co-Authored-By` ni ninguna firma o mención de herramientas de IA. Commitea **solo** los archivos del cambio, nunca `git add -A` a ciegas (el repo tiene cambios de trabajo pre-existentes).
4. **Push + PR** hacia `develop`: **muestra el plan y confirma con el usuario antes de subir** (push y PR son acciones externas). Usa `gh` para abrir el PR con la plantilla del skill `commits-y-prs`; el cuerpo del PR tampoco lleva firma ni atribución de IA. Requiere `gh` instalado y autenticado; si no lo está, haz push y entrega el link de comparación.
5. Al mergear, actualiza el estado del ticket en `TICKETS.md`.

Detalle de formato: skills `commits-y-prs` y `docker-deploy` (agente `devops-release`).

## Commands

### Backend (run from `backend/`)
```bash
DJANGO_SETTINGS_MODULE=config.settings.development python manage.py runserver
python manage.py migrate
python manage.py seed_demo                # load demo data
python manage.py seed_hr_template         # demo RR. HH. contract template (idempotent)
python manage.py import_warehouse_excel libro.xlsx --user <usuario> --dry-run   # warehouse workbook import (preview; without --dry-run it confirms)
celery -A config worker -l info           # async task worker (default queue)
celery -A config worker -Q hr_cv -c 3 -n hr@%h -l info   # RR. HH. worker: CV analysis queue hr_cv
celery -A config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler
DJANGO_SETTINGS_MODULE=config.settings.development pytest   # run all tests (no pytest.ini: the settings module comes from the env)
pytest apps/<app>/tests/test_foo.py::TestClass::test_method  # single test (same env var; tests live in apps/<app>/tests/)
```

### Frontend (run from `frontend/`)
```bash
npm run dev       # Vite dev server, port 5173
npm run build
npm run lint      # ESLint
npm test          # Vitest (vitest run); npm run test:watch for watch mode
```

### Docker (from repo root) — the usual dev environment
```bash
docker compose --env-file .env.docker up --build
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_demo
docker compose exec -T backend pytest -q -p no:cacheprovider   # backend suite (.env.docker sets DJANGO_SETTINGS_MODULE)
```
Services in `docker-compose.yml`: `redis`, `backend` (runserver, SQLite in the `sqlite_data` volume), `frontend` (Vite), `celery_worker`, `celery_worker_hr` (queue `hr_cv`), `celery_beat`.

## Architecture

### Backend (`backend/`)
- **Settings split:** `config/settings/{base,development,production,demo}.py` (`demo` inherits from `production`); `config/settings/guards.py` holds pure startup checks
- **Django apps (`INSTALLED_APPS`):** `core` (users/roles, auth, projects, departments + annual plans, personal), `rq` (requests, approvals, suppliers, quotations, POs, claims, notifications, workflow), `warehouse` (inventory catalog, movements/kardex, receipts, dispatch, EPP deliveries, Excel import), `administracion` (pasajes), `support` (IT tickets), `hr` (RR. HH.: contract generator from Word templates + bulk CV analysis)
- **Models** live in `apps/<app>/models/` with `__init__.py` re-exports, one file per entity (`core`, `rq`, `warehouse`, `hr`); `administracion` and `support` use a single `models.py`
- **Services** hold business logic out of views: `apps/<app>/services/` (`core`, `rq`, `warehouse`, `hr`) or `services.py` (`administracion`, `support`). `WorkflowEngine` (`apps/rq/services/workflow_engine.py`) is the central state-machine orchestrator for request lifecycle transitions: `RQStatusChoices` has 47 values (10 of them are not used by any transition), `ApprovalActionChoices` 37, `TRANSITIONS` 71 entries, 5 phases per flow
- **Flow guard:** `apps/rq/tests/test_workflow_snapshot.py` freezes, as hand-written literals, every `TRANSITIONS` entry, the values of `RQStatusChoices` / `ApprovalActionChoices` / `RoleChoices` / `RQFlowChoices` and the terminal set of `Request.is_terminal`; any unauthorized change to the gerencia flows fails the suite
- **RQ items ↔ warehouse (SYSPCC-026):** each `RequestItem` links to the warehouse catalog (`inventory_item`) or is marked off-catalog (`is_off_catalog`); `Request.requesting_area` (OP/QC/HSE/ADM) and `RequestItem.item_source` (`ItemSourceChoices`); `GET /api/v1/requests/{id}/stock-availability/` compares requested vs. stock for logistics
- **Warehouse (SYSPCC-025):** location layout and validation in `apps/warehouse/services/locations.py` (items may carry only the floor while the exact location is pending); EPP deliveries with a physical vale (`services/epp.py`); movement summary/kardex; two-step workbook import (preview → confirm) in `services/imports/`
- **Auth:** Cookie-based JWT via `CookieJWTAuthentication` (HttpOnly cookies + double-submit CSRF on unsafe methods). SimpleJWT with 15-min access / 1-day refresh tokens, rotation + blacklist
- **Admin panel** at `/mgmt-panel/` (not `/admin/`)
- **API docs** at `/api/docs/` (Swagger, admin auth required)
- **Celery tasks (beat, `django_celery_beat` DatabaseScheduler):** SLA checks (8 AM), approval reminders (9 AM/2 PM), dashboard cache invalidation (every 15 min), low-stock alerts (7:30 AM), stale warehouse-import purge (3 AM), CV-item requeue (every 5 min, queue `hr_cv`). Timezone: America/Lima. Workers: default worker + `hr_cv` worker (CV analysis, routed by `CELERY_TASK_ROUTES`) + beat

### Frontend (`frontend/src/`)
- **Routing (React Router v7):** `/` is the module selector (`SystemSelectPage`). Shells — `AppShell` (`/rq/*`), `WarehouseShell` (`/almacen/*`), `AdminShell` (`/admin/*`, with a module menu at `/admin`), `SystemAdminShell` (`/sistema/*`, users and projects, Django `is_superuser` only via `SuperUserRoute`), `SupportShell` (`/soporte/*`), `HRShell` (`/rrhh/*`: `documentos`, `plantillas`, `cvs`). `/settings` and `/cambiar-password` are standalone
- **API layer:** Axios clients in `api/` with cookie credentials, 401 interceptor with token refresh queue
- **State:** AuthContext + ToastContext + ThemeContext (no Redux). Light/dark theme (SYSPCC-020): `.dark` class on `<html>` with Tailwind's `dark:` variant scoped to it (`index.css`), manual or automatic mode
- **Pages** organized by domain: `auth/`, `dashboard/`, `requests/`, `approvals/`, `operations/`, `almacen/`, `admin/`, `reports/`, `settings/`, `sistema/`, `support/`, `rrhh/`
- **Icons:** Lucide React. **Excel:** ExcelJS client-side (e.g. RQ export, `utils/exportRQ.js`); the backend uses openpyxl for the warehouse import and some server-side exports
- **Tests:** Vitest + React Testing Library (`vitest.config.js`, setup in `src/test/setup.js`, helper `src/test/renderWithProviders.jsx`)

### API Structure
All endpoints under `/api/v1/`. URL namespaces: `auth` (`/api/v1/auth/`), `users`, `projects`, `departments`, `personal` and `rq` — these are mounted at the `/api/v1/` root (e.g. `/api/v1/requests/`, `/api/v1/request-catalog/`, `/api/v1/suppliers/`, `/api/v1/quotations/`, `/api/v1/purchase-orders/`, `/api/v1/claims/`; workflow actions via `POST /api/v1/requests/{id}/action/`) — plus `warehouse` (`/api/v1/warehouse/`), `administracion` (`/api/v1/administracion/`), `hr` (`/api/v1/hr/`: templates, documents, CV analyses) and `support` (`/api/v1/support/`: tickets).

### Roles (13)
REQUESTER, PROJECT_RESIDENT, PROJECT_CONTROL, GENERAL_MANAGER, LOGISTICS_COORDINATOR, CENTRAL_WAREHOUSE, SITE_WAREHOUSE, DIRECT_SUPERVISOR, ADMIN_MANAGER, LOGISTICS_SUPERVISOR, LOGISTICS_CHIEF, PASAJES_MANAGER, HR_MANAGER

### Workflows — DO NOT MODIFY

These workflows are defined by gerencia and must not be altered. Source: `FLUJOGRAMA DE ABASTECIMIENTO DE RQ's OPERACIONES Rev.0 MAR2026.pdf`. Implementation: `apps/rq/services/workflow_engine.py`.

#### OPERATIONS (Proyectos/Obra)

```
PHASE 1 — Solicitud
  DRAFT → [REQUESTER submits] → SUBMITTED

PHASE 2 — Validación Técnica y Presupuestal
  SUBMITTED → [PROJECT_RESIDENT approves] → TECHNICAL_APPROVED
  SUBMITTED → [PROJECT_RESIDENT rejects] → TECHNICAL_REJECTED
  TECHNICAL_APPROVED → [PROJECT_CONTROL classifies budget]:
    → WITHIN_PROPOSAL (dentro de propuesta) → VALIDATED (auto)
    → ADDITIONAL_REQ (adicional)
  TECHNICAL_APPROVED → [PROJECT_CONTROL rejects] → TECHNICAL_REJECTED
  ADDITIONAL_REQ → [PROJECT_RESIDENT approves] → GM_REVIEW
  ADDITIONAL_REQ → [PROJECT_RESIDENT rejects] → TECHNICAL_REJECTED
  GM_REVIEW → [GENERAL_MANAGER approves] → GM_APPROVED → VALIDATED (auto)
  GM_REVIEW → [GENERAL_MANAGER rejects] → GM_REJECTED

PHASE 3 — Logística y Compras
  VALIDATED → [LOGISTICS_COORDINATOR checks stock]:
    → IN_STOCK (hay stock)
    → REQUIRES_PURCHASE (requiere compra)
  REQUIRES_PURCHASE → [LOGISTICS_COORDINATOR] → QUOTING
  QUOTING → [LOGISTICS_COORDINATOR compares] → QUOTE_COMPARISON
  QUOTE_COMPARISON → [LOGISTICS_COORDINATOR selects] → QUOTE_SELECTED
  QUOTE_SELECTED → [PROJECT_CONTROL approves cost] → QUOTE_COST_APPROVED
  QUOTE_SELECTED → [PROJECT_CONTROL rejects cost] → COST_OVERRUN_REVIEW
  COST_OVERRUN_REVIEW → [GENERAL_MANAGER approves] → COST_OVERRUN_APPROVED
  COST_OVERRUN_REVIEW → [GENERAL_MANAGER rejects] → COST_OVERRUN_REJECTED
  QUOTE_COST_APPROVED → [LOGISTICS_COORDINATOR] → PO_GENERATED
  COST_OVERRUN_APPROVED → [LOGISTICS_COORDINATOR] → PO_GENERATED

PHASE 4 — Recepción y Entrega
  PO_GENERATED → [LOGISTICS_COORDINATOR receives] → RECEIVING
  IN_STOCK → [CENTRAL_WAREHOUSE dispatches] → DISPATCHED_TO_SITE
  RECEIVING → [LOGISTICS_COORDINATOR QC ok] → QUALITY_APPROVED
  RECEIVING → [LOGISTICS_COORDINATOR QC fail] → QUALITY_REJECTED
  QUALITY_APPROVED → [LOGISTICS_COORDINATOR dispatches] → DISPATCHED_TO_SITE
  DISPATCHED_TO_SITE → [SITE_WAREHOUSE updates] → DELIVERED

  Ciclo de reclamo al proveedor:
    QUALITY_REJECTED → [LOGISTICS_COORDINATOR] → SUPPLIER_CLAIM_SENT
    SUPPLIER_CLAIM_SENT → [LOGISTICS_COORDINATOR] → SUPPLIER_CLAIM_PENDING
    SUPPLIER_CLAIM_PENDING → [LOGISTICS_COORDINATOR] → SUPPLIER_REPLACEMENT_RECEIVED
    SUPPLIER_CLAIM_SENT → [LOGISTICS_COORDINATOR] → SUPPLIER_REPLACEMENT_RECEIVED (directo)
    SUPPLIER_REPLACEMENT_RECEIVED → QC again → QUALITY_APPROVED or QUALITY_REJECTED

PHASE 5 — Conformidad y Cierre
  DELIVERED → [REQUESTER confirms] → USER_CONFORMITY
  DELIVERED → [REQUESTER claims] → CLAIM_IN_REVIEW
  CLAIM_IN_REVIEW → [LOGISTICS_COORDINATOR] → SUPPLIER_CLAIM_SENT (reinicia ciclo reclamo)
  USER_CONFORMITY → [LOGISTICS_COORDINATOR closes] → CLOSED
```

#### ADMINISTRATIVE (Oficina)

```
PHASE 1 — Solicitud
  DRAFT → [REQUESTER submits] → SUBMITTED

PHASE 2 — Validación Administrativa
  SUBMITTED → [DIRECT_SUPERVISOR approves] → SUPERVISOR_APPROVED
  SUBMITTED → [DIRECT_SUPERVISOR rejects] → SUPERVISOR_REJECTED
  SUPERVISOR_APPROVED → [ADMIN_MANAGER reviews budget vs Plan Anual]:
    → WITHIN_ANNUAL_PLAN (dentro del plan) → VALIDATED (auto)
    → OUT_OF_ANNUAL_PLAN (fuera del plan)
  SUPERVISOR_APPROVED → [ADMIN_MANAGER rejects] → SUPERVISOR_REJECTED
  OUT_OF_ANNUAL_PLAN → [DIRECT_SUPERVISOR approves] → GM_REVIEW
  OUT_OF_ANNUAL_PLAN → [DIRECT_SUPERVISOR rejects] → SUPERVISOR_REJECTED
  GM_REVIEW → [GENERAL_MANAGER approves] → GM_APPROVED → VALIDATED (auto)
  GM_REVIEW → [GENERAL_MANAGER rejects] → GM_REJECTED

PHASE 3 — Logística y Compras
  VALIDATED → [LOGISTICS_SUPERVISOR checks stock]:
    → IN_STOCK
    → REQUIRES_PURCHASE
  REQUIRES_PURCHASE → [LOGISTICS_SUPERVISOR] → QUOTING
  QUOTING → [LOGISTICS_CHIEF compares] → QUOTE_COMPARISON
  QUOTE_COMPARISON → [LOGISTICS_CHIEF selects] → QUOTE_SELECTED
  QUOTE_SELECTED → [ADMIN_MANAGER approves cost] → QUOTE_COST_APPROVED
  QUOTE_SELECTED → [ADMIN_MANAGER rejects cost] → COST_OVERRUN_REVIEW
  COST_OVERRUN_REVIEW → [GENERAL_MANAGER approves] → COST_OVERRUN_APPROVED
  COST_OVERRUN_REVIEW → [GENERAL_MANAGER rejects] → COST_OVERRUN_REJECTED
  QUOTE_COST_APPROVED → [LOGISTICS_SUPERVISOR] → PO_GENERATED
  COST_OVERRUN_APPROVED → [LOGISTICS_SUPERVISOR] → PO_GENERATED

PHASE 4 — Recepción y Entrega
  PO_GENERATED → [LOGISTICS_SUPERVISOR receives] → RECEIVING
  IN_STOCK → [CENTRAL_WAREHOUSE dispatches] → DELIVERED (directo)
  RECEIVING → [LOGISTICS_SUPERVISOR QC ok] → QUALITY_APPROVED
  RECEIVING → [LOGISTICS_SUPERVISOR QC fail] → QUALITY_REJECTED
  QUALITY_APPROVED → [LOGISTICS_SUPERVISOR dispatches] → DISPATCHED_TO_SITE
  DISPATCHED_TO_SITE → [CENTRAL_WAREHOUSE updates] → DELIVERED

  Ciclo de reclamo al proveedor:
    QUALITY_REJECTED → [LOGISTICS_SUPERVISOR] → SUPPLIER_CLAIM_SENT
    SUPPLIER_CLAIM_SENT → [LOGISTICS_SUPERVISOR] → SUPPLIER_REPLACEMENT_RECEIVED
    SUPPLIER_REPLACEMENT_RECEIVED → QC again → QUALITY_APPROVED or QUALITY_REJECTED

  DELIVERED → [CENTRAL_WAREHOUSE updates records] → WAREHOUSE_UPDATED

PHASE 5 — Conformidad y Cierre
  WAREHOUSE_UPDATED → [REQUESTER confirms] → USER_CONFORMITY
  WAREHOUSE_UPDATED → [REQUESTER claims] → CLAIM_IN_REVIEW
  CLAIM_IN_REVIEW → [LOGISTICS_SUPERVISOR] → SUPPLIER_CLAIM_SENT (reinicia ciclo reclamo)
  USER_CONFORMITY → [LOGISTICS_SUPERVISOR closes] → CLOSED
```

#### Universal (ambos flujos)
```
Cualquier estado no-terminal → [roles autorizados] → CANCELLED
```

### Ciclo Operativo del Almacen — DO NOT MODIFY

Definido por gerencia. Implementacion: `apps/warehouse/`. El almacen opera en 6 fases secuenciales.

```
FASE 01 — RECEPCION DE MATERIALES Y EQUIPOS
  1. Descarga de Mercaderia
     - Recepcion fisica de mercancia de proveedores o centros de distribucion
     - Conteo general de bultos descargados
  2. Recepcion y Validacion Documentaria
     - Validacion documentaria de la mercaderia recibida
     - Verificacion de Guias de Remision y/o factura del proveedor
     - Conformidad de documentos de transporte
  3. Verificacion Fisica y Documental
     - Comprobar que mercaderia recibida coincida fisica y documentalmente
     - Conteo exacto de productos recibidos
     - Comparacion con la guia de remision
     - Identificacion de diferencias, danos o faltantes

FASE 02 — CONTROL Y VERIFICACION
  Identificacion de danos o errores:
    - Inspeccion visual de empaques y productos
    - Deteccion de golpes, roturas, contaminacion o defectos
    - Verificacion de fechas de vencimiento (si aplica)
    - Diferencias en cantidades (faltantes o sobrantes)
    - Productos incorrectos (no coinciden con la orden)
    - Validacion de codigos y descripciones vs. orden de compra
  Clasificacion de Conformidad:
    - Conforme: cumple con lo solicitado y esta en buen estado
    - No conforme: presenta danos o errores
  Resultado:
    → APROBACION: Autorizacion de ingreso al inventario, registro en sistema, continua a almacenamiento
    → RECHAZO: Separar mercaderia observada, notificar al proveedor, gestion de devolucion o reposicion

FASE 03 — ALMACENAMIENTO
  Estructura del Almacen (2 pisos):
    1er Piso:
      - Pabellon A: secciones A1-A7
      - Pabellon B: secciones B1-B7 + Contenedor
      - Pabellon C: secciones C1-C4
      - Pabellon D: secciones D1-D4
      - Pabellon E: secciones E1-E6
      - Ingreso 1 (entre B y C), Ingreso 2 (junto a E)
      - Escritorios en Pabellones A y C
    2do Piso:
      - Pabellon F
      - Pabellon G (lateral izquierdo)
      - Pabellon H
      - Pabellon I
      - Pabellon J
      - Pabellon K (lateral derecho)
  Formato de ubicacion: {Pabellon}{Seccion}-{Nivel} (ej: B3-2 = Pabellon B, Seccion 3, Nivel 2)
    - Pabellones: A a K
    - Secciones: cada pabellon tiene 4 a 6 secciones
    - Niveles: 1 a 5 (altura)
  Asignacion de ubicacion:
    - Cada producto recibe una posicion especifica
    - Ubicacion fisica segun layout
    - Registro en sistema de la ubicacion exacta
    - Actualizacion de stock
    - Optimizacion por rotacion: Alta, Media y Baja

FASE 04 — PICKING (PREPARACION DE PEDIDOS)
  1. Recepcion del Requerimiento (*)
     - Recibir el RQ y generar lista de picking cruzando con inventario
  2. Identificacion de Ubicaciones (*)
     - Cada producto tiene ubicacion por pabellon, seccion y nivel
     - Verificar en sistema dicha ubicacion
  3. Recorrido por Almacen
     - Seguir lista de picking para localizar y agrupar la mercancia
  4. Extraccion de Productos
     - Tomar los productos, contabilizar los requeridos, movilizar al lugar de despacho
  5. Verificacion y Documentacion
     - Corroborar cantidades, separar de acuerdo al proyecto y ubicacion de descarga
     - Generar Guia de Remision y descuento de stock

FASE 05 — PACKING (EMBALAJE)
  1. Seleccion del empaque segun producto:
     - Bolsa: productos pequenos
     - Caja: productos medianos o fragiles
     - Saco/caja grande: pedidos grandes
  2. Proteccion del producto (trapo industrial, carton, papel)
  3. Adecuacion del paquete (pesados abajo, fragiles arriba, separar delicados)
  4. Cierre del paquete (sellado de seguridad: cinta adhesiva, cinta stretch film)
  5. Etiquetado manual: nombre del proyecto + ubicacion de descarga

FASE 06 — DESPACHO
  1. Carga del Vehiculo
     - Cargar productos al camion o unidad
     - Orden: por ruta (ultimo en entregar va primero), por tipo de producto (fragil, pesado)
     - Asegurar la carga (amarres, proteccion)
  2. Registro de Salida
     - Entregar guias al conductor
     - Registrar: hora de salida, responsable, datos del vehiculo
  3. Reporte de Salida
     - Reportar formalmente la salida para asegurar la recepcion
     - Mencionar lo registrado de la salida
```

(*) Pasos que interactuan directamente con el sistema SYSPCC.

## Key Patterns
- Views use DRF ViewSets with custom permission classes from `apps/core/permissions.py` (plus `apps/rq/permissions.py` and `apps/warehouse/permissions.py`); RQ visibility is scoped in one place, `apps/rq/permissions.get_accessible_requests_queryset`
- Frontend uses `RoleRoute` (`requiredRoles`, `redirectTo`) for role-gated pages and `SuperUserRoute` for `/sistema`
- Rate limits: anon 30/min, auth 200/min, login 5/min, login per username 10/min, plus module scopes (`hr_*`, `warehouse_lookup`, `warehouse_import`) in `REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']`
- Vite proxies `/api` and `/media` to backend in dev
- Test fixtures in `backend/conftest.py`: `api_client`, `user`, `auth_client`, `superuser`, `project`, `department`, role-specific users (`requester`, `project_resident`, `project_control`, `general_manager`, `admin_manager`, `hr_manager`, `pasajes_manager`, `logistics_coordinator`, `site_warehouse`, `direct_supervisor`, …); app-level `conftest.py` in `apps/rq/tests/`, `apps/warehouse/tests/` and `apps/hr/tests/` (e.g. `ops_request`, `admin_request`)
