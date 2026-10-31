"""
REST endpoints of the two-step inventory import (SYSPCC-025).

    GET    imports/template/        blank workbook with the four sheets
    POST   imports/                 step 1: upload + preview            (CanImportInventory)
    GET    imports/                 history
    GET    imports/{id}/            state, summary, projects, destinations, result
    GET    imports/{id}/problems/   paginated problems (severity, sheet, code filters)
    GET    imports/{id}/problems/export/   problems report (.xlsx, no names)
    POST   imports/{id}/confirm/    step 2: atomic, idempotent confirmation (CanImportInventory)
    DELETE imports/{id}/            cancel a PREVIEWED import           (CanImportInventory)

The workbook is hostile input and holds personal data: every response is
``Cache-Control: no-store`` and nothing here logs names, rows or file names.
"""
import logging
import uuid

from django.http import Http404, HttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.warehouse.models import InventoryImport
from apps.warehouse.permissions import CanImportInventory, IsWarehouseRole
from apps.warehouse.query_guard import RejectNulQueryParamsMixin
from apps.warehouse.serializers_imports import (
    ImportConfirmSerializer,
    ImportUploadSerializer,
    InventoryImportListSerializer,
    InventoryImportSerializer,
)
from apps.warehouse.services.imports import reporting, service
from apps.warehouse.services.imports.errors import ImportRejected
from apps.warehouse.services.imports.parser import XLSX_CONTENT_TYPE, normalize_label
from apps.warehouse.services.imports.problems import SEVERITIES
from apps.warehouse.throttling import WarehouseImportThrottle
from apps.warehouse.views import WarehousePagination

logger = logging.getLogger(__name__)

WRITE_ACTIONS = ('create', 'destroy', 'confirm')


def _rejection(exc: ImportRejected) -> Response:
    """Error envelope of the project (``error``/``status_code``/``detail``) + code and extras."""
    body = {'error': True, 'status_code': exc.http_status, 'detail': exc.message, 'code': exc.code, **exc.extra}
    return Response(body, status=exc.http_status)


def _parse_uuid(value) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise Http404 from None


class InventoryImportViewSet(RejectNulQueryParamsMixin, viewsets.GenericViewSet):
    pagination_class = WarehousePagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    lookup_value_regex = '[0-9a-fA-F-]{36}'
    serializer_class = InventoryImportSerializer

    # -- plumbing ------------------------------------------------------------

    def get_permissions(self):
        if self.action in WRITE_ACTIONS:
            return [IsAuthenticated(), CanImportInventory()]
        return [IsAuthenticated(), IsWarehouseRole()]

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.action == 'create':
            throttles.append(WarehouseImportThrottle())
        return throttles

    def get_queryset(self):
        qs = InventoryImport.objects.select_related('uploaded_by').defer('file_bytes')
        if self.action in ('list', 'retrieve'):
            qs = qs.defer('problems')
        return qs

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'no-store'
        return response

    # -- step 1: upload + preview -----------------------------------------------

    @extend_schema(
        tags=['warehouse'], summary='Subir un libro y previsualizar la importación (paso 1)',
        request={'multipart/form-data': ImportUploadSerializer}, responses={201: InventoryImportSerializer},
    )
    def create(self, request):
        serializer = ImportUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            imp = service.create_preview(
                uploaded_file=data['file'], user=request.user,
                warehouse=data.get('warehouse', 'CENTRAL'),
                update_existing=data.get('update_existing', False),
            )
        except ImportRejected as exc:
            return _rejection(exc)
        return Response(
            InventoryImportSerializer(imp, context={'show_destinations': True}).data,
            status=status.HTTP_201_CREATED,
        )

    # -- reads ------------------------------------------------------------------

    @extend_schema(tags=['warehouse'], summary='Historial de importaciones', responses={200: InventoryImportListSerializer(many=True)})
    def list(self, request):
        service.purge_opportunistically()
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response(InventoryImportListSerializer(page, many=True).data)

    @extend_schema(tags=['warehouse'], summary='Detalle de una importación', responses={200: InventoryImportSerializer})
    def retrieve(self, request, pk=None):
        service.purge_opportunistically()
        imp = self.get_object()
        # Worker names (unmatched destinations) only for the roles allowed to import/link.
        show_destinations = CanImportInventory().has_permission(request, self)
        return Response(
            InventoryImportSerializer(imp, context={'show_destinations': show_destinations}).data
        )

    @extend_schema(tags=['warehouse'], summary='Cancelar una importación previsualizada', responses={200: dict})
    def destroy(self, request, pk=None):
        try:
            imp = service.cancel_import(_parse_uuid(pk))
        except InventoryImport.DoesNotExist:
            raise Http404 from None
        except ImportRejected as exc:
            return _rejection(exc)
        return Response({'id': str(imp.pk), 'status': imp.status})

    # -- problems ---------------------------------------------------------------

    @staticmethod
    def _filtered_problems(imp, params) -> list:
        items = (imp.problems or {}).get('items', [])
        severities = {s for s in (params.get('severity') or '').lower().split(',') if s in SEVERITIES}
        sheet = normalize_label(params.get('sheet') or '')
        codes = {c for c in (params.get('code') or '').upper().split(',') if c}
        if severities:
            items = [p for p in items if p['severity'] in severities]
        if sheet:
            items = [p for p in items if normalize_label(p['sheet']) == sheet]
        if codes:
            items = [p for p in items if p['code'] in codes]
        return items

    @extend_schema(
        tags=['warehouse'], summary='Problemas de una importación (paginados)',
        parameters=[OpenApiParameter(n, str, required=False) for n in ('severity', 'sheet', 'code', 'page', 'page_size')],
        responses={200: dict},
    )
    @action(detail=True, methods=['get'], url_path='problems')
    def problems(self, request, pk=None):
        imp = self.get_object()
        items = self._filtered_problems(imp, request.query_params)
        page = self.paginate_queryset(items)
        response = self.get_paginated_response(page)
        stored = imp.problems or {}
        response.data['meta'] = {
            'total': stored.get('total', len(stored.get('items', []))),
            'truncated': bool(stored.get('truncated')),
            'counts': (imp.summary or {}).get('counts', {}),
            'by_code': (imp.summary or {}).get('by_code', {}),
        }
        return response

    @extend_schema(tags=['warehouse'], summary='Reporte de problemas en Excel (sin nombres)', responses={200: bytes})
    @action(detail=True, methods=['get'], url_path='problems/export')
    def problems_export(self, request, pk=None):
        imp = self.get_object()
        items = self._filtered_problems(imp, request.query_params)
        wb = reporting.build_problems_workbook(items)
        filename = f'PROBLEMAS_IMPORTACION_{timezone.localdate().isoformat()}.xlsx'
        response = HttpResponse(content_type=XLSX_CONTENT_TYPE)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        wb.save(response)
        logger.info(
            'warehouse.export',
            extra={'user_id': request.user.id, 'export': 'import_problems', 'rows': len(items)},
        )
        return response

    @extend_schema(tags=['warehouse'], summary='Plantilla de libro vacía', responses={200: bytes})
    @action(detail=False, methods=['get'], url_path='template')
    def template(self, request):
        response = HttpResponse(content_type=XLSX_CONTENT_TYPE)
        response['Content-Disposition'] = 'attachment; filename="PLANTILLA_INVENTARIO_ALMACEN.xlsx"'
        reporting.build_template_workbook().save(response)
        return response

    # -- step 2: confirm ----------------------------------------------------------

    @extend_schema(
        tags=['warehouse'], summary='Confirmar la importación (paso 2, atómico e idempotente)',
        request=ImportConfirmSerializer, responses={200: InventoryImportSerializer},
    )
    @action(detail=True, methods=['post'], url_path='confirm')
    def confirm(self, request, pk=None):
        serializer = ImportConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        import_id = _parse_uuid(pk)
        try:
            imp, replay = service.confirm_import(
                import_id, request.user,
                expected_plan_digest=data['expected_plan_digest'],
                project_map=data.get('project_map', {}),
                destination_map=data.get('destination_map', {}),
                accept_warnings=data.get('accept_warnings', False),
                accept_skipped_rows=data.get('accept_skipped_rows', False),
            )
        except InventoryImport.DoesNotExist:
            raise Http404 from None
        except ImportRejected as exc:
            return _rejection(exc)
        except Exception as exc:
            logger.error(
                'warehouse.import.fail',
                extra={'import_id': str(import_id), 'user_id': request.user.id, 'error_type': type(exc).__name__},
            )
            raise
        response = Response(InventoryImportSerializer(imp, context={'show_destinations': True}).data)
        if replay:
            response['Idempotent-Replay'] = 'true'
        return response
