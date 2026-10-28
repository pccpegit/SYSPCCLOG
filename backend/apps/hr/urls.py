from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.hr.views.assistant import AssistantExtractView, AssistantStatusView
from apps.hr.views.cv import CVAnalysisViewSet, CVItemViewSet
from apps.hr.views.document import GeneratedDocumentViewSet
from apps.hr.views.meta import DocumentTypesView, PersonalPrefillView, PersonalSearchView
from apps.hr.views.template import DocumentTemplateViewSet

app_name = 'hr'

router = DefaultRouter()
router.register(r'templates', DocumentTemplateViewSet, basename='template')
router.register(r'cv-analyses', CVAnalysisViewSet, basename='cv-analysis')
router.register(r'documents', GeneratedDocumentViewSet, basename='document')

_items = 'cv-analyses/<int:analysis_pk>/items/'
urlpatterns = [
    path(_items, CVItemViewSet.as_view({'get': 'list', 'post': 'create'}), name='cv-item-list'),
    path(_items + '<int:pk>/', CVItemViewSet.as_view({'get': 'retrieve', 'delete': 'destroy'}), name='cv-item-detail'),
    path(_items + '<int:pk>/retry/', CVItemViewSet.as_view({'post': 'retry'}), name='cv-item-retry'),
    path(_items + '<int:pk>/report/', CVItemViewSet.as_view({'get': 'report'}), name='cv-item-report'),
    path(_items + '<int:pk>/file/', CVItemViewSet.as_view({'get': 'file'}), name='cv-item-file'),
    path('document-types/', DocumentTypesView.as_view(), name='document-types'),
    path('personal/', PersonalSearchView.as_view(), name='personal-search'),
    path('personal/<int:pk>/prefill/', PersonalPrefillView.as_view(), name='personal-prefill'),
    path('assistant/status/', AssistantStatusView.as_view(), name='assistant-status'),
    path('assistant/extract/', AssistantExtractView.as_view(), name='assistant-extract'),
    path('', include(router.urls)),
]
