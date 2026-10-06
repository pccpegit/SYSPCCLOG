from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsHRDocumentsManager, IsHRDocumentsReader
from apps.hr.serializers.assistant import (
    AssistantExtractRequestSerializer,
    AssistantExtractResponseSerializer,
)
from apps.hr.services.assistant_service import HRAssistantService
from apps.hr.views.common import HRAssistantThrottle


@extend_schema(
    tags=['hr'], summary='¿Está disponible el asistente?',
    responses=inline_serializer('AssistantStatus', {'enabled': serializers.BooleanField()}),
)
class AssistantStatusView(APIView):
    permission_classes = [IsHRDocumentsReader]

    def get(self, request):
        return Response({'enabled': HRAssistantService.is_enabled()})


@extend_schema(
    tags=['hr'], summary='Interpretar una descripción en lenguaje natural (solo extrae datos)',
    request=AssistantExtractRequestSerializer, responses=AssistantExtractResponseSerializer,
)
class AssistantExtractView(APIView):
    permission_classes = [IsHRDocumentsManager]
    throttle_classes = [HRAssistantThrottle]

    def post(self, request):
        ser = AssistantExtractRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        result = HRAssistantService().extract(
            user=request.user, document_type=v['document_type'], text=v['text'],
            personal_id=v.get('personal_id'), known_data=v.get('known_data'),
        )
        return Response(AssistantExtractResponseSerializer(result).data)
