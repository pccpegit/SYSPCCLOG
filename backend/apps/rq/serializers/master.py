"""
Serializers del Master de RQ (SYSPCC-030).

* `MasterQuerySerializer`: valida los parámetros de consulta (un valor inválido responde 400
  con el sobre de error del proyecto en vez de devolver un listado vacío).
* `AttentionOverrideSerializer`: cuerpo de POST/PATCH que fija o quita STAND BY / DESESTIMADO.
* `MasterRowSerializer` / `MasterSummaryRowSerializer`: forma de las respuestas (de solo
  lectura). No incluyen precios ni costos ni datos de trabajadores.
"""
from rest_framework import serializers

from apps.core.enums import (
    AttentionOverrideChoices,
    ItemSourceChoices,
    RequestingAreaChoices,
    RQFlowChoices,
    RQStatusChoices,
)
from apps.rq.services import item_tracking as rules
from apps.rq.services import request_master as master

NOTE_MAX_LENGTH = 300


def _choices(values, labels=None):
    return [(value, (labels or {}).get(value, value)) for value in values]


class MasterQuerySerializer(serializers.Serializer):
    project = serializers.IntegerField(required=False, min_value=1)
    department = serializers.IntegerField(required=False, min_value=1)
    flow = serializers.ChoiceField(choices=RQFlowChoices.choices, required=False)
    area = serializers.ChoiceField(
        choices=[*RequestingAreaChoices.choices, (master.NO_VALUE, 'Sin área')], required=False,
    )
    source = serializers.ChoiceField(
        choices=[*ItemSourceChoices.choices, (master.NO_VALUE, 'Sin fuente')], required=False,
    )
    item_status = serializers.ChoiceField(
        choices=_choices(rules.ITEM_STATUS_CHOICES, rules.ITEM_STATUS_LABELS), required=False,
    )
    tracking = serializers.ChoiceField(
        choices=_choices(rules.TRACKING_CHOICES, rules.TRACKING_LABELS), required=False,
    )
    alert = serializers.ChoiceField(
        choices=_choices(rules.ALERT_CHOICES, rules.ALERT_LABELS), required=False,
    )
    stage = serializers.ChoiceField(
        choices=[(stage.code, stage.label) for stage in rules.STAGES], required=False,
    )
    status = serializers.ChoiceField(choices=RQStatusChoices.choices, required=False)
    requested_by = serializers.IntegerField(required=False, min_value=1)
    request = serializers.IntegerField(required=False, min_value=1)
    approved_from = serializers.DateField(required=False)
    approved_to = serializers.DateField(required=False)
    attended_from = serializers.DateField(required=False)
    attended_to = serializers.DateField(required=False)
    with_shortage = serializers.BooleanField(required=False)
    with_alerts = serializers.BooleanField(required=False)
    search = serializers.CharField(required=False, allow_blank=True, max_length=100, trim_whitespace=True)
    ordering = serializers.CharField(required=False, allow_blank=True, max_length=40)

    # Se fija por vista: el listado y el resumen aceptan columnas de orden distintas.
    ordering_fields = master.ITEM_ORDERING_FIELDS

    def validate_ordering(self, value):
        if value and value.lstrip('-') not in self.ordering_fields:
            allowed = ', '.join(self.ordering_fields)
            raise serializers.ValidationError(f'Orden no válido. Use uno de: {allowed} (prefijo «-» para descendente).')
        return value

    def validate(self, attrs):
        for start, end, label in (
            ('approved_from', 'approved_to', 'aprobación'),
            ('attended_from', 'attended_to', 'atención'),
        ):
            if attrs.get(start) and attrs.get(end) and attrs[start] > attrs[end]:
                raise serializers.ValidationError(
                    {end: f'La fecha final de {label} no puede ser anterior a la inicial.'}
                )
        return attrs


class SummaryQuerySerializer(MasterQuerySerializer):
    ordering_fields = master.SUMMARY_ORDERING_FIELDS


class AttentionOverrideSerializer(serializers.Serializer):
    """
    `override`: STAND_BY o DESESTIMADO para fijar; vacío o null para quitar el seguimiento manual.
    `note`: motivo, obligatorio al fijar (máx. 300 caracteres); opcional al quitar.
    """

    override = serializers.ChoiceField(
        choices=AttentionOverrideChoices.choices, allow_blank=True, allow_null=True,
    )
    note = serializers.CharField(
        required=False, allow_blank=True, max_length=NOTE_MAX_LENGTH, trim_whitespace=True,
    )

    def validate(self, attrs):
        attrs['override'] = attrs.get('override') or ''
        attrs['note'] = attrs.get('note', '')
        if attrs['override'] and not attrs['note']:
            raise serializers.ValidationError({'note': 'Indique el motivo para fijar el seguimiento manual.'})
        return attrs


# ───────────────────────────── respuestas (solo lectura) ─────────────────────────────

class _AlertSerializer(serializers.Serializer):
    code = serializers.CharField()
    label = serializers.CharField()


class _RQProgressSerializer(serializers.Serializer):
    percent = serializers.FloatField(allow_null=True)
    items_total = serializers.IntegerField()
    items_counted = serializers.IntegerField()
    items_attended = serializers.IntegerField()
    items_partial = serializers.IntegerField()
    items_pending = serializers.IntegerField()
    items_stand_by = serializers.IntegerField()
    items_unlinked = serializers.IntegerField()
    items_discarded = serializers.IntegerField()
    items_voided = serializers.IntegerField()


class _DeliverySerializer(serializers.Serializer):
    dispatch_id = serializers.IntegerField()
    dispatch_number = serializers.CharField(allow_blank=True)
    date = serializers.DateField(allow_null=True)
    guide = serializers.CharField(allow_blank=True)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3)
    is_reversal = serializers.BooleanField()
    responsible = serializers.CharField(allow_blank=True)


class MasterRowSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    request_id = serializers.IntegerField()
    rq_number = serializers.CharField()
    line_number = serializers.IntegerField()
    flow = serializers.CharField()
    flow_label = serializers.CharField()
    project_id = serializers.IntegerField(allow_null=True)
    project_code = serializers.CharField(allow_blank=True)
    project_name = serializers.CharField(allow_blank=True)
    department_id = serializers.IntegerField(allow_null=True)
    department_name = serializers.CharField(allow_blank=True)
    origin = serializers.CharField(allow_blank=True)
    requesting_area = serializers.CharField(allow_blank=True)
    requesting_area_label = serializers.CharField()
    description = serializers.CharField()
    unit = serializers.CharField()
    product_code = serializers.CharField(allow_blank=True)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3)
    quantity_attended = serializers.DecimalField(max_digits=14, decimal_places=3)
    quantity_missing = serializers.DecimalField(max_digits=14, decimal_places=3, allow_null=True)
    central_stock = serializers.DecimalField(max_digits=14, decimal_places=3)
    central_stock_is_live = serializers.BooleanField()
    item_source = serializers.CharField(allow_blank=True)
    item_source_label = serializers.CharField(allow_blank=True)
    priority = serializers.CharField()
    priority_label = serializers.CharField()
    requested_by_id = serializers.IntegerField()
    requested_by_name = serializers.CharField(allow_blank=True)
    approval_date = serializers.DateField(allow_null=True)
    need_date = serializers.DateField(allow_null=True)
    attended_date = serializers.DateField(allow_null=True)
    last_delivery_date = serializers.DateField(allow_null=True)
    status = serializers.CharField()
    status_label = serializers.CharField()
    tracking = serializers.CharField()
    tracking_label = serializers.CharField()
    link_proposed = serializers.BooleanField()
    attended_by_flow = serializers.BooleanField()
    guides = serializers.ListField(child=serializers.CharField())
    guide_text = serializers.CharField(allow_blank=True)
    attention_responsible = serializers.CharField(allow_blank=True)
    comments = serializers.CharField(allow_blank=True)
    attention_override = serializers.CharField(allow_blank=True)
    attention_override_label = serializers.CharField(allow_blank=True)
    attention_note = serializers.CharField(allow_blank=True)
    can_set_override = serializers.BooleanField()
    budget_type = serializers.CharField(allow_blank=True)
    budget_classification = serializers.CharField(allow_blank=True)
    budget_classification_label = serializers.CharField(allow_blank=True)
    gm_approval = serializers.CharField()
    gm_approval_label = serializers.CharField()
    gm_approval_kind = serializers.CharField(allow_blank=True)
    gm_approval_kind_label = serializers.CharField(allow_blank=True)
    stage = serializers.CharField()
    stage_label = serializers.CharField()
    phase = serializers.IntegerField(allow_null=True)
    rq_status = serializers.CharField()
    rq_status_label = serializers.CharField()
    alerts = _AlertSerializer(many=True)
    rq_progress = _RQProgressSerializer(allow_null=True)
    deliveries = _DeliverySerializer(many=True)


class MasterSummaryRowSerializer(serializers.Serializer):
    request_id = serializers.IntegerField()
    rq_number = serializers.CharField()
    flow = serializers.CharField()
    flow_label = serializers.CharField()
    project_id = serializers.IntegerField(allow_null=True)
    project_code = serializers.CharField(allow_blank=True)
    project_name = serializers.CharField(allow_blank=True)
    department_id = serializers.IntegerField(allow_null=True)
    department_name = serializers.CharField(allow_blank=True)
    origin = serializers.CharField(allow_blank=True)
    requesting_area = serializers.CharField(allow_blank=True)
    requesting_area_label = serializers.CharField()
    priority = serializers.CharField()
    priority_label = serializers.CharField()
    requested_by_id = serializers.IntegerField()
    requested_by_name = serializers.CharField(allow_blank=True)
    approval_date = serializers.DateField(allow_null=True)
    need_date = serializers.DateField(allow_null=True)
    rq_status = serializers.CharField()
    rq_status_label = serializers.CharField()
    stage = serializers.CharField()
    stage_label = serializers.CharField()
    phase = serializers.IntegerField(allow_null=True)
    is_open = serializers.BooleanField()
    gm_approval = serializers.CharField()
    gm_approval_label = serializers.CharField()
    gm_approval_kind = serializers.CharField(allow_blank=True)
    gm_approval_kind_label = serializers.CharField(allow_blank=True)
    percent = serializers.FloatField(allow_null=True)
    items_total = serializers.IntegerField()
    items_counted = serializers.IntegerField()
    items_attended = serializers.IntegerField()
    items_partial = serializers.IntegerField()
    items_pending = serializers.IntegerField()
    items_stand_by = serializers.IntegerField()
    items_unlinked = serializers.IntegerField()
    items_discarded = serializers.IntegerField()
    items_voided = serializers.IntegerField()
