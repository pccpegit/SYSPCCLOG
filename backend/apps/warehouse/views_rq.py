"""
Entrega guiada de un RQ desde el almacén (SYSPCC-029) · Fase 04 del ciclo operativo.

    GET  /warehouse/pending-requests/{rq_id}/picking/                      pasos 1-2 (lista de picking)
    POST /warehouse/pending-requests/{rq_id}/deliver/                      paso 5 (entrega por tandas)
    POST /warehouse/pending-requests/{rq_id}/deliveries/{id}/reverse/      anula una entrega

Nada de esto cambia el estado del RQ ni toca el WorkflowEngine: son operaciones de almacén. La
lógica vive en `services/rq_fulfillment.py` (escritura) y `services/rq_picking.py` (lectura); las
vistas solo autentican, validan la forma del payload y traducen `DeliveryError` a HTTP.

Quién puede qué:
* picking: roles de almacén/logística (`IsWarehouseRole`) y solo RQs que el usuario puede ver
  (`get_accessible_requests_queryset`, igual que el resto de la app).
* deliver: el rol que `TRANSITIONS` exige para DISPATCHED en el (flujo, estado) del RQ, solo en
  IN_STOCK / QUALITY_APPROVED (en QUALITY_APPROVED es Logística, no el almacenero).
* reverse: CENTRAL_WAREHOUSE o LOGISTICS_CHIEF, solo en IN_STOCK / QUALITY_APPROVED (donde la
  entrega se puede rehacer; después corresponde el ciclo de reclamo).
Ninguno honra is_superuser/is_staff.
"""
import logging

from django.db import IntegrityError
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.rq.permissions import get_accessible_requests_queryset
from apps.warehouse.permissions import CanReverseDelivery, IsWarehouseRole
from apps.warehouse.query_guard import RejectNulQueryParamsMixin
from apps.warehouse.serializers_rq import (
    DeliverInputSerializer,
    DeliveryResultSerializer,
    PickingSerializer,
    ReverseInputSerializer,
)
from apps.warehouse.services import rq_fulfillment as fulfillment
from apps.warehouse.services.rq_picking import build_picking, picking_statuses
from apps.warehouse.throttling import WarehouseDeliveryThrottle

logger = logging.getLogger(__name__)

SERVER_ERROR_MESSAGE = 'No se pudo completar la operación. Intente nuevamente.'


def _no_store(response):
    response['Cache-Control'] = 'no-store'
    return response


def _error_response(http_status: int, detail: str, code: str, **extra):
    """Same envelope as `apps.core.exceptions.custom_exception_handler`, plus a stable `code`."""
    return _no_store(Response(
        {'error': True, 'status_code': http_status, 'detail': detail, 'code': code, **extra},
        status=http_status,
    ))


def _error(exc: 'fulfillment.DeliveryError', request, rq_id):
    logger.warning(
        'warehouse.rq_delivery.rejected',
        extra={'code': exc.code, 'http_status': exc.status, 'request_id': rq_id,
               'user_id': request.user.pk, 'path': request.path},
    )
    return _error_response(exc.status, exc.message, exc.code, **exc.extra)


def _unexpected(request, rq_id, event):
    """Last barrier: log the traceback with context, answer a generic 500 (no internals)."""
    logger.exception(event, extra={'request_id': rq_id, 'user_id': request.user.pk})
    return _error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR, SERVER_ERROR_MESSAGE, 'INTERNAL_ERROR',
    )


# Constraint / column names that identify each IntegrityError we know how to explain.
_VOUCHER_NUMBER_MARKERS = ('group_number', 'movement_number')
_SINGLE_REVERSAL_MARKERS = ('uniq_dispatch_single_reversal', 'reverses')


def _integrity_error(exc, request, rq_id, event):
    """
    Translate an IntegrityError. Only a collision of the generated voucher numbers is retryable
    "as is"; the rest is logged with its traceback and answered with a generic conflict message.
    """
    text = str(exc)
    if any(marker in text for marker in _VOUCHER_NUMBER_MARKERS):
        logger.warning(f'{event}.voucher_number_conflict', extra={'request_id': rq_id})
        return _error_response(
            status.HTTP_409_CONFLICT,
            'No se pudo generar el N° de vale interno. Intente nuevamente.',
            'VOUCHER_NUMBER_CONFLICT',
        )
    if any(marker in text for marker in _SINGLE_REVERSAL_MARKERS):
        logger.warning(f'{event}.already_reversed', extra={'request_id': rq_id})
        return _error_response(
            status.HTTP_409_CONFLICT, 'Esta entrega ya fue anulada.', 'ALREADY_REVERSED',
        )
    logger.exception(f'{event}.integrity_error', extra={'request_id': rq_id, 'user_id': request.user.pk})
    return _error_response(
        status.HTTP_409_CONFLICT,
        'No se pudo registrar la operación por un conflicto de datos. '
        'Actualice la pantalla e intente nuevamente.',
        'INTEGRITY_CONFLICT',
    )


class PendingRequestDeliveryViewSet(RejectNulQueryParamsMixin, viewsets.ViewSet):
    """Picking, entregas por tandas y reversas de un RQ en la etapa de almacén."""

    permission_classes = [IsAuthenticated, IsWarehouseRole]
    lookup_field = 'pk'
    lookup_url_kwarg = 'rq_id'
    lookup_value_regex = r'\d+'

    def get_permissions(self):
        if self.action == 'reverse_delivery':
            return [IsAuthenticated(), IsWarehouseRole(), CanReverseDelivery()]
        return super().get_permissions()

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.action in ('deliver', 'reverse_delivery'):
            throttles.append(WarehouseDeliveryThrottle())
        return throttles

    # -- helpers --------------------------------------------------------------

    def _get_request(self, request, rq_id):
        """RQ visible para el usuario (misma fuente de visibilidad que RequestViewSet), o 404."""
        rq = (
            get_accessible_requests_queryset(request.user)
            .select_related('project', 'department', 'requested_by')
            .filter(pk=rq_id)
            .first()
        )
        if rq is None:
            raise NotFound('Requerimiento no encontrado.')
        return rq

    def _fresh_picking(self, request, rq_id):
        """Picking recalculado con los datos ya confirmados (después de escribir)."""
        return build_picking(self._get_request(request, rq_id), request.user)

    # -- picking (Fase 04, pasos 1-2) ------------------------------------------

    @extend_schema(
        tags=['warehouse'], summary='Lista de picking de un RQ',
        responses={200: PickingSerializer, 404: dict, 409: dict},
    )
    @action(detail=True, methods=['get'], url_path='picking')
    def picking(self, request, rq_id=None):
        rq = self._get_request(request, rq_id)
        if rq.status not in picking_statuses():
            return _error(fulfillment.DeliveryError(
                'INVALID_STATE',
                'El requerimiento no está en una etapa de almacén '
                f'(estado actual: «{fulfillment.status_label(rq.status)}»).',
                extra={'status': rq.status, 'allowed_statuses': list(picking_statuses())},
            ), request, rq_id)
        return _no_store(Response(PickingSerializer(build_picking(rq, request.user)).data))

    # -- deliver (Fase 04, paso 5) ----------------------------------------------

    @extend_schema(
        tags=['warehouse'], summary='Registrar una entrega parcial (por tandas) de un RQ',
        request=DeliverInputSerializer, responses={201: DeliveryResultSerializer, 400: dict, 403: dict, 404: dict, 409: dict},
    )
    @action(detail=True, methods=['post'], url_path='deliver')
    def deliver(self, request, rq_id=None):
        rq = self._get_request(request, rq_id)
        try:
            # Early rejection on the unlocked row (404 < 409 < 403 < 400); the service repeats it
            # under the row lock, which is the check that counts.
            fulfillment.assert_can_deliver(rq, request.user)
        except fulfillment.DeliveryError as exc:
            return _error(exc, request, rq_id)

        serializer = DeliverInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            result = fulfillment.deliver_request_items(
                rq.pk, request.user,
                [dict(line) for line in data['lines']],
                guide_number=data['dispatch_guide_number'],
                movement_date=data.get('movement_date'),
                notes=data.get('notes', ''),
            )
        except fulfillment.DeliveryError as exc:
            return _error(exc, request, rq_id)
        except IntegrityError as exc:
            return _integrity_error(exc, request, rq_id, 'warehouse.rq_delivery')
        except Exception:
            return _unexpected(request, rq_id, 'warehouse.rq_delivery.failed')

        return self._created(request, rq_id, result.dispatch.pk)

    # -- reverse ------------------------------------------------------------------

    @extend_schema(
        tags=['warehouse'], summary='Anular una entrega de un RQ con un contra-movimiento',
        request=ReverseInputSerializer, responses={201: DeliveryResultSerializer, 400: dict, 403: dict, 404: dict, 409: dict},
    )
    @action(
        detail=True, methods=['post'], url_path=r'deliveries/(?P<dispatch_id>\d+)/reverse',
        url_name='delivery-reverse',
    )
    def reverse_delivery(self, request, rq_id=None, dispatch_id=None):
        rq = self._get_request(request, rq_id)
        serializer = ReverseInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            reversal = fulfillment.reverse_delivery(
                rq.pk, int(dispatch_id), request.user,
                reason=data['reason'], movement_date=data.get('movement_date'),
            )
        except fulfillment.DeliveryError as exc:
            return _error(exc, request, rq_id)
        except IntegrityError as exc:
            return _integrity_error(exc, request, rq_id, 'warehouse.rq_reversal')
        except Exception:
            return _unexpected(request, rq_id, 'warehouse.rq_reversal.failed')

        return self._created(request, rq_id, reversal.pk)

    def _created(self, request, rq_id, dispatch_id):
        picking = self._fresh_picking(request, rq_id)
        delivery = next(d for d in picking['deliveries'] if d['id'] == dispatch_id)
        payload = DeliveryResultSerializer({'delivery': delivery, 'picking': picking}).data
        return _no_store(Response(payload, status=status.HTTP_201_CREATED))
