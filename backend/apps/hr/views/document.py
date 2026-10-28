import logging

from django.http import Http404
from django_filters import rest_framework as filters
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsHRDocumentsManager, IsHRDocumentsReader
from apps.hr.enums import DocumentEventAction
from apps.hr.exceptions import HRDomainError
from apps.hr.models import GeneratedDocument
from apps.hr.serializers.document import (
    DocumentCreateSerializer,
    DocumentEventSerializer,
    DocumentUpdateSerializer,
    DocumentVoidSerializer,
    GeneratedDocumentDetailSerializer,
    GeneratedDocumentListSerializer,
)
from apps.hr.services import document_service
from apps.hr.views.common import HRDownloadThrottle, JSONOnlyNegotiation, file_response

logger = logging.getLogger(__name__)

DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


class GeneratedDocumentFilter(filters.FilterSet):
    created_after = filters.DateFilter(field_name='created_at', lookup_expr='date__gte')
    created_before = filters.DateFilter(field_name='created_at', lookup_expr='date__lte')
    personal = filters.NumberFilter(field_name='personal_id')
    created_by = filters.NumberFilter(field_name='created_by_id')

    class Meta:
        model = GeneratedDocument
        fields = ['document_type', 'status', 'personal', 'created_by', 'created_after', 'created_before']


@extend_schema(tags=['hr'])
@extend_schema_view(
    list=extend_schema(summary='Listar documentos generados'),
    retrieve=extend_schema(summary='Detalle de documento (incluye datos y advertencias)'),
    create=extend_schema(
        summary='Crear un borrador desde una plantilla activa',
        request=DocumentCreateSerializer, responses={201: GeneratedDocumentDetailSerializer},
    ),
    partial_update=extend_schema(
        summary='Editar un borrador (re-renderiza)',
        request=DocumentUpdateSerializer, responses=GeneratedDocumentDetailSerializer,
    ),
    destroy=extend_schema(summary='Eliminar un borrador'),
)
class GeneratedDocumentViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    queryset = GeneratedDocument.objects.select_related('created_by', 'issued_by', 'template')
    filterset_class = GeneratedDocumentFilter
    search_fields = ['subject_name', 'reference_number']
    ordering_fields = ['created_at', 'issued_at', 'subject_name', 'reference_number']
    ordering = ['-created_at']
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    READ_ACTIONS = ('list', 'retrieve', 'download', 'events')

    def get_permissions(self):
        if self.action in self.READ_ACTIONS:
            return [IsHRDocumentsReader()]
        return [IsHRDocumentsManager()]

    def get_serializer_class(self):
        if self.action == 'list':
            return GeneratedDocumentListSerializer
        return GeneratedDocumentDetailSerializer

    def create(self, request, *args, **kwargs):
        ser = DocumentCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        document = document_service.create_draft(
            user=request.user, document_type=v['document_type'], template_id=v['template_id'],
            personal_id=v.get('personal_id'), source=v['source'], data=v['data'],
        )
        return Response(GeneratedDocumentDetailSerializer(document).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        document = self.get_object()
        ser = DocumentUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        document = document_service.update_draft(
            user=request.user, document_id=document.pk,
            data=ser.validated_data.get('data'), template_id=ser.validated_data.get('template_id'),
        )
        return Response(GeneratedDocumentDetailSerializer(document).data)

    def destroy(self, request, *args, **kwargs):
        document = self.get_object()
        document_service.delete_draft(user=request.user, document_id=document.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(summary='Emitir: asigna número y congela el documento', request=None,
                   responses=GeneratedDocumentDetailSerializer)
    @action(detail=True, methods=['post'])
    def issue(self, request, pk=None):
        document = self.get_object()
        document = document_service.issue(user=request.user, document_id=document.pk)
        return Response(GeneratedDocumentDetailSerializer(document).data)

    @extend_schema(summary='Anular un documento emitido', request=DocumentVoidSerializer,
                   responses=GeneratedDocumentDetailSerializer)
    @action(detail=True, methods=['post'])
    def void(self, request, pk=None):
        document = self.get_object()
        ser = DocumentVoidSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        document = document_service.void(
            user=request.user, document_id=document.pk, reason=ser.validated_data['reason']
        )
        return Response(GeneratedDocumentDetailSerializer(document).data)

    @extend_schema(summary='Generar (o reintentar) el PDF', request=None,
                   responses=GeneratedDocumentDetailSerializer)
    @action(detail=True, methods=['post'], url_path='render-pdf')
    def render_pdf(self, request, pk=None):
        document = self.get_object()
        document = document_service.render_pdf(user=request.user, document_id=document.pk)
        return Response(GeneratedDocumentDetailSerializer(document).data)

    @extend_schema(
        summary='Descargar el documento (Word o PDF)',
        parameters=[OpenApiParameter('format', str, enum=['docx', 'pdf'], default='docx')],
        responses={200: bytes},
    )
    @action(detail=True, methods=['get'], throttle_classes=[HRDownloadThrottle],
            content_negotiation_class=JSONOnlyNegotiation)
    def download(self, request, pk=None):
        document = self.get_object()
        fmt = request.query_params.get('format', 'docx').lower()
        if fmt not in ('docx', 'pdf'):
            raise HRDomainError('invalid_format', 'Formato inválido. Usa docx o pdf.')
        if fmt == 'pdf':
            field_file, content_type = document.pdf_file, 'application/pdf'
            if not document.pdf_is_current:
                raise HRDomainError(
                    'pdf_not_available', 'El PDF no está disponible para este documento.',
                    status.HTTP_404_NOT_FOUND,
                )
        else:
            field_file, content_type = document.docx_file, DOCX_CONTENT_TYPE
            if not field_file:
                raise Http404
        try:
            response = file_response(
                field_file, document_service.download_filename(document, fmt), content_type
            )
        except (FileNotFoundError, OSError):
            logger.error('hr.download_file_missing document_id=%s', document.pk)
            raise HRDomainError(
                'file_missing', 'No se encontró el archivo en el servidor.', status.HTTP_404_NOT_FOUND
            )
        document_service.record_event(
            document, DocumentEventAction.DOWNLOADED, request.user,
            format=fmt, template_version=document.template_version,
        )
        return response

    @extend_schema(summary='Bitácora del documento', responses=DocumentEventSerializer(many=True))
    @action(detail=True, methods=['get'])
    def events(self, request, pk=None):
        document = self.get_object()
        return Response(DocumentEventSerializer(document.events.select_related('actor'), many=True).data)
