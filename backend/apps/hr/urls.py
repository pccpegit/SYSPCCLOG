from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.hr.views.assistant import AssistantExtractView, AssistantStatusView
from apps.hr.views.document import GeneratedDocumentViewSet
from apps.hr.views.meta import DocumentTypesView, PersonalPrefillView, PersonalSearchView
from apps.hr.views.template import DocumentTemplateViewSet

app_name = 'hr'

router = DefaultRouter()
router.register(r'templates', DocumentTemplateViewSet, basename='template')
router.register(r'documents', GeneratedDocumentViewSet, basename='document')

urlpatterns = [
    path('document-types/', DocumentTypesView.as_view(), name='document-types'),
    path('personal/', PersonalSearchView.as_view(), name='personal-search'),
    path('personal/<int:pk>/prefill/', PersonalPrefillView.as_view(), name='personal-prefill'),
    path('assistant/status/', AssistantStatusView.as_view(), name='assistant-status'),
    path('assistant/extract/', AssistantExtractView.as_view(), name='assistant-extract'),
    path('', include(router.urls)),
]
