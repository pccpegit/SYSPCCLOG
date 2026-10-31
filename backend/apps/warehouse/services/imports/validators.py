"""
Row validation of the inventory workbook with DRF serializers (SYSPCC-025).

Each serializer receives the raw cell values of one row (``parser.RawRow.values``)
and returns clean Python values. Error ``code`` s match the importer problem codes
(``CANTIDAD_VACIA``, ``FECHA_INVALIDA``...). Error messages never echo the cell
content: a cell may hold a worker's name.
"""
import logging
import math
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.utils import timezone
from openpyxl.utils.datetime import from_excel
from rest_framework import serializers

from apps.warehouse.services import catalog
from apps.warehouse.services.imports.problems import CATALOG as PROBLEM_CODES

logger = logging.getLogger(__name__)

_QUANT = Decimal('0.001')
_MAX_QUANTITY = Decimal('999999999.999')      # DecimalField(max_digits=12, decimal_places=3)
_MIN_SERIAL = 36526                            # 2000-01-01
_MAX_SERIAL = 73050                            # 2099-12-31
_DATE_FORMATS = ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%d/%m/%y')


def _is_empty(value) -> bool:
    return value is serializers.empty or value is None or (isinstance(value, str) and not value.strip())


def number_as_text(value, decimals: int | None = None) -> str:
    """
    Text of a numeric cell: ``120`` -> '120', ``120.0`` -> '120', ``1.02`` -> '1.02'.
    With ``decimals`` non-integer floats are fixed to that many places (OC 1.1 -> '1.10').
    """
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            # ``<v>1E999</v>`` is infinity for openpyxl: it has no text form.
            raise serializers.ValidationError('El valor numérico no es válido.', code='FILA_INVALIDA')
        dec = Decimal(repr(value))
        if dec == dec.to_integral_value():
            return str(int(dec))
        if decimals is not None and -dec.as_tuple().exponent <= decimals:
            return f'{dec:.{decimals}f}'
        return format(dec.normalize(), 'f')
    return str(value)


def _without_article(label: str) -> str:
    """'La descripción' -> 'descripción': the label inside a sentence that has its own wording."""
    head, _, tail = label.partition(' ')
    if tail and head.lower() in {'el', 'la', 'los', 'las'}:
        return tail.lower() if not tail.isupper() else tail
    return label


class ExcelText(serializers.Field):
    """Free text (strip + length check). Numbers are rendered without a stray '.0'."""

    def __init__(self, *, max_length=None, decimals=None, label='El campo', **kwargs):
        self.max_length = max_length
        self.decimals = decimals
        # NOT ``self.label``: DRF's ``Field.__init__`` resets it and ``bind()`` fills it with the
        # attribute name ('Location', 'Observation'), so every message used to name an English
        # attribute instead of the column the user knows.
        self.column_label = label
        super().__init__(required=False, **kwargs)

    def run_validation(self, data=serializers.empty):
        if _is_empty(data):
            return ''
        if isinstance(data, (datetime, date)):
            raise serializers.ValidationError(f'{self.column_label} no tiene un formato válido.', code='FILA_INVALIDA')
        text = number_as_text(data, self.decimals).strip()
        if self.max_length and len(text) > self.max_length:
            raise serializers.ValidationError(
                f'{self.column_label} supera los {self.max_length} caracteres.', code='FILA_INVALIDA',
            )
        return text

    def to_representation(self, value):  # pragma: no cover - the serializers are input only
        return value


class RequiredText(ExcelText):
    """Text that must not be empty; ``empty_code`` is the problem code raised."""

    def __init__(self, *, empty_code='FILA_INVALIDA', empty_message=None, **kwargs):
        self.empty_code = empty_code
        self.empty_message = empty_message
        super().__init__(**kwargs)

    def run_validation(self, data=serializers.empty):
        if _is_empty(data):
            raise serializers.ValidationError(
                self.empty_message or f'Falta un dato obligatorio ({_without_article(self.column_label)}).',
                code=self.empty_code,
            )
        return super().run_validation(data)


class CodeField(serializers.Field):
    """Item code, normalized (strip + upper)."""

    def __init__(self, **kwargs):
        super().__init__(required=False, **kwargs)

    def run_validation(self, data=serializers.empty):
        if _is_empty(data):
            raise serializers.ValidationError('La fila no tiene código de ítem.', code='ITEM_VACIO')
        if isinstance(data, (datetime, date)):
            raise serializers.ValidationError('El código de ítem no es válido.', code='FILA_INVALIDA')
        code = catalog.normalize_product_code(data)
        if len(code) > 50:
            raise serializers.ValidationError('El código de ítem supera los 50 caracteres.', code='FILA_INVALIDA')
        if code.startswith(('=', '+', '-', '@')):
            # defence in depth: a code is copied into many exports, a formula must never reach one
            raise serializers.ValidationError(
                'El código de ítem no puede empezar con =, +, - o @.', code='FILA_INVALIDA',
            )
        return code

    def to_representation(self, value):  # pragma: no cover
        return value


class QuantityField(serializers.Field):
    """
    Positive (or non-negative) quantity with at most 3 decimals.

    ``required=True`` -> an empty cell raises ``CANTIDAD_VACIA``; otherwise it is ``None``.
    ``allow_zero`` is for the summary sheet (INV. INICIAL / STOCK ACTUAL can be 0).
    """

    def __init__(self, *, required_quantity=True, allow_zero=False, **kwargs):
        self.required_quantity = required_quantity
        self.allow_zero = allow_zero
        super().__init__(required=False, **kwargs)

    def run_validation(self, data=serializers.empty):
        if _is_empty(data):
            if self.required_quantity:
                raise serializers.ValidationError('La cantidad está vacía.', code='CANTIDAD_VACIA')
            return None
        invalid = serializers.ValidationError(
            'La cantidad no es válida: debe ser un número mayor que cero con hasta 3 decimales.',
            code='CANTIDAD_INVALIDA',
        )
        if isinstance(data, (bool, datetime, date)):
            raise invalid
        try:
            if isinstance(data, float):
                if math.isnan(data) or math.isinf(data):
                    raise invalid
                value = Decimal(repr(data))
            elif isinstance(data, (int, Decimal)):
                value = Decimal(data)
            elif isinstance(data, str):
                text = data.strip()
                if not text.replace('.', '', 1).isdigit():       # no commas, signs, letters, exponents
                    raise invalid
                value = Decimal(text)
            else:
                raise invalid
        except (InvalidOperation, ValueError):
            raise invalid from None
        if not value.is_finite():
            raise invalid
        # Bound BEFORE quantizing: ``quantize`` raises InvalidOperation when the result needs
        # more than the context precision (28 digits), e.g. 1E+30 typed by mistake in Excel.
        if abs(value) > _MAX_QUANTITY:
            raise invalid
        try:
            rounded = value.quantize(_QUANT)
        except InvalidOperation:
            raise invalid from None
        if abs(value - rounded) > Decimal('0.0000001'):          # more than 3 real decimals
            raise invalid
        if rounded < 0 or (rounded == 0 and not self.allow_zero):
            raise invalid
        return rounded

    def to_representation(self, value):  # pragma: no cover
        return value


class ExcelDateField(serializers.Field):
    """
    Operational date. Empty -> ``None`` (the planner reports ``FECHA_VACIA``).
    Accepts date/datetime cells, ISO / dd/mm/aaaa text and Excel serial numbers.
    Future dates (America/Lima) are rejected with ``FECHA_FUTURA``.
    """

    def __init__(self, **kwargs):
        super().__init__(required=False, **kwargs)

    def run_validation(self, data=serializers.empty):
        if _is_empty(data):
            return None
        bad = serializers.ValidationError('La fecha no es válida.', code='FECHA_INVALIDA')
        if isinstance(data, datetime):
            value = data.date()
        elif isinstance(data, date):
            value = data
        elif isinstance(data, (int, float)) and not isinstance(data, bool):
            if not _MIN_SERIAL <= data <= _MAX_SERIAL:
                raise bad
            try:
                value = from_excel(data).date()
            except (ValueError, OverflowError, TypeError):
                raise bad from None
        elif isinstance(data, str):
            value = None
            for fmt in _DATE_FORMATS:
                try:
                    value = datetime.strptime(data.strip(), fmt).date()
                    break
                except ValueError:
                    continue
            if value is None:
                raise bad
        else:
            raise bad
        if not 2000 <= value.year <= 2099:
            raise bad
        if value > timezone.localdate():
            raise serializers.ValidationError('La fecha es posterior a hoy.', code='FECHA_FUTURA')
        return value

    def to_representation(self, value):  # pragma: no cover
        return value


class AnyCell(serializers.Field):
    """Accepts anything (used for columns that are read but ignored)."""

    def __init__(self, **kwargs):
        super().__init__(required=False, **kwargs)

    def run_validation(self, data=serializers.empty):
        return None if _is_empty(data) else data

    def to_representation(self, value):  # pragma: no cover
        return value


# ---------------------------------------------------------------------------
# Row serializers
# ---------------------------------------------------------------------------

class CatalogRowSerializer(serializers.Serializer):
    """MATRIZ DE RECURSOS."""

    order_number = ExcelText(max_length=50, label='El número de orden')
    product_code = CodeField()
    description = RequiredText(max_length=300, label='La descripción')
    unit = RequiredText(max_length=30, label='La unidad')
    purchase_order_ref = ExcelText(max_length=30, decimals=2, label='La OC')
    packing_list = ExcelText(max_length=50, label='El packing list')
    shipment_quantity = AnyCell()


class SummaryRowSerializer(serializers.Serializer):
    """RESUMEN DE MOVIMIENTO. ``description``/``unit`` are required only when it is the catalog."""

    product_code = CodeField()
    description = ExcelText(max_length=300, label='La descripción')
    unit = ExcelText(max_length=30, label='La unidad')
    initial = QuantityField(required_quantity=False, allow_zero=True)
    entries = QuantityField(required_quantity=False, allow_zero=True)
    exits = QuantityField(required_quantity=False, allow_zero=True)
    stock = QuantityField(required_quantity=False, allow_zero=True)
    location = ExcelText(max_length=100, label='La columna LOCACIÓN')
    observation = ExcelText(max_length=300, label='La observación')
    project = ExcelText(max_length=100, label='El proyecto')


class SummaryCatalogRowSerializer(SummaryRowSerializer):
    description = RequiredText(max_length=300, label='La descripción')
    unit = RequiredText(max_length=30, label='La unidad')


class EntryRowSerializer(serializers.Serializer):
    """INGRESOS."""

    date = ExcelDateField()
    tag = ExcelText(max_length=50, label='El TAG')
    product_code = CodeField()
    quantity = QuantityField()
    location = ExcelText(max_length=100, label='La columna LOCACIÓN')
    po_number = ExcelText(max_length=50, decimals=2, label='El PO')
    guide_number = ExcelText(max_length=50, label='La guía de remisión')
    internal_transfer = ExcelText(max_length=100, label='La transferencia interna')
    observation = ExcelText(max_length=500, label='La observación')


class ExitRowSerializer(serializers.Serializer):
    """EGRESOS."""

    voucher = ExcelText(max_length=30, label='El N° de vale')
    date = ExcelDateField()
    product_code = CodeField()
    quantity = QuantityField()
    location = ExcelText(max_length=100, label='La columna LOCACIÓN')
    internal_transfer = ExcelText(max_length=100, label='La transferencia interna')
    # Optional on purpose (SYSPCC-032): the goods did leave, so an exit without USUARIO/DESTINO is
    # imported as "Sin destino" with a DESTINO_VACIO warning instead of being skipped.
    destination = ExcelText(max_length=200, label='El usuario/destino')
    observation = ExcelText(max_length=500, label='La observación')


def validate_row(serializer_class, values: dict):
    """
    Validate one raw row. Returns ``(clean_data, errors)`` where ``errors`` is a list of
    ``(problem_code, detail)``; ``clean_data`` is None when there are errors.
    """
    try:
        serializer = serializer_class(data=values)
        if serializer.is_valid():
            return dict(serializer.validated_data), []
    except (ArithmeticError, ValueError, TypeError) as exc:
        # Last barrier: a hostile cell (huge or non-finite number, absurd text) must become a
        # skipped row, never a 500 that hides the reason from whoever uploaded the workbook.
        # Only the exception TYPE is logged: the message may quote the cell, i.e. a name.
        logger.warning(
            'warehouse.import.row_validation_failed',
            extra={'serializer': serializer_class.__name__, 'error_type': type(exc).__name__},
        )
        return None, [('FILA_INVALIDA', 'La fila contiene un valor que no se puede procesar.')]
    errors = []
    for details in serializer.errors.values():
        for detail in details:
            code = getattr(detail, 'code', None)
            if code not in PROBLEM_CODES:
                code = 'FILA_INVALIDA'
            errors.append((code, str(detail)))
    return None, errors
