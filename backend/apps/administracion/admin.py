"""
Django Admin configuration for the Administración app — Pasajes module.
"""

from django.contrib import admin

from apps.administracion.models import Pasaje, PoliticaPasajeDevoluciones, ProveedorPasajes, Puesto


@admin.register(Puesto)
class PuestoAdmin(admin.ModelAdmin):
    list_display = ['cargo', 'habilitado', 'created_at']
    search_fields = ['cargo']
    list_filter = ['habilitado']
    ordering = ['cargo']


@admin.register(ProveedorPasajes)
class ProveedorPasajesAdmin(admin.ModelAdmin):
    list_display = ['ruc', 'razon_social', 'created_at']
    search_fields = ['ruc', 'razon_social']
    ordering = ['razon_social']


@admin.register(PoliticaPasajeDevoluciones)
class PoliticaPasajeDevolucionesAdmin(admin.ModelAdmin):
    list_display = [
        'tramo', 'tipo_trabajador', 'en_dolares', 'no_devolucion',
        'monto_soles', 'monto_dolares', 'habilitado',
    ]
    list_filter = ['tipo_trabajador', 'habilitado', 'en_dolares', 'no_devolucion']
    search_fields = ['tramo']
    ordering = ['tramo', 'tipo_trabajador']


@admin.register(Pasaje)
class PasajeAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'dni', 'nombres', 'tipo', 'tipo_trabajador',
        'fecha', 'mes', 'moneda', 'total', 'estado',
        'fecha_pago', 'habilitado',
    ]
    list_filter = ['estado', 'tipo', 'tipo_trabajador', 'moneda', 'habilitado', 'mes']
    search_fields = ['dni', 'nombres', 'ruc', 'razon_social', 'factura_ticket']
    readonly_fields = ['mes', 'total', 'fecha_registro', 'fecha_actualizacion']
    raw_id_fields = ['proveedor', 'centro_costo', 'creado_por', 'actualizado_por']
    date_hierarchy = 'fecha'
    ordering = ['-fecha_registro']

    fieldsets = [
        ('Información de Viaje', {
            'fields': [
                'tipo',
                ('fecha_bajada', 'embarque_bajada', 'destino_bajada'),
                ('fecha_subida', 'embarque_subida', 'destino_subida'),
            ],
        }),
        ('Personal', {
            'fields': [
                ('dni', 'nombres', 'cargo'),
                ('tipo_trabajador', 'centro_costo'),
            ],
        }),
        ('Facturación', {
            'fields': [
                'proveedor',
                ('ruc', 'razon_social'),
                ('factura_ticket', 'detalle'),
                ('fecha', 'mes'),
            ],
        }),
        ('Montos', {
            'fields': [
                'moneda',
                ('monto_con_igv_soles', 'monto_con_igv_dolares'),
                ('tipo_cambio', 'devolucion', 'total'),
            ],
        }),
        ('Pago', {
            'fields': [
                ('estado', 'fecha_pago', 'numero_operacion'),
            ],
        }),
        ('Auditoría', {
            'fields': [
                'habilitado',
                ('creado_por', 'fecha_registro'),
                ('actualizado_por', 'fecha_actualizacion'),
            ],
            'classes': ['collapse'],
        }),
    ]
