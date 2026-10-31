"""
Warehouse API views — standalone inventory management module.
Completely independent from the RQ system.

Only users with CENTRAL_WAREHOUSE or SITE_WAREHOUSE roles may access these endpoints.
"""
import logging
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Prefetch, ProtectedError, Q, Sum, DecimalField, Value, F
from django.db.models.functions import Coalesce
from django.http import Http404, HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date

import openpyxl
from drf_spectacular.utils import OpenApiParameter, extend_schema
from kombu.exceptions import OperationalError as BrokerOperationalError
from openpyxl.styles import Font

from rest_framework import serializers as drf_serializers
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.response import Response

from apps.warehouse.models import Inventory, InventoryStock, InventoryMovement, MovementGroup
from apps.warehouse.permissions import (
    PERSON_DESTINATION_TYPES,
    CanAssignLocations,
    CanDeliverEPP,
    CanLinkPersonal,
    IsWarehouseRole,
    can_assign_locations,
    movement_scope_error,
)
from apps.warehouse.serializers import (
    AssignLocationsSerializer,
    EppDeliverySerializer,
    LinkPersonalSerializer,
    document_kwargs,
    InventoryListSerializer,
    InventoryCreateUpdateSerializer,
    MovementListSerializer,
    MovementGroupSerializer,
    EntryCreateSerializer,
    ExitCreateSerializer,
    BatchEntryCreateSerializer,
    BatchExitCreateSerializer,
)
from apps.warehouse.query_guard import RejectNulQueryParamsMixin
from apps.warehouse.serializers_rq import DeliverableRequestSerializer
from apps.warehouse.services import catalog as catalog_svc
from apps.warehouse.services.dates import operational_date_label
from apps.warehouse.services import epp as epp_svc
from apps.warehouse.services import exports as exports_svc
from apps.warehouse.services import kardex as kardex_svc
from apps.warehouse.services import locations as locations_svc
from apps.warehouse.services import movements as warehouse_svc
from apps.warehouse.services.guides import GuideNumberBusyError
from apps.warehouse.services.personal_matching import NO_DESTINATION_LABEL, destination_key
from apps.warehouse.services.onedrive import OneDriveService
from apps.warehouse.services.pdf_generator import generate_movement_pdf, generate_group_pdf
from apps.warehouse.throttling import WarehouseExitThrottle, WarehouseLookupThrottle
from apps.core.enums import WarehouseOriginChoices
from apps.core.utils.excel import sanitize_excel_value, truncate_for_export

logger = logging.getLogger(__name__)

# Movement listings and exports: newest operation first by the OPERATIONAL date (what the screens
# and the Excel files show), undated rows last, then by registration time. Ordering by ``created_at``
# alone scrambled a book imported in one go (every row is registered within the same second) and
# showed the dates out of order. ``-pk`` makes ties stable across pages.
MOVEMENT_LIST_ORDERING = (F('movement_date').desc(nulls_last=True), '-created_at', '-pk')


def _enqueue_group_pdf_upload(group):
    """Queue the PDF generation + OneDrive upload for a movement group.

    The movement is already committed when this runs, and the task is only a
    best-effort side effect (it is idempotent and skipped once
    ``document_url`` is set). If the broker is down (e.g. the ephemeral Redis
    of a trial deployment restarting, SYSPCC-024) the request must NOT fail:
    answering 5xx would make the client retry and register the movement twice.
    The failure is logged and the group keeps an empty ``document_url``.
    """
    from apps.warehouse.tasks import upload_group_pdf_task

    try:
        upload_group_pdf_task.delay(group.pk)
    except (BrokerOperationalError, ConnectionError):
        logger.exception(
            'warehouse.group_pdf.enqueue_failed',
            extra={'group_id': group.pk},
        )


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class WarehousePagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

XLSX_CONTENT_TYPE = exports_svc.XLSX_CONTENT_TYPE


def _parse_date_param(params, name):
    """Parse a YYYY-MM-DD query parameter; invalid values answer 400 (not 500)."""
    raw = params.get(name)
    if not raw:
        return None
    try:
        parsed = parse_date(raw)  # ValueError for well-formed but impossible dates (2026-13-45)
    except ValueError:
        parsed = None
    if parsed is None:
        raise drf_serializers.ValidationError({name: 'Fecha inválida. Use el formato AAAA-MM-DD.'})
    return parsed


def _parse_date_range(params):
    date_from = _parse_date_param(params, 'date_from')
    date_to = _parse_date_param(params, 'date_to')
    if date_from and date_to and date_from > date_to:
        raise drf_serializers.ValidationError(
            {'date_from': 'La fecha inicial no puede ser posterior a la final.'}
        )
    return date_from, date_to


_MAX_BIGINT = 2 ** 63 - 1
_MAX_QUANTITY = Decimal('999999999.999')      # DecimalField(max_digits=12, decimal_places=3)


def _parse_int_param(params, name):
    """Positive integer query parameter; junk answers 400 (not 500)."""
    raw = params.get(name)
    if raw is None or str(raw).strip() == '':
        return None
    text = str(raw).strip()
    if not (text.isascii() and text.isdigit()) or not 0 < int(text) <= _MAX_BIGINT:
        raise drf_serializers.ValidationError({name: 'Valor inválido: indique un número entero.'})
    return int(text)


def _parse_decimal_param(params, name):
    """Finite quantity query parameter within the column range; junk answers 400 (not 500)."""
    raw = params.get(name)
    if raw is None or str(raw).strip() == '':
        return None
    try:
        value = Decimal(str(raw).strip())
    except InvalidOperation:
        value = None
    if value is None or not value.is_finite() or abs(value) > _MAX_QUANTITY:
        raise drf_serializers.ValidationError({name: 'Valor inválido: indique una cantidad numérica.'})
    return value


def _no_store(response):
    response['Cache-Control'] = 'no-store'
    return response


def _voucher_exists_response():
    return Response(
        {
            'detail': 'Ya existe un egreso con ese N° de vale en este almacén.',
            'code': 'voucher_number_exists',
        },
        status=status.HTTP_409_CONFLICT,
    )


def _exit_conflict_response(exc):
    """409 of a free exit: `DuplicateExitError` (double submit) or `GuideNumberBusyError` (retry)."""
    logger.warning('warehouse.exit.conflict', extra={'code': exc.code})
    return _no_store(Response(
        {'detail': exc.message, 'code': exc.code}, status=status.HTTP_409_CONFLICT,
    ))


# ---------------------------------------------------------------------------
# Permission: IsWarehouseRole lives in apps/warehouse/permissions.py (re-imported
# above so `apps.warehouse.views.IsWarehouseRole` keeps working).
# ---------------------------------------------------------------------------

class ItemHasMovements(APIException):
    """The catalog item has movement history (``on_delete=PROTECT``): it cannot be deleted."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = 'El ítem tiene historial de movimientos y no se puede eliminar.'
    default_code = 'item_has_movements'


class ItemLinkedToRequests(APIException):
    """
    Request lines point at the catalog item (``RequestItem.inventory_item``, SET_NULL).
    Deleting it would silently detach them: the RQ would keep asking for "a product" that
    no longer exists and the stock check / dispatch could no longer find it.
    """

    status_code = status.HTTP_409_CONFLICT
    default_detail = (
        'El ítem está vinculado a líneas de requerimientos y no se puede eliminar. '
        'Desvincúlelo primero o déjelo sin stock.'
    )
    default_code = 'item_linked_to_requests'


# Fase 3 (Almacenamiento) data of a catalog item: only ``CanAssignLocations`` roles change it.
STORAGE_FIELDS = ('location', 'floor', 'project')
STORAGE_DENIED = (
    'Solo Almacén Central y Jefe Logístico pueden cambiar la ubicación, el piso o el '
    'proyecto de un ítem.'
)


def _enforce_movement_scope(request, warehouse, *, destination_type=None, personal=None):
    """403 when the user's role cannot operate that warehouse / hand material to a person."""
    person = destination_type in PERSON_DESTINATION_TYPES or personal is not None
    message = movement_scope_error(request.user, warehouse, person_destination=person)
    if message:
        logger.warning(
            'warehouse.movement.scope_denied',
            extra={'user_id': request.user.id, 'warehouse': warehouse, 'person_destination': person},
        )
        raise PermissionDenied(message)


# ---------------------------------------------------------------------------
# Inventory ViewSet
# ---------------------------------------------------------------------------

class InventoryViewSet(RejectNulQueryParamsMixin, viewsets.ModelViewSet):
    """Full CRUD for the inventory catalog plus auxiliary read actions."""

    permission_classes = [IsAuthenticated, IsWarehouseRole]
    pagination_class = WarehousePagination
    queryset = Inventory.objects.select_related('project').prefetch_related(
        'stocks', 'stocks__project'
    ).all()

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return InventoryCreateUpdateSerializer
        return InventoryListSerializer

    def get_permissions(self):
        if self.action == 'assign_locations':
            return [IsAuthenticated(), CanAssignLocations()]
        return super().get_permissions()

    # -- catalog writes --------------------------------------------------------

    def _guard_storage_fields(self, serializer):
        """
        ``assign-locations`` is restricted to ``CanAssignLocations``; the generic CRUD must not
        be a side door to the same data. Roles without it may still edit every other field
        (and re-send the current values untouched, as a full PUT does).
        """
        if can_assign_locations(self.request.user):
            return
        data, instance = serializer.validated_data, serializer.instance
        for field in STORAGE_FIELDS:
            if field not in data:
                continue
            new, old = data[field], None
            if field == 'project':
                new = new.pk if new else None
                old = instance.project_id if instance else None
            elif field == 'location':
                new = locations_svc.normalize_location(new or '')
                old = locations_svc.normalize_location(instance.location) if instance else ''
            else:
                old = instance.floor if instance else None
            if new != old:
                logger.warning(
                    'warehouse.inventory.storage_fields_denied',
                    extra={'user_id': self.request.user.id, 'field': field},
                )
                raise PermissionDenied(STORAGE_DENIED)

    def perform_create(self, serializer):
        self._guard_storage_fields(serializer)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._guard_storage_fields(serializer)
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        """
        Refuse to delete a product that request lines (``RequestItem``) still point at.

        The FK is SET_NULL, so the database would not stop the delete: it would just empty
        the link of every line. The row is locked first so a line cannot be linked to the
        product between the check and the delete (a new FK reference takes a conflicting
        row lock in PostgreSQL). The FK itself is unchanged.
        """
        with transaction.atomic():
            locked = Inventory.objects.select_for_update().filter(pk=instance.pk).first()
            if locked is None:
                raise Http404
            if locked.request_items.exists():
                logger.info(
                    'warehouse.inventory.delete_blocked_by_requests',
                    extra={'user_id': self.request.user.id, 'inventory_id': instance.pk},
                )
                raise ItemLinkedToRequests()
            locked.delete()

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            # Movements point at the item with on_delete=PROTECT: the history must survive.
            logger.info(
                'warehouse.inventory.delete_blocked',
                extra={'user_id': request.user.id, 'inventory_id': kwargs.get('pk')},
            )
            raise ItemHasMovements() from None

    # -- shared filter helper ------------------------------------------------

    def _apply_inventory_filters(self, qs, params):
        """Apply common query filters to an inventory queryset."""
        qs = catalog_svc.apply_catalog_filters(qs, params)
        # Annotate total stock at the database level for filtering
        qs = catalog_svc.annotate_total_stock(qs)
        return catalog_svc.apply_stock_filters(qs, params)

    # -- list with filters ---------------------------------------------------

    def list(self, request):
        qs = self._apply_inventory_filters(self.get_queryset(), request.query_params)

        # Support no_page=true for dropdowns that need the full list
        if request.query_params.get('no_page') == 'true':
            serializer = InventoryListSerializer(qs, many=True)
            return Response(serializer.data)

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = InventoryListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = InventoryListSerializer(qs, many=True)
        return Response(serializer.data)

    # -- kardex (movement history for one item) ------------------------------

    @action(detail=True, methods=['get'])
    def kardex(self, request, pk=None):
        """
        Kardex of one item with the running balance (SYSPCC-025).

        Filters: ``date_from``, ``date_to`` (by movement_date), ``movement_type``,
        ``warehouse``. Movements come in chronological order (undated last), each
        with ``delta`` and ``balance_after``; ``opening_stock`` is the balance
        before ``date_from``.
        """
        item = self.get_object()
        date_from, date_to = _parse_date_range(request.query_params)
        result = kardex_svc.item_kardex(
            item,
            date_from=date_from,
            date_to=date_to,
            movement_type=request.query_params.get('movement_type') or None,
            warehouse=request.query_params.get('warehouse') or None,
        )
        movements = MovementListSerializer(
            [mv for mv, _delta, _balance in result['rows']], many=True
        ).data
        for data, (_mv, delta, balance) in zip(movements, result['rows']):
            data['delta'] = float(delta)
            data['balance_after'] = float(balance)

        return Response({
            'item': InventoryListSerializer(item).data,
            'opening_stock': float(result['opening_stock']),
            'closing_stock': float(result['closing_stock']),
            'movements': movements,
        })

    # -- recent movements for one item --------------------------------------

    @action(detail=True, methods=['get'], url_path='recent-movements')
    def recent_movements(self, request, pk=None):
        """Return the 5 most recent movements for a specific inventory item."""
        item = self.get_object()
        movements = InventoryMovement.objects.filter(inventory=item).select_related(
            'inventory', 'registered_by', 'requested_by', 'authorized_by', 'project',
            'destination_personal', 'group',
        ).order_by(*MOVEMENT_LIST_ORDERING)[:5]
        return Response(MovementListSerializer(movements, many=True).data)

    # -- categories dropdown -------------------------------------------------

    @action(detail=False, methods=['get'])
    def categories(self, request):
        """Return distinct non-empty categories for filter dropdowns."""
        cats = (
            Inventory.objects
            .exclude(category='')
            .values_list('category', flat=True)
            .distinct()
            .order_by('category')
        )
        return Response(list(cats))

    # -- stock alerts --------------------------------------------------------

    @action(detail=False, methods=['get'])
    def alerts(self, request):
        """Return items whose total stock is at or below their minimum threshold."""
        # SYSPCC-013 FIX 3: aggregate total stock in the DB (same pattern as
        # `_apply_inventory_filters`) instead of pulling every stock row into
        # Python and summing with a per-item loop.
        items = Inventory.objects.annotate(
            total_stock=Coalesce(
                Sum('stocks__quantity'),
                Value(0),
                output_field=DecimalField(),
            )
        ).filter(total_stock__lte=F('min_stock'))
        result = [
            {
                'id': item.id,
                'product_code': item.product_code,
                'description': item.description,
                'unit': item.unit,
                'min_stock': float(item.min_stock),
                'current_stock': float(item.total_stock),
                'deficit': float(item.min_stock - item.total_stock),
            }
            for item in items
        ]
        return Response(result)

    # -- stock check (used by RQ logistics) ----------------------------------

    @action(detail=False, methods=['get'], url_path='check-stock')
    def check_stock(self, request):
        """
        Check availability for a comma-separated list of item descriptions.
        Used by the RQ logistics module; kept read-only and open to IsAuthenticated only.
        Query params: project_id, descriptions (comma-separated)
        """
        project_id = _parse_int_param(request.query_params, 'project_id')
        descriptions = request.query_params.get('descriptions', '')

        if not descriptions:
            return Response([])

        desc_list = [d.strip() for d in descriptions.split(',') if d.strip()]
        results = []

        for desc in desc_list:
            inventory = Inventory.objects.filter(
                Q(description__icontains=desc) | Q(product_code__icontains=desc)
            ).first()

            if inventory:
                central_stock = InventoryStock.objects.filter(
                    inventory=inventory, warehouse_type='CENTRAL'
                ).first()
                site_stock = InventoryStock.objects.filter(
                    inventory=inventory, warehouse_type='SITE', project_id=project_id
                ).first() if project_id else None

                results.append({
                    'description': desc,
                    'matched_product': inventory.product_code,
                    'matched_description': inventory.description,
                    'unit': inventory.unit,
                    'stock_central': float(central_stock.quantity) if central_stock else 0,
                    'stock_obra': float(site_stock.quantity) if site_stock else 0,
                    'min_stock': float(inventory.min_stock),
                    'has_stock': (
                        (central_stock and central_stock.quantity > 0)
                        or (site_stock and site_stock.quantity > 0)
                    ),
                    # SYSPCC-025 (Fase 4, paso 2: identificación de ubicaciones)
                    'location': inventory.location_display,
                    'floor': inventory.floor,
                    'location_status': inventory.location_status,
                })
            else:
                results.append({
                    'description': desc,
                    'matched_product': None,
                    'matched_description': None,
                    'unit': None,
                    'stock_central': 0,
                    'stock_obra': 0,
                    'min_stock': 0,
                    'has_stock': False,
                    'location': '',
                    'floor': None,
                    'location_status': locations_svc.NONE,
                })

        return Response(results)

    # -- dashboard summary ---------------------------------------------------

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Quick stats for the warehouse dashboard."""
        # "Today" is the operational date (movement_date) in America/Lima: created_at is only
        # the audit timestamp (an imported October book is registered today), and
        # timezone.now().date() would be the UTC date.
        today = timezone.localdate()

        total_items = Inventory.objects.count()
        # SYSPCC-013 FIX 3: same DB-side aggregation as `alerts()` — avoid
        # materializing every stock row in Python just to compare a sum.
        low_stock_count = Inventory.objects.annotate(
            total_stock=Coalesce(
                Sum('stocks__quantity'),
                Value(0),
                output_field=DecimalField(),
            )
        ).filter(total_stock__lte=F('min_stock')).count()
        today_entries = InventoryMovement.objects.filter(
            movement_type='ENTRY', movement_date=today
        ).count()
        today_exits = InventoryMovement.objects.filter(
            movement_type='EXIT', movement_date=today
        ).count()

        zero_stock_count = catalog_svc.annotate_total_stock(
            Inventory.objects.all()
        ).filter(total_stock__lte=0).count()
        pending_location_count = catalog_svc.filter_location_status(
            Inventory.objects.all(), 'pending'
        ).count()

        return Response({
            'total_items': total_items,
            'low_stock_count': low_stock_count,
            'today_entries': today_entries,
            'today_exits': today_exits,
            # SYSPCC-025
            'pending_location_count': pending_location_count,
            'zero_stock_count': zero_stock_count,
            # Real stock (InventoryStock), the figure Inventario shows: the "units in stock" KPI.
            'total_units': float(
                InventoryStock.objects.aggregate(total=Sum('quantity'))['total'] or 0
            ),
            'undated_movements': InventoryMovement.objects.filter(
                movement_date__isnull=True
            ).count(),
        })

    # -- location layout + assignment (Fase 3: Almacenamiento) ---------------

    @extend_schema(tags=['warehouse'], summary='Layout de pabellones, secciones y niveles', responses={200: dict})
    @action(detail=False, methods=['get'], url_path='location-layout')
    def location_layout(self, request):
        """Pavilions/sections/levels of the warehouse for the UI selects."""
        return Response(locations_svc.layout_payload())

    @extend_schema(tags=['warehouse'], summary='Asignar ubicaciones (todo o nada)', request=AssignLocationsSerializer, responses={200: dict, 400: dict})
    @action(detail=False, methods=['post'], url_path='assign-locations')
    def assign_locations(self, request):
        """
        Assign the exact location of several items at once (all or nothing).
        Body: ``{"assignments": [{"inventory": 12, "location": "F3-2"}, ...]}`` (max 300).
        """
        serializer = AssignLocationsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignments = serializer.validated_data['assignments']

        with transaction.atomic():
            items = {
                i.pk: i for i in Inventory.objects.select_for_update().filter(
                    pk__in=[a['inventory'] for a in assignments]
                )
            }
            errors, seen, updates = [], set(), []
            for index, assignment in enumerate(assignments):
                item = items.get(assignment['inventory'])
                if item is None:
                    errors.append({'index': index, 'field': 'inventory',
                                   'error': 'El ítem seleccionado no existe.'})
                    continue
                if item.pk in seen:
                    errors.append({'index': index, 'field': 'inventory',
                                   'error': 'El ítem está repetido en la solicitud.'})
                    continue
                seen.add(item.pk)
                try:
                    parsed = locations_svc.validate_location(assignment['location'])
                except ValueError as exc:
                    errors.append({'index': index, 'field': 'location', 'error': str(exc)})
                    continue
                updates.append((item, parsed))

            if errors:
                return Response(
                    {
                        'error': True,
                        'status_code': status.HTTP_400_BAD_REQUEST,
                        'detail': 'Hay ubicaciones inválidas. No se aplicó ningún cambio.',
                        'errors': errors,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            for item, parsed in updates:
                item.location = parsed.code
                item.floor = parsed.floor
                item.save(update_fields=['location', 'floor'])

        logger.info(
            'warehouse.location.assigned',
            extra={'user_id': request.user.id, 'count': len(updates)},
        )
        return Response({'updated': len(updates)})

    # -- movement summary (kardex aggregate, "RESUMEN DE MOVIMIENTO") --------

    def _summary_queryset(self, request):
        """Filtered/annotated queryset of the movement summary + the parsed filters."""
        params = request.query_params
        date_from, date_to = _parse_date_range(params)
        warehouse = params.get('warehouse') or None
        if warehouse and warehouse not in dict(WarehouseOriginChoices.choices):
            raise drf_serializers.ValidationError({'warehouse': 'Almacén inválido.'})
        base = catalog_svc.apply_catalog_filters(Inventory.objects.all(), params)
        qs = kardex_svc.movement_summary_qs(
            base,
            date_from=date_from,
            date_to=date_to,
            warehouse=warehouse,
            only_with_movement=params.get('only_with_movement') == 'true',
            only_zero_stock=params.get('only_zero_stock') == 'true',
            ordering=params.get('ordering'),
        )
        return qs, base, {'date_from': date_from, 'date_to': date_to, 'warehouse': warehouse}

    @extend_schema(
        tags=['warehouse'], summary='Resumen de movimiento (kardex agregado)',
        parameters=[OpenApiParameter(n, str, required=False) for n in (
            'date_from', 'date_to', 'search', 'category', 'item_type', 'project', 'floor',
            'location_status', 'warehouse', 'only_with_movement', 'only_zero_stock', 'ordering',
            'page', 'page_size', 'no_page')],
        responses={200: dict},
    )
    @action(detail=False, methods=['get'], url_path='movement-summary')
    def movement_summary(self, request):
        """
        Per-item INV. INICIAL / INGRESOS / EGRESOS / STOCK ACTUAL (see
        ``apps/warehouse/services/kardex.py`` for the exact semantics).
        """
        qs, base, f = self._summary_queryset(request)
        has_date_filter = bool(f['date_from'] or f['date_to'])
        meta = {
            'date_from': f['date_from'],
            'date_to': f['date_to'],
            'undated_movements': (
                kardex_svc.count_undated_movements(base.values('pk'), f['warehouse'])
                if has_date_filter else 0
            ),
            'totals': kardex_svc.summary_totals(qs),
            # Items whose real stock has no movements behind it (seeded, edited in the admin or
            # loaded before the ledger): null when a date filter applies.
            'untracked_stock': kardex_svc.untracked_totals(
                qs, date_from=f['date_from'], date_to=f['date_to'],
            ),
        }
        with_untracked = not has_date_filter

        if request.query_params.get('no_page') == 'true':
            total = qs.count()
            rows = [
                kardex_svc.summary_row(i, with_untracked=with_untracked)
                for i in qs[:kardex_svc.MAX_UNPAGINATED_ROWS]
            ]
            meta['truncated'] = total > kardex_svc.MAX_UNPAGINATED_ROWS
            return _no_store(Response({
                'count': total, 'next': None, 'previous': None,
                'results': rows, 'meta': meta,
            }))

        page = self.paginate_queryset(qs)
        response = self.get_paginated_response(
            [kardex_svc.summary_row(i, with_untracked=with_untracked) for i in page]
        )
        response.data['meta'] = meta
        return _no_store(response)

    @extend_schema(tags=['warehouse'], summary='Exportar el resumen de movimiento a Excel (formato de su hoja)', responses={200: bytes})
    @action(detail=False, methods=['get'], url_path='movement-summary/export')
    def movement_summary_export(self, request):
        """
        Excel export of the movement summary with the layout of the real workbook.
        ``include_movements=true`` adds the INGRESOS and EGRESOS sheets.
        """
        qs, base, f = self._summary_queryset(request)
        movements_qs = None
        if request.query_params.get('include_movements') == 'true':
            movements_qs = InventoryMovement.objects.filter(inventory_id__in=base.values('pk'))
            if f['warehouse']:
                movements_qs = movements_qs.filter(warehouse=f['warehouse'])
            if f['date_from']:
                movements_qs = movements_qs.filter(movement_date__gte=f['date_from'])
            if f['date_to']:
                movements_qs = movements_qs.filter(movement_date__lte=f['date_to'])

        wb = exports_svc.build_summary_workbook(qs, movements_qs=movements_qs, date_from=f['date_from'])

        filename = f'RESUMEN_MOVIMIENTO_{timezone.localdate().isoformat()}.xlsx'
        response = HttpResponse(content_type=XLSX_CONTENT_TYPE)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        wb.save(response)
        logger.info(
            'warehouse.export',
            extra={
                'user_id': request.user.id,
                'export': 'movement_summary',
                'rows': wb.worksheets[0].max_row - 1,
                'include_movements': movements_qs is not None,
                'date_from': str(f['date_from'] or ''),
                'date_to': str(f['date_to'] or ''),
            },
        )
        return _no_store(response)

    # -- Excel export --------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='export')
    def export_excel(self, request):
        """Export the current filtered inventory list as an xlsx file."""
        qs = self._apply_inventory_filters(
            Inventory.objects.prefetch_related('stocks').all(),
            request.query_params,
        )
        # SYSPCC-013 FIX 2: cap the export at MAX_EXPORT_ROWS — truncate with
        # a visible warning row rather than building an unbounded workbook.
        qs, was_truncated = truncate_for_export(qs)

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Inventario'

        headers = [
            'Código', 'Descripción', 'Unidad', 'Categoría', 'Tipo',
            'Marca', 'Modelo', 'Ubicación', 'Stock total', 'Stock mínimo',
        ]
        if was_truncated:
            ws.append([exports_svc.TRUNCATED_EXPORT_WARNING])
        ws.append(headers)

        # Bold header row
        bold = Font(bold=True)
        for cell in ws[2 if was_truncated else 1]:
            cell.font = bold

        for item in qs:
            total = float(sum(s.quantity for s in item.stocks.all()))
            ws.append([
                sanitize_excel_value(v) for v in [
                    item.product_code,
                    item.description,
                    item.unit,
                    item.category,
                    item.get_item_type_display(),
                    item.brand,
                    item.model_name,
                    # 'PISO 2' for floor-only items; legacy free text is kept as it was typed.
                    item.location_display or item.location,
                    total,
                    float(item.min_stock),
                ]
            ])

        response = HttpResponse(
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = 'attachment; filename="inventario.xlsx"'
        wb.save(response)
        return response


# ---------------------------------------------------------------------------
# Movement ViewSet
# ---------------------------------------------------------------------------

class MovementViewSet(RejectNulQueryParamsMixin, viewsets.ReadOnlyModelViewSet):
    """
    List/retrieve movements plus POST actions for entry and exit.
    Write actions (entry, exit) require warehouse role.
    """

    permission_classes = [IsAuthenticated, IsWarehouseRole]
    serializer_class = MovementListSerializer
    pagination_class = WarehousePagination
    queryset = InventoryMovement.objects.select_related(
        'inventory', 'registered_by', 'requested_by', 'authorized_by', 'project',
        'destination_personal', 'group',
    ).all()

    def get_queryset(self):
        return super().get_queryset().order_by(*MOVEMENT_LIST_ORDERING)

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.action in ('exit', 'batch_exit', 'epp_delivery'):
            throttles.append(WarehouseExitThrottle())      # SYSPCC-041
        return throttles

    def get_permissions(self):
        if self.action == 'epp_delivery':
            return [IsAuthenticated(), CanDeliverEPP()]
        if self.action == 'link_personal':
            return [IsAuthenticated(), CanLinkPersonal()]
        return super().get_permissions()

    # -- shared filter helper ------------------------------------------------

    def _apply_movement_filters(self, qs, params):
        """Apply common query filters to a movement queryset."""
        movement_type = params.get('movement_type')
        warehouse = params.get('warehouse')
        search = params.get('search')
        date_from, date_to = _parse_date_range(params)
        supplier = params.get('supplier')
        project = _parse_int_param(params, 'project')
        qty_min = _parse_decimal_param(params, 'qty_min')
        qty_max = _parse_decimal_param(params, 'qty_max')

        if movement_type:
            qs = qs.filter(movement_type=movement_type)
        if warehouse:
            qs = qs.filter(warehouse=warehouse)
        if search:
            qs = qs.filter(
                Q(movement_number__icontains=search) |
                Q(inventory__product_code__icontains=search) |
                Q(inventory__description__icontains=search)
            )
        if date_from:
            qs = qs.filter(movement_date__gte=date_from)
        if date_to:
            qs = qs.filter(movement_date__lte=date_to)
        if supplier:
            qs = qs.filter(supplier_name__icontains=supplier)
        if project is not None:
            qs = qs.filter(project_id=project)
        if qty_min is not None:
            qs = qs.filter(quantity__gte=qty_min)
        if qty_max is not None:
            qs = qs.filter(quantity__lte=qty_max)

        # SYSPCC-025
        voucher_number = params.get('voucher_number')
        destination_personal = _parse_int_param(params, 'destination_personal')
        destination = params.get('destination')
        has_date = params.get('has_date')
        import_batch = params.get('import_batch')
        if voucher_number:
            qs = qs.filter(voucher_number__iexact=voucher_number.strip())
        if params.get('no_voucher') == 'true':
            # SYSPCC-041: an exit with an automatic guide (GR-AAAA-NNNNNN) is not "without a
            # document" even though nobody types a physical vale any more; only the historic
            # exits (no guide) can be missing their vale.
            qs = qs.filter(movement_type='EXIT', voucher_number='', group__internal_guide_number__isnull=True)
        if destination_personal is not None:
            qs = qs.filter(destination_personal_id=destination_personal)
        if destination:
            qs = qs.filter(destination_detail__icontains=destination)
        if has_date == 'false':
            qs = qs.filter(movement_date__isnull=True)
        elif has_date == 'true':
            qs = qs.filter(movement_date__isnull=False)
        if params.get('unlinked_destination') == 'true':
            # "Sin destino" (SYSPCC-032) is not a name to link to a worker: it is found with no_destination.
            qs = (
                qs.filter(destination_personal__isnull=True)
                .exclude(destination_detail='').exclude(destination_detail__iexact=NO_DESTINATION_LABEL)
            )
        if params.get('no_destination') == 'true':
            qs = qs.filter(movement_type='EXIT', destination_detail__iexact=NO_DESTINATION_LABEL)
        if import_batch:
            try:
                qs = qs.filter(import_batch_id=import_batch)
            except (ValueError, TypeError, DjangoValidationError):
                raise drf_serializers.ValidationError({'import_batch': 'Identificador inválido.'})

        return qs

    def list(self, request):
        qs = self._apply_movement_filters(self.get_queryset(), request.query_params)

        # Support no_page=true for full list without pagination
        if request.query_params.get('no_page') == 'true':
            serializer = self.get_serializer(qs, many=True)
            return Response(serializer.data)

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    # -- entry ---------------------------------------------------------------

    @action(detail=False, methods=['post'])
    def entry(self, request):
        """Register a new inventory entry (entrada)."""
        serializer = EntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        _enforce_movement_scope(request, d['warehouse'])
        try:
            movement = warehouse_svc.register_entry(
                inventory=d['inventory'],
                quantity=d['quantity'],
                warehouse=d['warehouse'],
                project_id=d.get('project'),
                source_type=d['source_type'],
                supplier_name=d.get('supplier_name', ''),
                invoice_number=d.get('invoice_number', ''),
                notes=d.get('notes', ''),
                registered_by=request.user,
                tag=d.get('tag', ''),
                **document_kwargs(d),
            )
            return Response(
                MovementListSerializer(movement).data,
                status=status.HTTP_201_CREATED,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            # SYSPCC-007: movement_number numbering race (select_for_update locks the
            # latest row, but the very first number for a prefix/year has nothing to
            # lock against) — map to 409 so the client can retry instead of a 500.
            logger.warning('warehouse.entry.integrity_error', extra={'user_id': request.user.id})
            return Response(
                {'detail': 'No se pudo generar el N° de movimiento. Intente nuevamente.'},
                status=status.HTTP_409_CONFLICT,
            )

    # -- exit ----------------------------------------------------------------

    @action(detail=False, methods=['post'])
    def exit(self, request):
        """Register a new inventory exit (salida)."""
        serializer = ExitCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        _enforce_movement_scope(
            request, d['warehouse'], destination_type=d['destination_type'],
            personal=d.get('destination_personal'),
        )
        if (
            d.get('voucher_number')
            and not d.get('allow_duplicate_voucher')
            and warehouse_svc.find_duplicate_voucher(d['warehouse'], d['voucher_number'])
        ):
            return _voucher_exists_response()
        try:
            movement = warehouse_svc.register_exit(
                inventory=d['inventory'],
                quantity=d['quantity'],
                warehouse=d['warehouse'],
                project_id=d.get('project'),
                destination_type=d['destination_type'],
                destination_detail=d.get('destination_detail', ''),
                requested_by_id=d.get('requested_by'),
                authorized_by_id=d.get('authorized_by'),
                notes=d.get('notes', ''),
                registered_by=request.user,
                reject_recent_duplicate=True,
                **document_kwargs(d),
            )
            return Response(
                MovementListSerializer(movement).data,
                status=status.HTTP_201_CREATED,
            )
        except (warehouse_svc.DuplicateExitError, GuideNumberBusyError) as exc:
            return _exit_conflict_response(exc)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            logger.warning('warehouse.exit.integrity_error', extra={'user_id': request.user.id})
            return Response(
                {'detail': 'No se pudo generar el N° de movimiento. Intente nuevamente.'},
                status=status.HTTP_409_CONFLICT,
            )

    # -- batch entry ---------------------------------------------------------

    @action(detail=False, methods=['post'], url_path='batch-entry')
    def batch_entry(self, request):
        """Register multiple inventory entries as a single vale (batch entrada)."""
        serializer = BatchEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        _enforce_movement_scope(request, d['warehouse'])

        items_data = [
            {
                'inventory_id': item['inventory'].pk,
                'quantity': item['quantity'],
                'line': idx,
                'tag': item.get('tag', ''),
                'notes': item.get('notes', ''),
            }
            for idx, item in enumerate(d['items'], start=1)
        ]

        try:
            group = warehouse_svc.register_entry_batch(
                items_data=items_data,
                warehouse=d['warehouse'],
                project_id=d.get('project'),
                source_type=d['source_type'],
                supplier_name=d.get('supplier_name', ''),
                invoice_number=d.get('invoice_number', ''),
                notes=d.get('notes', ''),
                registered_by=request.user,
                **document_kwargs(d),
            )
            # SYSPCC-012 FIX 4: PDF generation + OneDrive upload used to run
            # synchronously in this request thread (~45 s blocked on Microsoft
            # Graph). Enqueue it on Celery instead — the existing
            # `upload_group_pdf_task` already handles retries, idempotency
            # (skips if `document_url` is already set) and stores the sharing
            # URL back on the group once it succeeds.
            # TODO(SYSPCC): the response below returns `document_url` empty —
            # the frontend does not currently poll/refresh for it. Not a
            # regression introduced here (the sync call was itself best-effort
            # and could return None), but if the UI needs the link
            # immediately, it must poll GET on this group or receive a
            # websocket/notification once the task completes.
            _enqueue_group_pdf_upload(group)

            return Response(
                MovementGroupSerializer(group).data,
                status=status.HTTP_201_CREATED,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            logger.warning('warehouse.batch_entry.integrity_error', extra={'user_id': request.user.id})
            return Response(
                {'detail': 'No se pudo generar el N° de vale interno. Intente nuevamente.'},
                status=status.HTTP_409_CONFLICT,
            )

    # -- batch exit ----------------------------------------------------------

    @action(detail=False, methods=['post'], url_path='batch-exit')
    def batch_exit(self, request):
        """Register multiple inventory exits as a single vale (batch salida)."""
        serializer = BatchExitCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        _enforce_movement_scope(
            request, d['warehouse'], destination_type=d['destination_type'],
            personal=d.get('destination_personal'),
        )
        if (
            d.get('voucher_number')
            and not d.get('allow_duplicate_voucher')
            and warehouse_svc.find_duplicate_voucher(d['warehouse'], d['voucher_number'])
        ):
            return _voucher_exists_response()

        items_data = [
            {
                'inventory_id': item['inventory'].pk,
                'quantity': item['quantity'],
                'line': idx,
                'notes': item.get('notes', ''),
            }
            for idx, item in enumerate(d['items'], start=1)
        ]

        try:
            group = warehouse_svc.register_exit_batch(
                items_data=items_data,
                warehouse=d['warehouse'],
                project_id=d.get('project'),
                destination_type=d['destination_type'],
                destination_detail=d.get('destination_detail', ''),
                requested_by_id=d.get('requested_by'),
                authorized_by_id=d.get('authorized_by'),
                notes=d.get('notes', ''),
                registered_by=request.user,
                reject_recent_duplicate=True,
                **document_kwargs(d),
            )
            # SYSPCC-012 FIX 4: PDF generation + OneDrive upload used to run
            # synchronously in this request thread (~45 s blocked on Microsoft
            # Graph). Enqueue it on Celery instead — the existing
            # `upload_group_pdf_task` already handles retries, idempotency
            # (skips if `document_url` is already set) and stores the sharing
            # URL back on the group once it succeeds.
            # TODO(SYSPCC): the response below returns `document_url` empty —
            # the frontend does not currently poll/refresh for it. Not a
            # regression introduced here (the sync call was itself best-effort
            # and could return None), but if the UI needs the link
            # immediately, it must poll GET on this group or receive a
            # websocket/notification once the task completes.
            _enqueue_group_pdf_upload(group)

            return Response(
                MovementGroupSerializer(group).data,
                status=status.HTTP_201_CREATED,
            )
        except (warehouse_svc.DuplicateExitError, GuideNumberBusyError) as exc:
            return _exit_conflict_response(exc)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            logger.warning('warehouse.batch_exit.integrity_error', extra={'user_id': request.user.id})
            return Response(
                {'detail': 'No se pudo generar el N° de vale interno. Intente nuevamente.'},
                status=status.HTTP_409_CONFLICT,
            )

    # -- EPP delivery with vale (SYSPCC-025) ----------------------------------

    @extend_schema(tags=['warehouse'], summary='Entrega de EPP a un trabajador (vale físico opcional)', request=EppDeliverySerializer, responses={201: MovementGroupSerializer, 400: dict, 403: dict, 409: dict})
    @action(detail=False, methods=['post'], url_path='epp-delivery')
    def epp_delivery(self, request):
        """
        Counter delivery of EPP against a physical vale (Fase 4, paso 5: descuento
        de stock). Registers an EXIT; it never touches RQ statuses.
        """
        serializer = EppDeliverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data

        # SITE_WAREHOUSE operates only the site warehouse; CENTRAL_WAREHOUSE any. Same rule as
        # batch-exit with an EMPLOYEE/TRANSFER_OUT destination (one helper, no side door).
        _enforce_movement_scope(request, d['warehouse'], destination_type='EMPLOYEE')

        recipient = d['recipient']
        try:
            group = epp_svc.register_epp_delivery(
                items=[
                    {'inventory_id': it['inventory'].pk, 'quantity': it['quantity'],
                     'notes': it.get('notes', '')}
                    for it in d['items']
                ],
                warehouse=d['warehouse'],
                voucher_number=d['voucher_number'],
                movement_date=d['movement_date'],
                registered_by=request.user,
                personal=recipient.get('personal'),
                recipient_name=recipient.get('name', ''),
                internal_destination=recipient.get('internal', ''),
                internal_transfer=d.get('internal_transfer', ''),
                notes=d.get('notes', ''),
                project_id=d.get('project'),
                allow_duplicate_voucher=d.get('allow_duplicate_voucher', False),
                reject_recent_duplicate=True,
            )
        except epp_svc.DuplicateVoucherError:
            return _voucher_exists_response()
        except (warehouse_svc.DuplicateExitError, GuideNumberBusyError) as exc:
            return _exit_conflict_response(exc)
        except ValueError as exc:  # insufficient stock / invalid recipient
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            logger.warning('warehouse.epp_delivery.integrity_error', extra={'user_id': request.user.id})
            return Response(
                {'detail': 'No se pudo generar el N° de vale interno. Intente nuevamente.'},
                status=status.HTTP_409_CONFLICT,
            )

        _enqueue_group_pdf_upload(group)
        return _no_store(Response(
            MovementGroupSerializer(group).data, status=status.HTTP_201_CREATED,
        ))

    # -- link a free-text destination to a worker (SYSPCC-025) ----------------

    @extend_schema(tags=['warehouse'], summary='Vincular un destino en texto a un trabajador', request=LinkPersonalSerializer, responses={200: dict})
    @action(detail=False, methods=['post'], url_path='link-personal')
    def link_personal(self, request):
        """
        Link, in bulk and atomically, every movement/vale whose destination text
        normalizes to ``destination_key`` and has no worker yet.
        """
        serializer = LinkPersonalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = serializer.validated_data['destination_key']
        personal = serializer.validated_data['personal']

        with transaction.atomic():
            details = set()
            for model in (InventoryMovement, MovementGroup):
                candidates = (
                    model.objects.filter(destination_personal__isnull=True)
                    .exclude(destination_detail='')
                    .exclude(destination_detail__iexact=NO_DESTINATION_LABEL)
                    .values_list('destination_detail', flat=True)
                    .distinct()
                )
                details.update(d for d in candidates if destination_key(d) == key)

            linked_movements = linked_groups = 0
            detail_list = sorted(details)
            for i in range(0, len(detail_list), 500):  # stay under SQLite's variable cap
                chunk = detail_list[i:i + 500]
                linked_movements += InventoryMovement.objects.filter(
                    destination_personal__isnull=True, destination_detail__in=chunk,
                ).update(destination_personal=personal)
                linked_groups += MovementGroup.objects.filter(
                    destination_personal__isnull=True, destination_detail__in=chunk,
                ).update(destination_personal=personal)

        logger.info(
            'warehouse.link_personal',
            extra={
                'user_id': request.user.id,
                'linked_movements': linked_movements,
                'linked_groups': linked_groups,
            },
        )
        return Response({'linked_movements': linked_movements, 'linked_groups': linked_groups})

    # -- voucher (vale de salida) --------------------------------------------

    @action(detail=True, methods=['get'])
    def voucher(self, request, pk=None):
        """
        Return movement data formatted for printing a voucher.
        If the movement belongs to a group, the response includes all group items
        so the frontend can render a multi-item vale.
        """
        movement = self.get_object()

        # Shared fields
        data = {
            'movement_number': movement.movement_number,
            'movement_type': movement.movement_type,
            'movement_type_display': movement.get_movement_type_display(),
            'date': movement.created_at.strftime('%d/%m/%Y %H:%M'),
            'movement_date': movement.movement_date.isoformat() if movement.movement_date else None,
            'voucher_number': movement.voucher_number,
            # SYSPCC-041: automatic guide of the vale (null for entries and history)
            'internal_guide_number': movement.group.internal_guide_number if movement.group_id else None,
            'warehouse': movement.get_warehouse_display(),
            'project': movement.project.name if movement.project else '',
            'project_code': movement.project.code if movement.project else '',
            'destination_type': movement.destination_type,
            'destination_detail': movement.destination_detail,
            'supplier_name': movement.supplier_name,
            'invoice_number': movement.invoice_number,
            'source_type': movement.source_type,
            'requested_by': (
                movement.requested_by.get_full_name() if movement.requested_by else ''
            ),
            'authorized_by': (
                movement.authorized_by.get_full_name() if movement.authorized_by else ''
            ),
            'registered_by': movement.registered_by.get_full_name(),
            'notes': movement.notes,
            'document_url': movement.document_url or '',
        }

        # If this movement is part of a group, surface all items
        if movement.group_id:
            group = (
                MovementGroup.objects
                .prefetch_related('movements__inventory')
                .get(pk=movement.group_id)
            )
            data['group_number'] = group.group_number
            data['document_url'] = group.document_url or movement.document_url or ''
            data['items'] = [
                {
                    'product_code': mv.inventory.product_code,
                    'description': mv.inventory.description,
                    'unit': mv.inventory.unit,
                    'quantity': float(mv.quantity),
                }
                for mv in group.movements.select_related('inventory').order_by('movement_number')
            ]
        else:
            data['group_number'] = None
            data['items'] = [
                {
                    'product_code': movement.inventory.product_code,
                    'description': movement.inventory.description,
                    'unit': movement.inventory.unit,
                    'quantity': float(movement.quantity),
                }
            ]

        return Response(data)

    # -- group voucher -------------------------------------------------------

    @action(
        detail=False,
        methods=['get'],
        url_path=r'groups/(?P<group_pk>[0-9]+)/voucher',
    )
    def group_voucher(self, request, group_pk=None):
        """Return full voucher data for a MovementGroup (multi-item)."""
        try:
            group = (
                MovementGroup.objects
                .select_related('registered_by', 'project', 'destination_personal')
                .prefetch_related(Prefetch('movements', queryset=InventoryMovement.objects.select_related(
                    'inventory', 'registered_by', 'requested_by', 'authorized_by', 'project',
                    'destination_personal',
                )))
                .get(pk=group_pk)
            )
        except MovementGroup.DoesNotExist:
            return Response({'detail': 'Vale no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        return Response(MovementGroupSerializer(group).data)

    # -- group PDF download --------------------------------------------------

    @action(
        detail=False,
        methods=['get'],
        url_path=r'groups/(?P<group_pk>[0-9]+)/pdf',
    )
    def group_pdf(self, request, group_pk=None):
        """Generate and stream the multi-item PDF for a MovementGroup."""
        try:
            group = (
                MovementGroup.objects
                .select_related('registered_by', 'project')
                .prefetch_related('movements__inventory')
                .get(pk=group_pk)
            )
        except MovementGroup.DoesNotExist:
            return Response({'detail': 'Vale no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        from apps.warehouse.services.pdf_generator import get_group_filename
        pdf_bytes = generate_group_pdf(group)
        filename = get_group_filename(group)
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="{filename}"'
        return response

    # -- download PDF -------------------------------------------------------

    @action(detail=True, methods=['get'], url_path='pdf')
    def download_pdf(self, request, pk=None):
        """Generate and return the movement PDF for download."""
        movement = self.get_object()
        pdf_bytes = generate_movement_pdf(movement)

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        from apps.warehouse.services.pdf_generator import get_movement_filename
        response['Content-Disposition'] = f'inline; filename="{get_movement_filename(movement)}"'
        return response

    # -- Excel export --------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='export')
    def export_excel(self, request):
        """Export the current filtered movement list as an xlsx file."""
        qs = self._apply_movement_filters(
            InventoryMovement.objects.select_related(
                'inventory', 'registered_by', 'project'
            ).order_by(*MOVEMENT_LIST_ORDERING),
            request.query_params,
        )
        # SYSPCC-013 FIX 2: cap the export at MAX_EXPORT_ROWS — truncate with
        # a visible warning row rather than building an unbounded workbook.
        if request.query_params.get('layout') == 'excel_pcc':
            # SYSPCC-025: INGRESOS / EGRESOS sheets with the real workbook's columns.
            wb = exports_svc.build_movements_workbook(qs)
            response = HttpResponse(content_type=XLSX_CONTENT_TYPE)
            response['Content-Disposition'] = 'attachment; filename="movimientos_excel_pcc.xlsx"'
            wb.save(response)
            logger.info(
                'warehouse.export',
                extra={'user_id': request.user.id, 'export': 'movements_excel_pcc'},
            )
            return _no_store(response)

        qs, was_truncated = truncate_for_export(qs)

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Movimientos'

        headers = [
            'N° de movimiento', 'Tipo', 'Fecha', 'Código', 'Descripción',
            'Cantidad', 'Unidad', 'Almacén', 'Proveedor/Destino', 'Registrado por',
        ]
        if was_truncated:
            ws.append([exports_svc.TRUNCATED_EXPORT_WARNING])
        ws.append(headers)

        bold = Font(bold=True)
        for cell in ws[2 if was_truncated else 1]:
            cell.font = bold

        for mv in qs:
            provider_dest = mv.supplier_name or mv.destination_detail or ''
            ws.append([
                sanitize_excel_value(v) for v in [
                    mv.movement_number,
                    mv.get_movement_type_display(),
                    operational_date_label(mv.movement_date),
                    mv.inventory.product_code,
                    mv.inventory.description,
                    float(mv.quantity),
                    mv.inventory.unit,
                    mv.get_warehouse_display(),
                    provider_dest,
                    mv.registered_by.get_full_name() if mv.registered_by else '',
                ]
            ])

        response = HttpResponse(
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = 'attachment; filename="movimientos.xlsx"'
        wb.save(response)
        return response


# ---------------------------------------------------------------------------
# OneDrive Integration Views
# ---------------------------------------------------------------------------

class IsAdminUser(BasePermission):
    """Only superusers / staff can manage OneDrive connection."""
    message = 'Solo el administrador puede configurar OneDrive.'

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        # Status is readable by anyone authenticated, write actions need admin
        if view.action == 'status':
            return True
        return request.user.is_superuser or request.user.is_staff


class OneDriveViewSet(viewsets.ViewSet):
    """
    Endpoints for OneDrive OAuth2 device code flow.
    Only admin/superuser can connect/disconnect. Status is readable by all.
    """

    permission_classes = [IsAuthenticated, IsAdminUser]

    @staticmethod
    def _not_configured_response():
        # SYSPCC-017: ONEDRIVE_CLIENT_ID has no version-controlled default
        # anymore — the integration is optional. Fail with a clear, specific
        # message here instead of letting an empty client_id reach Microsoft
        # Graph and surface as a confusing generic error.
        return Response(
            {'detail': 'OneDrive no está configurado. Contacte al administrador del sistema.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    @action(detail=False, methods=['get'])
    def status(self, request):
        """Check if OneDrive is connected."""
        info = OneDriveService.get_connection_info()
        info['configured'] = bool(settings.ONEDRIVE_CLIENT_ID)
        return Response(info)

    @action(detail=False, methods=['post'], url_path='connect')
    def connect(self, request):
        """
        Start the device code flow.
        Returns the user_code and verification_uri for the user to complete auth.
        """
        if not settings.ONEDRIVE_CLIENT_ID:
            return self._not_configured_response()

        try:
            data = OneDriveService.initiate_device_code()
            return Response({
                'user_code': data.get('user_code'),
                'verification_uri': data.get('verification_uri'),
                'device_code': data.get('device_code'),
                'expires_in': data.get('expires_in', 900),
                'interval': data.get('interval', 5),
                'message': data.get('message', ''),
            })
        except Exception:
            # Last barrier: never leak exception internals (could include
            # request/response details from Microsoft Graph) to the client.
            logger.exception(
                'onedrive.connect.failed',
                extra={'user_id': request.user.id},
            )
            return Response(
                {'detail': 'No se pudo iniciar la conexión con OneDrive. Intente nuevamente.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['post'], url_path='poll')
    def poll(self, request):
        """
        Poll for token after user enters the device code.
        Called from the frontend at intervals until auth completes.
        """
        if not settings.ONEDRIVE_CLIENT_ID:
            return self._not_configured_response()

        device_code = request.data.get('device_code')
        if not device_code:
            return Response(
                {'detail': 'device_code requerido'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Single poll attempt (don't block the request)
            # SYSPCC-016 FOLLOW-UP 3: client_id/authority used to be hardcoded
            # here, duplicating the literals in services/onedrive.py — now
            # both read from the same settings (ONEDRIVE_CLIENT_ID,
            # ONEDRIVE_TENANT), so there's a single place to reconfigure.
            import requests as http_requests
            resp = http_requests.post(
                f'https://login.microsoftonline.com/{settings.ONEDRIVE_TENANT}/oauth2/v2.0/token',
                data={
                    'client_id': settings.ONEDRIVE_CLIENT_ID,
                    'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
                    'device_code': device_code,
                },
                timeout=10,
            )
            data = resp.json()

            if 'access_token' in data:
                from datetime import timedelta
                # Get account info
                account_name = ''
                try:
                    me = http_requests.get(
                        'https://graph.microsoft.com/v1.0/me',
                        headers={'Authorization': f'Bearer {data["access_token"]}'},
                        timeout=10,
                    ).json()
                    account_name = me.get('userPrincipalName') or me.get('displayName', '')
                except (http_requests.RequestException, ValueError):
                    # ValueError covers resp.json() on a non-JSON body. Non-fatal —
                    # the token is already valid, we just miss the display name.
                    logger.warning('onedrive.poll.account_info_failed', exc_info=True)

                from apps.warehouse.models import OneDriveToken
                expires_at = timezone.now() + timedelta(seconds=data.get('expires_in', 3600))
                OneDriveToken.save_token(
                    access_token=data['access_token'],
                    refresh_token=data.get('refresh_token', ''),
                    expires_at=expires_at,
                    account_name=account_name,
                )
                return Response({
                    'status': 'connected',
                    'account_name': account_name,
                })

            error = data.get('error', '')
            if error == 'authorization_pending':
                return Response({'status': 'pending'})
            if error == 'slow_down':
                return Response({'status': 'pending', 'slow_down': True})

            return Response(
                {'status': 'failed', 'error': error},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except Exception:
            logger.exception(
                'onedrive.poll.failed',
                extra={'user_id': request.user.id},
            )
            return Response(
                {'detail': 'Error al verificar el estado de conexión con OneDrive.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['post'], url_path='disconnect')
    def disconnect(self, request):
        """Remove stored OneDrive tokens."""
        OneDriveService.disconnect()
        return Response({'status': 'disconnected'})


# ---------------------------------------------------------------------------
# Pending Requests for Warehouse — RQ integration
# ---------------------------------------------------------------------------

# States where CENTRAL_WAREHOUSE must act
CENTRAL_PENDING_STATUSES = [
    'IN_STOCK',            # Must dispatch from central stock
    'QUALITY_APPROVED',    # SYSPCC-029: purchase received and approved; LOGISTICS dispatches it
    'DISPATCHED_TO_SITE',  # ADM: must update warehouse records
    'DELIVERED',           # ADM: must mark warehouse records updated
]

# States where SITE_WAREHOUSE must act
SITE_PENDING_STATUSES = [
    'DISPATCHED_TO_SITE',  # OPS: must confirm receipt at site
]

STATUS_LABELS = {
    'IN_STOCK':           'Stock disponible — pendiente despacho',
    'QUALITY_APPROVED':   'Calidad aprobada — pendiente despacho',
    'DISPATCHED_TO_SITE': 'Despachado — pendiente actualizar registros',
    'DELIVERED':          'Entregado — pendiente confirmar en almacén',
}

PENDING_ACTIONS = {
    'IN_STOCK':           'DISPATCHED',
    'QUALITY_APPROVED':   'DISPATCHED',
    'DISPATCHED_TO_SITE': 'WAREHOUSE_RECORDS_UPDATED',
    'DELIVERED':          'WAREHOUSE_RECORDS_UPDATED',
}


class PendingRequestsViewSet(RejectNulQueryParamsMixin, viewsets.ViewSet):
    """
    RQs that require action from the warehouse user.

    GET /warehouse/pending-requests/list/   — paginated list
    GET /warehouse/pending-requests/count/  — badge count by status
    GET /warehouse/pending-requests/deliverable/ — RQs the user can deliver now (Salida selector)
    """

    permission_classes = [IsAuthenticated, IsWarehouseRole]

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.action == 'deliverable':
            throttles.append(WarehouseLookupThrottle())   # typeahead with debounce
        return throttles

    def _get_pending_statuses(self, user):
        roles = list(user.user_roles.values_list('role', flat=True))
        statuses = set()
        if 'CENTRAL_WAREHOUSE' in roles:
            statuses.update(CENTRAL_PENDING_STATUSES)
        if 'SITE_WAREHOUSE' in roles:
            statuses.update(SITE_PENDING_STATUSES)
        if any(r in roles for r in ['LOGISTICS_COORDINATOR', 'LOGISTICS_SUPERVISOR', 'LOGISTICS_CHIEF']):
            statuses.update(CENTRAL_PENDING_STATUSES)
            statuses.update(SITE_PENDING_STATUSES)
        return list(statuses)

    def _build_queryset(self, user, params, *, with_item_counts=False):
        from django.db.models import Count
        from apps.rq.permissions import get_accessible_requests_queryset
        pending_statuses = self._get_pending_statuses(user)
        # Same visibility source as the rest of the app: SITE_WAREHOUSE only sees the requests of
        # its own projects (SYSPCC-029); central warehouse and logistics see all.
        qs = (
            get_accessible_requests_queryset(user)
            .filter(status__in=pending_statuses)
            .select_related('project', 'department', 'requested_by')
            .order_by('fecha_necesidad', '-created_at')
        )
        if with_item_counts:
            # SYSPCC-029: one query with the three counters instead of three per card.
            qs = qs.annotate(
                items_total=Count('items'),
                stock_total=Count('items', filter=Q(items__supply_source='STOCK')),
                purchase_total=Count('items', filter=Q(items__supply_source='PURCHASE')),
            )
        if params.get('flow'):
            qs = qs.filter(flow=params['flow'])
        if params.get('status'):
            qs = qs.filter(status=params['status'])
        if params.get('search'):
            s = params['search']
            qs = qs.filter(
                Q(rq_number__icontains=s) |
                Q(description__icontains=s) |
                Q(project__name__icontains=s) |
                Q(department__name__icontains=s) |
                Q(requested_by__first_name__icontains=s) |
                Q(requested_by__last_name__icontains=s)
            )
        return qs

    @action(detail=False, methods=['get'], url_path='list')
    def list_pending(self, request):
        """
        Paginated list of RQs pending warehouse action.

        ``can_act``: the user holds the role that TRANSITIONS requires for ``pending_action`` at
        this (flow, status); otherwise the card is read-only (e.g. QUALITY_APPROVED for the
        warehouse keeper: dispatching a purchase is Logistics' step). ``can_deliver``: the user
        may register partial deliveries (SYSPCC-029); ``act_roles`` lists who can act.
        """
        from apps.rq.services.transition_roles import roles_for_action
        from apps.warehouse.services.rq_fulfillment import DELIVERABLE_STATUSES

        qs = self._build_queryset(request.user, request.query_params, with_item_counts=True)
        paginator = WarehousePagination()
        page = paginator.paginate_queryset(qs, request)
        items = page if page is not None else qs
        user_roles = set(request.user.user_roles.values_list('role', flat=True))

        data = []
        for rq in items:
            pending_action = PENDING_ACTIONS.get(rq.status, '')
            act_roles = roles_for_action(rq.flow, rq.status, pending_action) if pending_action else frozenset()
            deliver_roles = (
                roles_for_action(rq.flow, rq.status, 'DISPATCHED') if rq.status in DELIVERABLE_STATUSES
                else frozenset()
            )
            data.append({
                'id': rq.id,
                'rq_number': rq.rq_number,
                'flow': rq.flow,
                'status': rq.status,
                'status_label': STATUS_LABELS.get(rq.status, rq.status),
                'pending_action': pending_action,
                'act_roles': sorted(act_roles),
                'can_act': bool(user_roles & act_roles),
                'can_deliver': bool(user_roles & deliver_roles),
                'priority': rq.priority,
                'fecha_necesidad': rq.fecha_necesidad,
                'fecha_estimada_entrega': rq.fecha_estimada_entrega,
                'project': rq.project.name if rq.project else None,
                'project_code': rq.project.code if rq.project else None,
                'department': rq.department.name if rq.department else None,
                'requested_by': rq.requested_by.get_full_name(),
                'items_count': rq.items_total,
                'stock_items': rq.stock_total,
                'purchase_items': rq.purchase_total,
                'acquisition_type': rq.acquisition_type,
                'created_at': rq.created_at,
            })

        if page is not None:
            return paginator.get_paginated_response(data)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='count')
    def count_pending(self, request):
        """Badge count of pending requests, broken down by status."""
        from django.db.models import Count
        qs = self._build_queryset(request.user, request.query_params)
        breakdown = qs.values('status').annotate(total=Count('id')).order_by('status')
        return Response({
            'total': qs.count(),
            'by_status': [
                {
                    'status': item['status'],
                    'label': STATUS_LABELS.get(item['status'], item['status']),
                    'count': item['total'],
                }
                for item in breakdown
            ],
        })

    @extend_schema(
        tags=['warehouse'], summary='RQ pendientes por entregar',
        parameters=[
            OpenApiParameter(
                'search', str,
                description='N° de RQ, proyecto, departamento o solicitante (máx. 100 caracteres; el resto se ignora).',
            ),
            OpenApiParameter('flow', str, description='OPERATIONS o ADMINISTRATIVE.'),
        ],
        responses={200: DeliverableRequestSerializer(many=True), 400: dict, 403: dict},
    )
    @action(detail=False, methods=['get'], url_path='deliverable')
    def deliverable(self, request):
        """
        SYSPCC-041 · RQs that the user can deliver today and that still have something left to
        deliver (Master rule: at least one PENDIENTE / PARCIAL item the warehouse can ship).
        Feeds the optional "Requerimiento pendiente de entrega" selector of the Salida screen.
        The payload adds ``truncated`` (bool): true when more than 500 candidates matched and the
        list may be incomplete, so the UI can ask the user to narrow the search.
        """
        from apps.core.enums import RQFlowChoices
        from apps.warehouse.services.rq_deliverable import list_deliverable_requests

        flow = request.query_params.get('flow', '').strip()
        if flow and flow not in RQFlowChoices.values:
            raise drf_serializers.ValidationError({'flow': 'Flujo no válido.'})

        result = list_deliverable_requests(
            request.user, search=request.query_params.get('search', ''), flow=flow,
        )
        rows = result.rows
        for row in rows:
            row['status_label'] = STATUS_LABELS.get(row['status'], row['status'])

        paginator = WarehousePagination()
        page = paginator.paginate_queryset(rows, request)
        response = paginator.get_paginated_response(DeliverableRequestSerializer(page, many=True).data)
        # True when the candidate cap was reached: the list may omit requests; ask to refine the search.
        response.data['truncated'] = result.truncated
        response['Cache-Control'] = 'no-store'
        return response
