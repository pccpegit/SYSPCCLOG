from django.http import FileResponse
from rest_framework.negotiation import BaseContentNegotiation, DefaultContentNegotiation
from rest_framework.throttling import UserRateThrottle

from apps.core.throttling import ThrottleCacheMixin


class HRDownloadThrottle(ThrottleCacheMixin, UserRateThrottle):
    scope = 'hr_download'


class HRAssistantThrottle(ThrottleCacheMixin, UserRateThrottle):
    scope = 'hr_assistant'


def file_response(field_file, filename: str, content_type: str) -> FileResponse:
    """Stream a private file as an attachment. Never cached, never sniffed."""
    field_file.open('rb')
    response = FileResponse(field_file, as_attachment=True, filename=filename, content_type=content_type)
    response['Cache-Control'] = 'no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response



class JSONOnlyNegotiation(BaseContentNegotiation):
    """Ignore DRF's `?format=` override: on download endpoints `format` means
    docx/pdf, not a renderer. Files bypass renderers (FileResponse); only
    error bodies are rendered, always as JSON."""

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type

    def select_parser(self, request, parsers):
        # SYSPCC-023: used as a whole-viewset negotiator (bodies are parsed normally).
        return DefaultContentNegotiation().select_parser(request, parsers)

    def filter_renderers(self, renderers, format):  # pragma: no cover - unused
        return renderers


class HRCVUploadThrottle(UserRateThrottle):
    scope = 'hr_cv_upload'


class HRCVProgressThrottle(UserRateThrottle):
    scope = 'hr_cv_progress'


class HRCVPostingThrottle(UserRateThrottle):
    scope = 'hr_cv_posting'
