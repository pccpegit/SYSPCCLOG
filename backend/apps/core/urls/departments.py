from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.core.views.department import DepartmentViewSet, AnnualPlanViewSet, AnnualPlanLineViewSet

app_name = 'departments'

router = DefaultRouter()
router.register(r'departments', DepartmentViewSet, basename='department')
router.register(r'annual-plans', AnnualPlanViewSet, basename='annual-plan')
router.register(r'annual-plan-lines', AnnualPlanLineViewSet, basename='annual-plan-line')

urlpatterns = [
    path('', include(router.urls)),
]
