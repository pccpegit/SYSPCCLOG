"""
URL routing for the support app.
"""

from rest_framework.routers import DefaultRouter

from apps.support.views import TicketViewSet

app_name = 'support'

router = DefaultRouter()
router.register(r'tickets', TicketViewSet, basename='ticket')

urlpatterns = router.urls
