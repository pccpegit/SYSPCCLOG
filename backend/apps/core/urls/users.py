from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.core.views.user import UserViewSet, UserRoleViewSet

app_name = 'users'

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')
router.register(r'user-roles', UserRoleViewSet, basename='user-role')

urlpatterns = [
    path('', include(router.urls)),
]
