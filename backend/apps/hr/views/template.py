from django.http import Http404
from django_filters import rest_framework as filters
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.permissions import IsHRDocumentsManager, IsHRDocumentsReader
from apps.hr.models import DocumentTemplate
from apps.hr.serializers.template import (
    DocumentTemplateSerializer,
    DocumentTemplateUpdateSerializer,
    DocumentTemplateUploadSerializer,
)
from apps.hr.services import template_service
from apps.hr.views.common import HRDownloadThrottle, file_response

DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


class DocumentTemplateFilter(filters.FilterSet):
    class Meta:
        model = DocumentTemplate
        fields = ['document_type', 'slug', 'is_active']


@extend_schema(tags=['hr'])
@extend_schema_view(
    list=extend_schema(summary='Listar plantillas de documento'),
    retrieve=extend_schema(summary='Detalle de plantilla'),
    create=extend_schema(
        summary='Subir una nueva versión de plantilla (.docx)',
        request={'multipart/form-data': DocumentTemplateUploadSerializer},
        responses={201: DocumentTemplateSerializer},
    ),
    partial_update=extend_schema(
        summary='Editar nombre/notas (el archivo es inmutable)',
        request=DocumentTemplateUpdateSerializer, responses=DocumentTemplateSerializer,
    ),
    destroy=extend_schema(summary='Eliminar plantilla sin uso'),
)
class DocumentTemplateViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    queryset = DocumentTemplate.objects.select_related('uploaded_by')
    serializer_class = DocumentTemplateSerializer
    filterset_class = DocumentTemplateFilter
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsHRDocumentsReader()]
        return [IsHRDocumentsManager()]

    def create(self, request, *args, **kwargs):
        ser = DocumentTemplateUploadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        template = template_service.create_template(
            user=request.user, document_type=v['document_type'], name=v['name'],
            slug=v.get('slug'), notes=v.get('notes', ''), uploaded_file=v['file'],
        )
        return Response(DocumentTemplateSerializer(template).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        template = self.get_object()
        ser = DocumentTemplateUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        for key, value in ser.validated_data.items():
            setattr(template, key, value)
        template.save(update_fields=[*ser.validated_data.keys(), 'updated_at'])
        return Response(DocumentTemplateSerializer(template).data)

    def destroy(self, request, *args, **kwargs):
        template = self.get_object()
        template_service.delete_template(template.pk, user=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(summary='Activar la plantilla (desactiva la anterior de la serie)',
                   request=None, responses=DocumentTemplateSerializer)
    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        template = self.get_object()
        template = template_service.activate_template(template.pk, user=request.user)
        return Response(DocumentTemplateSerializer(template).data)

    @extend_schema(summary='Desactivar la plantilla', request=None, responses=DocumentTemplateSerializer)
    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        template = self.get_object()
        template = template_service.deactivate_template(template.pk, user=request.user)
        return Response(DocumentTemplateSerializer(template).data)

    @extend_schema(summary='Descargar el .docx de la plantilla', responses={200: bytes})
    @action(detail=True, methods=['get'], throttle_classes=[HRDownloadThrottle])
    def download(self, request, pk=None):
        template = self.get_object()
        try:
            return file_response(
                template.file, f'Plantilla_{template.slug}_v{template.version}.docx', DOCX_CONTENT_TYPE
            )
        except (FileNotFoundError, OSError):
            raise Http404
