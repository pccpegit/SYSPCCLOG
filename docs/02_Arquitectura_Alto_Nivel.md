# SYSPCC — Arquitectura de Alto Nivel

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.1 | **Fecha:** Octubre 2026 | **Empresa:** PCC Ingeniería y Construcción

---

## 1. Vista General del Sistema

```mermaid
C4Context
    title SYSPCC — Diagrama de Contexto

    Person(requester, "Solicitante", "Crea requerimientos de abastecimiento y confirma la recepción")
    Person(approver, "Aprobador", "Residente, Control de Proyecto, Gerente General, Jefe Directo, Gerente Administrativo")
    Person(logistics, "Logística", "Coordinador, Supervisor, Jefe Logístico")
    Person(warehouse, "Almacén", "Personal de almacén central y de obra")
    Person(admin, "Administración", "Gestiona pasajes, pagos y políticas de devolución")
    Person(hr, "Recursos Humanos", "Contratos, plantillas y análisis de CVs")
    Person(sysadmin, "Superadministrador", "Usuarios, roles y proyectos")

    System(syspcc, "SYSPCC", "Sistema de Gestión de Requerimientos de Abastecimiento")

    System_Ext(email, "Servidor SMTP", "Alertas por correo (configurable por variables EMAIL_*)")
    System_Ext(onedrive, "Microsoft OneDrive", "Almacenamiento de los vales PDF del almacén")
    System_Ext(anthropic, "API de Anthropic", "Asistente de contratos y análisis de CVs de RR. HH.")
    System_Ext(sunat, "Servicios de consulta", "RUC de proveedores y tipo de cambio SUNAT")
    System_Ext(postgres, "PostgreSQL", "Base de datos relacional (producción)")

    Rel(requester, syspcc, "Crea RQ y confirma la conformidad")
    Rel(approver, syspcc, "Aprueba o rechaza RQ")
    Rel(logistics, syspcc, "Gestiona cotizaciones, compras y recepción")
    Rel(warehouse, syspcc, "Registra ingresos, egresos y entregas con vale")
    Rel(admin, syspcc, "Registra pasajes y políticas")
    Rel(hr, syspcc, "Emite contratos y analiza CVs")
    Rel(sysadmin, syspcc, "Administra usuarios, roles y proyectos")

    Rel(syspcc, email, "Envía alertas de stock bajo")
    Rel(syspcc, onedrive, "Sube PDFs vía Graph API")
    Rel(syspcc, anthropic, "Extracción estructurada y lectura de CVs")
    Rel(syspcc, sunat, "Consulta RUC y tipo de cambio")
    Rel(syspcc, postgres, "Lee/escribe datos")
```

---

## 2. Arquitectura de Capas

```mermaid
graph TB
    subgraph "CAPA DE PRESENTACIÓN"
        direction LR
        BROWSER["🌐 Navegador Web<br/>(Chrome, Edge, Firefox)"]
    end

    subgraph "CAPA DE FRONTEND"
        direction LR
        SPA["⚛️ React 19 SPA<br/>Vite 7.3 + Tailwind CSS 4<br/>Tema claro/oscuro"]

        subgraph "Módulos Frontend"
            direction LR
            RQ_FE["📋 RQ System<br/>/rq/*<br/>AppShell"]
            WH_FE["📦 Almacén<br/>/almacen/*<br/>WarehouseShell"]
            AD_FE["✈️ Admin<br/>/admin/*<br/>AdminShell"]
            HR_FE["👥 RR. HH.<br/>/rrhh/*<br/>HRShell"]
            SY_FE["🛡️ Sistema<br/>/sistema/*<br/>SystemAdminShell"]
            SP_FE["🎫 Soporte<br/>/soporte/*<br/>SupportShell"]
        end
    end

    subgraph "CAPA DE ENTRADA"
        PROXY["🔒 Proxy inverso o plataforma<br/>TLS y enrutado /api/*<br/>(en desarrollo: proxy de Vite)"]
    end

    subgraph "CAPA DE APLICACIÓN"
        direction LR
        GUNICORN["🦄 Gunicorn<br/>WSGI Server"]
        DJANGO["🐍 Django 5.1<br/>+ DRF 3.15"]

        subgraph "Django Apps"
            direction LR
            CORE["🔐 core<br/>Auth, Usuarios<br/>Proyectos, Deptos, Personal"]
            RQ_BE["📋 rq<br/>Requests, Aprobaciones<br/>Proveedores, Cotizaciones"]
            WH_BE["📦 warehouse<br/>Inventario, Movimientos<br/>EPP, Importación"]
            ADMIN_BE["✈️ administracion<br/>Pasajes<br/>Políticas"]
            SUPPORT_BE["🎫 support<br/>Tickets<br/>Comentarios"]
            HR_BE["👥 hr<br/>Contratos, Plantillas<br/>Análisis de CVs"]
        end

        subgraph "Servicios de Negocio"
            WF["⚙️ WorkflowEngine<br/>Máquina de estados<br/>47 estados definidos, 71 transiciones"]
            BV["💰 BudgetValidator<br/>Presupuesto y plan anual"]
            SLA["📅 SLACalculator<br/>Fecha estimada de entrega"]
            NOTIF["🔔 NotificationService<br/>Notificaciones en la app"]
            RQS["🔗 Servicios de captura<br/>Catálogo, vínculo de ítems,<br/>disponibilidad de stock"]
        end
    end

    subgraph "CAPA DE TAREAS ASÍNCRONAS"
        direction LR
        WORKER["👷 Celery Worker<br/>Tareas asíncronas<br/>(cola por defecto y hr_cv)"]
        BEAT["⏰ Celery Beat<br/>Tareas programadas"]
    end

    subgraph "CAPA DE DATOS"
        direction LR
        PG["🐘 PostgreSQL 16 (producción)<br/>SQLite (desarrollo)"]
        REDIS["🔴 Redis 7<br/>DB0: Caché y contadores<br/>DB1: Broker<br/>DB2: Resultados"]
        FILES["📁 Archivos<br/>media/ (firmas, adjuntos)<br/>private_media/ (RR. HH.)"]
    end

    subgraph "SERVICIOS EXTERNOS"
        direction LR
        SMTP["📧 Servidor SMTP"]
        ONEDRIVE["☁️ OneDrive<br/>Graph API"]
        ANTHROPIC["🤖 API de Anthropic"]
        SUNAT["🏛️ Consultas RUC<br/>y tipo de cambio"]
    end

    BROWSER -->|HTTPS| PROXY
    PROXY -->|/api/* /mgmt-panel/*| GUNICORN
    PROXY -->|/* SPA| SPA
    GUNICORN --> DJANGO
    DJANGO --> CORE
    DJANGO --> RQ_BE
    DJANGO --> WH_BE
    DJANGO --> ADMIN_BE
    DJANGO --> SUPPORT_BE
    DJANGO --> HR_BE
    RQ_BE --> WF
    RQ_BE --> BV
    RQ_BE --> SLA
    RQ_BE --> NOTIF
    RQ_BE --> RQS
    DJANGO -->|ORM| PG
    DJANGO -->|Contadores, sesiones de admin| REDIS
    DJANGO --> FILES
    WORKER -->|Consume tareas| REDIS
    BEAT -->|Programa tareas| REDIS
    WORKER -->|ORM| PG
    WORKER --> SMTP
    WORKER -->|Subida de vales PDF| ONEDRIVE
    HR_BE -->|API| ANTHROPIC
    ADMIN_BE -->|HTTP| SUNAT
    SPA -->|REST API JSON| PROXY

    RQ_FE -.-> SPA
    WH_FE -.-> SPA
    AD_FE -.-> SPA
    HR_FE -.-> SPA
    SY_FE -.-> SPA
    SP_FE -.-> SPA
```

---

## 3. Módulos del Sistema

```mermaid
graph TB
    subgraph "SYSPCC Platform"
        subgraph "Módulo RQ — Requerimientos de Abastecimiento"
            RQ1["Crear y enviar requerimientos<br/>(ítems del catálogo o fuera de catálogo)"]
            RQ2["Cadena de aprobaciones (11 roles del flujo)"]
            RQ3["Cotizaciones y comparación"]
            RQ4["Aprobación de costo y sobrecosto"]
            RQ5["Recepción y control de calidad"]
            RQ6["Ciclo de reclamo al proveedor"]
            RQ7["Conformidad y cierre"]
            RQ8["Vínculo ítem–catálogo y disponibilidad de stock"]
            RQ9["Notificaciones y adjuntos"]
        end

        subgraph "Módulo Almacén — Inventario y Logística"
            WH1["Catálogo de productos (incluye EPP)"]
            WH2["Stock por almacén (Central/Obra/Oficina)"]
            WH3["Ingresos, egresos y entregas de EPP con vale"]
            WH4["Ubicaciones Pabellón-Sección-Nivel"]
            WH5["Kardex y resumen de movimiento"]
            WH6["Importación del Excel de inventario"]
            WH7["Recepciones y despachos de RQ"]
            WH8["Alertas de stock bajo"]
        end

        subgraph "Módulo Admin — Pasajes"
            AD1["Registro de pasajes"]
            AD2["Cálculo de devoluciones"]
            AD3["Políticas por tipo de trabajador"]
            AD4["Control de pagos"]
        end

        subgraph "Módulo RR. HH."
            HR1["Plantillas Word aprobadas"]
            HR2["Contratos: borrador, emisión, anulación"]
            HR3["Asistente de extracción de datos"]
            HR4["Análisis masivo de CVs"]
        end

        subgraph "Módulo Soporte — TI"
            SP1["Tickets de soporte"]
            SP2["Comentarios y cambios de estado"]
            SP3["Resumen de tickets propios"]
        end

        subgraph "Administración del Sistema"
            SY1["Usuarios y roles (alta, baja lógica, reinicio de contraseña)"]
            SY2["Proyectos (alta, baja lógica)"]
        end

        subgraph "Core — Transversal"
            C1["Autenticación JWT en cookies + CSRF"]
            C2["RBAC (13 roles + superusuario)"]
            C3["Proyectos y departamentos"]
            C4["Personal (RRHH)"]
            C5["Presupuestos por partida y planes anuales"]
            C6["Tema claro/oscuro y firma del usuario"]
        end
    end
```

---

## 4. Flujo de Comunicación

```mermaid
sequenceDiagram
    participant B as 🌐 Navegador
    participant P as 🔒 Proxy / plataforma
    participant G as 🦄 Gunicorn
    participant D as 🐍 Django + DRF
    participant R as 🔴 Redis
    participant DB as 🐘 Base de datos
    participant C as 👷 Celery
    participant E as 📧 Servicios externos

    Note over B,E: Flujo de una petición típica

    B->>P: HTTPS Request
    alt SPA (/)
        P-->>B: index.html y assets del build de Vite
    else API (/api/*)
        P->>G: proxy al backend
        G->>D: WSGI Request
        D->>D: CookieJWTAuthentication lee la cookie access_token
        D->>D: Permisos del ViewSet y alcance del queryset por rol
        D->>R: Contadores de rate limiting
        D->>DB: Consulta o escritura (ORM)
        DB-->>D: Datos
        D-->>G: JSON Response
        G-->>P: Response
        P-->>B: HTTPS Response
    end

    Note over D,C: Tarea asíncrona (si aplica)
    D->>R: Encola la tarea (Broker DB1)
    C->>R: Consume la tarea
    C->>DB: Procesa (ORM)
    C->>E: SMTP, OneDrive o API de Anthropic según la tarea
    C->>R: Guarda el resultado (DB2)
```

---

## 5. Flujos de Negocio Principales

### 5.1 Ciclo de Vida del Requerimiento (RQ)

Resumen de los dos flujos definidos por gerencia (Operaciones y Administrativo). Los estados y transiciones completos están en el documento 03, sección 5; aquí se muestra la ruta principal.

```mermaid
graph LR
    subgraph "FASE 1<br/>Solicitud"
        F1A[DRAFT] -->|SUBMITTED| F1B[SUBMITTED]
    end

    subgraph "FASE 2<br/>Validación"
        F1B -->|"aprueba el Residente (OPS)<br/>o el Jefe Directo (ADM)"| F2A["TECHNICAL_APPROVED<br/>o SUPERVISOR_APPROVED"]
        F2A -->|"clasifica el presupuesto"| F2B{¿Presupuesto?}
        F2B -->|"dentro de propuesta<br/>o del plan anual"| F2C[VALIDATED]
        F2B -->|"adicional o<br/>fuera del plan"| F2E["ADDITIONAL_REQ<br/>o OUT_OF_ANNUAL_PLAN"]
        F2E -->|"aprueba el Residente<br/>o el Jefe Directo"| F2D[GM_REVIEW]
        F2D -->|"GM_APPROVED"| F2C
    end

    subgraph "FASE 3<br/>Logística y compras"
        F2C -->|"STOCK_CHECKED"| F3A{¿Stock?}
        F3A -->|sí| F3B[IN_STOCK]
        F3A -->|no| F3C[REQUIRES_PURCHASE]
        F3C --> F3D[QUOTING]
        F3D --> F3E[QUOTE_COMPARISON]
        F3E --> F3F[QUOTE_SELECTED]
        F3F -->|"costo aprobado"| F3G[QUOTE_COST_APPROVED]
        F3F -->|"costo excede"| F3H[COST_OVERRUN_REVIEW]
        F3H -->|"aprueba el Gerente General"| F3I[COST_OVERRUN_APPROVED]
        F3G --> F3J[PO_GENERATED]
        F3I --> F3J
    end

    subgraph "FASE 4<br/>Recepción y entrega"
        F3J -->|RECEIVED| F4A[RECEIVING]
        F4A -->|QUALITY_APPROVED| F4B[QUALITY_APPROVED]
        F4A -->|QUALITY_REJECTED| F4R[QUALITY_REJECTED]
        F4R --> F4S[SUPPLIER_CLAIM_SENT]
        F4S --> F4T[SUPPLIER_REPLACEMENT_RECEIVED]
        F4T -->|"control de calidad"| F4B
        F4T -->|"control de calidad"| F4R
        F4B --> F4C[DISPATCHED_TO_SITE]
        F3B -->|"OPS: DISPATCHED"| F4C
        F4C --> F4D[DELIVERED]
        F3B -->|"ADM: despacho directo"| F4D
    end

    subgraph "FASE 5<br/>Conformidad y cierre"
        F4D -->|"USER_CONFIRMED"| F5A[USER_CONFORMITY]
        F4D -->|"USER_CLAIMED"| F5R[CLAIM_IN_REVIEW]
        F5R -->|"SUPPLIER_CLAIM_SENT"| F4S
        F5A -->|CLOSED| F5B[CLOSED]
    end
```

Notas del flujo:

- Un RQ nuevo se registra directamente en SUBMITTED; DRAFT existe como estado inicial de la máquina de estados.
- Los rechazos (`TECHNICAL_REJECTED`, `SUPERVISOR_REJECTED`, `GM_REJECTED`, `COST_OVERRUN_REJECTED`), `CLOSED` y `CANCELLED` son estados terminales.
- En el flujo Administrativo, `DELIVERED` pasa por `WAREHOUSE_UPDATED` antes de la conformidad del usuario.
- `RQStatusChoices` define 47 valores; 37 de ellos intervienen en la tabla de transiciones (diez están definidos pero no tienen transición).

### 5.2 Ciclo Operativo del Almacén

```mermaid
graph LR
    subgraph "FASE 01<br/>Recepción"
        A1["📦 Descarga de<br/>mercadería"]
        A2["📄 Validación<br/>documentaria"]
        A3["🔍 Verificación<br/>física"]
    end

    subgraph "FASE 02<br/>Control"
        B1["🔎 Inspección<br/>de calidad"]
        B2{Conformidad}
        B3["✅ Aprobado"]
        B4["❌ Rechazado"]
    end

    subgraph "FASE 03<br/>Almacenamiento"
        C1["📍 Asignación<br/>de ubicación"]
        C2["📊 Actualización<br/>de stock"]
    end

    subgraph "FASE 04<br/>Picking"
        D1["📋 Lista de<br/>picking"]
        D2["🏃 Recorrido<br/>por almacén"]
        D3["✔️ Verificación<br/>de cantidades"]
    end

    subgraph "FASE 05<br/>Packing"
        E1["📦 Selección<br/>de empaque"]
        E2["🏷️ Etiquetado"]
    end

    subgraph "FASE 06<br/>Despacho"
        F1["🚚 Carga de<br/>vehículo"]
        F2["📝 Registro<br/>de salida"]
    end

    A1 --> A2 --> A3 --> B1
    B1 --> B2
    B2 -->|conforme| B3
    B2 -->|no conforme| B4
    B3 --> C1 --> C2
    B4 -->|devolver| A1
    C2 --> D1 --> D2 --> D3
    D3 --> E1 --> E2
    E2 --> F1 --> F2
```

El ciclo lo define gerencia y no se modifica. Qué pantallas del sistema atienden cada fase hoy:

| Fase del ciclo | Pantalla o función del sistema |
|----------------|--------------------------------|
| 01 y 02 — Recepción y control | **Ingreso de Material**: fecha, almacén, origen, proveedor, PO/OC, guía de remisión, factura y TAG por línea |
| 03 — Almacenamiento | **Inventario**: asignación de la ubicación exacta (`{Pabellón}{Sección}-{Nivel}`, p. ej. B3-2) por Almacén Central o Jefe Logístico; un ítem puede tener solo el piso mientras no se conozca la ubicación. El stock se actualiza con cada movimiento |
| 04 — Picking (recepción del RQ y ubicaciones) | **RQ Pendientes** lista los RQ que esperan acción de almacén; **Inventario** muestra la ubicación de cada producto |
| 04 (paso 5) y 06 — Descuento de stock y registro de salida | **Entrega / Egreso de material** y **Entrega de EPP con vale** (N° de vale físico, trabajador, fecha); **Transferencia interna** entre pisos se registra como una salida con destino «ALM - piso» |
| Consultas | **Movimientos**, **Kardex**, **Resumen de movimiento** (INV. INICIAL, INGRESOS, EGRESOS y STOCK) y exportaciones a Excel |
| Carga inicial | **Importar Excel** del libro «INVENTARIO PCC - ALM» en dos pasos (previsualizar y confirmar) |

---

## 6. Topología de Ejecución

Esta sección describe qué procesos y servicios componen el sistema, sin entrar en el detalle de cada plataforma de despliegue (que se documenta aparte).

```mermaid
graph TB
    subgraph "Internet"
        USERS["👥 Usuarios<br/>(Obra / Oficina)"]
    end

    subgraph "Frontend"
        DIST["📁 Build de la SPA React<br/>(Vite)"]
    end

    subgraph "Backend"
        WEB["Gunicorn + Django<br/>settings de producción (DEBUG=False)<br/>WhiteNoise para estáticos"]
        CELW["Celery worker(s)<br/>colas: por defecto y hr_cv"]
        CELB["Celery Beat<br/>DatabaseScheduler"]
        REDIS2["Redis 7<br/>caché, broker y resultados"]
    end

    subgraph "Datos y archivos"
        PG2["PostgreSQL 16<br/>conexión con SSL"]
        MEDIA["📁 media/ y private_media/<br/>(disco, o bucket S3 opcional)"]
    end

    subgraph "Servicios Externos"
        SMTP2["📧 SMTP"]
        OD["☁️ OneDrive Graph API"]
        AN["🤖 API de Anthropic"]
    end

    USERS -->|HTTPS| DIST
    USERS -->|"HTTPS /api/*"| WEB
    WEB --> REDIS2
    WEB -->|SSL| PG2
    WEB --> MEDIA
    CELW --> REDIS2
    CELB --> REDIS2
    CELW --> PG2
    CELW --> MEDIA
    CELW --> SMTP2
    CELW --> OD
    CELW --> AN
```

Entornos de configuración (`backend/config/settings/`):

| Módulo | Uso |
|--------|-----|
| `development.py` | Desarrollo local y Docker Compose: `DEBUG=True`, SQLite por defecto, CORS abierto, correo por consola |
| `production.py` | Producción: `DEBUG=False`, PostgreSQL con SSL, HSTS, cookies seguras, WhiteNoise, correo SMTP si hay credenciales |
| `demo.py` | Hereda de producción y reemplaza lo que no existe en el entorno gratuito: sin Redis (caché en memoria), Celery en modo `ALWAYS_EAGER` (sin worker ni Beat, por lo que las tareas programadas no corren) y correo por consola |

En Docker Compose local corren seis servicios: `redis`, `backend`, `frontend`, `celery_worker` (cola por defecto), `celery_worker_hr` (cola `hr_cv`) y `celery_beat`.

---

## 7. Seguridad — Vista de Alto Nivel

```mermaid
graph TB
    subgraph "Defensa en Profundidad"
        subgraph "Capa 1 — Transporte"
            SSL["🔒 TLS terminado por el proxy o la plataforma"]
            HSTS2["📋 HSTS<br/>1 año + preload"]
            SSLR["↪️ Redirección HTTP a HTTPS<br/>con confianza en X-Forwarded-Proto"]
        end

        subgraph "Capa 2 — Aplicación"
            RATE["⏱️ Rate Limiting<br/>30/min anon · 200/min usuario<br/>5/min login por IP · 10/min por usuario"]
            CSRF["🔐 CSRF doble envío<br/>cookie csrftoken legible por JS<br/>cabecera X-CSRFToken"]
            CORS2["🌐 CORS<br/>Origins explícitos<br/>Credentials: true"]
            XFO["🖼️ X-Frame-Options<br/>DENY"]
        end

        subgraph "Capa 3 — Autenticación y autorización"
            JWT2["🎫 JWT en cookies HttpOnly<br/>Access: 15 min · Refresh: 1 día"]
            ROT["🔄 Rotación de refresh<br/>+ lista negra"]
            RBAC2["👤 RBAC<br/>13 roles + superusuario<br/>Permission classes y alcance por rol"]
            PWD["🔑 Contraseña<br/>Mín. 12 caracteres<br/>Cambio forzado tras alta o reinicio"]
        end

        subgraph "Capa 4 — Datos"
            DBSSL["🐘 Conexión a BD con SSL<br/>sslmode=require como mínimo"]
            COOK["🍪 Cookies de sesión JWT<br/>HttpOnly + SameSite=Lax<br/>Secure fuera de DEBUG"]
            ADMIN2["🚪 Panel Django en /mgmt-panel/<br/>(no /admin/)"]
            PII["🗂️ Datos de RR. HH.<br/>almacenamiento privado,<br/>Cache-Control: no-store"]
        end
    end
```

Nota sobre la renovación del token: la vista `/auth/token/refresh/` es la estándar de SimpleJWT y espera el refresh token en el cuerpo, mientras que el cliente lo envía vacío porque el refresh vive en una cookie `httpOnly`. La brecha está reconocida en `apps/core/tests/test_must_change_password_gate.py`.

---

## 8. Tecnologías y Versiones

```mermaid
graph LR
    subgraph "Frontend"
        R19["React 19.2"]
        V7["Vite 7.3"]
        TW4["Tailwind CSS 4.2"]
        RR7["React Router 7.13"]
        AX["Axios 1.7"]
        LU["Lucide React"]
        EX["ExcelJS 4.4"]
        VT["Vitest 3.2"]
    end

    subgraph "Backend"
        DJ["Django 5.1"]
        DRF["DRF 3.15"]
        SJWT["SimpleJWT 5.3"]
        SPEC["drf-spectacular"]
        CEL["Celery 5.4"]
        CB["django-celery-beat 2.7"]
        GU["Gunicorn 23"]
        WN["WhiteNoise 6.8"]
        PT["pytest 8.3"]
    end

    subgraph "Procesamiento de archivos"
        OPX["openpyxl<br/>(lectura y escritura de Excel)"]
        RL["ReportLab<br/>(PDF de vales)"]
        DT["docxtpl y python-docx<br/>(contratos Word)"]
        PP["pypdf y python-magic<br/>(validación de CVs)"]
    end

    subgraph "Infraestructura"
        PG3["PostgreSQL 16"]
        RD["Redis 7"]
        PY["Python 3.12"]
        NO["Node.js 22"]
    end

    subgraph "Servicios"
        O3["SMTP"]
        OD2["OneDrive Graph API"]
        AN2["Anthropic SDK 1.11"]
    end
```

---

## 9. Resumen de Endpoints API

Todos los endpoints cuelgan de `/api/v1/`. La documentación OpenAPI completa está en `/api/docs/` (requiere usuario staff).

```mermaid
graph TB
    subgraph "/api/v1/"
        subgraph "Auth"
            A_CSRF[GET /auth/csrf/]
            A_LOGIN[POST /auth/login/]
            A_REFRESH[POST /auth/token/refresh/]
            A_LOGOUT[POST /auth/logout/]
        end

        subgraph "Core"
            C_USERS[GET/POST /users/ y /users/me/]
            C_UROLE[GET/POST/DELETE /user-roles/]
            C_PROJ[GET/POST /projects/]
            C_DEPT[GET /departments/]
            C_PERS[GET /personal/]
            C_BUDG[GET /project-budget-lines/]
            C_PLAN[GET /annual-plans/ y /annual-plan-lines/]
        end

        subgraph "RQ"
            R_REQ[GET/POST /requests/]
            R_ACT[POST /requests/id/action/]
            R_AVAIL[GET /requests/id/available-actions/]
            R_APPR[GET /requests/id/approvals/ y /activity/ y /attachments/]
            R_ITEMS[PATCH /requests/id/update-items/]
            R_STOCK[GET /requests/id/stock-availability/]
            R_CAT[GET /request-catalog/]
            R_SUP[GET/POST /suppliers/]
            R_QUO[GET/POST /quotations/ y /quotations/id/select/]
            R_PO[GET/POST /purchase-orders/]
            R_CLA[GET/POST /claims/]
            R_NOT[GET /notifications/ y /unread-count/]
            R_WF[GET /workflow-steps/ y /acquisition-type-configs/]
        end

        subgraph "Warehouse /warehouse/"
            W_INV[GET/POST /inventory/]
            W_KAR[GET /inventory/id/kardex/]
            W_LOC[GET /inventory/location-layout/ y POST /inventory/assign-locations/]
            W_SUM[GET /inventory/movement-summary/ y /inventory/export/]
            W_CHK[GET /inventory/check-stock/ y /alerts/ y /summary/]
            W_MOV[GET /movements/]
            W_BATCH[POST /movements/batch-entry/ y /batch-exit/]
            W_EPP[POST /movements/epp-delivery/ y /link-personal/]
            W_VOUCH[GET /movements/id/voucher/ y /groups/id/pdf/]
            W_PEND[GET /pending-requests/list/ y /count/]
            W_IMP[POST /imports/ y /imports/id/confirm/]
            W_LOOK[GET /personal-lookup/]
            W_OD[GET /onedrive/status/ y POST /onedrive/connect/ poll/ disconnect/]
        end

        subgraph "Administración /administracion/"
            AD_PAS[GET/POST /pasajes/]
            AD_PRO[GET/POST /proveedores-pasajes/]
            AD_POL[GET/POST /politicas-devolucion/]
            AD_PUE[GET/POST /puestos/]
            AD_TC[GET /tipo-cambio/]
        end

        subgraph "Soporte /support/"
            S_TIK[GET/POST /tickets/]
            S_COM[POST /tickets/id/add-comment/]
            S_STA[POST /tickets/id/change-status/]
            S_STAT[GET /tickets/my-stats/]
        end

        subgraph "RR. HH. /hr/"
            H_TPL[GET/POST /templates/]
            H_DOC[GET/POST /documents/ y /documents/id/issue/]
            H_CV[GET/POST /cv-analyses/ y /cv-analyses/id/items/]
            H_AST[POST /assistant/extract/]
        end
    end
```

Además existen `GET /healthz/` (verificación de salud, fuera de `/api/v1/`) y la documentación `/api/schema/`, `/api/docs/` y `/api/redoc/` (solo staff).

---

*Documento de arquitectura de alto nivel de SYSPCC — PCC Ingeniería y Construcción*
*Última actualización: Octubre 2026 (código al día con SYSPCC-026)*
