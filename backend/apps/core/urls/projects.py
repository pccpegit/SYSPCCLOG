from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.core.views.project import ProjectViewSet, ProjectBudgetLineViewSet

app_name = 'projects'

router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'project-budget-lines', ProjectBudgetLineViewSet, basename='project-budget-line')

urlpatterns = [
    path('', include(router.urls)),
]
