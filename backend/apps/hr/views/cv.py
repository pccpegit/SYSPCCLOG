import io
import logging
import os

from django.db.models import F, Q
from django.http import FileResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.http import content_disposition_header
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.permissions import IsHRDocumentsManager, IsHRDocumentsReader
from apps.hr.enums import CVItemStatus
from apps.hr.exceptions import HRDomainError, invalid_state
from apps.hr.models import CVAnalysis, CVAnalysisItem
from apps.hr.serializers.cv import (
    CVAnalysisCreateSerializer,
    CVAnalysisDetailSerializer,
    CVAnalysisSerializer,
    CVAnalysisUpdateSerializer,
    CVItemDetailSerializer,
    CVItemSerializer,
    PostingExtractSerializer,
)
from apps.hr.services import cv_analysis_service as svc
from apps.hr.services import cv_export, cv_posting_service, cv_service
from apps.hr.views.common import (
    HRCVPostingThrottle,
    HRCVProgressThrottle,
    HRCVUploadThrottle,
    HRDownloadThrottle,
    JSONOnlyNegotiation,
    file_response,
)

logger = logging.getLogger(__name__)

MIME_BY_EXT = {'.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png',
               '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


class CVPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 500


def _download_log(kind: str, analysis_id, user, count: int):
    logger.info('hr.cv_download kind=%s analysis_id=%s user_id=%s count=%d', kind, analysis_id, user.pk, count)


def _no_cache(response):
    response['Cache-Control'] = 'no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


ITEM_ORDERING = {
    'score': 'score', 'candidate_name': 'candidate_name', 'experience_years': 'experience_years',
    'created_at': 'created_at', 'position': 'position', 'status': 'status', 'original_name': 'original_name',
}


def order_items(qs, raw: str):
    exprs = []
    for token in (raw or '').split(','):
        token = token.strip()
        desc = token.startswith('-')
        field = ITEM_ORDERING.get(token.lstrip('-'))
        if not field:
            continue
        if field in ('score', 'experience_years'):
            exprs.append(F(field).desc(nulls_last=True) if desc else F(field).asc(nulls_last=True))
        else:
            exprs.append(('-' if desc else '') + field)
    if not exprs:
        exprs = [F('score').desc(nulls_last=True), F('experience_years').desc(nulls_last=True), 'candidate_name']
    return qs.order_by(*exprs, 'position', 'id')


@extend_schema(tags=['hr'])
@extend_schema_view(
    list=extend_schema(summary='Listar análisis de CVs'),
    retrieve=extend_schema(summary='Detalle de un análisis de CVs'),
    create=extend_schema(summary='Crear un análisis de CVs', request=CVAnalysisCreateSerializer,
                         responses={201: CVAnalysisDetailSerializer}),
    partial_update=extend_schema(summary='Editar nombre o requisitos', request=CVAnalysisUpdateSerializer),
    destroy=extend_schema(summary='Eliminar el análisis con todos sus archivos y reportes'),
)
class CVAnalysisViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    pagination_class = CVPagination
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    content_negotiation_class = JSONOnlyNegotiation
    READ_ACTIONS = ('list', 'retrieve', 'config', 'progress', 'download_zip', 'download_xlsx', 'posting_file')

    def get_permissions(self):
        if self.action in self.READ_ACTIONS:
            return [IsHRDocumentsReader()]
        return [IsHRDocumentsManager()]

    def get_throttles(self):
        if self.action == 'posting_file':
            return [HRDownloadThrottle()]
        if self.action == 'posting_extract' or (self.action == 'posting' and self.request.method == 'POST'):
            return [HRCVPostingThrottle()]
        return super().get_throttles()

    def get_serializer_class(self):
        return CVAnalysisDetailSerializer if self.action != 'list' else CVAnalysisSerializer

    def get_queryset(self):
        qs = svc.annotate_counts(CVAnalysis.objects.select_related('created_by'))
        if self.action == 'list':
            params = self.request.query_params
            if params.get('search'):
                qs = qs.filter(name__icontains=params['search'].strip())
            flt = svc.status_filter(params.get('status', ''))
            if flt is not None:
                qs = qs.filter(flt)
            ordering = params.get('ordering', '-created_at')
            qs = qs.order_by(ordering if ordering.lstrip('-') in ('created_at', 'name') else '-created_at', '-id')
        return qs

    def _detail(self, pk):
        return CVAnalysisDetailSerializer(self.get_queryset().get(pk=pk)).data

    def create(self, request, *args, **kwargs):
        ser = CVAnalysisCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        analysis = svc.create_analysis(user=request.user, **ser.validated_data)
        return Response(self._detail(analysis.pk), status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        analysis = self.get_object()
        ser = CVAnalysisUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        svc.update_analysis(analysis, **ser.validated_data)
        data = self._detail(analysis.pk)
        # Non-blocking notices about what the user typed (protected data, AI-like lines).
        data['warnings'] = cv_posting_service.requirements_warnings(analysis.requirements)
        return Response(data)

    def destroy(self, request, *args, **kwargs):
        svc.delete_analysis(self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(summary='Configuración y límites del análisis de CVs')
    @action(detail=False, methods=['get'])
    def config(self, request):
        return Response(svc.public_config(request.user))

    @extend_schema(summary='Progreso liviano (polling incremental con ?since=)')
    @action(detail=True, methods=['get'], throttle_classes=[HRCVProgressThrottle])
    def progress(self, request, pk=None):
        analysis = self.get_object()
        since = None
        raw = request.query_params.get('since')
        if raw:
            since = parse_datetime(raw.replace(' ', '+'))
            if since is None:
                raise HRDomainError('invalid_since', 'El parámetro since no es una fecha válida (ISO 8601).')
            if timezone.is_naive(since):
                since = timezone.make_aware(since)
        data = svc.progress(analysis, since)
        data['cost_usd'] = float(data['cost_usd'])
        data['server_time'] = data['server_time'].isoformat()
        for row in data['items']:
            row.pop('updated_at', None)
        return Response(data)

    @extend_schema(summary='Reintentar todos los CVs con error', request=None)
    @action(detail=True, methods=['post'], url_path='retry-failed')
    def retry_failed(self, request, pk=None):
        n = svc.retry_failed(self.get_object())
        return Response({'requeued': n}, status=status.HTTP_202_ACCEPTED)

    @extend_schema(summary='Reanudar CVs atascados', request=None)
    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        n = svc.resume(self.get_object())
        return Response({'redispatched': n}, status=status.HTTP_202_ACCEPTED)

    @extend_schema(summary='Cancelar los CVs pendientes en cola', request=None)
    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        return Response({'cancelled': svc.cancel_pending(self.get_object())})

    # ------------------------------------------------ job posting (iteration 2)

    @extend_schema(summary='Subir, reemplazar (POST) o quitar (DELETE) la convocatoria',
                   responses={200: CVAnalysisDetailSerializer})
    @action(detail=True, methods=['post', 'delete'], url_path='posting')
    def posting(self, request, pk=None):
        analysis = self.get_object()
        if request.method == 'DELETE':
            cv_posting_service.remove_posting(analysis)
            return Response(status=status.HTTP_204_NO_CONTENT)
        cv_posting_service.attach_posting(analysis, request.FILES.get('file'))
        return Response(self._detail(analysis.pk))

    @extend_schema(summary='Descargar la convocatoria original', responses={200: bytes})
    @action(detail=True, methods=['get'], url_path='posting/file')
    def posting_file(self, request, pk=None):
        analysis = self.get_object()
        if not analysis.has_posting:
            raise HRDomainError('no_posting', 'Este análisis no tiene convocatoria.', status.HTTP_404_NOT_FOUND)
        ext = os.path.splitext(analysis.posting_file.name or '')[1].lower()
        try:
            response = file_response(analysis.posting_file, f'Convocatoria_{analysis.pk}{ext}',
                                     MIME_BY_EXT.get(ext, 'application/octet-stream'))
        except (FileNotFoundError, OSError, ValueError):
            raise HRDomainError('file_missing', 'No se encontró la convocatoria en el servidor.',
                                status.HTTP_404_NOT_FOUND)
        _download_log('posting', analysis.pk, request.user, 1)
        return response

    @extend_schema(summary='Proponer requisitos desde la convocatoria (no los guarda)',
                   request=PostingExtractSerializer)
    @action(detail=True, methods=['post'], url_path='posting/extract')
    def posting_extract(self, request, pk=None):
        analysis = self.get_object()
        ser = PostingExtractSerializer(data=request.data if isinstance(request.data, dict) else {})
        ser.is_valid(raise_exception=True)
        return Response(cv_posting_service.extract(analysis, text=ser.validated_data.get('text'), user=request.user))

    def _done_ids(self, analysis):
        ids = list(analysis.items.filter(status=CVItemStatus.DONE).order_by(
            F('score').desc(nulls_last=True), F('experience_years').desc(nulls_last=True),
            'candidate_name', 'position').values_list('pk', flat=True))
        if not ids:
            raise HRDomainError('nothing_to_download', 'Aún no hay CVs analizados para descargar.',
                                status.HTTP_409_CONFLICT)
        return ids

    @extend_schema(summary='ZIP con los reportes PDF (streaming)', responses={200: bytes})
    @action(detail=True, methods=['get'], url_path='download-zip', throttle_classes=[HRDownloadThrottle])
    def download_zip(self, request, pk=None):
        analysis = self.get_object()
        ids = self._done_ids(analysis)
        _download_log('zip', analysis.pk, request.user, len(ids))
        response = StreamingHttpResponse(cv_export.stream_zip(analysis, ids), content_type='application/zip')
        response['Content-Disposition'] = content_disposition_header(True, cv_export.zip_filename(analysis))
        return _no_cache(response)

    @extend_schema(summary='Excel consolidado de candidatos', responses={200: bytes})
    @action(detail=True, methods=['get'], url_path='download-xlsx', throttle_classes=[HRDownloadThrottle])
    def download_xlsx(self, request, pk=None):
        analysis = self.get_object()
        ids = self._done_ids(analysis)
        _download_log('xlsx', analysis.pk, request.user, len(ids))
        data = cv_export.build_xlsx(analysis)
        response = FileResponse(io.BytesIO(data), as_attachment=True, filename=cv_export.xlsx_filename(analysis),
                                content_type=XLSX_MIME)
        return _no_cache(response)


@extend_schema(tags=['hr'])
class CVItemViewSet(viewsets.GenericViewSet):
    """CVs of an analysis. Routed explicitly in urls.py under
    cv-analyses/<analysis_pk>/items/. Items of ANOTHER analysis are 404 (IDOR)."""

    pagination_class = CVPagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    content_negotiation_class = JSONOnlyNegotiation
    READ_ACTIONS = ('list', 'retrieve', 'report', 'file')

    def get_permissions(self):
        if self.action in self.READ_ACTIONS:
            return [IsHRDocumentsReader()]
        return [IsHRDocumentsManager()]

    def get_throttles(self):
        if self.action == 'create':
            return [HRCVUploadThrottle()]
        if self.action in ('report', 'file'):
            return [HRDownloadThrottle()]
        return super().get_throttles()

    def get_serializer_class(self):
        return CVItemDetailSerializer if self.action == 'retrieve' else CVItemSerializer

    @property
    def analysis(self) -> CVAnalysis:
        if not hasattr(self, '_analysis'):
            self._analysis = get_object_or_404(CVAnalysis, pk=self.kwargs['analysis_pk'])
        return self._analysis

    def get_queryset(self):
        return CVAnalysisItem.objects.filter(analysis=self.analysis)

    def _get_item(self) -> CVAnalysisItem:
        return get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset().defer('result')
        params = request.query_params
        if params.get('status') in CVItemStatus.values:
            qs = qs.filter(status=params['status'])
        if params.get('recommendation'):
            qs = qs.filter(recommendation=params['recommendation'])
        if params.get('search'):
            term = params['search'].strip()
            qs = qs.filter(Q(candidate_name__icontains=term) | Q(headline__icontains=term)
                           | Q(original_name__icontains=term))
        qs = order_items(qs, params.get('ordering', ''))
        page = self.paginate_queryset(qs)
        ser = CVItemSerializer(page, many=True, context={'ranks': svc.rank_map(self.analysis)})
        return self.get_paginated_response(ser.data)

    def retrieve(self, request, *args, **kwargs):
        item = self._get_item()
        return Response(CVItemDetailSerializer(item, context={'ranks': svc.rank_map(self.analysis)}).data)

    def create(self, request, *args, **kwargs):
        files = request.FILES.getlist('files')
        result = svc.upload_files(analysis=self.analysis, user=request.user, files=files)
        return Response(result)

    def destroy(self, request, *args, **kwargs):
        svc.delete_item(self._get_item())
        return Response(status=status.HTTP_204_NO_CONTENT)

    def retry(self, request, *args, **kwargs):
        svc.retry_item(self._get_item())
        return Response(status=status.HTTP_202_ACCEPTED)

    def report(self, request, *args, **kwargs):
        item = self._get_item()
        if item.status != CVItemStatus.DONE or not item.result:
            raise invalid_state('El reporte solo está disponible cuando el CV ya fue analizado.')
        if not item.report_pdf:
            cv_service.store_report(item.pk)
            item.refresh_from_db()
        data = cv_export.report_bytes(item)
        _download_log('pdf', self.analysis.pk, request.user, 1)
        response = FileResponse(io.BytesIO(data), as_attachment=True, filename=cv_export.report_filename(item),
                                content_type='application/pdf')
        return _no_cache(response)

    def file(self, request, *args, **kwargs):
        item = self._get_item()
        ext = os.path.splitext(item.file.name or '')[1].lower()
        try:
            response = file_response(item.file, f'CV_{item.pk}{ext}', MIME_BY_EXT.get(ext, 'application/octet-stream'))
        except (FileNotFoundError, OSError, ValueError):
            raise HRDomainError('file_missing', 'No se encontró el archivo original en el servidor.',
                                status.HTTP_404_NOT_FOUND)
        _download_log('original', self.analysis.pk, request.user, 1)
        return response
