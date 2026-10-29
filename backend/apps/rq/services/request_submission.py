"""
Draft handling of an RQ (SYSPCC-031): numbering and submission.

A draft (`DRAFT`) is saved with minimal validation and without touching the approval
chain. Sending it is the EXISTING `DRAFT -> SUBMITTED` transition of the WorkflowEngine
(action SUBMITTED, role REQUESTER); this module only does what must happen around it:

* the draft is checked against the SAME rules as a direct creation (`readiness_errors`);
* the draft gets its definitive number `RQ-YYYY-NNNN` at that moment (see below);
* the catalog products it proposed are left in the activity log, like a direct creation.

RQ number
---------
`rq_number` is unique and mandatory, but a draft is not a requirement yet. A draft gets a
PROVISIONAL number (`BOR-` + 12 hex characters, see `new_provisional_number`) that is never
shown as an RQ number and never consumes the official sequence. The official number is
generated when the draft is sent, inside the same transaction as the transition: deleting a
draft, or a failed send, leaves no gap in `RQ-YYYY-NNNN`, and the number the Excel carries
is the one of the submitted RQ. `RQNumberGenerator` only looks at `RQ-YYYY-` numbers, so
provisional ones never interfere with it.
"""

import logging
import uuid

from django.db import IntegrityError, transaction
from rest_framework import serializers

from apps.core.enums import (
    OFICINA_CENTRAL_FRENTE,
    ApprovalActionChoices,
    RoleChoices,
    RQFlowChoices,
    RQStatusChoices,
)
from apps.core.exceptions import PermissionDeniedForAction
from apps.rq.models import Request
from apps.rq.services.number_generator import RQNumberGenerator
from apps.rq.services.request_items import log_proposed_catalog_links
from apps.rq.services.workflow_engine import WorkflowEngine

logger = logging.getLogger(__name__)

PROVISIONAL_PREFIX = 'BOR-'
SUBMIT_COMMENT = 'Requerimiento enviado para revisión.'
MAX_REQUEST_ITEMS = 200

MSG_AREA = 'Seleccione el área del RQ (OP, QC, HSE o ADM).'
MSG_FRONT = 'Seleccione el frente.'
MSG_SERVICE = 'Seleccione un servicio.'
MSG_NEED_DATE = 'Ingrese la fecha de entrega.'
MSG_PROJECT = 'El flujo Operaciones requiere un proyecto.'
MSG_DEPARTMENT = 'El flujo Administración requiere un departamento.'
MSG_OFICINA_CENTRAL = 'El frente "Oficina Central" debe registrarse por el flujo de Administración.'
MSG_NO_ITEMS = 'Agregue al menos un ítem al requerimiento.'
MSG_TOO_MANY_ITEMS = f'Un requerimiento admite como máximo {MAX_REQUEST_ITEMS} ítems.'
MSG_PICK_PRODUCT = 'Seleccione un producto del catálogo o márquelo como fuera de catálogo.'
MSG_DESCRIBE_OFF_CATALOG = 'Describa el ítem fuera de catálogo.'
MSG_QUANTITY = 'Ingrese la cantidad (mayor que 0).'
MSG_SOURCE = 'Seleccione la fuente del ítem.'
MSG_NOT_OWNER = 'Solo el solicitante puede enviar su borrador.'


def new_provisional_number() -> str:
    """Unique placeholder for `rq_number` while the RQ is a draft (16 characters)."""
    return f'{PROVISIONAL_PREFIX}{uuid.uuid4().hex[:12].upper()}'


def has_provisional_number(request_obj: Request) -> bool:
    return request_obj.rq_number.startswith(PROVISIONAL_PREFIX)


def readiness_errors(request_obj: Request) -> dict:
    """
    Everything a full (direct) creation demands, checked on a saved draft.

    Returns `{field: [messages]}` (empty when the RQ can be sent). `items` carries one
    message per problem, each starting with "Ítem N:". The checks are the union of what the
    backend demanded on creation (flow origin, "Oficina Central", area, at least one line,
    quantity > 0) and what the screen demanded of a full send (frente, servicio, fecha de
    entrega, product or off-catalog on every line, fuente).
    """
    errors: dict[str, list[str]] = {}

    def add(field: str, message: str) -> None:
        errors.setdefault(field, []).append(message)

    if not request_obj.requesting_area:
        add('requesting_area', MSG_AREA)
    if not (request_obj.front_area or '').strip():
        add('front_area', MSG_FRONT)
    if not (request_obj.service or '').strip():
        add('service', MSG_SERVICE)
    if request_obj.fecha_necesidad is None:
        add('fecha_necesidad', MSG_NEED_DATE)

    if request_obj.flow == RQFlowChoices.OPERATIONS and not request_obj.project_id:
        add('project', MSG_PROJECT)
    if request_obj.flow == RQFlowChoices.ADMINISTRATIVE and not request_obj.department_id:
        add('department', MSG_DEPARTMENT)
    if (
        (request_obj.front_area or '').strip().upper() == OFICINA_CENTRAL_FRENTE
        and request_obj.flow != RQFlowChoices.ADMINISTRATIVE
    ):
        add('flow', MSG_OFICINA_CENTRAL)

    items = list(request_obj.items.all().order_by('line_number', 'pk'))
    if not items:
        add('items', MSG_NO_ITEMS)
    if len(items) > MAX_REQUEST_ITEMS:
        add('items', MSG_TOO_MANY_ITEMS)
    for position, item in enumerate(items, start=1):
        problems = []
        if item.inventory_item_id is None:
            if not item.is_off_catalog:
                problems.append(MSG_PICK_PRODUCT)
            elif not (item.description or '').strip():
                problems.append(MSG_DESCRIBE_OFF_CATALOG)
        if item.quantity is None or item.quantity <= 0:
            problems.append(MSG_QUANTITY)
        if not item.item_source:
            problems.append(MSG_SOURCE)
        for problem in problems:
            add('items', f'Ítem {position}: {problem}')
    return errors


def _assign_official_number(locked: Request, ctx: dict) -> None:
    """
    Replace the provisional number by the next `RQ-YYYY-NNNN`. Only a unique-constraint
    collision on THIS statement is reported as a numbering problem (the generator serializes
    concurrent callers, so it should not happen); any other integrity error propagates.
    """
    try:
        with transaction.atomic():  # savepoint: a collision must not poison the outer transaction
            locked.rq_number = RQNumberGenerator.generate()
            locked.save(update_fields=['rq_number', 'updated_at'])
    except IntegrityError:
        logger.warning('rq.submit.number_collision', extra=ctx)
        raise serializers.ValidationError(
            {'rq_number': 'No se pudo generar el número de requerimiento, intente nuevamente.'}
        )


def submit_draft(request_obj: Request, user, acting_role: str = RoleChoices.REQUESTER, comments: str = ''):
    """
    Send a draft: validate it, give it its definitive number and run the existing
    `DRAFT -> SUBMITTED` transition through the WorkflowEngine (approval record,
    notifications, activity log: exactly what the engine does for any transition).

    Everything happens in ONE transaction: if the validation, the numbering or the engine
    fails, nothing changes (the draft keeps its provisional number).

    Raises:
        PermissionDeniedForAction: the user is not the requester of the draft.
        serializers.ValidationError: the RQ does not meet the rules of a full creation (400).
        WorkflowError: the RQ is not a draft any more, or the engine refused (400).
    Returns the `Approval` created by the engine.
    """
    ctx = {'rq_id': request_obj.pk, 'user_id': getattr(user, 'id', None)}
    with transaction.atomic():
        locked = Request.objects.select_for_update().get(pk=request_obj.pk)
        if locked.requested_by_id != user.id:
            raise PermissionDeniedForAction(message=MSG_NOT_OWNER, required_role=acting_role)

        # Not a draft any more: skip the checks and let the engine answer with its own
        # error for that state (a double send reaches this branch).
        if locked.status == RQStatusChoices.DRAFT:
            errors = readiness_errors(locked)
            if errors:
                logger.info('rq.submit.incomplete', extra=ctx | {'fields': sorted(errors)})
                raise serializers.ValidationError(errors)
            if has_provisional_number(locked):
                _assign_official_number(locked, ctx)

        engine = WorkflowEngine(request=locked, user=user, acting_role=acting_role)
        approval = engine.execute(
            action=ApprovalActionChoices.SUBMITTED,
            comments=comments or SUBMIT_COMMENT,
        )

        # A product picked by the requester is only a proposal: leave the trail for
        # logistics (same as the direct creation).
        lines = list(engine.request.items.select_related('inventory_item'))
        log_proposed_catalog_links(engine.request, lines, user)
    logger.info('rq.submit.ok', extra=ctx | {'rq_number': engine.request.rq_number})
    return approval
