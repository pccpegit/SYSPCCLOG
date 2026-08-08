"""
Business-logic services for the Administración — Pasajes module.

Keeps calculation and query logic out of views and serializers.
"""

from decimal import Decimal, ROUND_HALF_UP

from apps.administracion.models import Pasaje, PoliticaPasajeDevoluciones


# ---------------------------------------------------------------------------
# Devolution calculation
# ---------------------------------------------------------------------------

# Fallback exchange rate used ONLY when a USD-only policy must be converted
# and no tipo_cambio is provided by the caller.
_FALLBACK_TIPO_CAMBIO = Decimal('3.5')


def calcular_devolucion(
    monto_pasaje: Decimal,
    moneda: str,
    tipo_cambio: Decimal,
    politica: PoliticaPasajeDevoluciones,
) -> Decimal:
    """
    Calculate the devolution amount (in PEN) for a ticket given a refund policy.

    Rules:
    - If the policy has `no_devolucion=True`, return 0.
    - Soles ticket:
        * If the policy has monto_soles > 0 → devolucion = min(monto_pasaje, monto_soles)
        * If the policy only has monto_dolares → convert that to soles using tipo_cambio
          (fallback 3.5 if not provided) then apply min().
    - Dollar ticket:
        * Convert monto_pasaje to soles: monto_soles_equiv = monto_pasaje * tipo_cambio
        * Policy limit in soles = politica.monto_dolares * tipo_cambio  (or monto_soles directly)
        * devolucion = min(monto_soles_equiv, policy_soles_limit)

    Returns the devolution amount in PEN (Decimal, 2 decimals).
    """
    if politica.no_devolucion:
        return Decimal('0.00')

    tc = Decimal(str(tipo_cambio)) if tipo_cambio else _FALLBACK_TIPO_CAMBIO
    monto = Decimal(str(monto_pasaje))

    if moneda == 'SOLES':
        # Policy limit in soles
        if politica.monto_soles and politica.monto_soles > 0:
            limit = Decimal(str(politica.monto_soles))
        elif politica.monto_dolares and politica.monto_dolares > 0:
            # Convert USD policy limit to soles using provided or fallback rate
            limit = Decimal(str(politica.monto_dolares)) * tc
        else:
            return Decimal('0.00')

        devolucion = min(monto, limit)

    else:  # DOLARES
        # Convert ticket amount to soles
        monto_en_soles = monto * tc

        # Determine policy limit in soles
        if politica.monto_soles and politica.monto_soles > 0:
            limit_soles = Decimal(str(politica.monto_soles))
        elif politica.monto_dolares and politica.monto_dolares > 0:
            limit_soles = Decimal(str(politica.monto_dolares)) * tc
        else:
            return Decimal('0.00')

        devolucion = min(monto_en_soles, limit_soles)

    return devolucion.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# DNI lookup
# ---------------------------------------------------------------------------

def buscar_por_dni(dni: str):
    """
    Return all active pasajes for a given DNI, most recent first.
    Only returns habilitado=True records.
    """
    return (
        Pasaje.objects
        .filter(dni=dni, habilitado=True)
        .select_related('proveedor', 'centro_costo', 'creado_por')
        .order_by('-fecha_registro')
    )
