"""
Cantidad entregada de un ítem de RQ (SYSPCC-029).

Regla única: lo entregado = suma de `WarehouseDispatchItem.quantity_dispatched` de las
entregas normales MENOS la suma de las de las reversas (`WarehouseDispatch.reverses` no nulo).
No hay caché ni columna calculada: toda lectura de "lo ya entregado" pasa por aquí.
"""
from decimal import Decimal

from django.db.models import DecimalField, Q, Sum, Value
from django.db.models.functions import Coalesce

_ZERO = Decimal('0')
_QUANTITY = DecimalField(max_digits=14, decimal_places=3)


def net_dispatched_expression(prefix: str = 'dispatch_items__'):
    """
    Expresión de agregado (entregas − reversas) para usar en `annotate()`.

    `prefix` es la ruta hasta `WarehouseDispatchItem`: `'dispatch_items__'` desde
    `RequestItem`, `''` desde `WarehouseDispatchItem`.
    """
    def _sum(is_reversal: bool):
        return Coalesce(
            Sum(
                f'{prefix}quantity_dispatched',
                filter=Q(**{f'{prefix}dispatch__reverses__isnull': not is_reversal}),
                output_field=_QUANTITY,
            ),
            Value(_ZERO, output_field=_QUANTITY),
            output_field=_QUANTITY,
        )

    return _sum(False) - _sum(True)


def net_dispatched_by_item(request_item_ids=None, *, request=None) -> dict:
    """
    {request_item_id: Decimal} entregado neto. Los ítems sin entregas no aparecen (0).

    Se filtra por `request_item_ids` y/o por `request` (el RQ completo).
    """
    from apps.warehouse.models import WarehouseDispatchItem

    qs = WarehouseDispatchItem.objects.all()
    if request is not None:
        qs = qs.filter(request_item__request=request)
    if request_item_ids is not None:
        qs = qs.filter(request_item_id__in=list(request_item_ids))
    rows = qs.values('request_item_id').annotate(net=net_dispatched_expression(prefix=''))
    return {row['request_item_id']: row['net'] for row in rows}
