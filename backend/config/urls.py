"""
Main URL configuration for SYSPCCLOG project.
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.permissions import IsAdminUser
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)

admin.site.site_header = 'SYSPCCLOG - PCC S.A.C.'
admin.site.site_title = 'Sistema RQ Admin'
admin.site.index_title = 'Panel de Administración'

urlpatterns = [
    # FIX (admin URL): Changed from 'admin/' to a non-obvious path to reduce
    # automated scan exposure. Update bookmarks and deployment docs accordingly.
    path('mgmt-panel/', admin.site.urls),

    # API v1
    path('api/v1/', include([
        # Auth endpoints
        path('auth/', include('apps.core.urls.auth', namespace='auth')),

        # Core app
        path('', include('apps.core.urls.users', namespace='users')),
        path('', include('apps.core.urls.projects', namespace='projects')),
        path('', include('apps.core.urls.departments', namespace='departments')),
        path('', include('apps.core.urls.personal', namespace='personal')),

        # RQ app
        path('', include('apps.rq.urls', namespace='rq')),

        # Warehouse app
        path('warehouse/', include('apps.warehouse.urls', namespace='warehouse')),

        # Administración app
        path('administracion/', include('apps.administracion.urls', namespace='administracion')),

        # Support / IT tickets app
        path('support/', include('apps.support.urls', namespace='support')),
    ])),

    # FIX-05: OpenAPI schema and docs require admin authentication
    path(
        'api/schema/',
        SpectacularAPIView.as_view(permission_classes=[IsAdminUser]),
        name='schema',
    ),
    path(
        'api/docs/',
        SpectacularSwaggerView.as_view(url_name='schema', permission_classes=[IsAdminUser]),
        name='swagger-ui',
    ),
    path(
        'api/redoc/',
        SpectacularRedocView.as_view(url_name='schema', permission_classes=[IsAdminUser]),
        name='redoc',
    ),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
