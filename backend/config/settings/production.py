"""
Production settings for SYSPCCLOG project.
"""

import copy
import os
import ssl
import tempfile
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401, F403
from decouple import config

from .guards import validate_cv_provider

DEBUG = False


def _ca_bundle_path(path_env, pem_env, filename):
    """Return the path of a CA bundle for TLS verification, or ''.

    ``<path_env>`` (a file already in the image/volume) wins. Otherwise
    ``<pem_env>`` may carry the PEM text itself (App Platform exposes a
    database CA as the bindable ``${db.CA_CERT}``) and is written once to a
    private temp file. A value that is not a PEM certificate (e.g. an
    unresolved ``${...}`` placeholder) aborts the boot instead of silently
    disabling verification.
    """
    path = config(path_env, default='').strip()
    if path:
        return path
    pem = config(pem_env, default='').replace('\\n', '\n').strip()
    if not pem:
        return ''
    if '-----BEGIN CERTIFICATE-----' not in pem:
        raise ImproperlyConfigured(f'{pem_env} does not contain a PEM certificate.')
    target = Path(tempfile.gettempdir()) / filename
    tmp = target.with_name(f'{filename}.{os.getpid()}.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='ascii') as handle:
        handle.write(pem + '\n')
    os.replace(tmp, target)  # atomic: several processes may boot at once
    return str(target)


# ============================================================
# DATABASE — PostgreSQL (DigitalOcean Managed Database)
# ============================================================
# DB_SSLMODE: require (default, encrypted but the server is NOT verified) |
# verify-ca | verify-full. Prefer verify-ca with the cluster CA
# (DB_SSLROOTCERT = file path, or DB_CA_CERT = PEM text such as the App
# Platform bindable ${db.CA_CERT}); verify-full also checks the host name and
# may fail against private (VPC) host names.
# DB_DISABLE_SERVER_SIDE_CURSORS (SYSPCC-033): True when DB_HOST is a PgBouncer
# pool in TRANSACTION mode (DigitalOcean connection pool): a server-side cursor
# (QuerySet.iterator()) outlives the transaction and breaks there. Default
# False for a direct connection.
DB_SSLMODE = config('DB_SSLMODE', default='require').strip().lower()
if DB_SSLMODE not in ('require', 'verify-ca', 'verify-full'):
    raise ImproperlyConfigured(
        f"DB_SSLMODE={DB_SSLMODE!r} is invalid; use require, verify-ca or verify-full."
    )
DB_SSLROOTCERT = _ca_bundle_path('DB_SSLROOTCERT', 'DB_CA_CERT', 'syspcc-db-ca.pem')
if DB_SSLMODE != 'require' and not DB_SSLROOTCERT:
    raise ImproperlyConfigured(
        f'DB_SSLMODE={DB_SSLMODE} needs DB_SSLROOTCERT (path) or DB_CA_CERT (PEM text).'
    )

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME'),
        'USER': config('DB_USER'),
        'PASSWORD': config('DB_PASSWORD'),
        'HOST': config('DB_HOST'),
        'PORT': config('DB_PORT', default='25060'),
        'OPTIONS': {
            'connect_timeout': 10,
            'sslmode': DB_SSLMODE,
            **({'sslrootcert': DB_SSLROOTCERT} if DB_SSLROOTCERT else {}),
        },
        # Persistent connections (0 = close per request, the historical
        # behaviour). DigitalOcean App Platform sets DB_CONN_MAX_AGE=60 in the
        # app spec; keep the budget in mind: connections per process x threads.
        'CONN_MAX_AGE': config('DB_CONN_MAX_AGE', default=0, cast=int),
        'CONN_HEALTH_CHECKS': True,
        'DISABLE_SERVER_SIDE_CURSORS': config('DB_DISABLE_SERVER_SIDE_CURSORS', default=False, cast=bool),
    }
}

# Security headers
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_SSL_REDIRECT = config('SECURE_SSL_REDIRECT', default=True, cast=bool)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# SYSPCC-024: TLS is terminated by the platform edge (DigitalOcean App
# Platform / Render) and the container only sees plain HTTP. Without this
# header Django never considers a request secure: SECURE_SSL_REDIRECT loops
# forever (301) and the CSRF Origin check rejects every POST.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
# Health checks come from the platform without X-Forwarded-Proto. The
# HealthCheckMiddleware answers first anyway; this is defence in depth.
SECURE_REDIRECT_EXEMPT = [r'^healthz/?$']

# Production email.
# Explicit EMAIL_BACKEND wins. Otherwise SMTP only when credentials exist:
# an SMTP backend without a password fails (auth error) on every Celery task
# that sends mail (low-stock alerts, approval reminders), so we degrade to
# the console backend instead.
EMAIL_HOST = config('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = True
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='noreply@pcc.com.pe')
EMAIL_BACKEND = config('EMAIL_BACKEND', default='') or (
    'django.core.mail.backends.smtp.EmailBackend'
    if EMAIL_HOST_PASSWORD
    else 'django.core.mail.backends.console.EmailBackend'
)

# ============================================================
# STATIC FILES — WhiteNoise (SYSPCC-024)
# ============================================================
# Django 5.1 removed STATICFILES_STORAGE; STORAGES (below) is the only knob.
# WhiteNoise serves /static (admin, DRF) from the container: run
# `collectstatic` at start (scripts/do-start.sh). Inserted right after
# SecurityMiddleware, its documented required position; idempotent so a child
# settings module that also inserts it cannot duplicate it.
MIDDLEWARE = list(MIDDLEWARE)  # noqa: F405 - never mutate the base.py list
if 'whitenoise.middleware.WhiteNoiseMiddleware' not in MIDDLEWARE:
    MIDDLEWARE.insert(
        MIDDLEWARE.index('django.middleware.security.SecurityMiddleware') + 1,
        'whitenoise.middleware.WhiteNoiseMiddleware',
    )

# ============================================================
# MEDIA + RR. HH. PRIVATE FILES — DigitalOcean Spaces (S3 API), OPTIONAL
# ============================================================
# Container disks are ephemeral and not shared between web and worker, so
# uploads belong in object storage. Activated ONLY when
# AWS_STORAGE_BUCKET_NAME is set; otherwise media keeps using
# FileSystemStorage (Render demo, local Docker) exactly as before.
# Credentials/endpoint are shared with apps.hr.storage.PrivateS3Storage
# (HR_FILE_STORAGE), which uses its own bucket (HR_PRIVATE_BUCKET_NAME).
# Optional dedicated key pair for the HR bucket (HR_AWS_*): see apps/hr/storage.py.
for _name in (
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_ENDPOINT_URL', 'AWS_S3_REGION_NAME',
    'HR_AWS_ACCESS_KEY_ID', 'HR_AWS_SECRET_ACCESS_KEY',
):
    _value = config(_name, default='')
    if _value:
        globals()[_name] = _value
AWS_S3_SIGNATURE_VERSION = 's3v4'  # required by Spaces for presigned URLs

AWS_STORAGE_BUCKET_NAME = config('AWS_STORAGE_BUCKET_NAME', default='')
HR_PRIVATE_BUCKET_NAME = config('HR_PRIVATE_BUCKET_NAME', default='')

_default_storage = {'BACKEND': 'django.core.files.storage.FileSystemStorage'}
if AWS_STORAGE_BUCKET_NAME:
    _default_storage = {
        'BACKEND': 'storages.backends.s3.S3Storage',
        'OPTIONS': {
            'bucket_name': AWS_STORAGE_BUCKET_NAME,
            'location': 'media',
            'default_acl': 'private',
            'querystring_auth': True,
            # Signed URLs of user signatures live in the SPA state: 1 hour
            # keeps them valid long enough for a settings-page session.
            'querystring_expire': config('AWS_QUERYSTRING_EXPIRE', default=3600, cast=int),
            'file_overwrite': False,
        },
    }

STORAGES = {
    'default': _default_storage,
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

# FIX-18/19: Cookie security for production
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_AGE = 3600  # 1 hour session lifetime

# SYSPCC-015 (CSRF enforcement, implemented): CSRF_COOKIE_HTTPONLY must stay
# False in every environment, including production — the SPA reads the
# `csrftoken` cookie via JS and echoes it back as `X-CSRFToken` on every
# mutating request (double-submit pattern, base.py). Setting it True here
# would make the frontend unable to read the token and 403 every mutating
# request in production. Enforcement itself lives in
# apps.core.authentication.CookieJWTAuthentication.enforce_csrf().
CSRF_COOKIE_HTTPONLY = False

SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'

# SYSPCC-023: the simulated CV provider is never allowed here (also covers demo.py,
# which imports this module). DEBUG is False above, so `fake` aborts the boot.
validate_cv_provider(HR_CV_PROVIDER, DEBUG)  # noqa: F405

# ============================================================
# CLIENT IP / THROTTLING (SYSPCC-024)
# ============================================================
# NUM_PROXIES: number of trusted proxy hops for DRF's X-Forwarded-For parsing.
# Unset (None) keeps DRF's historical behaviour (trusts the header as sent).
# Render's demo overrides it in demo.py (1).
#
# DigitalOcean App Platform: the ingress writes ITS OWN address into
# X-Forwarded-For, so any NUM_PROXIES value makes every user share a few
# throttle buckets (login 5/min for the whole company). The real client
# address arrives in the `do-connecting-ip` header instead.
# TRUST_DO_CONNECTING_IP=True enables DOConnectingIPMiddleware (REMOTE_ADDR
# <- do-connecting-ip) and NUM_PROXIES=0 (DRF then uses REMOTE_ADDR and
# ignores X-Forwarded-For). Only enable it behind App Platform's ingress.
TRUST_DO_CONNECTING_IP = config('TRUST_DO_CONNECTING_IP', default=False, cast=bool)
_num_proxies = config(
    'NUM_PROXIES', default='',
    cast=lambda v: None if str(v).strip() == '' else int(v),
)
if TRUST_DO_CONNECTING_IP:
    _num_proxies = 0
    if 'apps.core.middleware.DOConnectingIPMiddleware' not in MIDDLEWARE:
        # Right after HealthCheckMiddleware (index 0), before anything that
        # reads REMOTE_ADDR (logging, throttles, audit).
        MIDDLEWARE.insert(1, 'apps.core.middleware.DOConnectingIPMiddleware')
if _num_proxies is not None:
    REST_FRAMEWORK = {**REST_FRAMEWORK, 'NUM_PROXIES': _num_proxies}  # noqa: F405

# ============================================================
# REDIS TLS — rediss:// (DO Managed Valkey / Redis) (SYSPCC-024)
# ============================================================
# kombu/redis-py refuse a rediss:// URL without an explicit certificate
# policy. REDIS_SSL_CERT_REQS: required (default) | optional | none.
# REDIS_SSL_CA_CERTS: path to the provider CA bundle, or REDIS_CA_CERT with the
# PEM text itself (App Platform bindable ${cache.CA_CERT}). DO publishes its
# own CA for managed databases; it is not in the system trust store.
# RECOMMENDED: required + CA. REDIS_SSL_CERT_REQS=none does not authenticate
# the server (MITM could read the password and the sessions): use it only as a
# temporary, conscious exception over the private (VPC) host name.
_CERT_REQS = {
    'required': ssl.CERT_REQUIRED,
    'optional': ssl.CERT_OPTIONAL,
    'none': ssl.CERT_NONE,
}
REDIS_SSL_CERT_REQS = config('REDIS_SSL_CERT_REQS', default='required').strip().lower()
if REDIS_SSL_CERT_REQS not in _CERT_REQS:
    raise ImproperlyConfigured(
        f"REDIS_SSL_CERT_REQS={REDIS_SSL_CERT_REQS!r} is invalid; use one of {sorted(_CERT_REQS)}."
    )
REDIS_SSL_CA_CERTS = _ca_bundle_path('REDIS_SSL_CA_CERTS', 'REDIS_CA_CERT', 'syspcc-redis-ca.pem')


def _is_tls_url(url):
    return str(url).strip().lower().startswith('rediss://')


def _celery_ssl_options():
    options = {'ssl_cert_reqs': _CERT_REQS[REDIS_SSL_CERT_REQS]}
    if REDIS_SSL_CA_CERTS:
        options['ssl_ca_certs'] = REDIS_SSL_CA_CERTS
    return options


if _is_tls_url(CELERY_BROKER_URL):  # noqa: F405
    CELERY_BROKER_USE_SSL = _celery_ssl_options()
if _is_tls_url(CELERY_RESULT_BACKEND):  # noqa: F405
    CELERY_REDIS_BACKEND_USE_SSL = _celery_ssl_options()

if _is_tls_url(REDIS_URL):  # noqa: F405
    CACHES = copy.deepcopy(CACHES)  # noqa: F405 - never mutate the base.py dict
    _cache_options = CACHES['default']['OPTIONS']
    _cache_options['CONNECTION_POOL_KWARGS'] = {
        **_cache_options.get('CONNECTION_POOL_KWARGS', {}),
        'ssl_cert_reqs': REDIS_SSL_CERT_REQS,
        **({'ssl_ca_certs': REDIS_SSL_CA_CERTS} if REDIS_SSL_CA_CERTS else {}),
    }

# django-redis: when True, cache errors (Redis down/OOM) are swallowed and
# logged instead of raising -> the cache/sessions degrade instead of a 500 on
# every request. Default False keeps the historical behaviour (fail closed).
DJANGO_REDIS_IGNORE_EXCEPTIONS = config('DJANGO_REDIS_IGNORE_EXCEPTIONS', default=False, cast=bool)
DJANGO_REDIS_LOG_IGNORED_EXCEPTIONS = DJANGO_REDIS_IGNORE_EXCEPTIONS

# SECURITY: with errors swallowed, throttle counters kept in Redis read as
# empty during an outage, so the login limit (5/min) would fail OPEN exactly
# when Redis is down. In that mode the DRF throttles use a process-local cache
# instead (apps/core/throttling.py): limits stay enforced per gunicorn process
# (the spec runs 1 worker; N workers would allow N x the rate) and reset on
# restart. Without IGNORE_EXCEPTIONS the throttles stay on the shared cache.
if DJANGO_REDIS_IGNORE_EXCEPTIONS:
    CACHES = copy.deepcopy(CACHES)  # noqa: F405
    CACHES['throttle'] = {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'syspcc-throttle',
    }
    THROTTLE_CACHE_ALIAS = 'throttle'
