from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.core.views.personal import PersonalViewSet

app_name = 'personal'

router = DefaultRouter()
router.register(r'personal', PersonalViewSet, basename='personal')

urlpatterns = [
    path('', include(router.urls)),
]
