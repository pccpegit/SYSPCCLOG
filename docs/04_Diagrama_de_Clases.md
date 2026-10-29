# SYSPCC — Diagrama de Clases

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.1 | **Fecha:** Octubre 2026 | **Empresa:** PCC Ingeniería y Construcción

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
        +bool must_change_password
        +datetime date_joined
        +bool is_active
        +bool is_staff
        +bool is_superuser
        --
        +full_name() str ❰property❱
        +get_roles() QuerySet~UserRole~
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
        PASAJES_MANAGER
        HR_MANAGER
    }

    class Project {
        +int id
        +str code ❰unique❱
        +str name
        +str location
        +str client
        +str frente
        +Decimal total_budget ❰nullable❱
        +date start_date
        +date end_date
        +bool is_active
        +datetime created_at
        +datetime updated_at
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
        +str frente ❰default OFICINA CENTRAL❱
        +ForeignKey manager → User ❰nullable❱
        +bool is_active
    }

    class AnnualPlan {
        +int id
        +int year
        +ForeignKey department → Department
        +Decimal total_budget
        +ForeignKey approved_by → User ❰nullable❱
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
        +OneToOneField user → User ❰nullable❱
        +str dni ❰unique❱
        +str apellidos_nombres
        +date fecha_nacimiento
        +str sexo ❰M|F❱
        +str estado_civil
        +str celular
        +str email_personal
        +str contacto_emergencia_nombre
        +str contacto_emergencia_telefono
        +str contacto_emergencia_vinculo
        +str departamento_residencia
        +str provincia_residencia
        +str distrito_residencia
        +str direccion_residencia
        +str nivel_educativo
        +str grado_academico
        +str especialidad_carrera
        +str estado ❰ACTIVO|CESADO|VACACIONES|LICENCIA❱
        +date fecha_ingreso
        +date fecha_cese
        +str motivo_cese
        +ForeignKey proyecto → Project ❰nullable❱
        +str sede
        +str puesto
        +str guardia ❰A|B|C|D❱
        +str condicion_trabajo ❰PLANILLA|RECIBO|CONTRATO❱
        +Decimal salario
        +str sistema_pensiones
        +str entidad_bancaria
        +str numero_cuenta
        +str cci
        +bool tiene_hijos
        +bool hijos_menores_18
        +int cantidad_hijos_menores
        +text nombres_hijos_menores
        +bool asignacion_familiar
        +str numero_fotocheck
        +str talla_zapato
        +str talla_pantalon
        +str talla_camisa
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
    Department "*" --> "0..1" User : managed_by
    Personal "0..1" --> "0..1" User : linked_to
    Personal "*" --> "0..1" Project : assigned_to
    AnnualPlan "*" --> "0..1" User : approved_by
```

El acceso a `Personal` está restringido: los datos completos (salario, cuenta bancaria, domicilio, contacto de emergencia) los leen solo roles de RR. HH. autorizados; el módulo de pasajes y el de almacén consultan versiones reducidas.

---

## 2. Diagrama de Clases — Módulo RQ (Requerimientos)

```mermaid
classDiagram
    direction TB

    class Request {
        +int id
        +str rq_number ❰auto RQ-AAAA-NNNN, unique❱
        +str flow ❰OPERATIONS|ADMINISTRATIVE❱
        +ForeignKey project → Project ❰nullable❱
        +ForeignKey department → Department ❰nullable❱
        +ForeignKey requested_by → User
        +str requesting_area ❰OP|QC|HSE|ADM, vacío en históricos❱
        +str front_area
        +str service
        +str specific_use
        +text description
        +text justification
        +str acquisition_type
        +str priority ❰LOW|NORMAL|HIGH|URGENT❱
        +str status ❰RQStatusChoices: 47 valores❱
        +ForeignKey current_step → WorkflowStep ❰nullable❱
        +str budget_classification ❰nullable❱
        +ForeignKey budget_line → ProjectBudgetLine ❰nullable❱
        +ForeignKey annual_plan_line → AnnualPlanLine ❰nullable❱
        +Decimal estimated_cost
        +Decimal final_cost ❰nullable❱
        +date fecha_necesidad
        +date fecha_estimada_entrega
        +date fecha_real_entrega
        +datetime created_at
        +datetime updated_at
        --
        +is_terminal() bool ❰property❱
        +total_items_cost() Decimal ❰property❱
        ❰index❱ flow, project, department, requested_by,
                status, acquisition_type, priority, created_at
    }

    class RequestItem {
        +int id
        +ForeignKey request → Request
        +int line_number
        +str description
        +text specifications
        +Decimal quantity ❰mínimo 0.001❱
        +str unit
        +Decimal unit_price ❰nullable❱
        +Decimal total_price ❰auto-calc❱
        +Decimal stock_almacen_obra
        +Decimal stock_almacen_central
        +Decimal x_atender
        +str presupuestado_adicional
        +str rfi_fwo
        +str estatus_guia
        +str supply_source ❰STOCK|PURCHASE, lo define Logística❱
        +str item_source ❰EPP|HERRAMIENTAS|MATERIALES|EQUIPOS|...❱
        +ForeignKey inventory_item → Inventory ❰nullable❱
        +bool is_off_catalog
        +datetime inventory_item_confirmed_at ❰nullable❱
        +ForeignKey inventory_item_confirmed_by → User ❰nullable❱
        +text comentarios
        --
        +link_confirmed() bool ❰property❱
        +save() ❰auto: total_price = quantity × unit_price❱
        ❰unique_together❱ (request, line_number)
        ❰check❱ no puede estar vinculado y fuera de catálogo a la vez
    }

    class Approval {
        <<immutable>>
        +int id
        +ForeignKey request → Request
        +ForeignKey workflow_step → WorkflowStep ❰nullable❱
        +str action ❰ApprovalActionChoices: 37 valores❱
        +ForeignKey performed_by → User
        +str role ❰RoleChoices o SYSTEM❱
        +str previous_status
        +str new_status
        +text comments
        +datetime performed_at ❰auto_now_add❱
        --
        ❰index❱ request, performed_by, performed_at
    }

    class WorkflowStep {
        +int id
        +str flow ❰OPERATIONS|ADMINISTRATIVE❱
        +int step_order
        +str step_code
        +str step_name
        +str responsible_role
        +str from_status
        +str to_status_approve
        +str to_status_reject ❰nullable❱
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
        +datetime created_at
    }

    class Quotation {
        +int id
        +ForeignKey request → Request
        +ForeignKey supplier → Supplier
        +str quotation_number
        +Decimal total_amount
        +str currency ❰default PEN❱
        +int delivery_days
        +str payment_terms
        +int validity_days
        +text notes
        +str document_url
        +bool is_selected
        +ForeignKey selected_by → User ❰nullable❱
        +datetime selected_at ❰nullable❱
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
        +str po_number ❰auto OC-AAAA-NNNN, unique❱
        +ForeignKey request → Request
        +ForeignKey quotation → Quotation
        +ForeignKey supplier → Supplier
        +ForeignKey generated_by → User
        +str status ❰DRAFT|SENT|CONFIRMED|PARTIALLY_RECEIVED|FULLY_RECEIVED|CANCELLED❱
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
        +ForeignKey quotation_item → QuotationItem ❰nullable❱
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
        +ForeignKey managed_by → User ❰nullable❱
        +str status ❰OPEN|IN_REVIEW|RESOLVED|CLOSED❱
        +text description
        +text resolution
        +ForeignKey resolved_by → User ❰nullable❱
        +datetime created_at
        +datetime resolved_at
    }

    class Notification {
        +int id
        +ForeignKey user → User
        +ForeignKey request → Request ❰nullable❱
        +str title
        +text message
        +bool is_read
        +str dedup_key ❰único si no es nulo❱
        +datetime created_at
    }

    class ActivityLog {
        <<immutable>>
        +int id
        +ForeignKey request → Request
        +ForeignKey user → User
        +str action
        +text detail
        +str ip_address ❰nullable❱
        +datetime created_at
    }

    class Attachment {
        +int id
        +ForeignKey request → Request
        +ForeignKey uploaded_by → User
        +str file_name
        +str file_path ❰ruta en MEDIA_ROOT o URL externa❱
        +str file_type
        +int file_size
        +str category
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
    PurchaseOrderItem "*" --> "0..1" QuotationItem : from
```

Observaciones del módulo:

- La creación de un RQ por la API (`POST /requests/`) lo registra directamente en `SUBMITTED` junto con su primera aprobación; el valor `DRAFT` queda como estado inicial de la máquina de estados.
- El vínculo `RequestItem.inventory_item` (o la marca `is_off_catalog`) que envía el solicitante es una **propuesta**; Logística la confirma y deja constancia en `inventory_item_confirmed_at` y `inventory_item_confirmed_by`.
- `Approval` y `ActivityLog` los escribe el motor del flujo en cada transición; la creación del RQ registra además su primera `Approval`, y `update-items` deja entradas de `ActivityLog`. `Notification` nace de las transiciones y de las tareas programadas de SLA y recordatorios.
- `PurchaseOrder`, `Claim` y `Attachment` cuentan con modelo y endpoints, pero el SPA actual no los escribe: la acción `PO_GENERATED` y el ciclo de reclamo se registran como transiciones del flujo, y los adjuntos solo se consultan.

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
        +str item_type ❰EQUIPMENT|CONSUMABLE|TOOL|MATERIAL|EPP❱
        +str brand
        +str model_name
        +str location ❰formato Pabellón+Sección-Nivel, p. ej. B3-2❱
        +int floor ❰1|2, nullable❱
        +Decimal min_stock
        +str order_number
        +str purchase_order_ref
        +str packing_list
        +str size
        +str observation
        +ForeignKey project → Project ❰nullable❱
        +datetime created_at
        --
        +location_status() str ❰EXACT|FLOOR_ONLY|NONE❱
        +location_display() str
    }

    class InventoryStock {
        +int id
        +ForeignKey inventory → Inventory
        +str warehouse_type ❰CENTRAL|SITE|OFFICE❱
        +ForeignKey project → Project ❰nullable❱
        +ForeignKey department → Department ❰nullable❱
        +Decimal quantity
        +datetime last_updated
        --
        ❰unique_together❱ (inventory, warehouse_type, project, department)
        ❰check❱ quantity >= 0
    }

    class MovementGroup {
        +int id
        +str group_number ❰unique, p. ej. ENT-2026-G0001❱
        +str movement_type ❰ENTRY|EXIT|TRANSFER|ADJUSTMENT❱
        +str warehouse
        +ForeignKey project → Project ❰nullable❱
        +str source_type
        +str supplier_name
        +str invoice_number
        +str destination_type
        +str destination_detail
        +date movement_date ❰nullable❱
        +str voucher_number ❰N° de vale físico❱
        +str po_number
        +str guide_number
        +str internal_transfer
        +ForeignKey destination_personal → Personal ❰nullable❱
        +text notes
        +str document_url
        +ForeignKey registered_by → User
        +datetime created_at
    }

    class InventoryMovement {
        +int id
        +str movement_number ❰unique, p. ej. ENT-2026-0001❱
        +str movement_type ❰ENTRY|EXIT|TRANSFER|ADJUSTMENT❱
        +ForeignKey inventory → Inventory
        +Decimal quantity
        +str warehouse ❰CENTRAL|SITE|OFFICE❱
        +ForeignKey project → Project ❰nullable❱
        +str source_type ❰PURCHASE|RETURN|TRANSFER_IN|INITIAL_LOAD|ADJUSTMENT❱
        +str supplier_name
        +str invoice_number
        +str destination_type ❰PROJECT|DEPARTMENT|EMPLOYEE|TRANSFER_OUT|ADJUSTMENT❱
        +str destination_detail
        +ForeignKey requested_by → User ❰nullable❱
        +ForeignKey authorized_by → User ❰nullable❱
        +ForeignKey group → MovementGroup ❰nullable❱
        +date movement_date ❰nullable❱
        +str voucher_number
        +str po_number
        +str guide_number
        +str internal_transfer
        +str tag
        +ForeignKey destination_personal → Personal ❰nullable❱
        +str source_key ❰único, nullable❱
        +ForeignKey import_batch → InventoryImport ❰nullable❱
        +text notes
        +str document_url
        +ForeignKey registered_by → User
        +datetime created_at
    }

    class WarehouseReceipt {
        +int id
        +ForeignKey request → Request
        +ForeignKey purchase_order → PurchaseOrder ❰nullable❱
        +ForeignKey received_by → User
        +str receipt_number
        +str supplier_guide_number
        +datetime received_at
        +bool conformity_passed ❰nullable❱
        +ForeignKey conformity_checked_by → User ❰nullable❱
        +datetime conformity_checked_at
        +text conformity_notes
        +OneToOneField movement_group → MovementGroup ❰nullable❱
        +text notes
    }

    class WarehouseReceiptItem {
        +int id
        +ForeignKey receipt → WarehouseReceipt
        +ForeignKey request_item → RequestItem
        +ForeignKey purchase_order_item → PurchaseOrderItem ❰nullable❱
        +Decimal quantity_received
        +Decimal quantity_accepted ❰nullable❱
        +Decimal quantity_rejected
        +text rejection_reason
    }

    class WarehouseDispatch {
        +int id
        +ForeignKey request → Request
        +ForeignKey receipt → WarehouseReceipt ❰nullable❱
        +ForeignKey dispatched_by → User
        +str dispatch_number
        +str origin ❰CENTRAL|SITE|OFFICE❱
        +ForeignKey destination_project → Project ❰nullable❱
        +ForeignKey destination_department → Department ❰nullable❱
        +str dispatch_guide_number
        +datetime dispatched_at
        +datetime delivered_at ❰nullable❱
        +ForeignKey accepted_by → User ❰nullable❱
        +OneToOneField movement_group → MovementGroup ❰nullable❱
    }

    class WarehouseDispatchItem {
        +int id
        +ForeignKey dispatch → WarehouseDispatch
        +ForeignKey request_item → RequestItem
        +Decimal quantity_dispatched
        +Decimal quantity_delivered ❰nullable❱
    }

    class InventoryImport {
        +UUID id
        +ForeignKey uploaded_by → User
        +str warehouse
        +str file_name
        +str file_sha256
        +bytes file_bytes ❰se borra al terminar❱
        +str status ❰PREVIEWED|PROCESSING|CONFIRMED|CANCELLED|EXPIRED|FAILED❱
        +json options
        +json summary
        +json problems
        +str plan_digest
        +json result
        +datetime created_at
        +datetime confirmed_at ❰nullable❱
        +datetime expires_at ❰nullable❱
        --
        ❰unique❱ (file_sha256, warehouse) si status = CONFIRMED
    }

    class OneDriveToken {
        +int id
        +str access_token ❰cifrado❱
        +str refresh_token ❰cifrado❱
        +datetime expires_at
        +str account_name
        +datetime connected_at
        +datetime updated_at
    }

    Inventory "1" *-- "*" InventoryStock : stocked_at
    Inventory "1" *-- "*" InventoryMovement : tracked_by
    MovementGroup "1" *-- "*" InventoryMovement : groups
    InventoryStock "*" --> "0..1" Project : scoped
    InventoryMovement "*" --> "0..1" Project : for
    Inventory "*" --> "0..1" Project : owner
    InventoryImport "1" --> "*" InventoryMovement : imported
    WarehouseReceipt "1" *-- "*" WarehouseReceiptItem : contains
    WarehouseDispatch "1" *-- "*" WarehouseDispatchItem : contains
    WarehouseReceipt "0..1" --> "0..1" MovementGroup : entry
    WarehouseDispatch "0..1" --> "0..1" MovementGroup : exit
```

Observaciones del módulo:

- El stock se guarda por `(producto, tipo de almacén, proyecto, departamento)`. El pool que usan los RQ para verificar disponibilidad es el almacén `CENTRAL` sin proyecto ni departamento.
- `WarehouseReceipt` y `WarehouseDispatch` los crea el `WorkflowEngine` al ejecutar las acciones `RECEIVED` y `DISPATCHED`, de forma tolerante a errores (si fallan, el flujo continúa y queda una advertencia en el log).
- Los tokens de `OneDriveToken` se cifran en reposo.
- Las ubicaciones siguen el formato definido por gerencia `{Pabellón}{Sección}-{Nivel}` (pabellones A a K, niveles 1 a 5); la validación está en `warehouse/services/locations.py`.

---

## 4. Diagrama de Clases — Módulo Administración

```mermaid
classDiagram
    direction TB

    class Pasaje {
        +int id
        +str codigo_id_legado ❰unique, nullable❱
        +str tipo ❰B|S|S/B❱
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
        +ForeignKey centro_costo → Project ❰nullable❱
        +ForeignKey proveedor → ProveedorPasajes ❰nullable❱
        +str ruc
        +str razon_social
        +str factura_ticket
        +text detalle
        +date fecha
        +str mes
        +str moneda ❰SOLES|DOLARES❱
        +Decimal monto_con_igv_soles
        +Decimal monto_con_igv_dolares
        +Decimal tipo_cambio
        +Decimal devolucion
        +Decimal total ❰auto-calc❱
        +str estado ❰PENDIENTE|PAGADO❱
        +date fecha_pago
        +str numero_operacion
        +bool habilitado
        +ForeignKey creado_por → User ❰nullable❱
        +ForeignKey actualizado_por → User ❰nullable❱
        +datetime fecha_registro
        +datetime fecha_actualizacion
        --
        +save() ❰auto-calc: mes (nombre del mes de la factura), total❱
    }

    class ProveedorPasajes {
        +int id
        +str ruc ❰unique, 11 caracteres❱
        +str razon_social
        +datetime created_at
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

    class Puesto {
        +int id
        +str cargo ❰unique❱
        +bool habilitado
        +datetime created_at
    }

    Pasaje "*" --> "0..1" Personal : for_employee
    Pasaje "*" --> "0..1" ProveedorPasajes : provided_by
    Pasaje "*" --> "0..1" Project : charged_to
    Pasaje "*" --> "0..1" User : created_by
```

El `total` se calcula en soles: `monto_con_igv_soles - devolucion` si la moneda es SOLES; `monto_con_igv_dolares × tipo_cambio - devolucion` si es DOLARES.

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
        +str priority ❰LOW|MEDIUM|HIGH|CRITICAL, automática❱
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
        +datetime updated_at
    }

    Ticket "1" *-- "*" TicketComment : has
    Ticket "*" --> "1" User : created_by
    Ticket "*" --> "0..1" User : assigned_to
    TicketComment "*" --> "1" User : authored_by
```

La prioridad no la elige el usuario: `auto_assign_priority` la deduce de palabras clave del título y la descripción y de la categoría (las categorías `NETWORK` y `ACCESS` parten en `HIGH`).

---

## 6. Diagrama de Clases — Módulo RR. HH.

```mermaid
classDiagram
    direction TB

    class DocumentTemplate {
        +int id
        +str document_type ❰CONTRACT❱
        +str slug
        +str name
        +int version
        +FileField file ❰.docx en almacenamiento privado❱
        +str original_filename
        +str file_sha256
        +json detected_variables
        +json unknown_variables
        +json missing_required_variables
        +bool is_active
        +datetime activated_at
        +text notes
        +ForeignKey uploaded_by → User ❰nullable❱
        --
        ❰unique❱ (document_type, slug, version)
    }

    class GeneratedDocument {
        +int id
        +str document_type
        +ForeignKey template → DocumentTemplate
        +int template_version
        +str template_sha256
        +ForeignKey personal → Personal ❰nullable❱
        +str subject_name
        +json data
        +str status ❰DRAFT|ISSUED|VOIDED❱
        +str source ❰MANUAL|ASSISTANT❱
        +FileField docx_file
        +FileField pdf_file
        +str reference_number ❰único, nullable❱
        +ForeignKey created_by → User ❰nullable❱
        +ForeignKey issued_by → User ❰nullable❱
        +datetime issued_at
        +ForeignKey voided_by → User ❰nullable❱
        +datetime voided_at
        +text void_reason
        --
        +pdf_is_current() bool ❰property❱
        ❰check❱ un documento emitido tiene número y fecha
    }

    class DocumentEvent {
        <<immutable>>
        +int id
        +ForeignKey document → GeneratedDocument
        +str action ❰CREATED|UPDATED|ISSUED|VOIDED|DOWNLOADED|PDF_RENDERED❱
        +ForeignKey actor → User ❰nullable❱
        +json metadata
        +datetime created_at
    }

    class CVAnalysis {
        +int id
        +str name
        +text requirements_text
        +json requirements
        +str model_name
        +str prompt_version
        +FileField posting_file ❰convocatoria opcional❱
        +str posting_kind ❰PDF|DOCX|IMAGE❱
        +int posting_tokens_in
        +int posting_tokens_out
        +Decimal posting_cost_usd
        +ForeignKey created_by → User ❰nullable❱
        --
        +has_requirements() bool ❰property❱
        +has_posting() bool ❰property❱
    }

    class CVAnalysisItem {
        +int id
        +ForeignKey analysis → CVAnalysis
        +int position
        +str original_name
        +FileField file
        +str sha256
        +str kind ❰PDF|DOCX|IMAGE❱
        +str status ❰QUEUED|PROCESSING|DONE|FAILED|CANCELLED❱
        +int attempts
        +str error_code
        +json result
        +str candidate_name
        +int score ❰0-100, nullable❱
        +str recommendation ❰ADVANCE|REVIEW|NO_ADVANCE❱
        +bool injection_suspected
        +int tokens_in
        +int tokens_out
        +Decimal cost_usd
        +FileField report_pdf
        +datetime started_at
        +datetime finished_at
        --
        ❰unique❱ (analysis, sha256)
    }

    DocumentTemplate "1" --> "*" GeneratedDocument : used_by
    GeneratedDocument "1" *-- "*" DocumentEvent : events
    GeneratedDocument "*" --> "0..1" Personal : for
    CVAnalysis "1" *-- "*" CVAnalysisItem : items
```

Observaciones del módulo:

- Los archivos (plantillas, contratos, CVs, reportes) se guardan en almacenamiento privado fuera de `MEDIA_ROOT` y se entregan solo mediante vistas con permiso.
- Un documento emitido queda congelado; solo se anula con motivo. Cada cambio deja un `DocumentEvent`.
- La nota (`score`) y la recomendación de un CV son una sugerencia; la decisión es humana. El estado agregado de un análisis (`EMPTY`, `PROCESSING`, `COMPLETED_WITH_ERRORS`, `COMPLETED`) se calcula a partir de sus CVs y no se almacena.

---

## 7. Diagrama de Clases — Servicios de Negocio

```mermaid
classDiagram
    direction TB

    class WorkflowEngine {
        <<Service>>
        +WorkflowEngine(request, user, acting_role)
        +execute(action, comments, extra_data) Approval
        +get_available_actions() List~dict~
        -_validate_acting_role() void
        -_find_transition(action) dict
        -_check_role_permission(transition) void
        -_apply_side_effects(action, previous, new, extra) void
        -_on_validated(extra_data) void
        -_on_terminal_rejection() void
        -_on_material_received(extra_data) void
        -_on_dispatched(extra_data) void
        -_resolve_inventory_item(item) Inventory
        -_execute_system_chain(status) void
        -_log_activity(action, previous, new) void
        -_send_notifications(action, new_status) void
        +handle_ops_budget_classification(transition, extra) str
        +handle_adm_budget_review(transition, extra) str
        +handle_stock_check(transition, extra) str
        +handle_cancellation(transition, extra) str
    }

    class BudgetValidator {
        <<Service>>
        +validate(request) dict
        +commit_budget(request) void
        +release_budget(request) void
    }

    class SLACalculator {
        <<Service>>
        +calculate_estimated_delivery(acquisition_type, from_date, use_max) date
        +get_sla_days(acquisition_type) dict
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
        +notify_on_transition(request, action, new_status, actor) void
    }

    class RequestItemsService {
        <<Service>>
        +update_request_items(request, items_data, user) UpdateItemsResult
        +log_proposed_catalog_links(request, items, user) void
    }

    class StockAvailabilityService {
        <<Service>>
        +build_stock_availability(request) dict
        +committed_to_other_requests(inventory_ids, exclude_request_id) dict
    }

    class RequestCatalogService {
        <<Service>>
        +search_catalog(raw_term) QuerySet
        +central_pool_available(inventory_ids) dict
    }

    class WarehouseMovementsService {
        <<Service>>
        +register_entry_batch(...) MovementGroup
        +register_exit_batch(...) MovementGroup
        +register_entry(...) InventoryMovement
        +register_exit(...) InventoryMovement
        +register_adjustment(...) InventoryMovement
    }

    class EppService {
        <<Service>>
        +register_epp_delivery(...) MovementGroup
    }

    class InventoryImportService {
        <<Service>>
        +create_preview(uploaded_file, user, warehouse, update_existing) InventoryImport
        +confirm_import(...) InventoryImport
        +cancel_import(import_id) InventoryImport
        +purge_stale_imports(now) dict
    }

    class HRDocumentService {
        <<Service>>
        +create_draft(...) GeneratedDocument
        +update_draft(...) GeneratedDocument
        +issue(user, document_id) GeneratedDocument
        +void(user, document_id, reason) GeneratedDocument
        +render_pdf(user, document_id) GeneratedDocument
    }

    class CVAnalysisPipeline {
        <<Service>>
        +create_analysis(user, name, requirements_text) CVAnalysis
        +upload_files(analysis, user, files) dict
        +progress(analysis, since) dict
        +run_item(item_id) void
        +requeue_stale(analysis, limit) int
    }

    class CookieJWTAuthentication {
        <<Authentication>>
        +authenticate(request) tuple~User, token~
        +enforce_csrf(request) void
    }

    WorkflowEngine --> BudgetValidator : commit y release
    WorkflowEngine --> SLACalculator : fecha estimada
    WorkflowEngine --> NotificationService : usa
    WorkflowEngine --> WarehouseMovementsService : RECEIVED y DISPATCHED
    WorkflowEngine --> Request : modifica
    WorkflowEngine --> Approval : crea
    WorkflowEngine --> ActivityLog : crea
    WorkflowEngine --> WorkflowStep : lee
    BudgetValidator --> ProjectBudgetLine : modifica
    BudgetValidator --> AnnualPlanLine : modifica
    SLACalculator --> AcquisitionTypeConfig : lee
    RQNumberGenerator --> Request : genera número
    PONumberGenerator --> PurchaseOrder : genera número
    RequestItemsService --> RequestItem : confirma vínculos
    StockAvailabilityService --> RequestCatalogService : usa el pool CENTRAL
    EppService --> WarehouseMovementsService : reutiliza
    InventoryImportService --> WarehouseMovementsService : aplica ingresos y egresos
```

Los nombres de `InventoryImportService`, `HRDocumentService` y `CVAnalysisPipeline` agrupan funciones de los módulos `warehouse/services/imports/service.py`, `hr/services/document_service.py` y `hr/services/cv_analysis_service.py` / `cv_service.py`; no son clases con esos nombres en el código. Lo mismo ocurre con `RequestItemsService`, `StockAvailabilityService`, `RequestCatalogService`, `WarehouseMovementsService` y `EppService`, que representan módulos de funciones.

---

## 8. Diagrama de Clases — Frontend (React Components)

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
        +bool isSuperUser
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

    class ThemeContext {
        <<React Context>>
        +str mode ❰light|dark|auto❱
        +str resolvedTheme ❰light|dark❱
        +object autoRange
        +setMode(mode) bool
        +setAutoRange(range) bool
        +toggleTheme() bool
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

    class HRShell {
        <<Layout Component>>
        +Header header
        +HRSidebar sidebar
        +Outlet content
        --
        theme: violet
        route: /rrhh/*
    }

    class SystemAdminShell {
        <<Layout Component>>
        +Header header
        +SystemSidebar sidebar
        +Outlet content
        --
        theme: rose
        route: /sistema/*
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
        +str redirectTo
        --
        Acceso si tiene alguno de los roles
        Redirect si no autorizado
    }

    class SuperUserRoute {
        <<Auth Component>>
        +str redirectTo
        --
        Exige isSuperUser
    }

    class RequirePasswordChangeLayout {
        <<Auth Component>>
        --
        Redirige a /cambiar-password si
        must_change_password está activo
    }

    class StatusBadge {
        <<UI Component>>
        +str status
        --
        Mapea los estados a colores y etiquetas
    }

    class PriorityBadge {
        <<UI Component>>
        +str priority
        --
        URGENT|HIGH|NORMAL|LOW
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

    class CatalogCombobox {
        <<Domain Component>>
        +searchRequestCatalog(term) Promise
        --
        Búsqueda de productos del almacén
        en la captura del RQ
    }

    class StockCheckPanel {
        <<Domain Component>>
        +getStockAvailability(requestId) Promise
        +updateRequestItems(requestId, decisions) Promise
        --
        Verificación de stock de Logística
    }

    class AxiosClient {
        <<API Layer>>
        +str baseURL
        +bool withCredentials
        --
        Request interceptor (X-CSRFToken)
        Response interceptor (401 → refresh)
        Cola de requests ante 401 concurrentes
    }

    AuthContext --> RoleRoute : provides roles
    AuthContext --> SuperUserRoute : provides isSuperUser
    AppShell --> RoleRoute : wraps routes
    WarehouseShell --> RoleRoute : wraps routes
    AdminShell --> RoleRoute : wraps routes
    HRShell --> RoleRoute : wraps routes
    SystemAdminShell --> SuperUserRoute : gated by
    SupportShell --> AuthContext : requires session
    ThemeContext --> AppShell : clase .dark en html
    AxiosClient --> AuthContext : rechaza peticiones si falla el refresh
```

---

## 9. Diagrama de Paquetes — Vista General

```mermaid
graph TB
    subgraph "Backend (Django)"
        subgraph "config"
            SETTINGS["settings/<br/>base.py<br/>development.py<br/>production.py<br/>demo.py"]
            URLS["urls.py"]
            CELERYCONF["celery.py"]
            WSGI["wsgi.py"]
        end

        subgraph "apps.core"
            CORE_M["models/<br/>User, UserRole<br/>Project, Department<br/>Personal, AnnualPlan"]
            CORE_S["serializers/<br/>auth, user, project,<br/>department, personal"]
            CORE_V["views/<br/>auth, user, project,<br/>department, personal"]
            CORE_SV["services/<br/>user_admin, signature"]
            CORE_P["permissions.py<br/>authentication.py<br/>enums.py"]
        end

        subgraph "apps.rq"
            RQ_M["models/<br/>Request, RequestItem<br/>Approval, Supplier<br/>Quotation, PO, Claim<br/>WorkflowStep, Notification<br/>ActivityLog, Attachment"]
            RQ_SER["serializers/<br/>request, approval<br/>quotation, po, claim,<br/>catalog"]
            RQ_V["views/<br/>request, catalog,<br/>supplier, claim, workflow"]
            RQ_SVC["services/<br/>workflow_engine<br/>budget_validator<br/>sla_calculator<br/>number_generator<br/>request_items<br/>stock_availability<br/>request_catalog"]
            RQ_T["tasks.py"]
            RQ_F["filters.py"]
        end

        subgraph "apps.warehouse"
            WH_M["models/<br/>Inventory, Stock<br/>Movement, Group<br/>Receipt, Dispatch<br/>InventoryImport<br/>OneDriveToken"]
            WH_S["serializers.py<br/>serializers_imports.py"]
            WH_V["views.py<br/>views_imports.py<br/>views_personal.py"]
            WH_SVC["services/<br/>movements, kardex,<br/>locations, epp,<br/>imports/"]
        end

        subgraph "apps.administracion"
            AD_M["models.py<br/>Pasaje<br/>ProveedorPasajes<br/>PoliticaDevoluciones<br/>Puesto"]
            AD_S["serializers.py"]
            AD_V["views.py"]
        end

        subgraph "apps.support"
            SP_M["models.py<br/>Ticket<br/>TicketComment"]
            SP_S["serializers.py"]
            SP_V["views.py"]
        end

        subgraph "apps.hr"
            HR_M["models/<br/>DocumentTemplate<br/>GeneratedDocument<br/>DocumentEvent<br/>CVAnalysis<br/>CVAnalysisItem"]
            HR_S["serializers/"]
            HR_V["views/"]
            HR_SVC["services/<br/>document_service<br/>template_service<br/>cv_*<br/>assistant_*"]
            HR_T["tasks.py<br/>(cola hr_cv)"]
        end
    end

    subgraph "Frontend (React)"
        subgraph "api/"
            API_CL["client.js"]
            API_MOD["auth.js, requests.js<br/>almacen.js, suppliers.js<br/>administracion.js, hr.js<br/>support.js, users.js, ..."]
        end

        subgraph "context/"
            CTX["AuthContext.jsx<br/>ToastContext.jsx<br/>ThemeContext.jsx"]
        end

        subgraph "pages/"
            PG_AUTH["auth/"]
            PG_RQ["requests/ + approvals/<br/>+ operations/"]
            PG_WH["almacen/"]
            PG_AD["admin/"]
            PG_HR["rrhh/"]
            PG_SY["sistema/"]
            PG_SP["support/"]
        end

        subgraph "components/"
            CMP["layout/ + auth/ + ui/<br/>+ requests/ + almacen/<br/>+ rrhh/ + sistema/"]
        end
    end

    URLS --> CORE_V
    URLS --> RQ_V
    URLS --> WH_V
    URLS --> AD_V
    URLS --> SP_V
    URLS --> HR_V

    RQ_V --> RQ_SVC
    RQ_SVC --> RQ_M
    RQ_SVC --> CORE_M
    RQ_SVC --> WH_SVC
    WH_V --> WH_SVC
    HR_V --> HR_SVC
    RQ_T --> RQ_SVC
    HR_T --> HR_SVC

    API_CL --> URLS
    PG_RQ --> API_MOD
    PG_WH --> API_MOD
    PG_AD --> API_MOD
    PG_HR --> API_MOD
    PG_SY --> API_MOD
    PG_SP --> API_MOD
    API_MOD --> API_CL
```

---

*Documento de diagramas de clases de SYSPCC — PCC Ingeniería y Construcción*
*Última actualización: Octubre 2026 (código al día con SYSPCC-026)*
