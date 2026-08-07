---
name: drf-api-design
description: Convenciones obligatorias para diseñar endpoints REST con Django REST Framework en SYSPCC. Úsalo al crear o modificar ViewSets, serializers, routers, paginación, filtros o respuestas de la API. Garantiza consistencia en /api/v1/, respuestas de error uniformes, paginación, filtrado, permisos y documentación Swagger. Dispara ante "endpoint", "API", "ViewSet", "serializer", "router", "paginación", "filtro".
---

# Diseño de API REST — SYSPCC

Todos los endpoints viven bajo `/api/v1/` con namespaces: `auth`, `users`, `projects`, `departments`, `personal`, `rq`, `warehouse`, `administracion`.

## Reglas

1. **ViewSets + routers**, no APIViews sueltas salvo casos justificados (auth). Registra en el router del app.
2. **Serializers por acción**: separa `XCreateSerializer`, `XUpdateSerializer`, `XListSerializer`, `XDetailSerializer` cuando difieran los campos. Usa `get_serializer_class()` según `self.action`.
3. **Lógica de negocio NO va en la view ni en el serializer** → va en `apps/<app>/services/`. La view orquesta: valida (serializer) → llama al service → serializa la respuesta.
4. **Queryset siempre acotado por rol/tenant**. Nunca devuelvas todo. Sobrescribe `get_queryset()` filtrando por lo que el usuario puede ver (ver el patrón `FIX-07` en `ClaimViewSet`).
5. **Permisos explícitos** en cada ViewSet vía `permission_classes` + `role_required` (usa `HasRole` de `apps/core/permissions.py`). Nunca dejes un endpoint sin `IsAuthenticated` como mínimo.
6. **Respuestas de error consistentes**: se generan por `custom_exception_handler` (`apps/core/exceptions.py`), formato `{ "error": true, "status_code": n, "detail": ... }`. No inventes otro formato; lanza excepciones DRF (`ValidationError`, `PermissionDenied`) o de dominio.
7. **Paginación** siempre en list endpoints (PageNumberPagination del proyecto). No devuelvas listas sin paginar.
8. **Filtros y búsqueda** con `DjangoFilterBackend` + `SearchFilter`; declara `filterset_fields`, `search_fields`, `ordering_fields`. No filtres a mano con `request.query_params`.
9. **Optimiza queries**: `select_related`/`prefetch_related` en `get_queryset()` para evitar N+1.
10. **Documenta** con `@extend_schema` / `@extend_schema_view` (drf-spectacular): `tags`, `summary`. Aparece en `/api/docs/`.
11. **Verbos HTTP correctos**: acciones extra con `@action(detail=..., methods=[...])`, no metas verbos en la URL (`/rq/{id}/submit/` con `@action`, no `/rq/submit-request/`).
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

from apps.core.permissions import HasRole
from apps.core.enums import RoleChoices


@extend_schema_view(
    list=extend_schema(tags=['requests'], summary='Listar RQs visibles para el usuario'),
    retrieve=extend_schema(tags=['requests'], summary='Detalle de un RQ'),
)
class RequestViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['status', 'flow', 'project', 'priority']
    search_fields = ['code', 'title']
    ordering_fields = ['created_at', 'priority']
    ordering = ['-created_at']

    def get_queryset(self):
        qs = Request.objects.select_related('project', 'requester').prefetch_related('items')
        user = self.request.user
        if user.user_roles.filter(role__in=STAFF_ROLES).exists():
            return qs
        return qs.filter(requester=user)                 # acota por lo que puede ver

    def get_serializer_class(self):
        return {
            'list': RequestListSerializer,
            'create': RequestCreateSerializer,
        }.get(self.action, RequestDetailSerializer)

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        rq = self.get_object()
        result = RequestService.submit(rq.id, request.user)   # service, no lógica aquí
        return Response(RequestDetailSerializer(result).data, status=status.HTTP_200_OK)
```

## Checklist de endpoint nuevo
- [ ] Bajo `/api/v1/<namespace>/`, registrado en el router.
- [ ] `permission_classes` + `get_queryset()` acotado por rol.
- [ ] Serializer por acción; validación de payload en el serializer.
- [ ] Lógica en un service, no en la view.
- [ ] Paginación, filtros, ordering declarados.
- [ ] `select_related`/`prefetch_related`.
- [ ] `@extend_schema` con tag y summary.
- [ ] Errores vía excepciones (los formatea el handler global).
