"""
Django TextChoices enums for the SYSPCCLOG project.
All enums from the DBML schema are defined here.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _


class RQFlowChoices(models.TextChoices):
    OPERATIONS = 'OPERATIONS', _('Operaciones (Proyectos/Obra)')
    ADMINISTRATIVE = 'ADMINISTRATIVE', _('Administración (Oficina)')


class WarehouseOriginChoices(models.TextChoices):
    CENTRAL = 'CENTRAL', _('Almacén Central')
    SITE = 'SITE', _('Almacén de Obra')
    OFFICE = 'OFFICE', _('Almacén/Bodega de Oficina')


class RoleChoices(models.TextChoices):
    # Common roles
    REQUESTER = 'REQUESTER', _('Solicitante')
    GENERAL_MANAGER = 'GENERAL_MANAGER', _('Gerente General')
    CENTRAL_WAREHOUSE = 'CENTRAL_WAREHOUSE', _('Almacén Central')

    # Operations flow roles
    PROJECT_RESIDENT = 'PROJECT_RESIDENT', _('Residente de Proyecto')
    PROJECT_CONTROL = 'PROJECT_CONTROL', _('Control de Proyecto')
    LOGISTICS_COORDINATOR = 'LOGISTICS_COORDINATOR', _('Coordinador Logístico')
    SITE_WAREHOUSE = 'SITE_WAREHOUSE', _('Almacén de Obra')

    # Administrative flow roles
    DIRECT_SUPERVISOR = 'DIRECT_SUPERVISOR', _('Jefe Directo')
    ADMIN_MANAGER = 'ADMIN_MANAGER', _('Gerente Administrativo')
    LOGISTICS_SUPERVISOR = 'LOGISTICS_SUPERVISOR', _('Supervisor Logístico')
    LOGISTICS_CHIEF = 'LOGISTICS_CHIEF', _('Jefe Logístico')


class RQStatusChoices(models.TextChoices):
    # Phase 1: Request
    DRAFT = 'DRAFT', _('Borrador')
    SUBMITTED = 'SUBMITTED', _('Enviado')

    # Phase 2: Validation - Operations
    TECHNICAL_REVIEW = 'TECHNICAL_REVIEW', _('En revisión técnica (Residente)')
    TECHNICAL_APPROVED = 'TECHNICAL_APPROVED', _('Aprobado técnicamente')
    TECHNICAL_REJECTED = 'TECHNICAL_REJECTED', _('Rechazado técnicamente')
    BUDGET_REVIEW = 'BUDGET_REVIEW', _('En revisión presupuestal (Control Proyecto)')
    WITHIN_PROPOSAL = 'WITHIN_PROPOSAL', _('Dentro de la propuesta original')
    ADDITIONAL_REQ = 'ADDITIONAL_REQ', _('Clasificado como adicional')

    # Phase 2: Validation - Administrative
    SUPERVISOR_REVIEW = 'SUPERVISOR_REVIEW', _('En revisión (Jefe Directo)')
    SUPERVISOR_APPROVED = 'SUPERVISOR_APPROVED', _('Aprobado por Jefe Directo')
    SUPERVISOR_REJECTED = 'SUPERVISOR_REJECTED', _('Rechazado por Jefe Directo')
    ADMIN_BUDGET_REVIEW = 'ADMIN_BUDGET_REVIEW', _('Revisión Gte. Administrativo vs Plan Anual')
    WITHIN_ANNUAL_PLAN = 'WITHIN_ANNUAL_PLAN', _('Dentro del Plan Anual')
    OUT_OF_ANNUAL_PLAN = 'OUT_OF_ANNUAL_PLAN', _('Fuera del Plan Anual')

    # Common - GM Review
    GM_REVIEW = 'GM_REVIEW', _('En revisión por Gerente General')
    GM_APPROVED = 'GM_APPROVED', _('Aprobado por Gerente General')
    GM_REJECTED = 'GM_REJECTED', _('Rechazado por Gerente General')

    # Common post-validation
    VALIDATED = 'VALIDATED', _('Validado para atención')

    # Phase 3: Logistics
    STOCK_CHECK = 'STOCK_CHECK', _('Verificación de stock')
    IN_STOCK = 'IN_STOCK', _('Hay stock disponible')
    REQUIRES_PURCHASE = 'REQUIRES_PURCHASE', _('Requiere compra')
    QUOTING = 'QUOTING', _('Solicitando cotizaciones')
    QUOTE_COMPARISON = 'QUOTE_COMPARISON', _('Comparando propuestas (Jefe Logístico)')
    QUOTE_SELECTED = 'QUOTE_SELECTED', _('Proveedor seleccionado')
    COST_OVERRUN_REVIEW = 'COST_OVERRUN_REVIEW', _('Sobrecosto en revisión GG')
    COST_OVERRUN_APPROVED = 'COST_OVERRUN_APPROVED', _('Sobrecosto aprobado por GG')
    COST_OVERRUN_REJECTED = 'COST_OVERRUN_REJECTED', _('Sobrecosto rechazado por GG')
    PO_GENERATED = 'PO_GENERATED', _('Orden de Compra generada')

    # Phase 4: Reception and Delivery
    RECEIVING = 'RECEIVING', _('En recepción')
    QUALITY_CHECK = 'QUALITY_CHECK', _('Control de calidad (Almacén Central)')
    QUALITY_APPROVED = 'QUALITY_APPROVED', _('Calidad aprobada')
    QUALITY_REJECTED = 'QUALITY_REJECTED', _('Calidad rechazada')
    SUPPLIER_CLAIM_SENT = 'SUPPLIER_CLAIM_SENT', _('Reclamo enviado al proveedor')
    SUPPLIER_CLAIM_PENDING = 'SUPPLIER_CLAIM_PENDING', _('Esperando respuesta del proveedor')
    SUPPLIER_REPLACEMENT_RECEIVED = 'SUPPLIER_REPLACEMENT_RECEIVED', _('Reposición recibida del proveedor')
    RECEPTION_CONFORMITY = 'RECEPTION_CONFORMITY', _('Verificación de conformidad en recepción')
    RECEPTION_CLAIM = 'RECEPTION_CLAIM', _('Reclamo al proveedor por no conformidad')
    DISPATCHED_TO_SITE = 'DISPATCHED_TO_SITE', _('Despachado a obra')
    DELIVERED = 'DELIVERED', _('Entregado al destino')

    # Phase 5: Conformity and Closure
    WAREHOUSE_UPDATED = 'WAREHOUSE_UPDATED', _('Almacén actualizó registros')
    USER_CONFORMITY = 'USER_CONFORMITY', _('Usuario confirmó recepción conforme')
    USER_CLAIM = 'USER_CLAIM', _('Usuario generó reclamo')
    CLAIM_IN_REVIEW = 'CLAIM_IN_REVIEW', _('Reclamo en revisión')
    CLAIM_RESOLVED = 'CLAIM_RESOLVED', _('Reclamo resuelto')
    CLOSED = 'CLOSED', _('Cerrado exitosamente')
    CANCELLED = 'CANCELLED', _('Cancelado')


class PriorityChoices(models.TextChoices):
    URGENT = 'URGENT', _('Urgente')
    HIGH = 'HIGH', _('Alta')
    NORMAL = 'NORMAL', _('Normal')
    LOW = 'LOW', _('Baja')


class AcquisitionTypeChoices(models.TextChoices):
    COMPRA_LOCAL = 'COMPRA_LOCAL', _('Compra Local (1-3 días)')
    COMPRA_FORANEA = 'COMPRA_FORANEA', _('Compra Foránea (5-7 días)')
    IMPORTACION = 'IMPORTACION', _('Importación (2-8 semanas)')
    FABRICACION = 'FABRICACION', _('Fabricación (7-15 días)')
    ALQUILER = 'ALQUILER', _('Alquiler (3-15 días)')
    CALIBRACION = 'CALIBRACION', _('Calibración (7-10 días)')


class BudgetClassificationChoices(models.TextChoices):
    BC_WITHIN_PROPOSAL = 'BC_WITHIN_PROPOSAL', _('OPS: Dentro de la propuesta')
    BC_ADDITIONAL = 'BC_ADDITIONAL', _('OPS: Adicional a la propuesta')
    BC_WITHIN_ANNUAL_PLAN = 'BC_WITHIN_ANNUAL_PLAN', _('ADM: Dentro del Plan Anual')
    BC_OUT_OF_ANNUAL_PLAN = 'BC_OUT_OF_ANNUAL_PLAN', _('ADM: Fuera del Plan Anual')


class ApprovalActionChoices(models.TextChoices):
    # Request
    SUBMITTED = 'SUBMITTED', _('Enviado')
    # Operations validation
    TECHNICAL_APPROVED = 'TECHNICAL_APPROVED', _('Aprobado técnicamente')
    TECHNICAL_REJECTED = 'TECHNICAL_REJECTED', _('Rechazado técnicamente')
    BUDGET_CLASSIFIED = 'BUDGET_CLASSIFIED', _('Clasificado presupuestalmente')
    BUDGET_REJECTED = 'BUDGET_REJECTED', _('Rechazado presupuestalmente')
    # Administrative validation
    SUPERVISOR_APPROVED = 'SUPERVISOR_APPROVED', _('Aprobado por Jefe Directo')
    SUPERVISOR_REJECTED = 'SUPERVISOR_REJECTED', _('Rechazado por Jefe Directo')
    ADMIN_BUDGET_REVIEWED = 'ADMIN_BUDGET_REVIEWED', _('Revisión presupuestal GteAdmin')
    ADMIN_BUDGET_REJECTED = 'ADMIN_BUDGET_REJECTED', _('Rechazado por Gte. Administrativo')
    # Common
    GM_APPROVED = 'GM_APPROVED', _('Aprobado por GG')
    GM_REJECTED = 'GM_REJECTED', _('Rechazado por GG')
    VALIDATED = 'VALIDATED', _('Validado')
    # Logistics
    STOCK_CHECKED = 'STOCK_CHECKED', _('Stock verificado')
    QUOTE_REQUESTED = 'QUOTE_REQUESTED', _('Cotización solicitada')
    QUOTE_COMPARED = 'QUOTE_COMPARED', _('Cotizaciones comparadas')
    QUOTE_SELECTED = 'QUOTE_SELECTED', _('Cotización seleccionada')
    QUOTE_COST_APPROVED = 'QUOTE_COST_APPROVED', _('Cotización aprobada por Control')
    QUOTE_COST_REJECTED = 'QUOTE_COST_REJECTED', _('Cotización excede presupuesto')
    COST_OVERRUN_APPROVED = 'COST_OVERRUN_APPROVED', _('Sobrecosto aprobado')
    COST_OVERRUN_REJECTED = 'COST_OVERRUN_REJECTED', _('Sobrecosto rechazado')
    PO_GENERATED = 'PO_GENERATED', _('OC generada')
    # Reception
    RECEIVED = 'RECEIVED', _('Recibido')
    QUALITY_APPROVED = 'QUALITY_APPROVED', _('Calidad aprobada')
    QUALITY_REJECTED = 'QUALITY_REJECTED', _('Calidad rechazada')
    SUPPLIER_CLAIM_SENT = 'SUPPLIER_CLAIM_SENT', _('Reclamo enviado al proveedor')
    SUPPLIER_CLAIM_UPDATED = 'SUPPLIER_CLAIM_UPDATED', _('Estado de reclamo actualizado')
    SUPPLIER_REPLACEMENT_RECEIVED = 'SUPPLIER_REPLACEMENT_RECEIVED', _('Reposición recibida')
    RECEPTION_CONFIRMED = 'RECEPTION_CONFIRMED', _('Recepción confirmada')
    RECEPTION_CLAIMED = 'RECEPTION_CLAIMED', _('Reclamo en recepción')
    DISPATCHED = 'DISPATCHED', _('Despachado')
    DELIVERED = 'DELIVERED', _('Entregado')
    # Closure
    WAREHOUSE_RECORDS_UPDATED = 'WAREHOUSE_RECORDS_UPDATED', _('Registros actualizados')
    USER_CONFIRMED = 'USER_CONFIRMED', _('Conformidad del usuario')
    USER_CLAIMED = 'USER_CLAIMED', _('Reclamo del usuario')
    CLAIM_RESOLVED = 'CLAIM_RESOLVED', _('Reclamo resuelto')
    CLOSED = 'CLOSED', _('Cerrado')
    CANCELLED = 'CANCELLED', _('Cancelado')


class POStatusChoices(models.TextChoices):
    DRAFT = 'DRAFT', _('Borrador')
    SENT = 'SENT', _('Enviada al proveedor')
    CONFIRMED = 'CONFIRMED', _('Confirmada por proveedor')
    PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED', _('Recepción parcial')
    FULLY_RECEIVED = 'FULLY_RECEIVED', _('Recepción completa')
    CANCELLED = 'CANCELLED', _('Cancelada')


class ClaimTypeChoices(models.TextChoices):
    SUPPLIER_CLAIM = 'SUPPLIER_CLAIM', _('Reclamo al proveedor')
    USER_COMPLAINT = 'USER_COMPLAINT', _('Queja del usuario')


class ClaimStatusChoices(models.TextChoices):
    OPEN = 'OPEN', _('Abierto')
    IN_REVIEW = 'IN_REVIEW', _('En revisión')
    RESOLVED = 'RESOLVED', _('Resuelto')
    CLOSED = 'CLOSED', _('Cerrado')
