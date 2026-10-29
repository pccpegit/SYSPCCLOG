"""
Request and RequestItem serializers.
"""

import logging
from collections.abc import Mapping
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import prefetch_related_objects
from django.utils.functional import lazy
from rest_framework import serializers

from apps.rq.models import Request, RequestItem
from apps.core.enums import OFICINA_CENTRAL_FRENTE, ItemSourceChoices
from apps.core.serializers.user import UserListSerializer
from apps.rq.services.request_items import log_proposed_catalog_links
from apps.warehouse.models import Inventory

logger = logging.getLogger(__name__)

# Primary keys are BigAutoField (signed 64-bit). A number outside this range cannot
# be an id and, worse, makes some drivers raise OverflowError (HTTP 500) when it is
# used in a lookup. Inside the range a non-existent id is simply "not found".
MIN_DB_INT = -(2**63)
MAX_DB_INT = 2**63 - 1

# One POST must not be an amplifier: every line costs queries and log volume.
MAX_REQUEST_ITEMS = 200

# The unknown-keys warning is one record per request, bounded in size.
MAX_LOGGED_UNKNOWN_KEYS = 10
MAX_LOGGED_KEY_LENGTH = 64

# User-facing messages (es-PE) for the fields SYSPCC-026 added. DRF's defaults are
# either English ("Must be a valid boolean.") or jargon ('Clave primaria "9" inválida
# - objeto no existe.') and they reach the screen as-is.
INVENTORY_ITEM_ERRORS = {
    'does_not_exist': 'El producto del catálogo ya no existe. Búsquelo de nuevo.',
    'incorrect_type': 'Indique un producto válido del catálogo.',
}
IS_OFF_CATALOG_ERRORS = {'invalid': 'Indique verdadero o falso.'}


def _item_source_message():
    labels = [str(label) for label in ItemSourceChoices.labels]
    return 'Seleccione la fuente del ítem: {} o {}.'.format(', '.join(labels[:-1]), labels[-1])


# Built from the enum (lazily, so it follows the active language and never goes stale
# when a family is added).
ITEM_SOURCE_MESSAGE = lazy(_item_source_message, str)()
# `item_source` may be omitted or sent empty (see RequestItemCreateSerializer), but an
# unknown family or an explicit null is a mistake the person can fix.
ITEM_SOURCE_ERRORS = {'invalid_choice': ITEM_SOURCE_MESSAGE, 'null': ITEM_SOURCE_MESSAGE}
SUPPLY_SOURCE_MESSAGE = (
    'Indique el origen de atención: STOCK (atender de stock) o PURCHASE (requiere compra).'
)

# Request-scoped cache {field_name: {pk: instance}} filled by the list serializers
# below so a payload of N lines validates its catalog links with ONE query.
PREFETCHED_RELATED_CONTEXT_KEY = '_prefetched_related'


class StrictPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """
    PrimaryKeyRelatedField that refuses floats. Django coerces `get(pk=1.9)` to
    `pk=1`, so a hostile or sloppy `{"inventory_item": 1.9}` would silently link
    product 1. Booleans are already refused by the parent class.

    When the enclosing list serializer pre-fetched the related objects of the whole
    payload (see PrefetchingListSerializer) an integer id is resolved from that
    cache instead of one `get()` per line; anything else takes the normal path.
    """

    def to_internal_value(self, data):
        if isinstance(data, float):
            self.fail('incorrect_type', data_type=type(data).__name__)
        prefetched = self.context.get(PREFETCHED_RELATED_CONTEXT_KEY, {}).get(self.field_name)
        if prefetched is not None and type(data) is int:
            try:
                return prefetched[data]
            except KeyError:
                self.fail('does_not_exist', pk_value=data)
        return super().to_internal_value(data)


class PrefetchingListSerializer(serializers.ListSerializer):
    """
    ListSerializer that resolves every `inventory_item` id of the payload with a
    single query (instead of one per line) before the lines are validated.

    Only well-formed integer ids are collected; anything else (strings, floats,
    nested junk, absurdly large numbers) is left for the field to reject exactly as
    before.
    """

    prefetch_field = 'inventory_item'

    def to_internal_value(self, data):
        if isinstance(data, list):
            self._prefetch(data)
        return super().to_internal_value(data)

    def _prefetch(self, data):
        field = self.child.fields.get(self.prefetch_field)
        if field is None:
            return
        ids = {
            entry[self.prefetch_field]
            for entry in data
            if isinstance(entry, Mapping)
            and type(entry.get(self.prefetch_field)) is int
            and 0 < entry[self.prefetch_field] <= MAX_DB_INT
        }
        found = {obj.pk: obj for obj in field.get_queryset().filter(pk__in=ids)} if ids else {}
        self.context.setdefault(PREFETCHED_RELATED_CONTEXT_KEY, {})[self.prefetch_field] = found


class RequestItemCreateListSerializer(PrefetchingListSerializer):
    """
    Lines of a new request. Besides the bulk catalog lookup it reports, ONCE per
    request, the keys that are not serializer fields.

    DRF silently drops them, which hid the `stock_almacen_principal` vs
    `stock_almacen_central` mismatch for months: we keep tolerating them (old
    clients) but leave one bounded warning (at most MAX_LOGGED_UNKNOWN_KEYS keys,
    each cut to MAX_LOGGED_KEY_LENGTH characters) so a hostile payload cannot turn a
    single POST into thousands of log lines.
    """

    def to_internal_value(self, data):
        if isinstance(data, list):
            self._log_unknown_keys(data)
        return super().to_internal_value(data)

    def _log_unknown_keys(self, data):
        known = set(self.child.fields)
        sample, total, lines = set(), 0, 0
        for entry in data:
            if not isinstance(entry, Mapping):
                continue
            extra = [key for key in entry if key not in known]
            if not extra:
                continue
            lines += 1
            total += len(extra)
            for key in extra:
                if len(sample) >= MAX_LOGGED_UNKNOWN_KEYS:
                    break
                sample.add(str(key)[:MAX_LOGGED_KEY_LENGTH])
        if not total:
            return
        http_request = self.context.get('request')
        logger.warning(
            'rq.create.item_unknown_fields',
            extra={
                'unknown_fields': sorted(sample),
                'unknown_total': total,
                'lines_affected': lines,
                'user_id': getattr(getattr(http_request, 'user', None), 'id', None),
            },
        )


class RequestItemSerializer(serializers.ModelSerializer):
    """
    A request line.

    SYSPCC-026: exposes the warehouse catalog link (`inventory_item`, validated
    to exist; code/description/unit are returned flat for display), the explicit
    off-catalog mark (`is_off_catalog`, mutually exclusive with the link) and
    the family (`item_source`). `supply_source` is read-only: it is decided by
    logistics during the stock check (PATCH update-items), not by the requester.
    """

    inventory_item_code = serializers.CharField(
        source='inventory_item.product_code', read_only=True, allow_null=True,
    )
    inventory_item_description = serializers.CharField(
        source='inventory_item.description', read_only=True, allow_null=True,
    )
    inventory_item_unit = serializers.CharField(
        source='inventory_item.unit', read_only=True, allow_null=True,
    )
    item_source_display = serializers.CharField(source='get_item_source_display', read_only=True)
    # True once logistics confirmed the line's catalog decision (a product or the
    # off-catalog mark). A product proposed by the requester is NOT confirmed.
    link_confirmed = serializers.BooleanField(read_only=True)

    serializer_related_field = StrictPrimaryKeyRelatedField

    class Meta:
        model = RequestItem
        fields = [
            'id',
            'request',
            'line_number',
            'description',
            'specifications',
            'quantity',
            'unit',
            'unit_price',
            'total_price',
            'stock_almacen_obra',
            'stock_almacen_central',
            'x_atender',
            'presupuestado_adicional',
            'rfi_fwo',
            'estatus_guia',
            'supply_source',
            'inventory_item',
            'inventory_item_code',
            'inventory_item_description',
            'inventory_item_unit',
            'is_off_catalog',
            'link_confirmed',
            'item_source',
            'item_source_display',
            'comentarios',
            'created_at',
        ]
        read_only_fields = ['request', 'total_price', 'supply_source', 'created_at']
        extra_kwargs = {
            'inventory_item': {'error_messages': INVENTORY_ITEM_ERRORS},
            'is_off_catalog': {'error_messages': IS_OFF_CATALOG_ERRORS},
            'item_source': {'error_messages': ITEM_SOURCE_ERRORS},
        }

    def validate(self, attrs):
        # A line is linked to a catalog product OR explicitly off-catalog, never both.
        if attrs.get('inventory_item') is not None and attrs.get('is_off_catalog'):
            raise serializers.ValidationError({
                'is_off_catalog': (
                    'Un ítem vinculado a un producto del catálogo no puede marcarse como '
                    'fuera de catálogo.'
                ),
            })
        return attrs


class RequestItemCreateSerializer(RequestItemSerializer):
    """
    Line payload when creating a request. The quantity must be greater than zero.

    `item_source` (the family), the catalog product and the off-catalog mark are
    optional at the API level: integrations, old clients and historical data may send
    none of them (orchestrator decisions 2 and 3 of SYSPCC-026), and creating an RQ is
    the first action of the management-defined flow, so it must not start failing for
    them. The new screen requires them. When `item_source` IS sent it must be one of
    the families (an unknown value is a 400). The product or the off-catalog mark is
    only a PROPOSAL: logistics confirms it later (`link_confirmed`).
    """

    class Meta(RequestItemSerializer.Meta):
        list_serializer_class = RequestItemCreateListSerializer
        extra_kwargs = {
            **RequestItemSerializer.Meta.extra_kwargs,
            'quantity': {
                'min_value': Decimal('0.001'),
                'error_messages': {'min_value': 'La cantidad debe ser mayor que cero.'},
            },
        }


class UpdateItemPayloadSerializer(serializers.Serializer):
    """
    One line of the update-items payload (logistics, stock check). Only the keys
    present are applied. `inventory_item` accepts null to drop the link;
    `is_off_catalog` and a non-null `inventory_item` are mutually exclusive.

    SYSPCC-011 FIX 2: validates types so a malformed body returns 400 instead of
    reaching the database layer.
    """

    UPDATABLE_FIELDS = ('supply_source', 'inventory_item', 'is_off_catalog', 'item_source')

    class Meta:
        list_serializer_class = PrefetchingListSerializer

    # Bounded to the 64-bit range of the primary keys: beyond it the number is not an
    # id and reaching the database with it raises OverflowError (HTTP 500).
    item_id = serializers.IntegerField(min_value=MIN_DB_INT, max_value=MAX_DB_INT)
    supply_source = serializers.ChoiceField(
        choices=RequestItem._meta.get_field('supply_source').choices,
        required=False,
        error_messages={'invalid_choice': SUPPLY_SOURCE_MESSAGE},
    )
    inventory_item = StrictPrimaryKeyRelatedField(
        queryset=Inventory.objects.all(), required=False, allow_null=True,
        error_messages=INVENTORY_ITEM_ERRORS,
    )
    is_off_catalog = serializers.BooleanField(
        required=False, error_messages=IS_OFF_CATALOG_ERRORS,
    )
    item_source = serializers.ChoiceField(
        choices=ItemSourceChoices.choices, required=False, allow_blank=True,
        error_messages=ITEM_SOURCE_ERRORS,
    )

    def validate(self, attrs):
        if not any(name in attrs for name in self.UPDATABLE_FIELDS):
            raise serializers.ValidationError(
                'Indique al menos un campo a actualizar: origen de atención, producto de '
                'catálogo, fuera de catálogo o fuente.'
            )
        if attrs.get('inventory_item') is not None and attrs.get('is_off_catalog'):
            raise serializers.ValidationError({
                'is_off_catalog': (
                    'Un ítem vinculado a un producto del catálogo no puede marcarse como '
                    'fuera de catálogo.'
                ),
            })
        return attrs


class UpdateItemsSerializer(serializers.Serializer):
    """
    Payload for PATCH /api/v1/requests/{id}/update-items/.

    The stock-check screen sends every line of the RQ in one PATCH. `MAX_ITEMS` bounds a
    hostile payload, but it must never reject a legitimate one: develop had no cap and an
    RQ created before the 200-line creation limit can carry more than `MAX_ITEMS` lines.
    The view therefore passes the RQ's own number of lines as `line_count` and the cap
    becomes `max(MAX_ITEMS, line_count)`: a payload cannot have more distinct, valid ids
    than the RQ has lines (repeated ids are rejected below, foreign ones are ignored).
    """

    MAX_ITEMS = 500

    items = UpdateItemPayloadSerializer(
        many=True,
        max_length=MAX_ITEMS,
        error_messages={
            'max_length': 'Se pueden actualizar como máximo {max_length} ítems por solicitud.',
        },
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        line_count = self.context.get('line_count') or 0
        self.fields['items'].max_length = max(self.MAX_ITEMS, line_count)

    def validate_items(self, value):
        item_ids = [entry['item_id'] for entry in value]
        if len(item_ids) != len(set(item_ids)):
            raise serializers.ValidationError('Hay ítems repetidos en los datos enviados.')
        return value


class RequestListSerializer(serializers.ModelSerializer):
    """Compact serializer for list views."""

    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    flow_display = serializers.CharField(source='get_flow_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    acquisition_type_display = serializers.CharField(source='get_acquisition_type_display', read_only=True)
    requesting_area_display = serializers.CharField(source='get_requesting_area_display', read_only=True)
    project_code = serializers.CharField(source='project.code', read_only=True, allow_null=True)
    project_name = serializers.CharField(source='project.name', read_only=True, allow_null=True)
    department_code = serializers.CharField(source='department.code', read_only=True, allow_null=True)
    department_name = serializers.CharField(source='department.name', read_only=True, allow_null=True)

    class Meta:
        model = Request
        fields = [
            'id',
            'rq_number',
            'flow',
            'flow_display',
            'requesting_area',
            'requesting_area_display',
            'description',
            'project',
            'project_code',
            'project_name',
            'department',
            'department_code',
            'department_name',
            'requested_by',
            'requested_by_name',
            'acquisition_type',
            'acquisition_type_display',
            'priority',
            'priority_display',
            'status',
            'status_display',
            'estimated_cost',
            'fecha_necesidad',
            'fecha_estimada_entrega',
            'created_at',
        ]


class RequestDetailSerializer(serializers.ModelSerializer):
    """Full detail serializer with nested items."""

    items = RequestItemSerializer(many=True, read_only=True)
    requested_by_detail = UserListSerializer(source='requested_by', read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    flow_display = serializers.CharField(source='get_flow_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    acquisition_type_display = serializers.CharField(source='get_acquisition_type_display', read_only=True)
    budget_classification_display = serializers.CharField(
        source='get_budget_classification_display', read_only=True, allow_null=True
    )
    requesting_area_display = serializers.CharField(source='get_requesting_area_display', read_only=True)
    project_code = serializers.CharField(source='project.code', read_only=True, allow_null=True)
    project_name = serializers.CharField(source='project.name', read_only=True, allow_null=True)
    project_frente = serializers.CharField(source='project.frente', read_only=True, allow_null=True)
    department_code = serializers.CharField(source='department.code', read_only=True, allow_null=True)
    department_name = serializers.CharField(source='department.name', read_only=True, allow_null=True)
    is_terminal = serializers.BooleanField(read_only=True)
    total_items_cost = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = Request
        fields = [
            'id',
            'rq_number',
            'flow',
            'flow_display',
            'project',
            'project_code',
            'project_name',
            'project_frente',
            'department',
            'department_code',
            'department_name',
            'requested_by',
            'requested_by_name',
            'requested_by_detail',
            'requesting_area',
            'requesting_area_display',
            'front_area',
            'service',
            'specific_use',
            'description',
            'justification',
            'acquisition_type',
            'acquisition_type_display',
            'priority',
            'priority_display',
            'status',
            'status_display',
            'current_step',
            'budget_classification',
            'budget_classification_display',
            'budget_line',
            'annual_plan_line',
            'estimated_cost',
            'final_cost',
            'fecha_necesidad',
            'fecha_estimada_entrega',
            'fecha_real_entrega',
            'is_terminal',
            'total_items_cost',
            'items',
            'created_at',
            'updated_at',
        ]
        # FIX-17: requested_by must not be writable via the API to prevent
        # request ownership spoofing.
        read_only_fields = ['rq_number', 'status', 'current_step', 'requested_by', 'created_at', 'updated_at']


class RequestCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a new request (DRAFT status)."""

    items = RequestItemCreateSerializer(
        many=True,
        allow_empty=False,
        max_length=MAX_REQUEST_ITEMS,
        error_messages={
            'empty': 'Agregue al menos un ítem al requerimiento.',
            'max_length': 'Un requerimiento admite como máximo {max_length} ítems.',
        },
    )

    class Meta:
        model = Request
        fields = [
            'rq_number',
            'flow',
            'project',
            'department',
            'requesting_area',
            'front_area',
            'service',
            'specific_use',
            'description',
            'justification',
            'acquisition_type',
            'priority',
            'budget_line',
            'annual_plan_line',
            'estimated_cost',
            'fecha_necesidad',
            'items',
        ]
        # SYSPCC-007: rq_number is generated server-side (RQNumberGenerator, which
        # locks the latest RQ row). Making it read-only closes the TOCTOU window where
        # a client-supplied number could collide with one generated concurrently, and
        # stops clients from spoofing/forging the RQ number.
        read_only_fields = ['rq_number']
        # SYSPCC-026: the area (OP/QC/HSE/ADM) is mandatory when creating an RQ.
        # It stays optional on the model so historical RQs remain valid.
        extra_kwargs = {'requesting_area': {'required': True, 'allow_blank': False}}

    def validate(self, attrs):
        flow = attrs.get('flow')
        if flow == 'OPERATIONS' and not attrs.get('project'):
            raise serializers.ValidationError({'project': 'El flujo Operaciones requiere un proyecto.'})
        if flow == 'ADMINISTRATIVE' and not attrs.get('department'):
            raise serializers.ValidationError({'department': 'El flujo Administración requiere un departamento.'})
        # SYSPCC-019: el frente "Oficina Central" siempre debe registrarse por
        # el flujo Administración (regla unidireccional — ver handoff FASE 0).
        front_area = (attrs.get('front_area') or '').strip().upper()
        if front_area == OFICINA_CENTRAL_FRENTE and flow != 'ADMINISTRATIVE':
            raise serializers.ValidationError({
                'flow': 'El frente "Oficina Central" debe registrarse por el flujo de Administración.',
            })
        return attrs

    def create(self, validated_data):
        from apps.rq.models import Approval
        from apps.rq.services.number_generator import RQNumberGenerator

        items_data = validated_data.pop('items', [])
        user = self.context['request'].user
        validated_data.pop('rq_number', None)  # ignore any client-supplied value
        validated_data['requested_by'] = user
        validated_data['status'] = 'SUBMITTED'

        try:
            with transaction.atomic():
                # RQNumberGenerator.generate() locks the latest RQ row for the
                # current year (select_for_update) so two concurrent submissions
                # cannot compute the same rq_number.
                validated_data['rq_number'] = RQNumberGenerator.generate()
                request_obj = Request.objects.create(**validated_data)

                created_items = []
                for idx, item_data in enumerate(items_data, start=1):
                    item_data['line_number'] = idx
                    created_items.append(RequestItem.objects.create(request=request_obj, **item_data))

                # A product picked by the requester is only a proposal (nothing is
                # confirmed at creation): leave the trail for logistics to review.
                log_proposed_catalog_links(request_obj, created_items, user)

                # Register the submission in the approval chain
                Approval.objects.create(
                    request=request_obj,
                    action='SUBMITTED',
                    performed_by=user,
                    role=user.user_roles.first().role if user.user_roles.exists() else 'REQUESTER',
                    previous_status='DRAFT',
                    new_status='SUBMITTED',
                    comments='Requerimiento enviado para revisión.',
                )
        except IntegrityError:
            # Last barrier: the DB-level unique constraint on rq_number caught a
            # collision the lock should have prevented (or an item/approval FK
            # violation). Nothing was persisted — the atomic block rolled back.
            logger.warning(
                'request.create.integrity_error', extra={'user_id': getattr(user, 'id', None)},
            )
            raise serializers.ValidationError(
                {'rq_number': 'No se pudo generar el número de requerimiento, intente nuevamente.'}
            )

        # The 201 body serializes every line with its product code/description: load
        # them in two queries instead of one per line.
        prefetch_related_objects([request_obj], 'items__inventory_item')
        return request_obj
