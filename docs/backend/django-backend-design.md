# RQ System — Django Backend Design

**Stack:** Django 5.x + Django REST Framework 3.x + PostgreSQL 16
**Auth:** SimpleJWT
**Date:** 2026-03-07

---

## 1. Django Project Structure

```
syspcclog/
├── manage.py
├── requirements.txt
├── config/
│   ├── __init__.py
│   ├── settings/
│   │   ├── base.py            # Shared settings
│   │   ├── development.py     # DEBUG=True, local DB
│   │   └── production.py      # Production config
│   ├── urls.py                # Root URL conf
│   └── wsgi.py
├── apps/
│   ├── accounts/              # Auth, users, roles
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── permissions.py
│   │   ├── services.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── projects/              # Projects, budgets
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   └── urls.py
│   ├── requests/              # Supply requests, items, state machine
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py        # RequestTransitionService
│   │   ├── state_machine.py   # TRANSITION_MAP
│   │   ├── excel_handler.py   # Excel parsing & validation
│   │   └── urls.py
│   ├── approvals/             # Approval audit trail
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py
│   │   └── urls.py
│   ├── procurement/           # Suppliers, quotations, POs
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py
│   │   └── urls.py
│   ├── warehouse/             # Inventory, reception, QC, claims
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py
│   │   └── urls.py
│   └── dashboard/             # KPI aggregation
│       ├── views.py
│       ├── services.py
│       └── urls.py
└── common/
    ├── pagination.py
    ├── exceptions.py
    └── validators.py
```

---

## 2. Django Models

### 2.1 Accounts App

```python
# apps/accounts/models.py

from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    REQUESTER         = "REQUESTER",         "Usuario"
    PROJECT_RESIDENT  = "PROJECT_RESIDENT",  "Residente de Proyecto"
    PROJECT_CONTROL   = "PROJECT_CONTROL",   "Control de Proyecto"
    GENERAL_MANAGER   = "GENERAL_MANAGER",   "Gerente General"
    LOGISTICS         = "LOGISTICS",         "Coordinador Logístico"
    CENTRAL_WAREHOUSE = "CENTRAL_WAREHOUSE", "Almacén Central"
    SITE_WAREHOUSE    = "SITE_WAREHOUSE",    "Almacén de Obra"
    ADMIN             = "ADMIN",             "Administrador"


class CustomUser(AbstractUser):
    email = models.EmailField(unique=True)
    primary_role = models.CharField(max_length=30, choices=Role.choices)
    additional_roles = models.JSONField(default=list, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    position = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username", "first_name", "last_name", "primary_role"]

    class Meta:
        db_table = "accounts_user"
        ordering = ["last_name", "first_name"]

    def has_role(self, role: str) -> bool:
        return self.primary_role == role or role in self.additional_roles

    def has_any_role(self, roles: list[str]) -> bool:
        return any(self.has_role(r) for r in roles)
```

### 2.2 Projects App

```python
# apps/projects/models.py

class Project(models.Model):
    code = models.CharField(max_length=20, unique=True)        # e.g., "OBRA-14"
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    total_budget = models.DecimalField(max_digits=14, decimal_places=2)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    resident = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="resident_projects"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "projects_project"
        ordering = ["-created_at"]

    @property
    def spent_budget(self):
        """Sum of all approved request estimated costs."""
        from apps.requests.models import SupplyRequest
        return self.supply_requests.exclude(
            status__in=["DRAFT", "CANCELLED", "TECHNICAL_REJECTED", "GM_REJECTED"]
        ).aggregate(total=models.Sum("estimated_cost"))["total"] or 0

    @property
    def available_budget(self):
        return self.total_budget - self.spent_budget


class BudgetLine(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="budget_lines")
    category = models.CharField(max_length=100)            # e.g., "Materiales", "Equipos"
    allocated_amount = models.DecimalField(max_digits=14, decimal_places=2)
    description = models.TextField(blank=True)

    class Meta:
        db_table = "projects_budgetline"
```

### 2.3 Requests App

```python
# apps/requests/models.py

class RequestStatus(models.TextChoices):
    # Phase 1
    DRAFT                = "DRAFT",                "Borrador"
    SUBMITTED            = "SUBMITTED",            "Enviado"
    TECHNICAL_REVIEW     = "TECHNICAL_REVIEW",     "Revisión Técnica"
    TECHNICAL_APPROVED   = "TECHNICAL_APPROVED",   "Aprobado Técnicamente"
    TECHNICAL_REJECTED   = "TECHNICAL_REJECTED",   "Rechazado por Residente"
    # Phase 2
    BUDGET_REVIEW        = "BUDGET_REVIEW",        "Revisión Presupuestal"
    WITHIN_PROPOSAL      = "WITHIN_PROPOSAL",      "Dentro de Propuesta"
    ADDITIONAL_REQ       = "ADDITIONAL_REQ",       "Requerimiento Adicional"
    GM_REVIEW            = "GM_REVIEW",            "Revisión Gerencia"
    GM_APPROVED          = "GM_APPROVED",          "Aprobado por Gerencia"
    GM_REJECTED          = "GM_REJECTED",          "Rechazado por Gerencia"
    VALIDATED            = "VALIDATED",            "Validado para Atención"
    # Phase 3
    STOCK_CHECK          = "STOCK_CHECK",          "Verificación Stock"
    IN_STOCK             = "IN_STOCK",             "En Stock"
    REQUIRES_PURCHASE    = "REQUIRES_PURCHASE",    "Requiere Compra"
    QUOTING              = "QUOTING",              "En Cotización"
    QUOTE_SELECTED       = "QUOTE_SELECTED",       "Cotización Seleccionada"
    COST_OVERRUN_REVIEW  = "COST_OVERRUN_REVIEW",  "Revisión Sobrecosto"
    PO_GENERATED         = "PO_GENERATED",         "OC Generada"
    # Phase 4
    RECEIVING            = "RECEIVING",            "En Recepción"
    QUALITY_CHECK        = "QUALITY_CHECK",        "Control de Calidad"
    QUALITY_REJECTED     = "QUALITY_REJECTED",     "Rechazado Calidad"
    DISPATCHED_TO_SITE   = "DISPATCHED_TO_SITE",   "Despachado a Obra"
    DELIVERED            = "DELIVERED",            "Entregado"
    USER_CONFORMITY      = "USER_CONFORMITY",      "Pendiente Conformidad"
    USER_CLAIM           = "USER_CLAIM",           "Reclamo Usuario"
    CLOSED               = "CLOSED",              "Cerrado"
    CANCELLED            = "CANCELLED",           "Cancelado"


class RequestPriority(models.TextChoices):
    LOW    = "LOW",    "Baja"
    NORMAL = "NORMAL", "Normal"
    HIGH   = "HIGH",   "Alta"
    URGENT = "URGENT", "Urgente"


class UnitOfMeasure(models.TextChoices):
    UND  = "UND",  "Unidad"
    KG   = "KG",   "Kilogramo"
    M    = "M",    "Metro"
    M2   = "M2",   "Metro Cuadrado"
    M3   = "M3",   "Metro Cúbico"
    GLB  = "GLB",  "Global"
    SACO = "SACO", "Saco"
    L    = "L",    "Litro"
    PZA  = "PZA",  "Pieza"
    JGO  = "JGO",  "Juego"


class SupplyRequest(models.Model):
    # Identifiers
    rq_number = models.CharField(max_length=20, unique=True, editable=False)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.PROTECT,
        related_name="supply_requests"
    )

    # Requester info
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="created_requests"
    )
    description = models.TextField()
    justification = models.TextField(blank=True)
    priority = models.CharField(
        max_length=10, choices=RequestPriority.choices,
        default=RequestPriority.NORMAL
    )

    # Status
    status = models.CharField(
        max_length=30, choices=RequestStatus.choices,
        default=RequestStatus.DRAFT
    )

    # Budget
    estimated_cost = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    budget_classification = models.CharField(
        max_length=20, blank=True,
        choices=[("WITHIN", "Dentro de Propuesta"), ("ADDITIONAL", "Adicional")]
    )

    # Dates
    required_date = models.DateField(help_text="Fecha requerida de entrega")
    work_location = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    # Current assignee (who should act next)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="assigned_requests"
    )

    class Meta:
        db_table = "requests_supplyrequest"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["project", "status"]),
            models.Index(fields=["requested_by"]),
        ]

    def save(self, *args, **kwargs):
        if not self.rq_number:
            self.rq_number = self._generate_rq_number()
        super().save(*args, **kwargs)

    def _generate_rq_number(self):
        from django.utils import timezone
        year = timezone.now().year
        last = SupplyRequest.objects.filter(
            rq_number__startswith=f"RQ-{year}"
        ).count()
        return f"RQ-{year}-{last + 1:04d}"


class RequestItem(models.Model):
    request = models.ForeignKey(
        SupplyRequest, on_delete=models.CASCADE, related_name="items"
    )
    line_number = models.PositiveIntegerField()
    description = models.CharField(max_length=500)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit = models.CharField(max_length=10, choices=UnitOfMeasure.choices)
    specifications = models.TextField(blank=True)
    estimated_unit_cost = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )

    class Meta:
        db_table = "requests_requestitem"
        ordering = ["line_number"]
        unique_together = [("request", "line_number")]


class Attachment(models.Model):
    request = models.ForeignKey(
        SupplyRequest, on_delete=models.CASCADE, related_name="attachments"
    )
    file = models.FileField(upload_to="attachments/%Y/%m/")
    original_filename = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField()
    content_type = models.CharField(max_length=100)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "requests_attachment"
```

### 2.4 Approvals App

```python
# apps/approvals/models.py

class ApprovalAction(models.TextChoices):
    SUBMITTED            = "SUBMITTED",            "Enviado"
    TECHNICAL_APPROVED   = "TECHNICAL_APPROVED",   "Aprobado Técnicamente"
    TECHNICAL_REJECTED   = "TECHNICAL_REJECTED",   "Rechazado por Residente"
    RETURNED             = "RETURNED",             "Devuelto para Corrección"
    BUDGET_WITHIN        = "BUDGET_WITHIN",        "Clasificado: Dentro de Propuesta"
    BUDGET_ADDITIONAL    = "BUDGET_ADDITIONAL",    "Clasificado: Adicional"
    GM_APPROVED          = "GM_APPROVED",          "Aprobado por Gerencia"
    GM_REJECTED          = "GM_REJECTED",          "Rechazado por Gerencia"
    COST_APPROVED        = "COST_APPROVED",        "Sobrecosto Aprobado"
    STOCK_CONFIRMED      = "STOCK_CONFIRMED",      "Stock Confirmado"
    PO_CREATED           = "PO_CREATED",           "OC Generada"
    RECEIVED             = "RECEIVED",             "Material Recibido"
    QC_PASSED            = "QC_PASSED",            "Calidad Aprobada"
    QC_FAILED            = "QC_FAILED",            "Calidad Rechazada"
    DISPATCHED           = "DISPATCHED",           "Despachado a Obra"
    DELIVERED            = "DELIVERED",            "Entregado"
    CONFORMITY_OK        = "CONFORMITY_OK",        "Conformidad Otorgada"
    CLAIM_RAISED         = "CLAIM_RAISED",         "Reclamo Generado"
    CLOSED               = "CLOSED",              "Cerrado"
    CANCELLED            = "CANCELLED",           "Cancelado"


class Approval(models.Model):
    """Immutable audit trail record for every state transition."""
    request = models.ForeignKey(
        "requests.SupplyRequest", on_delete=models.CASCADE,
        related_name="approvals"
    )
    action = models.CharField(max_length=30, choices=ApprovalAction.choices)
    from_status = models.CharField(max_length=30)
    to_status = models.CharField(max_length=30)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT
    )
    comments = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)  # Extra data per action
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "approvals_approval"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["request", "-created_at"]),
        ]
```

### 2.5 Procurement App

```python
# apps/procurement/models.py

class Supplier(models.Model):
    name = models.CharField(max_length=200)
    ruc = models.CharField(max_length=20, unique=True)  # Tax ID
    contact_name = models.CharField(max_length=200, blank=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "procurement_supplier"


class Quotation(models.Model):
    class QuotationStatus(models.TextChoices):
        PENDING  = "PENDING",  "Pendiente"
        SELECTED = "SELECTED", "Seleccionada"
        REJECTED = "REJECTED", "No Seleccionada"

    request = models.ForeignKey(
        "requests.SupplyRequest", on_delete=models.CASCADE,
        related_name="quotations"
    )
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT)
    quote_number = models.CharField(max_length=50)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, default="PEN")
    delivery_days = models.PositiveIntegerField()
    valid_until = models.DateField()
    status = models.CharField(
        max_length=10, choices=QuotationStatus.choices,
        default=QuotationStatus.PENDING
    )
    notes = models.TextField(blank=True)
    file = models.FileField(upload_to="quotations/%Y/%m/", null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "procurement_quotation"


class PurchaseOrder(models.Model):
    class POStatus(models.TextChoices):
        DRAFT     = "DRAFT",     "Borrador"
        ISSUED    = "ISSUED",    "Emitida"
        PARTIAL   = "PARTIAL",   "Recepción Parcial"
        COMPLETED = "COMPLETED", "Completada"
        CANCELLED = "CANCELLED", "Cancelada"

    po_number = models.CharField(max_length=20, unique=True)
    request = models.ForeignKey(
        "requests.SupplyRequest", on_delete=models.PROTECT,
        related_name="purchase_orders"
    )
    quotation = models.ForeignKey(
        Quotation, on_delete=models.PROTECT, null=True, blank=True
    )
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, default="PEN")
    status = models.CharField(
        max_length=10, choices=POStatus.choices, default=POStatus.DRAFT
    )
    expected_delivery_date = models.DateField()
    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    issued_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "procurement_purchaseorder"
```

### 2.6 Warehouse App

```python
# apps/warehouse/models.py

class InventoryItem(models.Model):
    code = models.CharField(max_length=50, unique=True)
    description = models.CharField(max_length=500)
    unit = models.CharField(max_length=10)
    quantity_on_hand = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    minimum_stock = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    warehouse_location = models.CharField(max_length=100, blank=True)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "warehouse_inventoryitem"


class Reception(models.Model):
    request = models.ForeignKey(
        "requests.SupplyRequest", on_delete=models.CASCADE,
        related_name="receptions"
    )
    purchase_order = models.ForeignKey(
        "procurement.PurchaseOrder", on_delete=models.SET_NULL,
        null=True, blank=True
    )
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    received_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)
    delivery_note_number = models.CharField(max_length=50, blank=True)

    class Meta:
        db_table = "warehouse_reception"


class QualityCheck(models.Model):
    class QCResult(models.TextChoices):
        PASSED = "PASSED", "Conforme"
        FAILED = "FAILED", "No Conforme"

    reception = models.OneToOneField(
        Reception, on_delete=models.CASCADE, related_name="quality_check"
    )
    result = models.CharField(max_length=10, choices=QCResult.choices)
    checked_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    checked_at = models.DateTimeField(auto_now_add=True)
    observations = models.TextField(blank=True)

    class Meta:
        db_table = "warehouse_qualitycheck"


class Claim(models.Model):
    class ClaimType(models.TextChoices):
        QUALITY   = "QUALITY",   "Reclamo de Calidad"
        USER      = "USER",      "Reclamo de Usuario"
        SUPPLIER  = "SUPPLIER",  "Reclamo a Proveedor"

    class ClaimStatus(models.TextChoices):
        OPEN     = "OPEN",     "Abierto"
        IN_PROGRESS = "IN_PROGRESS", "En Proceso"
        RESOLVED = "RESOLVED", "Resuelto"
        CLOSED   = "CLOSED",   "Cerrado"

    request = models.ForeignKey(
        "requests.SupplyRequest", on_delete=models.CASCADE,
        related_name="claims"
    )
    claim_type = models.CharField(max_length=10, choices=ClaimType.choices)
    status = models.CharField(
        max_length=15, choices=ClaimStatus.choices, default=ClaimStatus.OPEN
    )
    description = models.TextField()
    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="raised_claims"
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="assigned_claims"
    )
    resolution = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "warehouse_claim"
```

---

## 3. Request Status Transitions — State Machine

```python
# apps/requests/state_machine.py

from apps.accounts.models import Role
from apps.requests.models import RequestStatus as S

# Format: from_status: [(to_status, allowed_roles, action_name), ...]
TRANSITION_MAP = {
    S.DRAFT: [
        (S.SUBMITTED,   [Role.REQUESTER],                       "submit"),
        (S.CANCELLED,   [Role.REQUESTER, Role.ADMIN],           "cancel"),
    ],
    S.SUBMITTED: [
        (S.TECHNICAL_REVIEW, [Role.PROJECT_RESIDENT, Role.ADMIN], "assign_review"),
    ],
    S.TECHNICAL_REVIEW: [
        (S.TECHNICAL_APPROVED, [Role.PROJECT_RESIDENT],          "approve_technical"),
        (S.TECHNICAL_REJECTED, [Role.PROJECT_RESIDENT],          "reject_technical"),
        (S.DRAFT,              [Role.PROJECT_RESIDENT],          "return_for_correction"),
    ],
    S.TECHNICAL_APPROVED: [
        (S.BUDGET_REVIEW, [Role.PROJECT_CONTROL, Role.ADMIN],   "send_to_budget"),
    ],
    S.BUDGET_REVIEW: [
        (S.WITHIN_PROPOSAL,  [Role.PROJECT_CONTROL],            "classify_within_proposal"),
        (S.ADDITIONAL_REQ,   [Role.PROJECT_CONTROL],            "classify_additional"),
    ],
    S.WITHIN_PROPOSAL: [
        (S.VALIDATED, [Role.PROJECT_CONTROL, Role.ADMIN],       "validate"),
    ],
    S.ADDITIONAL_REQ: [
        (S.GM_REVIEW, [Role.PROJECT_CONTROL, Role.ADMIN],       "escalate_to_gm"),
    ],
    S.GM_REVIEW: [
        (S.GM_APPROVED, [Role.GENERAL_MANAGER],                 "gm_approve"),
        (S.GM_REJECTED, [Role.GENERAL_MANAGER],                 "gm_reject"),
    ],
    S.GM_APPROVED: [
        (S.VALIDATED, [Role.GENERAL_MANAGER, Role.ADMIN],       "validate"),
    ],
    S.VALIDATED: [
        (S.STOCK_CHECK, [Role.LOGISTICS],                       "check_stock"),
    ],
    S.STOCK_CHECK: [
        (S.IN_STOCK,          [Role.LOGISTICS],                 "mark_in_stock"),
        (S.REQUIRES_PURCHASE, [Role.LOGISTICS],                 "mark_no_stock"),
    ],
    S.IN_STOCK: [
        (S.DISPATCHED_TO_SITE, [Role.LOGISTICS, Role.SITE_WAREHOUSE], "dispatch_from_stock"),
    ],
    S.REQUIRES_PURCHASE: [
        (S.QUOTING, [Role.LOGISTICS],                           "request_quotes"),
    ],
    S.QUOTING: [
        (S.QUOTE_SELECTED, [Role.LOGISTICS],                    "select_quote"),
    ],
    S.QUOTE_SELECTED: [
        (S.PO_GENERATED,        [Role.LOGISTICS],               "generate_po"),
        (S.COST_OVERRUN_REVIEW, [Role.LOGISTICS],               "escalate_cost"),
    ],
    S.COST_OVERRUN_REVIEW: [
        (S.PO_GENERATED, [Role.GENERAL_MANAGER],                "gm_approve_cost"),
        (S.GM_REJECTED,  [Role.GENERAL_MANAGER],                "gm_reject_cost"),
    ],
    S.PO_GENERATED: [
        (S.RECEIVING, [Role.CENTRAL_WAREHOUSE],                 "receive_materials"),
    ],
    S.RECEIVING: [
        (S.QUALITY_CHECK, [Role.CENTRAL_WAREHOUSE],             "start_quality_check"),
    ],
    S.QUALITY_CHECK: [
        (S.DISPATCHED_TO_SITE, [Role.CENTRAL_WAREHOUSE],        "pass_qc"),
        (S.QUALITY_REJECTED,   [Role.CENTRAL_WAREHOUSE],        "fail_qc"),
    ],
    S.QUALITY_REJECTED: [
        (S.QUOTING, [Role.LOGISTICS],                           "reorder"),
    ],
    S.DISPATCHED_TO_SITE: [
        (S.DELIVERED, [Role.SITE_WAREHOUSE],                    "confirm_delivery"),
    ],
    S.DELIVERED: [
        (S.USER_CONFORMITY, [Role.SITE_WAREHOUSE, Role.ADMIN],  "request_conformity"),
    ],
    S.USER_CONFORMITY: [
        (S.CLOSED,     [Role.REQUESTER],                        "confirm_conformity"),
        (S.USER_CLAIM, [Role.REQUESTER],                        "raise_claim"),
    ],
    S.USER_CLAIM: [
        (S.STOCK_CHECK, [Role.LOGISTICS],                       "reprocess_claim"),
    ],
}
```

### Transition Service

```python
# apps/requests/services.py

from django.db import transaction
from apps.approvals.models import Approval
from apps.requests.state_machine import TRANSITION_MAP


class TransitionError(Exception):
    pass


class RequestTransitionService:
    def __init__(self, request, user):
        self.request = request
        self.user = user

    def get_available_actions(self):
        """Return actions available for current status + user role."""
        transitions = TRANSITION_MAP.get(self.request.status, [])
        return [
            {"action": action, "target_status": str(to_status)}
            for to_status, roles, action in transitions
            if self.user.has_any_role(roles)
        ]

    def execute(self, action: str, comments: str = "", metadata: dict = None):
        """Validate and execute a state transition atomically."""
        transitions = TRANSITION_MAP.get(self.request.status, [])

        target = None
        for to_status, allowed_roles, action_name in transitions:
            if action_name == action:
                target = (to_status, allowed_roles)
                break

        if target is None:
            raise TransitionError(
                f"Action '{action}' not valid for status '{self.request.status}'"
            )

        to_status, allowed_roles = target

        if not self.user.has_any_role(allowed_roles):
            raise TransitionError(
                f"User role '{self.user.primary_role}' cannot perform '{action}'"
            )

        with transaction.atomic():
            from_status = self.request.status
            self.request.status = to_status
            self.request.save(update_fields=["status", "updated_at"])

            Approval.objects.create(
                request=self.request,
                action=action,
                from_status=from_status,
                to_status=to_status,
                performed_by=self.user,
                comments=comments,
                metadata=metadata or {},
            )

        return self.request
```

---

## 4. Core REST API Endpoints

### 4.1 URL Configuration

```python
# config/urls.py

from django.urls import path, include

urlpatterns = [
    path("api/v1/auth/",        include("apps.accounts.urls")),
    path("api/v1/projects/",    include("apps.projects.urls")),
    path("api/v1/requests/",    include("apps.requests.urls")),
    path("api/v1/approvals/",   include("apps.approvals.urls")),
    path("api/v1/procurement/", include("apps.procurement.urls")),
    path("api/v1/warehouse/",   include("apps.warehouse.urls")),
    path("api/v1/dashboard/",   include("apps.dashboard.urls")),
]
```

### 4.2 Auth Endpoints

| Method | URL | Description | Roles |
|--------|-----|-------------|-------|
| `POST` | `/api/v1/auth/login/` | JWT login → `{access, refresh}` | All |
| `POST` | `/api/v1/auth/refresh/` | Refresh access token | All |
| `GET` | `/api/v1/auth/me/` | Current user + role + permissions | Authenticated |
| `POST` | `/api/v1/auth/logout/` | Blacklist refresh token | Authenticated |

### 4.3 Request Endpoints

| Method | URL | Description | Roles |
|--------|-----|-------------|-------|
| `GET` | `/api/v1/requests/` | List requests (filtered) | All authenticated |
| `POST` | `/api/v1/requests/` | Create supply request | Requester, Resident |
| `GET` | `/api/v1/requests/{id}/` | Request detail + items + history | All authenticated |
| `PATCH` | `/api/v1/requests/{id}/` | Update draft request | Owner only |
| `DELETE` | `/api/v1/requests/{id}/` | Delete draft request | Owner only |
| `POST` | `/api/v1/requests/{id}/action/` | Execute state transition | Role-dependent |
| `GET` | `/api/v1/requests/{id}/activity/` | Activity/audit log | All authenticated |
| `POST` | `/api/v1/requests/{id}/attachments/` | Upload attachment | Owner, Resident |
| `POST` | `/api/v1/requests/{id}/import-excel/` | Import items from Excel | Owner |

#### Action Endpoint — Request/Response

```json
// POST /api/v1/requests/42/action/
// Request:
{
    "action": "approve_technical",
    "comments": "Especificaciones verificadas, proceder con revisión presupuestal",
    "metadata": {
        "technical_notes": "Usar encofrado ULMA modelo X"
    }
}

// Response (200 OK):
{
    "id": 42,
    "rq_number": "RQ-2026-0042",
    "status": "TECHNICAL_APPROVED",
    "status_display": "Aprobado Técnicamente",
    "available_actions": [
        {"action": "send_to_budget", "target_status": "BUDGET_REVIEW"}
    ],
    "last_action": {
        "action": "approve_technical",
        "performed_by": "B. Mendez",
        "created_at": "2026-03-07T10:30:00Z"
    }
}
```

### 4.4 Approval Endpoints

| Method | URL | Description | Roles |
|--------|-----|-------------|-------|
| `GET` | `/api/v1/approvals/pending/` | My pending approval queue | Resident, Control, GM |
| `GET` | `/api/v1/approvals/history/` | My past approvals | All authenticated |
| `GET` | `/api/v1/approvals/request/{id}/` | Full approval chain for a request | All authenticated |

### 4.5 Procurement Endpoints

| Method | URL | Description | Roles |
|--------|-----|-------------|-------|
| `GET` | `/api/v1/procurement/suppliers/` | List suppliers | Logistics |
| `POST` | `/api/v1/procurement/suppliers/` | Create supplier | Logistics, Admin |
| `GET` | `/api/v1/procurement/quotations/` | List quotations | Logistics, GM |
| `POST` | `/api/v1/procurement/quotations/` | Create quotation | Logistics |
| `POST` | `/api/v1/procurement/quotations/{id}/select/` | Select winning quote | Logistics |
| `GET` | `/api/v1/procurement/purchase-orders/` | List POs | Logistics, GM |
| `POST` | `/api/v1/procurement/purchase-orders/` | Generate PO | Logistics |
| `GET` | `/api/v1/procurement/purchase-orders/{id}/` | PO detail | Logistics, GM |

### 4.6 Warehouse Endpoints

| Method | URL | Description | Roles |
|--------|-----|-------------|-------|
| `GET` | `/api/v1/warehouse/inventory/` | Stock levels | Logistics, Warehouse |
| `POST` | `/api/v1/warehouse/receptions/` | Register reception | Central Warehouse |
| `POST` | `/api/v1/warehouse/receptions/{id}/quality-check/` | Submit QC | Central Warehouse |
| `POST` | `/api/v1/warehouse/dispatches/` | Dispatch to site | Site Warehouse |
| `POST` | `/api/v1/warehouse/claims/` | Register claim | Requester, Warehouse |
| `GET` | `/api/v1/warehouse/claims/` | List claims | Logistics, Warehouse |

### 4.7 Dashboard Endpoints

| Method | URL | Description | Roles |
|--------|-----|-------------|-------|
| `GET` | `/api/v1/dashboard/summary/` | Role-specific KPI cards | All authenticated |
| `GET` | `/api/v1/dashboard/requests-by-status/` | Count by status | All authenticated |
| `GET` | `/api/v1/dashboard/budget-consumption/` | Budget usage by project | Control, GM |
| `GET` | `/api/v1/dashboard/recent-activity/` | Recent actions across system | All authenticated |

---

## 5. Permissions

```python
# apps/accounts/permissions.py

from rest_framework.permissions import BasePermission
from apps.accounts.models import Role


class IsRole(BasePermission):
    """Base class for role-based permissions."""
    required_roles: list[str] = []

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.has_any_role(self.required_roles)


class IsRequester(IsRole):
    required_roles = [Role.REQUESTER, Role.ADMIN]


class IsProjectResident(IsRole):
    required_roles = [Role.PROJECT_RESIDENT, Role.ADMIN]


class IsProjectControl(IsRole):
    required_roles = [Role.PROJECT_CONTROL, Role.ADMIN]


class IsGeneralManager(IsRole):
    required_roles = [Role.GENERAL_MANAGER, Role.ADMIN]


class IsLogistics(IsRole):
    required_roles = [Role.LOGISTICS, Role.ADMIN]


class IsCentralWarehouse(IsRole):
    required_roles = [Role.CENTRAL_WAREHOUSE, Role.ADMIN]


class IsSiteWarehouse(IsRole):
    required_roles = [Role.SITE_WAREHOUSE, Role.ADMIN]


class IsRequestOwner(BasePermission):
    """Only the request creator can modify their own requests."""
    def has_object_permission(self, request, view, obj):
        return obj.requested_by == request.user
```

---

## 6. Key Settings

```python
# config/settings/base.py

AUTH_USER_MODEL = "accounts.CustomUser"

INSTALLED_APPS = [
    # Django
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    # Project apps
    "apps.accounts",
    "apps.projects",
    "apps.requests",
    "apps.approvals",
    "apps.procurement",
    "apps.warehouse",
    "apps.dashboard",
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "common.pagination.StandardResultsPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
}

from datetime import timedelta

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# File uploads
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".jpg", ".jpeg", ".png"]
ALLOWED_UPLOAD_CONTENT_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "image/jpeg",
    "image/png",
]
```

---

## 7. Requirements

```
# requirements.txt
Django>=5.0,<6.0
djangorestframework>=3.15
djangorestframework-simplejwt>=5.3
django-cors-headers>=4.3
django-filter>=24.0
psycopg2-binary>=2.9
openpyxl>=3.1
python-magic>=0.4
gunicorn>=22.0
```
