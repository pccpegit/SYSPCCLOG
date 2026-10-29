# SYSPCC — Documentación Técnica del Sistema

**Sistema de Gestión de Requerimientos de Abastecimiento**
**Versión:** 1.0
**Fecha:** Octubre 2026 (actualizada al código de `develop`, tickets SYSPCC-001 a SYSPCC-026)
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

Esta sección resume los casos de uso principales. Los identificadores `CU-nn` son los mismos de `docs/01_Casos_de_Uso.md` (CU-01 a CU-52), donde está el detalle completo; por eso la numeración aquí no es correlativa.

## 1.1 Actores del Sistema

| Actor | Código | Descripción |
|-------|--------|-------------|
| Solicitante | REQUESTER | Crea requerimientos, da conformidad o reclama |
| Residente de Proyecto | PROJECT_RESIDENT | Valida técnicamente los RQ de operaciones y decide sobre los adicionales |
| Control de Proyecto | PROJECT_CONTROL | Clasifica presupuesto y aprueba el costo de la cotización (operaciones) |
| Gerente General | GENERAL_MANAGER | Aprueba adicionales, RQ fuera de plan y sobrecostos; lectura en RR. HH. |
| Coordinador Logístico | LOGISTICS_COORDINATOR | Stock, cotizaciones, OC, recepción, control de calidad, despacho, reclamos y cierre (operaciones) |
| Almacén Central | CENTRAL_WAREHOUSE | Despacha desde stock; en administración confirma la entrega y actualiza registros; importa inventario |
| Almacén de Obra | SITE_WAREHOUSE | Confirma la entrega en obra (operaciones); opera el almacén de obra |
| Jefe Directo | DIRECT_SUPERVISOR | Valida los RQ administrativos y decide sobre los RQ fuera de plan |
| Gerente Administrativo | ADMIN_MANAGER | Revisa contra el plan anual y aprueba el costo de la cotización (administrativo); pasajes |
| Supervisor Logístico | LOGISTICS_SUPERVISOR | Stock, compras, recepción, control de calidad, despacho, reclamos y cierre (administrativo) |
| Jefe Logístico | LOGISTICS_CHIEF | Compara y selecciona cotizaciones (administrativo); importa inventario |
| Gestor de Pasajes | PASAJES_MANAGER | Gestiona pasajes, pagos, políticas y proveedores de pasajes |
| Gestor de RR. HH. | HR_MANAGER | Genera contratos y analiza CVs |
| Superadministrador | `is_superuser` (no es un rol) | Gestiona usuarios, roles y proyectos (`/sistema`) |

Fuente: `backend/apps/core/enums.py` (`RoleChoices`, 13 roles) y `backend/apps/core/permissions.py` (`IsSuperUser`).

## 1.2 Casos de Uso — Módulo de Requerimientos (RQ)

### CU-01: Crear Requerimiento

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Solicitante (REQUESTER) |
| **Precondición** | Usuario autenticado |
| **Descripción** | El solicitante registra un requerimiento con sus ítems, eligiendo cada ítem del catálogo del almacén o marcándolo fuera de catálogo |
| **Flujo principal** | 1. Elige el destino: un proyecto (flujo OPERATIONS) o un departamento (flujo ADMINISTRATIVE); el frente "Oficina Central" va siempre por el flujo administrativo<br>2. Completa área solicitante (OP/QC/HSE/ADM), frente, servicio, uso específico, tipo de adquisición y fecha de necesidad<br>3. Agrega ítems: busca el producto en el catálogo del almacén o marca la línea fuera de catálogo; indica cantidad y fuente (EPP, herramientas, materiales, etc.)<br>4. Envía el formulario (`POST /api/v1/requests/`) |
| **Postcondición** | RQ creado directamente en estado SUBMITTED con número `RQ-YYYY-NNNN` generado por el servidor y un registro de aprobación DRAFT → SUBMITTED |
| **Extensiones** | E1: Al enviar, el frontend descarga el RQ en Excel (ExcelJS)<br>E2: Máximo 200 ítems por RQ |

### CU-02: Enviar Requerimiento

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Solicitante (REQUESTER) |
| **Precondición** | Ninguna adicional: el envío ocurre al crear el RQ (CU-01) |
| **Descripción** | El RQ entra al proceso de aprobación |
| **Flujo principal** | 1. La API crea el RQ en SUBMITTED y registra el `Approval` DRAFT → SUBMITTED<br>2. Si existiera un RQ en DRAFT, la acción `SUBMITTED` (rol REQUESTER) del motor de workflow lo pasa a SUBMITTED |
| **Postcondición** | RQ en estado SUBMITTED. La creación no pasa por `WorkflowEngine`, por lo que no genera notificaciones in-app |

### CU-03: Validación Técnica (Flujo Operaciones)

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Residente de Proyecto (PROJECT_RESIDENT) |
| **Precondición** | RQ en estado SUBMITTED, flujo OPERATIONS |
| **Descripción** | El residente revisa técnicamente el requerimiento y aprueba o rechaza |
| **Flujo principal** | 1. Ve lista de RQ pendientes de revisión técnica<br>2. Abre el RQ y revisa ítems, especificaciones y justificación<br>3. Aprueba → estado cambia a TECHNICAL_APPROVED<br>4. O rechaza con comentarios → estado cambia a TECHNICAL_REJECTED (terminal) |
| **Postcondición** | RQ aprobado técnicamente o rechazado |

### CU-04: Clasificación Presupuestal (Flujo Operaciones)

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Control de Proyecto (PROJECT_CONTROL) |
| **Precondición** | RQ en estado TECHNICAL_APPROVED |
| **Descripción** | Control de proyecto clasifica el gasto como dentro de propuesta o adicional |
| **Flujo principal** | 1. Revisa el RQ aprobado técnicamente<br>2. Consulta partida presupuestal del proyecto<br>3. Clasifica (`BUDGET_CLASSIFIED` con `classification=BC_WITHIN_PROPOSAL`) → WITHIN_PROPOSAL → VALIDATED automáticamente<br>4. O clasifica como adicional (`BC_ADDITIONAL`) → ADDITIONAL_REQ<br>5. O rechaza (`BUDGET_REJECTED`) → TECHNICAL_REJECTED |
| **Flujo alternativo** | Si es ADDITIONAL_REQ: el Residente aprueba → GM_REVIEW → GG aprueba → GM_APPROVED → VALIDATED (o el Residente rechaza → TECHNICAL_REJECTED) |
| **Postcondición** | RQ validado, en revisión de gerencia o rechazado |

### CU-05: Validación Administrativa (Flujo Administrativo)

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Jefe Directo (DIRECT_SUPERVISOR), Gerente Administrativo (ADMIN_MANAGER) |
| **Precondición** | RQ en estado SUBMITTED, flujo ADMINISTRATIVE |
| **Descripción** | El jefe directo aprueba y luego el gerente administrativo clasifica contra el plan anual |
| **Flujo principal** | 1. Jefe directo aprueba → SUPERVISOR_APPROVED (o rechaza → SUPERVISOR_REJECTED)<br>2. Gerente administrativo revisa contra plan anual (`ADMIN_BUDGET_REVIEWED` con `within_plan`)<br>3. WITHIN_ANNUAL_PLAN → VALIDATED automáticamente<br>4. OUT_OF_ANNUAL_PLAN → el jefe directo aprueba (→ GM_REVIEW) o rechaza (→ SUPERVISOR_REJECTED)<br>5. El gerente administrativo también puede rechazar (`ADMIN_BUDGET_REJECTED`) → SUPERVISOR_REJECTED |
| **Postcondición** | RQ validado, en revisión de gerencia o rechazado |

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
| **Actor principal** | Coordinador Logístico (OPS) / Supervisor Logístico (ADM) |
| **Precondición** | RQ en estado VALIDATED |
| **Descripción** | Logística verifica si los ítems solicitados están disponibles en almacén |
| **Flujo principal** | 1. Recibe RQ validado<br>2. Consulta la disponibilidad por línea contra el pool del almacén central (`GET /requests/{id}/stock-availability/`)<br>3. Confirma por línea el producto del catálogo o la marca fuera de catálogo, la fuente y el origen de atención (`PATCH /requests/{id}/update-items/`)<br>4. Ejecuta `STOCK_CHECKED` con `has_stock=true` → IN_STOCK, o `has_stock=false` → REQUIRES_PURCHASE |
| **Postcondición** | RQ derivado a despacho o a proceso de cotización |

### CU-08: Gestión de Cotizaciones

| Campo | Detalle |
|-------|---------|
| **Actor principal** | OPS: Coordinador Logístico. ADM: Supervisor Logístico (solicita) y Jefe Logístico (compara y selecciona) |
| **Precondición** | RQ en estado REQUIRES_PURCHASE |
| **Descripción** | Logística solicita cotizaciones a proveedores, compara y selecciona la mejor opción |
| **Flujo principal** | 1. Solicita cotizaciones → QUOTING<br>2. Registra cotizaciones de proveedores (`/quotations/`)<br>3. Compara precios, plazos y condiciones → QUOTE_COMPARISON<br>4. Selecciona cotización ganadora → QUOTE_SELECTED<br>5. Control de Proyecto (OPS) o Gerente Administrativo (ADM) aprueba el costo → QUOTE_COST_APPROVED |
| **Flujo alternativo** | Si rechaza el costo → COST_OVERRUN_REVIEW → GG aprueba (COST_OVERRUN_APPROVED) o rechaza (COST_OVERRUN_REJECTED, terminal) |
| **Postcondición** | Cotización seleccionada y aprobada, lista para generar orden de compra |

### CU-09: Generar Orden de Compra

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Coordinador Logístico (OPS) / Supervisor Logístico (ADM) |
| **Precondición** | RQ en estado QUOTE_COST_APPROVED o COST_OVERRUN_APPROVED |
| **Descripción** | Genera la orden de compra formal al proveedor seleccionado |
| **Flujo principal** | 1. Registra la OC (`POST /purchase-orders/`); el servidor asigna el número `OC-YYYY-NNNN`<br>2. Registra proveedor, ítems, montos y condiciones<br>3. Ejecuta la acción `PO_GENERATED` → PO_GENERATED |
| **Postcondición** | Orden de compra registrada. El sistema no notifica al proveedor |

### CU-10: Recepción y Control de Calidad

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Coordinador Logístico (OPS) / Supervisor Logístico (ADM) |
| **Precondición** | RQ en estado PO_GENERATED |
| **Descripción** | Recibe mercadería del proveedor y realiza control de calidad |
| **Flujo principal** | 1. Recibe mercadería (`RECEIVED`) → RECEIVING; el sistema registra un vale de ingreso al almacén central y un `WarehouseReceipt` con los ítems de compra vinculados al catálogo<br>2. Inspecciona calidad, cantidades y especificaciones<br>3. QC aprobado → QUALITY_APPROVED<br>4. QC rechazado → QUALITY_REJECTED → ciclo de reclamo al proveedor (SUPPLIER_CLAIM_SENT → [SUPPLIER_CLAIM_PENDING, solo OPS] → SUPPLIER_REPLACEMENT_RECEIVED → nuevo QC) |
| **Postcondición** | Mercadería aprobada lista para despacho, o reclamo iniciado al proveedor |

### CU-11: Despacho y Entrega

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central, Almacén de Obra, Coordinador / Supervisor Logístico |
| **Precondición** | RQ en estado IN_STOCK o QUALITY_APPROVED |
| **Descripción** | Se despachan los materiales y se registra la entrega |
| **Flujo principal** | OPS: desde IN_STOCK el Almacén Central despacha → DISPATCHED_TO_SITE; desde QUALITY_APPROVED el Coordinador Logístico despacha → DISPATCHED_TO_SITE; el Almacén de Obra confirma → DELIVERED<br>ADM: desde IN_STOCK el Almacén Central despacha → DELIVERED (directo); desde QUALITY_APPROVED el Supervisor Logístico despacha → DISPATCHED_TO_SITE; el Almacén Central confirma → DELIVERED y luego actualiza registros → WAREHOUSE_UPDATED |
| **Postcondición** | Materiales entregados. Cada despacho (`DISPATCHED`) registra un vale de egreso y un `WarehouseDispatch` para los ítems vinculados al catálogo |

### CU-12: Conformidad del Usuario

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Solicitante (REQUESTER) |
| **Precondición** | OPS: RQ en DELIVERED. ADM: RQ en WAREHOUSE_UPDATED |
| **Descripción** | El solicitante verifica que los materiales recibidos son correctos |
| **Flujo principal** | 1. Revisa materiales entregados<br>2. Confirma conformidad → USER_CONFORMITY<br>3. O presenta reclamo → CLAIM_IN_REVIEW; logística envía el reclamo al proveedor → SUPPLIER_CLAIM_SENT |
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
| **Actor principal** | Usuario que puede ver el RQ y declara un rol que tiene asignado (la transición no exige un rol específico) |
| **Precondición** | RQ en cualquier estado no terminal |
| **Descripción** | Cancela un requerimiento en curso |
| **Flujo principal** | 1. Selecciona RQ activo<br>2. Ejecuta la acción `CANCELLED` con comentario opcional<br>3. Estado cambia a CANCELLED<br>4. Presupuesto comprometido se libera |
| **Postcondición** | RQ cancelado, presupuesto liberado |

## 1.3 Casos de Uso — Módulo de Almacén

Acceso al módulo: CENTRAL_WAREHOUSE, SITE_WAREHOUSE, LOGISTICS_COORDINATOR, LOGISTICS_SUPERVISOR y LOGISTICS_CHIEF (`IsWarehouseRole`). El Almacén de Obra solo opera el almacén `SITE`.

### CU-15: Registrar Entrada de Mercadería

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Personal de almacén y logística |
| **Precondición** | Producto registrado en el catálogo |
| **Descripción** | Registra el ingreso de productos al almacén con su documentación |
| **Flujo principal** | 1. Recibe mercadería del proveedor<br>2. Valida documentos (guía de remisión, factura)<br>3. Cuenta bultos y verifica cantidades<br>4. Registra el ingreso, individual o por lote, con PO, guía de remisión y TAG (tipo ENTRY)<br>5. El sistema actualiza el stock y genera un vale (`MovementGroup`) |
| **Postcondición** | Stock actualizado, movimiento de entrada registrado |

### CU-17: Asignar Ubicaciones

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central / Jefe Logístico |
| **Precondición** | Productos sin ubicación exacta (solo piso o sin dato) |
| **Descripción** | Asigna la ubicación física con el formato `{Pabellón}{Sección}-{Nivel}` (por ejemplo B3-2) |
| **Flujo principal** | 1. Identifica productos sin ubicación exacta<br>2. Elige pabellón, sección y nivel según el layout del almacén (`GET /warehouse/inventory/location-layout/`)<br>3. Guarda (`POST /warehouse/inventory/assign-locations/`) |
| **Postcondición** | Producto con ubicación exacta registrada |

### CU-19: Registrar Salida de Mercadería

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Personal de almacén y logística |
| **Precondición** | Stock disponible |
| **Descripción** | Prepara y despacha materiales |
| **Flujo principal** | 1. Recibe el requerimiento o pedido<br>2. Localiza productos por ubicación (pabellón-sección-nivel)<br>3. Extrae y verifica cantidades<br>4. Registra el egreso, individual o por lote (tipo EXIT), con destino (proyecto, departamento, trabajador, transferencia) y N° de vale<br>5. El sistema descuenta stock con bloqueo de fila y genera el vale imprimible (PDF) |
| **Postcondición** | Stock descontado, vale de salida generado |

### CU-21: Consultar Kardex de Producto

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Personal de almacén y logística |
| **Precondición** | Producto registrado en inventario |
| **Descripción** | Consulta historial completo de movimientos de un producto |
| **Flujo principal** | 1. Busca producto por código o descripción<br>2. Visualiza el kardex con ingresos, egresos y ajustes<br>3. Filtra por rango de fechas (`date_from`, `date_to`), tipo de movimiento o almacén<br>4. Consulta el resumen de movimiento de todo el inventario (inventario inicial, ingresos, egresos y stock actual) y lo exporta a Excel (CU-45) |
| **Postcondición** | Información de trazabilidad visualizada |

### CU-22: Transferencia Interna entre Pisos

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central / Almacén de Obra |
| **Precondición** | Producto con stock disponible |
| **Descripción** | Registra el traslado de materiales a otro piso del almacén |
| **Flujo principal** | 1. Selecciona productos y cantidades<br>2. Indica piso de origen y de destino<br>3. El sistema registra un egreso por lote con destino `TRANSFER_OUT` («ALM - PRIMER PISO» / «ALM - SEGUNDO PISO») |
| **Postcondición** | Stock descontado del almacén operado y salida registrada como transferencia; el sistema no crea un ingreso en el destino |

### CU-43: Entregar EPP con Vale

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central / Almacén de Obra |
| **Precondición** | Trabajador registrado en `Personal`; stock disponible |
| **Descripción** | Entrega en mostrador de EPP a un trabajador contra un vale firmado (SYSPCC-025) |
| **Flujo principal** | 1. Busca al trabajador<br>2. Agrega los ítems y cantidades<br>3. Registra la entrega (`POST /warehouse/movements/epp-delivery/`) |
| **Postcondición** | Egreso registrado con vale; no cambia el estado de ningún RQ |

### CU-44: Importar el Excel de Inventario

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Almacén Central / Jefe Logístico |
| **Precondición** | Libro "INVENTARIO PCC - ALM" en formato `.xlsx` |
| **Descripción** | Carga el catálogo, el inventario inicial, los ingresos y los egresos desde el Excel real del almacén (SYSPCC-025) |
| **Flujo principal** | 1. Sube el libro (paso 1): el sistema lo valida y muestra una previsualización con resumen y problemas<br>2. Revisa los problemas (exportables a Excel)<br>3. Confirma (paso 2): la importación se aplica en una sola transacción, de forma idempotente<br>4. Opcionalmente vincula destinos de texto con trabajadores (CU-46) |
| **Postcondición** | Catálogo, movimientos y stock cargados; las previsualizaciones vencidas y los libros guardados se purgan cada día |

## 1.4 Casos de Uso — Módulo de Administración

Acceso: ADMIN_MANAGER, GENERAL_MANAGER, PASAJES_MANAGER o usuarios `is_staff` (`IsAdminOrAdminManager`).

### CU-24 a CU-26: Gestionar Pasajes

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Gestor de Pasajes, Gerente Administrativo, Gerente General |
| **Precondición** | Usuario autenticado con acceso al módulo administrativo |
| **Descripción** | Registra y gestiona boletos de viaje del personal |
| **Flujo principal** | 1. Registra datos del viaje (embarque, destino, fechas)<br>2. Asocia al personal por DNI<br>3. Registra proveedor y factura<br>4. Registra montos con IGV en soles o dólares y el tipo de cambio (consulta del tipo de cambio SUNAT disponible)<br>5. Calcula la devolución según la política vigente<br>6. Marca el pasaje como pagado |
| **Postcondición** | Pasaje registrado con total calculado en soles |

### CU-28: Configurar Políticas de Devolución

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Gestor de Pasajes, Gerente Administrativo, Gerente General |
| **Precondición** | Acceso al módulo de administración |
| **Descripción** | Define montos de devolución por tipo de trabajador y tramo |
| **Flujo principal** | 1. Crea/edita política indicando tipo trabajador (STAFF/WORKER)<br>2. Indica tramo de viaje<br>3. Define montos en soles y dólares<br>4. Indica si aplica devolución<br>5. Activa o desactiva política |
| **Postcondición** | Política aplicable a futuros registros de pasajes |

## 1.5 Casos de Uso — Módulo de Soporte TI

### CU-30: Crear Ticket de Soporte

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Cualquier usuario autenticado |
| **Precondición** | Usuario autenticado |
| **Descripción** | Reporta un problema o solicitud de soporte técnico |
| **Flujo principal** | 1. Selecciona categoría (HARDWARE/SOFTWARE/NETWORK/ACCESS/EMAIL/PRINTER/OTHER)<br>2. Indica prioridad (LOW/MEDIUM/HIGH/CRITICAL)<br>3. Describe el problema<br>4. Sistema genera número de ticket (TK-YYYYMMDD-XXXX) |
| **Postcondición** | Ticket creado en estado OPEN. Cada usuario ve sus tickets y los usuarios `is_staff` ven todos; cada cambio de estado queda registrado como comentario |

## 1.6 Casos de Uso — Autenticación

### CU-35: Iniciar Sesión

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Cualquier usuario |
| **Precondición** | Usuario registrado y activo |
| **Descripción** | Autenticación mediante credenciales con JWT en cookies |
| **Flujo principal** | 1. La aplicación obtiene la cookie CSRF (`GET /auth/csrf/`)<br>2. Ingresa usuario y contraseña<br>3. Sistema valida credenciales<br>4. Genera tokens JWT (access 15 min + refresh 1 día) y los guarda en cookies HttpOnly<br>5. Redirige al selector de módulos (o a `/cambiar-password` si la cuenta debe cambiar su contraseña) |
| **Restricción** | Máximo 5 intentos/minuto por IP y 10/minuto por nombre de usuario (rate limiting) |
| **Postcondición** | Sesión activa con tokens JWT en cookies seguras |

### CU-37: Seleccionar Módulo del Sistema

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Usuario autenticado |
| **Precondición** | Sesión activa |
| **Descripción** | Selecciona a qué módulo acceder según sus roles |
| **Flujo principal** | 1. Sistema muestra módulos disponibles filtrados por roles del usuario<br>2. Módulos: Requerimientos, Almacén, Soporte TI, Recursos Humanos, Administración y Administración del Sistema (solo superusuario); Business Intelligence figura como no disponible<br>3. Usuario selecciona módulo<br>4. Sistema carga el shell y sidebar correspondiente |
| **Postcondición** | Usuario en el dashboard del módulo seleccionado |

### CU-38: Cambiar Contraseña Forzado

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Usuario con `must_change_password` activo |
| **Precondición** | Cuenta recién creada o contraseña reseteada por el superadministrador |
| **Descripción** | El usuario debe definir una contraseña nueva antes de usar el sistema (SYSPCC-018) |
| **Flujo principal** | 1. Tras el login se le redirige a `/cambiar-password`<br>2. Ingresa la contraseña actual y la nueva (mínimo 12 caracteres)<br>3. Hasta completarlo, el backend responde 403 a cualquier otra petición |
| **Postcondición** | Contraseña actualizada y acceso normal |

## 1.7 Casos de Uso — Recursos Humanos

Acceso: HR_MANAGER (escritura y lectura) y GENERAL_MANAGER (solo lectura).

### CU-48: Generar Contrato de Trabajo

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Gestor de RR. HH. (HR_MANAGER) |
| **Precondición** | Plantilla Word de contrato activa; trabajador registrado en `Personal` |
| **Descripción** | Genera un contrato a partir de una plantilla aprobada y los datos del trabajador (SYSPCC-022) |
| **Flujo principal** | 1. Elige al trabajador; el sistema precarga sus datos<br>2. Completa el formulario o usa el asistente, que extrae datos de un pedido en texto libre y pregunta lo faltante<br>3. Guarda el borrador (DRAFT) y revisa el Word generado<br>4. Emite (ISSUED) o anula (VOIDED) el documento; el PDF se genera si LibreOffice está disponible |
| **Postcondición** | Documento con historial de eventos (`DocumentEvent`) |

### CU-49: Analizar CVs en Lote

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Gestor de RR. HH. (HR_MANAGER) |
| **Precondición** | Proceso de selección creado |
| **Descripción** | Lee muchos CV (PDF, Word o imagen) en segundo plano y genera un reporte por candidato (SYSPCC-023) |
| **Flujo principal** | 1. Define el puesto: requisitos escritos o extraídos de la convocatoria<br>2. Sube los CV; cada uno se valida y entra a la cola `hr_cv`<br>3. El sistema analiza cada CV y asigna puntaje y recomendación (avanzar / revisar / no avanzar)<br>4. Revisa el ranking y descarga PDF por candidato, ZIP o Excel |
| **Postcondición** | Reporte por candidato; la recomendación es una sugerencia y la decisión la toma una persona |

## 1.8 Casos de Uso — Administración del Sistema

### CU-50 y CU-51: Gestionar Usuarios, Roles y Proyectos

| Campo | Detalle |
|-------|---------|
| **Actor principal** | Superadministrador (`is_superuser`) |
| **Precondición** | Sesión de superusuario |
| **Descripción** | Administra cuentas, asignación de roles y proyectos (SYSPCC-018) |
| **Flujo principal** | 1. Crea o edita usuarios y les asigna roles (opcionalmente por proyecto o departamento)<br>2. Activa o desactiva usuarios (no se eliminan)<br>3. Resetea contraseñas: el sistema muestra una contraseña temporal y obliga a cambiarla<br>4. Crea, edita, activa o desactiva proyectos (no se eliminan) |
| **Postcondición** | Usuarios y proyectos actualizados |

---

# 2. Arquitectura de Alto Nivel

## 2.1 Vista General del Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USUARIOS FINALES                            │
│  Solicitantes · Residentes · Control · GG · Logística · Almacén    │
│  Administración · RR. HH. · Soporte · Superadministrador           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CAPA DE PRESENTACIÓN                             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              React 19 SPA + Tailwind CSS 4                    │  │
│  │                                                               │  │
│  │  Selector de módulos (/)                                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │  │
│  │  │ RQ       │ │ Almacén  │ │ Admin    │ │ Soporte TI       │ │  │
│  │  │ AppShell │ │Warehouse │ │AdminShell│ │ SupportShell     │ │  │
│  │  │          │ │ Shell    │ │          │ │                  │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │  │
│  │  ┌──────────────────┐ ┌─────────────────────────┐            │  │
│  │  │ RR. HH.          │ │ Administración Sistema  │            │  │
│  │  │ HRShell          │ │ SystemAdminShell        │            │  │
│  │  └──────────────────┘ └─────────────────────────┘            │  │
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
│  │  ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌──────────────┐     │  │
│  │  │  core   │ │   rq    │ │ warehouse │ │administracion│     │  │
│  │  │         │ │         │ │           │ │              │     │  │
│  │  │ Auth    │ │Requests │ │ Catálogo  │ │ Pasajes      │     │  │
│  │  │ Users   │ │Approvals│ │ Movim.    │ │ Políticas    │     │  │
│  │  │ Projects│ │Suppliers│ │ Vales/EPP │ │ Proveedores  │     │  │
│  │  │ Depts   │ │Quotation│ │ Kardex    │ │ Puestos      │     │  │
│  │  │ Personal│ │PO's     │ │ Import.   │ │              │     │  │
│  │  │         │ │Claims   │ │ OneDrive  │ │              │     │  │
│  │  └─────────┘ └─────────┘ └───────────┘ └──────────────┘     │  │
│  │                                                               │  │
│  │  ┌───────────────────────┐ ┌───────────────┐ ┌─────────────┐ │  │
│  │  │ hr                    │ │ support       │ │ Servicios   │ │  │
│  │  │ Contratos · CVs       │ │ Tickets       │ │             │ │  │
│  │  └───────────────────────┘ └───────────────┘ │WorkflowEng. │ │  │
│  │                                              │BudgetValid. │ │  │
│  │  Auth: Cookie JWT (SimpleJWT) + CSRF         │SLACalculator│ │  │
│  │  Permisos: RBAC por ViewSet                  │NumberGen.   │ │  │
│  │  Docs: OpenAPI 3.0 (drf-spectacular)         │Notification │ │  │
│  │                                              └─────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────┬──────────────────────────┬───────────────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────┐  ┌───────────────────────────────────────┐
│   CAPA DE DATOS          │  │   CAPA DE INFRAESTRUCTURA             │
│                          │  │                                       │
│  ┌────────────────────┐  │  │  ┌─────────────────────────────────┐  │
│  │ PostgreSQL (prod.) │  │  │  │ Redis 7                         │  │
│  │ SQLite (desarrollo)│  │  │  │                                 │  │
│  │                    │  │  │  │  DB 0: Cache (django-redis)     │  │
│  │ - Usuarios/Roles   │  │  │  │  DB 1: Celery Broker            │  │
│  │ - Proyectos        │  │  │  │  DB 2: Celery Results           │  │
│  │ - Requerimientos   │  │  │  │  Sessions: Redis-backed         │  │
│  │ - Aprobaciones     │  │  │  └─────────────────────────────────┘  │
│  │ - Inventario       │  │  │                                       │
│  │ - Movimientos      │  │  │  ┌─────────────────────────────────┐  │
│  │ - Pasajes          │  │  │  │ Celery 5.4                      │  │
│  │ - RR. HH.          │  │  │  │                                 │  │
│  │ - Tickets          │  │  │  │  Worker: cola por defecto       │  │
│  └────────────────────┘  │  │  │  Worker hr_cv: análisis de CVs  │  │
│                          │  │  │  Beat: tareas programadas (3.7) │  │
│  Producción (defaults):  │  │  └─────────────────────────────────┘  │
│  sslmode=require         │  │                                       │
│  Puerto: 25060           │  │  ┌─────────────────────────────────┐  │
└──────────────────────────┘  │  │ Servicios externos              │  │
                              │  │ OneDrive (Graph API): PDF de    │  │
                              │  │   vales, opcional               │  │
                              │  │ Anthropic API: asistente de     │  │
                              │  │   contratos y análisis de CVs   │  │
                              │  │ apis.net.pe: tipo de cambio     │  │
                              │  │ apisperu.com: consulta de RUC   │  │
                              │  └─────────────────────────────────┘  │
                              └───────────────────────────────────────┘
```

Fuentes: `backend/config/settings/base.py` (`LOCAL_APPS`, `CACHES`, `CELERY_*`, `RUC_API_URL`, `ANTHROPIC_API_KEY`), `backend/config/settings/production.py`, `backend/apps/administracion/views.py` (tipo de cambio), `frontend/src/App.jsx`.

## 2.2 Flujo de Comunicación

```
Desarrollo (docker-compose.yml):
Browser ──▶ Vite dev server :5173 (SPA)
   │            └── proxy /api y /media ──▶ Django runserver :8000
   └── /api/v1/* (VITE_API_URL) ─────────▶ Django runserver :8000 ──▶ SQLite / PostgreSQL

Producción (scripts/do-start.sh, scripts/render-start.sh):
Browser ──▶ SPA compilada (npm run build)
   └── /api/v1/* ──▶ Gunicorn (config.wsgi) ──▶ PostgreSQL
                     WhiteNoise sirve /static/ desde el contenedor

Tareas en segundo plano:
Django ──(encola)──▶ Redis (broker) ──▶ Celery worker (cola por defecto)
                                   └──▶ Celery worker hr_cv (análisis de CVs)
Celery Beat ──(programa)──▶ Redis (broker) ──▶ Celery worker ──▶ Django ORM
```

## 2.3 Módulos del Sistema

| Módulo | Ruta Frontend | App Backend | Descripción |
|--------|--------------|-------------|-------------|
| Requerimientos (RQ) | `/rq/*` | `apps.rq` | Ciclo de vida de requerimientos, aprobaciones, cotizaciones, OC y reclamos; ítems vinculados al catálogo del almacén |
| Almacén | `/almacen/*` | `apps.warehouse` | Catálogo e inventario de EPP, ingresos, egresos y entregas de EPP con vale, transferencias entre pisos, kardex y resumen de movimiento, importación del Excel, RQ pendientes |
| Administración | `/admin/*` | `apps.administracion` | Pasajes, pagos, políticas de devolución y proveedores de pasajes |
| Recursos Humanos | `/rrhh/*` | `apps.hr` | Contratos desde plantillas Word y análisis masivo de CVs |
| Administración del Sistema | `/sistema/*` | `apps.core` | Usuarios, roles y proyectos (solo superusuario) |
| Soporte TI | `/soporte/*` | `apps.support` | Tickets de soporte técnico interno |
| Core | — | `apps.core` | Autenticación, usuarios, roles, proyectos, departamentos, plan anual, personal |

---

# 3. Arquitectura de Bajo Nivel

## 3.1 Backend — Estructura de Capas

```
┌─────────────────────────────────────────────────────┐
│                    URLS (Routing)                    │
│  config/urls.py → apps/<app>/urls.py (o urls/)      │
│  Router DRF: DefaultRouter                          │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                   VIEWS (ViewSets)                   │
│                                                     │
│  apps/<app>/views/<entity>.py (o views.py)          │
│                                                     │
│  • ModelViewSet / GenericViewSet / ViewSet          │
│  • Permission classes (IsLogisticsStaff,            │
│    IsWarehouseRole, IsSuperUser, CanPerform...)     │
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
│  (o serializers.py)                                 │
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
│  │ • Fecha estimada│ │ • RQ-YYYY-NNNN │           │
│  │ • Tipo adquis.  │ │ • OC-YYYY-NNNN │           │
│  └─────────────────┘ └─────────────────┘           │
│  Almacén: movements, kardex, epp, imports/, ...     │
│  RR. HH.: template/document/cv_* services           │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                  MODELS (ORM Django)                  │
│                                                     │
│  apps/<app>/models/<entity>.py (o models.py)        │
│  Re-exports via apps/<app>/models/__init__.py       │
│                                                     │
│  • Campos tipados con validaciones                  │
│  • Relaciones FK con constraints                    │
│  • Índices para queries frecuentes                  │
│  • Propiedades calculadas                           │
│  • Métodos save() con lógica auto-cálculo           │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│     DATABASE (SQLite en desarrollo / PostgreSQL)     │
│                                                     │
│  Migraciones: apps/<app>/migrations/                │
│  Índices automáticos + índices manuales (Meta)      │
└─────────────────────────────────────────────────────┘
```

## 3.2 Frontend — Estructura de Componentes

```
┌─────────────────────────────────────────────────────────┐
│                   App.jsx (Raíz)                         │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ThemeProvider (ThemeContext)                     │    │
│  │  ┌─────────────────────────────────────────┐    │    │
│  │  │ ToastProvider (ToastContext)             │    │    │
│  │  │  ┌─────────────────────────────────┐    │    │    │
│  │  │  │ AuthProvider (AuthContext)       │    │    │    │
│  │  │  │  ┌─────────────────────────┐    │    │    │    │
│  │  │  │  │ BrowserRouter → Routes  │    │    │    │    │
│  │  │  │  └─────────────────────────┘    │    │    │    │
│  │  │  └─────────────────────────────────┘    │    │    │
│  │  └─────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

Shells (Layout por módulo, color de acento del sidebar):
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐
│  AppShell   │ │ Warehouse   │ │ AdminShell  │ │ SupportShell │ │ SystemAdmin  │ │  HRShell    │
│  (azul)     │ │ Shell       │ │ (índigo)    │ │ (teal)       │ │ Shell (rosa) │ │  (violeta)  │
│             │ │ (esmeralda) │ │             │ │              │ │              │ │             │
│ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌──────────┐ │ │ ┌──────────┐ │ │ ┌─────────┐ │
│ │ Header  │ │ │ │ Header  │ │ │ │ Header  │ │ │ │ Header   │ │ │ │ Header   │ │ │ │ Header  │ │
│ │ Sidebar │ │ │ │WhSidebar│ │ │ │AdmSideb.│ │ │ │SupSideb. │ │ │ │SysSideb. │ │ │ │HRSidebar│ │
│ │ Outlet  │ │ │ │ Outlet  │ │ │ │ Outlet  │ │ │ │ Outlet   │ │ │ │ Outlet   │ │ │ │ Outlet  │ │
│ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │ │ └──────────┘ │ │ └──────────┘ │ │ └─────────┘ │
└─────────────┘ └─────────────┘ └─────────────┘ └──────────────┘ └──────────────┘ └─────────────┘
```

El tema claro/oscuro (SYSPCC-020) se aplica con la clase `.dark` en `<html>`; el `Header` común incluye el botón de tema y `/settings` permite elegir modo claro, oscuro o automático por horario.

## 3.3 Capa API — Comunicación Frontend ↔ Backend

```
Frontend (Axios)                    Backend (DRF)
────────────────                    ─────────────
api/client.js                       config/urls.py
  │                                   │
  │ axios.create({                    │ urlpatterns = [
  │   baseURL: VITE_API_URL,          │   path('api/v1/', include([
  │   withCredentials: true           │     path('auth/', ...),
  │ })                                │     path('', include('apps.rq.urls')),
  │                                   │     path('warehouse/', ...),
  │ Interceptor de request:           │     path('hr/', ...), ...
  │   → X-CSRFToken en POST/PUT/...   │   ])),
  │ Interceptor 401:                  │ ]
  │   → POST auth/token/refresh/      │
  │   → retry request                 │
  │   → queue concurrent 401s         │
  │                                   │
  ▼                                   ▼
api/requests.js                     apps/rq/views/request.py
  │                                   │
  │ getRequests(params)               │ class RequestViewSet(ModelViewSet):
  │ createRequest(data)               │   get_queryset → get_accessible_requests_queryset(user)
  │ performAction(id, {action,        │   permission_classes = [IsAuthenticated]
  │   acting_role, comments,          │   filterset_class = RequestFilter
  │   extra_data})                    │
  │                                   │   @action(detail=True, methods=['post'], url_path='action')
  │                                   │   def execute_action(self, request, pk):
  │                                   │       WorkflowEngine(rq, user, acting_role).execute(...)
  └───────── POST /requests/{id}/action/ ──────────┘
```

Para `execute_action` la vista usa `CanPerformWorkflowAction` (el usuario debe tener el `acting_role` que declara) y el motor vuelve a validar el rol.

## 3.4 Motor de Workflow — Máquina de Estados

Implementación: `backend/apps/rq/services/workflow_engine.py` (`TRANSITIONS`, 71 entradas). `RQStatusChoices` define 47 estados, de los cuales 10 no tienen transición (`TECHNICAL_REVIEW`, `BUDGET_REVIEW`, `SUPERVISOR_REVIEW`, `ADMIN_BUDGET_REVIEW`, `STOCK_CHECK`, `QUALITY_CHECK`, `RECEPTION_CONFORMITY`, `RECEPTION_CLAIM`, `USER_CLAIM`, `CLAIM_RESOLVED`). La definición de negocio está en `CLAUDE.md` y la tabla completa con roles en `docs/architecture/system-architecture.md` (§3.3).

```
FASE 1-2: SOLICITUD Y VALIDACIÓN

  DRAFT ──submit──▶ SUBMITTED        (la API crea el RQ ya en SUBMITTED)
                        │
         ┌──────────────┴───────────────────┐
         │ OPERATIONS                        │ ADMINISTRATIVE
         ▼                                   ▼
  TECHNICAL_APPROVED                  SUPERVISOR_APPROVED
     │           │                       │              │
     ▼           ▼                       ▼              ▼
 WITHIN_      ADDITIONAL_REQ         WITHIN_        OUT_OF_ANNUAL_PLAN
 PROPOSAL        │ (Residente)       ANNUAL_PLAN        │ (Jefe Directo)
     │           ▼                       │              ▼
     │       GM_REVIEW ─▶ GM_APPROVED    │          GM_REVIEW ─▶ GM_APPROVED
     │                       │           │                          │
     └──────────┬────────────┘           └────────────┬─────────────┘
                ▼                                     ▼
            VALIDATED (automático)                VALIDATED (automático)

FASE 3: LOGÍSTICA Y COMPRAS (ambos flujos)

  VALIDATED ─┬─▶ IN_STOCK ─(Almacén Central)─▶ OPS: DISPATCHED_TO_SITE · ADM: DELIVERED
             └─▶ REQUIRES_PURCHASE ─▶ QUOTING ─▶ QUOTE_COMPARISON ─▶ QUOTE_SELECTED
                   QUOTE_SELECTED ─┬─▶ QUOTE_COST_APPROVED ─────────────────────┐
                                   └─▶ COST_OVERRUN_REVIEW ─┬─▶ COST_OVERRUN_APPROVED ─┤
                                                            └─▶ COST_OVERRUN_REJECTED  │
                                                                     PO_GENERATED ◀────┘

FASE 4: RECEPCIÓN Y ENTREGA

  PO_GENERATED ─▶ RECEIVING ─┬─▶ QUALITY_APPROVED ─▶ DISPATCHED_TO_SITE ─▶ DELIVERED
                             └─▶ QUALITY_REJECTED ─▶ SUPPLIER_CLAIM_SENT
                                   ─▶ [SUPPLIER_CLAIM_PENDING, solo OPS]
                                   ─▶ SUPPLIER_REPLACEMENT_RECEIVED ─▶ QUALITY_APPROVED | QUALITY_REJECTED
  ADM: DELIVERED ─(Almacén Central)─▶ WAREHOUSE_UPDATED

FASE 5: CONFORMIDAD Y CIERRE

  OPS: DELIVERED ──────────┬─▶ USER_CONFORMITY ─▶ CLOSED
  ADM: WAREHOUSE_UPDATED ──┴─▶ CLAIM_IN_REVIEW ─▶ SUPPLIER_CLAIM_SENT (reinicia el ciclo de reclamo)

Rechazos terminales: TECHNICAL_REJECTED, SUPERVISOR_REJECTED, GM_REJECTED, COST_OVERRUN_REJECTED
Universal: cualquier estado no terminal ─▶ CANCELLED
```

## 3.5 Modelo de Autenticación

```
┌──────────┐   GET /auth/csrf/         ┌──────────────┐
│  Browser │ ──────────────────────▶   │   Django     │
│          │  ◀── Set-Cookie: csrftoken│              │
│          │                           │              │
│          │   POST /auth/login/       │              │
│          │   (X-CSRFToken)           │  SimpleJWT   │
│          │ ──────────────────────▶   │  + Cookie    │
│          │  ◀── Set-Cookie:          │  Auth Class  │
│          │      access_token (15m)   │              │
│          │      refresh_token (1d)   │              │
│          │      HttpOnly, Lax        │              │
│          │      Secure si DEBUG=False│              │
└──────────┘                           └──────────────┘

Peticiones autenticadas (cookies JWT HttpOnly, SameSite=Lax):
  CookieJWTAuthentication lee access_token de la cookie
  POST/PUT/PATCH/DELETE exigen X-CSRFToken (SYSPCC-015)
  must_change_password = true → 403 salvo la lista permitida (SYSPCC-018)

Refresh (interceptor 401 de Axios):
  POST /auth/token/refresh/ con cuerpo {}
  → TokenRefreshView estándar de SimpleJWT lee `refresh` del cuerpo, no de la cookie
  → hoy no renueva la sesión (limitación conocida,
    ver apps/core/tests/test_must_change_password_gate.py)

Logout:
  POST /auth/logout/ → blacklist del refresh token + borrado de cookies
```

## 3.6 Estructura de la Base de Datos — Relaciones

```
                    ┌──────────┐
                    │   User   │
                    └─────┬────┘
                          │ 1:N
                    ┌─────┴────┐
                    │ UserRole │──── role (enum, 13 roles)
                    └─────┬────┘     project (FK, nullable)
                          │          department_obj (FK, nullable)
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   ┌─────────┐     ┌──────────┐      ┌────────────┐
   │ Project │     │Department│      │  Personal  │── user (1:1, nullable)
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
│  │          │  1:N  Approval (audit trail) · ActivityLog           │
│  │          │  1:N  Attachment · Notification · Claim              │
│  │          │                                                      │
│  │          │  1:N  ┌──────────────┐  1:N  ┌───────────────┐      │
│  │          │───────│  Quotation   │───────│ QuotationItem │      │
│  │          │       └──────┬───────┘       └───────────────┘      │
│  │          │              │ FK                                    │
│  │          │  1:N  ┌──────┴───────┐  1:N  ┌─────────────────┐   │
│  │          │───────│PurchaseOrder │───────│PurchaseOrderItem│   │
│  │          │       └──────┬───────┘       └─────────────────┘   │
│  │          │              │ FK                                    │
│  │          │       ┌──────┴───┐                                   │
│  │          │       │ Supplier │ (FK desde Quotation y            │
│  │          │       └──────────┘  PurchaseOrder)                   │
│  │          │                                                      │
│  │          │  1:N  WarehouseReceipt · WarehouseDispatch (almacén) │
│  └──────────┘                                                      │
└────────────────────────────────────────────────────────────────────┘

┌──────────────────────────── WAREHOUSE ─────────────────────────────┐
│                                                                    │
│  ┌───────────┐  1:N  ┌───────────────┐                             │
│  │ Inventory │───────│InventoryStock │  (warehouse_type, project,  │
│  │ (catálogo)│       └───────────────┘   department; quantity ≥ 0) │
│  │           │                                                     │
│  │           │  1:N  ┌───────────────────┐  N:1  ┌──────────────┐  │
│  │           │───────│ InventoryMovement │───────│MovementGroup │  │
│  └───────────┘       └─────────┬─────────┘       │   (Vale)     │  │
│                                │ N:1             └──────┬───────┘  │
│                       ┌────────┴────────┐               │ 1:1      │
│                       │ InventoryImport │   WarehouseReceipt /      │
│                       │ (Excel, UUID)   │   WarehouseDispatch       │
│                       └─────────────────┘   (ligados a Request)     │
│                                                                    │
│  OneDriveToken (tokens cifrados en reposo)                         │
└────────────────────────────────────────────────────────────────────┘

┌──────────────────────── ADMINISTRACIÓN ────────────────────────────┐
│  Pasaje ── personal (FK Personal) · proveedor (FK ProveedorPasajes)│
│         ── centro_costo (FK Project)                               │
│  PoliticaPasajeDevoluciones · ProveedorPasajes · Puesto            │
└────────────────────────────────────────────────────────────────────┘

┌────────────── RR. HH. ──────────────────┐    ┌──────── SOPORTE ───────┐
│  DocumentTemplate 1:N GeneratedDocument │    │  Ticket 1:N            │
│  GeneratedDocument 1:N DocumentEvent    │    │  TicketComment         │
│  GeneratedDocument N:1 Personal         │    └────────────────────────┘
│  CVAnalysis 1:N CVAnalysisItem          │
└─────────────────────────────────────────┘
```

## 3.7 Tareas Programadas (Celery Beat)

| Tarea | Horario (Lima) | Descripción |
|-------|----------------|-------------|
| `check-sla-deadlines` | 8:00 AM | Notificación in-app al solicitante por RQ vencidos o próximos a su fecha estimada de entrega |
| `send-pending-approval-reminders` | 9:00 AM y 2:00 PM | Recordatorio in-app de RQ sin cambios por más de 24 horas en estados de revisión |
| `invalidate-dashboard-caches` | Cada 15 minutos | Limpia caches de dashboards para datos actualizados |
| `warehouse-low-stock-check` | 7:30 AM | Envía un correo a `WAREHOUSE_ALERT_RECIPIENTS` con los productos bajo stock mínimo |
| `warehouse-purge-stale-imports` | 3:00 AM | Vence las previsualizaciones de importación y borra los Excel guardados |
| `hr-cv-requeue-stale` | Cada 5 minutos | Reencola los CVs atascados en análisis |

Las tareas `hr.process_cv_item` y `hr.cv_requeue_stale` se enrutan a la cola `hr_cv` (`CELERY_TASK_ROUTES`), atendida por un worker dedicado (`celery_worker_hr` en `docker-compose.yml`). La subida del PDF de cada vale a OneDrive (`warehouse.upload_group_pdf`) también es una tarea Celery.

---

# 4. Diagrama de Clases

## 4.1 Módulo Core

```
┌────────────────────────────────────────┐
│                 User                    │
│ (extends AbstractUser)                  │
├────────────────────────────────────────┤
│ - username (USERNAME_FIELD)            │
│ - email: EmailField (unique)           │
│ - first_name: CharField               │
│ - last_name: CharField                │
│ - position: CharField                 │
│ - department: CharField               │
│ - phone: CharField                    │
│ - avatar_url: URLField               │
│ - signature: ImageField              │
│ - must_change_password: BooleanField  │
├────────────────────────────────────────┤
│ + get_roles(): QuerySet[UserRole]     │
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
│ - estado: CharField (ACTIVO/CESADO)    │
│ - fecha_ingreso: DateField             │
│ - proyecto: FK → Project               │
│ - puesto: CharField                    │
│ - salario: DecimalField                │
│ - datos bancarios, contacto de         │
│   emergencia, residencia, hijos, tallas│
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
│ - requesting_area: CharField (OP/QC/HSE/ADM)   │
│ - front_area: CharField                        │
│ - service: CharField                           │
│ - specific_use: CharField                      │
│ - description: TextField                       │
│ - justification: TextField                     │
│ - acquisition_type: CharField                  │
│ - priority: CharField (URGENT/HIGH/NORMAL/LOW) │
│ - status: CharField (47 estados posibles)      │
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
│ «index» flow, project, department,             │
│         requested_by, status, acquisition_type,│
│         priority, created_at                   │
└──┬──────────┬──────────┬──────────┬────────────┘
   │1:N       │1:N       │1:N       │1:N
   │          │          │          │
   ▼          ▼          ▼          ▼
┌──────────┐ ┌────────┐ ┌─────────┐ ┌──────┐
│RequestItem│ │Approval│ │Quotation│ │Claim │
└──────────┘ └────────┘ └─────────┘ └──────┘
   (también 1:N: PurchaseOrder, Attachment, Notification, ActivityLog,
    WarehouseReceipt, WarehouseDispatch)

┌────────────────────────────────────────┐
│            RequestItem                  │
├────────────────────────────────────────┤
│ - request: FK → Request                │
│ - line_number: IntegerField            │
│ - description: CharField               │
│ - specifications: TextField            │
│ - quantity: DecimalField (≥ 0.001)     │
│ - unit: CharField                      │
│ - unit_price: DecimalField             │
│ - total_price: DecimalField (auto)     │
│ - stock_almacen_obra: DecimalField     │
│ - stock_almacen_central: DecimalField  │
│ - x_atender: DecimalField             │
│ - presupuestado_adicional: CharField   │
│ - rfi_fwo: CharField                   │
│ - estatus_guia: CharField              │
│ - supply_source: CharField             │
│   (STOCK / PURCHASE)                   │
│ - inventory_item: FK → Inventory(null) │
│ - is_off_catalog: BooleanField         │
│ - inventory_item_confirmed_at          │
│ - inventory_item_confirmed_by: FK User │
│ - item_source: CharField (EPP, ...)    │
│ - comentarios: TextField               │
├────────────────────────────────────────┤
│ + save(): auto-calcula total_price     │
│ + link_confirmed: bool (property)      │
│ «unique» (request, line_number)        │
│ «check» no vinculado y fuera de        │
│         catálogo a la vez              │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│     Approval (solo se crea)             │
├────────────────────────────────────────┤
│ - request: FK → Request                │
│ - workflow_step: FK → WorkflowStep     │
│ - action: CharField (ApprovalAction,   │
│           37 valores)                  │
│ - performed_by: FK → User              │
│ - role: CharField (o SYSTEM)           │
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
│ - currency: CharField (default PEN)    │
│ - delivery_days: IntegerField          │
│ - payment_terms: CharField             │
│ - validity_days: IntegerField          │
│ - notes: TextField                     │
│ - document_url: CharField              │
│ - is_selected: BooleanField           │
│ - selected_by: FK → User (null)        │
│ - selected_at: DateTimeField (null)    │
│ - quoted_at: DateTimeField (auto)      │
├────────────────────────────────────────┤
│          QuotationItem                  │
│ - quotation: FK → Quotation            │
│ - request_item: FK → RequestItem       │
│ - unit_price: DecimalField             │
│ - quantity: DecimalField               │
│ - total_price: DecimalField (auto)     │
│ - brand: CharField                     │
│ - model: CharField                     │
│ - notes: TextField                     │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│           PurchaseOrder                 │
├────────────────────────────────────────┤
│ - po_number: CharField (OC-YYYY-NNNN) │
│ - request: FK → Request                │
│ - quotation: FK → Quotation            │
│ - supplier: FK → Supplier              │
│ - generated_by: FK → User              │
│ - status: CharField (DRAFT/SENT/       │
│   CONFIRMED/PARTIALLY_RECEIVED/        │
│   FULLY_RECEIVED/CANCELLED)            │
│ - total_amount: DecimalField           │
│ - currency: CharField                  │
│ - payment_terms: CharField             │
│ - expected_delivery_date: DateField    │
│ - actual_delivery_date: DateField      │
│ - document_url: CharField              │
│ - notes: TextField                     │
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

┌────────────────────────────────────────┐
│ AcquisitionTypeConfig                   │
│ - type, min_days, max_days,            │
│   max_extended_days, requires_*_approval│
├────────────────────────────────────────┤
│ Notification                            │
│ - user, request, title, message,       │
│   is_read, dedup_key (único si no nulo)│
├────────────────────────────────────────┤
│ ActivityLog                             │
│ - request, user, action, detail,       │
│   ip_address                           │
├────────────────────────────────────────┤
│ Attachment                              │
│ - request, uploaded_by, file_name,     │
│   file_path, file_type, file_size,     │
│   category, description                │
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
│   (EQUIPMENT/CONSUMABLE/TOOL/          │
│    MATERIAL/EPP)                       │
│ - brand: CharField                     │
│ - model_name: CharField                │
│ - location: CharField (B3-2)           │
│ - min_stock: DecimalField              │
│ - order_number, purchase_order_ref,    │
│   packing_list, size, observation      │
│ - floor: SmallInt (1er/2do piso, null) │
│ - project: FK → Project (null)         │
├────────────────────────────────────────┤
│ + location_status: EXACT/FLOOR_ONLY/   │
│   NONE (property)                      │
│ + location_display (property)          │
└──┬─────────────┬──────────────────────┘
   │ 1:N         │ 1:N
   │             │
   ▼             ▼
┌──────────────┐ ┌──────────────────────┐
│InventoryStock│ │InventoryMovement     │
├──────────────┤ ├──────────────────────┤
│- inventory:  │ │- movement_number:    │
│  FK→Inventory│ │  CharField (unique)  │
│- warehouse_  │ │- movement_type:      │
│  type: Char  │ │  (ENTRY/EXIT/        │
│  (CENTRAL/   │ │   TRANSFER/          │
│   SITE/      │ │   ADJUSTMENT)        │
│   OFFICE)    │ │- inventory:          │
│- project:    │ │  FK → Inventory      │
│  FK→Project  │ │- quantity: Decimal   │
│- department: │ │- warehouse: CharField│
│  FK→Dept     │ │- project: FK→Project │
│- quantity:   │ │- source_type: Char   │
│  Decimal ≥ 0 │ │- destination_type /  │
│- last_updated│ │  destination_detail  │
│  DateTime    │ │- movement_date: Date │
│              │ │- voucher_number,     │
│«unique»      │ │  po_number,          │
│(inventory,   │ │  guide_number, tag,  │
│ warehouse_   │ │  internal_transfer   │
│ type,        │ │- destination_personal│
│ project,     │ │  FK → Personal       │
│ department)  │ │- group:              │
│«check»       │ │  FK→MovementGroup    │
│quantity >= 0 │ │- import_batch:       │
└──────────────┘ │  FK→InventoryImport  │
                 │- registered_by:      │
                 │  FK → User           │
                 │                      │
                 │«index»              │
                 │(inventory,-created)  │
                 │(mov_type,-created)   │
                 │(warehouse,-created)  │
                 │(inventory,mov_date)  │
                 │(mov_type,mov_date)   │
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
                 │- destination_type /  │
                 │  destination_detail  │
                 │- movement_date,      │
                 │  voucher_number,     │
                 │  po_number,          │
                 │  guide_number,       │
                 │  internal_transfer   │
                 │- destination_personal│
                 │- document_url: URL   │
                 │- registered_by:      │
                 │  FK → User           │
                 └──────────┬───────────┘
                            │ 1:1
                            ▼
                 WarehouseReceipt (+ items) · WarehouseDispatch (+ items)
                 creados por WorkflowEngine en RECEIVED / DISPATCHED

┌────────────────────────────────────────┐
│ InventoryImport (UUID)                  │
│ - uploaded_by, warehouse, file_name,   │
│   file_sha256, file_bytes, status      │
│   (PREVIEWED/PROCESSING/CONFIRMED/     │
│    CANCELLED/EXPIRED/FAILED), options, │
│   summary, problems, plan_digest,      │
│   result, confirmed_at, expires_at     │
├────────────────────────────────────────┤
│ OneDriveToken                           │
│ - access_token, refresh_token          │
│   (EncryptedTextField), expires_at,    │
│   account_name                         │
└────────────────────────────────────────┘
```

## 4.4 Módulo Administración

```
┌────────────────────────────────────────┐
│               Pasaje                    │
├────────────────────────────────────────┤
│ - codigo_id_legado: CharField (unique) │
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
│ - ruc, razon_social, factura_ticket,   │
│   detalle, fecha, mes                  │
│ - moneda: CharField (SOLES/DOLARES)    │
│ - monto_con_igv_soles: DecimalField    │
│ - monto_con_igv_dolares: DecimalField  │
│ - tipo_cambio: DecimalField            │
│ - devolucion: DecimalField             │
│ - total: DecimalField (auto, en PEN)   │
│ - estado: CharField (PENDIENTE/PAGADO) │
│ - fecha_pago: DateField (null)         │
│ - numero_operacion: CharField          │
│ - creado_por / actualizado_por: FK User│
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
├────────────────────────────────────────┤
│         Puesto                          │
│ - cargo: CharField (unique)            │
│ - habilitado: BooleanField             │
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

## 4.6 Módulo Recursos Humanos

```
┌────────────────────────────────────────┐
│          DocumentTemplate               │
├────────────────────────────────────────┤
│ - document_type: CharField (CONTRACT)  │
│ - slug, name, version                  │
│ - file: FileField (privado)            │
│ - file_sha256                          │
│ - detected_variables, unknown_variables│
│   missing_required_variables (JSON)    │
│ - is_active, activated_at              │
│ - uploaded_by: FK → User               │
└────────┬───────────────────────────────┘
         │ 1:N
         ▼
┌────────────────────────────────────────┐
│          GeneratedDocument              │
├────────────────────────────────────────┤
│ - template: FK → DocumentTemplate      │
│ - template_version, template_sha256    │
│ - personal: FK → Personal              │
│ - subject_name, data (JSON)            │
│ - status: DRAFT/ISSUED/VOIDED          │
│ - source: MANUAL/ASSISTANT             │
│ - docx_file, pdf_file (privados)       │
│ - reference_number                     │
│ - created_by, issued_by, voided_by     │
└────────┬───────────────────────────────┘
         │ 1:N
         ▼
┌────────────────────────────────────────┐
│ DocumentEvent                           │
│ - action: CREATED/UPDATED/ISSUED/      │
│   VOIDED/DOWNLOADED/PDF_RENDERED       │
│ - actor: FK → User, metadata (JSON)    │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ CVAnalysis                              │
│ - name, requirements_text,             │
│   requirements (JSON)                  │
│ - convocatoria opcional (posting_*)    │
│ - created_by: FK → User                │
└────────┬───────────────────────────────┘
         │ 1:N
         ▼
┌────────────────────────────────────────┐
│ CVAnalysisItem                          │
│ - kind: PDF/DOCX/IMAGE                 │
│ - status: QUEUED/PROCESSING/DONE/      │
│   FAILED/CANCELLED                     │
│ - result (JSON), score, recommendation │
│   (ADVANCE/REVIEW/NO_ADVANCE)          │
│ - tokens_in, tokens_out, cost_usd      │
│ - report_pdf                           │
└────────────────────────────────────────┘
```

## 4.7 Servicios (Clases de Lógica de Negocio)

```
┌────────────────────────────────────────┐
│           WorkflowEngine                │
│   WorkflowEngine(request, user,        │
│                  acting_role)          │
├────────────────────────────────────────┤
│ + execute(action, comments='',         │
│           extra_data=None): Approval   │
│ + get_available_actions(): list[dict]  │
├────────────────────────────────────────┤
│ - _validate_acting_role()              │
│ - _find_transition()                   │
│ - _check_role_permission()             │
│ - _call_handler()                      │
│ - _apply_side_effects()                │
│ - _execute_system_chain()              │
│ - handle_ops_budget_classification()   │
│ - handle_adm_budget_review()           │
│ - handle_stock_check()                 │
│ - handle_cancellation()                │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│          BudgetValidator                │
├────────────────────────────────────────┤
│ + validate(request): dict              │
│ + commit_budget(request): None         │
│ + release_budget(request): None        │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│           SLACalculator                 │
├────────────────────────────────────────┤
│ + calculate_estimated_delivery(        │
│     acquisition_type, from_date=None,  │
│     use_max=False): date               │
│ + get_sla_days(acquisition_type): dict │
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
│ + notify_on_transition(request, action,│
│     new_status, actor): None           │
│   (notificación in-app según NOTIFY_MAP)│
└────────────────────────────────────────┘
```

Otros servicios: `update_request_items`, `search_catalog`, `build_stock_availability` (`apps/rq/services/`); `register_entry_batch`, `register_exit_batch`, `register_epp_delivery`, kardex, ubicaciones, importación (`apps/warehouse/services/`); plantillas, documentos y análisis de CVs (`apps/hr/services/`).

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
git clone https://github.com/pccpegit/SYSPCCLOG.git
cd SYSPCCLOG
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

Levanta `redis`, `backend`, `frontend`, `celery_worker`, `celery_worker_hr` (cola `hr_cv`) y `celery_beat` (`docker-compose.yml`).

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

# Worker (procesa tareas asíncronas de la cola por defecto)
celery -A config worker -l info

# Worker de RR. HH. (análisis de CVs, cola hr_cv)
celery -A config worker -Q hr_cv -c 3 -n hr@%h -l info

# Beat (tareas programadas)
celery -A config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler
```

---

# 6. Manual de Producción

> **Alcance de esta sección.** Es una referencia para una instalación manual en un servidor propio (VPS con Nginx, Gunicorn y systemd). El repositorio no incluye configuración de Nginx ni unidades systemd: sus archivos de despliegue son `.do/app.yaml` (DigitalOcean App Platform, guía `08_Guia_Despliegue_DigitalOcean.md`) y `render.yaml` + `frontend/vercel.json` (demo, guía `07_Guia_Demo_Supabase_Vercel.md`). `config/settings/production.py` sirve `/static/` con WhiteNoise y espera que el TLS termine en un proxy (`SECURE_PROXY_SSL_HEADER`).

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
sudo -u syspcc git clone https://github.com/pccpegit/SYSPCCLOG.git /opt/syspcc/app
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

El análisis de CVs (`hr.process_cv_item`) se enruta a la cola `hr_cv`. Con `HR_CV_DISPATCH=celery` (valor por defecto) hace falta un worker que la consuma, por ejemplo una segunda unidad con `celery -A config worker -Q hr_cv`; en Docker es el servicio `celery_worker_hr`.

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
# Origen de los archivos media (firmas). Vacío = mismo origen;
# si no se define, el frontend usa http://localhost:8000 (src/api/config.js)
echo "VITE_BACKEND_URL=" >> .env.production

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

# Limpiar sesiones expiradas (sin efecto: las sesiones viven en la caché Redis,
# SESSION_ENGINE = 'django.contrib.sessions.backends.cache')
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
| Cookies HttpOnly | Cookies `access_token` / `refresh_token` con `httponly=True` (`CustomTokenObtainPairView`) y `SESSION_COOKIE_HTTPONLY=True` | JavaScript no puede leer los tokens |
| Cookies Secure | `SESSION_COOKIE_SECURE=True`, `CSRF_COOKIE_SECURE=True`; cookies JWT `secure` cuando `DEBUG=False` | Solo envía por HTTPS |
| CSRF | `CSRF_COOKIE_HTTPONLY=False` a propósito + verificación en `CookieJWTAuthentication.enforce_csrf()` | Double-submit: el SPA lee `csrftoken` y lo reenvía en `X-CSRFToken` |
| X-Frame-Options | `X_FRAME_OPTIONS='DENY'` | Previene clickjacking |
| Content-Type sniffing | `SECURE_CONTENT_TYPE_NOSNIFF=True` | Previene MIME sniffing |
| Rate limiting | 200 req/min auth, 30/min anon | Previene fuerza bruta |
| Login rate limit | 5 intentos/minuto por IP y 10/minuto por usuario | Previene fuerza bruta login |
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

## 6.9 Variables de Entorno — Referencia Principal

Lista de las variables más usadas. La referencia completa son `backend/.env.example` y `backend/config/settings/{base,production}.py` (por ejemplo `DB_SSLMODE`, `ONEDRIVE_TOKEN_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `HR_*`, `AWS_*`).

| Variable | Requerida | Ejemplo | Descripción |
|----------|-----------|---------|-------------|
| `SECRET_KEY` | Sí | `django-insecure-xxx...` | Clave secreta Django (50+ chars) |
| `DJANGO_SETTINGS_MODULE` | Sí | `config.settings.production` | Módulo de settings |
| `DJANGO_ENV` | No | `production` | Guarda para settings de desarrollo |
| `DEBUG` | No | `False` | Modo debug (nunca True en prod) |
| `ALLOWED_HOSTS` | Sí | `syspcc.pcc.com.pe` | Hosts permitidos |
| `DB_ENGINE` | No | `django.db.backends.sqlite3` | Motor de BD fuera de producción (`production.py` fija PostgreSQL) |
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

*SYSPCC v1.0 — PCC Ingeniería y Construcción*
*Última actualización: Octubre 2026*
