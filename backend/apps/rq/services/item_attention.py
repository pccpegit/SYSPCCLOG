"""
Seguimiento manual de un ítem de RQ: STAND BY / DESESTIMADO (SYSPCC-030).

Es la única decisión humana sobre el estado de un ítem en el Master. Fija o quita
`RequestItem.attention_override` con un motivo obligatorio, dentro de una transacción y con el
RQ bloqueado, y deja en el `ActivityLog` quién, cuándo y por qué. No cambia el estado del RQ, no
crea `Approval` ni habilita transiciones del flujo de trabajo.
"""
import logging
from dataclasses import dataclass

from django.db import transaction

from apps.core.enums import AttentionOverrideChoices
from apps.core.exceptions import RequestItemConflict
from apps.rq.models import ActivityLog, Request, RequestItem

logger = logging.getLogger(__name__)

ACTIVITY_ACTION = 'ITEM_ATTENTION_OVERRIDE'


class ItemNotFound(Exception):
    """El ítem no existe o no pertenece a ese RQ."""


@dataclass(frozen=True)
class OverrideResult:
    item: RequestItem
    changed: bool


def _describe(item: RequestItem, before: str, before_note: str, after: str, note: str) -> str:
    labels = dict(AttentionOverrideChoices.choices)
    if after:
        text = f'Línea {item.line_number}: marcada como {labels[after]}. Motivo: {note}'
        if before and before != after:
            text += f' (antes: {labels.get(before, before)})'
        return text
    text = f'Línea {item.line_number}: se quitó el seguimiento manual ({labels.get(before, before)}).'
    if note:
        text += f' Motivo: {note}'
    return text


def set_attention_override(request_id: int, item_id: int, user, override: str, note: str) -> OverrideResult:
    """
    Fija (`override` = STAND_BY | DESESTIMADO, con `note`) o quita (`override` = '') el
    seguimiento manual del ítem.

    Raises:
        Request.DoesNotExist: el RQ ya no existe.
        ItemNotFound: el ítem no es de ese RQ.
        RequestItemConflict(REQUEST_TERMINAL): el RQ está en un estado final.
    """
    note = (note or '').strip()
    override = override or ''
    if override and not note:  # defensa: el serializer ya lo exige
        raise ValueError('El motivo es obligatorio al fijar un seguimiento manual.')

    with transaction.atomic():
        locked = Request.objects.select_for_update().get(pk=request_id)
        if locked.is_terminal:
            raise RequestItemConflict(
                'El requerimiento ya está en un estado final: su seguimiento no se puede modificar.',
                code=RequestItemConflict.REQUEST_TERMINAL,
            )
        try:
            item = RequestItem.objects.select_for_update().get(pk=item_id, request_id=locked.pk)
        except RequestItem.DoesNotExist as exc:
            raise ItemNotFound() from exc

        stored_note = note if override else ''
        if item.attention_override == override and item.attention_note == stored_note:
            return OverrideResult(item=item, changed=False)   # idempotente: sin log ni escritura

        before, before_note = item.attention_override, item.attention_note
        item.attention_override = override
        item.attention_note = stored_note
        item.save(update_fields=['attention_override', 'attention_note'])
        ActivityLog.objects.create(
            request=locked,
            user=user,
            action=ACTIVITY_ACTION,
            detail=_describe(item, before, before_note, override, note),
        )

    logger.info(
        'rq.item_attention.updated',
        extra={
            'rq_id': request_id, 'item_id': item_id, 'user_id': user.pk,
            'override': override or None, 'previous': before or None,
        },
    )
    return OverrideResult(item=item, changed=True)
