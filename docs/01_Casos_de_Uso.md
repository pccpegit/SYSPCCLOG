# SYSPCC — Diagramas de Casos de Uso

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.1 | **Fecha:** Octubre 2026 | **Empresa:** PCC Ingeniería y Construcción

---

## 1. Diagrama General — Todos los Módulos

```mermaid
graph TB
    subgraph Actores
        REQ[👤 Solicitante<br/>REQUESTER]
        PR[👤 Residente de Proyecto<br/>PROJECT_RESIDENT]
        PC[👤 Control de Proyecto<br/>PROJECT_CONTROL]
        GM[👤 Gerente General<br/>GENERAL_MANAGER]
        LC[👤 Coordinador Logístico<br/>LOGISTICS_COORDINATOR]
        CW[👤 Almacén Central<br/>CENTRAL_WAREHOUSE]
        SW[👤 Almacén de Obra<br/>SITE_WAREHOUSE]
        DS[👤 Jefe Directo<br/>DIRECT_SUPERVISOR]
        AM[👤 Gerente Administrativo<br/>ADMIN_MANAGER]
        LS[👤 Supervisor Logístico<br/>LOGISTICS_SUPERVISOR]
        LCH[👤 Jefe Logístico<br/>LOGISTICS_CHIEF]
        PJ[👤 Gestor de Pasajes<br/>PASAJES_MANAGER]
        HRM[👤 Gestor de RR. HH.<br/>HR_MANAGER]
        SU[👤 Superadministrador<br/>is_superuser]
        TI[👤 Soporte TI<br/>is_staff]
        USR[👤 Cualquier usuario<br/>autenticado]
    end

    subgraph "Módulo RQ"
        UC1((Crear RQ))
        UC2((Enviar RQ))
        UC3((Aprobar/Rechazar))
        UC4((Gestionar Cotizaciones))
        UC5((Generar OC))
        UC6((Control de Calidad))
        UC7((Conformidad y Cierre))
        UC23((Vincular ítems<br/>al catálogo))
    end

    subgraph "Módulo Almacén"
        UC8((Registrar Ingreso))
        UC9((Registrar Egreso<br/>o Entrega con vale))
        UC10((Consultar Kardex y<br/>Resumen de Movimiento))
        UC11((Transferencia interna<br/>entre pisos))
        UC16((Importar Excel<br/>de inventario))
        UC17((Asignar Ubicación))
    end

    subgraph "Módulo Admin — Pasajes"
        UC12((Gestionar Pasajes))
        UC13((Configurar Políticas))
    end

    subgraph "Módulo Soporte"
        UC14((Crear Ticket))
        UC15((Gestionar Ticket))
    end

    subgraph "Módulo RR. HH."
        UC18((Gestionar Plantillas))
        UC19((Emitir Contrato))
        UC20((Analizar CVs))
    end

    subgraph "Administración del Sistema"
        UC21((Gestionar Usuarios<br/>y Roles))
        UC22((Gestionar Proyectos))
    end

    REQ --> UC1
    REQ --> UC2
    REQ --> UC7
    USR --> UC14
    PR --> UC3
    PC --> UC3
    GM --> UC3
    DS --> UC3
    AM --> UC3
    LC --> UC4
    LC --> UC5
    LC --> UC6
    LC --> UC7
    LC --> UC23
    LS --> UC4
    LS --> UC5
    LS --> UC6
    LS --> UC7
    LS --> UC23
    LCH --> UC4
    LCH --> UC23
    CW --> UC8
    CW --> UC9
    CW --> UC10
    CW --> UC11
    CW --> UC16
    CW --> UC17
    SW --> UC8
    SW --> UC9
    SW --> UC10
    SW --> UC11
    LCH --> UC16
    LCH --> UC17
    LC --> UC10
    LS --> UC10
    LCH --> UC10
    AM --> UC12
    AM --> UC13
    GM --> UC12
    GM --> UC13
    PJ --> UC12
    PJ --> UC13
    TI --> UC15
    HRM --> UC18
    HRM --> UC19
    HRM --> UC20
    GM -.->|solo lectura| UC19
    GM -.->|solo lectura| UC20
    SU --> UC21
    SU --> UC22
```

> **Nota sobre el acceso.** Un Solicitante crea RQ, pero el backend permite crearlos a cualquier usuario autenticado; la conformidad final sí exige el rol `REQUESTER`. El módulo Almacén y sus pantallas se limitan a los cinco roles de almacén y logística; los matices por acción (quién importa, quién asigna ubicaciones, quién entrega a trabajadores) están en la matriz de la sección 7.

---

## 2. Casos de Uso — Módulo de Requerimientos (RQ)

### 2.1 Diagrama de Casos de Uso del Módulo RQ

```mermaid
graph LR
    REQ[👤 Solicitante]
    PR[👤 Residente<br/>de Proyecto]
    PC[👤 Control<br/>de Proyecto]
    GM[👤 Gerente<br/>General]
    DS[👤 Jefe<br/>Directo]
    AM[👤 Gerente<br/>Administrativo]
    LC[👤 Coordinador<br/>Logístico]
    LS[👤 Supervisor<br/>Logístico]
    LCH[👤 Jefe<br/>Logístico]
    CW[👤 Almacén<br/>Central]
    SW[👤 Almacén<br/>de Obra]

    subgraph "FASE 1 — Solicitud"
        CU01((CU-01<br/>Crear RQ))
        CU02((CU-02<br/>Enviar RQ))
        CU01C((CU-01C<br/>Elegir producto<br/>del catálogo))
        CU01E((CU-01E<br/>Exportar a<br/>Excel))
    end

    subgraph "FASE 2 — Validación"
        CU03((CU-03<br/>Validación<br/>Técnica))
        CU04((CU-04<br/>Clasificación<br/>Presupuestal))
        CU05((CU-05<br/>Validación<br/>Administrativa))
        CU06((CU-06<br/>Aprobación<br/>Gerencia))
    end

    subgraph "FASE 3 — Logística y Compras"
        CU07((CU-07<br/>Verificar<br/>Stock))
        CU42((CU-42<br/>Vincular ítems<br/>y ver disponibilidad))
        CU08((CU-08<br/>Gestionar<br/>Cotizaciones))
        CU41((CU-41<br/>Aprobar costo<br/>o sobrecosto))
        CU09((CU-09<br/>Generar<br/>Orden Compra))
    end

    subgraph "FASE 4 — Recepción y Entrega"
        CU10((CU-10<br/>Recepción y<br/>Control Calidad))
        CU11((CU-11<br/>Despacho y<br/>Entrega))
        CU40((CU-40<br/>Reclamo a<br/>Proveedor))
    end

    subgraph "FASE 5 — Conformidad"
        CU12((CU-12<br/>Conformidad<br/>del Usuario))
        CU13((CU-13<br/>Cierre de RQ))
    end

    subgraph "Universal"
        CU14((CU-14<br/>Cancelar RQ))
    end

    REQ --> CU01
    REQ --> CU02
    CU01 -.->|include| CU01C
    CU01 -.->|extend| CU01E
    REQ --> CU12
    REQ --> CU14

    PR --> CU03
    PC --> CU04
    DS --> CU05
    AM --> CU05
    GM --> CU06

    LC --> CU07
    LC --> CU42
    LC --> CU08
    LC --> CU09
    LS --> CU07
    LS --> CU42
    LS --> CU08
    LS --> CU09
    LCH --> CU08
    LCH --> CU42
    PC --> CU41
    AM --> CU41
    GM --> CU41

    LC --> CU10
    LC --> CU11
    LC --> CU40
    LS --> CU10
    LS --> CU11
    LS --> CU40
    CW --> CU11
    SW --> CU11

    LC --> CU13
    LS --> CU13
```

### 2.2 Especificación Detallada de Casos de Uso

La acción que se envía al motor del flujo es siempre un valor de `ApprovalActionChoices` (por ejemplo `TECHNICAL_APPROVED`), junto con el rol con el que actúa el usuario (`acting_role`). El cuerpo de `POST /requests/{id}/action/` es:

```json
{ "action": "TECHNICAL_APPROVED", "acting_role": "PROJECT_RESIDENT", "comments": "...", "extra_data": {} }
```

`extra_data` solo admite las claves `classification`, `within_plan`, `has_stock` y `within_budget`.

#### CU-01: Crear Requerimiento

```mermaid
sequenceDiagram
    actor REQ as Solicitante
    participant UI as Frontend React
    participant API as Django REST API
    participant DB as Base de datos

    REQ->>UI: Accede a "Nuevo Requerimiento"
    UI->>API: GET /projects/ y GET /departments/
    API-->>UI: Proyectos y departamentos
    UI-->>REQ: Formulario con el formato oficial del RQ

    REQ->>UI: Completa la cabecera
    Note over REQ,UI: Área (OP/QC/HSE/ADM), frente, servicio,<br/>uso específico, fecha de entrega, tipo de pedido

    loop Por cada ítem
        REQ->>UI: Busca un producto
        UI->>API: GET /request-catalog/?search=...
        API-->>UI: Hasta 20 productos con código, unidad y disponible
        alt Producto del catálogo
            REQ->>UI: Elige el producto, la cantidad y la fuente
        else Fuera de catálogo
            REQ->>UI: Marca "fuera de catálogo" y describe el ítem
        end
    end

    REQ->>UI: Click "Enviar Requerimiento"
    UI->>API: POST /requests/ {flow, requesting_area, project o department, items}
    API->>API: RQNumberGenerator.generate()
    Note over API: RQ-2026-0042
    API->>DB: INSERT Request (SUBMITTED) + RequestItems + Approval
    DB-->>API: OK
    API-->>UI: 201 {rq_number: "RQ-2026-0042", status: "SUBMITTED"}
    UI->>UI: exportRQToExcel() rellena FORMATO RQ.xlsx
    UI-->>REQ: RQ registrado y Excel descargado
```

| Campo | Detalle |
|-------|---------|
| **ID** | CU-01 |
| **Nombre** | Crear Requerimiento |
| **Actor principal** | Solicitante (REQUESTER) |
| **Precondición** | Usuario autenticado con acceso al módulo `/rq` |
| **Flujo principal** | 1. Selecciona el destino: un proyecto (flujo Operaciones) o un departamento / Oficina Central (flujo Administrativo)<br>2. Completa área solicitante, frente, servicio, uso específico, fecha de entrega y tipo de pedido<br>3. Agrega ítems: elige un producto del catálogo del almacén o marca "fuera de catálogo", indica cantidad, unidad y fuente (EPP, herramientas, materiales, ...)<br>4. Envía el requerimiento |
| **Extensión** | E1 (CU-01E): descarga el Excel oficial `FORMATO RQ.xlsx` rellenado con ExcelJS (botón "Descargar Excel" o al enviar). "Enviar sin Excel" registra el RQ sin descargarlo |
| **Inclusión** | CU-01C: la búsqueda en el catálogo (`GET /request-catalog/`) está abierta a todo usuario autenticado, devuelve como máximo 20 filas y exige al menos 2 caracteres |
| **Postcondición** | RQ creado con número auto-generado (RQ-YYYY-NNNN) y estado SUBMITTED; el producto elegido es solo una **propuesta** que Logística confirma después |
| **Reglas de negocio** | - El número RQ lo genera el servidor, es secuencial por año y se ignora cualquier valor enviado por el cliente<br>- El área solicitante (OP, QC, HSE, ADM) es obligatoria al crear<br>- Flujo Operaciones exige proyecto; flujo Administrativo exige departamento; el frente "Oficina Central" siempre va por el flujo Administrativo<br>- La cantidad de cada ítem debe ser mayor que cero; de 1 a 200 ítems por RQ<br>- `total_price` de cada ítem se calcula como `quantity × unit_price` cuando hay precio unitario<br>- El Excel **no se sube**: el formato se rellena en el navegador a partir del formulario |

---

#### CU-02: Enviar Requerimiento

```mermaid
sequenceDiagram
    actor REQ as Solicitante
    participant UI as Frontend
    participant API as Django API
    participant DB as Base de datos

    REQ->>UI: Revisa la cabecera y los ítems
    REQ->>UI: Click "Enviar Requerimiento" (o "Enviar sin Excel")
    UI->>API: POST /requests/
    API->>DB: INSERT Request con status = SUBMITTED
    API->>DB: INSERT Approval {previous: DRAFT, new: SUBMITTED}
    API-->>UI: 201 {status: "SUBMITTED"}
    UI-->>REQ: RQ enviado a validación
    Note over DB: El RQ queda en la bandeja del primer aprobador
```

| Campo | Detalle |
|-------|---------|
| **ID** | CU-02 |
| **Nombre** | Enviar Requerimiento |
| **Actor principal** | Solicitante (REQUESTER) |
| **Precondición** | Cabecera completa y al menos un ítem válido |
| **Flujo principal** | 1. Pulsa "Enviar Requerimiento" o "Enviar sin Excel"<br>2. El backend crea el RQ ya en estado SUBMITTED y registra la aprobación `DRAFT → SUBMITTED` |
| **Postcondición** | RQ en estado SUBMITTED: aparece en la bandeja de Aprobaciones del Residente (Operaciones) o del Jefe Directo (Administrativo) |
| **Observaciones** | - La interfaz actual no deja borradores editables: ambos botones envían el RQ a validación<br>- El estado DRAFT y la acción `SUBMITTED` (DRAFT → SUBMITTED, rol REQUESTER) siguen definidos en la tabla de transiciones del motor<br>- La creación no dispara notificaciones; las notificaciones nacen de las transiciones posteriores |

---

#### CU-03: Validación Técnica (Flujo Operaciones)

```mermaid
sequenceDiagram
    actor PR as Residente de Proyecto
    participant UI as Frontend
    participant API as Django API
    participant WF as WorkflowEngine
    participant DB as Base de datos

    PR->>UI: Accede a "Aprobaciones"
    UI->>API: GET /requests/?status=SUBMITTED&flow=OPERATIONS
    API-->>UI: Lista de RQ pendientes
    PR->>UI: Abre el RQ (TechReviewPage)

    UI->>API: GET /requests/{id}/
    API-->>UI: Detalle completo del RQ
    UI->>API: GET /requests/{id}/available-actions/
    API->>WF: get_available_actions()
    WF-->>API: TECHNICAL_APPROVED, TECHNICAL_REJECTED
    API-->>UI: available_actions

    alt Aprueba
        PR->>UI: Click "Aprobar" + comentarios
        UI->>API: POST /requests/{id}/action/ {action: "TECHNICAL_APPROVED", acting_role: "PROJECT_RESIDENT"}
        API->>WF: execute("TECHNICAL_APPROVED")
        WF->>DB: UPDATE status = 'TECHNICAL_APPROVED'
        WF->>DB: INSERT Approval + ActivityLog
        API-->>UI: Aprobación registrada
    else Rechaza
        PR->>UI: Click "Rechazar" + motivo
        UI->>API: POST /requests/{id}/action/ {action: "TECHNICAL_REJECTED", acting_role: "PROJECT_RESIDENT"}
        API->>WF: execute("TECHNICAL_REJECTED")
        WF->>DB: UPDATE status = 'TECHNICAL_REJECTED'
        WF->>DB: INSERT Approval + ActivityLog
        API-->>UI: Rechazo registrado
    end
```

| Campo | Detalle |
|-------|---------|
| **ID** | CU-03 |
| **Nombre** | Validación Técnica |
| **Actor principal** | Residente de Proyecto (PROJECT_RESIDENT) |
| **Precondición** | RQ en estado SUBMITTED, flujo OPERATIONS |
| **Flujo principal** | 1. Ve la lista de RQ pendientes<br>2. Revisa ítems y especificaciones<br>3. Aprueba (`TECHNICAL_APPROVED`) → TECHNICAL_APPROVED<br>4. O rechaza con comentarios (`TECHNICAL_REJECTED`) → TECHNICAL_REJECTED |
| **Postcondición** | RQ aprobado técnicamente o rechazado (estado final) |

---

#### CU-04: Clasificación Presupuestal

```mermaid
sequenceDiagram
    actor PC as Control de Proyecto
    participant UI as Frontend
    participant API as Django API
    participant WF as WorkflowEngine
    participant BV as BudgetValidator
    participant DB as Base de datos

    PC->>UI: Abre RQ en TECHNICAL_APPROVED (BudgetReviewPage)
    UI->>API: GET /project-budget-lines/?project={id}
    API-->>UI: Partidas presupuestales

    PC->>UI: Revisa costo estimado vs presupuesto disponible

    alt Dentro de Propuesta
        PC->>UI: Clasifica como "Dentro de Propuesta"
        UI->>API: POST /requests/{id}/action/ {action: "BUDGET_CLASSIFIED", extra_data: {classification: "BC_WITHIN_PROPOSAL"}}
        API->>WF: execute("BUDGET_CLASSIFIED")
        WF->>DB: UPDATE status = 'WITHIN_PROPOSAL'
        WF->>WF: _execute_system_chain()
        WF->>DB: UPDATE status = 'VALIDATED' (Approval con rol SYSTEM)
        WF->>BV: commit_budget(request) y cálculo de la fecha estimada
        API-->>UI: Validado automáticamente
    else Adicional
        PC->>UI: Clasifica como "Adicional"
        UI->>API: POST /requests/{id}/action/ {action: "BUDGET_CLASSIFIED", extra_data: {classification: "BC_ADDITIONAL"}}
        WF->>DB: UPDATE status = 'ADDITIONAL_REQ'
        Note over WF: Requiere aprobación del Residente<br/>y luego del Gerente General
        API-->>UI: Derivado a aprobación adicional
    else Rechaza
        PC->>UI: Rechaza la clasificación
        UI->>API: POST /requests/{id}/action/ {action: "BUDGET_REJECTED"}
        WF->>DB: UPDATE status = 'TECHNICAL_REJECTED'
        API-->>UI: Rechazado
    end
```

| Campo | Detalle |
|-------|---------|
| **ID** | CU-04 |
| **Nombre** | Clasificación Presupuestal |
| **Actor principal** | Control de Proyecto (PROJECT_CONTROL) |
| **Precondición** | RQ en estado TECHNICAL_APPROVED |
| **Flujo principal** | 1. Revisa el costo contra la partida presupuestal<br>2. `BUDGET_CLASSIFIED` con `BC_WITHIN_PROPOSAL`: WITHIN_PROPOSAL → VALIDATED (automático)<br>3. `BUDGET_CLASSIFIED` con `BC_ADDITIONAL`: ADDITIONAL_REQ → requiere `TECHNICAL_APPROVED` del Residente y luego aprobación del Gerente General |
| **Postcondición** | RQ validado o derivado a aprobación de gerencia |
| **Efectos al validar** | Al llegar a VALIDATED el motor calcula `fecha_estimada_entrega` (SLA según el tipo de adquisición) y compromete el costo estimado en la partida vinculada al RQ (`BudgetValidator.commit_budget`; no hace nada si el RQ no tiene partida). Si el compromiso falla, se registra una advertencia y la transición continúa |

---

#### CU-05: Validación Administrativa (Flujo Administrativo)

```mermaid
sequenceDiagram
    actor DS as Jefe Directo
    actor AM as Gerente Administrativo
    participant API as Django API
    participant WF as WorkflowEngine
    participant DB as Base de datos

    Note over DS,DB: Paso 1: Aprobación del Jefe Directo
    DS->>API: POST /requests/{id}/action/ {action: "SUPERVISOR_APPROVED", acting_role: "DIRECT_SUPERVISOR"}
    API->>WF: execute("SUPERVISOR_APPROVED")
    WF->>DB: UPDATE status = 'SUPERVISOR_APPROVED'
    WF->>DB: INSERT Approval

    Note over AM,DB: Paso 2: Revisión del Gerente Administrativo
    AM->>API: GET /requests/{id}/
    AM->>API: GET /annual-plan-lines/?annual_plan={id}

    alt Dentro del Plan Anual
        AM->>API: POST /requests/{id}/action/ {action: "ADMIN_BUDGET_REVIEWED", extra_data: {within_plan: true}}
        WF->>DB: UPDATE status = 'WITHIN_ANNUAL_PLAN'
        WF->>WF: _execute_system_chain()
        WF->>DB: UPDATE status = 'VALIDATED'
    else Fuera del Plan Anual
        AM->>API: POST /requests/{id}/action/ {action: "ADMIN_BUDGET_REVIEWED", extra_data: {within_plan: false}}
        WF->>DB: UPDATE status = 'OUT_OF_ANNUAL_PLAN'
        Note over WF: Requiere: Jefe Directo aprueba<br/>→ Gerente General aprueba → VALIDATED
    else Rechaza
        AM->>API: POST /requests/{id}/action/ {action: "ADMIN_BUDGET_REJECTED"}
        WF->>DB: UPDATE status = 'SUPERVISOR_REJECTED'
    end
```

| Campo | Detalle |
|-------|---------|
| **ID** | CU-05 |
| **Nombre** | Validación Administrativa |
| **Actores** | Jefe Directo (DIRECT_SUPERVISOR) y Gerente Administrativo (ADMIN_MANAGER) |
| **Precondición** | RQ en estado SUBMITTED, flujo ADMINISTRATIVE |
| **Flujo principal** | 1. El Jefe Directo aprueba (`SUPERVISOR_APPROVED`) o rechaza (`SUPERVISOR_REJECTED`)<br>2. El Gerente Administrativo revisa el presupuesto contra el Plan Anual (`ADMIN_BUDGET_REVIEWED`) o rechaza (`ADMIN_BUDGET_REJECTED`)<br>3. Dentro del plan → VALIDATED (automático); fuera del plan → el Jefe Directo evalúa la necesidad y, si aprueba, pasa a GM_REVIEW |
| **Postcondición** | RQ validado, en revisión de gerencia o rechazado |

---

#### CU-06: Aprobación de Gerencia General

| Campo | Detalle |
|-------|---------|
| **ID** | CU-06 |
| **Nombre** | Aprobación de Gerencia General |
| **Actor principal** | Gerente General (GENERAL_MANAGER) |
| **Precondición** | RQ en estado GM_REVIEW (adicional al presupuesto o fuera del plan anual) |
| **Flujo principal** | 1. Ve la lista de RQ pendientes de aprobación (ManagerApprovalPage)<br>2. Revisa justificación y montos<br>3. Aprueba (`GM_APPROVED`) → GM_APPROVED → VALIDATED (automático)<br>4. O rechaza (`GM_REJECTED`) → GM_REJECTED |
| **Postcondición** | RQ aprobado por gerencia o rechazado definitivamente |

---

#### CU-07 a CU-09: Logística y Compras

```mermaid
sequenceDiagram
    actor LC as Coordinador Logístico
    participant API as Django API
    participant WF as WorkflowEngine
    participant DB as Base de datos

    Note over LC,DB: CU-07 y CU-42: Verificación de stock
    LC->>API: GET /requests/{id}/stock-availability/
    API-->>LC: Solicitado vs. stock CENTRAL por ítem (cobertura)
    LC->>API: PATCH /requests/{id}/update-items/ (producto, fuera de catálogo, fuente, supply_source)
    API->>DB: Confirma el vínculo de cada ítem

    alt Todo se atiende con stock
        LC->>API: POST /requests/{id}/action/ {action: "STOCK_CHECKED", extra_data: {has_stock: true}}
        WF->>DB: UPDATE status = 'IN_STOCK'
        Note over WF: Pasa a despacho desde el almacén central
    else Requiere compra
        LC->>API: POST /requests/{id}/action/ {action: "STOCK_CHECKED", extra_data: {has_stock: false}}
        WF->>DB: UPDATE status = 'REQUIRES_PURCHASE'
    end

    Note over LC,DB: CU-08: Gestión de cotizaciones
    LC->>API: POST /requests/{id}/action/ {action: "QUOTE_REQUESTED"}
    WF->>DB: UPDATE status = 'QUOTING'

    loop Por cada proveedor
        LC->>API: POST /quotations/ {request, supplier, items, total_amount}
        API->>DB: INSERT Quotation + QuotationItems
    end

    LC->>API: POST /quotations/{id}/select/
    API->>DB: is_selected = true (y limpia las demás del mismo RQ)
    LC->>API: POST /requests/{id}/action/ {action: "QUOTE_COMPARED"}
    WF->>DB: UPDATE status = 'QUOTE_COMPARISON'
    LC->>API: POST /requests/{id}/action/ {action: "QUOTE_SELECTED"}
    WF->>DB: UPDATE status = 'QUOTE_SELECTED'

    Note over LC,DB: CU-41: Aprobación del costo (Control de Proyecto o Gerente Administrativo)
    alt Costo dentro de presupuesto
        API->>WF: action "QUOTE_COST_APPROVED"
        WF->>DB: UPDATE status = 'QUOTE_COST_APPROVED'
    else Costo excede presupuesto
        API->>WF: action "QUOTE_COST_REJECTED"
        WF->>DB: UPDATE status = 'COST_OVERRUN_REVIEW'
        Note over WF: El Gerente General decide<br/>COST_OVERRUN_APPROVED o COST_OVERRUN_REJECTED
    end

    Note over LC,DB: CU-09: Generar Orden de Compra
    LC->>API: POST /requests/{id}/action/ {action: "PO_GENERATED"}
    WF->>DB: UPDATE status = 'PO_GENERATED'
```

**Observaciones sobre la Orden de Compra.** La acción `PO_GENERATED` solo registra la transición del flujo; la pantalla de logística no crea el registro formal de OC. El endpoint `POST /purchase-orders/` existe (numera `OC-YYYY-NNNN` con `PONumberGenerator` y exige un rol de logística), pero el SPA actual no lo invoca. La verificación de stock del flujo Administrativo la hace el Supervisor Logístico (`LOGISTICS_SUPERVISOR`) y la comparación y selección de cotizaciones el Jefe Logístico (`LOGISTICS_CHIEF`); en Operaciones todo lo realiza el Coordinador Logístico. La aprobación del costo la da Control de Proyecto (Operaciones) o el Gerente Administrativo (Administrativo).

---

#### CU-10 y CU-11: Recepción y Entrega

```mermaid
sequenceDiagram
    actor LC as Coordinador Logístico
    actor CW as Almacén Central
    actor SW as Almacén de Obra
    participant API as Django API
    participant WF as WorkflowEngine
    participant WH as Servicios de almacén
    participant DB as Base de datos

    Note over LC,DB: CU-10: Recepción y Control de Calidad
    LC->>API: POST /requests/{id}/action/ {action: "RECEIVED"}
    WF->>DB: UPDATE status = 'RECEIVING'
    WF->>WH: register_entry_batch() y WarehouseReceipt
    Note over WF,WH: Efecto lateral best-effort: un fallo<br/>se registra como advertencia y no revierte el flujo

    alt QC Aprobado
        LC->>API: action "QUALITY_APPROVED"
        WF->>DB: UPDATE status = 'QUALITY_APPROVED'
    else QC Rechazado
        LC->>API: action "QUALITY_REJECTED"
        WF->>DB: UPDATE status = 'QUALITY_REJECTED'

        Note over LC,DB: Ciclo de Reclamo al Proveedor (CU-40)
        LC->>API: action "SUPPLIER_CLAIM_SENT"
        WF->>DB: UPDATE status = 'SUPPLIER_CLAIM_SENT'
        LC->>API: action "SUPPLIER_CLAIM_UPDATED"
        WF->>DB: UPDATE status = 'SUPPLIER_CLAIM_PENDING'
        LC->>API: action "SUPPLIER_REPLACEMENT_RECEIVED"
        WF->>DB: UPDATE status = 'SUPPLIER_REPLACEMENT_RECEIVED'
        Note over WF: Vuelve a control de calidad
    end

    Note over CW,DB: CU-11: Despacho y Entrega
    CW->>API: POST /requests/{id}/action/ {action: "DISPATCHED"}
    WF->>DB: UPDATE status = 'DISPATCHED_TO_SITE'
    WF->>WH: register_exit_batch() y WarehouseDispatch

    SW->>API: POST /requests/{id}/action/ {action: "WAREHOUSE_RECORDS_UPDATED"}
    WF->>DB: UPDATE status = 'DELIVERED'
```

**Diferencias del flujo Administrativo.** El despacho desde stock (`IN_STOCK`) lo hace el Almacén Central y lleva el RQ directo a DELIVERED; después de `QUALITY_APPROVED` despacha el Supervisor Logístico; el paso `DISPATCHED_TO_SITE → DELIVERED` lo hace el Almacén Central; y `DELIVERED → WAREHOUSE_UPDATED` (acción `WAREHOUSE_RECORDS_UPDATED`, Almacén Central) antecede a la conformidad del usuario. Los estados, roles y transiciones están definidos por gerencia en el workflow y no se modifican.

---

#### CU-12 y CU-13: Conformidad y Cierre

```mermaid
sequenceDiagram
    actor REQ as Solicitante
    actor LC as Coordinador Logístico
    participant API as Django API
    participant WF as WorkflowEngine
    participant DB as Base de datos

    Note over REQ,DB: CU-12: Conformidad del Usuario
    REQ->>API: GET /requests/{id}/
    Note over REQ: Revisa los materiales entregados

    alt Conforme
        REQ->>API: POST /requests/{id}/action/ {action: "USER_CONFIRMED", acting_role: "REQUESTER"}
        WF->>DB: UPDATE status = 'USER_CONFORMITY'
    else Reclamo
        REQ->>API: POST /requests/{id}/action/ {action: "USER_CLAIMED", acting_role: "REQUESTER"}
        WF->>DB: UPDATE status = 'CLAIM_IN_REVIEW'
        Note over WF: Logística envía el reclamo<br/>(SUPPLIER_CLAIM_SENT) y reinicia el ciclo
    end

    Note over LC,DB: CU-13: Cierre de RQ
    LC->>API: POST /requests/{id}/action/ {action: "CLOSED"}
    WF->>DB: UPDATE status = 'CLOSED'
    Note over DB: Estado terminal.<br/>RQ completamente cerrado.
```

En el flujo Administrativo la conformidad parte de `WAREHOUSE_UPDATED`, y el cierre lo hace el Supervisor Logístico.

---

#### CU-14: Cancelar RQ

| Campo | Detalle |
|-------|---------|
| **ID** | CU-14 |
| **Nombre** | Cancelar Requerimiento |
| **Actor principal** | Usuario con acceso al RQ y un rol asignado |
| **Precondición** | RQ en cualquier estado no terminal |
| **Flujo principal** | 1. Ejecuta la acción `CANCELLED` en `POST /requests/{id}/action/`<br>2. El motor pasa el RQ a CANCELLED e intenta liberar el presupuesto comprometido en la partida vinculada (si la tiene) |
| **Observaciones** | La tabla de transiciones define `CANCELLED` con `required_role = None`: el motor no exige un rol concreto, solo que el usuario posea el `acting_role` declarado y que el RQ esté dentro de su alcance de visibilidad |

---

#### CU-40: Reclamo a Proveedor

| Campo | Detalle |
|-------|---------|
| **ID** | CU-40 |
| **Nombre** | Reclamo a Proveedor |
| **Actores** | Coordinador Logístico (Operaciones) o Supervisor Logístico (Administrativo) |
| **Precondición** | RQ en QUALITY_REJECTED, o en CLAIM_IN_REVIEW tras un reclamo del solicitante |
| **Flujo principal** | 1. `SUPPLIER_CLAIM_SENT` → SUPPLIER_CLAIM_SENT<br>2. (Operaciones) `SUPPLIER_CLAIM_UPDATED` → SUPPLIER_CLAIM_PENDING<br>3. `SUPPLIER_REPLACEMENT_RECEIVED` → SUPPLIER_REPLACEMENT_RECEIVED (también directo desde el paso 1)<br>4. Nuevo control de calidad: `QUALITY_APPROVED` o `QUALITY_REJECTED` |
| **Observaciones** | El ciclo se registra con las acciones del flujo. El modelo `Claim` y el endpoint `/claims/` existen, pero ni el SPA ni el motor crean registros `Claim` hoy |

---

#### CU-41: Aprobar Costo de la Cotización o Sobrecosto

| Campo | Detalle |
|-------|---------|
| **ID** | CU-41 |
| **Nombre** | Aprobar costo de la cotización / sobrecosto |
| **Actores** | Control de Proyecto (Operaciones), Gerente Administrativo (Administrativo) y Gerente General (sobrecosto) |
| **Precondición** | RQ en QUOTE_SELECTED (costo) o COST_OVERRUN_REVIEW (sobrecosto) |
| **Flujo principal** | 1. Control de Proyecto o Gerente Administrativo ejecuta `QUOTE_COST_APPROVED` (→ QUOTE_COST_APPROVED) o `QUOTE_COST_REJECTED` (→ COST_OVERRUN_REVIEW)<br>2. El Gerente General ejecuta `COST_OVERRUN_APPROVED` (→ COST_OVERRUN_APPROVED, luego OC) o `COST_OVERRUN_REJECTED` (→ COST_OVERRUN_REJECTED, estado final) |
| **Pantallas** | QuoteCostReviewPage y CostOverrunReviewPage |

---

#### CU-42: Vincular Ítems al Catálogo y Revisar Disponibilidad

```mermaid
sequenceDiagram
    actor LG as Logística
    participant UI as LogisticsActionPage
    participant API as Django API
    participant SVC as Servicios de RQ
    participant DB as Base de datos

    LG->>UI: Abre un RQ en VALIDATED
    UI->>API: GET /requests/{id}/stock-availability/
    API->>SVC: build_stock_availability(request)
    SVC->>DB: Stock CENTRAL menos lo comprometido en otros RQ
    API-->>UI: Por ítem: solicitado, disponible neto y cobertura (FULL, PARTIAL, NONE, NOT_COMPARABLE)

    LG->>UI: Confirma producto, fuera de catálogo, fuente y origen
    UI->>API: PATCH /requests/{id}/update-items/
    API->>SVC: update_request_items() bajo bloqueo
    alt RQ terminal, fuera de ventana editable o ítem ya despachado o recibido
        API-->>UI: 409 con code e item_ids (no se escribe nada)
    else Cambios válidos
        API->>DB: Guarda y sella confirmación (quién y cuándo)
        API-->>UI: updated_item_ids, unchanged_item_ids, ignored_item_ids
    end

    LG->>UI: Confirma la verificación
    UI->>API: POST /requests/{id}/action/ {action: "STOCK_CHECKED"}
```

| Campo | Detalle |
|-------|---------|
| **ID** | CU-42 |
| **Nombre** | Vincular ítems al catálogo y revisar disponibilidad |
| **Actores** | Coordinador, Supervisor o Jefe Logístico |
| **Precondición** | RQ validado (la ventana editable va desde VALIDATED hasta antes del despacho) |
| **Reglas de negocio** | - Un ítem se vincula a un producto del catálogo **o** se marca fuera de catálogo; nunca ambos<br>- La disponibilidad es informativa y mira el pool CENTRAL; si las unidades difieren, la cobertura es NOT_COMPARABLE (no hay conversión)<br>- La confirmación de Logística es la que cuenta para mover stock; un producto propuesto por el solicitante no basta<br>- Un ítem marcado fuera de catálogo nunca mueve stock |

---

## 3. Casos de Uso — Módulo de Almacén

### 3.1 Diagrama de Casos de Uso

```mermaid
graph LR
    CW[👤 Almacén Central<br/>CENTRAL_WAREHOUSE]
    SW[👤 Almacén de Obra<br/>SITE_WAREHOUSE]
    LG[👤 Logística<br/>LC · LS · LCH]
    LCH[👤 Jefe Logístico<br/>LOGISTICS_CHIEF]

    subgraph "Fases 01 y 02 — Recepción y Control"
        CU15((CU-15<br/>Registrar<br/>Ingreso))
    end

    subgraph "Fase 03 — Almacenamiento"
        CU17((CU-17<br/>Asignar<br/>Ubicación))
        CU44((CU-44<br/>Importar Excel<br/>de inventario))
    end

    subgraph "Fases 04 a 06 — Entrega y Despacho"
        CU18((CU-18<br/>Atender RQ<br/>pendiente))
        CU19((CU-19<br/>Registrar Egreso<br/>o Entrega))
        CU43((CU-43<br/>Entregar EPP<br/>con vale))
        CU22((CU-22<br/>Transferencia<br/>entre pisos))
        CU20((CU-20<br/>Imprimir<br/>Vale))
    end

    subgraph "Consultas"
        CU21((CU-21<br/>Consultar<br/>Kardex))
        CU45((CU-45<br/>Resumen de<br/>movimiento))
        CU23((CU-23<br/>Exportar<br/>Inventario))
        CU46((CU-46<br/>Vincular destinos<br/>con trabajadores))
    end

    CW --> CU15
    CW --> CU17
    CW --> CU44
    CW --> CU18
    CW --> CU19
    CW --> CU43
    CW --> CU22
    CW --> CU20
    CW --> CU21
    CW --> CU45
    CW --> CU23
    CW --> CU46

    SW --> CU15
    SW --> CU18
    SW --> CU19
    SW --> CU43
    SW --> CU22
    SW --> CU20
    SW --> CU21
    SW --> CU45
    SW --> CU23

    LG --> CU15
    LG --> CU18
    LG --> CU19
    LG --> CU20
    LG --> CU21
    LG --> CU45
    LG --> CU23

    LCH --> CU17
    LCH --> CU44
    LCH --> CU46
```

> **Notas.** CU-16 (inspección y validación) quedó absorbido por CU-15 y por el control de calidad del RQ (CU-10). Los roles de almacén de obra solo operan el almacén `SITE`; las entregas a trabajadores o a otro piso (CU-43 y CU-22) son exclusivas del Almacén Central y el Almacén de Obra. Ningún permiso del módulo concede acceso por ser superusuario.

### 3.2 Secuencia: Registrar Ingreso de Mercadería (CU-15)

```mermaid
sequenceDiagram
    actor CW as Almacén Central
    participant UI as Frontend React
    participant API as Warehouse API
    participant DB as Base de datos

    CW->>UI: Accede a "Ingreso de Material"
    UI->>API: GET /warehouse/inventory/?no_page=true
    API-->>UI: Catálogo de productos

    CW->>UI: Completa fecha, almacén, origen y documentos
    Note over CW,UI: Origen (compra, devolución, carga inicial, ...)<br/>Proveedor, PO/OC, guía de remisión, factura,<br/>TAG por línea, observación

    alt Un solo ítem
        UI->>API: POST /warehouse/movements/entry/
    else Varios ítems (un vale)
        UI->>API: POST /warehouse/movements/batch-entry/
        Note over API: Crea un MovementGroup<br/>+ N InventoryMovement
    end

    API->>API: Verifica el alcance del rol sobre el almacén
    API->>DB: INSERT MovementGroup
    API->>DB: INSERT InventoryMovement (por cada ítem)
    API->>DB: UPDATE InventoryStock SET quantity += ingreso
    API-->>UI: {group_number: "ENT-2026-G0042"}
    UI-->>CW: Ingreso registrado
```

El número de movimiento sigue el formato `ENT-AAAA-NNNN` y el del grupo (vale interno) `ENT-AAAA-GNNNN`. Los ingresos de RQ por compra se registran solos cuando el flujo ejecuta la acción `RECEIVED`.

### 3.3 Secuencia: Registrar Egreso y Entrega con Vale (CU-19 y CU-43)

```mermaid
sequenceDiagram
    actor CW as Almacén Central
    participant UI as Frontend React
    participant API as Warehouse API
    participant DB as Base de datos

    CW->>UI: Accede a "Entrega / Egreso de material"
    UI->>API: GET /warehouse/inventory/?no_page=true
    API-->>UI: Inventario con stock por almacén

    CW->>UI: Elige modo, fecha, almacén y N° de vale físico
    Note over CW,UI: Modos: entrega a trabajador (EPP),<br/>proyecto / obra, departamento o ajuste

    alt Entrega de EPP a un trabajador con vale
        UI->>API: POST /warehouse/movements/epp-delivery/
        Note over API: Exige N° de vale y fecha,<br/>409 voucher_number_exists si se repite
    else Otro egreso
        UI->>API: POST /warehouse/movements/batch-exit/
    end

    API->>API: Valida alcance del rol y stock suficiente
    API->>DB: INSERT MovementGroup (vale interno SAL-AAAA-GNNNN)
    API->>DB: INSERT InventoryMovement (EXIT, por ítem)
    API->>DB: UPDATE InventoryStock SET quantity -= egreso
    API-->>UI: Vale registrado
    Note over API,DB: La entrega de EPP nunca cambia el estado de un RQ

    CW->>UI: Click "Imprimir vale"
    UI->>API: GET /warehouse/movements/{id}/voucher/
    API-->>UI: Datos del vale (con todos los ítems del grupo)
    UI-->>CW: Vista de impresión (VoucherPrint)
```

El PDF del vale puede generarse con `GET /warehouse/movements/groups/{id}/pdf/`; si hay una cuenta de OneDrive conectada, una tarea de Celery sube el PDF y guarda el enlace.

### 3.4 Secuencia: Consultar Kardex y Resumen de Movimiento (CU-21 y CU-45)

```mermaid
sequenceDiagram
    actor CW as Usuario de almacén
    participant UI as Frontend React
    participant API as Warehouse API
    participant DB as Base de datos

    CW->>UI: Accede a "Inventario"
    UI->>API: GET /warehouse/inventory/?search=casco
    API-->>UI: Lista de productos filtrados
    CW->>UI: Selecciona un producto

    UI->>API: GET /warehouse/inventory/{id}/kardex/
    API->>DB: Movimientos del producto ordenados por fecha
    DB-->>API: Historial
    API-->>UI: Kardex del producto

    CW->>UI: Accede a "Resumen de movimiento"
    UI->>API: GET /warehouse/inventory/movement-summary/?date_from=...&date_to=...
    API-->>UI: Por ítem: INV. INICIAL, INGRESOS, EGRESOS y STOCK
    Note over UI: Misma lógica de su hoja de Excel,<br/>avisa si hay movimientos sin fecha<br/>o stock sin movimientos que lo respalden
```

### 3.5 Importar el Libro de Inventario (CU-44)

```mermaid
sequenceDiagram
    actor CW as Almacén Central o Jefe Logístico
    participant UI as ImportarPage
    participant API as Warehouse API
    participant DB as Base de datos

    CW->>UI: Sube el libro "INVENTARIO PCC - ALM" (.xlsx)
    UI->>API: POST /warehouse/imports/ (multipart)
    API->>API: Valida, parsea y planifica (sin escribir inventario)
    API->>DB: INSERT InventoryImport (PREVIEWED) con resumen y problemas
    API-->>UI: 201 Previsualización
    CW->>UI: Revisa problemas (GET /warehouse/imports/{id}/problems/)
    CW->>UI: Confirma
    UI->>API: POST /warehouse/imports/{id}/confirm/
    API->>DB: Aplica catálogo, ingresos y egresos
    API-->>UI: Resultado de la importación
```

| Campo | Detalle |
|-------|---------|
| **ID** | CU-44 |
| **Actores** | Almacén Central y Jefe Logístico (los cinco roles de almacén leen el historial) |
| **Reglas de negocio** | - Dos pasos: previsualizar y confirmar<br>- Una previsualización vence y una importación terminada borra el libro guardado (puede tener nombres de trabajadores); una tarea diaria lo hace<br>- El mismo archivo confirmado en el mismo almacén no se vuelve a aplicar<br>- Límite de importaciones por hora por usuario |

---

## 4. Casos de Uso — Módulo de Administración (Pasajes)

### 4.1 Diagrama de Casos de Uso

```mermaid
graph LR
    ADM[👤 Gestión de Pasajes<br/>ADMIN_MANAGER · GENERAL_MANAGER<br/>PASAJES_MANAGER]

    subgraph "Gestión de Pasajes"
        CU24((CU-24<br/>Registrar<br/>Pasaje))
        CU25((CU-25<br/>Calcular<br/>Devolución))
        CU26((CU-26<br/>Marcar<br/>Pagado))
        CU27((CU-27<br/>Exportar<br/>Pasajes))
    end

    subgraph "Configuración"
        CU28((CU-28<br/>Gestionar<br/>Políticas))
        CU29((CU-29<br/>Gestionar<br/>Proveedores))
    end

    ADM --> CU24
    ADM --> CU25
    ADM --> CU26
    ADM --> CU27
    ADM --> CU28
    ADM --> CU29
    CU24 -.->|include| CU25
```

### 4.2 Secuencia: Registrar Pasaje (CU-24)

```mermaid
sequenceDiagram
    actor ADM as Gestión de Pasajes
    participant UI as Frontend React
    participant API as Admin API
    participant DB as Base de datos

    ADM->>UI: Accede a "Pasajes"
    ADM->>UI: Click "Nuevo Pasaje"

    UI->>API: GET /administracion/proveedores-pasajes/
    API-->>UI: Lista de proveedores

    ADM->>UI: Completa el formulario
    Note over ADM,UI: Tipo (B/S/S-B), fechas,<br/>embarque/destino, DNI,<br/>proveedor, montos, moneda

    UI->>API: GET /personal/buscar-dni/?dni=...
    API-->>UI: Datos del trabajador (solo campos no sensibles)
    UI->>API: GET /administracion/pasajes/por-dni/?dni=...
    API-->>UI: Historial de pasajes de ese DNI
    UI->>API: POST /administracion/pasajes/
    API->>API: Pasaje.save()
    Note over API: Auto-calcula:<br/>mes a partir de la fecha de factura<br/>total = monto - devolución (soles)<br/>o monto en USD × tipo de cambio - devolución

    API->>DB: INSERT Pasaje
    API-->>UI: Pasaje creado
    UI-->>ADM: Pasaje registrado
```

El módulo exige el rol `ADMIN_MANAGER`, `GENERAL_MANAGER` o `PASAJES_MANAGER` (o usuario staff). El tipo de cambio del día se consulta a un servicio externo y se guarda en caché por 4 horas.

---

## 5. Casos de Uso — Módulo de Soporte TI

### 5.1 Diagrama de Casos de Uso

```mermaid
graph LR
    USR[👤 Cualquier<br/>usuario autenticado]
    TI[👤 Soporte TI<br/>is_staff]

    subgraph "Soporte TI"
        CU30((CU-30<br/>Crear<br/>Ticket))
        CU31((CU-31<br/>Ver Mis<br/>Tickets))
        CU32((CU-32<br/>Comentar<br/>Ticket))
        CU33((CU-33<br/>Cambiar<br/>Estado))
        CU34((CU-34<br/>Ver Resumen<br/>de Tickets))
    end

    USR --> CU30
    USR --> CU31
    USR --> CU32
    USR --> CU33
    USR --> CU34
    TI --> CU31
    TI --> CU32
    TI --> CU33
```

Un usuario común solo ve y gestiona sus propios tickets; un usuario staff ve todos los tickets. El resumen de CU-34 (`my-stats`) cuenta los tickets propios por estado.

### 5.2 Secuencia: Crear y Gestionar Ticket (CU-30)

```mermaid
sequenceDiagram
    actor USR as Usuario
    actor TI as Soporte TI
    participant UI as Frontend React
    participant API as Support API
    participant DB as Base de datos

    USR->>UI: Accede a "Soporte" (Nuevo Ticket)
    USR->>UI: Completa el formulario de ticket
    Note over USR,UI: Título, descripción, categoría

    UI->>API: POST /support/tickets/
    API->>API: Genera ticket_number y asigna la prioridad
    Note over API: TK-20260429-A3F2<br/>Prioridad automática por palabras clave<br/>y categoría (no la elige el usuario)
    API->>DB: INSERT Ticket {status: OPEN}
    API-->>UI: Ticket creado

    TI->>API: POST /support/tickets/{id}/change-status/ {status: "IN_PROGRESS"}
    API->>DB: UPDATE Ticket SET status='IN_PROGRESS'
    API->>DB: INSERT TicketComment {is_status_change: true}

    TI->>API: POST /support/tickets/{id}/add-comment/ {content: "Revisando..."}
    API->>DB: INSERT TicketComment

    TI->>API: POST /support/tickets/{id}/change-status/ {status: "RESOLVED"}
    API->>DB: UPDATE Ticket SET status='RESOLVED', resolved_at=now()
```

No se pueden agregar comentarios a un ticket cerrado. La asignación (`assigned_to`) se administra desde el panel de Django.

---

## 6. Casos de Uso — Recursos Humanos, Sistema, Autenticación y Configuración

### 6.1 Diagrama de Casos de Uso

```mermaid
graph LR
    HRM[👤 Gestor de RR. HH.<br/>HR_MANAGER]
    GM[👤 Gerente General<br/>solo lectura]
    SU[👤 Superadministrador<br/>is_superuser]
    USR[👤 Usuario]

    subgraph "RR. HH. (/rrhh)"
        CU47((CU-47<br/>Gestionar<br/>Plantillas))
        CU48((CU-48<br/>Generar y<br/>Emitir Contrato))
        CU49((CU-49<br/>Analizar CVs<br/>en lote))
    end

    subgraph "Administración del Sistema (/sistema)"
        CU50((CU-50<br/>Gestionar Usuarios<br/>y Roles))
        CU51((CU-51<br/>Gestionar<br/>Proyectos))
    end

    subgraph "Autenticación y Configuración"
        CU35((CU-35<br/>Iniciar<br/>Sesión))
        CU36((CU-36<br/>Cerrar<br/>Sesión))
        CU37((CU-37<br/>Seleccionar<br/>Módulo))
        CU38((CU-38<br/>Cambiar<br/>Contraseña))
        CU39((CU-39<br/>Gestionar<br/>Firma))
        CU52((CU-52<br/>Elegir tema<br/>claro u oscuro))
    end

    HRM --> CU47
    HRM --> CU48
    HRM --> CU49
    GM -.-> CU48
    GM -.-> CU49
    SU --> CU50
    SU --> CU51
    USR --> CU35
    USR --> CU36
    USR --> CU37
    USR --> CU38
    USR --> CU39
    USR --> CU52
```

### 6.2 Secuencia: Generar y Emitir un Contrato (CU-48)

```mermaid
sequenceDiagram
    actor HRM as Gestor de RR. HH.
    participant UI as Frontend React
    participant API as HR API
    participant AI as Asistente de IA (API de Anthropic)
    participant DB as Base de datos

    HRM->>UI: Click "Nuevo contrato"
    opt Asistente disponible
        HRM->>UI: Describe el pedido en texto libre
        UI->>API: POST /hr/assistant/extract/
        API->>AI: Extrae datos estructurados (no redacta el contrato)
        AI-->>API: Campos y preguntas por lo que falta
        API-->>UI: Datos propuestos
    end
    HRM->>UI: Elige trabajador y plantilla activa
    UI->>API: GET /hr/personal/{id}/prefill/
    API-->>UI: Datos precargados desde Personal
    UI->>API: POST /hr/documents/ {template_id, personal_id, data}
    API->>DB: INSERT GeneratedDocument (DRAFT)
    HRM->>UI: Revisa y emite
    UI->>API: POST /hr/documents/{id}/issue/
    API->>DB: Asigna número y congela el documento (ISSUED)
    UI->>API: GET /hr/documents/{id}/download/?format=docx|pdf
    API-->>UI: Archivo Word o PDF
```

| Campo | Detalle |
|-------|---------|
| **ID** | CU-48 |
| **Actor principal** | Gestor de RR. HH. (el Gerente General solo lee) |
| **Reglas de negocio** | - Sin `ANTHROPIC_API_KEY` el módulo funciona en modo formulario<br>- Un documento emitido no se edita; se anula con motivo<br>- Los archivos se guardan en almacenamiento privado fuera de `MEDIA_ROOT` y toda respuesta de `/api/v1/hr/*` lleva `Cache-Control: no-store`<br>- La conversión a PDF requiere LibreOffice en el servidor |

### 6.3 Secuencia: Analizar CVs en Lote (CU-49)

```mermaid
sequenceDiagram
    actor HRM as Gestor de RR. HH.
    participant UI as Wizard de CVs
    participant API as HR API
    participant Q as Cola hr_cv (Celery)
    participant AI as Agente de IA (API de Anthropic)

    HRM->>UI: Crea el análisis y, opcionalmente, sube la convocatoria
    UI->>API: POST /hr/cv-analyses/ y POST .../posting/extract/
    HRM->>UI: Sube PDF, Word o imágenes
    UI->>API: POST /hr/cv-analyses/{id}/items/ (por archivo)
    API->>Q: Un CV = una tarea (hr.process_cv_item)
    loop Mientras haya CVs en proceso
        UI->>API: GET /hr/cv-analyses/{id}/progress/?since=...
    end
    Q->>AI: Lee el CV y genera el reporte
    HRM->>UI: Revisa ranking y reportes
    UI->>API: GET .../download-zip/ o .../download-xlsx/
```

El análisis de CVs es una sugerencia (avanzar, revisar, no avanzar); la decisión es humana. Una tarea programada reencola los CVs atascados cada 5 minutos.

### 6.4 Secuencia: Iniciar Sesión (CU-35)

```mermaid
sequenceDiagram
    actor USR as Usuario
    participant UI as LoginPage
    participant AX as Axios Client
    participant API as Django Auth
    participant JWT as SimpleJWT
    participant DB as Base de datos

    UI->>AX: GET /auth/csrf/ (al abrir la aplicación)
    AX->>API: Solicita la cookie csrftoken
    API-->>AX: Set-Cookie: csrftoken (legible por JS)

    USR->>UI: Ingresa usuario y contraseña
    UI->>AX: POST /auth/login/ {username, password} + X-CSRFToken

    AX->>API: Request con credenciales
    API->>API: Límites de intentos por IP y por usuario
    API->>JWT: CustomTokenObtainPairView
    JWT->>DB: Validar credenciales
    DB-->>JWT: Usuario válido

    JWT->>JWT: Generar tokens
    Note over JWT: access_token (15 min)<br/>refresh_token (1 día)

    JWT-->>API: Tokens generados
    API-->>AX: Respuesta con el perfil + Set-Cookie
    Note over API: Set-Cookie: access_token y refresh_token<br/>(HttpOnly, SameSite=Lax, Path=/,<br/>Secure cuando DEBUG es falso)

    UI->>AX: GET /users/me/
    AX->>API: Request (cookie enviada automáticamente)
    API->>API: CookieJWTAuthentication lee la cookie
    API->>DB: SELECT User + UserRoles
    API-->>UI: {username, roles, is_superuser, must_change_password, ...}

    UI->>UI: AuthContext.setCurrentUser(user)
    alt must_change_password
        UI-->>USR: Redirige a /cambiar-password (bloqueo hasta cambiarla)
    else
        UI-->>USR: Redirige a SystemSelectPage
        USR->>UI: Selecciona un módulo según sus roles
        Note over USR,UI: RQ (/rq) · Almacén (/almacen) · Soporte (/soporte)<br/>RR. HH. (/rrhh) · Administración (/admin)<br/>Administración del Sistema (/sistema, solo superusuario)
    end
```

Mientras `must_change_password` esté activo, el backend rechaza toda petición fuera de una lista corta (perfil propio, cambio de contraseña, cierre de sesión, cookie CSRF y renovación del token).

### 6.5 Secuencia: Renovación del Token en el Cliente

```mermaid
sequenceDiagram
    participant UI as Componente React
    participant AX as Axios Interceptor
    participant API as Django Auth

    UI->>AX: GET /requests/ (access_token expirado)
    AX->>API: Request
    API-->>AX: 401 Unauthorized

    AX->>AX: Interceptor detecta 401
    AX->>AX: isRefreshing = true
    AX->>AX: Encola las peticiones pendientes

    AX->>API: POST /auth/token/refresh/ (cuerpo vacío + X-CSRFToken)
    Note over AX,API: La vista es el TokenRefreshView estándar de SimpleJWT,<br/>que espera "refresh" en el cuerpo y no lo lee de la cookie

    alt Renovación exitosa
        API-->>AX: Tokens nuevos
        AX->>AX: Reintenta las peticiones encoladas
    else Falla
        API-->>AX: Error
        AX-->>UI: Rechaza las peticiones encoladas
    end
```

**Brecha conocida.** El cliente invoca la renovación sin cuerpo porque el refresh token vive en una cookie `httpOnly`, mientras que la vista de SimpleJWT lee `refresh` del cuerpo. El propio código de pruebas (`apps/core/tests/test_must_change_password_gate.py`) la reconoce como una brecha preexistente fuera del alcance de SYSPCC-018. El cierre de sesión sí lee la cookie y la invalida.

### 6.6 Configuración: Tema Claro, Oscuro o Automático (CU-52)

El usuario alterna claro/oscuro con el botón del encabezado, o elige el modo (claro, oscuro, automático) y el rango horario del modo automático en `/settings` → Apariencia. El modo automático usa por defecto 19:00 a 07:00. La preferencia se guarda en el `localStorage` del navegador (clave `syspcc.theme.v1`), no en el servidor; si el navegador no permite guardarla, el tema se aplica igual durante la sesión.

---

## 7. Matriz de Casos de Uso por Actor

Leyenda: ✓ = puede ejecutarlo; L = solo lectura; (a) = solo en el almacén de obra; (b) = con restricciones descritas en el caso de uso.

| Caso de Uso | REQ | PR | PC | GM | LC | LS | LCH | CW | SW | DS | AM | PJ | HRM | SU |
|-------------|:---:|:--:|:--:|:--:|:--:|:--:|:---:|:--:|:--:|:--:|:--:|:--:|:---:|:--:|
| CU-01 Crear RQ (b) | ✓ | | | | | | | | | | | | | |
| CU-02 Enviar RQ | ✓ | | | | | | | | | | | | | |
| CU-03 Validación Técnica | | ✓ | | | | | | | | | | | | |
| CU-04 Clasificación Presupuestal | | | ✓ | | | | | | | | | | | |
| CU-05 Validación Administrativa | | | | | | | | | | ✓ | ✓ | | | |
| CU-06 Aprobación GG | | | | ✓ | | | | | | | | | | |
| CU-07 Verificar Stock | | | | | ✓ | ✓ | | | | | | | | |
| CU-08 Gestionar Cotizaciones | | | | | ✓ | ✓ | ✓ | | | | | | | |
| CU-09 Generar OC | | | | | ✓ | ✓ | | | | | | | | |
| CU-10 Recepción y QC | | | | | ✓ | ✓ | | | | | | | | |
| CU-11 Despacho y Entrega | | | | | ✓ | ✓ | | ✓ | ✓ | | | | | |
| CU-12 Conformidad | ✓ | | | | | | | | | | | | | |
| CU-13 Cierre de RQ | | | | | ✓ | ✓ | | | | | | | | |
| CU-14 Cancelar RQ (b) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| CU-15 Registrar Ingreso | | | | | ✓ | ✓ | ✓ | ✓ | (a) | | | | | |
| CU-17 Asignar Ubicación | | | | | | | ✓ | ✓ | | | | | | |
| CU-18 Atender RQ pendiente | | | | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | |
| CU-19 Egreso o Entrega (b) | | | | | ✓ | ✓ | ✓ | ✓ | (a) | | | | | |
| CU-20 Imprimir Vale | | | | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | |
| CU-21 Consultar Kardex | | | | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | |
| CU-22 Transferencia entre pisos | | | | | | | | ✓ | ✓ | | | | | |
| CU-23 Exportar Inventario | | | | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | |
| CU-24 a CU-29 Pasajes y configuración | | | | ✓ | | | | | | | ✓ | ✓ | | |
| CU-30 Crear Ticket | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CU-35 Iniciar Sesión | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CU-40 Reclamo a Proveedor | | | | | ✓ | ✓ | | | | | | | | |
| CU-41 Aprobar costo o sobrecosto | | | ✓ | ✓ | | | | | | | ✓ | | | |
| CU-42 Vincular ítems y disponibilidad | | | | | ✓ | ✓ | ✓ | | | | | | | |
| CU-43 Entregar EPP con vale | | | | | | | | ✓ | ✓ | | | | | |
| CU-44 Importar Excel de inventario | | | | | | | ✓ | ✓ | | | | | | |
| CU-45 Resumen de movimiento | | | | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | |
| CU-46 Vincular destinos con trabajadores | | | | | | | ✓ | ✓ | | | | | | |
| CU-47 a CU-49 RR. HH. | | | | L | | | | | | | | | ✓ | |
| CU-50 y CU-51 Sistema | | | | | | | | | | | | | | ✓ |
| CU-52 Elegir tema | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Notas de la matriz:

- **(b) CU-01.** El backend permite crear RQ a cualquier usuario autenticado; la conformidad (CU-12) exige el rol `REQUESTER`.
- **(b) CU-14.** La tabla de transiciones no exige un rol específico para `CANCELLED`; cualquier usuario con un rol asignado y acceso al RQ puede ejecutarla.
- **(b) CU-19.** Las salidas hacia un trabajador o a otro piso las hacen solo Almacén Central y Almacén de Obra; el resto de salidas pueden hacerlas también los roles de logística.
- **Soporte.** Los usuarios staff ven y gestionan todos los tickets; los demás, solo los suyos.
- **Superusuario.** Gestiona usuarios y proyectos en `/sistema`; los permisos del almacén no le conceden acceso adicional.

---

*Documento de casos de uso de SYSPCC — PCC Ingeniería y Construcción*
*Última actualización: Octubre 2026 (código al día con SYSPCC-026)*
