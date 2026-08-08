# SYSPCC — Arquitectura de Alto Nivel

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.0 | **Fecha:** Abril 2026 | **Empresa:** PCC Ingeniería y Construcción

---

## 1. Vista General del Sistema

```mermaid
C4Context
    title SYSPCC — Diagrama de Contexto

    Person(requester, "Solicitante", "Crea y envía requerimientos de abastecimiento")
    Person(approver, "Aprobador", "Residente, Control, GG, Jefe Directo, Gerente Admin")
    Person(logistics, "Logística", "Coordinador, Supervisor, Jefe Logístico")
    Person(warehouse, "Almacén", "Personal de almacén central y de obra")
    Person(admin, "Administrativo", "Gestiona pasajes y viáticos")

    System(syspcc, "SYSPCC", "Sistema de Gestión de Requerimientos de Abastecimiento")

    System_Ext(email, "Office 365 SMTP", "Notificaciones por correo electrónico")
    System_Ext(onedrive, "Microsoft OneDrive", "Almacenamiento de documentos PDF")
    System_Ext(postgres, "PostgreSQL", "Base de datos relacional (DigitalOcean)")

    Rel(requester, syspcc, "Crea, envía y confirma RQ")
    Rel(approver, syspcc, "Aprueba o rechaza RQ")
    Rel(logistics, syspcc, "Gestiona cotizaciones, OC y recepción")
    Rel(warehouse, syspcc, "Registra entradas, salidas e inventario")
    Rel(admin, syspcc, "Registra pasajes y políticas")

    Rel(syspcc, email, "Envía notificaciones")
    Rel(syspcc, onedrive, "Almacena PDFs vía Graph API")
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
        SPA["⚛️ React 19 SPA<br/>Vite 7.3 + Tailwind CSS 4"]

        subgraph "Módulos Frontend"
            direction LR
            RQ_FE["📋 RQ System<br/>/rq/*<br/>AppShell"]
            WH_FE["📦 Almacén<br/>/almacen/*<br/>WarehouseShell"]
            AD_FE["✈️ Admin<br/>/admin/*<br/>AdminShell"]
            SP_FE["🎫 Soporte<br/>/soporte/*<br/>SupportShell"]
        end
    end

    subgraph "CAPA DE PROXY"
        NGINX["🔒 Nginx<br/>Reverse Proxy + SSL<br/>Archivos estáticos"]
    end

    subgraph "CAPA DE APLICACIÓN"
        direction LR
        GUNICORN["🦄 Gunicorn<br/>WSGI Server<br/>4 workers"]
        DJANGO["🐍 Django 5.1<br/>+ DRF 3.15"]

        subgraph "Django Apps"
            direction LR
            CORE["🔐 core<br/>Auth, Users<br/>Projects, Depts"]
            RQ_BE["📋 rq<br/>Requests, Approvals<br/>Suppliers, POs"]
            WH_BE["📦 warehouse<br/>Inventory<br/>Movements"]
            ADMIN_BE["✈️ administracion<br/>Pasajes<br/>Políticas"]
            SUPPORT_BE["🎫 support<br/>Tickets<br/>Comments"]
        end

        subgraph "Servicios de Negocio"
            WF["⚙️ WorkflowEngine<br/>Máquina de estados<br/>43 estados, 5 fases"]
            BV["💰 BudgetValidator<br/>Validación presupuestal"]
            SLA["📅 SLACalculator<br/>Fechas límite"]
            NOTIF["🔔 NotificationService<br/>Alertas"]
        end
    end

    subgraph "CAPA DE TAREAS ASÍNCRONAS"
        direction LR
        WORKER["👷 Celery Worker<br/>Tareas asíncronas"]
        BEAT["⏰ Celery Beat<br/>Tareas programadas"]
    end

    subgraph "CAPA DE DATOS"
        direction LR
        PG["🐘 PostgreSQL 15<br/>DigitalOcean Managed<br/>Puerto 25060, SSL"]
        REDIS["🔴 Redis 7<br/>DB0: Cache<br/>DB1: Broker<br/>DB2: Results"]
    end

    subgraph "SERVICIOS EXTERNOS"
        direction LR
        O365["📧 Office 365<br/>SMTP"]
        ONEDRIVE["☁️ OneDrive<br/>Graph API"]
    end

    BROWSER -->|HTTPS 443| NGINX
    NGINX -->|/api/* /mgmt-panel/*| GUNICORN
    NGINX -->|/* SPA| SPA
    NGINX -->|/static/ /media/| DJANGO
    GUNICORN --> DJANGO
    DJANGO --> CORE
    DJANGO --> RQ_BE
    DJANGO --> WH_BE
    DJANGO --> ADMIN_BE
    DJANGO --> SUPPORT_BE
    RQ_BE --> WF
    RQ_BE --> BV
    RQ_BE --> SLA
    RQ_BE --> NOTIF
    DJANGO -->|ORM| PG
    DJANGO -->|Cache/Sessions| REDIS
    WORKER -->|Consume tareas| REDIS
    BEAT -->|Programa tareas| REDIS
    WORKER -->|ORM| PG
    DJANGO -->|SMTP| O365
    WH_BE -->|Graph API| ONEDRIVE
    SPA -->|REST API JSON| NGINX

    RQ_FE -.-> SPA
    WH_FE -.-> SPA
    AD_FE -.-> SPA
    SP_FE -.-> SPA
```

---

## 3. Módulos del Sistema

```mermaid
graph TB
    subgraph "SYSPCC Platform"
        subgraph "Módulo RQ — Requerimientos de Abastecimiento"
            RQ1["Crear y enviar requerimientos"]
            RQ2["Cadena de aprobaciones (11 roles)"]
            RQ3["Cotizaciones y comparación"]
            RQ4["Órdenes de compra"]
            RQ5["Recepción y control de calidad"]
            RQ6["Reclamos a proveedor"]
            RQ7["Conformidad y cierre"]
        end

        subgraph "Módulo Almacén — Inventario y Logística"
            WH1["Catálogo de productos"]
            WH2["Stock por almacén (Central/Obra/Oficina)"]
            WH3["Entradas y salidas con vales"]
            WH4["Transferencias entre almacenes"]
            WH5["Kardex (trazabilidad)"]
            WH6["Alertas de stock bajo"]
        end

        subgraph "Módulo Admin — Administración"
            AD1["Registro de pasajes"]
            AD2["Cálculo de devoluciones"]
            AD3["Políticas por tipo trabajador"]
            AD4["Control de pagos"]
        end

        subgraph "Módulo Soporte — TI"
            SP1["Tickets de soporte"]
            SP2["Asignación y seguimiento"]
            SP3["Dashboard de métricas"]
        end

        subgraph "Core — Transversal"
            C1["Autenticación JWT Cookie"]
            C2["RBAC (11 roles)"]
            C3["Proyectos y departamentos"]
            C4["Personal (RRHH)"]
            C5["Presupuestos y planes anuales"]
        end
    end
```

---

## 4. Flujo de Comunicación

```mermaid
sequenceDiagram
    participant B as 🌐 Browser
    participant N as 🔒 Nginx
    participant G as 🦄 Gunicorn
    participant D as 🐍 Django
    participant R as 🔴 Redis
    participant P as 🐘 PostgreSQL
    participant C as 👷 Celery
    participant E as 📧 Email

    Note over B,E: Flujo de Request típico

    B->>N: HTTPS Request
    N->>N: SSL Termination

    alt Archivo estático (/static/, /media/)
        N-->>B: Archivo desde disco
    else SPA (/)
        N-->>B: index.html (React)
    else API (/api/*)
        N->>G: proxy_pass :8000
        G->>D: WSGI Request
        D->>R: Check cache
        alt Cache hit
            R-->>D: Cached response
        else Cache miss
            D->>P: SQL Query
            P-->>D: Data
            D->>R: Store in cache (TTL 5min)
        end
        D-->>G: JSON Response
        G-->>N: Response
        N-->>B: HTTPS Response
    end

    Note over D,C: Tarea asíncrona (si aplica)
    D->>R: Encola tarea (Broker DB1)
    C->>R: Consume tarea
    C->>P: Procesa (ORM)
    C->>E: Envía email (si necesario)
    C->>R: Guarda resultado (DB2)
```

---

## 5. Flujos de Negocio Principales

### 5.1 Ciclo de Vida del Requerimiento (RQ)

```mermaid
graph LR
    subgraph "FASE 1<br/>Solicitud"
        F1A[DRAFT] -->|submit| F1B[SUBMITTED]
    end

    subgraph "FASE 2<br/>Validación"
        F1B -->|approve| F2A[TECHNICAL_APPROVED<br/>o SUPERVISOR_APPROVED]
        F2A -->|classify| F2B{¿Presupuesto?}
        F2B -->|dentro| F2C[VALIDATED]
        F2B -->|adicional/fuera| F2D[GM_REVIEW]
        F2D -->|approve| F2C
    end

    subgraph "FASE 3<br/>Logística"
        F2C -->|check stock| F3A{¿Stock?}
        F3A -->|sí| F3B[IN_STOCK]
        F3A -->|no| F3C[REQUIRES_PURCHASE]
        F3C --> F3D[QUOTING]
        F3D --> F3E[QUOTE_SELECTED]
        F3E --> F3F[PO_GENERATED]
    end

    subgraph "FASE 4<br/>Recepción"
        F3F -->|receive| F4A[RECEIVING]
        F4A -->|QC ok| F4B[QUALITY_APPROVED]
        F4B --> F4C[DISPATCHED_TO_SITE]
        F3B --> F4C
        F4C --> F4D[DELIVERED]
    end

    subgraph "FASE 5<br/>Cierre"
        F4D -->|confirm| F5A[USER_CONFORMITY]
        F5A -->|close| F5B[CLOSED]
    end
```

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

---

## 6. Infraestructura de Despliegue

```mermaid
graph TB
    subgraph "Internet"
        USERS["👥 Usuarios<br/>(Obra / Oficina)"]
    end

    subgraph "DNS"
        DNS["🌐 syspcc.pcc.com.pe"]
    end

    subgraph "VPS — DigitalOcean Droplet"
        subgraph "Capa Web"
            NGINX2["Nginx<br/>:443 HTTPS<br/>:80 → redirect<br/>SSL Let's Encrypt"]
        end

        subgraph "Capa Aplicación"
            GUN["Gunicorn<br/>:8000 (local)<br/>4 workers<br/>gthread"]
            DJANGO2["Django 5.1<br/>Production settings<br/>DEBUG=False"]
        end

        subgraph "Archivos"
            STATIC["📁 /staticfiles/<br/>ManifestStorage"]
            MEDIA["📁 /media/<br/>Uploads"]
            DIST["📁 /frontend/dist/<br/>React Build"]
        end

        subgraph "Servicios"
            REDIS2["Redis 7<br/>:6379 (local)<br/>bind 127.0.0.1"]
            CELW["Celery Worker<br/>concurrency=2"]
            CELB["Celery Beat<br/>DatabaseScheduler"]
        end
    end

    subgraph "DigitalOcean Managed Database"
        PG2["PostgreSQL 15<br/>:25060<br/>SSL required<br/>Backups automáticos"]
    end

    subgraph "Servicios Externos"
        SMTP["📧 Office 365<br/>smtp.office365.com:587"]
        OD["☁️ OneDrive<br/>Graph API"]
    end

    USERS -->|HTTPS| DNS
    DNS --> NGINX2
    NGINX2 -->|/api/*| GUN --> DJANGO2
    NGINX2 -->|/*| DIST
    NGINX2 --> STATIC
    NGINX2 --> MEDIA
    DJANGO2 --> REDIS2
    DJANGO2 -->|SSL :25060| PG2
    CELW --> REDIS2
    CELB --> REDIS2
    CELW --> PG2
    DJANGO2 --> SMTP
    DJANGO2 --> OD
```

---

## 7. Seguridad — Vista de Alto Nivel

```mermaid
graph TB
    subgraph "Defensa en Profundidad"
        subgraph "Capa 1 — Red"
            FW["🛡️ UFW Firewall<br/>Solo puertos 22, 80, 443"]
            SSL["🔒 TLS 1.2/1.3<br/>Let's Encrypt"]
            HSTS2["📋 HSTS<br/>1 año + preload"]
        end

        subgraph "Capa 2 — Aplicación"
            RATE["⏱️ Rate Limiting<br/>30/min anon<br/>200/min auth<br/>5/min login"]
            CSRF["🔐 CSRF Protection<br/>Cookie HttpOnly"]
            CORS2["🌐 CORS<br/>Origins explícitos<br/>Credentials: true"]
            XFO["🖼️ X-Frame-Options<br/>DENY"]
        end

        subgraph "Capa 3 — Autenticación"
            JWT2["🎫 JWT Cookie-based<br/>Access: 15 min<br/>Refresh: 1 día"]
            ROT["🔄 Token Rotation<br/>+ Blacklist"]
            RBAC2["👤 RBAC<br/>11 roles<br/>Permission classes"]
            PWD["🔑 Password<br/>Mín 12 caracteres"]
        end

        subgraph "Capa 4 — Datos"
            DBSSL["🐘 DB SSL<br/>sslmode=require"]
            COOK["🍪 Cookies<br/>Secure + HttpOnly<br/>+ SameSite"]
            ADMIN2["🚪 Admin URL<br/>/mgmt-panel/<br/>(no /admin/)"]
        end
    end
```

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
    end

    subgraph "Backend"
        DJ["Django 5.1"]
        DRF["DRF 3.15"]
        SJWT["SimpleJWT 5.3"]
        SPEC["drf-spectacular"]
        CEL["Celery 5.4"]
        CB["celery-beat 2.7"]
        GU["Gunicorn 23"]
    end

    subgraph "Infraestructura"
        PG3["PostgreSQL 15"]
        RD["Redis 7"]
        NX["Nginx 1.24+"]
        PY["Python 3.12"]
        NO["Node.js 22"]
    end

    subgraph "Servicios"
        O3["Office 365 SMTP"]
        OD2["OneDrive Graph API"]
        LE["Let's Encrypt"]
        DO["DigitalOcean"]
    end
```

---

## 9. Resumen de Endpoints API

```mermaid
graph TB
    subgraph "/api/v1/"
        subgraph "Auth"
            A_LOGIN[POST /auth/login/]
            A_REFRESH[POST /auth/token/refresh/]
            A_LOGOUT[POST /auth/logout/]
        end

        subgraph "Core"
            C_USERS[GET/POST /users/]
            C_PROJ[GET /projects/]
            C_DEPT[GET /departments/]
            C_PERS[GET/POST /personal/]
            C_BUDG[GET /project-budget-lines/]
            C_PLAN[GET /annual-plans/]
        end

        subgraph "RQ"
            R_REQ[GET/POST /requests/]
            R_ACT[POST /requests/{id}/action/]
            R_AVAIL[GET /requests/{id}/available-actions/]
            R_APPR[GET /requests/{id}/approvals/]
            R_SUP[GET/POST /suppliers/]
            R_QUO[GET/POST /quotations/]
            R_PO[GET/POST /purchase-orders/]
            R_CLA[GET/POST /claims/]
            R_NOT[GET /notifications/]
        end

        subgraph "Warehouse"
            W_INV[GET/POST /warehouse/inventory/]
            W_KAR[GET /warehouse/inventory/{id}/kardex/]
            W_MOV[GET/POST /warehouse/movements/]
            W_BATCH[POST /warehouse/movements/entry-batch/]
            W_VOUCH[GET /warehouse/movements/{id}/voucher/]
        end

        subgraph "Admin"
            AD_PAS[GET/POST /administracion/pasajes/]
            AD_PRO[GET/POST /administracion/proveedores-pasajes/]
            AD_POL[GET/POST /administracion/politicas-devolucion/]
        end

        subgraph "Support"
            S_TIK[GET/POST /support/tickets/]
            S_COM[POST /support/tickets/{id}/add-comment/]
            S_STA[POST /support/tickets/{id}/change-status/]
        end
    end
```

---

*Documento generado para SYSPCC v1.0 — PCC Ingeniería y Construcción*
*Última actualización: Abril 2026*
