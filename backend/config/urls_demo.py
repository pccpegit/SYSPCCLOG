"""
Demo URLconf (SYSPCC-021) — config.settings.demo points ROOT_URLCONF here.

Extends the real URLconf with a route that serves MEDIA_ROOT through Django
itself. In config/urls.py that route only exists under `if settings.DEBUG:`
(dev convenience); real production serves /media/ from a web server or object
storage in front of Django. The Render free tier used for the demo has
neither, so without this route every /media/* request (user signatures,
attachments previewed by the SPA) would 404 — see FASE 3 of
.claude/handoffs/demo-supabase-vercel.md.

Note `django.conf.urls.static.static()` cannot be used here: it returns an
empty list whenever DEBUG is False, which is exactly the demo case.

Exposure is equivalent to the existing dev behavior (unauthenticated reads of
MEDIA_ROOT) and the demo only ever holds seeded fake data on an ephemeral
disk. Do NOT reuse this URLconf outside the demo settings module.
"""

from django.conf import settings
from django.urls import re_path
from django.views.static import serve

from .urls import urlpatterns as base_urlpatterns

urlpatterns = base_urlpatterns + [
    re_path(
        r'^media/(?P<path>.*)$',
        serve,
        {'document_root': settings.MEDIA_ROOT},
    ),
]
