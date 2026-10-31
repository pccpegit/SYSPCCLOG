---
name: drf-api-design
description: Convenciones obligatorias para diseñar endpoints REST con Django REST Framework en SYSPCC. Úsalo al crear o modificar ViewSets, serializers, routers, paginación, filtros o respuestas de la API. Garantiza consistencia en /api/v1/, respuestas de error uniformes, paginación, filtrado, permisos y documentación Swagger. Dispara ante "endpoint", "API", "ViewSet", "serializer", "router", "paginación", "filtro".
---

# Diseño de API REST — SYSPCC

Todos los endpoints viven bajo `/api/v1/` (`config/urls.py`) con namespaces: `auth` (`/api/v1/auth/`), `users`, `projects`, `departments`, `personal`, `rq`, `warehouse` (`/api/v1/warehouse/`), `administracion` (`/api/v1/administracion/`), `hr` (`/api/v1/hr/`), `support` (`/api/v1/support/`). Los routers de `core` y `rq` se montan en la raíz: `/api/v1/users/`, `/api/v1/projects/`, `/api/v1/requests/`, `/api/v1/suppliers/`, etc. (no existe el prefijo `/api/v1/rq/`).

## Reglas

1. **ViewSets + routers**, no APIViews sueltas salvo casos justificados (auth). Registra en el router del app.
2. **Serializers por acción**: separa `XCreateSerializer`, `XUpdateSerializer`, `XListSerializer`, `XDetailSerializer` cuando difieran los campos. Usa `get_serializer_class()` según `self.action`.
3. **Lógica de negocio NO va en la view ni en el serializer** → va en `apps/<app>/services/` (o `services.py` en `administracion` y `support`). La view orquesta: valida (serializer) → llama al service → serializa la respuesta.
4. **Queryset siempre acotado por rol/tenant**. Nunca devuelvas todo. Sobrescribe `get_queryset()` filtrando por lo que el usuario puede ver (para RQ: `get_accessible_requests_queryset` de `apps/rq/permissions.py`; ver también el patrón `FIX-07` en `ClaimViewSet`).
5. **Permisos explícitos** en cada ViewSet vía `permission_classes` + `role_required` (usa `HasRole` de `apps/core/permissions.py`). Nunca dejes un endpoint sin `IsAuthenticated` como mínimo.
6. **Respuestas de error consistentes**: se generan por `custom_exception_handler` (`apps/core/exceptions.py`), formato `{ "error": true, "status_code": n, "detail": ..., "code": ... }` (`code` solo cuando la excepción trae `detail`). No inventes otro formato; lanza excepciones DRF (`ValidationError`, `PermissionDenied`) o de dominio.
7. **Paginación** siempre en list endpoints (`PageNumberPagination`, `PAGE_SIZE = 20` en `REST_FRAMEWORK`). No devuelvas listas sin paginar.
8. **Filtros y búsqueda** con `DjangoFilterBackend` + `SearchFilter`; declara `filterset_fields`, `search_fields`, `ordering_fields`. No filtres a mano con `request.query_params`.
9. **Optimiza queries**: `select_related`/`prefetch_related` en `get_queryset()` para evitar N+1.
10. **Documenta** con `@extend_schema` / `@extend_schema_view` (drf-spectacular): `tags`, `summary`. Aparece en `/api/docs/`.
11. **Verbos HTTP correctos**: acciones extra con `@action(detail=..., methods=[...], url_path=...)`, no metas verbos sueltos en la URL. Ejemplos reales: `POST /api/v1/requests/{id}/action/` (transición de workflow, con `action` y `acting_role` en el body), `GET /api/v1/requests/{id}/stock-availability/`, `POST /api/v1/warehouse/movements/epp-delivery/`.
12. Aplica también el skill `backend-produccion` (errores, logging, transacciones) y `roles-y-permisos`.

## Plantilla de ViewSet

```python
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.core.exceptions import WorkflowError, PermissionDeniedForAction
from apps.rq.filters import RequestFilter
from apps.rq.permissions import get_accessible_requests_queryset
from apps.rq.services.workflow_engine import WorkflowEngine


@extend_schema_view(
    list=extend_schema(tags=['requests'], summary='Listar RQs visibles para el usuario'),
    retrieve=extend_schema(tags=['requests'], summary='Detalle de un RQ'),
)
class RequestViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = RequestFilter                      # apps/rq/filters.py
    search_fields = ['rq_number', 'description', 'service', 'front_area']
    ordering_fields = ['created_at', 'priority', 'status', 'fecha_necesidad']
    ordering = ['-created_at']

    def get_queryset(self):
        # acota por lo que el usuario puede ver (única fuente de verdad de visibilidad de RQ)
        return get_accessible_requests_queryset(self.request.user).select_related(
            'project', 'department', 'requested_by',
        ).prefetch_related('items__inventory_item')

    def get_serializer_class(self):
        if self.action == 'create':
            return RequestCreateSerializer
        if self.action == 'list':
            return RequestListSerializer
        return RequestDetailSerializer

    @action(detail=True, methods=['post'], url_path='action')
    def execute_action(self, request, pk=None):
        rq = self.get_object()                                   # 404 si no es visible para el usuario
        serializer = WorkflowActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        engine = WorkflowEngine(request=rq, user=request.user, acting_role=data['acting_role'])
        try:
            approval = engine.execute(                           # service: la view no decide estados
                action=data['action'],
                comments=data.get('comments', ''),
                extra_data=data.get('extra_data', {}),
            )
        except WorkflowError as e:
            return Response({'detail': str(e.message)}, status=status.HTTP_400_BAD_REQUEST)
        except PermissionDeniedForAction as e:
            return Response({'detail': str(e.message)}, status=status.HTTP_403_FORBIDDEN)
        return Response(ApprovalSerializer(approval).data, status=status.HTTP_200_OK)
```

(Resumen de `apps/rq/views/request.py`; el código real además loguea con contexto y tiene una última barrera `logger.exception` + `raise`.)

## Checklist de endpoint nuevo
- [ ] Bajo `/api/v1/<namespace>/`, registrado en el router.
- [ ] `permission_classes` + `get_queryset()` acotado por rol.
- [ ] Serializer por acción; validación de payload en el serializer.
- [ ] Lógica en un service, no en la view.
- [ ] Paginación, filtros, ordering declarados.
- [ ] `select_related`/`prefetch_related`.
- [ ] `@extend_schema` con tag y summary.
- [ ] Errores vía excepciones (los formatea el handler global).
