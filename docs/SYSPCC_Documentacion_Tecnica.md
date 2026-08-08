# SYSPCC — Documentación Técnica del Sistema

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.0
**Fecha:** Abril 2026
**Empresa:** PCC Ingeniería y Construcción

---

## Tabla de Contenidos

1. [Casos de Uso](#1-casos-de-uso)
2. [Arquitectura de Alto Nivel](#2-arquitectura-de-alto-nivel)
3. [Arquitectura de Bajo Nivel](#3-arquitectura-de-bajo-nivel)
4. [Diagrama de Clases](#4-diagrama-de-clases)
5. [Guía de Despliegue](#5-guía-de-despliegue)
6. [Manual de Producción](#6-manual-de-producción)

---

# 1. Casos de Uso

## 1.1 Actores del Sistema

| Actor | Código | Descripción |
|-------|--------|-------------|
| Solicitante | REQUESTER | Crea y envía requerimientos de abastecimiento |
| Residente de Proyecto | PROJECT_RESIDENT | Valida técnicamente los RQ de operaciones |
| Control de Proyecto | PROJECT_CONTROL | Clasifica presupuesto y aprueba costos (operaciones) |
| Gerente General | GENERAL_MANAGER | Aprobación final para adicionales y sobrecostos |
| Coordinador Logístico | LOGISTICS_COORDINATOR | Gestiona cotizaciones, compras y recepción (operaciones) |
| Almacén Central | CENTRAL_WAREHOUSE | Despacha materiales desde almacén central |
| Almacén de Obra | SITE_WAREHOUSE | Recibe materiales en obra y confirma entrega |
| Jefe Directo | DIRECT_SUPERVISOR | Valida RQ administrativos |
| Gerente Administrativo | ADMIN_MANAGER | Revisa presupuesto del plan anual (administrativo) |
| Supervisor Logístico | LOGISTICS_SUPERVISOR | Gestiona compras del flujo administrativo |
| Jefe Logístico | LOGISTICS_CHIEF | Compara cotizaciones del flujo administrativo |

## 1.2 Casos de Uso — Módulo de Requerimientos (RQ)

### CU-01: Crear Requerimiento

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Solicitante (REQUESTER) |
| **Precondición** | Usuario autenticado con rol REQUESTER asignado a un proyecto u oficina |
| **Descripción** | El solicitante crea un nuevo requerimiento de abastecimiento indicando los ítems necesarios, cantidades, especificaciones, prioridad y fecha de necesidad |
| **Flujo principal** | 1. Selecciona proyecto/departamento<br>2. Indica flujo (Operaciones/Administrativo)<br>3. Completa campos: descripción, justificación, prioridad, fecha de necesidad<br>4. Agrega ítems con descripción, cantidad, unidad, precio unitario<br>5. Opcionalmente carga archivo Excel con ítems<br>6. Guarda como borrador (DRAFT) |
| **Postcondición** | RQ creado con número auto-generado (RQ-YYYY-NNNN), estado DRAFT |
| **Extensiones** | E1: Carga masiva de ítems vía Excel (.xlsx) |

### CU-02: Enviar Requerimiento

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Solicitante (REQUESTER) |
| **Precondición** | RQ en estado DRAFT con al menos 1 ítem |
| **Descripción** | El solicitante envía el RQ para iniciar el proceso de aprobación |
| **Flujo principal** | 1. Abre RQ en estado DRAFT<br>2. Revisa ítems y datos<br>3. Ejecuta acción "Enviar"<br>4. Sistema valida datos mínimos<br>5. Estado cambia a SUBMITTED |
| **Postcondición** | RQ en estado SUBMITTED, notificación enviada al aprobador correspondiente |

### CU-03: Validación Técnica (Flujo Operaciones)

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Residente de Proyecto (PROJECT_RESIDENT) |
| **Precondición** | RQ en estado SUBMITTED, flujo OPERATIONS |
| **Descripción** | El residente revisa técnicamente el requerimiento y aprueba o rechaza |
| **Flujo principal** | 1. Ve lista de RQ pendientes de revisión técnica<br>2. Abre el RQ y revisa ítems, especificaciones y justificación<br>3. Aprueba → estado cambia a TECHNICAL_APPROVED<br>4. O rechaza con comentarios → estado cambia a TECHNICAL_REJECTED |
| **Postcondición** | RQ aprobado técnicamente o devuelto al solicitante |

### CU-04: Clasificación Presupuestal (Flujo Operaciones)

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Control de Proyecto (PROJECT_CONTROL) |
| **Precondición** | RQ en estado TECHNICAL_APPROVED |
| **Descripción** | Control de proyecto clasifica el gasto como dentro de propuesta o adicional |
| **Flujo principal** | 1. Revisa el RQ aprobado técnicamente<br>2. Consulta partida presupuestal del proyecto<br>3. Clasifica: WITHIN_PROPOSAL → pasa a VALIDATED automáticamente<br>4. O clasifica: ADDITIONAL_REQ → requiere aprobación adicional del residente y GG |
| **Flujo alternativo** | Si es ADDITIONAL_REQ: Residente aprueba → GG revisa → GM_APPROVED → VALIDATED |
| **Postcondición** | RQ validado presupuestalmente o en revisión de gerencia |

### CU-05: Validación Administrativa (Flujo Administrativo)

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Jefe Directo (DIRECT_SUPERVISOR), Gerente Administrativo (ADMIN_MANAGER) |
| **Precondición** | RQ en estado SUBMITTED, flujo ADMINISTRATIVE |
| **Descripción** | El jefe directo aprueba y luego el gerente administrativo clasifica contra el plan anual |
| **Flujo principal** | 1. Jefe directo aprueba → SUPERVISOR_APPROVED<br>2. Gerente administrativo revisa contra plan anual<br>3. WITHIN_ANNUAL_PLAN → VALIDATED automáticamente<br>4. OUT_OF_ANNUAL_PLAN → requiere aprobación del jefe directo y GG |
| **Postcondición** | RQ validado administrativamente |

### CU-06: Aprobación de Gerencia General

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Gerente General (GENERAL_MANAGER) |
| **Precondición** | RQ en estado GM_REVIEW (adicional o fuera de plan) |
| **Descripción** | El GG revisa y aprueba o rechaza requerimientos que exceden presupuesto |
| **Flujo principal** | 1. Ve lista de RQ pendientes de aprobación GG<br>2. Revisa justificación y montos<br>3. Aprueba → GM_APPROVED → VALIDATED<br>4. O rechaza → GM_REJECTED |
| **Postcondición** | RQ aprobado por gerencia o rechazado definitivamente |

### CU-07: Verificación de Stock

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Coordinador Logístico / Supervisor Logístico |
| **Precondición** | RQ en estado VALIDATED |
| **Descripción** | Logística verifica si los ítems solicitados están disponibles en almacén |
| **Flujo principal** | 1. Recibe RQ validado<br>2. Consulta inventario de almacén<br>3. Si hay stock → IN_STOCK (despacho directo)<br>4. Si no hay stock → REQUIRES_PURCHASE (proceso de compra) |
| **Postcondición** | RQ derivado a despacho o a proceso de cotización |

### CU-08: Gestión de Cotizaciones

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Coordinador Logístico / Jefe Logístico |
| **Precondición** | RQ en estado REQUIRES_PURCHASE |
| **Descripción** | Logística solicita cotizaciones a proveedores, compara y selecciona la mejor opción |
| **Flujo principal** | 1. Cambia estado a QUOTING<br>2. Registra cotizaciones de proveedores (mínimo 1)<br>3. Compara precios, plazos y condiciones → QUOTE_COMPARISON<br>4. Selecciona cotización ganadora → QUOTE_SELECTED<br>5. Control de proyecto/Gerente administrativo aprueba costo → QUOTE_COST_APPROVED |
| **Flujo alternativo** | Si costo excede presupuesto → COST_OVERRUN_REVIEW → GG aprueba o rechaza |
| **Postcondición** | Cotización seleccionada y aprobada, lista para generar orden de compra |

### CU-09: Generar Orden de Compra

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Coordinador Logístico / Supervisor Logístico |
| **Precondición** | RQ en estado QUOTE_COST_APPROVED o COST_OVERRUN_APPROVED |
| **Descripción** | Genera orden de compra formal al proveedor seleccionado |
| **Flujo principal** | 1. Sistema genera número de OC (OC-YYYY-NNNN)<br>2. Registra datos del proveedor, ítems, montos y condiciones<br>3. Estado cambia a PO_GENERATED |
| **Postcondición** | Orden de compra generada, proveedor notificado |

### CU-10: Recepción y Control de Calidad

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Coordinador Logístico / Supervisor Logístico |
| **Precondición** | RQ en estado PO_GENERATED |
| **Descripción** | Recibe mercadería del proveedor y realiza control de calidad |
| **Flujo principal** | 1. Recibe mercadería → RECEIVING<br>2. Inspecciona calidad, cantidades y especificaciones<br>3. QC aprobado → QUALITY_APPROVED<br>4. QC rechazado → QUALITY_REJECTED → ciclo de reclamo |
| **Postcondición** | Mercadería aprobada lista para despacho, o reclamo iniciado al proveedor |

### CU-11: Despacho y Entrega

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central, Almacén de Obra |
| **Precondición** | RQ en estado QUALITY_APPROVED o IN_STOCK |
| **Descripción** | Almacén despacha materiales al punto de entrega y registra la recepción |
| **Flujo principal** | 1. Almacén central despacha → DISPATCHED_TO_SITE<br>2. Almacén de obra recibe y confirma → DELIVERED |
| **Postcondición** | Materiales entregados en destino |

### CU-12: Conformidad del Usuario

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Solicitante (REQUESTER) |
| **Precondición** | RQ en estado DELIVERED |
| **Descripción** | El solicitante verifica que los materiales recibidos son correctos |
| **Flujo principal** | 1. Revisa materiales entregados<br>2. Confirma conformidad → USER_CONFORMITY<br>3. O presenta reclamo → CLAIM_IN_REVIEW |
| **Postcondición** | RQ con conformidad o en proceso de reclamo |

### CU-13: Cierre de Requerimiento

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Coordinador Logístico / Supervisor Logístico |
| **Precondición** | RQ en estado USER_CONFORMITY |
| **Descripción** | Logística cierra formalmente el requerimiento |
| **Flujo principal** | 1. Verifica conformidad del usuario<br>2. Cierra el RQ → CLOSED |
| **Postcondición** | RQ cerrado, registro completo en auditoría |

### CU-14: Cancelar Requerimiento

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Roles autorizados |
| **Precondición** | RQ en cualquier estado no terminal |
| **Descripción** | Cancela un requerimiento en curso |
| **Flujo principal** | 1. Selecciona RQ activo<br>2. Indica motivo de cancelación<br>3. Estado cambia a CANCELLED<br>4. Presupuesto comprometido se libera |
| **Postcondición** | RQ cancelado, presupuesto liberado |

## 1.3 Casos de Uso — Módulo de Almacén

### CU-15: Registrar Entrada de Mercadería

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central (CENTRAL_WAREHOUSE) |
| **Precondición** | Orden de compra generada o transferencia autorizada |
| **Descripción** | Registra el ingreso de productos al almacén con validación documental y física |
| **Flujo principal** | 1. Recibe mercadería del proveedor<br>2. Valida documentos (guía de remisión, factura)<br>3. Cuenta bultos y verifica cantidades<br>4. Inspecciona calidad visual<br>5. Registra entrada en sistema (tipo ENTRY)<br>6. Actualiza stock automáticamente |
| **Postcondición** | Stock actualizado, movimiento de entrada registrado |

### CU-16: Registrar Salida de Mercadería

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central (CENTRAL_WAREHOUSE) |
| **Precondición** | RQ validado con stock disponible o materiales aprobados por QC |
| **Descripción** | Prepara y despacha materiales según requerimiento |
| **Flujo principal** | 1. Recibe lista de picking del RQ<br>2. Localiza productos por ubicación (pabellón-sección-nivel)<br>3. Extrae y verifica cantidades<br>4. Empaca según tipo de producto<br>5. Genera vale de salida (voucher)<br>6. Registra salida en sistema (tipo EXIT)<br>7. Descuenta stock automáticamente |
| **Postcondición** | Stock descontado, vale de salida generado |

### CU-17: Consultar Kardex de Producto

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Personal de almacén |
| **Precondición** | Producto registrado en inventario |
| **Descripción** | Consulta historial completo de movimientos de un producto |
| **Flujo principal** | 1. Busca producto por código o descripción<br>2. Visualiza kardex con entradas, salidas, transferencias y ajustes<br>3. Filtra por rango de fechas, tipo de movimiento o almacén |
| **Postcondición** | Información de trazabilidad visualizada |

### CU-18: Transferencia entre Almacenes

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central / Almacén de Obra |
| **Precondición** | Producto con stock disponible en almacén origen |
| **Descripción** | Transfiere materiales de un almacén a otro |
| **Flujo principal** | 1. Selecciona producto y cantidad<br>2. Indica almacén origen y destino<br>3. Registra movimiento tipo TRANSFER<br>4. Sistema descuenta del origen y suma al destino |
| **Postcondición** | Stock actualizado en ambos almacenes |

## 1.4 Casos de Uso — Módulo de Administración

### CU-19: Gestionar Pasajes

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Personal administrativo |
| **Precondición** | Usuario autenticado con acceso al módulo administrativo |
| **Descripción** | Registra y gestiona boletos de viaje del personal |
| **Flujo principal** | 1. Registra datos del viaje (embarque, destino, fechas)<br>2. Asocia al personal por DNI<br>3. Registra proveedor y factura<br>4. Calcula montos con IGV y tipo de cambio<br>5. Aplica devoluciones según política vigente<br>6. Marca estado de pago |
| **Postcondición** | Pasaje registrado con cálculos automáticos |

### CU-20: Configurar Políticas de Devolución

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Administrador |
| **Precondición** | Acceso al módulo de administración |
| **Descripción** | Define montos de devolución por tipo de trabajador y tramo |
| **Flujo principal** | 1. Crea/edita política indicando tipo trabajador (STAFF/WORKER)<br>2. Indica tramo de viaje<br>3. Define montos en soles y dólares<br>4. Indica si aplica devolución<br>5. Activa o desactiva política |
| **Postcondición** | Política aplicable a futuros registros de pasajes |

## 1.5 Casos de Uso — Módulo de Soporte TI

### CU-21: Crear Ticket de Soporte

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Cualquier usuario autenticado |
| **Precondición** | Usuario autenticado |
| **Descripción** | Reporta un problema o solicitud de soporte técnico |
| **Flujo principal** | 1. Selecciona categoría (HARDWARE/SOFTWARE/NETWORK/ACCESS/EMAIL/PRINTER/OTHER)<br>2. Indica prioridad (LOW/MEDIUM/HIGH/CRITICAL)<br>3. Describe el problema<br>4. Sistema genera número de ticket (TK-YYYYMMDD-XXXX) |
| **Postcondición** | Ticket creado en estado OPEN |

## 1.6 Casos de Uso — Autenticación

### CU-22: Iniciar Sesión

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Cualquier usuario |
| **Precondición** | Usuario registrado en el sistema |
| **Descripción** | Autenticación mediante credenciales con JWT en cookies |
| **Flujo principal** | 1. Ingresa usuario y contraseña<br>2. Sistema valida credenciales<br>3. Genera tokens JWT (access 15min + refresh 1 día)<br>4. Almacena tokens en cookies HttpOnly<br>5. Redirige a selector de módulos |
| **Restricción** | Máximo 5 intentos/minuto (rate limiting) |
| **Postcondición** | Sesión activa con tokens JWT en cookies seguras |

### CU-23: Seleccionar Módulo del Sistema

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Usuario autenticado |
| **Precondición** | Sesión activa |
| **Descripción** | Selecciona a qué módulo acceder según sus roles |
| **Flujo principal** | 1. Sistema muestra módulos disponibles filtrados por roles del usuario<br>2. Módulos: RQ (Requerimientos), Almacén, Administración, Soporte TI<br>3. Usuario selecciona módulo<br>4. Sistema carga el shell y sidebar correspondiente |
| **Postcondición** | Usuario en el dashboard del módulo seleccionado |

---

# 2. Arquitectura de Alto Nivel

## 2.1 Vista General del Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USUARIOS FINALES                            │
│  Solicitantes · Residentes · Control · GG · Logística · Almacén    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS (puerto 443)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CAPA DE PRESENTACIÓN                             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              React 19 SPA + Tailwind CSS 4                    │  │
│  │                                                               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │  │
│  │  │ Módulo   │ │ Módulo   │ │ Módulo   │ │ Módulo           │ │  │
│  │  │ RQ       │ │ Almacén  │ │ Admin    │ │ Soporte TI       │ │  │
│  │  │ (AppShell│ │(Warehouse│ │(AdminShel│ │ (SupportShell)   │ │  │
│  │  │  )       │ │ Shell)   │ │ l)       │ │                  │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │  │
│  │                                                               │  │
│  │  Routing: React Router v7 · Auth: Cookie JWT · State: Context │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Build: Vite 7.3 · Exportación Excel: ExcelJS · Íconos: Lucide    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST API (JSON)
                               │ /api/v1/*
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CAPA DE APLICACIÓN                              │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Django 5.1 + Django REST Framework               │  │
│  │                                                               │  │
│  │  ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌────────────┐       │  │
│  │  │  core   │ │   rq    │ │ warehouse │ │   admin    │       │  │
│  │  │         │ │         │ │           │ │            │       │  │
│  │  │ Auth    │ │Requests │ │ Inventario│ │ Pasajes    │       │  │
│  │  │ Users   │ │Approvals│ │ Movim.    │ │ Políticas  │       │  │
│  │  │ Projects│ │Suppliers│ │ Entradas  │ │ Proveedores│       │  │
│  │  │ Depts   │ │Quotation│ │ Salidas   │ │            │       │  │
│  │  │ Personal│ │PO's     │ │ OneDrive  │ │            │       │  │
│  │  │         │ │Claims   │ │           │ │            │       │  │
│  │  └─────────┘ └─────────┘ └───────────┘ └────────────┘       │  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────┐ ┌───────────────────┐  │  │
│  │  │         support                  │ │   Servicios       │  │  │
│  │  │  Tickets · Comentarios           │ │                   │  │  │
│  │  └──────────────────────────────────┘ │ WorkflowEngine    │  │  │
│  │                                       │ BudgetValidator   │  │  │
│  │  Auth: Cookie JWT (SimpleJWT)         │ SLACalculator     │  │  │
│  │  Permisos: RBAC por ViewSet           │ NumberGenerator   │  │  │
│  │  Docs: OpenAPI 3.0 (drf-spectacular)  │ NotificationSvc   │  │  │
│  │                                       └───────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────┬──────────────────────────┬───────────────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────┐  ┌───────────────────────────────────────┐
│   CAPA DE DATOS          │  │   CAPA DE INFRAESTRUCTURA             │
│                          │  │                                       │
│  ┌────────────────────┐  │  │  ┌─────────────────────────────────┐  │
│  │ PostgreSQL         │  │  │  │ Redis 7                         │  │
│  │ (DigitalOcean)     │  │  │  │                                 │  │
│  │                    │  │  │  │  DB 0: Cache (django-redis)     │  │
│  │ - Usuarios/Roles   │  │  │  │  DB 1: Celery Broker           │  │
│  │ - Proyectos        │  │  │  │  DB 2: Celery Results          │  │
│  │ - Requerimientos   │  │  │  │  Sessions: Redis-backed        │  │
│  │ - Aprobaciones     │  │  │  └─────────────────────────────────┘  │
│  │ - Inventario       │  │  │                                       │
│  │ - Movimientos      │  │  │  ┌─────────────────────────────────┐  │
│  │ - Pasajes          │  │  │  │ Celery 5.4                      │  │
│  │ - Tickets          │  │  │  │                                 │  │
│  └────────────────────┘  │  │  │  Worker: Tareas asíncronas      │  │
│                          │  │  │  Beat: Tareas programadas       │  │
│  SSL: sslmode=require    │  │  │                                 │  │
│  Puerto: 25060           │  │  │  • SLA check (8:00 AM)          │  │
└──────────────────────────┘  │  │  • Recordatorios (9AM/2PM)      │  │
                              │  │  • Cache invalidation (c/15min) │  │
                              │  │  • Low-stock alerts (7:30 AM)   │  │
                              │  └─────────────────────────────────┘  │
                              │                                       │
                              │  ┌─────────────────────────────────┐  │
                              │  │ OneDrive (Graph API)            │  │
                              │  │ Almacenamiento de PDFs          │  │
                              │  │ Cuenta: sistemas@pcc.com.pe     │  │
                              │  └─────────────────────────────────┘  │
                              └───────────────────────────────────────┘
```

## 2.2 Flujo de Comunicación

```
Browser ──HTTPS──▶ Nginx (reverse proxy)
                      │
                      ├── /api/*  ──▶ Gunicorn (Django)  ──▶ PostgreSQL
                      │                    │                      ▲
                      ├── /static/* ──▶ Archivos estáticos        │
                      │                                           │
                      ├── /media/*  ──▶ Archivos de usuario       │
                      │                                           │
                      └── /*        ──▶ React SPA (index.html)    │
                                                                  │
Celery Worker ◀── Redis (Broker) ◀── Django (encola tareas) ──────┘
Celery Beat   ──▶ Redis (Broker) ──▶ Celery Worker ──▶ Django ORM
```

## 2.3 Módulos del Sistema

| Módulo | Ruta Frontend | App Backend | Descripción |
|--------|--------------|-------------|-------------|
| Requerimientos (RQ) | `/rq/*` | `apps.rq` | Gestión completa del ciclo de vida de requerimientos de abastecimiento |
| Almacén | `/almacen/*` | `apps.warehouse` | Inventario, entradas, salidas, transferencias, kardex |
| Administración | `/admin/*` | `apps.administracion` | Pasajes, pagos, políticas de devolución |
| Soporte TI | `/soporte/*` | `apps.support` | Tickets de soporte técnico interno |
| Core | — | `apps.core` | Autenticación, usuarios, roles, proyectos, departamentos |

---

# 3. Arquitectura de Bajo Nivel

## 3.1 Backend — Estructura de Capas

```
┌─────────────────────────────────────────────────────┐
│                    URLS (Routing)                    │
│  config/urls.py → apps/<app>/urls.py                │
│  Router DRF: ModelViewSet auto-routing              │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                   VIEWS (ViewSets)                   │
│                                                     │
│  apps/<app>/views/<entity>.py                       │
│                                                     │
│  • ModelViewSet / GenericViewSet                     │
│  • Permission classes (HasRole, IsOwnerOrAdmin)     │
│  • Filtros (django-filter, SearchFilter)            │
│  • Acciones custom (@action decorator)              │
│  • Throttling por endpoint                          │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                SERIALIZERS (Validación)              │
│                                                     │
│  apps/<app>/serializers/<entity>.py                  │
│                                                     │
│  • ModelSerializer con campos explícitos            │
│  • Validación de datos de entrada                   │
│  • Serialización de relaciones (nested, PK)         │
│  • Campos calculados (SerializerMethodField)        │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              SERVICES (Lógica de Negocio)            │
│                                                     │
│  apps/<app>/services/<service>.py                    │
│                                                     │
│  ┌─────────────────┐ ┌─────────────────┐           │
│  │ WorkflowEngine  │ │ BudgetValidator │           │
│  │                 │ │                 │           │
│  │ • Transiciones  │ │ • Validar costo │           │
│  │ • Validaciones  │ │ • Comprometer   │           │
│  │ • Permisos/rol  │ │ • Liberar       │           │
│  │ • Audit trail   │ │                 │           │
│  └─────────────────┘ └─────────────────┘           │
│  ┌─────────────────┐ ┌─────────────────┐           │
│  │ SLACalculator   │ │ NumberGenerator │           │
│  │                 │ │                 │           │
│  │ • Fechas límite │ │ • RQ-YYYY-NNNN │           │
│  │ • Tipo adquis.  │ │ • OC-YYYY-NNNN │           │
│  └─────────────────┘ └─────────────────┘           │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                  MODELS (ORM Django)                  │
│                                                     │
│  apps/<app>/models/<entity>.py                      │
│  Re-exports via apps/<app>/models/__init__.py       │
│                                                     │
│  • Campos tipados con validaciones                  │
│  • Relaciones FK/M2M con constraints               │
│  • Índices para queries frecuentes                  │
│  • Propiedades calculadas                           │
│  • Métodos save() con lógica auto-cálculo           │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                  DATABASE (PostgreSQL)               │
│                                                     │
│  Migraciones: apps/<app>/migrations/                │
│  Índices automáticos + índices manuales (Meta)      │
└─────────────────────────────────────────────────────┘
```

## 3.2 Frontend — Estructura de Componentes

```
┌─────────────────────────────────────────────────────┐
│                   App.jsx (Raíz)                     │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ AuthProvider (AuthContext)                   │    │
│  │  ┌─────────────────────────────────────┐    │    │
│  │  │ ToastProvider (ToastContext)         │    │    │
│  │  │  ┌─────────────────────────────┐    │    │    │
│  │  │  │ BrowserRouter               │    │    │    │
│  │  │  │   └── Routes                │    │    │    │
│  │  │  └─────────────────────────────┘    │    │    │
│  │  └─────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘

Shells (Layout por módulo):
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
│  AppShell   │ │ Warehouse   │ │ AdminShell  │ │ SupportShell │
│  (azul)     │ │ Shell       │ │ (índigo)    │ │ (teal)       │
│             │ │ (esmeralda) │ │             │ │              │
│ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌──────────┐ │
│ │ Header  │ │ │ │ Header  │ │ │ │ Header  │ │ │ │ Header   │ │
│ │ Sidebar │ │ │ │WhSidebar│ │ │ │AdmSideb.│ │ │ │SupSideb. │ │
│ │ Outlet  │ │ │ │ Outlet  │ │ │ │ Outlet  │ │ │ │ Outlet   │ │
│ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │ │ └──────────┘ │
└─────────────┘ └─────────────┘ └─────────────┘ └──────────────┘
```

## 3.3 Capa API — Comunicación Frontend ↔ Backend

```
Frontend (Axios)                    Backend (DRF)
────────────────                    ─────────────
api/client.js                       config/urls.py
  │                                   │
  │ axios.create({                    │ urlpatterns = [
  │   baseURL: VITE_API_URL,         │   path('api/v1/', include([
  │   withCredentials: true           │     path('auth/', ...),
  │ })                                │     path('', include(rq_urls)),
  │                                   │     path('warehouse/', ...),
  │ Interceptor 401:                  │   ])),
  │   → refresh token                │ ]
  │   → retry request                │
  │   → queue concurrent 401s        │
  │                                   │
  ▼                                   ▼
api/requests.js                     apps/rq/views/request.py
  │                                   │
  │ getRequests(params)              │ class RequestViewSet(ModelViewSet):
  │ createRequest(data)              │   queryset = Request.objects.all()
  │ performAction(id, action)        │   serializer_class = RequestSerializer
  │                                   │   permission_classes = [IsAuthenticated]
  │                                   │   filter_backends = [DjangoFilter...]
  │                                   │
  │                                   │   @action(detail=True, methods=['post'])
  │                                   │   def action(self, request, pk):
  │                                   │       WorkflowEngine.transition(...)
  └───────── POST /requests/{id}/action/ ──────────┘
```

## 3.4 Motor de Workflow — Máquina de Estados

```
                    ┌──────────┐
                    │  DRAFT   │
                    └────┬─────┘
                         │ submit
                         ▼
                    ┌──────────┐
                    │SUBMITTED │
                    └────┬─────┘
                         │
              ┌──────────┴──────────┐
              │ OPERATIONS          │ ADMINISTRATIVE
              ▼                     ▼
     ┌────────────────┐    ┌────────────────────┐
     │TECHNICAL_APPROVED│    │SUPERVISOR_APPROVED │
     └───────┬────────┘    └───────┬────────────┘
             │                     │
     ┌───────┴───────┐    ┌───────┴────────┐
     │               │    │                │
     ▼               ▼    ▼                ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│WITHIN_   │ │ADDITIONAL│ │WITHIN_   │ │OUT_OF_ANNUAL │
│PROPOSAL  │ │_REQ      │ │ANNUAL_   │ │_PLAN         │
└────┬─────┘ └────┬─────┘ │PLAN      │ └──────┬───────┘
     │            │        └────┬─────┘        │
     │      ┌─────┘             │        ┌─────┘
     │      ▼                   │        ▼
     │ ┌──────────┐             │   ┌──────────┐
     │ │GM_REVIEW │             │   │GM_REVIEW │
     │ └────┬─────┘             │   └────┬─────┘
     │      │ approve           │        │
     │      ▼                   │        ▼
     │ ┌──────────┐             │   ┌──────────┐
     │ │GM_APPROVED│             │   │GM_APPROVED│
     │ └────┬─────┘             │   └────┬─────┘
     │      │                   │        │
     └──┬───┘                   └───┬────┘
        ▼                           ▼
   ┌──────────┐              ┌──────────┐
   │VALIDATED │              │VALIDATED │
   └────┬─────┘              └────┬─────┘
        │ stock check              │
   ┌────┴─────┐              ┌────┴─────┐
   ▼          ▼              ▼          ▼
┌────────┐ ┌──────────┐  ┌────────┐ ┌──────────┐
│IN_STOCK│ │REQUIRES_ │  │IN_STOCK│ │REQUIRES_ │
│        │ │PURCHASE  │  │        │ │PURCHASE  │
└───┬────┘ └────┬─────┘  └───┬────┘ └────┬─────┘
    │           │             │           │
    │           ▼             │           ▼
    │    ┌──────────┐         │    ┌──────────┐
    │    │ QUOTING  │         │    │ QUOTING  │
    │    └────┬─────┘         │    └────┬─────┘
    │         ▼               │         ▼
    │    ┌──────────┐         │    ┌──────────┐
    │    │QUOTE_    │         │    │QUOTE_    │
    │    │COMPARISON│         │    │COMPARISON│
    │    └────┬─────┘         │    └────┬─────┘
    │         ▼               │         ▼
    │    ┌──────────┐         │    ┌──────────┐
    │    │QUOTE_    │         │    │QUOTE_    │
    │    │SELECTED  │         │    │SELECTED  │
    │    └────┬─────┘         │    └────┬─────┘
    │         ▼               │         ▼
    │    ┌──────────────┐     │    ┌──────────────┐
    │    │QUOTE_COST_   │     │    │QUOTE_COST_   │
    │    │APPROVED      │     │    │APPROVED      │
    │    └────┬─────────┘     │    └────┬─────────┘
    │         ▼               │         ▼
    │    ┌──────────┐         │    ┌──────────┐
    │    │PO_       │         │    │PO_       │
    │    │GENERATED │         │    │GENERATED │
    │    └────┬─────┘         │    └────┬─────┘
    │         ▼               │         ▼
    │    ┌──────────┐         │    ┌──────────┐
    │    │RECEIVING │         │    │RECEIVING │
    │    └────┬─────┘         │    └────┬─────┘
    │         ▼               │         ▼
    │    ┌──────────────┐     │    ┌──────────────┐
    │    │QUALITY_      │     │    │QUALITY_      │
    │    │APPROVED      │     │    │APPROVED      │
    │    └────┬─────────┘     │    └────┬─────────┘
    │         │               │         │
    └────┬────┘               └────┬────┘
         ▼                         ▼
    ┌──────────────┐         ┌──────────┐
    │DISPATCHED_   │         │DELIVERED │
    │TO_SITE       │         └────┬─────┘
    └────┬─────────┘              │
         ▼                        ▼
    ┌──────────┐         ┌──────────────────┐
    │DELIVERED │         │WAREHOUSE_UPDATED │
    └────┬─────┘         └───────┬──────────┘
         │                       │
         ▼                       ▼
    ┌──────────────┐      ┌──────────────┐
    │USER_         │      │USER_         │
    │CONFORMITY    │      │CONFORMITY    │
    └────┬─────────┘      └────┬─────────┘
         ▼                     ▼
    ┌──────────┐         ┌──────────┐
    │ CLOSED   │         │ CLOSED   │
    └──────────┘         └──────────┘
```

## 3.5 Modelo de Autenticación

```
┌──────────┐     POST /auth/login/     ┌──────────────┐
│  Browser │ ──────────────────────▶   │   Django     │
│          │                           │              │
│          │  ◀── Set-Cookie:          │  SimpleJWT   │
│          │      access_token (15m)   │  + Cookie    │
│          │      refresh_token (1d)   │  Auth Class  │
│          │      HttpOnly, Secure     │              │
└──────────┘                           └──────────────┘

Flujo de refresh:
┌──────────┐     GET /api/v1/...       ┌──────────────┐
│  Axios   │ ──────────────────────▶   │   Django     │
│ Intercep.│  ◀── 401 Unauthorized     │              │
│          │                           └──────────────┘
│          │     POST /auth/token/     ┌──────────────┐
│          │     /refresh/             │   Django     │
│          │ ──────────────────────▶   │              │
│          │  ◀── New cookies          │  Rota token  │
│          │      (access + refresh)   │  Blacklist   │
│          │                           │  anterior    │
│          │     Retry original req    └──────────────┘
│          │ ──────────────────────▶
└──────────┘
```

## 3.6 Estructura de la Base de Datos — Relaciones

```
                    ┌──────────┐
                    │   User   │
                    └─────┬────┘
                          │ 1:N
                    ┌─────┴────┐
                    │ UserRole │──── role (enum)
                    └─────┬────┘     project (FK, nullable)
                          │          department (FK, nullable)
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   ┌─────────┐     ┌──────────┐      ┌────────────┐
   │ Project │     │Department│      │  Personal  │
   └────┬────┘     └────┬─────┘      └────────────┘
        │               │
   ┌────┴────┐    ┌─────┴──────┐
   │Budget   │    │AnnualPlan  │
   │Line     │    │            │
   └─────────┘    └─────┬──────┘
                        │
                  ┌─────┴──────┐
                  │AnnualPlan  │
                  │Line        │
                  └────────────┘

┌──────────────────── REQUEST (centro del sistema) ──────────────────┐
│                                                                    │
│  ┌──────────┐  1:N  ┌─────────────┐                               │
│  │ Request  │───────│ RequestItem │──── inventory_item (FK)        │
│  │          │       └─────────────┘                                │
│  │          │                                                      │
│  │          │  1:N  ┌──────────┐                                   │
│  │          │───────│ Approval │ (audit trail inmutable)           │
│  │          │       └──────────┘                                   │
│  │          │                                                      │
│  │          │  1:N  ┌──────────────┐  1:N  ┌───────────────┐      │
│  │          │───────│  Quotation   │───────│ QuotationItem │      │
│  │          │       └──────┬───────┘       └───────────────┘      │
│  │          │              │ FK                                    │
│  │          │  1:N  ┌──────┴───────┐  1:N  ┌─────────────────┐   │
│  │          │───────│PurchaseOrder │───────│PurchaseOrderItem│   │
│  │          │       └──────────────┘       └─────────────────┘   │
│  │          │                                                      │
│  │          │  1:N  ┌──────────┐                                   │
│  │          │───────│  Claim   │                                   │
│  └──────────┘       └──────────┘                                   │
│       │                                                            │
│       │ FK  ┌──────────┐                                           │
│       └─────│ Supplier │                                           │
│             └──────────┘                                           │
└────────────────────────────────────────────────────────────────────┘

┌─────────── WAREHOUSE ─────────────┐    ┌──────── ADMINISTRACIÓN ────────┐
│                                   │    │                                │
│  ┌───────────┐  1:N ┌──────────┐ │    │  ┌──────────┐                  │
│  │ Inventory │──────│Inventory │ │    │  │  Pasaje  │── personal (FK)  │
│  │           │      │Stock     │ │    │  │          │── proveedor (FK) │
│  │           │      └──────────┘ │    │  │          │── centro_costo   │
│  │           │                   │    │  └──────────┘                  │
│  │           │  1:N ┌──────────┐ │    │                                │
│  │           │──────│Inventory │ │    │  ┌──────────────────────────┐  │
│  │           │      │Movement  │ │    │  │PoliticaPasajeDevoluciones│  │
│  └───────────┘      └─────┬────┘ │    │  └──────────────────────────┘  │
│                           │      │    │                                │
│                     ┌─────┴────┐ │    │  ┌───────────────────┐        │
│                     │Movement  │ │    │  │ProveedorPasajes   │        │
│                     │Group     │ │    │  └───────────────────┘        │
│                     │(Vale)    │ │    └────────────────────────────────┘
│                     └──────────┘ │
└───────────────────────────────────┘
```

## 3.7 Tareas Programadas (Celery Beat)

| Tarea | Horario | Descripción |
|-------|---------|-------------|
| `check-sla-deadlines` | 8:00 AM (Lima) | Verifica RQ que exceden su fecha límite SLA y envía alertas |
| `send-pending-approval-reminders` | 9:00 AM y 2:00 PM | Recuerda aprobaciones pendientes >24 horas |
| `invalidate-dashboard-caches` | Cada 15 minutos | Limpia caches de dashboards para datos actualizados |
| `warehouse-low-stock-check` | 7:30 AM | Detecta productos bajo stock mínimo y notifica |

---

# 4. Diagrama de Clases

## 4.1 Módulo Core

```
┌────────────────────────────────────────┐
│                 User                    │
│ (extends AbstractUser)                  │
├────────────────────────────────────────┤
│ - email: EmailField (unique)           │
│ - first_name: CharField               │
│ - last_name: CharField                │
│ - position: CharField                 │
│ - department: CharField               │
│ - phone: CharField                    │
│ - avatar_url: URLField               │
│ - signature: ImageField              │
├────────────────────────────────────────┤
│ + get_roles(): List[str]              │
│ + has_role(role: str): bool           │
└────────┬───────────────────────────────┘
         │ 1
         │
         │ N
┌────────┴───────────────────────────────┐
│              UserRole                   │
├────────────────────────────────────────┤
│ - user: FK → User                      │
│ - role: CharField (RoleChoices)        │
│ - project: FK → Project (null)         │
│ - department_obj: FK → Department(null)│
│ - is_primary: BooleanField            │
│ - assigned_at: DateTimeField          │
├────────────────────────────────────────┤
│ «unique» (user, role, project,         │
│           department_obj)              │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│               Project                   │
├────────────────────────────────────────┤
│ - code: CharField (unique)             │
│ - name: CharField                      │
│ - location: CharField                  │
│ - client: CharField                    │
│ - frente: CharField                    │
│ - total_budget: DecimalField           │
│ - start_date: DateField               │
│ - end_date: DateField                  │
│ - is_active: BooleanField             │
└────────┬───────────────────────────────┘
         │ 1
         │ N
┌────────┴───────────────────────────────┐
│          ProjectBudgetLine              │
├────────────────────────────────────────┤
│ - project: FK → Project                │
│ - code: CharField                      │
│ - description: CharField               │
│ - budgeted_amount: DecimalField        │
│ - committed_amount: DecimalField       │
│ - spent_amount: DecimalField           │
├────────────────────────────────────────┤
│ + available_amount: Decimal (property) │
│ «unique» (project, code)              │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│              Department                 │
├────────────────────────────────────────┤
│ - code: CharField (unique)             │
│ - name: CharField                      │
│ - frente: CharField                    │
│ - manager: FK → User                   │
│ - is_active: BooleanField             │
└────────┬───────────────────────────────┘
         │ 1
         │ N
┌────────┴───────────────────────────────┐
│             AnnualPlan                  │
├────────────────────────────────────────┤
│ - year: IntegerField                   │
│ - department: FK → Department          │
│ - total_budget: DecimalField           │
│ - approved_by: FK → User               │
│ - approved_at: DateTimeField           │
│ - is_active: BooleanField             │
│ «unique» (year, department)            │
└────────┬───────────────────────────────┘
         │ 1
         │ N
┌────────┴───────────────────────────────┐
│           AnnualPlanLine                │
├────────────────────────────────────────┤
│ - annual_plan: FK → AnnualPlan         │
│ - code: CharField                      │
│ - description: CharField               │
│ - category: CharField                  │
│ - budgeted_amount: DecimalField        │
│ - committed_amount: DecimalField       │
│ - spent_amount: DecimalField           │
├────────────────────────────────────────┤
│ + available_amount: Decimal (property) │
│ «unique» (annual_plan, code)           │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│              Personal                   │
├────────────────────────────────────────┤
│ - dni: CharField (unique)              │
│ - apellidos_nombres: CharField         │
│ - fecha_nacimiento: DateField          │
│ - sexo: CharField                      │
│ - estado_civil: CharField              │
│ - celular: CharField                   │
│ - email_personal: EmailField           │
│ - estado: CharField (ACTIVO/CESADO/...)│
│ - fecha_ingreso: DateField             │
│ - proyecto: FK → Project               │
│ - puesto: CharField                    │
│ - salario: DecimalField                │
│ - user: OneToOne → User (nullable)     │
├────────────────────────────────────────┤
│ + edad: int (property)                 │
└────────────────────────────────────────┘
```

## 4.2 Módulo RQ (Requerimientos)

```
┌────────────────────────────────────────────────┐
│                    Request                      │
├────────────────────────────────────────────────┤
│ - rq_number: CharField (auto, RQ-YYYY-NNNN)   │
│ - flow: CharField (OPERATIONS/ADMINISTRATIVE)  │
│ - project: FK → Project (null)                  │
│ - department: FK → Department (null)            │
│ - requested_by: FK → User                       │
│ - front_area: CharField                        │
│ - service: CharField                           │
│ - specific_use: CharField                      │
│ - description: TextField                       │
│ - justification: TextField                     │
│ - acquisition_type: CharField                  │
│ - priority: CharField (LOW/MEDIUM/HIGH/URGENT) │
│ - status: CharField (43 estados posibles)      │
│ - current_step: FK → WorkflowStep              │
│ - budget_classification: CharField             │
│ - budget_line: FK → ProjectBudgetLine (null)   │
│ - annual_plan_line: FK → AnnualPlanLine (null) │
│ - estimated_cost: DecimalField                 │
│ - final_cost: DecimalField                     │
│ - fecha_necesidad: DateField                   │
│ - fecha_estimada_entrega: DateField            │
│ - fecha_real_entrega: DateField                │
├────────────────────────────────────────────────┤
│ + is_terminal: bool (property)                 │
│ + total_items_cost: Decimal (property)         │
│ «index» flow, project, department, status,     │
│         acquisition_type, priority, created_at │
└──┬──────────┬──────────┬──────────┬────────────┘
   │1:N       │1:N       │1:N       │1:N
   │          │          │          │
   ▼          ▼          ▼          ▼
┌──────────┐ ┌────────┐ ┌────────┐ ┌──────┐
│RequestItem│ │Approval│ │Quotation│ │Claim │
└──────────┘ └────────┘ └────────┘ └──────┘

┌────────────────────────────────────────┐
│            RequestItem                  │
├────────────────────────────────────────┤
│ - request: FK → Request                │
│ - line_number: IntegerField            │
│ - description: CharField               │
│ - specifications: TextField            │
│ - quantity: DecimalField               │
│ - unit: CharField                      │
│ - unit_price: DecimalField             │
│ - total_price: DecimalField (auto)     │
│ - stock_almacen_obra: DecimalField     │
│ - stock_almacen_central: DecimalField  │
│ - x_atender: DecimalField             │
│ - supply_source: CharField             │
│ - inventory_item: FK → Inventory(null) │
├────────────────────────────────────────┤
│ + save(): auto-calcula total_price     │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│        Approval (inmutable)             │
├────────────────────────────────────────┤
│ - request: FK → Request                │
│ - workflow_step: FK → WorkflowStep     │
│ - action: CharField (ApprovalAction)   │
│ - performed_by: FK → User              │
│ - role: CharField                      │
│ - previous_status: CharField           │
│ - new_status: CharField                │
│ - comments: TextField                  │
│ - performed_at: DateTimeField (auto)   │
│ «index» request, performed_by,         │
│         performed_at                   │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│              Supplier                   │
├────────────────────────────────────────┤
│ - ruc: CharField (unique, 11 dígitos)  │
│ - business_name: CharField             │
│ - trade_name: CharField                │
│ - contact_name: CharField              │
│ - contact_email: EmailField            │
│ - contact_phone: CharField             │
│ - address: CharField                   │
│ - city: CharField                      │
│ - category: CharField                  │
│ - is_active: BooleanField             │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│             Quotation                   │
├────────────────────────────────────────┤
│ - request: FK → Request                │
│ - supplier: FK → Supplier              │
│ - quotation_number: CharField          │
│ - total_amount: DecimalField           │
│ - currency: CharField (PEN/USD)        │
│ - delivery_days: IntegerField          │
│ - payment_terms: CharField             │
│ - validity_days: IntegerField          │
│ - notes: TextField                     │
│ - document_url: URLField               │
│ - is_selected: BooleanField           │
│ - selected_by: FK → User (null)        │
│ - selected_at: DateTimeField (null)    │
├────────────────────────────────────────┤
│          QuotationItem                  │
│ - quotation: FK → Quotation            │
│ - request_item: FK → RequestItem       │
│ - unit_price: DecimalField             │
│ - quantity: DecimalField               │
│ - total_price: DecimalField (auto)     │
│ - brand: CharField                     │
│ - model: CharField                     │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│           PurchaseOrder                 │
├────────────────────────────────────────┤
│ - po_number: CharField (OC-YYYY-NNNN) │
│ - request: FK → Request                │
│ - quotation: FK → Quotation            │
│ - supplier: FK → Supplier              │
│ - generated_by: FK → User              │
│ - status: CharField (POStatus)         │
│ - total_amount: DecimalField           │
│ - currency: CharField                  │
│ - payment_terms: CharField             │
│ - expected_delivery_date: DateField    │
│ - actual_delivery_date: DateField      │
│ - document_url: URLField               │
├────────────────────────────────────────┤
│        PurchaseOrderItem                │
│ - purchase_order: FK → PurchaseOrder   │
│ - request_item: FK → RequestItem       │
│ - quotation_item: FK → QuotationItem   │
│ - description: CharField               │
│ - quantity: DecimalField               │
│ - unit: CharField                      │
│ - unit_price: DecimalField             │
│ - total_price: DecimalField            │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│               Claim                     │
├────────────────────────────────────────┤
│ - request: FK → Request                │
│ - claim_type: CharField                │
│   (SUPPLIER_CLAIM / USER_COMPLAINT)    │
│ - raised_by: FK → User                 │
│ - managed_by: FK → User (null)         │
│ - status: CharField                    │
│   (OPEN/IN_REVIEW/RESOLVED/CLOSED)     │
│ - description: TextField               │
│ - resolution: TextField                │
│ - resolved_by: FK → User (null)        │
│ - created_at: DateTimeField            │
│ - resolved_at: DateTimeField (null)    │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│           WorkflowStep                  │
├────────────────────────────────────────┤
│ - flow: CharField (OPS/ADM)            │
│ - step_order: IntegerField             │
│ - step_code: CharField                 │
│ - step_name: CharField                 │
│ - responsible_role: CharField          │
│ - from_status: CharField               │
│ - to_status_approve: CharField         │
│ - to_status_reject: CharField          │
│ - is_conditional: BooleanField         │
│ - condition_description: TextField     │
│ - is_terminal_on_reject: BooleanField  │
│ - phase: IntegerField (1-5)            │
│ «unique» (flow, step_order)            │
│ «unique» (flow, step_code)             │
└────────────────────────────────────────┘
```

## 4.3 Módulo Almacén

```
┌────────────────────────────────────────┐
│             Inventory                   │
├────────────────────────────────────────┤
│ - product_code: CharField (unique)     │
│ - description: CharField               │
│ - unit: CharField                      │
│ - category: CharField                  │
│ - item_type: CharField                 │
│   (EQUIPMENT/CONSUMABLE/TOOL/MATERIAL) │
│ - brand: CharField                     │
│ - model_name: CharField                │
│ - location: CharField                  │
│ - min_stock: DecimalField              │
└──┬─────────────┬──────────────────────┘
   │ 1:N         │ 1:N
   │             │
   ▼             ▼
┌──────────────┐ ┌──────────────────────┐
│InventoryStock│ │InventoryMovement     │
├──────────────┤ ├──────────────────────┤
│- inventory:  │ │- movement_number:    │
│  FK→Inventory│ │  CharField (unique)  │
│- warehouse:  │ │- movement_type:      │
│  CharField   │ │  (ENTRY/EXIT/        │
│  (CENTRAL/   │ │   TRANSFER/ADJUST)   │
│   SITE/      │ │- inventory:          │
│   OFFICE)    │ │  FK → Inventory      │
│- project:    │ │- quantity: Decimal   │
│  FK→Project  │ │- warehouse: CharField│
│- department: │ │- project: FK→Project │
│  FK→Dept     │ │- source_type: Char   │
│- quantity:   │ │- destination_type:   │
│  Decimal     │ │  CharField           │
│- last_updated│ │- group:              │
│  DateTime    │ │  FK→MovementGroup    │
│              │ │- registered_by:      │
│«unique»      │ │  FK → User           │
│(inventory,   │ │                      │
│ warehouse,   │ │«index»              │
│ project,     │ │(inventory,-created)  │
│ department)  │ │(mov_type,-created)   │
└──────────────┘ │(warehouse,-created)  │
                 └──────────┬───────────┘
                            │ N:1
                            ▼
                 ┌──────────────────────┐
                 │   MovementGroup      │
                 │   (Vale/Voucher)     │
                 ├──────────────────────┤
                 │- group_number:       │
                 │  CharField (unique)  │
                 │- movement_type: Char │
                 │- warehouse: CharField│
                 │- project: FK→Project │
                 │- source_type: Char   │
                 │- supplier_name: Char │
                 │- invoice_number: Char│
                 │- destination_type:   │
                 │  CharField           │
                 │- document_url: URL   │
                 │- registered_by:      │
                 │  FK → User           │
                 └──────────────────────┘
```

## 4.4 Módulo Administración

```
┌────────────────────────────────────────┐
│               Pasaje                    │
├────────────────────────────────────────┤
│ - tipo: CharField (B/S/S-B)           │
│ - fecha_bajada: DateField              │
│ - embarque_bajada: CharField           │
│ - destino_bajada: CharField            │
│ - fecha_subida: DateField              │
│ - embarque_subida: CharField           │
│ - destino_subida: CharField            │
│ - personal: FK → Personal (null)       │
│ - dni: CharField                       │
│ - nombres: CharField                   │
│ - cargo: CharField                     │
│ - tipo_trabajador: CharField           │
│   (STAFF / WORKER)                     │
│ - centro_costo: FK → Project           │
│ - proveedor: FK → ProveedorPasajes     │
│ - moneda: CharField (PEN/USD)          │
│ - monto_con_igv_soles: DecimalField    │
│ - monto_con_igv_dolares: DecimalField  │
│ - tipo_cambio: DecimalField            │
│ - devolucion: DecimalField             │
│ - total: DecimalField (auto)           │
│ - estado: CharField (PENDIENTE/PAGADO) │
│ - fecha_pago: DateField (null)         │
│ - creado_por: FK → User                │
├────────────────────────────────────────┤
│ + save(): auto-calc total, mes         │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│      PoliticaPasajeDevoluciones         │
├────────────────────────────────────────┤
│ - tipo_trabajador: CharField           │
│ - tramo: CharField                     │
│ - en_dolares: BooleanField             │
│ - no_devolucion: BooleanField          │
│ - monto_dolares: DecimalField          │
│ - monto_soles: DecimalField            │
│ - habilitado: BooleanField             │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│         ProveedorPasajes                │
├────────────────────────────────────────┤
│ - ruc: CharField (unique, 11)          │
│ - razon_social: CharField              │
└────────────────────────────────────────┘
```

## 4.5 Módulo Soporte TI

```
┌────────────────────────────────────────┐
│               Ticket                    │
├────────────────────────────────────────┤
│ - ticket_number: CharField             │
│   (auto, TK-YYYYMMDD-XXXX)            │
│ - title: CharField                     │
│ - description: TextField               │
│ - category: CharField                  │
│   (HARDWARE/SOFTWARE/NETWORK/          │
│    ACCESS/EMAIL/PRINTER/OTHER)         │
│ - priority: CharField                  │
│   (LOW/MEDIUM/HIGH/CRITICAL)           │
│ - status: CharField                    │
│   (OPEN/IN_PROGRESS/RESOLVED/CLOSED)   │
│ - created_by: FK → User                │
│ - assigned_to: FK → User (null)        │
│ - resolved_at: DateTimeField (null)    │
└────────┬───────────────────────────────┘
         │ 1:N
         ▼
┌────────────────────────────────────────┐
│           TicketComment                 │
├────────────────────────────────────────┤
│ - ticket: FK → Ticket                  │
│ - author: FK → User                    │
│ - content: TextField                   │
│ - is_status_change: BooleanField       │
│ - old_status: CharField (null)         │
│ - new_status: CharField (null)         │
└────────────────────────────────────────┘
```

## 4.6 Servicios (Clases de Lógica de Negocio)

```
┌────────────────────────────────────────┐
│           WorkflowEngine                │
├────────────────────────────────────────┤
│ + transition(request, action,          │
│              user, comments): Request  │
│ + get_available_actions(request,       │
│              user): List[Action]       │
│ + validate_transition(request,         │
│              action, user): bool       │
├────────────────────────────────────────┤
│ - _check_role_permission()             │
│ - _execute_transition()                │
│ - _create_approval_record()            │
│ - _handle_conditional_transitions()    │
│ - _auto_transition()                   │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│          BudgetValidator                │
├────────────────────────────────────────┤
│ + validate(request): ValidationResult  │
│ + commit_budget(request): void         │
│ + release_budget(request): void        │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│           SLACalculator                 │
├────────────────────────────────────────┤
│ + calculate_deadline(request): date    │
│ + check_overdue(request): bool         │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│       RQNumberGenerator                 │
├────────────────────────────────────────┤
│ + generate(): str (RQ-YYYY-NNNN)       │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│       PONumberGenerator                 │
├────────────────────────────────────────┤
│ + generate(): str (OC-YYYY-NNNN)       │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│       NotificationService               │
├────────────────────────────────────────┤
│ + notify_sla_warning(request): void    │
│ + notify_approval_pending(request):void│
│ + notify_status_change(request): void  │
└────────────────────────────────────────┘
```

---

# 5. Guía de Despliegue

## 5.1 Requisitos del Servidor

### Hardware Mínimo
| Recurso | Desarrollo | Producción |
|---------|-----------|-----------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disco | 20 GB SSD | 50 GB SSD |
| Red | — | IP pública, dominio configurado |

### Software Requerido
| Software | Versión | Propósito |
|----------|---------|-----------|
| Ubuntu Server | 22.04 LTS+ | Sistema operativo |
| Python | 3.12+ | Runtime backend |
| Node.js | 22 LTS | Build frontend |
| PostgreSQL | 15+ | Base de datos (o DigitalOcean Managed DB) |
| Redis | 7+ | Cache, broker Celery, sesiones |
| Nginx | 1.24+ | Reverse proxy, archivos estáticos |
| Certbot | Latest | Certificados SSL (Let's Encrypt) |
| Git | 2.40+ | Control de versiones |

## 5.2 Despliegue con Docker Compose (Desarrollo)

### Paso 1: Clonar repositorio

```bash
git clone https://github.com/pccpegit/syspcc-platform.git
cd syspcc-platform
```

### Paso 2: Configurar variables de entorno

```bash
# El archivo .env.docker ya incluye configuración de desarrollo
# Revisar y ajustar si es necesario:
cat .env.docker
```

### Paso 3: Levantar servicios

```bash
docker compose --env-file .env.docker up --build
```

### Paso 4: Inicializar base de datos

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_demo
```

### Paso 5: Acceder al sistema

| Servicio | URL |
|----------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000/api/v1/ |
| Panel Admin | http://localhost:8000/mgmt-panel/ |
| API Docs | http://localhost:8000/api/docs/ |

## 5.3 Despliegue Manual (Desarrollo Local)

### Backend

```bash
cd backend/

# Crear entorno virtual
python3 -m venv venv
source venv/bin/activate

# Instalar dependencias
pip install -r requirements.txt

# Configurar variables de entorno
cp .env.example .env
# Editar .env con valores locales

# Migraciones y datos demo
DJANGO_SETTINGS_MODULE=config.settings.development python manage.py migrate
DJANGO_SETTINGS_MODULE=config.settings.development python manage.py seed_demo

# Iniciar servidor
DJANGO_SETTINGS_MODULE=config.settings.development python manage.py runserver
```

### Frontend

```bash
cd frontend/

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev
```

### Redis (requerido para cache y Celery)

```bash
# macOS
brew install redis
brew services start redis

# Ubuntu
sudo apt install redis-server
sudo systemctl start redis
```

### Celery (opcional en desarrollo)

```bash
cd backend/

# Worker (procesa tareas asíncronas)
celery -A config worker -l info

# Beat (tareas programadas)
celery -A config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler
```

---

# 6. Manual de Producción

## 6.1 Arquitectura de Despliegue en Producción

```
┌─────────────────────────────────────────────────────────────┐
│                        INTERNET                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (443)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     SERVIDOR VPS                             │
│                   (DigitalOcean Droplet)                      │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Nginx                               │  │
│  │                                                       │  │
│  │  puerto 443 (HTTPS) ──▶ SSL termination               │  │
│  │  puerto 80  ──▶ redirect a 443                        │  │
│  │                                                       │  │
│  │  /              ──▶ React SPA (archivos estáticos)    │  │
│  │  /api/*         ──▶ proxy_pass → Gunicorn :8000       │  │
│  │  /mgmt-panel/*  ──▶ proxy_pass → Gunicorn :8000       │  │
│  │  /static/*      ──▶ alias /app/staticfiles/           │  │
│  │  /media/*       ──▶ alias /app/media/                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Gunicorn (WSGI)                           │  │
│  │              bind 127.0.0.1:8000                       │  │
│  │              workers: 4 (2 × CPU + 1)                 │  │
│  │              worker-class: gthread                     │  │
│  │              threads: 2                               │  │
│  │              timeout: 120                             │  │
│  │                                                       │  │
│  │              Django 5.1 + DRF                         │  │
│  │              config.settings.production               │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                  │
│          ┌────────────────┼────────────────┐                 │
│          ▼                ▼                ▼                  │
│  ┌──────────────┐ ┌─────────────┐ ┌──────────────┐         │
│  │ Redis 7      │ │Celery Worker│ │ Celery Beat  │         │
│  │ (local)      │ │ (systemd)   │ │ (systemd)    │         │
│  │              │ │             │ │              │         │
│  │ DB 0: Cache  │ │ Procesa     │ │ Programa     │         │
│  │ DB 1: Broker │ │ tareas      │ │ tareas       │         │
│  │ DB 2: Results│ │ async       │ │ periódicas   │         │
│  └──────────────┘ └─────────────┘ └──────────────┘         │
│                                                             │
└─────────────────────────────┬───────────────────────────────┘
                              │ SSL (puerto 25060)
                              ▼
                   ┌──────────────────────┐
                   │  PostgreSQL          │
                   │  DigitalOcean        │
                   │  Managed Database    │
                   │                      │
                   │  Host: db-xxx.       │
                   │  ondigitalocean.com  │
                   │  Puerto: 25060       │
                   │  SSL: required       │
                   └──────────────────────┘
```

## 6.2 Preparación del Servidor

### 6.2.1 Configuración Inicial del VPS

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar dependencias del sistema
sudo apt install -y \
    python3.12 python3.12-venv python3.12-dev \
    nginx certbot python3-certbot-nginx \
    redis-server \
    git curl build-essential \
    libpq-dev libmagic1 \
    supervisor

# Crear usuario de aplicación
sudo adduser --system --group --home /opt/syspcc syspcc
```

### 6.2.2 Configurar PostgreSQL (DigitalOcean Managed)

La base de datos se gestiona externamente en DigitalOcean. Solo se necesitan las credenciales de conexión que se configuran en las variables de entorno.

### 6.2.3 Configurar Redis

```bash
# Redis ya instalado, configurar para producción
sudo nano /etc/redis/redis.conf

# Cambios recomendados:
#   maxmemory 256mb
#   maxmemory-policy allkeys-lru
#   bind 127.0.0.1
#   requirepass <password_seguro>

sudo systemctl enable redis-server
sudo systemctl restart redis-server
```

## 6.3 Despliegue del Backend

### 6.3.1 Código y Entorno Virtual

```bash
# Clonar repositorio
sudo -u syspcc git clone https://github.com/pccpegit/syspcc-platform.git /opt/syspcc/app
cd /opt/syspcc/app/backend

# Crear entorno virtual
sudo -u syspcc python3.12 -m venv /opt/syspcc/venv
source /opt/syspcc/venv/bin/activate

# Instalar dependencias
pip install -r requirements.txt
```

### 6.3.2 Variables de Entorno de Producción

```bash
sudo nano /opt/syspcc/app/backend/.env
```

```ini
# Django
SECRET_KEY=<clave-secreta-larga-y-aleatoria-de-50-caracteres>
DJANGO_SETTINGS_MODULE=config.settings.production
DJANGO_ENV=production
DEBUG=False
ALLOWED_HOSTS=syspcc.pcc.com.pe,www.syspcc.pcc.com.pe

# Base de datos (DigitalOcean Managed PostgreSQL)
DB_ENGINE=django.db.backends.postgresql
DB_NAME=syspcclog
DB_USER=doadmin
DB_PASSWORD=<contraseña-de-digitalocean>
DB_HOST=db-postgresql-nyc3-xxxxx.ondigitalocean.com
DB_PORT=25060

# Redis
REDIS_URL=redis://:<redis-password>@127.0.0.1:6379/0
CELERY_BROKER_URL=redis://:<redis-password>@127.0.0.1:6379/1
CELERY_RESULT_BACKEND=redis://:<redis-password>@127.0.0.1:6379/2

# CORS
CORS_ALLOWED_ORIGINS=https://syspcc.pcc.com.pe

# Email (Office 365)
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.office365.com
EMAIL_PORT=587
EMAIL_HOST_USER=sistemas@pcc.com.pe
EMAIL_HOST_PASSWORD=<contraseña-email>
DEFAULT_FROM_EMAIL=sistemas@pcc.com.pe

# Seguridad
SECURE_SSL_REDIRECT=True
```

### 6.3.3 Inicializar Base de Datos

```bash
cd /opt/syspcc/app/backend
source /opt/syspcc/venv/bin/activate

# Ejecutar migraciones
python manage.py migrate

# Recolectar archivos estáticos
python manage.py collectstatic --noinput

# Crear superusuario
python manage.py createsuperuser
```

### 6.3.4 Configurar Gunicorn (systemd)

```bash
sudo nano /etc/systemd/system/syspcc-gunicorn.service
```

```ini
[Unit]
Description=SYSPCC Gunicorn Application Server
After=network.target redis-server.service

[Service]
User=syspcc
Group=syspcc
WorkingDirectory=/opt/syspcc/app/backend
EnvironmentFile=/opt/syspcc/app/backend/.env
ExecStart=/opt/syspcc/venv/bin/gunicorn config.wsgi:application \
    --bind 127.0.0.1:8000 \
    --workers 4 \
    --worker-class gthread \
    --threads 2 \
    --timeout 120 \
    --access-logfile /var/log/syspcc/gunicorn-access.log \
    --error-logfile /var/log/syspcc/gunicorn-error.log \
    --capture-output
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/log/syspcc
sudo chown syspcc:syspcc /var/log/syspcc

sudo systemctl daemon-reload
sudo systemctl enable syspcc-gunicorn
sudo systemctl start syspcc-gunicorn
```

### 6.3.5 Configurar Celery Worker (systemd)

```bash
sudo nano /etc/systemd/system/syspcc-celery-worker.service
```

```ini
[Unit]
Description=SYSPCC Celery Worker
After=network.target redis-server.service

[Service]
User=syspcc
Group=syspcc
WorkingDirectory=/opt/syspcc/app/backend
EnvironmentFile=/opt/syspcc/app/backend/.env
ExecStart=/opt/syspcc/venv/bin/celery -A config worker \
    --loglevel=info \
    --concurrency=2 \
    --logfile=/var/log/syspcc/celery-worker.log
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 6.3.6 Configurar Celery Beat (systemd)

```bash
sudo nano /etc/systemd/system/syspcc-celery-beat.service
```

```ini
[Unit]
Description=SYSPCC Celery Beat Scheduler
After=network.target redis-server.service

[Service]
User=syspcc
Group=syspcc
WorkingDirectory=/opt/syspcc/app/backend
EnvironmentFile=/opt/syspcc/app/backend/.env
ExecStart=/opt/syspcc/venv/bin/celery -A config beat \
    --loglevel=info \
    --scheduler django_celery_beat.schedulers:DatabaseScheduler \
    --logfile=/var/log/syspcc/celery-beat.log
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable syspcc-celery-worker syspcc-celery-beat
sudo systemctl start syspcc-celery-worker syspcc-celery-beat
```

## 6.4 Despliegue del Frontend

### 6.4.1 Build de Producción

```bash
cd /opt/syspcc/app/frontend

# Instalar dependencias
npm ci

# Configurar URL de API para producción
echo "VITE_API_URL=/api/v1/" > .env.production

# Build de producción
npm run build

# Los archivos quedan en /opt/syspcc/app/frontend/dist/
```

## 6.5 Configuración de Nginx

### 6.5.1 Archivo de Configuración

```bash
sudo nano /etc/nginx/sites-available/syspcc
```

```nginx
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name syspcc.pcc.com.pe;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name syspcc.pcc.com.pe;

    # SSL (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/syspcc.pcc.com.pe/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/syspcc.pcc.com.pe/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Seguridad
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Tamaño máximo de upload (para Excel y documentos)
    client_max_body_size 20M;

    # Logs
    access_log /var/log/nginx/syspcc-access.log;
    error_log /var/log/nginx/syspcc-error.log;

    # Archivos estáticos de Django
    location /static/ {
        alias /opt/syspcc/app/backend/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Archivos media (uploads)
    location /media/ {
        alias /opt/syspcc/app/backend/media/;
        expires 7d;
    }

    # API Backend (Django/Gunicorn)
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    # Panel de administración Django
    location /mgmt-panel/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # React SPA (frontend)
    location / {
        root /opt/syspcc/app/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;

        # Cache de assets con hash
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

### 6.5.2 Activar Sitio

```bash
sudo ln -s /etc/nginx/sites-available/syspcc /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### 6.5.3 Obtener Certificado SSL

```bash
sudo certbot --nginx -d syspcc.pcc.com.pe
# Certbot configurará renovación automática
```

## 6.6 Mantenimiento y Operaciones

### 6.6.1 Actualización del Sistema

```bash
#!/bin/bash
# Script: /opt/syspcc/scripts/deploy.sh

set -e

APP_DIR="/opt/syspcc/app"
VENV="/opt/syspcc/venv"

echo "=== Pulling latest code ==="
cd $APP_DIR
git pull origin main

echo "=== Backend: Installing dependencies ==="
source $VENV/bin/activate
cd $APP_DIR/backend
pip install -r requirements.txt

echo "=== Backend: Running migrations ==="
python manage.py migrate --noinput

echo "=== Backend: Collecting static files ==="
python manage.py collectstatic --noinput

echo "=== Frontend: Building ==="
cd $APP_DIR/frontend
npm ci
npm run build

echo "=== Restarting services ==="
sudo systemctl restart syspcc-gunicorn
sudo systemctl restart syspcc-celery-worker
sudo systemctl restart syspcc-celery-beat

echo "=== Deployment complete ==="
```

### 6.6.2 Backup de Base de Datos

```bash
#!/bin/bash
# Script: /opt/syspcc/scripts/backup-db.sh

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/syspcc/backups"
RETENTION_DAYS=30

mkdir -p $BACKUP_DIR

# Backup PostgreSQL (DigitalOcean)
PGPASSWORD=$DB_PASSWORD pg_dump \
    -h $DB_HOST \
    -p $DB_PORT \
    -U $DB_USER \
    -d $DB_NAME \
    --format=custom \
    --compress=9 \
    -f "$BACKUP_DIR/syspcc_db_$TIMESTAMP.dump"

# Eliminar backups antiguos
find $BACKUP_DIR -name "*.dump" -mtime +$RETENTION_DAYS -delete

echo "Backup completado: syspcc_db_$TIMESTAMP.dump"
```

### 6.6.3 Restaurar Base de Datos

```bash
# Restaurar desde backup
PGPASSWORD=$DB_PASSWORD pg_restore \
    -h $DB_HOST \
    -p $DB_PORT \
    -U $DB_USER \
    -d $DB_NAME \
    --clean \
    --if-exists \
    /opt/syspcc/backups/syspcc_db_YYYYMMDD_HHMMSS.dump
```

### 6.6.4 Monitoreo de Servicios

```bash
# Ver estado de todos los servicios
sudo systemctl status syspcc-gunicorn
sudo systemctl status syspcc-celery-worker
sudo systemctl status syspcc-celery-beat
sudo systemctl status redis-server
sudo systemctl status nginx

# Ver logs en tiempo real
sudo journalctl -u syspcc-gunicorn -f
sudo journalctl -u syspcc-celery-worker -f
tail -f /var/log/nginx/syspcc-error.log
tail -f /var/log/syspcc/gunicorn-error.log
```

### 6.6.5 Comandos de Administración Frecuentes

```bash
cd /opt/syspcc/app/backend
source /opt/syspcc/venv/bin/activate

# Crear superusuario
python manage.py createsuperuser

# Shell interactivo
python manage.py shell

# Cargar datos demo (solo desarrollo/staging)
python manage.py seed_demo

# Ver migraciones pendientes
python manage.py showmigrations | grep "\[ \]"

# Limpiar sesiones expiradas
python manage.py clearsessions

# Limpiar tokens JWT expirados
python manage.py flushexpiredtokens
```

### 6.6.6 Rotación de Logs

```bash
sudo nano /etc/logrotate.d/syspcc
```

```
/var/log/syspcc/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 syspcc syspcc
    sharedscripts
    postrotate
        systemctl reload syspcc-gunicorn 2>/dev/null || true
    endscript
}
```

## 6.7 Seguridad en Producción

### 6.7.1 Checklist de Seguridad

| Control | Estado | Configuración |
|---------|--------|---------------|
| HTTPS obligatorio | `SECURE_SSL_REDIRECT=True` | Nginx redirect 80→443 |
| HSTS | `SECURE_HSTS_SECONDS=31536000` | 1 año, incluye subdominios |
| Cookies HttpOnly | `SESSION_COOKIE_HTTPONLY=True` | Previene XSS sobre tokens |
| Cookies Secure | `SESSION_COOKIE_SECURE=True` | Solo envía por HTTPS |
| CSRF HttpOnly | `CSRF_COOKIE_HTTPONLY=True` | Token CSRF protegido |
| X-Frame-Options | `X_FRAME_OPTIONS='DENY'` | Previene clickjacking |
| Content-Type sniffing | `SECURE_CONTENT_TYPE_NOSNIFF=True` | Previene MIME sniffing |
| Rate limiting | 200 req/min auth, 30/min anon | Previene fuerza bruta |
| Login rate limit | 5 intentos/minuto | Previene fuerza bruta login |
| JWT corto | Access 15 min, Refresh 1 día | Reduce ventana de ataque |
| Token rotation | `ROTATE_REFRESH_TOKENS=True` | Invalida tokens anteriores |
| Password mínimo | 12 caracteres | Política de contraseñas |
| Admin URL oculta | `/mgmt-panel/` (no `/admin/`) | Reduce escaneo automático |
| API docs protegida | Solo admin autenticado | `/api/docs/` requiere staff |
| DEBUG desactivado | `DEBUG=False` | Sin información sensible |
| SECRET_KEY segura | Variable de entorno | No hardcodeada |
| DB con SSL | `sslmode=require` | Conexión cifrada a PostgreSQL |

### 6.7.2 Firewall

```bash
# Permitir solo puertos necesarios
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (redirect)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## 6.8 Escalabilidad

### Horizontal (futuro)
- **Gunicorn:** Aumentar workers según CPU disponible (`2 × cores + 1`)
- **Celery:** Agregar workers adicionales para mayor concurrencia
- **Redis:** Migrar a Redis Cluster o DigitalOcean Managed Redis
- **Base de datos:** PostgreSQL replica de lectura para queries pesadas
- **Frontend:** CDN (Cloudflare) para assets estáticos

### Vertical (inmediato)
- Aumentar RAM y CPU del Droplet según carga
- Optimizar queries con `select_related` / `prefetch_related` en Django
- Usar índices de base de datos (ya configurados en modelos)

## 6.9 Variables de Entorno — Referencia Completa

| Variable | Requerida | Ejemplo | Descripción |
|----------|-----------|---------|-------------|
| `SECRET_KEY` | Sí | `django-insecure-xxx...` | Clave secreta Django (50+ chars) |
| `DJANGO_SETTINGS_MODULE` | Sí | `config.settings.production` | Módulo de settings |
| `DJANGO_ENV` | No | `production` | Guarda para settings de desarrollo |
| `DEBUG` | No | `False` | Modo debug (nunca True en prod) |
| `ALLOWED_HOSTS` | Sí | `syspcc.pcc.com.pe` | Hosts permitidos |
| `DB_ENGINE` | Sí | `django.db.backends.postgresql` | Motor de BD |
| `DB_NAME` | Sí | `syspcclog` | Nombre de la BD |
| `DB_USER` | Sí | `doadmin` | Usuario de BD |
| `DB_PASSWORD` | Sí | `***` | Contraseña de BD |
| `DB_HOST` | Sí | `db-xxx.ondigitalocean.com` | Host de BD |
| `DB_PORT` | No | `25060` | Puerto de BD |
| `REDIS_URL` | No | `redis://localhost:6379/0` | URL Redis cache |
| `CELERY_BROKER_URL` | No | `redis://localhost:6379/1` | URL broker Celery |
| `CELERY_RESULT_BACKEND` | No | `redis://localhost:6379/2` | URL results Celery |
| `CORS_ALLOWED_ORIGINS` | Sí | `https://syspcc.pcc.com.pe` | Orígenes CORS |
| `EMAIL_HOST` | No | `smtp.office365.com` | Servidor SMTP |
| `EMAIL_PORT` | No | `587` | Puerto SMTP |
| `EMAIL_HOST_USER` | No | `sistemas@pcc.com.pe` | Usuario email |
| `EMAIL_HOST_PASSWORD` | No | `***` | Contraseña email |
| `DEFAULT_FROM_EMAIL` | No | `sistemas@pcc.com.pe` | Email remitente |
| `SECURE_SSL_REDIRECT` | No | `True` | Forzar HTTPS |

---

*Documento generado para SYSPCC v1.0 — PCC Ingeniería y Construcción*
*Última actualización: Abril 2026*
