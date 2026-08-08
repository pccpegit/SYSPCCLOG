# SYSPCC — Diagrama de Clases

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.0 | **Fecha:** Abril 2026 | **Empresa:** PCC Ingeniería y Construcción

---

## 1. Diagrama de Clases Completo — Módulo Core

```mermaid
classDiagram
    direction TB

    class User {
        <<Django AbstractUser>>
        +int id
        +str username
        +str email ❰unique❱
        +str first_name
        +str last_name
        +str position
        +str department
        +str phone
        +str avatar_url
        +ImageField signature
        +datetime date_joined
        +bool is_active
        +bool is_staff
        --
        +get_roles() List~str~
        +has_role(role: str) bool
    }

    class UserRole {
        +int id
        +ForeignKey user → User
        +str role ❰RoleChoices❱
        +ForeignKey project → Project ❰nullable❱
        +ForeignKey department_obj → Department ❰nullable❱
        +bool is_primary
        +datetime assigned_at
        --
        ❰unique_together❱ (user, role, project, department_obj)
    }

    class RoleChoices {
        <<enumeration>>
        REQUESTER
        PROJECT_RESIDENT
        PROJECT_CONTROL
        GENERAL_MANAGER
        LOGISTICS_COORDINATOR
        CENTRAL_WAREHOUSE
        SITE_WAREHOUSE
        DIRECT_SUPERVISOR
        ADMIN_MANAGER
        LOGISTICS_SUPERVISOR
        LOGISTICS_CHIEF
    }

    class Project {
        +int id
        +str code ❰unique❱
        +str name
        +str location
        +str client
        +str frente
        +Decimal total_budget
        +date start_date
        +date end_date
        +bool is_active
    }

    class ProjectBudgetLine {
        +int id
        +ForeignKey project → Project
        +str code
        +str description
        +Decimal budgeted_amount
        +Decimal committed_amount
        +Decimal spent_amount
        --
        +available_amount() Decimal ❰property❱
        ❰unique_together❱ (project, code)
    }

    class Department {
        +int id
        +str code ❰unique❱
        +str name
        +str frente
        +ForeignKey manager → User
        +bool is_active
    }

    class AnnualPlan {
        +int id
        +int year
        +ForeignKey department → Department
        +Decimal total_budget
        +ForeignKey approved_by → User
        +datetime approved_at
        +bool is_active
        --
        ❰unique_together❱ (year, department)
    }

    class AnnualPlanLine {
        +int id
        +ForeignKey annual_plan → AnnualPlan
        +str code
        +str description
        +str category
        +Decimal budgeted_amount
        +Decimal committed_amount
        +Decimal spent_amount
        --
        +available_amount() Decimal ❰property❱
        ❰unique_together❱ (annual_plan, code)
    }

    class Personal {
        +int id
        +str dni ❰unique❱
        +str apellidos_nombres
        +date fecha_nacimiento
        +str sexo
        +str estado_civil
        +str celular
        +str email_personal
        +str estado ❰ACTIVO|CESADO|VACACIONES|LICENCIA❱
        +date fecha_ingreso
        +date fecha_cese
        +str motivo_cese
        +ForeignKey proyecto → Project
        +str sede
        +str puesto
        +str guardia
        +str condicion_trabajo
        +Decimal salario
        +str sistema_pensiones
        +str entidad_bancaria
        +str numero_cuenta
        +str cci
        +bool tiene_hijos
        +int cantidad_hijos_menores
        +bool asignacion_familiar
        +str numero_fotocheck
        +str talla_zapato
        +str talla_pantalon
        +str talla_camisa
        +OneToOneField user → User ❰nullable❱
        --
        +edad() int ❰property❱
    }

    User "1" --> "*" UserRole : has
    UserRole --> RoleChoices : uses
    UserRole "*" --> "0..1" Project : scoped_to
    UserRole "*" --> "0..1" Department : scoped_to
    Project "1" --> "*" ProjectBudgetLine : has
    Department "1" --> "*" AnnualPlan : has
    AnnualPlan "1" --> "*" AnnualPlanLine : has
    Department "*" --> "1" User : managed_by
    Personal "0..1" --> "0..1" User : linked_to
    Personal "*" --> "0..1" Project : assigned_to
    AnnualPlan "*" --> "0..1" User : approved_by
```

---

## 2. Diagrama de Clases — Módulo RQ (Requerimientos)

```mermaid
classDiagram
    direction TB

    class Request {
        +int id
        +str rq_number ❰auto, unique❱
        +str flow ❰OPERATIONS|ADMINISTRATIVE❱
        +ForeignKey project → Project ❰nullable❱
        +ForeignKey department → Department ❰nullable❱
        +ForeignKey requested_by → User
        +str front_area
        +str service
        +str specific_use
        +text description
        +text justification
        +str acquisition_type
        +str priority ❰LOW|MEDIUM|HIGH|URGENT❱
        +str status ❰43 estados❱
        +ForeignKey current_step → WorkflowStep
        +str budget_classification
        +ForeignKey budget_line → ProjectBudgetLine ❰null❱
        +ForeignKey annual_plan_line → AnnualPlanLine ❰null❱
        +Decimal estimated_cost
        +Decimal final_cost
        +date fecha_necesidad
        +date fecha_estimada_entrega
        +date fecha_real_entrega
        +datetime created_at
        +datetime updated_at
        --
        +is_terminal() bool ❰property❱
        +total_items_cost() Decimal ❰property❱
        ❰index❱ flow, project, department, status,
                acquisition_type, priority, created_at
    }

    class RequestItem {
        +int id
        +ForeignKey request → Request
        +int line_number
        +str description
        +text specifications
        +Decimal quantity
        +str unit
        +Decimal unit_price
        +Decimal total_price ❰auto-calc❱
        +Decimal stock_almacen_obra
        +Decimal stock_almacen_central
        +Decimal x_atender
        +str presupuestado_adicional
        +str rfi_fwo
        +str estatus_guia
        +str supply_source ❰STOCK|PURCHASE❱
        +ForeignKey inventory_item → Inventory ❰null❱
        --
        +save() ❰auto: total_price = quantity × unit_price❱
    }

    class Approval {
        <<immutable>>
        +int id
        +ForeignKey request → Request
        +ForeignKey workflow_step → WorkflowStep
        +str action ❰ApprovalActionChoices❱
        +ForeignKey performed_by → User
        +str role
        +str previous_status
        +str new_status
        +text comments
        +datetime performed_at ❰auto_now_add❱
        --
        ❰index❱ request, performed_by, performed_at
    }

    class WorkflowStep {
        +int id
        +str flow ❰OPS|ADM❱
        +int step_order
        +str step_code
        +str step_name
        +str responsible_role
        +str from_status
        +str to_status_approve
        +str to_status_reject
        +bool is_conditional
        +text condition_description
        +bool is_terminal_on_reject
        +int phase ❰1-5❱
        --
        ❰unique_together❱ (flow, step_order)
        ❰unique_together❱ (flow, step_code)
    }

    class AcquisitionTypeConfig {
        +int id
        +str type ❰unique❱
        +int min_days
        +int max_days
        +int max_extended_days
        +bool requires_gm_approval
        +bool requires_admin_approval
        +bool requires_project_manager_approval
        +bool requires_cost_control_approval
        +text notes
    }

    class Supplier {
        +int id
        +str ruc ❰unique, 11 dígitos❱
        +str business_name
        +str trade_name
        +str contact_name
        +str contact_email
        +str contact_phone
        +str address
        +str city
        +str category
        +bool is_active
    }

    class Quotation {
        +int id
        +ForeignKey request → Request
        +ForeignKey supplier → Supplier
        +str quotation_number
        +Decimal total_amount
        +str currency ❰PEN|USD❱
        +int delivery_days
        +str payment_terms
        +int validity_days
        +text notes
        +str document_url
        +bool is_selected
        +ForeignKey selected_by → User ❰null❱
        +datetime selected_at ❰null❱
        +datetime quoted_at
    }

    class QuotationItem {
        +int id
        +ForeignKey quotation → Quotation
        +ForeignKey request_item → RequestItem
        +Decimal unit_price
        +Decimal quantity
        +Decimal total_price ❰auto-calc❱
        +str brand
        +str model
        +text notes
    }

    class PurchaseOrder {
        +int id
        +str po_number ❰auto, unique❱
        +ForeignKey request → Request
        +ForeignKey quotation → Quotation
        +ForeignKey supplier → Supplier
        +ForeignKey generated_by → User
        +str status ❰POStatusChoices❱
        +Decimal total_amount
        +str currency
        +str payment_terms
        +date expected_delivery_date
        +date actual_delivery_date
        +str document_url
        +text notes
    }

    class PurchaseOrderItem {
        +int id
        +ForeignKey purchase_order → PurchaseOrder
        +ForeignKey request_item → RequestItem
        +ForeignKey quotation_item → QuotationItem
        +str description
        +Decimal quantity
        +str unit
        +Decimal unit_price
        +Decimal total_price
    }

    class Claim {
        +int id
        +ForeignKey request → Request
        +str claim_type ❰SUPPLIER_CLAIM|USER_COMPLAINT❱
        +ForeignKey raised_by → User
        +ForeignKey managed_by → User ❰null❱
        +str status ❰OPEN|IN_REVIEW|RESOLVED|CLOSED❱
        +text description
        +text resolution
        +ForeignKey resolved_by → User ❰null❱
        +datetime created_at
        +datetime resolved_at
    }

    class Notification {
        +int id
        +ForeignKey user → User
        +str type
        +str message
        +bool is_read
        +ForeignKey request → Request ❰null❱
        +datetime created_at
    }

    class ActivityLog {
        +int id
        +ForeignKey request → Request
        +str action
        +ForeignKey performed_by → User
        +text details
        +datetime timestamp
    }

    class Attachment {
        +int id
        +ForeignKey request → Request
        +FileField file
        +ForeignKey uploaded_by → User
        +str description
        +datetime uploaded_at
    }

    Request "1" *-- "*" RequestItem : contains
    Request "1" *-- "*" Approval : audit_trail
    Request "1" *-- "*" Quotation : has
    Request "1" *-- "*" PurchaseOrder : has
    Request "1" *-- "*" Claim : has
    Request "1" *-- "*" Notification : related
    Request "1" *-- "*" ActivityLog : tracked
    Request "1" *-- "*" Attachment : has
    Request "*" --> "0..1" WorkflowStep : current_step

    Quotation "1" *-- "*" QuotationItem : contains
    Quotation "*" --> "1" Supplier : from
    QuotationItem "*" --> "1" RequestItem : quotes

    PurchaseOrder "1" *-- "*" PurchaseOrderItem : contains
    PurchaseOrder "*" --> "1" Supplier : to
    PurchaseOrder "*" --> "1" Quotation : based_on
    PurchaseOrderItem "*" --> "1" RequestItem : for
    PurchaseOrderItem "*" --> "1" QuotationItem : from
```

---

## 3. Diagrama de Clases — Módulo Almacén

```mermaid
classDiagram
    direction TB

    class Inventory {
        +int id
        +str product_code ❰unique❱
        +str description
        +str unit
        +str category
        +str item_type ❰EQUIPMENT|CONSUMABLE|TOOL|MATERIAL❱
        +str brand
        +str model_name
        +str location
        +Decimal min_stock
        +datetime created_at
        +datetime updated_at
    }

    class InventoryStock {
        +int id
        +ForeignKey inventory → Inventory
        +str warehouse_type ❰CENTRAL|SITE|OFFICE❱
        +ForeignKey project → Project
        +ForeignKey department → Department
        +Decimal quantity
        +datetime last_updated
        --
        ❰unique_together❱ (inventory, warehouse_type,
                           project, department)
    }

    class MovementGroup {
        +int id
        +str group_number ❰unique❱
        +str movement_type
        +str warehouse
        +ForeignKey project → Project
        +str source_type
        +str supplier_name
        +str invoice_number
        +str destination_type
        +str destination_detail
        +text notes
        +str document_url
        +ForeignKey registered_by → User
        +datetime created_at
    }

    class InventoryMovement {
        +int id
        +str movement_number ❰unique❱
        +str movement_type ❰ENTRY|EXIT|TRANSFER|ADJUSTMENT❱
        +ForeignKey inventory → Inventory
        +Decimal quantity
        +str warehouse ❰CENTRAL|SITE|OFFICE❱
        +ForeignKey project → Project
        +str source_type
        +str supplier_name
        +str invoice_number
        +str destination_type
        +str destination_detail
        +ForeignKey requested_by → User
        +ForeignKey authorized_by → User
        +ForeignKey group → MovementGroup ❰null❱
        +text notes
        +str document_url
        +ForeignKey registered_by → User
        +datetime created_at
        --
        ❰index❱ (inventory, -created_at)
        ❰index❱ (movement_type, -created_at)
        ❰index❱ (warehouse, -created_at)
    }

    class WarehouseReceipt {
        +int id
        +ForeignKey request → Request
        +ForeignKey purchase_order → PurchaseOrder
        +str receipt_number
        +ForeignKey received_by → User
        +datetime received_at
        +text notes
        +str status ❰PENDING|APPROVED|REJECTED❱
    }

    class OneDriveToken {
        +int id
        +str access_token
        +str refresh_token
        +datetime expires_at
    }

    Inventory "1" *-- "*" InventoryStock : stocked_at
    Inventory "1" *-- "*" InventoryMovement : tracked_by
    MovementGroup "1" *-- "*" InventoryMovement : groups
    InventoryStock "*" --> "1" Project : scoped
    InventoryMovement "*" --> "0..1" Project : for
```

---

## 4. Diagrama de Clases — Módulo Administración

```mermaid
classDiagram
    direction TB

    class Pasaje {
        +int id
        +str tipo ❰B|S|S-B❱
        +date fecha_bajada
        +str embarque_bajada
        +str destino_bajada
        +date fecha_subida
        +str embarque_subida
        +str destino_subida
        +ForeignKey personal → Personal ❰nullable❱
        +str dni
        +str nombres
        +str cargo
        +str tipo_trabajador ❰STAFF|WORKER❱
        +ForeignKey centro_costo → Project
        +ForeignKey proveedor → ProveedorPasajes
        +str ruc
        +str razon_social
        +str factura_ticket
        +str detalle
        +date fecha
        +str mes
        +str moneda ❰PEN|USD❱
        +Decimal monto_con_igv_soles
        +Decimal monto_con_igv_dolares
        +Decimal tipo_cambio
        +Decimal devolucion
        +Decimal total ❰auto-calc❱
        +str estado ❰PENDIENTE|PAGADO❱
        +date fecha_pago
        +str numero_operacion
        +bool habilitado
        +ForeignKey creado_por → User
        +ForeignKey actualizado_por → User
        +datetime fecha_registro
        +datetime fecha_actualizacion
        --
        +save() ❰auto-calc: mes, total❱
    }

    class ProveedorPasajes {
        +int id
        +str ruc ❰unique, 11 chars❱
        +str razon_social
    }

    class PoliticaPasajeDevoluciones {
        +int id
        +str tipo_trabajador ❰STAFF|WORKER❱
        +str tramo
        +bool en_dolares
        +bool no_devolucion
        +Decimal monto_dolares
        +Decimal monto_soles
        +bool habilitado
    }

    Pasaje "*" --> "0..1" Personal : for_employee
    Pasaje "*" --> "1" ProveedorPasajes : provided_by
    Pasaje "*" --> "1" Project : charged_to
    Pasaje "*" --> "1" User : created_by
```

---

## 5. Diagrama de Clases — Módulo Soporte TI

```mermaid
classDiagram
    direction TB

    class Ticket {
        +int id
        +str ticket_number ❰auto, unique❱
        +str title
        +text description
        +str category ❰HARDWARE|SOFTWARE|NETWORK|ACCESS|EMAIL|PRINTER|OTHER❱
        +str priority ❰LOW|MEDIUM|HIGH|CRITICAL❱
        +str status ❰OPEN|IN_PROGRESS|RESOLVED|CLOSED❱
        +ForeignKey created_by → User
        +ForeignKey assigned_to → User ❰nullable❱
        +datetime resolved_at ❰nullable❱
        +datetime created_at
        +datetime updated_at
        --
        ❰auto-generate❱ ticket_number = TK-YYYYMMDD-XXXX
    }

    class TicketComment {
        +int id
        +ForeignKey ticket → Ticket
        +ForeignKey author → User
        +text content
        +bool is_status_change
        +str old_status ❰nullable❱
        +str new_status ❰nullable❱
        +datetime created_at
    }

    Ticket "1" *-- "*" TicketComment : has
    Ticket "*" --> "1" User : created_by
    Ticket "*" --> "0..1" User : assigned_to
    TicketComment "*" --> "1" User : authored_by
```

---

## 6. Diagrama de Clases — Servicios de Negocio

```mermaid
classDiagram
    direction TB

    class WorkflowEngine {
        <<Service>>
        +transition(request, action, user, comments) Request
        +get_available_actions(request, user) List~Action~
        +validate_transition(request, action, user) bool
        -_check_role_permission(user, step) bool
        -_execute_transition(request, step) void
        -_create_approval_record(request, step, user, action) Approval
        -_handle_conditional_transitions(request, step) void
        -_auto_transition(request) void
    }

    class BudgetValidator {
        <<Service>>
        +validate(request) ValidationResult
        +commit_budget(request) void
        +release_budget(request) void
    }

    class ValidationResult {
        <<DataClass>>
        +bool is_valid
        +Decimal available_amount
        +Decimal required_amount
        +str message
    }

    class SLACalculator {
        <<Service>>
        +calculate_deadline(request) date
        +check_overdue(request) bool
    }

    class RQNumberGenerator {
        <<Service>>
        +generate() str
    }

    class PONumberGenerator {
        <<Service>>
        +generate() str
    }

    class NotificationService {
        <<Service>>
        +notify_sla_warning(request) void
        +notify_approval_pending(request) void
        +notify_status_change(request) void
    }

    class CookieJWTAuthentication {
        <<Authentication>>
        +authenticate(request) tuple~User, token~
        -_get_token_from_cookie(request) str
    }

    WorkflowEngine --> BudgetValidator : uses
    WorkflowEngine --> SLACalculator : uses
    WorkflowEngine --> NotificationService : uses
    WorkflowEngine --> Request : modifies
    WorkflowEngine --> Approval : creates
    WorkflowEngine --> WorkflowStep : reads
    BudgetValidator --> ValidationResult : returns
    BudgetValidator --> ProjectBudgetLine : modifies
    BudgetValidator --> AnnualPlanLine : modifies
    SLACalculator --> AcquisitionTypeConfig : reads
    RQNumberGenerator --> Request : generates_number
    PONumberGenerator --> PurchaseOrder : generates_number
```

---

## 7. Diagrama de Clases — Frontend (React Components)

```mermaid
classDiagram
    direction TB

    class AuthContext {
        <<React Context>>
        +User currentUser
        +bool isAuthenticated
        +bool isLoading
        +str primaryRole
        +List~str~ userRoles
        +login(username, password) Promise
        +logout() Promise
        +hasRole(role) bool
        +switchRole(user) void
    }

    class ToastContext {
        <<React Context>>
        +List~Toast~ toasts
        +showToast(config) void
    }

    class useApi {
        <<Custom Hook>>
        +T data
        +bool loading
        +str error
        +execute(...args) Promise
        +reset() void
    }

    class AppShell {
        <<Layout Component>>
        +Header header
        +Sidebar sidebar
        +Outlet content
        --
        theme: blue
        route: /rq/*
    }

    class WarehouseShell {
        <<Layout Component>>
        +Header header
        +WarehouseSidebar sidebar
        +Outlet content
        --
        theme: emerald
        route: /almacen/*
    }

    class AdminShell {
        <<Layout Component>>
        +Header header
        +AdminSidebar sidebar
        +Outlet content
        --
        theme: indigo
        route: /admin/*
    }

    class SupportShell {
        <<Layout Component>>
        +Header header
        +SupportSidebar sidebar
        +Outlet content
        --
        theme: teal
        route: /soporte/*
    }

    class RoleRoute {
        <<Auth Component>>
        +List~str~ requiredRoles
        +str fallback
        --
        Verifica useAuth().hasRole()
        Redirect si no autorizado
    }

    class StatusBadge {
        <<UI Component>>
        +str status
        --
        Mapea 43 estados a colores
    }

    class PriorityBadge {
        <<UI Component>>
        +str priority
        --
        LOW|MEDIUM|HIGH|URGENT
    }

    class ApprovalChain {
        <<Domain Component>>
        +List~Approval~ approvals
        +List~WorkflowStep~ steps
        --
        Visualiza cadena de aprobación
    }

    class LifecycleBar {
        <<Domain Component>>
        +str currentStatus
        +int currentPhase
        --
        Barra de 5 fases con progreso
    }

    class AxiosClient {
        <<API Layer>>
        +str baseURL
        +bool withCredentials
        --
        Response interceptor (401 → refresh)
        Request queue for concurrent 401s
    }

    AuthContext --> RoleRoute : provides roles
    AppShell --> RoleRoute : wraps routes
    WarehouseShell --> RoleRoute : wraps routes
    AdminShell --> RoleRoute : wraps routes
    SupportShell --> RoleRoute : wraps routes
    AxiosClient --> AuthContext : triggers logout on refresh fail
```

---

## 8. Diagrama de Paquetes — Vista General

```mermaid
graph TB
    subgraph "Backend (Django)"
        subgraph "config"
            SETTINGS["settings/<br/>base.py<br/>development.py<br/>production.py"]
            URLS["urls.py"]
            CELERYCONF["celery.py"]
            WSGI["wsgi.py"]
        end

        subgraph "apps.core"
            CORE_M["models/<br/>User, UserRole<br/>Project, Department<br/>Personal, AnnualPlan"]
            CORE_S["serializers/<br/>auth, user"]
            CORE_V["views/<br/>user"]
            CORE_P["permissions.py<br/>authentication.py<br/>enums.py"]
        end

        subgraph "apps.rq"
            RQ_M["models/<br/>Request, RequestItem<br/>Approval, Supplier<br/>Quotation, PO, Claim<br/>WorkflowStep"]
            RQ_SER["serializers/<br/>request, approval<br/>quotation, po, claim"]
            RQ_V["views/<br/>request, supplier"]
            RQ_SVC["services/<br/>workflow_engine<br/>budget_validator<br/>sla_calculator<br/>number_generator"]
            RQ_T["tasks.py"]
            RQ_F["filters.py"]
        end

        subgraph "apps.warehouse"
            WH_M["models/<br/>Inventory, Stock<br/>Movement, Group<br/>OneDriveToken"]
            WH_S["serializers/"]
            WH_V["views/"]
        end

        subgraph "apps.administracion"
            AD_M["models/<br/>Pasaje<br/>ProveedorPasajes<br/>PoliticaDevoluciones"]
            AD_S["serializers/"]
            AD_V["views/"]
        end

        subgraph "apps.support"
            SP_M["models/<br/>Ticket<br/>TicketComment"]
            SP_S["serializers/"]
            SP_V["views/"]
        end
    end

    subgraph "Frontend (React)"
        subgraph "api/"
            API_CL["client.js"]
            API_MOD["auth.js, requests.js<br/>almacen.js, suppliers.js<br/>administracion.js<br/>support.js, etc."]
        end

        subgraph "context/"
            CTX["AuthContext.jsx<br/>ToastContext.jsx"]
        end

        subgraph "pages/"
            PG_AUTH["auth/"]
            PG_RQ["requests/ + approvals/<br/>+ operations/"]
            PG_WH["almacen/"]
            PG_AD["admin/"]
            PG_SP["support/"]
        end

        subgraph "components/"
            CMP["layout/ + ui/<br/>+ requests/"]
        end
    end

    URLS --> CORE_V
    URLS --> RQ_V
    URLS --> WH_V
    URLS --> AD_V
    URLS --> SP_V

    RQ_V --> RQ_SVC
    RQ_SVC --> RQ_M
    RQ_SVC --> CORE_M
    RQ_T --> RQ_SVC

    API_CL --> URLS
    PG_RQ --> API_MOD
    PG_WH --> API_MOD
    PG_AD --> API_MOD
    PG_SP --> API_MOD
    API_MOD --> API_CL
```

---

*Documento generado para SYSPCC v1.0 — PCC Ingeniería y Construcción*
*Última actualización: Abril 2026*
