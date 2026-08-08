"""
Authentication URL patterns.
"""

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView
from drf_spectacular.utils import extend_schema

from apps.core.views.auth import CustomTokenObtainPairView, LogoutView

app_name = 'auth'

urlpatterns = [
    path('login/', CustomTokenObtainPairView.as_view(), name='login'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('token/verify/', TokenVerifyView.as_view(), name='token-verify'),
    path('logout/', LogoutView.as_view(), name='logout'),
]
