"""
Master de RQ (SYSPCC-030): seguimiento por ítem de todos los RQs que el usuario puede ver.

    GET /api/v1/request-master/            listado paginado (una fila por ítem)
    GET /api/v1/request-master/summary/    una fila por RQ + KPIs globales
    GET /api/v1/request-master/export/     Excel (MASTER, RESUMEN POR RQ, ENTREGAS)

Solo lectura y derivado: el estado, lo atendido y las fechas salen de lo que registra el almacén
(`services/item_tracking.py`). El único dato editable (STAND BY / DESESTIMADO con motivo) vive en
`RequestViewSet.attention_override`. La visibilidad es siempre `get_accessible_requests_queryset`
(un solicitante ve solo lo suyo; Residente y Control su proyecto; gerencia y logística todo). No
expone precios ni costos ni datos de trabajadores.
"""
import logging

from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.rq.serializers.master import (
    MasterQuerySerializer,
    MasterRowSerializer,
    MasterSummaryRowSerializer,
    SummaryQuerySerializer,
)
from apps.rq.services import request_master as master
from apps.rq.services.request_master_export import XLSX_CONTENT_TYPE, build_master_workbook
from apps.rq.throttling import RequestMasterExportThrottle
from apps.warehouse.query_guard import RejectNulQueryParamsMixin

logger = logging.getLogger(__name__)

SERVER_ERROR_MESSAGE = 'No se pudo completar la operación. Intente nuevamente.'


class MasterPagination(PageNumberPagination):
    """Paginación estándar del proyecto (`count/next/previous/results`) con tamaño elegible."""

    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class MasterSummaryPagination(MasterPagination):
    """Igual, más los KPIs de todo el conjunto filtrado (no solo de la página)."""

    kpis = None

    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        response.data['kpis'] = self.kpis
        return response


def _params(request, serializer_class=MasterQuerySerializer) -> master.MasterParams:
    serializer = serializer_class(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    return master.MasterParams.from_validated(serializer.validated_data)


def _no_store(response):
    response['Cache-Control'] = 'no-store'
    return response


class RequestMasterViewSet(RejectNulQueryParamsMixin, viewsets.ViewSet):
    """Master de RQ: listado, resumen por RQ y Excel."""

    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.action == 'export':
            throttles.append(RequestMasterExportThrottle())
        return throttles

    @extend_schema(
        tags=['request-master'],
        summary='Master de RQ: una fila por ítem',
        parameters=[MasterQuerySerializer],
        responses={200: MasterRowSerializer(many=True)},
    )
    def list(self, request):
        params = _params(request)
        paginator = MasterPagination()
        rows, page = master.page_rows(request.user, params, paginator, request, self)
        serializer = MasterRowSerializer(rows, many=True)
        return _no_store(paginator.get_paginated_response(serializer.data))

    @extend_schema(
        tags=['request-master'],
        summary='Master de RQ: resumen por RQ y KPIs',
        parameters=[SummaryQuerySerializer],
        responses={200: MasterSummaryRowSerializer(many=True)},
    )
    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        params = _params(request, SummaryQuerySerializer)
        rows, kpis = master.summary_rows(request.user, params)
        paginator = MasterSummaryPagination()
        paginator.kpis = kpis
        page = paginator.paginate_queryset(rows, request, view=self)
        serializer = MasterSummaryRowSerializer(page, many=True)
        return _no_store(paginator.get_paginated_response(serializer.data))

    @extend_schema(
        tags=['request-master'],
        summary='Master de RQ: descarga en Excel (.xlsx)',
        parameters=[MasterQuerySerializer],
        responses={(200, XLSX_CONTENT_TYPE): bytes},
    )
    @action(detail=False, methods=['get'], url_path='export')
    def export(self, request):
        params = _params(request)
        try:
            result = build_master_workbook(request.user, params)
        except Exception:
            logger.exception('rq.master.export.failed', extra={'user_id': request.user.pk})
            return _no_store(Response(
                {'error': True, 'status_code': 500, 'detail': SERVER_ERROR_MESSAGE, 'code': 'INTERNAL_ERROR'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            ))
        logger.info(
            'rq.master.export',
            extra={
                'user_id': request.user.pk, 'item_rows': result.item_rows,
                'delivery_rows': result.delivery_rows, 'rq_rows': result.rq_rows,
                'truncated': result.truncated, 'filters': sorted(request.query_params.keys()),
            },
        )
        response = HttpResponse(result.content, content_type=XLSX_CONTENT_TYPE)
        response['Content-Disposition'] = f'attachment; filename="{result.filename}"'
        response['X-Export-Truncated'] = 'true' if result.truncated else 'false'
        response['Access-Control-Expose-Headers'] = 'Content-Disposition, X-Export-Truncated'
        return _no_store(response)
