"""
URL configuration for the Administración app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from apps.administracion.views import (
    PasajeViewSet,
    PoliticaPasajeDevolucionesViewSet,
    ProveedorPasajesViewSet,
    PuestoViewSet,
    tipo_cambio_hoy,
)

app_name = 'administracion'

router = DefaultRouter()
router.register(r'pasajes', PasajeViewSet, basename='pasajes')
router.register(r'proveedores-pasajes', ProveedorPasajesViewSet, basename='proveedores-pasajes')
router.register(r'politicas-devolucion', PoliticaPasajeDevolucionesViewSet, basename='politicas-devolucion')
router.register(r'puestos', PuestoViewSet, basename='puestos')

urlpatterns = [
    path('tipo-cambio/', tipo_cambio_hoy, name='tipo-cambio'),
    path('', include(router.urls)),
]
