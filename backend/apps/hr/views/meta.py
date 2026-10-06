from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import Personal
from apps.core.permissions import IsHRDocumentsManager, IsHRDocumentsReader
from apps.hr.documents.registry import get_registry, get_spec
from apps.hr.exceptions import HRDomainError
from apps.hr.serializers.document_type import serialize_spec
from apps.hr.serializers.personal import HRPersonalSearchSerializer


@extend_schema(tags=['hr'], summary='Tipos de documento, campos y variables de plantilla')
class DocumentTypesView(APIView):
    permission_classes = [IsHRDocumentsReader]

    @extend_schema(responses={200: serializers.ListField(child=serializers.DictField())})
    def get(self, request):
        return Response([serialize_spec(s) for s in get_registry().values()])


@extend_schema(
    tags=['hr'], summary='Buscar trabajadores (sin sueldo ni datos bancarios)',
    parameters=[OpenApiParameter('search', str, description='Nombre o DNI, mínimo 2 caracteres')],
)
class PersonalSearchView(generics.ListAPIView):
    permission_classes = [IsHRDocumentsManager]
    serializer_class = HRPersonalSearchSerializer
    filter_backends: list = []

    def get_queryset(self):
        term = (self.request.query_params.get('search') or '').strip()
        if len(term) < 2:
            raise HRDomainError(
                'search_too_short', 'Escribe al menos 2 caracteres para buscar.', status.HTTP_400_BAD_REQUEST
            )
        return Personal.objects.filter(
            Q(apellidos_nombres__icontains=term) | Q(dni__icontains=term)
        ).order_by('apellidos_nombres')


@extend_schema(
    tags=['hr'], summary='Datos del trabajador para precargar el formulario',
    parameters=[OpenApiParameter('document_type', str, default='CONTRACT')],
)
class PersonalPrefillView(APIView):
    permission_classes = [IsHRDocumentsManager]

    @extend_schema(responses={200: serializers.DictField()})
    def get(self, request, pk):
        try:
            personal = Personal.objects.select_related('proyecto').get(pk=pk)
        except Personal.DoesNotExist:
            raise NotFound('Trabajador no encontrado.')
        spec = get_spec(request.query_params.get('document_type', 'CONTRACT'))
        data, sources = spec.prefill(personal)
        missing = [
            {'field': f.key, 'label': f.label, 'question': f.question}
            for f in spec.fields
            if f.required and f.default is None and not f.required_when and f.key not in data
        ]
        return Response({'data': data, 'sources': sources, 'missing': missing})
