# SYSPCC — Diseño del Backend Django

**Stack:** Django 5.1.4 + Django REST Framework 3.15.2 | SQLite (desarrollo) / PostgreSQL (producción) | Redis + Celery 5.4
**Auth:** SimpleJWT 5.3.1 en cookies httpOnly (`CookieJWTAuthentication`)
**Fecha:** 2026-10-29 (actualizado al código de `develop`)

Este documento describe el backend tal como está en `backend/`. La tabla completa de transiciones del RQ está en `docs/architecture/system-architecture.md` (sección 3.3); la definición de negocio de los flujos está en `CLAUDE.md`.

---

## 1. Estructura del proyecto Django

```
backend/
├── manage.py
├── requirements.txt
├── conftest.py                    # fixtures globales: api_client, auth_client, usuarios por rol
├── Dockerfile                     # python:3.12-slim + libmagic1 (+ LibreOffice opcional)
├── config/
│   ├── settings/
│   │   ├── base.py                # común a todos los entornos
│   │   ├── development.py         # DEBUG=True, CORS abierto, throttles altos
│   │   ├── production.py          # PostgreSQL, HSTS, cookies seguras, WhiteNoise, S3 opcional
│   │   └── guards.py              # valida HR_CV_PROVIDER
│   ├── urls.py                    # /mgmt-panel/, /api/v1/, /api/schema|docs|redoc/
│   ├── celery.py
│   ├── wsgi.py / asgi.py
└── apps/
    ├── core/
    │   ├── models/                # user.py, project.py, department.py, personal.py, base.py
    │   ├── serializers/ views/ urls/   # auth, users, projects, departments, personal
    │   ├── services/              # user_admin.py, signature.py
    │   ├── authentication.py      # CookieJWTAuthentication (+ CSRF, must_change_password)
    │   ├── permissions.py         # HasRole, IsLogisticsStaff, IsSuperUser, IsHRDocuments*, ...
    │   ├── throttling.py          # AnonThrottle, UserThrottle, LoginUsernameThrottle
    │   ├── middleware.py          # HealthCheckMiddleware, DOConnectingIPMiddleware
    │   ├── exceptions.py          # custom_exception_handler, WorkflowError, ...
    │   ├── fields.py              # EncryptedTextField (Fernet)
    │   └── enums.py               # todas las TextChoices de negocio
    ├── rq/
    │   ├── models/                # request, approval, workflow, supplier, quotation,
    │   │                          # purchase_order, claim, notification, activity_log, attachment
    │   ├── serializers/ views/    # request, supplier, claim, catalog, workflow
    │   ├── services/              # workflow_engine, budget_validator, sla_calculator,
    │   │                          # number_generator, notification_service, request_items,
    │   │                          # request_catalog, stock_availability, stock_diagnostics,
    │   │                          # link_suggestions, units
    │   ├── permissions.py         # get_accessible_requests_queryset, CanPerformWorkflowAction
    │   ├── filters.py · tasks.py · cache.py · throttling.py
    │   └── tests/                 # incluye test_workflow_snapshot.py
    ├── warehouse/
    │   ├── models/                # inventory, movement, receipt, dispatch, inventory_import, onedrive_token
    │   ├── services/              # movements, kardex, locations, epp, exports, pdf_generator,
    │   │                          # onedrive, personal_matching, catalog, imports/
    │   ├── views.py               # InventoryViewSet, MovementViewSet, OneDriveViewSet, PendingRequestsViewSet
    │   ├── views_imports.py       # InventoryImportViewSet
    │   ├── views_personal.py      # PersonalLookupViewSet
    │   └── permissions.py · tasks.py · throttling.py · query_guard.py
    ├── administracion/            # models.py, serializers.py, services.py, views.py
    ├── hr/
    │   ├── models/                # document_template, generated_document, document_event,
    │   │                          # cv_analysis, cv_analysis_item
    │   ├── services/              # contratos (template/document/docx/pdf) y CVs (cv_*)
    │   ├── views/                 # template, document, cv, assistant, meta
    │   └── storage.py · middleware.py · tasks.py · enums.py
    └── support/                   # models.py, serializers.py, services.py, views.py
```

Convención: en `core`, `rq`, `warehouse` y `hr` los modelos viven en `models/` (un archivo por entidad) y se reexportan en `models/__init__.py`. `administracion` y `support` usan un único `models.py`.

---

## 2. Modelos de Django

Todos los enums están en `apps/core/enums.py` (salvo los de RR. HH., en `apps/hr/enums.py`). `TimeStampedModel` (`apps/core/models/base.py`) aporta `created_at` y `updated_at`.

### 2.1 App `core`

**`User`** (`AbstractUser`, tabla `users`, `USERNAME_FIELD = 'username'`): `email` (único), `first_name`, `last_name`, `position`, `department` (texto libre), `phone`, `avatar_url`, `signature` (imagen), `must_change_password`. Métodos: `get_roles()`, `has_role(role)`.

**`UserRole`** (tabla `user_roles`): `user`, `role` (`RoleChoices`), `project` (FK opcional), `department_obj` (FK opcional), `is_primary`, `assigned_at`. Único por (`user`, `role`, `project`, `department_obj`).

```python
class RoleChoices(models.TextChoices):   # 13 roles
    REQUESTER, GENERAL_MANAGER, CENTRAL_WAREHOUSE,                         # comunes
    PROJECT_RESIDENT, PROJECT_CONTROL, LOGISTICS_COORDINATOR, SITE_WAREHOUSE,  # Operaciones
    DIRECT_SUPERVISOR, ADMIN_MANAGER, LOGISTICS_SUPERVISOR, LOGISTICS_CHIEF,   # Administración
    PASAJES_MANAGER,                                                       # Pasajes
    HR_MANAGER                                                             # RR. HH.
```

**`Project`** (`TimeStampedModel`): `code` (único), `name`, `location`, `client`, `frente`, `total_budget`, `start_date`, `end_date`, `is_active`.
**`ProjectBudgetLine`**: `project`, `code`, `description`, `budgeted_amount`, `committed_amount`, `spent_amount`; propiedad `available_amount`.
**`Department`**: `code` (único), `name`, `frente`, `manager`, `is_active`.
**`AnnualPlan`**: `year`, `department`, `total_budget`, `approved_by`, `approved_at`, `is_active` (único por año y departamento).
**`AnnualPlanLine`**: `annual_plan`, `code`, `description`, `category`, `budgeted_amount`, `committed_amount`, `spent_amount`.
**`Personal`**: ficha del trabajador (DNI único, datos personales, contacto de emergencia, residencia, formación, estado laboral, `proyecto`, `puesto`, `salario`, datos bancarios, hijos, tallas) y `user` (OneToOne opcional). Propiedad `edad`.

### 2.2 App `rq`

**`Request`** (tabla `requests`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `rq_number` | CharField único | `RQ-YYYY-NNNN`, generado por `RQNumberGenerator` |
| `flow` | `RQFlowChoices` | `OPERATIONS` / `ADMINISTRATIVE` |
| `project` / `department` | FK opcionales | OPS exige proyecto; ADM exige departamento |
| `requested_by` | FK `User` | |
| `requesting_area` | `RequestingAreaChoices` | `OP`, `QC`, `HSE`, `ADM` (SYSPCC-026) |
| `front_area`, `service`, `specific_use`, `description`, `justification` | texto | El frente `OFICINA CENTRAL` obliga a usar el flujo ADM (SYSPCC-019) |
| `acquisition_type` | `AcquisitionTypeChoices` | 6 tipos (compra local, foránea, importación, fabricación, alquiler, calibración) |
| `priority` | `PriorityChoices` | `URGENT`, `HIGH`, `NORMAL` (por defecto), `LOW` |
| `status` | `RQStatusChoices` | 47 valores; ver arquitectura §3.1 |
| `current_step` | FK `WorkflowStep` | |
| `budget_classification` | `BudgetClassificationChoices` | `BC_WITHIN_PROPOSAL`, `BC_ADDITIONAL`, `BC_WITHIN_ANNUAL_PLAN`, `BC_OUT_OF_ANNUAL_PLAN` |
| `budget_line` / `annual_plan_line` | FK opcionales | OPS / ADM |
| `estimated_cost`, `final_cost` | Decimal | |
| `fecha_necesidad`, `fecha_estimada_entrega`, `fecha_real_entrega` | Date | La estimada se calcula al validar |

Propiedades: `is_terminal` y `total_items_cost` (agregado en BD, en `Decimal`).

**`RequestItem`** (tabla `request_items`, único por `request` + `line_number`): `description`, `specifications`, `quantity` (mínimo 0.001), `unit`, `unit_price`, `total_price` (calculado en `save()`), `stock_almacen_obra`, `stock_almacen_central`, `x_atender`, `presupuestado_adicional`, `rfi_fwo`, `estatus_guia`, `supply_source` (`STOCK` / `PURCHASE`), `inventory_item` (FK a `warehouse.Inventory`), `is_off_catalog`, `inventory_item_confirmed_at`, `inventory_item_confirmed_by`, `item_source` (`ItemSourceChoices`: EPP, herramientas, materiales, equipos, formatería, consumibles, unidades, útiles, gases), `comentarios`. Restricción `request_item_not_linked_and_off_catalog`: una línea no puede estar vinculada al catálogo y marcada fuera de catálogo a la vez. Propiedad `link_confirmed`.

**`Approval`** (tabla `approvals`): `request`, `workflow_step`, `action` (`ApprovalActionChoices`, 37 valores), `performed_by`, `role` (incluye `SYSTEM` en transiciones automáticas), `previous_status`, `new_status`, `comments`, `performed_at`. Por convención solo se crea, nunca se actualiza.

**`WorkflowStep`**: `flow`, `step_order`, `step_code`, `step_name`, `responsible_role`, `from_status`, `to_status_approve`, `to_status_reject`, `is_conditional`, `condition_description`, `is_terminal_on_reject`, `phase`. Únicos (`flow`, `step_order`) y (`flow`, `step_code`).
**`AcquisitionTypeConfig`**: `type`, `min_days`, `max_days`, `max_extended_days` y banderas `requires_*_approval`. La usa `SLACalculator`.

**`Supplier`**: `ruc` (único, 11 caracteres), `business_name`, `trade_name`, datos de contacto, `address`, `city`, `category`, `is_active`.
**`Quotation`** / **`QuotationItem`**: cotización por RQ y proveedor (`quotation_number`, `total_amount`, `currency`, `delivery_days`, `payment_terms`, `validity_days`, `document_url`, `is_selected`, `selected_by`, `selected_at`) y sus ítems (`unit_price`, `quantity`, `total_price`, `brand`, `model`).
**`PurchaseOrder`** / **`PurchaseOrderItem`**: `po_number` (`OC-YYYY-NNNN`, `PONumberGenerator`), `request`, `quotation`, `supplier`, `generated_by`, `status` (`POStatusChoices`: `DRAFT`, `SENT`, `CONFIRMED`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`, `CANCELLED`), montos y fechas.
**`Claim`**: `claim_type` (`SUPPLIER_CLAIM` / `USER_COMPLAINT`), `status` (`OPEN`, `IN_REVIEW`, `RESOLVED`, `CLOSED`), `raised_by`, `managed_by`, `resolved_by`, `description`, `resolution`.
**`Notification`**: notificación in-app (`user`, `request`, `title`, `message`, `is_read`, `dedup_key` único cuando no es nulo).
**`ActivityLog`**: `request`, `user`, `action`, `detail`, `ip_address`.
**`Attachment`**: `file_name`, `file_path`, `file_type`, `file_size`, `category`, `description`, `uploaded_by`.

### 2.3 App `warehouse`

**`Inventory`** (catálogo, tabla `inventory`): `product_code` (único), `description`, `unit`, `category`, `item_type` (`EQUIPMENT`, `CONSUMABLE`, `TOOL`, `MATERIAL`, `EPP`), `brand`, `model_name`, `location` (formato `{Pabellón}{Sección}-{Nivel}`), `min_stock` y, desde SYSPCC-025, `order_number`, `purchase_order_ref`, `packing_list`, `size`, `floor` (1er/2do piso cuando aún no hay ubicación exacta), `observation`, `project`. Propiedades derivadas `location_status` (`EXACT` / `FLOOR_ONLY` / `NONE`) y `location_display`.

**`InventoryStock`**: `inventory`, `warehouse_type` (`CENTRAL`, `SITE`, `OFFICE`), `project`, `department`, `quantity`. Único por (`inventory`, `warehouse_type`, `project`, `department`); `CheckConstraint` `quantity >= 0`.

**`MovementGroup`** (vale): `group_number` (único), `movement_type` (`ENTRY`, `EXIT`, `TRANSFER`, `ADJUSTMENT`), `warehouse`, `project`, `source_type`, `supplier_name`, `invoice_number`, `destination_type`, `destination_detail`, `movement_date`, `voucher_number`, `po_number`, `guide_number`, `internal_transfer`, `destination_personal`, `document_url`, `registered_by`.

**`InventoryMovement`**: una línea de movimiento (`movement_number`, `movement_type`, `inventory`, `quantity`, `warehouse`, `project`, origen y destino, `requested_by`, `authorized_by`, `group`, `movement_date`, `voucher_number`, `po_number`, `guide_number`, `internal_transfer`, `tag`, `destination_personal`, `source_key`, `import_batch`, `document_url`, `registered_by`).

**`WarehouseReceipt`** / **`WarehouseReceiptItem`** y **`WarehouseDispatch`** / **`WarehouseDispatchItem`**: recepción y despacho formales ligados a un RQ y a un `MovementGroup`; los crea `WorkflowEngine` en las acciones `RECEIVED` y `DISPATCHED`.

**`InventoryImport`** (UUID): importación en dos pasos del Excel "INVENTARIO PCC - ALM" (`status`: `PREVIEWED`, `PROCESSING`, `CONFIRMED`, `CANCELLED`, `EXPIRED`, `FAILED`; `file_sha256`, `file_bytes`, `summary`, `problems`, `plan_digest`, `result`, `expires_at`).

**`OneDriveToken`**: `access_token` y `refresh_token` cifrados en reposo (`EncryptedTextField`).

### 2.4 App `administracion`

**`Pasaje`**: viaje (`tipo` `B` / `S` / `S/B`, fechas, embarque y destino de bajada/subida), trabajador (`personal`, `dni`, `nombres`, `cargo`, `tipo_trabajador` `STAFF` / `WORKER`), `centro_costo` (FK `Project`), facturación (`proveedor`, `ruc`, `razon_social`, `factura_ticket`, `fecha`, `mes`), importes (`moneda` `SOLES` / `DOLARES`, `monto_con_igv_soles`, `monto_con_igv_dolares`, `tipo_cambio`, `devolucion`, `total`), pago (`estado` `PENDIENTE` / `PAGADO`, `fecha_pago`, `numero_operacion`), `codigo_id_legado` (único, para reimportar el CSV histórico) y auditoría. `save()` deriva `mes` y calcula `total` en soles.
**`PoliticaPasajeDevoluciones`**: `tipo_trabajador`, `tramo`, `en_dolares`, `no_devolucion`, `monto_dolares`, `monto_soles`, `habilitado`.
**`ProveedorPasajes`**: `ruc` (único), `razon_social`.
**`Puesto`**: `cargo` (único), `habilitado`.

### 2.5 App `hr`

**`DocumentTemplate`**: plantilla Word versionada (`document_type`, `slug`, `name`, `version`, `file`, `file_sha256`, variables detectadas / desconocidas / faltantes, `is_active`).
**`GeneratedDocument`**: contrato generado (`template`, `template_version`, `template_sha256`, `personal`, `subject_name`, `data`, `status` `DRAFT` / `ISSUED` / `VOIDED`, `source` `MANUAL` / `ASSISTANT`, `docx_file`, `pdf_file`, `reference_number`, emisión y anulación).
**`DocumentEvent`**: bitácora del documento (`CREATED`, `UPDATED`, `ISSUED`, `VOIDED`, `DOWNLOADED`, `PDF_RENDERED`).
**`CVAnalysis`**: proceso de selección (`name`, `requirements_text`, `requirements`, convocatoria opcional y su costo de extracción).
**`CVAnalysisItem`**: un CV (`kind` `PDF` / `DOCX` / `IMAGE`, `status` `QUEUED` / `PROCESSING` / `DONE` / `FAILED` / `CANCELLED`, `result`, `score`, `recommendation` `ADVANCE` / `REVIEW` / `NO_ADVANCE`, tokens y costo, `report_pdf`).

### 2.6 App `support`

**`Ticket`** (`TimeStampedModel`): `ticket_number` (`TK-YYYYMMDD-XXXX`, generado en `save()`), `title`, `description`, `category` (7 valores), `priority` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), `status` (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`), `created_by`, `assigned_to`, `resolved_at`.
**`TicketComment`**: `ticket`, `author`, `content`, `is_status_change`, `old_status`, `new_status`.

---

## 3. Máquina de estados del RQ

### 3.1 Tabla de transiciones

`apps/rq/services/workflow_engine.py` define `TRANSITIONS` como lista de diccionarios (71 entradas). Ejemplo literal:

```python
{
    'flow': RQFlowChoices.OPERATIONS,
    'from_status': RQStatusChoices.TECHNICAL_APPROVED,
    'action': ApprovalActionChoices.BUDGET_CLASSIFIED,
    'required_role': RoleChoices.PROJECT_CONTROL,
    'to_status': None,
    'to_status_reject': None,
    'conditional': True,
    'handler': 'handle_ops_budget_classification',
},
```

- `flow` puede ser `RQFlowChoices.OPERATIONS`, `RQFlowChoices.ADMINISTRATIVE` o `ANY` (`'__ANY__'`).
- `from_status=None` solo aparece en la cancelación universal.
- `system_action=True` marca las transiciones automáticas hacia `VALIDATED`.
- `handler` nombra un método de `WorkflowEngine` que decide el destino según `extra_data`.

La tabla está congelada por `apps/rq/tests/test_workflow_snapshot.py`. Cambiarla exige autorización de gerencia y actualizar el snapshot en el mismo PR.

### 3.2 `WorkflowEngine`

```python
engine = WorkflowEngine(request, user, acting_role)
approval = engine.execute(action, comments='', extra_data=None)   # -> Approval
actions  = engine.get_available_actions()                         # -> list[dict]
```

Pasos de `execute` (dentro de `transaction.atomic`):
1. `_validate_acting_role()`: el usuario debe tener asignado el `acting_role` que declara; si no, `PermissionDeniedForAction`.
2. Relee el RQ con `select_for_update()` (SYSPCC-007).
3. Rechaza acciones sobre estados terminales (salvo `CANCELLED`, que el handler también rechaza).
4. `_find_transition(action)` por flujo, estado y acción; si no existe, `WorkflowError`.
5. `_check_role_permission()`: el usuario debe tener el `required_role` de la transición.
6. Calcula el destino (fijo o vía handler), asigna `current_step` y aplica efectos secundarios (`_apply_side_effects`).
7. Guarda, crea `Approval`, `ActivityLog` y notificaciones in-app.
8. `_execute_system_chain()` encadena las transiciones automáticas (por ejemplo `WITHIN_PROPOSAL` → `VALIDATED`).

Handlers: `handle_ops_budget_classification` (`classification`), `handle_adm_budget_review` (`within_plan`), `handle_stock_check` (`has_stock`), `handle_cancellation`. Existe además `handle_quote_to_po`, pero ninguna entrada de `TRANSITIONS` lo referencia.

Efectos secundarios: al validar, `SLACalculator.calculate_estimated_delivery` y `BudgetValidator.commit_budget`; al cancelar o rechazar de forma terminal, `BudgetValidator.release_budget`; en `RECEIVED`, vale de ingreso + `WarehouseReceipt`; en `DISPATCHED`, vale de egreso + `WarehouseDispatch`. Los errores de presupuesto, inventario y notificaciones se registran en el log y no anulan la transición. La resolución del producto usa el FK `inventory_item`; si no existe, intenta una coincidencia por texto (registrada como advertencia), y nunca para líneas `is_off_catalog`.

### 3.3 Otros servicios de `rq`

| Servicio | API pública |
|----------|-------------|
| `BudgetValidator` | `validate(request)`, `commit_budget(request)`, `release_budget(request)` |
| `SLACalculator` | `calculate_estimated_delivery(acquisition_type, from_date=None, use_max=False)`, `get_sla_days(acquisition_type)` |
| `RQNumberGenerator` / `PONumberGenerator` | `generate()` → `RQ-YYYY-NNNN` / `OC-YYYY-NNNN` |
| `NotificationService` | `notify_on_transition(request, action, new_status, actor)`; destinatarios según `NOTIFY_MAP` |
| `request_items` | `update_request_items(request_obj, items_data, user)` (confirmación de logística, bloqueo y 409 ante conflicto) |
| `request_catalog` | `search_catalog(raw_term)`, `central_pool_available(inventory_ids)` |
| `stock_availability` | `build_stock_availability(request_obj)` (cobertura por línea contra el pool central) |

---

## 4. Endpoints REST principales

### 4.1 Configuración de URLs

```python
# config/urls.py (resumen)
urlpatterns = [
    path('mgmt-panel/', admin.site.urls),
    path('api/v1/', include([
        path('auth/', include('apps.core.urls.auth', namespace='auth')),
        path('', include('apps.core.urls.users', namespace='users')),
        path('', include('apps.core.urls.projects', namespace='projects')),
        path('', include('apps.core.urls.departments', namespace='departments')),
        path('', include('apps.core.urls.personal', namespace='personal')),
        path('', include('apps.rq.urls', namespace='rq')),
        path('warehouse/', include('apps.warehouse.urls', namespace='warehouse')),
        path('administracion/', include('apps.administracion.urls', namespace='administracion')),
        path('hr/', include('apps.hr.urls', namespace='hr')),
        path('support/', include('apps.support.urls', namespace='support')),
    ])),
    path('api/schema/', SpectacularAPIView.as_view(permission_classes=[IsAdminUser])),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema', permission_classes=[IsAdminUser])),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema', permission_classes=[IsAdminUser])),
]
```

### 4.2 Autenticación (`/api/v1/auth/`)

| Método | URL | Descripción | Permiso |
|--------|-----|-------------|---------|
| `GET` | `csrf/` | Fija la cookie `csrftoken` | Público |
| `POST` | `login/` | Fija `access_token` (15 min) y `refresh_token` (1 día) como cookies httpOnly; devuelve el perfil | Público, throttles `login` (5/min por IP) y `login_user` (10/min por usuario) |
| `POST` | `token/refresh/` | `TokenRefreshView` estándar de SimpleJWT: lee `refresh` del cuerpo | Público |
| `POST` | `token/verify/` | `TokenVerifyView` estándar | Público |
| `POST` | `logout/` | Agrega el refresh a la blacklist y borra las cookies | Autenticado |

### 4.3 Usuarios, proyectos y catálogos de `core`

| URL | Lectura | Escritura |
|-----|---------|-----------|
| `users/` | Autenticado | `is_superuser` (no hay borrado: `destroy` → 405) |
| `users/me/`, `users/me/change-password/`, `users/me/signature/` | Usuario actual | Usuario actual |
| `users/{id}/reset-password/`, `activate/`, `deactivate/` | — | `is_superuser` |
| `user-roles/` | Autenticado | `is_superuser` (solo `POST` / `DELETE`) |
| `projects/` (+ `activate/`, `deactivate/`) | Autenticado | `is_superuser` (no hay borrado) |
| `project-budget-lines/`, `departments/`, `annual-plans/`, `annual-plan-lines/` | Autenticado | `is_staff` (`IsAdminOrReadOnly`) |
| `personal/` (`list`, `retrieve`, `export/`) | `IsHRManager` (`ADMIN_MANAGER`, `PASAJES_MANAGER`, `GENERAL_MANAGER` o `is_staff`) | `is_staff` |
| `personal/buscar-dni/` | `IsPasajesStaff` | — |

### 4.4 Requerimientos (`/api/v1/requests/`)

| Método | URL | Descripción | Permiso |
|--------|-----|-------------|---------|
| `GET` | `requests/` | Lista filtrada (`RequestFilter`: `flow`, `status`, `status_in`, `priority`, `acquisition_type`, `project`, `department`, `requested_by`, `rq_number`) | Autenticado, con alcance |
| `POST` | `requests/` | Crea el RQ con sus ítems (`RequestCreateSerializer`) directamente en `SUBMITTED`, con número generado por el servidor y un `Approval` `DRAFT` → `SUBMITTED`; no pasa por `WorkflowEngine` | Autenticado |
| `GET` | `requests/{id}/` | Detalle | Autenticado, con alcance |
| `PUT/PATCH/DELETE` | `requests/{id}/` | Solo en `DRAFT` | Autenticado, con alcance |
| `POST` | `requests/{id}/action/` | Ejecuta una acción del workflow | `CanPerformWorkflowAction` + `WorkflowEngine` |
| `GET` | `requests/{id}/available-actions/` | Acciones disponibles (`?role=`; por defecto el rol primario) | Autenticado, con alcance |
| `GET` | `requests/{id}/approvals/`, `activity/`, `attachments/` | Historial, bitácora y adjuntos | Autenticado, con alcance |
| `PATCH` | `requests/{id}/update-items/` | Logística confirma producto o fuera de catálogo, fuente y `supply_source` por línea | `IsLogisticsStaff` |
| `GET` | `requests/{id}/stock-availability/` | Solicitado vs. stock neto del pool central | `IsLogisticsStaff` |
| `GET` | `request-catalog/?search=` | Búsqueda del catálogo del almacén para armar el RQ | Autenticado, throttle `rq_catalog` (120/min por defecto) |

Cuerpo de `action/` (`WorkflowActionSerializer`):

```json
{
  "action": "BUDGET_CLASSIFIED",
  "acting_role": "PROJECT_CONTROL",
  "comments": "Dentro de la partida 02.01",
  "extra_data": { "classification": "BC_WITHIN_PROPOSAL" }
}
```

Respuesta 200: el `Approval` creado (`ApprovalSerializer`). Errores: 400 si la transición no es válida, 403 si el usuario no tiene el rol.

### 4.5 Proveedores, cotizaciones, OC y otros recursos de `rq`

| URL | Lectura | Escritura |
|-----|---------|-----------|
| `suppliers/` | Autenticado (catálogo global) | `is_staff` (`IsAdminOrReadOnly`) |
| `quotations/` (+ `{id}/select/`) | Autenticado, filtrado por RQ accesible | `IsLogisticsStaff` |
| `purchase-orders/` | Autenticado, filtrado por RQ accesible | `IsLogisticsStaff` (el número lo genera el servidor) |
| `claims/` | Autenticado, con alcance | Crear: autenticado; editar/borrar: `IsLogisticsStaff` |
| `notifications/` (+ `mark-read/`, `mark-all-read/`, `unread-count/`) | Propias | — |
| `activity-logs/` | Autenticado, con alcance | — |
| `attachments/` | Staff y logística: todos; resto: adjuntos de sus RQ | `GET`, `POST`, `DELETE` |
| `acquisition-type-configs/`, `workflow-steps/` | Autenticado (solo lectura) | — |

### 4.6 Almacén (`/api/v1/warehouse/`)

| URL | Descripción | Permiso |
|-----|-------------|---------|
| `inventory/` | CRUD del catálogo con stock | `IsWarehouseRole`; cambiar ubicación/piso/proyecto exige además `CanAssignLocations` |
| `inventory/{id}/kardex/`, `recent-movements/` | Kardex y últimos movimientos del ítem | `IsWarehouseRole` |
| `inventory/categories/`, `alerts/`, `check-stock/`, `summary/`, `location-layout/`, `export/` | Auxiliares de lectura | `IsWarehouseRole` |
| `inventory/assign-locations/` | Asignación de ubicaciones (Fase 03) | `CanAssignLocations` |
| `inventory/movement-summary/` (+ `export/`) | Resumen de movimiento (inicial, ingresos, egresos, stock) | `IsWarehouseRole` |
| `movements/` (lectura) | Movimientos con filtros | `IsWarehouseRole` |
| `movements/entry/`, `exit/`, `batch-entry/`, `batch-exit/` | Registro de ingresos y egresos | `IsWarehouseRole` + alcance por almacén (`movement_scope_error`) |
| `movements/epp-delivery/` | Entrega de EPP con vale a un trabajador | `CanDeliverEPP` |
| `movements/link-personal/` | Vincular destinos de texto a trabajadores | `CanLinkPersonal` |
| `movements/{id}/voucher/`, `{id}/pdf/`, `groups/{id}/voucher/`, `groups/{id}/pdf/`, `export/` | Vales y exportaciones | `IsWarehouseRole` |
| `pending-requests/list/`, `count/` | RQ pendientes de acción del almacén | `IsWarehouseRole` |
| `personal-lookup/` | Búsqueda de trabajadores | `CanLookupPersonal` |
| `imports/` (+ `{id}/problems/`, `problems/export/`, `template/`, `{id}/confirm/`) | Importación en dos pasos del Excel | Lectura: `IsWarehouseRole`; subir, confirmar y cancelar: `CanImportInventory` |
| `onedrive/status/`, `connect/`, `poll/`, `disconnect/` | Conexión a OneDrive | `status/`: autenticado; el resto: `is_staff` o `is_superuser` (`IsAdminUser` local de `warehouse/views.py`) |

### 4.7 Administración, RR. HH. y Soporte

| Prefijo | Recursos | Permiso |
|---------|----------|---------|
| `/administracion/` | `pasajes/` (+ `por-dni/`, `calcular-devolucion/`, `{id}/marcar-pagado/`, `export/`), `proveedores-pasajes/` (+ `buscar-ruc/`), `politicas-devolucion/` (+ `por-tipo/`), `puestos/`, `tipo-cambio/` | `IsAdminOrAdminManager` (`ADMIN_MANAGER`, `GENERAL_MANAGER`, `PASAJES_MANAGER` o `is_staff`) |
| `/hr/` | `templates/` (+ `activate/`, `deactivate/`, `download/`), `documents/` (+ `issue/`, `void/`, `render-pdf/`, `download/`, `events/`), `cv-analyses/` (+ `config/`, `progress/`, `retry-failed/`, `resume/`, `cancel/`, `posting/`, `posting/file/`, `posting/extract/`, `download-zip/`, `download-xlsx/`), `cv-analyses/{id}/items/` (+ `retry/`, `report/`, `file/`), `document-types/`, `personal/`, `assistant/status/`, `assistant/extract/` | Lectura: `IsHRDocumentsReader` (`HR_MANAGER`, `GENERAL_MANAGER`); escritura: `IsHRDocumentsManager` (`HR_MANAGER`) |
| `/support/` | `tickets/` (+ `change-status/`, `add-comment/`, `my-stats/`) | Autenticado; cada usuario ve sus tickets, `is_staff` ve todos |

---

## 5. Permisos

Clases en `apps/core/permissions.py`: `HasRole` (lee `role_required` de la vista), `IsGeneralManager`, `IsLogisticsStaff`, `IsWarehouseStaff`, `IsHRManager`, `IsHRDocumentsManager`, `IsHRDocumentsReader`, `IsPasajesStaff`, `IsAdminOrReadOnly`, `IsSuperUser`, `IsOwnerOrAdmin`.

Clases en `apps/rq/permissions.py`: `CanPerformWorkflowAction` y la función `get_accessible_requests_queryset(user)`, única fuente del alcance de visibilidad de RQ (también la usan cotizaciones y OC).

Clases en `apps/warehouse/permissions.py`: `IsWarehouseRole`, `CanImportInventory`, `CanAssignLocations`, `CanLinkPersonal`, `CanDeliverEPP`, `CanLookupPersonal` y el helper `movement_scope_error` (por ejemplo, `SITE_WAREHOUSE` solo opera el almacén de obra). Ninguna concede bypass por `is_staff` / `is_superuser`.

Todos los roles se verifican contra `UserRole` en la base de datos, nunca solo contra el rol que declara el cliente.

---

## 6. Settings clave

```python
# config/settings/base.py (extractos)
AUTH_USER_MODEL = 'core.User'
LOCAL_APPS = ['apps.core', 'apps.rq', 'apps.warehouse', 'apps.administracion', 'apps.support', 'apps.hr']

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['apps.core.authentication.CookieJWTAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_FILTER_BACKENDS': [DjangoFilterBackend, SearchFilter, OrderingFilter],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'EXCEPTION_HANDLER': 'apps.core.exceptions.custom_exception_handler',
    'DEFAULT_THROTTLE_CLASSES': ['apps.core.throttling.AnonThrottle', 'apps.core.throttling.UserThrottle'],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '30/min', 'user': '200/min', 'login': '5/min', 'login_user': '10/min',
        'hr_assistant': '20/min', 'hr_download': '60/min',
        'hr_cv_upload': '60/min', 'hr_cv_progress': '90/min', 'hr_cv_posting': '20/min',
        'warehouse_lookup': '120/min', 'warehouse_import': '10/hour',
    },
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'TOKEN_OBTAIN_SERIALIZER': 'apps.core.serializers.auth.CustomTokenObtainPairSerializer',
}

CACHES = {'default': {'BACKEND': 'django_redis.cache.RedisCache', 'LOCATION': REDIS_URL, ...}}
SESSION_ENGINE = 'django.contrib.sessions.backends.cache'
CELERY_TIMEZONE = 'America/Lima'
LANGUAGE_CODE = 'es-pe'
TIME_ZONE = 'America/Lima'
```

La base de datos por defecto es SQLite (`DB_ENGINE` y `DB_NAME` por entorno); `production.py` fija PostgreSQL con `sslmode` configurable (`DB_SSLMODE`). `development.py` sube los límites de throttling (por ejemplo `anon` 300/min, `user` 1000/min, `login` 30/min) y abre CORS.

---

## 7. Tareas asíncronas y comandos de gestión

`CELERY_BEAT_SCHEDULE` (`base.py`), zona horaria America/Lima:

| Entrada | Tarea | Horario | Qué hace |
|---------|-------|---------|----------|
| `check-sla-deadlines` | `rq.check_sla_deadlines` | 08:00 | Notificación in-app al solicitante por RQ vencidos o próximos a vencer |
| `send-pending-approval-reminders` | `rq.send_pending_approval_reminders` | 09:00 y 14:00 | Recordatorio in-app de RQ sin cambios por más de 24 h en estados de revisión |
| `invalidate-dashboard-caches` | `rq.invalidate_dashboard_caches` | Cada 15 min | Borra las claves `*dashboard_stats:*` |
| `warehouse-low-stock-check` | `warehouse.check_low_stock` | 07:30 | Correo a `WAREHOUSE_ALERT_RECIPIENTS` con ítems bajo el stock mínimo |
| `warehouse-purge-stale-imports` | `warehouse.purge_stale_imports` | 03:00 | Vence previsualizaciones y borra los Excel guardados de importaciones |
| `hr-cv-requeue-stale` | `hr.cv_requeue_stale` | Cada 5 min | Reencola CVs atascados en `QUEUED` / `PROCESSING` |

Tareas bajo demanda: `warehouse.upload_group_pdf` (sube el PDF del vale a OneDrive) y `hr.process_cv_item` (analiza un CV). `CELERY_TASK_ROUTES` envía `hr.process_cv_item` y `hr.cv_requeue_stale` a la cola `hr_cv`, que atiende el servicio `celery_worker_hr` (`celery -A config worker -Q hr_cv -c 3`). El despacho de CVs se elige con `HR_CV_DISPATCH` (`celery`, `thread` o `inline`).

Comandos de gestión: `seed_data`, `seed_demo`, `seed_demo_extra`, `seed_screenshots` (core); `import_pasajes_csv`, `seed_administracion`, `seed_pasajes_demo` (administracion); `seed_hr_template`, `hr_cv_purge_orphans` (hr); `import_warehouse_excel` (warehouse); `check_central_project_stock`, `report_rq_stock_gaps`, `suggest_inventory_links` (rq).

---

## 8. Dependencias (`backend/requirements.txt`)

```
Django==5.1.4
djangorestframework==3.15.2
djangorestframework-simplejwt==5.3.1
django-cors-headers==4.6.0
django-filter==24.3
drf-spectacular==0.27.2
python-decouple==3.8
psycopg2-binary==2.9.10
pandas==2.2.3
openpyxl==3.1.5
Pillow==11.0.0
python-magic==0.4.27
reportlab==4.2.5
requests==2.32.3
cryptography==43.0.3
docxtpl==0.20.2
lxml==6.1.3
python-docx==1.2.0
num2words==0.5.14
anthropic==1.11.0
pydantic==2.13.5
pypdf==6.19.0
pytest==8.3.4
pytest-django==4.9.0
factory-boy==3.3.1
django-redis==5.4.0
redis==5.2.1
celery==5.4.0
django-celery-beat==2.7.0
gunicorn==23.0.0
whitenoise==6.8.2
django-storages[s3]==1.14.4
boto3==1.35.99
```
