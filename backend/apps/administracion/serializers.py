"""
Serializers for the Administración app — Gestión de Pasajes.
"""

from rest_framework import serializers

from apps.administracion.models import Pasaje, Puesto, ProveedorPasajes, PoliticaPasajeDevoluciones


# ---------------------------------------------------------------------------
# Puesto
# ---------------------------------------------------------------------------

class PuestoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Puesto
        fields = ['id', 'cargo', 'habilitado']
        read_only_fields = ['id']


# ---------------------------------------------------------------------------
# ProveedorPasajes
# ---------------------------------------------------------------------------

class ProveedorPasajesSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProveedorPasajes
        fields = ['id', 'ruc', 'razon_social', 'created_at']
        read_only_fields = ['id', 'created_at']


# ---------------------------------------------------------------------------
# PoliticaPasajeDevoluciones
# ---------------------------------------------------------------------------

class PoliticaPasajeDevolucionesSerializer(serializers.ModelSerializer):
    tipo_trabajador_display = serializers.CharField(
        source='get_tipo_trabajador_display',
        read_only=True,
    )

    class Meta:
        model = PoliticaPasajeDevoluciones
        fields = [
            'id',
            'tipo_trabajador', 'tipo_trabajador_display',
            'tramo',
            'en_dolares', 'no_devolucion',
            'monto_dolares', 'monto_soles',
            'habilitado',
        ]
        read_only_fields = ['id', 'tipo_trabajador_display']


# ---------------------------------------------------------------------------
# Pasaje — List (read-heavy, includes display names)
# ---------------------------------------------------------------------------

class PasajeListSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    estado_display = serializers.CharField(source='get_estado_display', read_only=True)
    moneda_display = serializers.CharField(source='get_moneda_display', read_only=True)
    tipo_trabajador_display = serializers.CharField(
        source='get_tipo_trabajador_display', read_only=True
    )

    # Related object display names
    proveedor_nombre = serializers.SerializerMethodField()
    centro_costo_nombre = serializers.SerializerMethodField()
    centro_costo_codigo = serializers.SerializerMethodField()
    creado_por_nombre = serializers.SerializerMethodField()
    actualizado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Pasaje
        fields = [
            'id',
            # Travel
            'tipo', 'tipo_display',
            'fecha_bajada', 'embarque_bajada', 'destino_bajada',
            'fecha_subida', 'embarque_subida', 'destino_subida',
            # Personnel
            'dni', 'nombres', 'cargo',
            'tipo_trabajador', 'tipo_trabajador_display',
            'centro_costo', 'centro_costo_nombre', 'centro_costo_codigo',
            # Billing
            'proveedor', 'proveedor_nombre',
            'ruc', 'razon_social',
            'factura_ticket', 'detalle', 'fecha', 'mes',
            # Amounts
            'moneda', 'moneda_display',
            'monto_con_igv_soles', 'monto_con_igv_dolares',
            'tipo_cambio', 'devolucion', 'total',
            # Payment
            'estado', 'estado_display', 'fecha_pago', 'numero_operacion',
            # Audit
            'habilitado',
            'creado_por', 'creado_por_nombre',
            'fecha_registro',
            'actualizado_por', 'actualizado_por_nombre',
            'fecha_actualizacion',
        ]
        read_only_fields = fields

    def get_proveedor_nombre(self, obj):
        return obj.proveedor.razon_social if obj.proveedor_id else None

    def get_centro_costo_nombre(self, obj):
        return obj.centro_costo.name if obj.centro_costo_id else None

    def get_centro_costo_codigo(self, obj):
        return obj.centro_costo.code if obj.centro_costo_id else None

    def get_creado_por_nombre(self, obj):
        return obj.creado_por.get_full_name() if obj.creado_por_id else None

    def get_actualizado_por_nombre(self, obj):
        return obj.actualizado_por.get_full_name() if obj.actualizado_por_id else None


# ---------------------------------------------------------------------------
# Pasaje — Create / Update (write-oriented)
# ---------------------------------------------------------------------------

class PasajeCreateUpdateSerializer(serializers.ModelSerializer):
    """
    Used for POST (create) and PUT/PATCH (update).

    The frontend sends scalar FK IDs (proveedor_id, centro_costo_id).
    creado_por and actualizado_por are injected by the view, not the client.
    mes and total are calculated in Model.save(), so they are read-only here.
    """

    class Meta:
        model = Pasaje
        fields = [
            'id',
            # Travel
            'tipo',
            'fecha_bajada', 'embarque_bajada', 'destino_bajada',
            'fecha_subida', 'embarque_subida', 'destino_subida',
            # Personnel
            'dni', 'nombres', 'cargo',
            'tipo_trabajador',
            'centro_costo',     # FK — DRF accepts PK by default
            # Billing
            'proveedor',        # FK — DRF accepts PK by default
            'ruc', 'razon_social',
            'factura_ticket', 'detalle', 'fecha',
            'mes',              # read-only: derived in model.save()
            # Amounts
            'moneda',
            'monto_con_igv_soles', 'monto_con_igv_dolares',
            'tipo_cambio', 'devolucion',
            'total',            # read-only: calculated in model.save()
            # Payment
            'estado', 'fecha_pago', 'numero_operacion',
            # Audit
            'habilitado',
        ]
        read_only_fields = ['id', 'mes', 'total']

    def validate(self, attrs):
        tipo = attrs.get('tipo', getattr(self.instance, 'tipo', None))

        # Subida requires fecha_subida
        if tipo in ('S', 'S/B'):
            if not attrs.get('fecha_subida') and not getattr(self.instance, 'fecha_subida', None):
                raise serializers.ValidationError(
                    {'fecha_subida': 'Se requiere fecha de subida para este tipo de pasaje.'}
                )

        # Bajada requires fecha_bajada
        if tipo in ('B', 'S/B'):
            if not attrs.get('fecha_bajada') and not getattr(self.instance, 'fecha_bajada', None):
                raise serializers.ValidationError(
                    {'fecha_bajada': 'Se requiere fecha de bajada para este tipo de pasaje.'}
                )

        # Dollar ticket requires tipo_cambio
        moneda = attrs.get('moneda', getattr(self.instance, 'moneda', 'SOLES'))
        if moneda == 'DOLARES':
            tipo_cambio = attrs.get('tipo_cambio', getattr(self.instance, 'tipo_cambio', 0))
            if not tipo_cambio or tipo_cambio <= 0:
                raise serializers.ValidationError(
                    {'tipo_cambio': 'Se requiere tipo de cambio válido para pasajes en dólares.'}
                )

        return attrs
