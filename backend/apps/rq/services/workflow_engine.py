"""
Workflow Engine - the state machine for RQ lifecycle.

Enforces valid transitions based on:
- Current status of the Request
- User's role in the system
- Flow type (OPERATIONS or ADMINISTRATIVE)

Both workflow definitions are encoded here based on the DBML schema.
"""

import logging
from datetime import date
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.enums import (
    RQFlowChoices,
    RQStatusChoices,
    RoleChoices,
    ApprovalActionChoices,
    BudgetClassificationChoices,
)
from apps.core.exceptions import WorkflowError, PermissionDeniedForAction

logger = logging.getLogger(__name__)


# ============================================================
# TRANSITION TABLE
# Each entry: (flow, from_status, action) -> (required_role, to_status_approve, to_status_reject)
# ============================================================

# Sentinel meaning "any flow"
ANY = '__ANY__'

TRANSITIONS: list[dict] = [
    # ── PHASE 1: REQUEST SUBMISSION ──────────────────────────
    {
        'flow': ANY,
        'from_status': RQStatusChoices.DRAFT,
        'action': ApprovalActionChoices.SUBMITTED,
        'required_role': RoleChoices.REQUESTER,
        'to_status': RQStatusChoices.SUBMITTED,
        'to_status_reject': None,
    },

    # ── OPS: PHASE 2 - TECHNICAL VALIDATION ──────────────────
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.SUBMITTED,
        'action': ApprovalActionChoices.TECHNICAL_APPROVED,
        'required_role': RoleChoices.PROJECT_RESIDENT,
        'to_status': RQStatusChoices.TECHNICAL_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.SUBMITTED,
        'action': ApprovalActionChoices.TECHNICAL_REJECTED,
        'required_role': RoleChoices.PROJECT_RESIDENT,
        'to_status': RQStatusChoices.TECHNICAL_REJECTED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.TECHNICAL_APPROVED,
        'action': ApprovalActionChoices.BUDGET_CLASSIFIED,
        'required_role': RoleChoices.PROJECT_CONTROL,
        'to_status': None,
        'to_status_reject': None,
        'conditional': True,
        'handler': 'handle_ops_budget_classification',
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.TECHNICAL_APPROVED,
        'action': ApprovalActionChoices.BUDGET_REJECTED,
        'required_role': RoleChoices.PROJECT_CONTROL,
        'to_status': RQStatusChoices.TECHNICAL_REJECTED,
        'to_status_reject': None,
    },
    # ADDITIONAL_REQ → Residente evaluates if it's necessary
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.ADDITIONAL_REQ,
        'action': ApprovalActionChoices.TECHNICAL_APPROVED,
        'required_role': RoleChoices.PROJECT_RESIDENT,
        'to_status': RQStatusChoices.GM_REVIEW,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.ADDITIONAL_REQ,
        'action': ApprovalActionChoices.TECHNICAL_REJECTED,
        'required_role': RoleChoices.PROJECT_RESIDENT,
        'to_status': RQStatusChoices.TECHNICAL_REJECTED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.GM_REVIEW,
        'action': ApprovalActionChoices.GM_APPROVED,
        'required_role': RoleChoices.GENERAL_MANAGER,
        'to_status': RQStatusChoices.GM_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.GM_REVIEW,
        'action': ApprovalActionChoices.GM_REJECTED,
        'required_role': RoleChoices.GENERAL_MANAGER,
        'to_status': RQStatusChoices.GM_REJECTED,
        'to_status_reject': None,
    },
    # WITHIN_PROPOSAL or GM_APPROVED → VALIDATED
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.WITHIN_PROPOSAL,
        'action': ApprovalActionChoices.VALIDATED,
        'required_role': None,  # System action
        'to_status': RQStatusChoices.VALIDATED,
        'to_status_reject': None,
        'system_action': True,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.GM_APPROVED,
        'action': ApprovalActionChoices.VALIDATED,
        'required_role': None,
        'to_status': RQStatusChoices.VALIDATED,
        'to_status_reject': None,
        'system_action': True,
    },

    # ── ADM: PHASE 2 - ADMINISTRATIVE VALIDATION ─────────────
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.SUBMITTED,
        'action': ApprovalActionChoices.SUPERVISOR_APPROVED,
        'required_role': RoleChoices.DIRECT_SUPERVISOR,
        'to_status': RQStatusChoices.SUPERVISOR_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.SUBMITTED,
        'action': ApprovalActionChoices.SUPERVISOR_REJECTED,
        'required_role': RoleChoices.DIRECT_SUPERVISOR,
        'to_status': RQStatusChoices.SUPERVISOR_REJECTED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.SUPERVISOR_APPROVED,
        'action': ApprovalActionChoices.ADMIN_BUDGET_REVIEWED,
        'required_role': RoleChoices.ADMIN_MANAGER,
        'to_status': None,
        'to_status_reject': None,
        'conditional': True,
        'handler': 'handle_adm_budget_review',
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.SUPERVISOR_APPROVED,
        'action': ApprovalActionChoices.ADMIN_BUDGET_REJECTED,
        'required_role': RoleChoices.ADMIN_MANAGER,
        'to_status': RQStatusChoices.SUPERVISOR_REJECTED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.GM_REVIEW,
        'action': ApprovalActionChoices.GM_APPROVED,
        'required_role': RoleChoices.GENERAL_MANAGER,
        'to_status': RQStatusChoices.GM_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.GM_REVIEW,
        'action': ApprovalActionChoices.GM_REJECTED,
        'required_role': RoleChoices.GENERAL_MANAGER,
        'to_status': RQStatusChoices.GM_REJECTED,
        'to_status_reject': None,
    },
    # ADM step 5.2: Jefe Directo evaluates necessity when out of annual plan
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.OUT_OF_ANNUAL_PLAN,
        'action': ApprovalActionChoices.SUPERVISOR_APPROVED,
        'required_role': RoleChoices.DIRECT_SUPERVISOR,
        'to_status': RQStatusChoices.GM_REVIEW,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.OUT_OF_ANNUAL_PLAN,
        'action': ApprovalActionChoices.SUPERVISOR_REJECTED,
        'required_role': RoleChoices.DIRECT_SUPERVISOR,
        'to_status': RQStatusChoices.SUPERVISOR_REJECTED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.WITHIN_ANNUAL_PLAN,
        'action': ApprovalActionChoices.VALIDATED,
        'required_role': None,
        'to_status': RQStatusChoices.VALIDATED,
        'to_status_reject': None,
        'system_action': True,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.GM_APPROVED,
        'action': ApprovalActionChoices.VALIDATED,
        'required_role': None,
        'to_status': RQStatusChoices.VALIDATED,
        'to_status_reject': None,
        'system_action': True,
    },

    # ── PHASE 3: LOGISTICS - STOCK CHECK ─────────────────────
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.VALIDATED,
        'action': ApprovalActionChoices.STOCK_CHECKED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': None,
        'to_status_reject': None,
        'conditional': True,
        'handler': 'handle_stock_check',
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.VALIDATED,
        'action': ApprovalActionChoices.STOCK_CHECKED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': None,
        'to_status_reject': None,
        'conditional': True,
        'handler': 'handle_stock_check',
    },

    # ── PHASE 3: QUOTING ─────────────────────────────────────
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.REQUIRES_PURCHASE,
        'action': ApprovalActionChoices.QUOTE_REQUESTED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.QUOTING,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.REQUIRES_PURCHASE,
        'action': ApprovalActionChoices.QUOTE_REQUESTED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.QUOTING,
        'to_status_reject': None,
    },
    # OPS: Coord. Logístico compares quotes (step 11 in PDF)
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.QUOTING,
        'action': ApprovalActionChoices.QUOTE_COMPARED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.QUOTE_COMPARISON,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.QUOTE_COMPARISON,
        'action': ApprovalActionChoices.QUOTE_SELECTED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.QUOTE_SELECTED,
        'to_status_reject': None,
    },
    # ADM: Jefe Logístico compares quotes (step 11 in PDF)
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.QUOTING,
        'action': ApprovalActionChoices.QUOTE_COMPARED,
        'required_role': RoleChoices.LOGISTICS_CHIEF,
        'to_status': RQStatusChoices.QUOTE_COMPARISON,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.QUOTE_COMPARISON,
        'action': ApprovalActionChoices.QUOTE_SELECTED,
        'required_role': RoleChoices.LOGISTICS_CHIEF,
        'to_status': RQStatusChoices.QUOTE_SELECTED,
        'to_status_reject': None,
    },

    # ── PHASE 3: QUOTE COST REVIEW ─────────────────────────────
    # OPS: Control de Proyecto reviews if quote is within budget
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.QUOTE_SELECTED,
        'action': ApprovalActionChoices.QUOTE_COST_APPROVED,
        'required_role': RoleChoices.PROJECT_CONTROL,
        'to_status': RQStatusChoices.QUOTE_COST_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.QUOTE_SELECTED,
        'action': ApprovalActionChoices.QUOTE_COST_REJECTED,
        'required_role': RoleChoices.PROJECT_CONTROL,
        'to_status': RQStatusChoices.COST_OVERRUN_REVIEW,
        'to_status_reject': None,
    },
    # ADM: Gerente Administrativo reviews if quote is within budget
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.QUOTE_SELECTED,
        'action': ApprovalActionChoices.QUOTE_COST_APPROVED,
        'required_role': RoleChoices.ADMIN_MANAGER,
        'to_status': RQStatusChoices.QUOTE_COST_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.QUOTE_SELECTED,
        'action': ApprovalActionChoices.QUOTE_COST_REJECTED,
        'required_role': RoleChoices.ADMIN_MANAGER,
        'to_status': RQStatusChoices.COST_OVERRUN_REVIEW,
        'to_status_reject': None,
    },
    # After quote cost approved, Logistics generates PO (step 13 in PDF)
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.QUOTE_COST_APPROVED,
        'action': ApprovalActionChoices.PO_GENERATED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.PO_GENERATED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.QUOTE_COST_APPROVED,
        'action': ApprovalActionChoices.PO_GENERATED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.PO_GENERATED,
        'to_status_reject': None,
    },
    # After GG approves cost overrun, Logistics generates PO
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.COST_OVERRUN_APPROVED,
        'action': ApprovalActionChoices.PO_GENERATED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.PO_GENERATED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.COST_OVERRUN_APPROVED,
        'action': ApprovalActionChoices.PO_GENERATED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.PO_GENERATED,
        'to_status_reject': None,
    },
    # Cost overrun: GG review
    {
        'flow': ANY,
        'from_status': RQStatusChoices.COST_OVERRUN_REVIEW,
        'action': ApprovalActionChoices.COST_OVERRUN_APPROVED,
        'required_role': RoleChoices.GENERAL_MANAGER,
        'to_status': RQStatusChoices.COST_OVERRUN_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': ANY,
        'from_status': RQStatusChoices.COST_OVERRUN_REVIEW,
        'action': ApprovalActionChoices.COST_OVERRUN_REJECTED,
        'required_role': RoleChoices.GENERAL_MANAGER,
        'to_status': RQStatusChoices.COST_OVERRUN_REJECTED,
        'to_status_reject': None,
    },

    # ── PHASE 4: RECEPTION ────────────────────────────────────
    # OPS: Logistics receives from supplier
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.PO_GENERATED,
        'action': ApprovalActionChoices.RECEIVED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.RECEIVING,
        'to_status_reject': None,
    },
    # IN_STOCK: goes directly to warehouse (Almacén Central dispatches)
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.IN_STOCK,
        'action': ApprovalActionChoices.DISPATCHED,
        'required_role': RoleChoices.CENTRAL_WAREHOUSE,
        'to_status': RQStatusChoices.DISPATCHED_TO_SITE,
        'to_status_reject': None,
    },
    # OPS: Logistics checks conformity — conforme → delivers to warehouse, no conforme → claim
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.RECEIVING,
        'action': ApprovalActionChoices.QUALITY_APPROVED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.QUALITY_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.RECEIVING,
        'action': ApprovalActionChoices.QUALITY_REJECTED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.QUALITY_REJECTED,
        'to_status_reject': None,
    },
    # OPS: Logistics delivers to warehouse after conformity
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.QUALITY_APPROVED,
        'action': ApprovalActionChoices.DISPATCHED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.DISPATCHED_TO_SITE,
        'to_status_reject': None,
    },

    # ── SUPPLIER CLAIM CYCLE (when quality is rejected) ──────
    # Logistics sends claim to supplier
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.QUALITY_REJECTED,
        'action': ApprovalActionChoices.SUPPLIER_CLAIM_SENT,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.SUPPLIER_CLAIM_SENT,
        'to_status_reject': None,
    },
    # Logistics updates claim status (waiting for supplier)
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.SUPPLIER_CLAIM_SENT,
        'action': ApprovalActionChoices.SUPPLIER_CLAIM_UPDATED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.SUPPLIER_CLAIM_PENDING,
        'to_status_reject': None,
    },
    # Supplier sends replacement — logistics receives
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.SUPPLIER_CLAIM_PENDING,
        'action': ApprovalActionChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'to_status_reject': None,
    },
    # Also allow direct from SUPPLIER_CLAIM_SENT → replacement received
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.SUPPLIER_CLAIM_SENT,
        'action': ApprovalActionChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'to_status_reject': None,
    },
    # Check replacement quality — approve or reject again
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'action': ApprovalActionChoices.QUALITY_APPROVED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.QUALITY_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'action': ApprovalActionChoices.QUALITY_REJECTED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.QUALITY_REJECTED,
        'to_status_reject': None,
    },
    # OPS: Site warehouse updates records → DELIVERED
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.DISPATCHED_TO_SITE,
        'action': ApprovalActionChoices.WAREHOUSE_RECORDS_UPDATED,
        'required_role': RoleChoices.SITE_WAREHOUSE,
        'to_status': RQStatusChoices.DELIVERED,
        'to_status_reject': None,
    },

    # ADM: Sup. Logístico receives from supplier (step 14)
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.PO_GENERATED,
        'action': ApprovalActionChoices.RECEIVED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.RECEIVING,
        'to_status_reject': None,
    },
    # ADM IN_STOCK: goes directly to Central warehouse
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.IN_STOCK,
        'action': ApprovalActionChoices.DISPATCHED,
        'required_role': RoleChoices.CENTRAL_WAREHOUSE,
        'to_status': RQStatusChoices.DELIVERED,
        'to_status_reject': None,
    },
    # ADM step 15: ¿Conforme? (same cycle as OPS)
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.RECEIVING,
        'action': ApprovalActionChoices.QUALITY_APPROVED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.QUALITY_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.RECEIVING,
        'action': ApprovalActionChoices.QUALITY_REJECTED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.QUALITY_REJECTED,
        'to_status_reject': None,
    },
    # ADM step 16: Almacén Central entrega and updates records
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.QUALITY_APPROVED,
        'action': ApprovalActionChoices.DISPATCHED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.DISPATCHED_TO_SITE,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.DISPATCHED_TO_SITE,
        'action': ApprovalActionChoices.WAREHOUSE_RECORDS_UPDATED,
        'required_role': RoleChoices.CENTRAL_WAREHOUSE,
        'to_status': RQStatusChoices.DELIVERED,
        'to_status_reject': None,
    },
    # ADM: Supplier claim cycle (step 15.1)
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.QUALITY_REJECTED,
        'action': ApprovalActionChoices.SUPPLIER_CLAIM_SENT,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.SUPPLIER_CLAIM_SENT,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.SUPPLIER_CLAIM_SENT,
        'action': ApprovalActionChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'action': ApprovalActionChoices.QUALITY_APPROVED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.QUALITY_APPROVED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.SUPPLIER_REPLACEMENT_RECEIVED,
        'action': ApprovalActionChoices.QUALITY_REJECTED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.QUALITY_REJECTED,
        'to_status_reject': None,
    },
    # ADM: Central warehouse updates records after delivery
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.DELIVERED,
        'action': ApprovalActionChoices.WAREHOUSE_RECORDS_UPDATED,
        'required_role': RoleChoices.CENTRAL_WAREHOUSE,
        'to_status': RQStatusChoices.WAREHOUSE_UPDATED,
        'to_status_reject': None,
    },

    # ── PHASE 5: USER CONFORMITY ──────────────────────────────
    # OPS: User confirms or claims from DELIVERED
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.DELIVERED,
        'action': ApprovalActionChoices.USER_CONFIRMED,
        'required_role': RoleChoices.REQUESTER,
        'to_status': RQStatusChoices.USER_CONFORMITY,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.DELIVERED,
        'action': ApprovalActionChoices.USER_CLAIMED,
        'required_role': RoleChoices.REQUESTER,
        'to_status': RQStatusChoices.CLAIM_IN_REVIEW,
        'to_status_reject': None,
    },
    # ADM: User confirms or claims from WAREHOUSE_UPDATED
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.WAREHOUSE_UPDATED,
        'action': ApprovalActionChoices.USER_CONFIRMED,
        'required_role': RoleChoices.REQUESTER,
        'to_status': RQStatusChoices.USER_CONFORMITY,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.WAREHOUSE_UPDATED,
        'action': ApprovalActionChoices.USER_CLAIMED,
        'required_role': RoleChoices.REQUESTER,
        'to_status': RQStatusChoices.CLAIM_IN_REVIEW,
        'to_status_reject': None,
    },
    # Claim in review: Logistics sends claim to supplier (step 18.2 → 15.1)
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.CLAIM_IN_REVIEW,
        'action': ApprovalActionChoices.SUPPLIER_CLAIM_SENT,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.SUPPLIER_CLAIM_SENT,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.CLAIM_IN_REVIEW,
        'action': ApprovalActionChoices.SUPPLIER_CLAIM_SENT,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.SUPPLIER_CLAIM_SENT,
        'to_status_reject': None,
    },

    # Closure
    {
        'flow': RQFlowChoices.OPERATIONS,
        'from_status': RQStatusChoices.USER_CONFORMITY,
        'action': ApprovalActionChoices.CLOSED,
        'required_role': RoleChoices.LOGISTICS_COORDINATOR,
        'to_status': RQStatusChoices.CLOSED,
        'to_status_reject': None,
    },
    {
        'flow': RQFlowChoices.ADMINISTRATIVE,
        'from_status': RQStatusChoices.USER_CONFORMITY,
        'action': ApprovalActionChoices.CLOSED,
        'required_role': RoleChoices.LOGISTICS_SUPERVISOR,
        'to_status': RQStatusChoices.CLOSED,
        'to_status_reject': None,
    },

    # Universal cancellation
    {
        'flow': ANY,
        'from_status': None,  # Any non-terminal status
        'action': ApprovalActionChoices.CANCELLED,
        'required_role': None,  # Checked separately
        'to_status': RQStatusChoices.CANCELLED,
        'to_status_reject': None,
        'handler': 'handle_cancellation',
    },
]


class WorkflowEngine:
    """
    State machine engine for RQ workflow transitions.

    Usage:
        engine = WorkflowEngine(request, user, role)
        engine.execute(action='SUBMITTED', comments='...')
    """

    def __init__(self, request, user, acting_role: str):
        self.request = request
        self.user = user
        self.acting_role = acting_role

    @transaction.atomic
    def execute(
        self,
        action: str,
        comments: str = '',
        extra_data: dict | None = None,
    ) -> 'apps.rq.models.Approval':
        """
        Execute a workflow action on the request.

        Args:
            action: One of ApprovalActionChoices values.
            comments: Optional comment from the actor.
            extra_data: Additional data needed for conditional handlers.

        Returns:
            The created Approval record.

        Raises:
            WorkflowError: If the transition is not valid.
            PermissionDeniedForAction: If the user lacks the required role.
        """
        # Security: validate acting_role is actually held by the user before any other logic.
        self._validate_acting_role()

        from apps.rq.models import Approval, WorkflowStep, Request

        # SYSPCC-007: self.request was loaded by the caller (the view) *before* this
        # atomic block started, so it can be stale relative to another concurrent
        # transition on the same RQ (lost update / double approval). Re-fetch with a
        # row lock now that we're inside the transaction — every read/decision below
        # (is_terminal, status, current_step, etc.) is then based on the locked,
        # up-to-date row, and any concurrent transition blocks until this one commits.
        self.request = Request.objects.select_for_update().get(pk=self.request.pk)

        if self.request.is_terminal and action != ApprovalActionChoices.CANCELLED:
            raise WorkflowError(
                message=f'El requerimiento {self.request.rq_number} está en estado terminal: {self.request.status}.',
                current_status=self.request.status,
                attempted_action=action,
            )

        transition = self._find_transition(action)
        if not transition:
            raise WorkflowError(
                message=(
                    f'Transición no permitida: acción "{action}" '
                    f'desde estado "{self.request.status}" en flujo "{self.request.flow}".'
                ),
                current_status=self.request.status,
                attempted_action=action,
            )

        self._check_role_permission(transition)

        previous_status = self.request.status

        # Call conditional handler if needed
        handler_name = transition.get('handler')
        if handler_name:
            new_status = self._call_handler(handler_name, transition, extra_data or {})
        else:
            new_status = transition['to_status']

        # Get corresponding workflow step
        workflow_step = self._get_workflow_step(action)

        # Update request status
        self.request.status = new_status
        self.request.current_step = workflow_step

        # Post-transition side effects
        self._apply_side_effects(action, previous_status, new_status, extra_data or {})

        self.request.save()

        # Create immutable approval record
        approval = Approval.objects.create(
            request=self.request,
            workflow_step=workflow_step,
            action=action,
            performed_by=self.user,
            role=self.acting_role,
            previous_status=previous_status,
            new_status=new_status,
            comments=comments,
        )

        # Log activity
        self._log_activity(action, previous_status, new_status)

        # Send notifications
        self._send_notifications(action, new_status)

        logger.info(
            'RQ %s: %s → %s by %s (%s)',
            self.request.rq_number, previous_status, new_status,
            self.user.username, self.acting_role,
        )

        # Auto-execute chained system actions (e.g. WITHIN_PROPOSAL → VALIDATED)
        self._execute_system_chain(new_status, comments)

        return approval

    def _execute_system_chain(self, current_status: str, comments: str = '') -> None:
        """Auto-execute system transitions that follow the current status."""
        from apps.rq.models import Approval

        for t in TRANSITIONS:
            flow_ok = t['flow'] == ANY or t['flow'] == self.request.flow
            status_ok = t['from_status'] == current_status
            is_system = t.get('system_action', False)

            if flow_ok and status_ok and is_system:
                prev = self.request.status
                new = t['to_status']
                self.request.status = new
                self.request.save(update_fields=['status'])

                Approval.objects.create(
                    request=self.request,
                    workflow_step=self._get_workflow_step(t['action']),
                    action=t['action'],
                    performed_by=self.user,
                    role='SYSTEM',
                    previous_status=prev,
                    new_status=new,
                    comments='Transición automática del sistema.',
                )

                logger.info(
                    'RQ %s: AUTO %s → %s (system)',
                    self.request.rq_number, prev, new,
                )

                # Recurse in case there's another chained system action
                self._execute_system_chain(new, comments)
                break

    def get_available_actions(self) -> list[dict]:
        """Return list of actions the current user can perform on this request."""
        available = []
        for t in TRANSITIONS:
            flow_ok = t['flow'] == ANY or t['flow'] == self.request.flow
            status_ok = t['from_status'] is None or t['from_status'] == self.request.status
            role_ok = (
                t.get('system_action')
                or t['required_role'] is None
                or self._user_has_role(t['required_role'])
            )
            if flow_ok and status_ok and role_ok:
                available.append({
                    'action': t['action'],
                    'label': ApprovalActionChoices(t['action']).label
                    if t['action'] in ApprovalActionChoices.values else t['action'],
                    'requires_rejection_path': t.get('to_status_reject') is not None,
                })
        return available

    # ─────────────────────────────────────────────────────────
    # PRIVATE HELPERS
    # ─────────────────────────────────────────────────────────

    def _find_transition(self, action: str) -> dict | None:
        for t in TRANSITIONS:
            flow_match = t['flow'] == ANY or t['flow'] == self.request.flow
            status_match = t['from_status'] is None or t['from_status'] == self.request.status
            action_match = t['action'] == action
            if flow_match and status_match and action_match:
                return t
        return None

    def _check_role_permission(self, transition: dict) -> None:
        required = transition.get('required_role')
        if required is None or transition.get('system_action'):
            return
        if not self._user_has_role(required):
            raise PermissionDeniedForAction(
                message=(
                    f'El usuario {self.user.username} no tiene el rol requerido '
                    f'"{required}" para esta acción.'
                ),
                required_role=required,
                user_roles=list(self.user.user_roles.values_list('role', flat=True)),
            )

    def _validate_acting_role(self) -> None:
        """Verify the declared acting_role is actually assigned to the user in the database."""
        if not self.user.user_roles.filter(role=self.acting_role).exists():
            raise PermissionDeniedForAction(
                message=(
                    f'El usuario {self.user.username} no posee el rol declarado '
                    f'"{self.acting_role}". No se puede actuar en nombre de un rol no asignado.'
                ),
                required_role=self.acting_role,
                user_roles=list(self.user.user_roles.values_list('role', flat=True)),
            )

    def _user_has_role(self, role: str) -> bool:
        # Always verify against the database; never short-circuit via acting_role.
        return self.user.user_roles.filter(role=role).exists()

    def _get_workflow_step(self, action: str):
        from apps.rq.models import WorkflowStep
        return WorkflowStep.objects.filter(
            flow=self.request.flow,
            from_status=self.request.status,
        ).first()

    def _call_handler(self, handler_name: str, transition: dict, extra_data: dict) -> str:
        handler = getattr(self, handler_name, None)
        if handler is None:
            raise WorkflowError(f'Handler no encontrado: {handler_name}')
        return handler(transition, extra_data)

    def _apply_side_effects(
        self,
        action: str,
        previous_status: str,
        new_status: str,
        extra_data: dict,
    ) -> None:
        """Apply side effects after a transition (SLA calc, budget commit, inventory, etc.)."""
        if new_status == RQStatusChoices.VALIDATED:
            self._on_validated(extra_data)
        elif new_status in (RQStatusChoices.CANCELLED, RQStatusChoices.GM_REJECTED,
                             RQStatusChoices.SUPERVISOR_REJECTED, RQStatusChoices.TECHNICAL_REJECTED,
                             RQStatusChoices.COST_OVERRUN_REJECTED):
            self._on_terminal_rejection()

        # ── Inventory movements linked to RQ (central warehouse only) ──
        if action == ApprovalActionChoices.RECEIVED:
            self._on_material_received(extra_data)
        elif action == ApprovalActionChoices.DISPATCHED:
            self._on_dispatched(extra_data)

    def _on_validated(self, extra_data: dict) -> None:
        """When a request is validated: calculate SLA, commit budget."""
        from apps.rq.services.sla_calculator import SLACalculator
        from apps.rq.services.budget_validator import BudgetValidator

        if not self.request.fecha_estimada_entrega:
            self.request.fecha_estimada_entrega = SLACalculator.calculate_estimated_delivery(
                acquisition_type=self.request.acquisition_type,
                from_date=date.today(),
            )

        # Commit budget (best-effort: don't fail the transition if no line set)
        try:
            BudgetValidator.commit_budget(self.request)
        except Exception as exc:
            logger.warning('Budget commit failed for %s: %s', self.request.rq_number, exc)

    def _on_terminal_rejection(self) -> None:
        """When a request is terminated: release committed budget."""
        from apps.rq.services.budget_validator import BudgetValidator
        try:
            BudgetValidator.release_budget(self.request)
        except Exception as exc:
            logger.warning('Budget release failed for %s: %s', self.request.rq_number, exc)

    # ── Inventory integration ─────────────────────────────────

    def _resolve_inventory_item(self, item):
        """
        Resolve the Inventory instance for a RequestItem.
        Prefers the direct FK; falls back to fuzzy description/code search.
        Returns None (and logs) if no match is found.
        """
        from apps.warehouse.models import Inventory

        inv = item.inventory_item
        if inv:
            return inv

        # Fuzzy fallback: match by full description or first word as product_code
        first_word = item.description.split()[0] if item.description else ''
        inv = Inventory.objects.filter(
            Q(description__icontains=item.description) |
            Q(product_code__iexact=first_word)
        ).first()

        if not inv:
            logger.info(
                'RQ %s item "%s" has no matching inventory product — skipping movement.',
                self.request.rq_number, item.description,
            )
        return inv

    def _build_items_data(self, movement_type):
        """
        Build the items_data list for register_entry_batch / register_exit_batch.

        Filtering rules:
          - ENTRY (RECEIVED): skip items with supply_source='STOCK' (they were served
            from existing stock, no supplier purchase happened).
          - EXIT (DISPATCHED): include all items that have a linked inventory product.

        Returns a list of dicts ready for the batch service, or [] if nothing to move.
        """
        items_data = []
        line = 1
        for item in self.request.items.select_related('inventory_item').all():
            # ENTRY: skip items that were fulfilled from existing stock.
            if movement_type == 'ENTRY' and item.supply_source == 'STOCK':
                logger.info(
                    'RQ %s item "%s" served from stock — skipping entry movement.',
                    self.request.rq_number, item.description,
                )
                continue

            inv = self._resolve_inventory_item(item)
            if inv is None:
                continue

            items_data.append({
                'inventory_id': inv.pk,
                'quantity': item.quantity,
                'line': line,
            })
            line += 1

        return items_data

    def _on_material_received(self, extra_data: dict) -> None:
        """
        RECEIVED: Material arrives from supplier.
        1. Creates a batch ENTRY (InventoryMovement records) via MovementGroup.
        2. Creates a formal WarehouseReceipt linked to the group and the RQ.
        3. Creates WarehouseReceiptItem for each RequestItem with purchase supply_source.
        Best-effort: inventory and document errors never fail the workflow transition.
        """
        from apps.warehouse.services.movements import register_entry_batch
        from apps.warehouse.models import WarehouseReceipt, WarehouseReceiptItem

        try:
            items_data = self._build_items_data('ENTRY')
            if not items_data:
                logger.info(
                    'RQ %s RECEIVED: no purchasable items with linked inventory — skipping entry batch.',
                    self.request.rq_number,
                )
                return

            # 1. Create inventory movements batch
            group = register_entry_batch(
                items_data=items_data,
                warehouse='CENTRAL',
                project_id=None,
                source_type='PURCHASE',
                supplier_name=f'RQ {self.request.rq_number}',
                invoice_number='',
                notes=f'Recepción automática RQ {self.request.rq_number}',
                registered_by=self.user,
            )
            logger.info(
                'RQ %s RECEIVED: entry batch created — group %s (%d items).',
                self.request.rq_number, group.group_number, len(items_data),
            )

            # 2. Create formal WarehouseReceipt linked to the group
            last_po = self.request.purchase_orders.order_by('-created_at').first()
            receipt = WarehouseReceipt.objects.create(
                request=self.request,
                purchase_order=last_po,
                received_by=self.user,
                receipt_number=group.group_number,
                conformity_passed=True,
                conformity_checked_by=self.user,
                movement_group=group,
                notes=f'Recepción automática desde workflow RQ {self.request.rq_number}',
            )

            # 3. Create WarehouseReceiptItem per eligible RequestItem
            for item in self.request.items.select_related('inventory_item').all():
                if item.supply_source == 'STOCK':
                    continue
                last_po_item = (
                    item.purchase_order_items.order_by('-created_at').first()
                    if hasattr(item, 'purchase_order_items') else None
                )
                WarehouseReceiptItem.objects.create(
                    receipt=receipt,
                    request_item=item,
                    purchase_order_item=last_po_item,
                    quantity_received=item.quantity,
                    quantity_accepted=item.quantity,
                    quantity_rejected=0,
                )
            logger.info(
                'RQ %s RECEIVED: WarehouseReceipt %s created and linked to group %s.',
                self.request.rq_number, receipt.pk, group.group_number,
            )
        except Exception as exc:
            logger.warning('Inventory entry batch failed for %s: %s', self.request.rq_number, exc)

    def _on_dispatched(self, extra_data: dict) -> None:
        """
        DISPATCHED: Warehouse sends items to site/department.
        1. Creates a batch EXIT (InventoryMovement records) via MovementGroup.
        2. Creates a formal WarehouseDispatch linked to the group and the RQ.
        3. Creates WarehouseDispatchItem for each RequestItem with linked inventory.
        Best-effort: inventory and document errors never fail the workflow transition.
        """
        from apps.warehouse.services.movements import register_exit_batch
        from apps.warehouse.models import WarehouseDispatch, WarehouseDispatchItem

        try:
            items_data = self._build_items_data('EXIT')
            if not items_data:
                logger.info(
                    'RQ %s DISPATCHED: no items with linked inventory — skipping exit batch.',
                    self.request.rq_number,
                )
                return

            project_id = self.request.project_id if self.request.project_id else None
            if self.request.project:
                destination_type = 'PROJECT'
                destination_detail = self.request.project.name
            elif self.request.department:
                destination_type = 'DEPARTMENT'
                destination_detail = self.request.department.name
            else:
                destination_type = 'OTHER'
                destination_detail = ''

            # 1. Create inventory movements batch
            group = register_exit_batch(
                items_data=items_data,
                warehouse='CENTRAL',
                project_id=project_id,
                destination_type=destination_type,
                destination_detail=destination_detail,
                requested_by_id=self.request.requested_by_id,
                authorized_by_id=None,
                notes=f'Despacho automático RQ {self.request.rq_number}',
                registered_by=self.user,
            )
            logger.info(
                'RQ %s DISPATCHED: exit batch created — group %s (%d items).',
                self.request.rq_number, group.group_number, len(items_data),
            )

            # 2. Create formal WarehouseDispatch linked to the group
            last_receipt = (
                self.request.warehouse_receipts.order_by('-received_at').first()
                if hasattr(self.request, 'warehouse_receipts') else None
            )
            dispatch = WarehouseDispatch.objects.create(
                request=self.request,
                receipt=last_receipt,
                dispatched_by=self.user,
                dispatch_number=group.group_number,
                origin='CENTRAL',
                destination_project=self.request.project,
                destination_department=self.request.department,
                movement_group=group,
                notes=f'Despacho automático desde workflow RQ {self.request.rq_number}',
            )

            # 3. Create WarehouseDispatchItem per eligible RequestItem
            for item in self.request.items.select_related('inventory_item').all():
                inv = self._resolve_inventory_item(item)
                if inv is None:
                    continue
                WarehouseDispatchItem.objects.create(
                    dispatch=dispatch,
                    request_item=item,
                    quantity_dispatched=item.quantity,
                )
            logger.info(
                'RQ %s DISPATCHED: WarehouseDispatch %s created and linked to group %s.',
                self.request.rq_number, dispatch.pk, group.group_number,
            )
        except Exception as exc:
            logger.warning('Inventory exit batch failed for %s: %s', self.request.rq_number, exc)

    def _log_activity(self, action: str, previous_status: str, new_status: str) -> None:
        from apps.rq.models import ActivityLog
        ActivityLog.objects.create(
            request=self.request,
            user=self.user,
            action=action,
            detail=f'{previous_status} → {new_status}',
        )

    def _send_notifications(self, action: str, new_status: str) -> None:
        """Send in-app notifications to relevant users after a transition."""
        from apps.rq.services.notification_service import NotificationService
        try:
            NotificationService.notify_on_transition(self.request, action, new_status, self.user)
        except Exception as exc:
            logger.warning('Notification failed for %s: %s', self.request.rq_number, exc)

    # ─────────────────────────────────────────────────────────
    # CONDITIONAL HANDLERS
    # ─────────────────────────────────────────────────────────

    def handle_ops_budget_classification(self, transition: dict, extra_data: dict) -> str:
        """
        OPS: PROJECT_CONTROL classifies the RQ as WITHIN_PROPOSAL or ADDITIONAL_REQ.
        extra_data must contain: { 'classification': 'BC_WITHIN_PROPOSAL' | 'BC_ADDITIONAL' }
        """
        classification = extra_data.get('classification')
        if classification == BudgetClassificationChoices.BC_WITHIN_PROPOSAL:
            self.request.budget_classification = BudgetClassificationChoices.BC_WITHIN_PROPOSAL
            return RQStatusChoices.WITHIN_PROPOSAL
        elif classification == BudgetClassificationChoices.BC_ADDITIONAL:
            self.request.budget_classification = BudgetClassificationChoices.BC_ADDITIONAL
            return RQStatusChoices.ADDITIONAL_REQ
        else:
            raise WorkflowError(
                'classification debe ser BC_WITHIN_PROPOSAL o BC_ADDITIONAL en extra_data.'
            )

    def handle_adm_budget_review(self, transition: dict, extra_data: dict) -> str:
        """
        ADM: ADMIN_MANAGER classifies the RQ vs annual plan.
        extra_data must contain: { 'within_plan': True | False }
        If out of plan → goes to OUT_OF_ANNUAL_PLAN for Jefe Directo to evaluate necessity (step 5.2)
        """
        within_plan = extra_data.get('within_plan')
        if within_plan is True:
            self.request.budget_classification = BudgetClassificationChoices.BC_WITHIN_ANNUAL_PLAN
            return RQStatusChoices.WITHIN_ANNUAL_PLAN
        elif within_plan is False:
            self.request.budget_classification = BudgetClassificationChoices.BC_OUT_OF_ANNUAL_PLAN
            return RQStatusChoices.OUT_OF_ANNUAL_PLAN
        else:
            raise WorkflowError('within_plan (True/False) requerido en extra_data.')

    def handle_stock_check(self, transition: dict, extra_data: dict) -> str:
        """
        Logistics checks stock availability.
        extra_data must contain: { 'has_stock': True | False }
        """
        has_stock = extra_data.get('has_stock')
        if has_stock is True:
            return RQStatusChoices.IN_STOCK
        elif has_stock is False:
            return RQStatusChoices.REQUIRES_PURCHASE
        else:
            raise WorkflowError('has_stock (True/False) requerido en extra_data.')

    def handle_quote_to_po(self, transition: dict, extra_data: dict) -> str:
        """
        Check if selected quote is within budget.
        extra_data must contain: { 'within_budget': True | False }
        """
        within_budget = extra_data.get('within_budget')
        if within_budget is True:
            return RQStatusChoices.PO_GENERATED
        elif within_budget is False:
            return RQStatusChoices.COST_OVERRUN_REVIEW
        else:
            raise WorkflowError('within_budget (True/False) requerido en extra_data.')

    def handle_cancellation(self, transition: dict, extra_data: dict) -> str:
        """Allow cancellation from any non-terminal status."""
        if self.request.is_terminal:
            raise WorkflowError(
                f'No se puede cancelar un RQ en estado terminal: {self.request.status}.'
            )
        return RQStatusChoices.CANCELLED
