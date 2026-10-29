# SYSPCC — Arquitectura de Bajo Nivel

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.1 | **Fecha:** Octubre 2026 | **Empresa:** PCC Ingeniería y Construcción

---

## 1. Estructura de Capas del Backend

### 1.1 Flujo completo de un Request HTTP

```mermaid
graph TB
    REQ["🌐 HTTP Request<br/>GET /api/v1/requests/?status=SUBMITTED"]

    subgraph "Entrada"
        NG["Proxy inverso o plataforma<br/>TLS"]
    end

    subgraph "Gunicorn"
        GU["WSGI Server"]
    end

    subgraph "Django Middleware Stack (config/settings/base.py)"
        MW0["HealthCheckMiddleware<br/>responde /healthz/ antes que nada"]
        MW1["SecurityMiddleware<br/>HSTS, X-Content-Type"]
        MWW["WhiteNoiseMiddleware<br/>estáticos (solo producción)"]
        MWH["HRNoStoreMiddleware<br/>no-store en /api/v1/hr/*"]
        MW3["CorsMiddleware<br/>CORS headers"]
        MW2["SessionMiddleware<br/>sesiones en caché (panel de Django)"]
        MW4["CommonMiddleware<br/>URL normalization"]
        MW5["CsrfViewMiddleware<br/>CSRF protection"]
        MW6["AuthenticationMiddleware<br/>MessageMiddleware<br/>XFrameOptionsMiddleware"]
    end

    subgraph "URL Router"
        URL1["config/urls.py"]
        URL2["apps/rq/urls.py"]
        URL3["DRF Router<br/>auto-URL generation"]
    end

    subgraph "DRF View Layer"
        AUTH["CookieJWTAuthentication<br/>Lee el JWT de la cookie, exige CSRF<br/>en métodos de escritura y bloquea<br/>must_change_password"]
        PERM["Permission Check<br/>IsAuthenticated + permisos del ViewSet<br/>(CanPerformWorkflowAction, IsLogisticsStaff, ...)"]
        THROT["Throttle Check<br/>200 req/min (usuario)"]
        VIEW["RequestViewSet<br/>.list() / .retrieve() / .create()"]
        FILT["FilterBackend<br/>DjangoFilterBackend<br/>SearchFilter<br/>OrderingFilter"]
        PAG["Pagination<br/>PageNumberPagination<br/>page_size=20"]
    end

    subgraph "Serializer Layer"
        SER["RequestListSerializer<br/>RequestDetailSerializer<br/>RequestCreateSerializer"]
        VAL["Validation<br/>validate_*() methods<br/>Field-level + Object-level"]
        NEST["Nested Serializers<br/>RequestItemSerializer"]
    end

    subgraph "Service Layer"
        WF["WorkflowEngine<br/>State machine"]
        BV["BudgetValidator<br/>Budget checks"]
        SLA["SLACalculator<br/>Fecha estimada"]
        NS["NotificationService<br/>Notificaciones en la app"]
        NG2["RQNumberGenerator<br/>PONumberGenerator"]
        RQS["request_items · stock_availability<br/>request_catalog"]
    end

    subgraph "Model Layer (ORM)"
        MOD["get_accessible_requests_queryset(user)<br/>.select_related('project','department','requested_by','current_step',...)<br/>.prefetch_related('items__inventory_item')"]
    end

    subgraph "Database"
        PG["PostgreSQL 16 (producción)<br/>SQLite (desarrollo)"]
    end

    RESP["📤 JSON Response<br/>{count: 5, results: [...]}"]

    REQ --> NG --> GU
    GU --> MW0 --> MW1 --> MWW --> MWH --> MW3 --> MW2 --> MW4 --> MW5 --> MW6
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
    VIEW --> RQS
    VIEW --> MOD
    MOD --> PG
    PG --> RESP
```

### 1.2 Responsabilidad de cada capa

```mermaid
graph LR
    subgraph "URLs"
        U["Routing<br/>• Mapea URL → ViewSet<br/>• DRF Router auto-genera<br/>  list/detail/actions<br/>• Todo bajo /api/v1/"]
    end

    subgraph "Views"
        V["Orquestación<br/>• Autenticación/autorización<br/>• Throttling<br/>• Filtros, búsqueda, orden<br/>• Paginación<br/>• Delega lógica a Services<br/>• @action para endpoints custom"]
    end

    subgraph "Serializers"
        S["Validación y Transformación<br/>• Valida input (create/update)<br/>• Serializa output (JSON)<br/>• Nested relationships<br/>• Campos calculados<br/>  (SerializerMethodField)<br/>• write_only / read_only"]
    end

    subgraph "Services"
        SV["Lógica de Negocio<br/>• WorkflowEngine (estados)<br/>• BudgetValidator (presup.)<br/>• SLACalculator (plazos)<br/>• RQNumberGenerator / PONumberGenerator<br/>• NotificationService (avisos)<br/>• movements, kardex, epp, imports (almacén)<br/>• document_service, cv_* (RR. HH.)"]
    end

    subgraph "Models"
        M["Persistencia<br/>• Definición de esquema<br/>• Relaciones (FK, M2M)<br/>• Constraints / Unique<br/>• Índices de performance<br/>• Properties calculadas<br/>• save() con auto-cálculos"]
    end

    U --> V --> S --> SV --> M
```

---

## 2. Estructura de Archivos del Backend

```text
backend/
├── config/
│   ├── settings/
│   │   ├── base.py              # configuración común
│   │   ├── development.py       # DEBUG, SQLite, CORS abierto
│   │   ├── production.py        # PostgreSQL con SSL, HSTS, WhiteNoise
│   │   ├── demo.py              # hereda de production (sin Redis ni worker)
│   │   └── guards.py            # validaciones de arranque (proveedor de CVs)
│   ├── urls.py                  # /api/v1/, /mgmt-panel/, /api/docs/
│   ├── urls_demo.py
│   ├── celery.py
│   ├── wsgi.py
│   └── asgi.py
├── apps/
│   ├── core/
│   │   ├── models/              # base, user, project, department, personal
│   │   ├── serializers/         # auth, user, project, department, personal
│   │   ├── views/               # auth, user, project, department, personal
│   │   ├── urls/                # auth, users, projects, departments, personal
│   │   ├── services/            # user_admin.py, signature.py
│   │   ├── utils/excel.py       # saneamiento de exportaciones a Excel
│   │   ├── authentication.py    # CookieJWTAuthentication (JWT + CSRF + cambio forzado)
│   │   ├── permissions.py
│   │   ├── throttling.py
│   │   ├── middleware.py        # /healthz/ e IP real del cliente
│   │   ├── enums.py             # roles, estados, acciones, prioridades, ...
│   │   ├── exceptions.py
│   │   ├── fields.py            # campo cifrado (tokens de OneDrive)
│   │   └── management/commands/ # seed_data, seed_demo, seed_demo_extra, seed_screenshots
│   ├── rq/
│   │   ├── models/              # request, approval, workflow, supplier, quotation,
│   │   │                        #   purchase_order, claim, attachment, notification, activity_log
│   │   ├── serializers/         # request, approval, quotation, purchase_order, supplier,
│   │   │                        #   claim, attachment, notification, activity_log, catalog, workflow
│   │   ├── views/               # request, catalog, supplier, claim, workflow
│   │   ├── services/
│   │   │   ├── workflow_engine.py      # TRANSITIONS + WorkflowEngine
│   │   │   ├── budget_validator.py
│   │   │   ├── sla_calculator.py
│   │   │   ├── number_generator.py     # RQ-AAAA-NNNN y OC-AAAA-NNNN
│   │   │   ├── notification_service.py
│   │   │   ├── request_items.py        # confirmación de vínculos (update-items)
│   │   │   ├── request_catalog.py      # búsqueda en el catálogo del almacén
│   │   │   ├── stock_availability.py   # solicitado vs. stock CENTRAL
│   │   │   ├── units.py
│   │   │   ├── link_suggestions.py     # sugerencias de vínculo (solo lectura)
│   │   │   └── stock_diagnostics.py    # diagnósticos (solo lectura)
│   │   ├── management/commands/ # check_central_project_stock, report_rq_stock_gaps,
│   │   │                        #   suggest_inventory_links
│   │   ├── tasks.py             # SLA, recordatorios, invalidación de caché
│   │   ├── cache.py
│   │   ├── filters.py
│   │   ├── permissions.py       # alcance de visibilidad y CanPerformWorkflowAction
│   │   ├── throttling.py
│   │   └── urls.py
│   ├── warehouse/
│   │   ├── models/              # inventory, movement, receipt, dispatch,
│   │   │                        #   onedrive_token, inventory_import
│   │   ├── services/            # catalog, movements, kardex, locations, epp, exports,
│   │   │                        #   onedrive, pdf_generator, personal_matching, dates,
│   │   │                        #   imports/ (parser, validators, planner, applier, ...)
│   │   ├── views.py             # inventario, movimientos, OneDrive, RQ pendientes
│   │   ├── views_imports.py     # importación del libro de inventario
│   │   ├── views_personal.py    # búsqueda de trabajadores
│   │   ├── permissions.py       # IsWarehouseRole y permisos por acción
│   │   ├── query_guard.py
│   │   ├── serializers.py
│   │   ├── serializers_imports.py
│   │   ├── tasks.py             # PDF a OneDrive, stock bajo, purga de importaciones
│   │   ├── throttling.py
│   │   └── urls.py
│   ├── administracion/         # models.py, serializers.py, services.py, views.py, urls.py
│   ├── support/                # models.py, serializers.py, services.py, views.py, urls.py
│   └── hr/
│       ├── models/             # document_template, generated_document, document_event,
│       │                       #   cv_analysis, cv_analysis_item
│       ├── documents/          # registry, contract, formatters
│       ├── services/           # document_service, template_service, docx_renderer,
│       │                       #   pdf_converter, assistant_*, cv_* (análisis de CVs)
│       ├── views/              # template, document, cv, assistant, meta, common
│       ├── serializers/
│       ├── tasks.py            # cola hr_cv
│       ├── storage.py          # almacenamiento privado
│       ├── middleware.py       # no-store
│       └── urls.py
├── requirements.txt
├── manage.py
└── Dockerfile
```

---

## 3. Estructura de Componentes del Frontend

### 3.1 Árbol de Componentes React

```mermaid
graph TB
    subgraph "App.jsx — Raíz"
        TH["ThemeProvider<br/>(ThemeContext)"]
        TP["ToastProvider<br/>(ToastContext)"]
        AP["AuthProvider<br/>(AuthContext)"]
        BR["BrowserRouter<br/>(React Router v7)"]
    end

    subgraph "Rutas públicas y de acceso"
        LOGIN["LoginPage<br/>/login"]
        CHPW["ChangePasswordRequiredPage<br/>/cambiar-password"]
        RPC["RequirePasswordChangeLayout<br/>envuelve todas las rutas autenticadas"]
        SYSSEL["SystemSelectPage<br/>/"]
    end

    subgraph "Shell RQ — /rq/*"
        APPSH["AppShell"]
        HEADER["Header (tema, notificaciones, usuario)"]
        SIDEBAR["Sidebar"]

        subgraph "Páginas RQ"
            DASH["DashboardPage"]
            RLIST["RequestListPage"]
            RCREATE["RequestCreatePage<br/>(formulario con catálogo)"]
            RDETAIL["RequestDetailPage"]
        end

        subgraph "Páginas Aprobaciones"
            APPROV["ApprovalsPage"]
            TECH["TechReviewPage<br/>(PROJECT_RESIDENT)"]
            BUDG["BudgetReviewPage<br/>(PROJECT_CONTROL, ADMIN_MANAGER)"]
            QCR["QuoteCostReviewPage<br/>(PROJECT_CONTROL, ADMIN_MANAGER)"]
            MGR["ManagerApprovalPage<br/>(GENERAL_MANAGER)"]
            COST["CostOverrunReviewPage<br/>(GENERAL_MANAGER)"]
        end

        subgraph "Páginas Operaciones"
            LOGP["LogisticsPage"]
            LOGA["LogisticsActionPage<br/>(verificación de stock, cotizaciones,<br/>recepción, reclamos y cierre)"]
        end

        REPOR["ReportsPage<br/>(GENERAL_MANAGER)"]
    end

    subgraph "Shell Almacén — /almacen/*"
        WHSH["WarehouseShell"]
        WHSB["WarehouseSidebar"]

        WHDASH["AlmacenDashboardPage"]
        INV["InventarioPage"]
        KAR["KardexPage"]
        RES["ResumenPage"]
        PEN["PendientesPage"]
        ENT["EntradaPage"]
        SAL["SalidaPage"]
        VOUCH["VoucherPrint"]
        MOV["MovimientosPage"]
        TRA["TransferenciaPage"]
        IMP["ImportarPage"]
    end

    subgraph "Shell Admin — /admin/*"
        ADMSH["AdminShell"]
        ADMSB["AdminSidebar"]

        ADMMENU["AdminMenuPage<br/>(selector, sin sidebar)"]
        ADMDASH["AdminDashboardPage"]
        PAS["PasajesPage"]
        PAG["PagosPage"]
        POL["PoliticasPage"]
        PROV["ProveedoresPage"]
    end

    subgraph "Shell RR. HH. — /rrhh/*"
        HRSH["HRShell"]
        HRSB["HRSidebar"]

        HRDL["HRDocumentsListPage"]
        HRDC["HRDocumentCreatePage"]
        HRDD["HRDocumentDetailPage"]
        HRTP["HRTemplatesPage"]
        HRCL["HRCVAnalysesListPage"]
        HRCW["HRCVWizardPage"]
        HRCA["HRCVAnalysisPage"]
    end

    subgraph "Shell Sistema — /sistema/* (solo superusuario)"
        SYSH["SystemAdminShell"]
        SYSB["SystemSidebar"]

        USRP["UsersPage"]
        USRF["UserFormPage"]
        PRJP["ProjectsPage"]
        PRJF["ProjectFormPage"]
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

    TH --> TP --> AP --> BR
    BR --> LOGIN
    BR --> CHPW
    BR --> RPC
    RPC --> SYSSEL
    RPC --> APPSH
    RPC --> WHSH
    RPC --> ADMSH
    RPC --> HRSH
    RPC --> SYSH
    RPC --> SUPSH
    RPC --> SETT

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
    WHSH --> RES
    WHSH --> PEN
    WHSH --> ENT
    WHSH --> SAL
    WHSH --> VOUCH
    WHSH --> MOV
    WHSH --> TRA
    WHSH --> IMP

    ADMSH --> HEADER
    ADMSH --> ADMSB
    ADMSH --> ADMDASH
    ADMSH --> PAS
    ADMSH --> PAG
    ADMSH --> POL
    ADMSH --> PROV
    RPC --> ADMMENU

    HRSH --> HEADER
    HRSH --> HRSB
    HRSH --> HRDL
    HRSH --> HRDC
    HRSH --> HRDD
    HRSH --> HRTP
    HRSH --> HRCL
    HRSH --> HRCW
    HRSH --> HRCA

    SYSH --> HEADER
    SYSH --> SYSB
    SYSH --> USRP
    SYSH --> USRF
    SYSH --> PRJP
    SYSH --> PRJF

    SUPSH --> HEADER
    SUPSH --> SUPSB
    SUPSH --> SUPDASH
    SUPSH --> TIKC
    SUPSH --> TIKL
    SUPSH --> TIKD
```

Los archivos `pages/operations/WarehousePage.jsx` y `WarehouseActionPage.jsx` existen pero no están enrutados en `App.jsx`.

### 3.2 Componentes Reutilizables

```mermaid
graph TB
    subgraph "components/layout/"
        HL["Header<br/>• Nombre y rol del usuario<br/>• Notificaciones (bell icon)<br/>• Botón de tema claro/oscuro<br/>• Menú de usuario"]
        SBR["Sidebar / WarehouseSidebar / AdminSidebar /<br/>SupportSidebar / HRSidebar / SystemSidebar<br/>• Navegación por módulo<br/>• Íconos Lucide<br/>• Ítems según rol"]
    end

    subgraph "components/auth/"
        RR["RoleRoute<br/>• Acceso si el usuario tiene ALGUNO de requiredRoles<br/>• Redirect (por defecto a /rq) si no"]
        SUR["SuperUserRoute<br/>• Exige is_superuser<br/>• Solo UX: el backend valida IsSuperUser"]
        RPCL["RequirePasswordChangeLayout<br/>• Lleva a /cambiar-password si<br/>  must_change_password está activo"]
    end

    subgraph "components/ui/"
        SB["StatusBadge<br/>• Color y etiqueta por estado (STATUS_CONFIG)"]
        PB["PriorityBadge<br/>• URGENT/HIGH/NORMAL/LOW<br/>• Colores diferenciados"]
        CM["ConfirmModal<br/>• Diálogo de confirmación"]
        NI["NumberInput<br/>• Input numérico<br/>• Validación client-side"]
        SC["SummaryCard<br/>• Tarjeta de métricas"]
        TT["ThemeToggleButton<br/>• Alterna claro/oscuro"]
    end

    subgraph "components/requests/"
        AL["ActivityLog<br/>• Timeline de acciones"]
        AC["ApprovalChain<br/>• Cadena de aprobaciones"]
        LB["LifecycleBar<br/>• Barra de 5 fases (LIFECYCLE_PHASES)"]
        CC["CatalogCombobox · ItemProductCell<br/>• Búsqueda de productos del catálogo<br/>• Marca fuera de catálogo"]
        SCP["StockCheckPanel · CoverageBadge<br/>• Solicitado vs. disponible por ítem"]
    end

    subgraph "components/almacen/ y components/rrhh/"
        ALM["ItemCombobox · WorkerCombobox · LocationPicker<br/>AssignLocationModal · importer/*"]
        RRH["ContractForm · AssistantPanel · WorkerPicker<br/>cv/* (wizard, tabla de candidatos, progreso)"]
    end
```

### 3.3 Estructura de Archivos del Frontend

```text
frontend/src/
├── App.jsx                 # Router principal
├── main.jsx                # Entry point
├── index.css               # Estilos globales, tokens y capa de compatibilidad del tema oscuro
├── api/                    # 18 archivos
│   ├── client.js           # instancia Axios, CSRF e interceptor 401
│   ├── config.js           # API_BASE_URL, BACKEND_URL
│   ├── index.js            # exporta auth, requests, core, suppliers, notifications,
│   │                       #   claims, workflow y hr; el resto se importa directo
│   ├── auth.js · users.js · projects.js · core.js
│   ├── requests.js · suppliers.js · claims.js · notifications.js · workflow.js
│   ├── almacen.js · almacenImport.js · warehouse.js
│   ├── administracion.js · support.js · hr.js
├── context/
│   ├── AuthContext.jsx     # currentUser, login, logout, userRoles, hasRole, isSuperUser
│   ├── ToastContext.jsx    # showToast
│   └── ThemeContext.jsx    # mode (claro/oscuro/auto), autoRange, resolvedTheme
├── hooks/                  # useApi, useFileDownload, useFileDrop, useFocusFirstInvalid,
│                           #   useCVAnalysis/Config/Progress/Upload, useMediaQuery, ...
├── data/                   # constants.js, almacenConstants.js, almacenRoles.js,
│                           #   requestCapture.js, supportConstants.js, mockData.js
├── utils/                  # format, exportRQ (ExcelJS), theme, quantity, stockCheck,
│                           #   requestCapture, almacen*, apiErrors, cv*, hrErrors, download
├── pages/                  # 51 páginas
│   ├── auth/               # LoginPage, SystemSelectPage, ChangePasswordRequiredPage
│   ├── dashboard/          # DashboardPage
│   ├── requests/           # lista, creación y detalle
│   ├── approvals/          # ApprovalsPage y 5 pantallas de revisión
│   ├── operations/         # LogisticsPage, LogisticsActionPage
│   ├── almacen/            # 11 páginas de almacén
│   ├── admin/              # menú, dashboard, pasajes, pagos, políticas, proveedores
│   ├── rrhh/               # documentos, plantillas, análisis de CVs
│   ├── sistema/            # usuarios y proyectos
│   ├── support/            # 4 páginas de soporte
│   ├── reports/            # ReportsPage
│   └── settings/           # SettingsPage
├── components/             # 79 archivos
│   ├── layout/ · auth/ · ui/ · requests/
│   ├── almacen/ (incluye importer/) · rrhh/ (incluye cv/) · sistema/
└── test/                   # utilidades de Vitest (se prueban 157 archivos *.test.*)
```

### 3.4 Tema Claro/Oscuro

```mermaid
graph LR
    HTML["index.html<br/>script anti-parpadeo<br/>aplica la clase .dark antes de React"]
    UTH["utils/theme.js<br/>resolveTheme(mode, autoRange)<br/>localStorage 'syspcc.theme.v1'"]
    CTX["ThemeContext<br/>mode: light, dark o auto<br/>rango auto por defecto 19:00 a 07:00"]
    CSS["index.css<br/>@custom-variant dark (.dark)<br/>tokens + capa de compatibilidad<br/>para las utilidades neutras de Tailwind"]
    UI["ThemeToggleButton (Header)<br/>SettingsPage → Apariencia"]

    HTML --> CTX
    UTH --> CTX
    CTX -->|clase .dark en html| CSS
    UI --> CTX
```

La resolución del tema vive en `utils/theme.js` y se replica en el script de `index.html`; ambos deben mantenerse iguales. En modo automático se programa un único temporizador hasta el siguiente límite del rango y se reevalúa al volver a la pestaña.

---

## 4. Capa de Comunicación API

### 4.1 Flujo Request/Response completo

```mermaid
sequenceDiagram
    participant PG as Página React
    participant HOOK as useApi Hook
    participant AX as Axios Client
    participant API as Django API
    participant JWT as CookieJWTAuth

    Note over PG,JWT: Flujo normal (token válido)
    PG->>HOOK: execute(getRequests, {status: 'SUBMITTED'})
    HOOK->>HOOK: setLoading(true)
    HOOK->>AX: api.get('/requests/', {params})
    Note over AX: withCredentials: true<br/>Cookie access_token enviada auto<br/>X-CSRFToken en POST/PUT/PATCH/DELETE
    AX->>API: GET /api/v1/requests/?status=SUBMITTED
    API->>JWT: authenticate(request)
    JWT->>JWT: Lee la cookie 'access_token'
    JWT->>JWT: Decodifica el JWT (HS256)
    JWT->>JWT: Rechaza si must_change_password y la ruta no está permitida
    JWT-->>API: user object
    API->>API: Permission check (IsAuthenticated + ViewSet)
    API->>API: Throttle check (200/min)
    API->>API: Filter + Search + Order
    API->>API: Paginate (page_size=20)
    API-->>AX: 200 {count, next, previous, results}
    AX-->>HOOK: response.data
    HOOK->>HOOK: setData(response.data)
    HOOK->>HOOK: setLoading(false)
    HOOK-->>PG: {data, loading: false, error: null}
```

### 4.2 Flujo ante un 401 (token expirado)

```mermaid
sequenceDiagram
    participant R1 as Request 1
    participant R2 as Request 2
    participant R3 as Request 3
    participant AX as Axios Interceptor
    participant API as Django Auth

    Note over R1,API: Múltiples requests con el token expirado

    R1->>AX: GET /requests/
    AX->>API: Request (cookie expirada)
    API-->>AX: 401 Unauthorized
    AX->>AX: isRefreshing = true

    R2->>AX: GET /notifications/
    AX->>AX: isRefreshing? → Sí
    AX->>AX: Encolar R2 en failedQueue

    R3->>AX: GET /projects/
    AX->>AX: isRefreshing? → Sí
    AX->>AX: Encolar R3 en failedQueue

    AX->>API: POST /auth/token/refresh/ (cuerpo vacío + X-CSRFToken)
    Note over AX,API: Axios "limpio" (sin pasar por el interceptor)<br/>para no entrar en recursión

    alt El backend acepta la renovación
        API-->>AX: Tokens nuevos
        AX->>AX: processQueue(null)
        AX->>API: Reintenta R1, R2 y R3
    else El backend rechaza la renovación
        API-->>AX: Error
        AX->>AX: processQueue(error)
        AX-->>R1: Rechaza la petición (AuthContext maneja la sesión)
    end
```

Brecha conocida: la vista `/auth/token/refresh/` es el `TokenRefreshView` estándar de SimpleJWT, que lee `refresh` del cuerpo de la petición. El interceptor la llama con el cuerpo vacío (el refresh vive en una cookie `httpOnly` que el navegador no puede leer), por lo que la renovación depende de ese comportamiento del servidor. El código de pruebas de `apps/core` la reconoce como una brecha preexistente (`test_must_change_password_gate.py`).

Además, el interceptor redirige a `/cambiar-password` cuando recibe un 403 con `code: "must_change_password"`.

### 4.3 Estructura del Axios Client

```mermaid
graph TB
    subgraph "api/client.js"
        CREATE["axios.create({<br/>  baseURL: API_BASE_URL (VITE_API_URL),<br/>  withCredentials: true,<br/>  headers: {Content-Type: 'application/json'}<br/>})"]

        REQI["Request Interceptor<br/>attachCsrfToken: copia la cookie csrftoken<br/>al header X-CSRFToken en POST/PUT/PATCH/DELETE"]

        subgraph "Response Interceptor"
            PW["¿403 must_change_password?<br/>→ /cambiar-password"]
            CHK["¿Status === 401?"]
            SKP["¿Es endpoint de auth?<br/>/token/refresh/, /login/, /users/me/"]
            REF["Refresh Token Flow"]
            QUE["Cola de requests<br/>failedQueue[]"]
            RET["Retry all queued"]
            ERR["Promise.reject(error)"]
        end
    end

    CREATE --> REQI
    CREATE --> PW
    PW --> CHK
    CHK -->|No| ERR
    CHK -->|Sí| SKP
    SKP -->|Sí| ERR
    SKP -->|No| REF
    REF --> QUE
    REF --> RET
```

---

## 5. Motor de Workflow — Máquina de Estados Detallada

El motor (`apps/rq/services/workflow_engine.py`) define 71 transiciones en la lista `TRANSITIONS` y valida cada acción contra el flujo del RQ, su estado actual y el rol del usuario. `RQStatusChoices` define 47 estados; 37 de ellos intervienen en las transiciones. Los flujos los define gerencia y no se modifican; los diagramas siguientes solo los describen con los nombres reales de las acciones (`ApprovalActionChoices`).

### 5.1 Flujo OPERATIONS — Diagrama Completo

```mermaid
stateDiagram-v2
    [*] --> DRAFT

    state "FASE 1 — Solicitud" as F1 {
        DRAFT --> SUBMITTED: SUBMITTED<br/>[REQUESTER]
    }

    state "FASE 2 — Validación Técnica y Presupuestal" as F2 {
        SUBMITTED --> TECHNICAL_APPROVED: TECHNICAL_APPROVED<br/>[PROJECT_RESIDENT]
        SUBMITTED --> TECHNICAL_REJECTED: TECHNICAL_REJECTED<br/>[PROJECT_RESIDENT]

        TECHNICAL_APPROVED --> WITHIN_PROPOSAL: BUDGET_CLASSIFIED (BC_WITHIN_PROPOSAL)<br/>[PROJECT_CONTROL]
        TECHNICAL_APPROVED --> ADDITIONAL_REQ: BUDGET_CLASSIFIED (BC_ADDITIONAL)<br/>[PROJECT_CONTROL]
        TECHNICAL_APPROVED --> TECHNICAL_REJECTED: BUDGET_REJECTED<br/>[PROJECT_CONTROL]

        WITHIN_PROPOSAL --> VALIDATED: VALIDATED (sistema)

        ADDITIONAL_REQ --> GM_REVIEW: TECHNICAL_APPROVED<br/>[PROJECT_RESIDENT]
        ADDITIONAL_REQ --> TECHNICAL_REJECTED: TECHNICAL_REJECTED<br/>[PROJECT_RESIDENT]

        GM_REVIEW --> GM_APPROVED: GM_APPROVED<br/>[GENERAL_MANAGER]
        GM_REVIEW --> GM_REJECTED: GM_REJECTED<br/>[GENERAL_MANAGER]

        GM_APPROVED --> VALIDATED: VALIDATED (sistema)
    }

    state "FASE 3 — Logística y Compras" as F3 {
        VALIDATED --> IN_STOCK: STOCK_CHECKED (has_stock=true)<br/>[LOGISTICS_COORDINATOR]
        VALIDATED --> REQUIRES_PURCHASE: STOCK_CHECKED (has_stock=false)<br/>[LOGISTICS_COORDINATOR]

        REQUIRES_PURCHASE --> QUOTING: QUOTE_REQUESTED<br/>[LOGISTICS_COORDINATOR]
        QUOTING --> QUOTE_COMPARISON: QUOTE_COMPARED<br/>[LOGISTICS_COORDINATOR]
        QUOTE_COMPARISON --> QUOTE_SELECTED: QUOTE_SELECTED<br/>[LOGISTICS_COORDINATOR]

        QUOTE_SELECTED --> QUOTE_COST_APPROVED: QUOTE_COST_APPROVED<br/>[PROJECT_CONTROL]
        QUOTE_SELECTED --> COST_OVERRUN_REVIEW: QUOTE_COST_REJECTED<br/>[PROJECT_CONTROL]

        COST_OVERRUN_REVIEW --> COST_OVERRUN_APPROVED: COST_OVERRUN_APPROVED<br/>[GENERAL_MANAGER]
        COST_OVERRUN_REVIEW --> COST_OVERRUN_REJECTED: COST_OVERRUN_REJECTED<br/>[GENERAL_MANAGER]

        QUOTE_COST_APPROVED --> PO_GENERATED: PO_GENERATED<br/>[LOGISTICS_COORDINATOR]
        COST_OVERRUN_APPROVED --> PO_GENERATED: PO_GENERATED<br/>[LOGISTICS_COORDINATOR]
    }

    state "FASE 4 — Recepción y Entrega" as F4 {
        PO_GENERATED --> RECEIVING: RECEIVED<br/>[LOGISTICS_COORDINATOR]

        IN_STOCK --> DISPATCHED_TO_SITE: DISPATCHED<br/>[CENTRAL_WAREHOUSE]

        RECEIVING --> QUALITY_APPROVED: QUALITY_APPROVED<br/>[LOGISTICS_COORDINATOR]
        RECEIVING --> QUALITY_REJECTED: QUALITY_REJECTED<br/>[LOGISTICS_COORDINATOR]

        QUALITY_APPROVED --> DISPATCHED_TO_SITE: DISPATCHED<br/>[LOGISTICS_COORDINATOR]
        DISPATCHED_TO_SITE --> DELIVERED: WAREHOUSE_RECORDS_UPDATED<br/>[SITE_WAREHOUSE]

        state "Ciclo de Reclamo" as CLAIM_CYCLE {
            QUALITY_REJECTED --> SUPPLIER_CLAIM_SENT: SUPPLIER_CLAIM_SENT<br/>[LOGISTICS_COORDINATOR]
            SUPPLIER_CLAIM_SENT --> SUPPLIER_CLAIM_PENDING: SUPPLIER_CLAIM_UPDATED<br/>[LOGISTICS_COORDINATOR]
            SUPPLIER_CLAIM_PENDING --> SUPPLIER_REPLACEMENT_RECEIVED: SUPPLIER_REPLACEMENT_RECEIVED<br/>[LOGISTICS_COORDINATOR]
            SUPPLIER_CLAIM_SENT --> SUPPLIER_REPLACEMENT_RECEIVED: SUPPLIER_REPLACEMENT_RECEIVED (directo)
            SUPPLIER_REPLACEMENT_RECEIVED --> QUALITY_APPROVED: QUALITY_APPROVED
            SUPPLIER_REPLACEMENT_RECEIVED --> QUALITY_REJECTED: QUALITY_REJECTED
        }
    }

    state "FASE 5 — Conformidad y Cierre" as F5 {
        DELIVERED --> USER_CONFORMITY: USER_CONFIRMED<br/>[REQUESTER]
        DELIVERED --> CLAIM_IN_REVIEW: USER_CLAIMED<br/>[REQUESTER]

        CLAIM_IN_REVIEW --> SUPPLIER_CLAIM_SENT: SUPPLIER_CLAIM_SENT<br/>[LOGISTICS_COORDINATOR]

        USER_CONFORMITY --> CLOSED: CLOSED<br/>[LOGISTICS_COORDINATOR]
    }

    state "Cancelación Universal" as CANCEL {
        note right of CANCELLED: Cualquier estado no-terminal<br/>puede pasar a CANCELLED (acción CANCELLED).<br/>La tabla no exige un rol concreto
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
    DRAFT --> SUBMITTED: SUBMITTED<br/>[REQUESTER]

    note right of SUBMITTED: FASE 2 — Validación Administrativa

    SUBMITTED --> SUPERVISOR_APPROVED: SUPERVISOR_APPROVED<br/>[DIRECT_SUPERVISOR]
    SUBMITTED --> SUPERVISOR_REJECTED: SUPERVISOR_REJECTED<br/>[DIRECT_SUPERVISOR]

    SUPERVISOR_APPROVED --> WITHIN_ANNUAL_PLAN: ADMIN_BUDGET_REVIEWED (within_plan=true)<br/>[ADMIN_MANAGER]
    SUPERVISOR_APPROVED --> OUT_OF_ANNUAL_PLAN: ADMIN_BUDGET_REVIEWED (within_plan=false)<br/>[ADMIN_MANAGER]
    SUPERVISOR_APPROVED --> SUPERVISOR_REJECTED: ADMIN_BUDGET_REJECTED<br/>[ADMIN_MANAGER]

    WITHIN_ANNUAL_PLAN --> VALIDATED: VALIDATED (sistema)

    OUT_OF_ANNUAL_PLAN --> GM_REVIEW: SUPERVISOR_APPROVED<br/>[DIRECT_SUPERVISOR]
    OUT_OF_ANNUAL_PLAN --> SUPERVISOR_REJECTED: SUPERVISOR_REJECTED<br/>[DIRECT_SUPERVISOR]

    GM_REVIEW --> GM_APPROVED: GM_APPROVED<br/>[GENERAL_MANAGER]
    GM_REVIEW --> GM_REJECTED: GM_REJECTED<br/>[GENERAL_MANAGER]
    GM_APPROVED --> VALIDATED: VALIDATED (sistema)

    note right of VALIDATED
        FASE 3 — roles de Logística distintos
        stock, solicitud de cotización y OC → LOGISTICS_SUPERVISOR
        comparación y selección → LOGISTICS_CHIEF
        costo de la cotización → ADMIN_MANAGER
    end note

    VALIDATED --> IN_STOCK: STOCK_CHECKED<br/>[LOGISTICS_SUPERVISOR]
    VALIDATED --> REQUIRES_PURCHASE: STOCK_CHECKED<br/>[LOGISTICS_SUPERVISOR]

    note right of IN_STOCK: FASE 4 — IN_STOCK pasa directo a DELIVERED

    IN_STOCK --> DELIVERED: DISPATCHED<br/>[CENTRAL_WAREHOUSE]
    DISPATCHED_TO_SITE --> DELIVERED: WAREHOUSE_RECORDS_UPDATED<br/>[CENTRAL_WAREHOUSE]
    DELIVERED --> WAREHOUSE_UPDATED: WAREHOUSE_RECORDS_UPDATED<br/>[CENTRAL_WAREHOUSE]

    note right of WAREHOUSE_UPDATED: FASE 5 — la conformidad parte de WAREHOUSE_UPDATED<br/>(no de DELIVERED)

    WAREHOUSE_UPDATED --> USER_CONFORMITY: USER_CONFIRMED<br/>[REQUESTER]
    WAREHOUSE_UPDATED --> CLAIM_IN_REVIEW: USER_CLAIMED<br/>[REQUESTER]
    USER_CONFORMITY --> CLOSED: CLOSED<br/>[LOGISTICS_SUPERVISOR]
```

En este flujo también cambia el reclamo al proveedor: `QUALITY_REJECTED → SUPPLIER_CLAIM_SENT → SUPPLIER_REPLACEMENT_RECEIVED` (sin el paso intermedio `SUPPLIER_CLAIM_PENDING`), ejecutado por el Supervisor Logístico.

### 5.3 Componentes Internos del WorkflowEngine

```mermaid
graph TB
    subgraph "WorkflowEngine(request, user, acting_role)"
        ENTRY["execute(action, comments, extra_data)<br/>@transaction.atomic"]

        subgraph "Paso 1: Validación"
            V0["_validate_acting_role()<br/>• El usuario debe tener asignado en BD<br/>  el acting_role declarado"]
            V1["select_for_update() sobre el Request<br/>• Relee el estado bajo bloqueo<br/>• Rechaza acciones sobre RQ terminales<br/>  (salvo CANCELLED)"]
            V2["_find_transition(action)<br/>• Busca en TRANSITIONS por flujo,<br/>  estado actual y acción"]
            V3["_check_role_permission()<br/>• El usuario debe tener el required_role en BD<br/>• CANCELLED y acciones de sistema<br/>  no exigen un rol concreto"]
        end

        subgraph "Paso 2: Ejecución"
            E1["Handler condicional (si existe)<br/>• handle_ops_budget_classification (classification)<br/>• handle_adm_budget_review (within_plan)<br/>• handle_stock_check (has_stock)<br/>• handle_cancellation"]
            E2["Actualiza request.status y current_step<br/>(_get_workflow_step)"]
        end

        subgraph "Paso 3: Efectos laterales"
            B1["_on_validated()<br/>• SLACalculator.calculate_estimated_delivery<br/>• BudgetValidator.commit_budget"]
            B2["_on_terminal_rejection()<br/>• BudgetValidator.release_budget<br/>• Rechazos y CANCELLED"]
            B3["_on_material_received() · _on_dispatched()<br/>• Lote de ingreso o egreso en almacén CENTRAL<br/>• WarehouseReceipt / WarehouseDispatch<br/>• Best-effort: un fallo no revierte el flujo"]
        end

        subgraph "Paso 4: Registro"
            R1["Approval (inmutable)<br/>• previous_status, new_status<br/>• performed_by, role, comments"]
            R2["_log_activity()<br/>• ActivityLog"]
            R3["_send_notifications()<br/>• NotificationService.notify_on_transition"]
        end

        subgraph "Paso 5: Cadena de sistema"
            A1["_execute_system_chain()<br/>• WITHIN_PROPOSAL → VALIDATED<br/>• WITHIN_ANNUAL_PLAN → VALIDATED<br/>• GM_APPROVED → VALIDATED<br/>• Approval con rol SYSTEM"]
        end

        AV["get_available_actions()<br/>• Acciones que el usuario puede ejecutar<br/>  sobre el RQ en su estado actual"]
    end

    ENTRY --> V0 --> V1 --> V2 --> V3 --> E1 --> E2 --> B1
    E2 --> B2
    E2 --> B3
    B1 --> R1
    B2 --> R1
    B3 --> R1
    R1 --> R2 --> R3 --> A1
```

### 5.4 Captura de Ítems y Vínculo con el Catálogo del Almacén (SYSPCC-026)

```mermaid
sequenceDiagram
    actor REQ as Solicitante
    actor LG as Logística
    participant API as API de RQ
    participant CAT as request_catalog
    participant IT as request_items
    participant SA as stock_availability
    participant WF as WorkflowEngine
    participant WH as Almacén

    REQ->>API: GET /request-catalog/?search=
    API->>CAT: search_catalog()
    CAT-->>REQ: Código, descripción, unidad, categoría y disponible (pool CENTRAL)
    REQ->>API: POST /requests/ con ítems (producto propuesto o fuera de catálogo)

    LG->>API: GET /requests/{id}/stock-availability/
    API->>SA: build_stock_availability()
    SA-->>LG: Por ítem: solicitado, disponible neto y cobertura
    LG->>API: PATCH /requests/{id}/update-items/
    API->>IT: update_request_items() bajo bloqueo
    IT-->>LG: Vínculo confirmado (inventory_item_confirmed_at/by) o 409 con code
    LG->>API: POST /requests/{id}/action/ STOCK_CHECKED

    Note over WF,WH: Más adelante, en RECEIVED y DISPATCHED
    WF->>WF: _resolve_inventory_item(item)
    WF->>WH: register_entry_batch / register_exit_batch
```

Reglas relevantes:

- **Búsqueda del catálogo** (`GET /request-catalog/`): abierta a todo usuario autenticado, mínimo 2 caracteres, 20 filas por página; no expone costos, ubicación exacta ni proveedores.
- **Propuesta vs. confirmación**: lo que elige el solicitante es una propuesta. Solo `update-items` (roles de logística) sella `inventory_item_confirmed_at` y `inventory_item_confirmed_by`.
- **Ventana editable de `update-items`**: desde VALIDATED hasta antes del despacho (`EDITABLE_STATUSES`). Responde 409 con `code` (`REQUEST_TERMINAL`, `REQUEST_STATE_NOT_EDITABLE`, `ITEMS_ALREADY_DISPATCHED`, `ITEMS_ALREADY_RECEIVED`, `INTEGRITY_ERROR`) y no escribe nada. Este guard vive solo en ese endpoint: nunca bloquea una transición del flujo.
- **Disponibilidad**: informativa, solo para logística. Resta lo comprometido con otros RQ (los que están en IN_STOCK y las compras ya recibidas pendientes de despacho) y lo que toman las líneas previas del mismo RQ. Si la unidad del ítem y la del producto difieren, la cobertura es `NOT_COMPARABLE`.
- **Resolución del producto en el motor** (`_resolve_inventory_item`): un ítem marcado fuera de catálogo nunca mueve stock; si hay vínculo directo se usa; si no, el motor conserva un respaldo por coincidencia de texto y deja una advertencia en el log.
- **Comandos de apoyo** (solo lectura): `check_central_project_stock`, `report_rq_stock_gaps` y `suggest_inventory_links`.

---

## 6. Arquitectura de Autenticación y Autorización

### 6.1 Flujo de Autenticación JWT Cookie-Based

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as React App
    participant AX as Axios
    participant DJ as Django
    participant JWT as SimpleJWT
    participant DB as Base de datos

    Note over B,DB: === PASO 0: COOKIE CSRF ===
    R->>AX: authApi.bootstrapCsrf() al montar la app
    AX->>DJ: GET /api/v1/auth/csrf/
    DJ-->>AX: Set-Cookie: csrftoken (legible por JS)

    Note over B,DB: === PASO 1: LOGIN ===
    B->>R: Ingresa usuario + contraseña
    R->>AX: authApi.login(username, password)
    AX->>DJ: POST /api/v1/auth/login/ + X-CSRFToken
    DJ->>DJ: Throttle por IP (5/min) y por usuario (10/min)
    DJ->>JWT: CustomTokenObtainPairView
    JWT->>DB: SELECT * FROM users WHERE username=?
    DB-->>JWT: User record
    JWT->>JWT: Verificar la contraseña (hasher por defecto de Django)
    JWT->>JWT: Generar access_token (HS256, 15 min)
    JWT->>JWT: Generar refresh_token (HS256, 1 día)
    JWT-->>DJ: TokenPair

    DJ-->>AX: 200 OK + Set-Cookie headers (cuerpo: solo el perfil)
    Note over DJ,AX: Set-Cookie: access_token=eyJ...<br/>  HttpOnly, SameSite=Lax, Path=/, Max-Age=900<br/>Set-Cookie: refresh_token=eyJ...<br/>  HttpOnly, SameSite=Lax, Path=/, Max-Age=86400<br/>Secure cuando DEBUG es falso

    Note over B,DB: === PASO 2: CARGAR USUARIO ===
    R->>AX: authApi.getMe()
    AX->>DJ: GET /api/v1/users/me/
    Note over AX: Cookie access_token<br/>enviada automáticamente
    DJ->>DJ: CookieJWTAuthentication lee la cookie
    DJ->>JWT: Decodificar token
    JWT-->>DJ: payload {user_id, exp, ...}
    DJ->>DB: SELECT user + roles
    DB-->>DJ: User + UserRoles
    DJ-->>AX: {id, username, email, roles, is_superuser, must_change_password, ...}
    AX-->>R: User data

    R->>R: AuthContext.setCurrentUser(user)
    alt must_change_password
        R->>R: Redirect → /cambiar-password
    else
        R->>R: Redirect → SystemSelectPage
    end

    Note over B,DB: === PASO 3: REQUESTS AUTENTICADOS ===
    R->>AX: requestsApi.getRequests()
    AX->>DJ: GET /api/v1/requests/
    DJ->>DJ: CookieJWTAuthentication + IsAuthenticated
    DJ->>DB: Query con alcance según el rol
    DJ-->>AX: 200 JSON data
    AX-->>R: Datos

    Note over B,DB: === PASO 4: TOKEN EXPIRA ===
    R->>AX: Cualquier API call
    AX->>DJ: GET /api/v1/...
    DJ-->>AX: 401 Unauthorized
    AX->>DJ: POST /api/v1/auth/token/refresh/ (cuerpo vacío)
    Note over AX,DJ: Vista estándar de SimpleJWT:<br/>ver la brecha conocida en 4.2

    Note over B,DB: === PASO 5: LOGOUT ===
    R->>AX: authApi.logout()
    AX->>DJ: POST /api/v1/auth/logout/
    DJ->>DJ: Lee refresh_token de la cookie
    DJ->>DB: Lista negra del refresh token
    DJ-->>AX: Set-Cookie: borra access_token y refresh_token
    AX-->>R: Logout OK
    R->>R: AuthContext.setCurrentUser(null)
    R->>R: Redirect → LoginPage
```

### 6.2 RBAC — Control de Acceso Basado en Roles

```mermaid
graph TB
    subgraph "Permission Classes (apps/core/permissions.py)"
        IA["IsAuthenticated<br/>(DRF built-in)<br/>Token JWT válido"]
        HR["HasRole<br/>Roles en view.role_required<br/>(definida, sin uso en vistas hoy)"]
        IGM["IsGeneralManager<br/>Solo GENERAL_MANAGER<br/>(definida, sin uso en vistas hoy)"]
        ILS["IsLogisticsStaff<br/>LOGISTICS_COORDINATOR<br/>LOGISTICS_SUPERVISOR<br/>LOGISTICS_CHIEF"]
        IWS["IsWarehouseStaff<br/>CENTRAL_WAREHOUSE · SITE_WAREHOUSE<br/>(definida, sin uso en vistas hoy)"]
        IHR["IsHRManager<br/>ADMIN_MANAGER · PASAJES_MANAGER<br/>GENERAL_MANAGER · staff<br/>(leer Personal completo)"]
        IPS["IsPasajesStaff<br/>PASAJES_MANAGER · ADMIN_MANAGER · staff<br/>(búsqueda por DNI)"]
        IHD["IsHRDocumentsManager<br/>HR_MANAGER (sin bypass de staff)<br/>IsHRDocumentsReader: + GENERAL_MANAGER"]
        ISU["IsSuperUser<br/>is_superuser<br/>(usuarios, roles y proyectos)"]
        IAR["IsAdminOrReadOnly<br/>Auth: lectura<br/>Staff: escritura"]
    end

    subgraph "Permisos propios por app"
        RQP["rq/permissions.py<br/>get_accessible_requests_queryset<br/>CanPerformWorkflowAction"]
        WHP["warehouse/permissions.py<br/>IsWarehouseRole, CanImportInventory,<br/>CanAssignLocations, CanLinkPersonal,<br/>CanDeliverEPP, CanLookupPersonal"]
        ADP["administracion/views.py<br/>IsAdminOrAdminManager<br/>ADMIN_MANAGER · GENERAL_MANAGER<br/>PASAJES_MANAGER · staff"]
    end

    subgraph "Aplicación en ViewSets"
        RV["RequestViewSet<br/>IsAuthenticated + alcance del queryset<br/>update-items y stock-availability: IsLogisticsStaff<br/>action: CanPerformWorkflowAction"]
        SV["QuotationViewSet · PurchaseOrderViewSet<br/>lectura: IsAuthenticated con alcance<br/>escritura: IsLogisticsStaff"]
        UV["UserViewSet · ProjectViewSet<br/>lectura: IsAuthenticated<br/>escritura: IsSuperUser"]
        WV["Warehouse ViewSets<br/>IsWarehouseRole y permisos por acción"]
        AV["Administración ViewSets<br/>IsAdminOrAdminManager"]
        HV["HR ViewSets<br/>IsHRDocumentsReader (lectura)<br/>IsHRDocumentsManager (escritura)"]
        PV["PersonalViewSet<br/>lectura completa: IsHRManager<br/>búsqueda por DNI: IsPasajesStaff<br/>escritura: staff"]
        SUP["SupplierViewSet · DepartmentViewSet<br/>lectura: IsAuthenticated<br/>escritura: IsAdminOrReadOnly (staff)"]
    end

    subgraph "Verificación en WorkflowEngine"
        WFP["TRANSITIONS[..].required_role<br/>→ el usuario debe tener ese rol (BD)<br/>→ además debe tener el acting_role declarado<br/>→ si no: PermissionDeniedForAction (403)"]
    end

    subgraph "Frontend"
        FRR["RoleRoute · SuperUserRoute<br/>requiredRoles={['PROJECT_RESIDENT']}<br/>→ useAuth().userRoles<br/>→ si no tiene rol: redirect<br/>(solo UX; el backend valida)"]
    end

    IA --> RV
    ILS --> RV
    ILS --> SV
    ISU --> UV
    RQP --> RV
    WHP --> WV
    ADP --> AV
    IHD --> HV
    IHR --> PV
    IPS --> PV
    IAR --> SUP
    RV --> WFP
```

### 6.3 Roles Requeridos por Endpoint

| Endpoint | Roles requeridos |
|----------|------------------|
| `POST /requests/` | Cualquier usuario autenticado (la UI está pensada para el Solicitante) |
| `GET /requests/` y detalle | Alcance por rol: roles amplios (`GENERAL_MANAGER`, logística, `CENTRAL_WAREHOUSE`) ven todo; Residente, Control y Almacén de Obra ven su proyecto; Jefe Directo y Gerente Administrativo ven su departamento; el resto, solo lo propio |
| `POST /requests/{id}/action/` | El rol `required_role` de la transición y que el usuario posea el `acting_role` enviado |
| `PATCH /requests/{id}/update-items/`, `GET /requests/{id}/stock-availability/` | `LOGISTICS_COORDINATOR`, `LOGISTICS_SUPERVISOR` o `LOGISTICS_CHIEF` |
| `GET /request-catalog/` | Cualquier usuario autenticado |
| `POST /quotations/`, `POST /quotations/{id}/select/`, `POST /purchase-orders/` | Roles de logística |
| `POST /suppliers/` (escrituras) | Usuario staff (`IsAdminOrReadOnly`); lectura para cualquier usuario autenticado |
| `/warehouse/*` | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE` o roles de logística; asignar ubicaciones, importar y vincular destinos: `CENTRAL_WAREHOUSE` y `LOGISTICS_CHIEF`; entrega de EPP: `CENTRAL_WAREHOUSE` y `SITE_WAREHOUSE`; sin bypass por superusuario |
| `/administracion/*` | `ADMIN_MANAGER`, `GENERAL_MANAGER`, `PASAJES_MANAGER` o staff (el tipo de cambio, `/administracion/tipo-cambio/`, solo pide estar autenticado) |
| `/hr/*` | `HR_MANAGER` (escritura); `HR_MANAGER` y `GENERAL_MANAGER` (lectura); sin bypass de staff |
| `POST/PUT/PATCH /users/`, `/user-roles/`, `/projects/` | `is_superuser` |
| `/support/tickets/` | Cualquier usuario autenticado; cada uno ve sus tickets y el staff ve todos |

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
        Q["Colas de tareas<br/>Formato JSON<br/>celery (por defecto) y hr_cv"]
    end

    subgraph "Celery Worker (cola por defecto)"
        W["Worker Process"]

        subgraph "Tareas Registradas"
            T_SLA["rq.check_sla_deadlines<br/>• RQ activos vencidos o por vencer (3 días)<br/>• Notificación en la app al solicitante<br/>• dedup_key diaria"]
            T_REM["rq.send_pending_approval_reminders<br/>• RQ en revisión humana por más de 24 h<br/>• Notificación en la app al aprobador<br/>• dedup_key"]
            T_CACHE["rq.invalidate_dashboard_caches<br/>• Borra las claves dashboard_stats:*"]
            T_STOCK["warehouse.check_low_stock<br/>• Productos con stock total ≤ stock mínimo<br/>• Correo a WAREHOUSE_ALERT_RECIPIENTS"]
            T_IMP["warehouse.purge_stale_imports<br/>• Vence previsualizaciones<br/>• Borra los libros guardados"]
            T_PDF["warehouse.upload_group_pdf<br/>• Genera el PDF del vale y lo sube a OneDrive<br/>• Reintentos con backoff"]
        end
    end

    subgraph "Celery Worker RR. HH. (cola hr_cv)"
        WHR["Worker Process"]
        T_CV["hr.process_cv_item<br/>• Un CV = una tarea (idempotente)<br/>• Lee el CV con el agente y genera el reporte"]
        T_REQ["hr.cv_requeue_stale<br/>• Reencola CVs atascados"]
    end

    subgraph "Redis (DB2 — Results)"
        RES["Resultados de tareas<br/>task_id → result"]
    end

    subgraph "Celery Beat"
        SCHED["DatabaseScheduler<br/>(django_celery_beat)"]

        subgraph "Schedule (America/Lima)"
            S1["check-sla-deadlines<br/>crontab(hour=8, minute=0)"]
            S2["send-pending-approval-reminders<br/>crontab(hour='9,14', minute=0)"]
            S3["invalidate-dashboard-caches<br/>crontab(minute='*/15')"]
            S4["warehouse-low-stock-check<br/>crontab(hour=7, minute=30)"]
            S5["warehouse-purge-stale-imports<br/>crontab(hour=3, minute=0)"]
            S6["hr-cv-requeue-stale<br/>crontab(minute='*/5')"]
        end
    end

    subgraph "External"
        DB["Base de datos<br/>(ORM queries)"]
        EMAIL["Servidor SMTP<br/>(alertas de stock bajo)"]
        OD["OneDrive (Graph API)"]
        AI["API de Anthropic"]
    end

    T1 -->|".delay()"| Q
    T2 --> SCHED
    SCHED --> S1 & S2 & S3 & S4 & S5 & S6
    S1 & S2 & S3 & S4 & S5 -->|schedule| Q
    S6 -->|schedule| Q
    Q --> W
    Q --> WHR
    W --> T_SLA & T_REM & T_CACHE & T_STOCK & T_IMP & T_PDF
    WHR --> T_CV & T_REQ
    T_SLA --> DB
    T_REM --> DB
    T_STOCK --> DB
    T_STOCK --> EMAIL
    T_IMP --> DB
    T_PDF --> OD
    T_CV --> DB
    T_CV --> AI
    W --> RES
```

Las notificaciones de las transiciones del RQ, de SLA y de recordatorios son notificaciones dentro de la aplicación (modelo `Notification`); el único correo que envía el sistema es la alerta de stock bajo. En el entorno `demo` no hay worker ni Beat: Celery corre en modo eager y las tareas programadas no se ejecutan.

### 7.2 Configuración de Celery

```mermaid
graph LR
    subgraph "config/celery.py"
        CELAPP["app = Celery('syspcclog')<br/>app.config_from_object(<br/>  'django.conf:settings',<br/>  namespace='CELERY'<br/>)<br/>app.autodiscover_tasks()"]
    end

    subgraph "config/settings/base.py"
        CELCFG["CELERY_BROKER_URL = redis://.../1<br/>CELERY_RESULT_BACKEND = redis://.../2<br/>CELERY_TIMEZONE = 'America/Lima'<br/>CELERY_TASK_SERIALIZER = 'json'<br/>CELERY_TASK_TIME_LIMIT = 300<br/>CELERY_TASK_ROUTES: hr.* → cola hr_cv<br/>CELERY_BEAT_SCHEDULE (6 entradas)"]
    end

    subgraph "Tareas (@shared_task)"
        TASKS["apps/rq/tasks.py<br/>apps/warehouse/tasks.py<br/>apps/hr/tasks.py"]
    end

    CELAPP --> CELCFG
    CELAPP --> TASKS
```

Procesos en Docker Compose local: `celery_worker` (`celery -A config worker`), `celery_worker_hr` (`celery -A config worker -Q hr_cv -c 3`) y `celery_beat` (`--scheduler django_celery_beat.schedulers:DatabaseScheduler`).

---

## 8. Arquitectura de Caché y Sesiones

### 8.1 Distribución de Redis

```mermaid
graph TB
    subgraph "Redis Server (:6379)"
        subgraph "DB 0 — Caché (alias default)"
            C1["django-redis<br/>TTL por defecto: 300 s<br/>Key prefix: 'syspcclog'<br/>Max connections: 50"]
            C2["Usos verificados:<br/>• Contadores de rate limiting (DRF)<br/>• Sesiones de Django (panel /mgmt-panel/)<br/>• Tipo de cambio SUNAT (4 h)<br/>• Cuotas diarias del asistente de RR. HH."]
        end

        subgraph "DB 1 — Celery Broker"
            B1["Cola de mensajes<br/>• Tareas pendientes<br/>• Formato JSON"]
        end

        subgraph "DB 2 — Celery Results"
            R1["Resultados de tareas<br/>• task_id → result<br/>• Estado de ejecución"]
        end

        subgraph "Sesiones"
            SS["SESSION_ENGINE = cache<br/>Redis-backed<br/>SESSION_COOKIE_AGE = 3600 (producción)<br/>La API usa JWT en cookies, no sesiones"]
        end
    end
```

### 8.2 Uso de la caché en el código

La API no cachea listados ni consultas generales. Lo que existe es:

- **Rate limiting**: los contadores de DRF viven en la caché indicada por `THROTTLE_CACHE_ALIAS`. Si se activa `DJANGO_REDIS_IGNORE_EXCEPTIONS`, producción los mueve a una caché local de proceso para que los límites no desaparezcan con una caída de Redis.
- **Tipo de cambio**: `GET /administracion/tipo-cambio/` guarda la respuesta del servicio externo por 4 horas.
- **Ayudantes de `apps/rq/cache.py`**: funciones para cachear los pasos del workflow y la configuración de tipos de adquisición (TTL de 1 hora) y para invalidar las claves `dashboard_stats:*`. Hoy solo se usa `safe_delete_pattern`, desde la tarea `rq.invalidate_dashboard_caches`; no hay llamadores de lectura/escritura de esas claves en vistas o servicios.
- **Entorno demo**: la caché es `LocMemCache` (por proceso), sin Redis.

---

## 9. Modelo de Datos — Relaciones Detalladas

### 9.1 Diagrama ER Completo

```mermaid
erDiagram
    User ||--o{ UserRole : "has"
    User |o--o| Personal : "linked_to"
    User ||--o{ Request : "requested_by"
    User ||--o{ Approval : "performed_by"
    User ||--o{ PurchaseOrder : "generated_by"
    User ||--o{ InventoryMovement : "registered_by"
    User ||--o{ Ticket : "created_by"
    User |o--o{ Pasaje : "creado_por"
    User ||--o{ InventoryImport : "uploaded_by"

    UserRole }o--o| Project : "scoped_to"
    UserRole }o--o| Department : "scoped_to"

    Project ||--o{ ProjectBudgetLine : "has"
    Project |o--o{ Request : "belongs_to"
    Project |o--o{ InventoryStock : "scoped_to"
    Project |o--o{ MovementGroup : "belongs_to"
    Project |o--o{ Personal : "assigned_to"
    Project |o--o{ Inventory : "owner"

    Department ||--o{ AnnualPlan : "has"
    Department |o--o{ Request : "belongs_to"
    Department }o--o| User : "managed_by"

    AnnualPlan ||--o{ AnnualPlanLine : "has"

    Request ||--o{ RequestItem : "contains"
    Request ||--o{ Approval : "has"
    Request ||--o{ Quotation : "has"
    Request ||--o{ PurchaseOrder : "has"
    Request ||--o{ Claim : "has"
    Request ||--o{ Notification : "has"
    Request ||--o{ ActivityLog : "has"
    Request ||--o{ Attachment : "has"
    Request ||--o{ WarehouseReceipt : "received_in"
    Request ||--o{ WarehouseDispatch : "dispatched_from"
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

    WarehouseReceipt ||--o{ WarehouseReceiptItem : "contains"
    WarehouseReceipt }o--o| PurchaseOrder : "for"
    WarehouseReceipt |o--o| MovementGroup : "entry"
    WarehouseDispatch ||--o{ WarehouseDispatchItem : "contains"
    WarehouseDispatch |o--o| MovementGroup : "exit"

    Inventory ||--o{ InventoryStock : "stocked_at"
    Inventory ||--o{ InventoryMovement : "tracked_by"

    InventoryMovement }o--o| MovementGroup : "grouped_in"
    InventoryMovement }o--o| InventoryImport : "imported_by"
    InventoryMovement }o--o| Personal : "destination_personal"

    Pasaje }o--o| Personal : "for"
    Pasaje }o--o| ProveedorPasajes : "from"
    Pasaje }o--o| Project : "charged_to"

    Ticket ||--o{ TicketComment : "has"

    DocumentTemplate ||--o{ GeneratedDocument : "used_by"
    GeneratedDocument }o--o| Personal : "for"
    GeneratedDocument ||--o{ DocumentEvent : "has"
    CVAnalysis ||--o{ CVAnalysisItem : "contains"

    User {
        int id PK
        string username UK
        string email UK
        string first_name
        string last_name
        string position
        string phone
        image signature
        bool must_change_password
    }

    UserRole {
        int id PK
        int user_id FK
        string role
        int project_id FK
        int department_obj_id FK
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
        string frente
        int manager_id FK
    }

    Request {
        int id PK
        string rq_number UK
        string flow
        int project_id FK
        int department_id FK
        int requested_by_id FK
        string requesting_area
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
        string supply_source
        string item_source
        int inventory_item_id FK
        bool is_off_catalog
        datetime inventory_item_confirmed_at
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
        string location
        int floor
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
        string voucher_number
        date movement_date
    }

    MovementGroup {
        int id PK
        string group_number UK
        string movement_type
        string warehouse
        string voucher_number
    }

    InventoryImport {
        uuid id PK
        string status
        string file_sha256
        int uploaded_by_id FK
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

    DocumentTemplate {
        int id PK
        string document_type
        string slug
        int version
        bool is_active
    }

    GeneratedDocument {
        int id PK
        int template_id FK
        int personal_id FK
        string status
        string reference_number UK
    }

    CVAnalysis {
        int id PK
        string name
        int created_by_id FK
    }

    CVAnalysisItem {
        int id PK
        int analysis_id FK
        string status
        string sha256
        int score
        string recommendation
    }
```

---

## 10. Rate Limiting y Throttling

```mermaid
graph TB
    subgraph "Configuración de Throttle"
        subgraph "Desarrollo (development.py)"
            DEV_ANON["Anónimo: 300/min"]
            DEV_AUTH["Autenticado: 1000/min"]
            DEV_LOGIN["Login: 30/min por IP<br/>y 30/min por usuario"]
        end

        subgraph "Producción (base.py)"
            PROD_ANON["Anónimo: 30/min"]
            PROD_AUTH["Autenticado: 200/min"]
            PROD_LOGIN["Login: 5/min por IP<br/>y 10/min por usuario"]
            PROD_MOD["Módulos: hr_assistant 20/min<br/>hr_download 60/min<br/>hr_cv_upload 60/min · hr_cv_progress 90/min<br/>hr_cv_posting 20/min<br/>warehouse_lookup 120/min · warehouse_import 10/hora"]
        end
    end

    subgraph "Flujo de Verificación"
        REQ2["Request entrante"]
        CHECK["DRF Throttle Check<br/>AnonThrottle · UserThrottle<br/>+ throttles propios del módulo"]
        CACHE2["Caché (THROTTLE_CACHE_ALIAS)<br/>Almacena el conteo por IP/usuario"]
        PASS["✅ Pasa<br/>Continúa a View"]
        BLOCK["❌ 429 Too Many Requests<br/>Retry-After header"]
    end

    REQ2 --> CHECK
    CHECK --> CACHE2
    CACHE2 -->|Bajo límite| PASS
    CACHE2 -->|Sobre límite| BLOCK
```

El catálogo de búsqueda de RQ (`/request-catalog/`) tiene su propio throttle (`RequestCatalogThrottle`) además del de usuario.

---

*Documento de arquitectura de bajo nivel de SYSPCC — PCC Ingeniería y Construcción*
*Última actualización: Octubre 2026 (código al día con SYSPCC-026)*
