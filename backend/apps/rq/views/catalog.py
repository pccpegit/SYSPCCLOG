"""
Warehouse catalog search for the RQ capture screens (SYSPCC-026).

Lives in the rq app, not under /warehouse/, because the warehouse module is
protected by warehouse roles and a requester has none of them. It is read-only,
open to every authenticated user, capped at 20 rows per page and narrow on
purpose: id, code, description, unit, category and CENTRAL-pool availability.
No costs, no exact location, no supplier data.
"""

import logging

from rest_framework import mixins, viewsets
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from drf_spectacular.utils import OpenApiParameter, extend_schema

from apps.core.throttling import UserThrottle
from apps.rq.serializers.catalog import RequestCatalogItemSerializer
from apps.rq.services.request_catalog import (
    CATALOG_MIN_SEARCH_LENGTH,
    CATALOG_PAGE_SIZE,
    search_catalog,
)
from apps.rq.throttling import RequestCatalogThrottle

logger = logging.getLogger(__name__)


class RequestCatalogPagination(PageNumberPagination):
    """Fixed page size: the client cannot ask for more than 20 rows at a time."""

    page_size = CATALOG_PAGE_SIZE
    page_size_query_param = None
    max_page_size = CATALOG_PAGE_SIZE


class RequestCatalogViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Type-ahead search over the warehouse catalog, for picking the lines of an RQ."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [UserThrottle, RequestCatalogThrottle]
    pagination_class = RequestCatalogPagination
    serializer_class = RequestCatalogItemSerializer
    # The matching, the relevance order and the length limits live in
    # `search_catalog` (a bare SearchFilter would dump the whole catalog on an
    # empty term and cannot rank), so the generic filter backends are off.
    filter_backends = []

    def get_queryset(self):
        return search_catalog(self.request.query_params.get('search', ''))

    @extend_schema(
        tags=['request-catalog'],
        summary='Buscar productos del catálogo de almacén para un RQ',
        parameters=[
            OpenApiParameter(
                name='search',
                type=str,
                description=(
                    f'Texto a buscar en código o descripción (mínimo {CATALOG_MIN_SEARCH_LENGTH} '
                    'caracteres; todas las palabras deben coincidir). Con menos caracteres '
                    'devuelve una lista vacía.'
                ),
            ),
        ],
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)
