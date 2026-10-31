"""
Minimal worker lookup for the warehouse (SYSPCC-025).

``core.Personal`` holds DNI, salary, bank data... and its API is restricted to
RR. HH. This endpoint exposes ONLY ``id``, ``full_name``, ``position`` and
``project_code`` of ACTIVE workers, so the warehouse can pick the recipient of an
EPP delivery without seeing anything else.
"""
import logging

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.models import Personal
from apps.core.throttling import UserThrottle
from apps.warehouse.permissions import CanLookupPersonal
from apps.warehouse.query_guard import RejectNulQueryParamsMixin
from apps.warehouse.services.personal_matching import normalize_name
from apps.warehouse.throttling import WarehouseLookupThrottle

logger = logging.getLogger(__name__)

MIN_QUERY_LENGTH = 3
MAX_RESULTS = 20


class PersonalLookupViewSet(RejectNulQueryParamsMixin, viewsets.ViewSet):
    """
    GET /warehouse/personal-lookup/?search=<text> (>= 3 letters or digits).

    Restricted to the roles whose screens need it (``CanLookupPersonal``): the lookup returns the
    name, position and project of ACTIVE workers, so it must not be an open directory.
    """

    permission_classes = [IsAuthenticated, CanLookupPersonal]
    throttle_classes = [UserThrottle, WarehouseLookupThrottle]

    @extend_schema(
        tags=['warehouse'], summary='Buscar trabajadores activos (solo id, nombre, puesto, proyecto)',
        parameters=[OpenApiParameter('search', str, required=True)], responses={200: list},
    )
    def list(self, request):
        raw = (request.query_params.get('search') or '').strip()
        # Accent- and order-insensitive match done in Python: the table is small
        # (one row per worker) and the database may not offer `unaccent`.
        wanted = normalize_name(raw).split()
        # Count LETTERS/DIGITS, not characters: '...', '---' or '%%%' reach 3 characters but
        # have no word, and an empty `wanted` matches everybody (all([]) is True).
        if len(raw) < MIN_QUERY_LENGTH or sum(len(word) for word in wanted) < MIN_QUERY_LENGTH:
            return Response(
                {'detail': f'Escriba al menos {MIN_QUERY_LENGTH} letras o números para buscar.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rows = (
            Personal.objects.filter(estado='ACTIVO')
            .select_related('proyecto')
            .only('id', 'apellidos_nombres', 'puesto', 'proyecto__code')
        )
        results = []
        for person in rows:
            haystack = normalize_name(person.apellidos_nombres).split()
            if all(any(token.startswith(w) or w in token for token in haystack) for w in wanted):
                results.append({
                    'id': person.pk,
                    'full_name': person.apellidos_nombres,
                    'position': person.puesto,
                    'project_code': person.proyecto.code if person.proyecto_id else '',
                })
                if len(results) >= MAX_RESULTS:
                    break

        # Count only: never log what was searched or who matched.
        logger.info(
            'warehouse.personal_lookup',
            extra={'user_id': request.user.id, 'results': len(results)},
        )
        response = Response(results)
        response['Cache-Control'] = 'no-store'
        return response
