"""
Demo settings for SYSPCCLOG project — free-tier deployment
(Render web service + Supabase Postgres + Vercel frontend, SYSPCC-021).

Inherits everything from production.py (Postgres via DATABASES, HSTS, secure
cookies, CSRF, etc.) and overrides ONLY what Render's free tier does not
provide: no Redis, no background Celery worker/beat, no real SMTP relay, TLS
terminated by Render's own proxy in front of gunicorn, and static files
served by WhiteNoise instead of a CDN/object storage.

Design contract (see .claude/handoffs/demo-supabase-vercel.md, FASE 0): this
module must not weaken any security control production.py already sets — it
only swaps out infrastructure the free tier lacks. WorkflowEngine, RBAC,
cookie/CSRF policy and DATABASES are untouched.
"""

from .production import *  # noqa: F401, F403
from decouple import config

# ============================================================
# DEBUG
# ============================================================
# On Render this MUST stay False — Render's dashboard sets no DEBUG env var
# for this service, so the config() default below (False, same as
# production.py) applies there. The env override exists ONLY so a developer
# can run seed_demo from their OWN machine against the same Supabase
# database the demo uses, e.g.:
#
#   DJANGO_SETTINGS_MODULE=config.settings.demo DEBUG=true \
#     DB_NAME=... DB_USER=... DB_PASSWORD=... DB_HOST=... DB_PORT=5432 \
#     SEED_DEMO_PASSWORD=<pwd> python manage.py seed_demo
#
# apps/core/management/seed_guard.py::abort_if_production() refuses to run
# seed_demo / seed_demo_extra / seed_screenshots unless settings.DEBUG is
# True. That guard is NOT weakened here: DEBUG still defaults to False, so
# the deployed Render service (which never sets DEBUG=true) can never seed
# demo accounts against itself — only a developer deliberately opting in
# locally can.
DEBUG = config('DEBUG', default=False, cast=bool)

# ============================================================
# CACHE — no Redis on Render free tier
# ============================================================
# Same 'default' alias as base.py/production.py, so SESSION_ENGINE (which
# reads sessions from cache via SESSION_CACHE_ALIAS = 'default', set in
# base.py) keeps working unchanged. LocMemCache is per-process, in-memory
# and not shared across processes — acceptable here because render.yaml
# runs a single gunicorn worker for this service, so there is only one
# process to keep cache-consistent with itself.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    }
}

# ============================================================
# CELERY — no background worker/beat on Render free tier
# ============================================================
# The free plan only runs this single web service — no separate worker or
# beat process. ALWAYS_EAGER makes every .delay() call run inline,
# synchronously, inside the request that triggered it, instead of being
# queued for a worker that doesn't exist. EAGER_PROPAGATES surfaces task
# exceptions immediately (as a request error) instead of swallowing them,
# which matters now that the "task" is really just part of the request.
# Consequence (accepted, documented in the handoff): base.py's
# CELERY_BEAT_SCHEDULE (SLA checks, approval reminders, cache invalidation,
# low-stock alerts) never runs — there is no beat process to trigger it.
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

# ============================================================
# EMAIL — no real SMTP configured for the demo
# ============================================================
# Because Celery now runs eager (above), any task that sends email executes
# inline as part of the triggering request (e.g. an approval action). A
# broken or unconfigured SMTP relay would make THAT request fail instead of
# just failing a queued background task. The console backend prints the
# message to the Render service log instead of sending it — acceptable for
# a demo where no real notifications need to be delivered.
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

# ============================================================
# TLS — Render terminates HTTPS in front of gunicorn
# ============================================================
# Requests reach gunicorn over plain HTTP inside Render's internal network;
# without telling Django to trust the X-Forwarded-Proto header set by
# Render's proxy, Django can't see the original request was HTTPS, and
# SECURE_SSL_REDIRECT (production.py, still True here) would redirect every
# already-HTTPS request forever (infinite redirect loop, service unusable).
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# ============================================================
# STATIC FILES — WhiteNoise (no separate static host on free tier)
# ============================================================
# Inserted immediately after SecurityMiddleware, which is WhiteNoise's
# documented required position: http://whitenoise.evans.io/en/stable/django.html
# MIDDLEWARE is inherited (as a list) from base.py via production.py; copy
# it before mutating so we never touch the base.py list object itself.
MIDDLEWARE = list(MIDDLEWARE)
MIDDLEWARE.insert(
    MIDDLEWARE.index('django.middleware.security.SecurityMiddleware') + 1,
    'whitenoise.middleware.WhiteNoiseMiddleware',
)

# ============================================================
# MEDIA — served by Django itself on the demo (no nginx/CDN in front)
# ============================================================
# config/urls.py only mounts /media/ under `if settings.DEBUG:`, and the
# demo runs with DEBUG=False — without this, signatures/attachments the SPA
# links via /media/* would all 404 (finding from FASE 3, security audit).
# config/urls_demo.py extends the real URLconf with an explicit media route;
# see its docstring for the exposure rationale (demo-only, seeded fake data).
ROOT_URLCONF = 'config.urls_demo'

# ============================================================
# DRF THROTTLING — trust exactly one proxy hop (Render's own proxy)
# ============================================================
# Without NUM_PROXIES, DRF's throttle ident uses the X-Forwarded-For header
# exactly as the client sent it, so anyone hitting the Render URL directly
# can rotate XFF values to bypass the login rate limit (5/min) — flagged in
# FASE 3. NUM_PROXIES=1 makes DRF take the address appended by the last
# (trusted) proxy, i.e. the real TCP peer Render saw: a direct attacker gets
# throttled by their own IP again. Traffic proxied through Vercel still
# collapses to Vercel's egress IP — that shared-throttle tradeoff is
# documented in the deploy guide. The equivalent fix for production.py is a
# follow-up ticket (it predates this one and affects the real deployment).
REST_FRAMEWORK = {**REST_FRAMEWORK, 'NUM_PROXIES': 1}  # noqa: F405

# Django 5.1 removed the STATICFILES_STORAGE setting (the compatibility
# shim for it is gone, not just deprecated) — production.py line 50 still
# sets STATICFILES_STORAGE, but that assignment is now inert dead code
# under this settings module (left untouched: out of scope for SYSPCC-021,
# see handoff note to devops-release). STORAGES is the Django 5.1 replacement.
# 'default' is copied from Django's own global_settings.py default
# (FileSystemStorage, used for MEDIA_ROOT uploads) so behavior there is
# unchanged from base/production — only 'staticfiles' switches to
# WhiteNoise's compressed + hashed-manifest storage.
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}
