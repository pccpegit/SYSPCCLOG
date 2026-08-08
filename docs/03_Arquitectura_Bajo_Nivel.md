# SYSPCC — Arquitectura de Bajo Nivel

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.0 | **Fecha:** Abril 2026 | **Empresa:** PCC Ingeniería y Construcción

---

## 1. Estructura de Capas del Backend

### 1.1 Flujo completo de un Request HTTP

```mermaid
graph TB
    REQ["🌐 HTTP Request<br/>GET /api/v1/requests/?status=SUBMITTED"]

    subgraph "Nginx"
        NG["Reverse Proxy<br/>SSL Termination<br/>Static Files"]
    end

    subgraph "Gunicorn"
        GU["WSGI Server<br/>4 workers × 2 threads"]
    end

    subgraph "Django Middleware Stack"
        MW1["SecurityMiddleware<br/>HSTS, X-Content-Type"]
        MW2["SessionMiddleware<br/>Redis-backed sessions"]
        MW3["CorsMiddleware<br/>CORS headers"]
        MW4["CommonMiddleware<br/>URL normalization"]
        MW5["CsrfViewMiddleware<br/>CSRF protection"]
        MW6["AuthenticationMiddleware<br/>User resolution"]
    end

    subgraph "URL Router"
        URL1["config/urls.py"]
        URL2["apps/rq/urls.py"]
        URL3["DRF Router<br/>auto-URL generation"]
    end

    subgraph "DRF View Layer"
        PERM["Permission Check<br/>IsAuthenticated<br/>HasRole(REQUESTER)"]
        THROT["Throttle Check<br/>200 req/min (auth)"]
        AUTH["CookieJWTAuthentication<br/>Lee JWT de cookie"]
        VIEW["RequestViewSet<br/>.list() / .retrieve() / .create()"]
        FILT["FilterBackend<br/>DjangoFilterBackend<br/>SearchFilter<br/>OrderingFilter"]
        PAG["Pagination<br/>PageNumberPagination<br/>page_size=20"]
    end

    subgraph "Serializer Layer"
        SER["RequestSerializer<br/>ModelSerializer"]
        VAL["Validation<br/>validate_*() methods<br/>Field-level + Object-level"]
        NEST["Nested Serializers<br/>RequestItemSerializer<br/>UserSerializer (read_only)"]
    end

    subgraph "Service Layer"
        WF["WorkflowEngine<br/>State machine"]
        BV["BudgetValidator<br/>Budget checks"]
        SLA["SLACalculator<br/>Deadline calc"]
        NS["NotificationService<br/>Alerts"]
        NG2["NumberGenerator<br/>RQ/OC numbers"]
    end

    subgraph "Model Layer (ORM)"
        MOD["Request.objects<br/>.select_related('project','requested_by')<br/>.prefetch_related('items','approvals')<br/>.filter(status='SUBMITTED')"]
    end

    subgraph "Database"
        PG["PostgreSQL 15<br/>Queries SQL"]
        CACHE["Redis DB0<br/>Cache Layer"]
    end

    RESP["📤 JSON Response<br/>{count: 5, results: [...]}"]

    REQ --> NG --> GU
    GU --> MW1 --> MW2 --> MW3 --> MW4 --> MW5 --> MW6
    MW6 --> URL1 --> URL2 --> URL3
    URL3 --> AUTH --> PERM --> THROT --> VIEW
    VIEW --> FILT --> PAG
    VIEW --> SER
    SER --> VAL
    SER --> NEST
    VIEW --> WF
    VIEW --> BV
    VIEW --> SLA
    VIEW --> NS
    VIEW --> NG2
    SER --> MOD
    MOD --> CACHE
    MOD --> PG
    PG --> RESP
```

### 1.2 Responsabilidad de cada capa

```mermaid
graph LR
    subgraph "URLs"
        U["Routing<br/>• Mapea URL → ViewSet<br/>• DRF Router auto-genera<br/>  list/detail/actions<br/>• Namespaced por app"]
    end

    subgraph "Views"
        V["Orquestación<br/>• Autenticación/autorización<br/>• Throttling<br/>• Filtros, búsqueda, orden<br/>• Paginación<br/>• Delega lógica a Services<br/>• @action para endpoints custom"]
    end

    subgraph "Serializers"
        S["Validación y Transformación<br/>• Valida input (create/update)<br/>• Serializa output (JSON)<br/>• Nested relationships<br/>• Campos calculados<br/>  (SerializerMethodField)<br/>• write_only / read_only"]
    end

    subgraph "Services"
        SV["Lógica de Negocio<br/>• WorkflowEngine (estados)<br/>• BudgetValidator (presup.)<br/>• SLACalculator (plazos)<br/>• NumberGenerator (secuencias)<br/>• NotificationService (alertas)"]
    end

    subgraph "Models"
        M["Persistencia<br/>• Definición de esquema<br/>• Relaciones (FK, M2M)<br/>• Constraints / Unique<br/>• Índices de performance<br/>• Properties calculadas<br/>• save() con auto-cálculos"]
    end

    U --> V --> S --> SV --> M
```

---

## 2. Estructura de Archivos del Backend

```mermaid
graph TB
    subgraph "backend/"
        CFG["config/<br/>├── settings/<br/>│   ├── base.py<br/>│   ├── development.py<br/>│   └── production.py<br/>├── urls.py<br/>├── wsgi.py<br/>├── asgi.py<br/>└── celery.py"]

        subgraph "apps/"
            CORE["core/<br/>├── models/<br/>│   ├── __init__.py<br/>│   ├── user.py<br/>│   ├── project.py<br/>│   ├── department.py<br/>│   └── personal.py<br/>├── serializers/<br/>│   ├── auth.py<br/>│   └── user.py<br/>├── views/<br/>│   └── user.py<br/>├── services/<br/>├── authentication.py<br/>├── permissions.py<br/>├── enums.py<br/>├── admin.py<br/>└── urls.py"]

            RQ["rq/<br/>├── models/<br/>│   ├── __init__.py<br/>│   ├── request.py<br/>│   ├── approval.py<br/>│   ├── supplier.py<br/>│   ├── quotation.py<br/>│   ├── purchase_order.py<br/>│   ├── claim.py<br/>│   └── workflow.py<br/>├── serializers/<br/>│   ├── request.py<br/>│   ├── approval.py<br/>│   ├── quotation.py<br/>│   └── purchase_order.py<br/>├── views/<br/>│   ├── request.py<br/>│   └── supplier.py<br/>├── services/<br/>│   ├── workflow_engine.py<br/>│   ├── budget_validator.py<br/>│   ├── sla_calculator.py<br/>│   └── number_generator.py<br/>├── tasks.py<br/>├── filters.py<br/>└── urls.py"]

            WH["warehouse/<br/>├── models/<br/>│   ├── __init__.py<br/>│   └── inventory.py<br/>├── serializers/<br/>├── views/<br/>├── admin.py<br/>└── urls.py"]

            ADM["administracion/<br/>├── models/<br/>├── serializers/<br/>├── views/<br/>└── urls.py"]

            SUP["support/<br/>├── models/<br/>├── serializers/<br/>├── views/<br/>└── urls.py"]
        end

        REQ_TXT["requirements.txt"]
        MANAGE["manage.py"]
        DOCKER["Dockerfile"]
    end
```

---

## 3. Estructura de Componentes del Frontend

### 3.1 Árbol de Componentes React

```mermaid
graph TB
    subgraph "App.jsx — Raíz"
        AP["AuthProvider<br/>(AuthContext)"]
        TP["ToastProvider<br/>(ToastContext)"]
        BR["BrowserRouter<br/>(React Router v7)"]
    end

    subgraph "Rutas Públicas"
        LOGIN["LoginPage<br/>/login"]
        SYSSEL["SystemSelectPage<br/>/"]
    end

    subgraph "Shell RQ — /rq/*"
        APPSH["AppShell"]
        HEADER["Header"]
        SIDEBAR["Sidebar"]

        subgraph "Páginas RQ"
            DASH["DashboardPage"]
            RLIST["RequestListPage"]
            RCREATE["RequestCreatePage<br/>(46KB — formulario complejo)"]
            RDETAIL["RequestDetailPage<br/>(45KB — detalle + approvals)"]
        end

        subgraph "Páginas Aprobaciones"
            APPROV["ApprovalsPage"]
            TECH["TechReviewPage<br/>(PROJECT_RESIDENT)"]
            BUDG["BudgetReviewPage<br/>(PROJECT_CONTROL)"]
            QCR["QuoteCostReviewPage<br/>(PROJECT_CONTROL)"]
            MGR["ManagerApprovalPage<br/>(GENERAL_MANAGER)"]
            COST["CostOverrunReviewPage<br/>(GENERAL_MANAGER)"]
        end

        subgraph "Páginas Operaciones"
            LOGP["LogisticsPage"]
            LOGA["LogisticsActionPage<br/>(113KB — más grande)"]
        end

        REPOR["ReportsPage<br/>(36KB — gráficos)"]
    end

    subgraph "Shell Almacén — /almacen/*"
        WHSH["WarehouseShell"]
        WHSB["WarehouseSidebar"]

        WHDASH["AlmacenDashboardPage"]
        INV["InventarioPage<br/>(27KB)"]
        KAR["KardexPage"]
        ENT["EntradaPage<br/>(21KB)"]
        SAL["SalidaPage<br/>(23KB)"]
        VOUCH["VoucherPrint"]
        MOV["MovimientosPage"]
    end

    subgraph "Shell Admin — /admin/*"
        ADMSH["AdminShell"]
        ADMSB["AdminSidebar"]

        ADMDASH["AdminDashboardPage"]
        PAS["PasajesPage<br/>(46KB)"]
        PAG["PagosPage"]
        POL["PoliticasPage"]
        PROV["ProveedoresPage"]
    end

    subgraph "Shell Soporte — /soporte/*"
        SUPSH["SupportShell"]
        SUPSB["SupportSidebar"]

        SUPDASH["SupportDashboardPage"]
        TIKC["TicketCreatePage"]
        TIKL["TicketListPage"]
        TIKD["TicketDetailPage"]
    end

    SETT["SettingsPage<br/>/settings"]

    AP --> TP --> BR
    BR --> LOGIN
    BR --> SYSSEL
    BR --> APPSH
    BR --> WHSH
    BR --> ADMSH
    BR --> SUPSH
    BR --> SETT

    APPSH --> HEADER
    APPSH --> SIDEBAR
    APPSH --> DASH
    APPSH --> RLIST
    APPSH --> RCREATE
    APPSH --> RDETAIL
    APPSH --> APPROV
    APPSH --> TECH
    APPSH --> BUDG
    APPSH --> QCR
    APPSH --> MGR
    APPSH --> COST
    APPSH --> LOGP
    APPSH --> LOGA
    APPSH --> REPOR

    WHSH --> HEADER
    WHSH --> WHSB
    WHSH --> WHDASH
    WHSH --> INV
    WHSH --> KAR
    WHSH --> ENT
    WHSH --> SAL
    WHSH --> VOUCH
    WHSH --> MOV

    ADMSH --> HEADER
    ADMSH --> ADMSB
    ADMSH --> ADMDASH
    ADMSH --> PAS
    ADMSH --> PAG
    ADMSH --> POL
    ADMSH --> PROV

    SUPSH --> HEADER
    SUPSH --> SUPSB
    SUPSH --> SUPDASH
    SUPSH --> TIKC
    SUPSH --> TIKL
    SUPSH --> TIKD
```

### 3.2 Componentes Reutilizables

```mermaid
graph TB
    subgraph "components/layout/"
        HL["Header<br/>• Logo, nombre de usuario<br/>• Notificaciones (bell icon)<br/>• Menú de usuario<br/>• Tema por módulo"]
        SBR["Sidebar / WarehouseSidebar /<br/>AdminSidebar / SupportSidebar<br/>• Navegación por módulo<br/>• Íconos Lucide<br/>• Rol-based items"]
        RR["RoleRoute<br/>• Wrapper de autorización<br/>• Verifica userRoles<br/>• Redirect si no autorizado"]
    end

    subgraph "components/ui/"
        SB["StatusBadge<br/>• Color por estado<br/>• 43 estados mapeados<br/>• Pill con texto"]
        PB["PriorityBadge<br/>• LOW/MEDIUM/HIGH/URGENT<br/>• Colores diferenciados"]
        CM["ConfirmModal<br/>• Diálogo de confirmación<br/>• onConfirm / onCancel<br/>• Título + mensaje"]
        NI["NumberInput<br/>• Input numérico<br/>• Validación client-side"]
        SC["SummaryCard<br/>• Tarjeta de métricas<br/>• Ícono + valor + label"]
    end

    subgraph "components/requests/"
        AL["ActivityLog<br/>• Timeline vertical<br/>• Acciones cronológicas<br/>• Actor + timestamp"]
        AC["ApprovalChain<br/>• Cadena de aprobaciones<br/>• Estado por paso<br/>• Roles responsables"]
        LB["LifecycleBar<br/>• Barra horizontal<br/>• 5 fases con progreso<br/>• Fase actual resaltada"]
    end
```

### 3.3 Estructura de Archivos del Frontend

```mermaid
graph TB
    subgraph "frontend/src/"
        APP["App.jsx — Router principal"]
        IDX["index.css — Estilos globales + animaciones"]
        MAIN["main.jsx — Entry point"]

        subgraph "api/ — 14 módulos"
            CLI["client.js — Axios instance + interceptors"]
            CFG["config.js — API_BASE_URL, BACKEND_URL"]
            AA["auth.js — login, logout, me, password, signature"]
            AC2["core.js — projects, departments, budgets"]
            AR["requests.js — CRUD + actions + approvals"]
            AS["suppliers.js — suppliers + quotations + POs"]
            AW["almacen.js — inventory + movements + OneDrive"]
            AAD["administracion.js — pasajes + políticas"]
            ASU["support.js — tickets + comments"]
            AN["notifications.js — list + mark-read"]
            AWF["workflow.js — configs + steps"]
            ACL["claims.js — claims CRUD"]
            AIN["index.js — barrel export"]
        end

        subgraph "context/"
            ACTX["AuthContext.jsx<br/>currentUser, login, logout,<br/>hasRole, userRoles"]
            TCTX["ToastContext.jsx<br/>showToast, auto-dismiss"]
        end

        subgraph "hooks/"
            UAPI["useApi.js<br/>data, loading, error,<br/>execute, reset"]
        end

        subgraph "data/"
            CONST["constants.js — ROLES, STATUS, PRIORITY, FLOW"]
            ALMC["almacenConstants.js — ITEM_TYPES, MOVEMENTS"]
            SUPC["supportConstants.js — TICKET_STATUS"]
            MOCK["mockData.js — datos de desarrollo"]
        end

        subgraph "utils/"
            FMT["format.js — formateo de fechas/montos"]
            EXP["exportRQ.js — exportación Excel"]
        end

        subgraph "pages/ — 34 páginas"
            P_AUTH["auth/ — LoginPage, SystemSelectPage"]
            P_DASH["dashboard/ — DashboardPage"]
            P_REQ["requests/ — List, Create, Detail"]
            P_APP["approvals/ — 5 páginas de aprobación"]
            P_OPS["operations/ — Logistics, Warehouse"]
            P_ALM["almacen/ — 7 páginas de almacén"]
            P_ADM["admin/ — 5 páginas administrativas"]
            P_SUP["support/ — 4 páginas de soporte"]
            P_REP["reports/ — ReportsPage"]
            P_SET["settings/ — SettingsPage"]
        end

        subgraph "components/ — 19 componentes"
            C_LAY["layout/ — 9 shells + sidebars + header"]
            C_AUTH["auth/ — RoleRoute"]
            C_UI["ui/ — 5 componentes UI"]
            C_REQ["requests/ — 3 componentes RQ"]
        end
    end
```

---

## 4. Capa de Comunicación API

### 4.1 Flujo Request/Response completo

```mermaid
sequenceDiagram
    participant PG as Página React
    participant HOOK as useApi Hook
    participant AX as Axios Client
    participant INT as Interceptor 401
    participant API as Django API
    participant JWT as CookieJWTAuth

    Note over PG,JWT: Flujo normal (token válido)
    PG->>HOOK: execute(getRequests, {status: 'SUBMITTED'})
    HOOK->>HOOK: setLoading(true)
    HOOK->>AX: api.get('/requests/', {params})
    Note over AX: withCredentials: true<br/>Cookie access_token enviada auto
    AX->>API: GET /api/v1/requests/?status=SUBMITTED
    API->>JWT: authenticate(request)
    JWT->>JWT: Lee cookie 'access_token'
    JWT->>JWT: Decodifica JWT (HS256)
    JWT-->>API: user object
    API->>API: Permission check (IsAuthenticated)
    API->>API: Throttle check (200/min)
    API->>API: Filter + Search + Order
    API->>API: Paginate (page_size=20)
    API-->>AX: 200 {count, next, previous, results}
    AX-->>HOOK: response.data
    HOOK->>HOOK: setData(response.data)
    HOOK->>HOOK: setLoading(false)
    HOOK-->>PG: {data, loading: false, error: null}
```

### 4.2 Flujo de Refresh Token (401)

```mermaid
sequenceDiagram
    participant R1 as Request 1
    participant R2 as Request 2
    participant R3 as Request 3
    participant AX as Axios Interceptor
    participant API as Django Auth

    Note over R1,API: Múltiples requests con token expirado

    R1->>AX: GET /requests/
    AX->>API: Request (cookie expirada)
    API-->>AX: 401 Unauthorized
    AX->>AX: isRefreshing = true
    AX->>AX: Crear refreshPromise

    R2->>AX: GET /notifications/
    AX->>AX: isRefreshing? → Sí
    AX->>AX: Encolar R2 en failedQueue

    R3->>AX: GET /projects/
    AX->>AX: isRefreshing? → Sí
    AX->>AX: Encolar R3 en failedQueue

    AX->>API: POST /auth/token/refresh/
    Note over AX,API: Cookie refresh_token<br/>enviada automáticamente
    API->>API: Validar refresh token
    API->>API: Rotar tokens
    API->>API: Blacklist token anterior
    API-->>AX: Set-Cookie: new access + new refresh

    AX->>AX: isRefreshing = false
    AX->>AX: Resolver refreshPromise

    Note over AX: Reintenta todos los requests encolados
    AX->>API: RETRY GET /requests/ (new cookie)
    API-->>AX: 200 OK
    AX-->>R1: datos

    AX->>API: RETRY GET /notifications/ (new cookie)
    API-->>AX: 200 OK
    AX-->>R2: datos

    AX->>API: RETRY GET /projects/ (new cookie)
    API-->>AX: 200 OK
    AX-->>R3: datos
```

### 4.3 Estructura del Axios Client

```mermaid
graph TB
    subgraph "api/client.js"
        CREATE["axios.create({<br/>  baseURL: VITE_API_URL,<br/>  withCredentials: true,<br/>  headers: {Content-Type: 'application/json'}<br/>})"]

        subgraph "Response Interceptor"
            CHK["¿Status === 401?"]
            SKP["¿Es endpoint de auth?<br/>/login, /refresh, /logout"]
            REF["Refresh Token Flow"]
            QUE["Cola de requests<br/>failedQueue[]"]
            RET["Retry all queued"]
            ERR["Promise.reject(error)"]
        end
    end

    CREATE --> CHK
    CHK -->|No| ERR
    CHK -->|Sí| SKP
    SKP -->|Sí| ERR
    SKP -->|No| REF
    REF --> QUE
    REF --> RET
```

---

## 5. Motor de Workflow — Máquina de Estados Detallada

### 5.1 Flujo OPERATIONS — Diagrama Completo

```mermaid
stateDiagram-v2
    [*] --> DRAFT

    state "FASE 1 — Solicitud" as F1 {
        DRAFT --> SUBMITTED: submit<br/>[REQUESTER]
    }

    state "FASE 2 — Validación Técnica y Presupuestal" as F2 {
        SUBMITTED --> TECHNICAL_APPROVED: approve<br/>[PROJECT_RESIDENT]
        SUBMITTED --> TECHNICAL_REJECTED: reject<br/>[PROJECT_RESIDENT]

        TECHNICAL_APPROVED --> WITHIN_PROPOSAL: classify_within<br/>[PROJECT_CONTROL]
        TECHNICAL_APPROVED --> ADDITIONAL_REQ: classify_additional<br/>[PROJECT_CONTROL]
        TECHNICAL_APPROVED --> TECHNICAL_REJECTED: reject<br/>[PROJECT_CONTROL]

        WITHIN_PROPOSAL --> VALIDATED: auto_transition

        ADDITIONAL_REQ --> GM_REVIEW: approve<br/>[PROJECT_RESIDENT]
        ADDITIONAL_REQ --> TECHNICAL_REJECTED: reject<br/>[PROJECT_RESIDENT]

        GM_REVIEW --> GM_APPROVED: approve<br/>[GENERAL_MANAGER]
        GM_REVIEW --> GM_REJECTED: reject<br/>[GENERAL_MANAGER]

        GM_APPROVED --> VALIDATED: auto_transition
    }

    state "FASE 3 — Logística y Compras" as F3 {
        VALIDATED --> IN_STOCK: mark_in_stock<br/>[LOGISTICS_COORDINATOR]
        VALIDATED --> REQUIRES_PURCHASE: mark_requires_purchase<br/>[LOGISTICS_COORDINATOR]

        REQUIRES_PURCHASE --> QUOTING: start_quoting<br/>[LOGISTICS_COORDINATOR]
        QUOTING --> QUOTE_COMPARISON: compare_quotes<br/>[LOGISTICS_COORDINATOR]
        QUOTE_COMPARISON --> QUOTE_SELECTED: select_quote<br/>[LOGISTICS_COORDINATOR]

        QUOTE_SELECTED --> QUOTE_COST_APPROVED: approve_cost<br/>[PROJECT_CONTROL]
        QUOTE_SELECTED --> COST_OVERRUN_REVIEW: reject_cost<br/>[PROJECT_CONTROL]

        COST_OVERRUN_REVIEW --> COST_OVERRUN_APPROVED: approve<br/>[GENERAL_MANAGER]
        COST_OVERRUN_REVIEW --> COST_OVERRUN_REJECTED: reject<br/>[GENERAL_MANAGER]

        QUOTE_COST_APPROVED --> PO_GENERATED: generate_po<br/>[LOGISTICS_COORDINATOR]
        COST_OVERRUN_APPROVED --> PO_GENERATED: generate_po<br/>[LOGISTICS_COORDINATOR]
    }

    state "FASE 4 — Recepción y Entrega" as F4 {
        PO_GENERATED --> RECEIVING: receive<br/>[LOGISTICS_COORDINATOR]

        IN_STOCK --> DISPATCHED_TO_SITE: dispatch<br/>[CENTRAL_WAREHOUSE]

        RECEIVING --> QUALITY_APPROVED: approve_quality<br/>[LOGISTICS_COORDINATOR]
        RECEIVING --> QUALITY_REJECTED: reject_quality<br/>[LOGISTICS_COORDINATOR]

        QUALITY_APPROVED --> DISPATCHED_TO_SITE: dispatch<br/>[LOGISTICS_COORDINATOR]
        DISPATCHED_TO_SITE --> DELIVERED: confirm_delivery<br/>[SITE_WAREHOUSE]

        state "Ciclo de Reclamo" as CLAIM_CYCLE {
            QUALITY_REJECTED --> SUPPLIER_CLAIM_SENT: send_claim<br/>[LOGISTICS_COORDINATOR]
            SUPPLIER_CLAIM_SENT --> SUPPLIER_CLAIM_PENDING: pending<br/>[LOGISTICS_COORDINATOR]
            SUPPLIER_CLAIM_PENDING --> SUPPLIER_REPLACEMENT_RECEIVED: replacement<br/>[LOGISTICS_COORDINATOR]
            SUPPLIER_CLAIM_SENT --> SUPPLIER_REPLACEMENT_RECEIVED: direct_replacement
            SUPPLIER_REPLACEMENT_RECEIVED --> QUALITY_APPROVED: approve_quality
            SUPPLIER_REPLACEMENT_RECEIVED --> QUALITY_REJECTED: reject_quality
        }
    }

    state "FASE 5 — Conformidad y Cierre" as F5 {
        DELIVERED --> USER_CONFORMITY: confirm<br/>[REQUESTER]
        DELIVERED --> CLAIM_IN_REVIEW: claim<br/>[REQUESTER]

        CLAIM_IN_REVIEW --> SUPPLIER_CLAIM_SENT: send_claim<br/>[LOGISTICS_COORDINATOR]

        USER_CONFORMITY --> CLOSED: close<br/>[LOGISTICS_COORDINATOR]
    }

    state "Cancelación Universal" as CANCEL {
        note right of CANCELLED: Cualquier estado no-terminal<br/>puede ser cancelado por<br/>roles autorizados
    }

    TECHNICAL_REJECTED --> [*]
    GM_REJECTED --> [*]
    COST_OVERRUN_REJECTED --> [*]
    CLOSED --> [*]
    CANCELLED --> [*]
```

### 5.2 Flujo ADMINISTRATIVE — Diferencias con OPERATIONS

```mermaid
stateDiagram-v2
    [*] --> DRAFT

    state "FASE 1 — Solicitud" as F1A {
        DRAFT --> SUBMITTED: submit<br/>[REQUESTER]
    }

    state "FASE 2 — Validación Administrativa" as F2A {
        SUBMITTED --> SUPERVISOR_APPROVED: approve<br/>[DIRECT_SUPERVISOR]
        SUBMITTED --> SUPERVISOR_REJECTED: reject<br/>[DIRECT_SUPERVISOR]

        SUPERVISOR_APPROVED --> WITHIN_ANNUAL_PLAN: classify_within_plan<br/>[ADMIN_MANAGER]
        SUPERVISOR_APPROVED --> OUT_OF_ANNUAL_PLAN: classify_out_of_plan<br/>[ADMIN_MANAGER]
        SUPERVISOR_APPROVED --> SUPERVISOR_REJECTED: reject<br/>[ADMIN_MANAGER]

        WITHIN_ANNUAL_PLAN --> VALIDATED: auto_transition

        OUT_OF_ANNUAL_PLAN --> GM_REVIEW: approve<br/>[DIRECT_SUPERVISOR]
        OUT_OF_ANNUAL_PLAN --> SUPERVISOR_REJECTED: reject<br/>[DIRECT_SUPERVISOR]

        GM_REVIEW --> GM_APPROVED: approve<br/>[GENERAL_MANAGER]
        GM_REVIEW --> GM_REJECTED: reject<br/>[GENERAL_MANAGER]

        GM_APPROVED --> VALIDATED: auto_transition
    }

    state "FASE 3 — Logística" as F3A {
        note right of F3A: Roles diferentes:<br/>LOGISTICS_SUPERVISOR<br/>LOGISTICS_CHIEF<br/>Costo aprobado por ADMIN_MANAGER
        VALIDATED --> IN_STOCK: [LOGISTICS_SUPERVISOR]
        VALIDATED --> REQUIRES_PURCHASE: [LOGISTICS_SUPERVISOR]
    }

    state "FASE 4 — Recepción" as F4A {
        note right of F4A: Diferencia clave:<br/>IN_STOCK → DELIVERED (directo)<br/>DISPATCHED_TO_SITE → DELIVERED<br/>DELIVERED → WAREHOUSE_UPDATED
        IN_STOCK_ADM --> DELIVERED_ADM: dispatch directo
        DELIVERED_ADM --> WAREHOUSE_UPDATED: update_records<br/>[CENTRAL_WAREHOUSE]
    }

    state "FASE 5 — Conformidad" as F5A {
        note right of F5A: Conformidad parte de<br/>WAREHOUSE_UPDATED<br/>(no de DELIVERED)
        WAREHOUSE_UPDATED --> USER_CONFORMITY_ADM: confirm<br/>[REQUESTER]
        USER_CONFORMITY_ADM --> CLOSED_ADM: close<br/>[LOGISTICS_SUPERVISOR]
    }
```

### 5.3 Componentes Internos del WorkflowEngine

```mermaid
graph TB
    subgraph "WorkflowEngine"
        ENTRY["transition(request, action, user, comments)"]

        subgraph "Paso 1: Validación"
            V1["_check_role_permission()<br/>• Verifica que user.role<br/>  coincida con responsible_role<br/>  del WorkflowStep actual"]
            V2["validate_transition()<br/>• Verifica que from_status<br/>  sea el status actual<br/>• Verifica que action sea válida"]
        end

        subgraph "Paso 2: Ejecución"
            E1["_execute_transition()<br/>• Actualiza request.status<br/>• Actualiza request.current_step"]
            E2["_handle_conditional_transitions()<br/>• Evalúa condiciones<br/>  (WITHIN_PROPOSAL vs ADDITIONAL)<br/>  (WITHIN_PLAN vs OUT_OF_PLAN)"]
        end

        subgraph "Paso 3: Auto-transición"
            A1["_auto_transition()<br/>• WITHIN_PROPOSAL → VALIDATED<br/>• GM_APPROVED → VALIDATED<br/>• Transiciones sin intervención"]
        end

        subgraph "Paso 4: Registro"
            R1["_create_approval_record()<br/>• INSERT Approval inmutable<br/>• previous_status, new_status<br/>• performed_by, role, comments"]
            R2["NotificationService<br/>• Notifica al siguiente rol<br/>• Alerta al solicitante"]
        end

        subgraph "Paso 5: Budget (si aplica)"
            B1["BudgetValidator.commit_budget()<br/>• Al pasar a VALIDATED"]
            B2["BudgetValidator.release_budget()<br/>• Al CANCELAR o RECHAZAR"]
        end

        subgraph "Paso 6: SLA (si aplica)"
            S1["SLACalculator.calculate_deadline()<br/>• Al pasar a VALIDATED<br/>• Calcula fecha_estimada_entrega"]
        end
    end

    ENTRY --> V1 --> V2 --> E1 --> E2 --> A1 --> R1 --> R2
    E1 --> B1
    E1 --> B2
    E1 --> S1
```

---

## 6. Arquitectura de Autenticación y Autorización

### 6.1 Flujo de Autenticación JWT Cookie-Based

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as React App
    participant AX as Axios
    participant N as Nginx
    participant DJ as Django
    participant JWT as SimpleJWT
    participant DB as PostgreSQL
    participant RD as Redis

    Note over B,RD: === PASO 1: LOGIN ===
    B->>R: Ingresa usuario + contraseña
    R->>AX: authApi.login({username, password})
    AX->>N: POST /api/v1/auth/login/
    N->>DJ: proxy_pass
    DJ->>DJ: ThrottleCheck (5/min login)
    DJ->>JWT: CustomTokenObtainPairView
    JWT->>DB: SELECT * FROM core_user WHERE username=?
    DB-->>JWT: User record
    JWT->>JWT: Verificar contraseña (bcrypt)
    JWT->>JWT: Generar access_token (HS256, 15min)
    JWT->>JWT: Generar refresh_token (HS256, 1d)
    JWT-->>DJ: TokenPair

    DJ-->>N: 200 OK + Set-Cookie headers
    Note over DJ,N: Set-Cookie: access_token=eyJ...<br/>  HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900<br/>Set-Cookie: refresh_token=eyJ...<br/>  HttpOnly; Secure; SameSite=Lax; Path=/auth/; Max-Age=86400
    N-->>AX: Response + Cookies
    AX-->>R: Login exitoso

    Note over B,RD: === PASO 2: CARGAR USUARIO ===
    R->>AX: authApi.getMe()
    AX->>N: GET /api/v1/users/me/
    Note over AX: Cookie access_token<br/>enviada automáticamente
    N->>DJ: Request
    DJ->>DJ: CookieJWTAuthentication
    DJ->>DJ: Lee cookie 'access_token'
    DJ->>JWT: Decodificar token
    JWT-->>DJ: payload {user_id, exp, ...}
    DJ->>DB: SELECT user + roles
    DB-->>DJ: User + UserRoles
    DJ-->>AX: {id, username, email, roles: [...]}
    AX-->>R: User data

    R->>R: AuthContext.setCurrentUser(user)
    R->>R: Redirect → SystemSelectPage

    Note over B,RD: === PASO 3: REQUESTS AUTENTICADOS ===
    R->>AX: requestsApi.getRequests()
    AX->>N: GET /api/v1/requests/
    Note over AX: Cookie enviada automáticamente
    N->>DJ: Request
    DJ->>DJ: CookieJWTAuthentication
    DJ->>DJ: IsAuthenticated ✓
    DJ->>RD: Check cache
    DJ->>DB: Query (si no cached)
    DJ-->>AX: 200 JSON data
    AX-->>R: Datos

    Note over B,RD: === PASO 4: TOKEN EXPIRA ===
    R->>AX: Cualquier API call
    AX->>N: GET /api/v1/...
    DJ-->>AX: 401 Unauthorized
    AX->>AX: Interceptor detecta 401
    AX->>N: POST /api/v1/auth/token/refresh/
    Note over AX: Cookie refresh_token<br/>enviada automáticamente
    DJ->>JWT: Validar refresh_token
    JWT->>JWT: Rotar: nuevo access + nuevo refresh
    JWT->>DB: Blacklist refresh anterior
    DJ-->>AX: Set-Cookie: nuevos tokens
    AX->>N: RETRY request original
    DJ-->>AX: 200 OK

    Note over B,RD: === PASO 5: LOGOUT ===
    R->>AX: authApi.logout()
    AX->>N: POST /api/v1/auth/logout/
    DJ->>DB: Blacklist refresh_token
    DJ-->>AX: Set-Cookie: clear tokens (Max-Age=0)
    AX-->>R: Logout OK
    R->>R: AuthContext.setCurrentUser(null)
    R->>R: Redirect → LoginPage
```

### 6.2 RBAC — Control de Acceso Basado en Roles

```mermaid
graph TB
    subgraph "Permission Classes (apps/core/permissions.py)"
        IA["IsAuthenticated<br/>(DRF built-in)<br/>Token JWT válido"]
        HR["HasRole<br/>Verifica que user<br/>tenga rol específico"]
        IGM["IsGeneralManager<br/>Solo GENERAL_MANAGER"]
        ILS["IsLogisticsStaff<br/>LOGISTICS_COORDINATOR<br/>LOGISTICS_SUPERVISOR<br/>LOGISTICS_CHIEF"]
        IWS["IsWarehouseStaff<br/>CENTRAL_WAREHOUSE<br/>SITE_WAREHOUSE"]
        IOA["IsOwnerOrAdmin<br/>Dueño del recurso<br/>o superuser"]
        IAR["IsAdminOrReadOnly<br/>Auth: read<br/>Staff: write"]
    end

    subgraph "Aplicación en ViewSets"
        RV["RequestViewSet<br/>permission_classes =<br/>[IsAuthenticated]"]
        SV["SupplierViewSet<br/>permission_classes =<br/>[IsAuthenticated, IsLogisticsStaff]"]
        UV["UserViewSet<br/>permission_classes =<br/>[IsAuthenticated, IsAdminOrReadOnly]"]
    end

    subgraph "Verificación en WorkflowEngine"
        WFP["WorkflowStep.responsible_role<br/>→ user.has_role(required_role)<br/>→ Si no tiene rol: PermissionDenied"]
    end

    subgraph "Frontend — RoleRoute"
        FRR["RoleRoute component<br/>requiredRoles={['PROJECT_RESIDENT']}<br/>→ useAuth().hasRole(role)<br/>→ Si no tiene rol: redirect /"]
    end

    IA --> RV
    IA --> SV
    ILS --> SV
    IA --> UV
    IAR --> UV
    HR --> WFP
    HR --> FRR
```

### 6.3 Matriz de Roles y Permisos por Endpoint

```mermaid
graph TB
    subgraph "Endpoints y Roles Requeridos"
        E1["POST /requests/<br/>→ REQUESTER"]
        E2["POST /requests/{id}/action/ (submit)<br/>→ REQUESTER"]
        E3["POST /requests/{id}/action/ (approve tech)<br/>→ PROJECT_RESIDENT"]
        E4["POST /requests/{id}/action/ (classify budget)<br/>→ PROJECT_CONTROL"]
        E5["POST /requests/{id}/action/ (approve GM)<br/>→ GENERAL_MANAGER"]
        E6["POST /requests/{id}/action/ (supervisor approve)<br/>→ DIRECT_SUPERVISOR"]
        E7["POST /requests/{id}/action/ (admin classify)<br/>→ ADMIN_MANAGER"]
        E8["POST /quotations/<br/>→ LOGISTICS_COORDINATOR | LOGISTICS_SUPERVISOR"]
        E9["POST /purchase-orders/<br/>→ LOGISTICS_COORDINATOR | LOGISTICS_SUPERVISOR"]
        E10["POST /warehouse/movements/<br/>→ CENTRAL_WAREHOUSE | SITE_WAREHOUSE"]
    end
```

---

## 7. Arquitectura de Tareas Asíncronas (Celery)

### 7.1 Flujo de Tareas

```mermaid
graph TB
    subgraph "Django Application"
        T1["Tarea disparada<br/>por código Django"]
        T2["Tarea programada<br/>por Celery Beat"]
    end

    subgraph "Redis (DB1 — Broker)"
        Q["Cola de tareas<br/>Formato JSON<br/>FIFO"]
    end

    subgraph "Celery Worker"
        W["Worker Process<br/>concurrency=2<br/>prefork pool"]

        subgraph "Tareas Registradas"
            T_SLA["check_sla_deadlines()<br/>• Query RQ con fecha_estimada < hoy<br/>• Envía notificación a requester<br/>• Alerta a logistics"]
            T_REM["send_pending_approval_reminders()<br/>• Query Approvals pendientes >24h<br/>• Envía recordatorio al aprobador<br/>• Email si configurado"]
            T_CACHE["invalidate_dashboard_caches()<br/>• cache.delete_pattern('dashboard_*')<br/>• Fuerza recálculo en próximo request"]
            T_STOCK["warehouse_low_stock_check()<br/>• Query InventoryStock < min_stock<br/>• Envía alerta a CENTRAL_WAREHOUSE<br/>• Email a warehouse_alert_recipients"]
        end
    end

    subgraph "Redis (DB2 — Results)"
        RES["Resultados de tareas<br/>task_id → result<br/>TTL configurable"]
    end

    subgraph "Celery Beat"
        SCHED["DatabaseScheduler<br/>(django_celery_beat)"]

        subgraph "Schedule"
            S1["check-sla-deadlines<br/>crontab(hour=8, minute=0)<br/>8:00 AM Lima diario"]
            S2["send-pending-approval-reminders<br/>crontab(hour='9,14', minute=0)<br/>9:00 AM y 2:00 PM"]
            S3["invalidate-dashboard-caches<br/>crontab(minute='*/15')<br/>Cada 15 minutos"]
            S4["warehouse-low-stock-check<br/>crontab(hour=7, minute=30)<br/>7:30 AM Lima diario"]
        end
    end

    subgraph "External"
        DB["PostgreSQL<br/>(ORM queries)"]
        EMAIL["Office 365<br/>(SMTP notifications)"]
    end

    T1 -->|.delay()| Q
    T2 --> SCHED
    SCHED --> S1 & S2 & S3 & S4
    S1 & S2 & S3 & S4 -->|schedule| Q
    Q --> W
    W --> T_SLA & T_REM & T_CACHE & T_STOCK
    T_SLA --> DB
    T_SLA --> EMAIL
    T_REM --> DB
    T_REM --> EMAIL
    T_CACHE --> RES
    T_STOCK --> DB
    T_STOCK --> EMAIL
    W --> RES
```

### 7.2 Configuración de Celery

```mermaid
graph LR
    subgraph "config/celery.py"
        CELAPP["app = Celery('syspcclog')<br/>app.config_from_object(<br/>  'django.conf:settings',<br/>  namespace='CELERY'<br/>)<br/>app.autodiscover_tasks()"]
    end

    subgraph "config/settings/base.py"
        CELCFG["CELERY_BROKER_URL = redis://.../1<br/>CELERY_RESULT_BACKEND = redis://.../2<br/>CELERY_TIMEZONE = 'America/Lima'<br/>CELERY_TASK_SERIALIZER = 'json'<br/>CELERY_TASK_TIME_LIMIT = 300<br/>CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True"]
    end

    subgraph "apps/rq/tasks.py"
        TASKS["@shared_task<br/>def check_sla_deadlines():<br/>    ...<br/><br/>@shared_task<br/>def send_pending_approval_reminders():<br/>    ...<br/><br/>@shared_task<br/>def invalidate_dashboard_caches():<br/>    ..."]
    end

    CELAPP --> CELCFG
    CELAPP --> TASKS
```

---

## 8. Arquitectura de Cache y Sesiones

### 8.1 Distribución de Redis

```mermaid
graph TB
    subgraph "Redis Server (:6379)"
        subgraph "DB 0 — Cache"
            C1["django-redis<br/>TTL: 300s (5 min)<br/>Key prefix: 'syspcclog'<br/>Max connections: 50"]
            C2["Datos cacheados:<br/>• Dashboard KPIs<br/>• Listas de proyectos<br/>• Conteo de notificaciones<br/>• Queries frecuentes"]
        end

        subgraph "DB 1 — Celery Broker"
            B1["Cola de mensajes<br/>• Tareas pendientes<br/>• Formato JSON<br/>• FIFO ordering"]
        end

        subgraph "DB 2 — Celery Results"
            R1["Resultados de tareas<br/>• task_id → result<br/>• Estado de ejecución<br/>• TTL automático"]
        end

        subgraph "Sessions"
            SS["Django Sessions<br/>• SESSION_ENGINE = cache<br/>• Redis-backed<br/>• SESSION_COOKIE_AGE = 3600<br/>  (1 hora en producción)"]
        end
    end
```

### 8.2 Estrategia de Cache

```mermaid
sequenceDiagram
    participant V as ViewSet
    participant C as Redis Cache
    participant DB as PostgreSQL

    Note over V,DB: Patrón Cache-Aside

    V->>C: cache.get('dashboard_kpi_project_42')

    alt Cache HIT
        C-->>V: Datos cacheados
        Note over V: Retorna sin query a DB
    else Cache MISS
        C-->>V: None
        V->>DB: SELECT count(*), sum(*) FROM ...
        DB-->>V: Datos frescos
        V->>C: cache.set('dashboard_kpi_project_42', data, timeout=300)
        Note over V: Retorna datos frescos
    end

    Note over V,DB: Invalidación cada 15 min (Celery Beat)
    Note over C: invalidate_dashboard_caches()<br/>cache.delete_pattern('dashboard_*')
```

---

## 9. Modelo de Datos — Relaciones Detalladas

### 9.1 Diagrama ER Completo

```mermaid
erDiagram
    User ||--o{ UserRole : "has"
    User ||--o| Personal : "linked_to"
    User ||--o{ Request : "requested_by"
    User ||--o{ Approval : "performed_by"
    User ||--o{ PurchaseOrder : "generated_by"
    User ||--o{ InventoryMovement : "registered_by"
    User ||--o{ Ticket : "created_by"
    User ||--o{ Pasaje : "creado_por"

    UserRole }o--|| Project : "scoped_to"
    UserRole }o--|| Department : "scoped_to"

    Project ||--o{ ProjectBudgetLine : "has"
    Project ||--o{ Request : "belongs_to"
    Project ||--o{ InventoryStock : "scoped_to"
    Project ||--o{ MovementGroup : "belongs_to"
    Project ||--o{ Personal : "assigned_to"

    Department ||--o{ AnnualPlan : "has"
    Department ||--o{ Request : "belongs_to"
    Department }o--|| User : "managed_by"

    AnnualPlan ||--o{ AnnualPlanLine : "has"

    Request ||--o{ RequestItem : "contains"
    Request ||--o{ Approval : "has"
    Request ||--o{ Quotation : "has"
    Request ||--o{ PurchaseOrder : "has"
    Request ||--o{ Claim : "has"
    Request }o--o| ProjectBudgetLine : "charged_to"
    Request }o--o| AnnualPlanLine : "charged_to"
    Request }o--o| WorkflowStep : "current_step"

    RequestItem }o--o| Inventory : "linked_to"

    Quotation }o--|| Supplier : "from"
    Quotation ||--o{ QuotationItem : "contains"
    QuotationItem }o--|| RequestItem : "quotes"

    PurchaseOrder }o--|| Supplier : "to"
    PurchaseOrder }o--|| Quotation : "based_on"
    PurchaseOrder ||--o{ PurchaseOrderItem : "contains"
    PurchaseOrderItem }o--|| RequestItem : "for"

    Inventory ||--o{ InventoryStock : "stocked_at"
    Inventory ||--o{ InventoryMovement : "tracked_by"

    InventoryMovement }o--o| MovementGroup : "grouped_in"

    Pasaje }o--o| Personal : "for"
    Pasaje }o--|| ProveedorPasajes : "from"
    Pasaje }o--|| Project : "charged_to"

    Ticket ||--o{ TicketComment : "has"

    User {
        int id PK
        string username UK
        string email UK
        string first_name
        string last_name
        string position
        string phone
        image signature
    }

    UserRole {
        int id PK
        int user_id FK
        string role
        int project_id FK
        int department_id FK
        bool is_primary
    }

    Project {
        int id PK
        string code UK
        string name
        string location
        decimal total_budget
        bool is_active
    }

    ProjectBudgetLine {
        int id PK
        int project_id FK
        string code
        decimal budgeted_amount
        decimal committed_amount
        decimal spent_amount
    }

    Department {
        int id PK
        string code UK
        string name
        int manager_id FK
    }

    Request {
        int id PK
        string rq_number UK
        string flow
        int project_id FK
        int department_id FK
        int requested_by_id FK
        string status
        string priority
        decimal estimated_cost
        date fecha_necesidad
    }

    RequestItem {
        int id PK
        int request_id FK
        int line_number
        string description
        decimal quantity
        string unit
        decimal unit_price
        decimal total_price
    }

    Approval {
        int id PK
        int request_id FK
        string action
        int performed_by_id FK
        string role
        string previous_status
        string new_status
        text comments
        datetime performed_at
    }

    Supplier {
        int id PK
        string ruc UK
        string business_name
        string contact_email
        bool is_active
    }

    Quotation {
        int id PK
        int request_id FK
        int supplier_id FK
        decimal total_amount
        string currency
        bool is_selected
    }

    PurchaseOrder {
        int id PK
        string po_number UK
        int request_id FK
        int supplier_id FK
        decimal total_amount
        string status
    }

    Inventory {
        int id PK
        string product_code UK
        string description
        string unit
        string item_type
        decimal min_stock
    }

    InventoryStock {
        int id PK
        int inventory_id FK
        string warehouse_type
        int project_id FK
        decimal quantity
    }

    InventoryMovement {
        int id PK
        string movement_number UK
        string movement_type
        int inventory_id FK
        decimal quantity
        int group_id FK
    }

    Pasaje {
        int id PK
        string tipo
        int personal_id FK
        string dni
        decimal total
        string estado
    }

    Ticket {
        int id PK
        string ticket_number UK
        string title
        string category
        string priority
        string status
    }
```

---

## 10. Rate Limiting y Throttling

```mermaid
graph TB
    subgraph "Configuración de Throttle"
        subgraph "Desarrollo"
            DEV_ANON["Anónimo: 300/min"]
            DEV_AUTH["Autenticado: 1000/min"]
            DEV_LOGIN["Login: 30/min"]
        end

        subgraph "Producción"
            PROD_ANON["Anónimo: 30/min"]
            PROD_AUTH["Autenticado: 200/min"]
            PROD_LOGIN["Login: 5/min"]
        end
    end

    subgraph "Flujo de Verificación"
        REQ2["Request entrante"]
        CHECK["DRF Throttle Check<br/>AnonRateThrottle<br/>UserRateThrottle"]
        CACHE2["Redis Cache<br/>Almacena conteo<br/>por IP/user"]
        PASS["✅ Pasa<br/>Continúa a View"]
        BLOCK["❌ 429 Too Many Requests<br/>Retry-After header"]
    end

    REQ2 --> CHECK
    CHECK --> CACHE2
    CACHE2 -->|Bajo límite| PASS
    CACHE2 -->|Sobre límite| BLOCK
```

---

*Documento generado para SYSPCC v1.0 — PCC Ingeniería y Construcción*
*Última actualización: Abril 2026*
