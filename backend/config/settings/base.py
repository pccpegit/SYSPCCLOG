"""
Base settings for SYSPCCLOG project.
All environments inherit from this.
"""

from pathlib import Path
from datetime import timedelta
from decouple import config
from celery.schedules import crontab

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent.parent


# ============================================================
# SECURITY
# ============================================================

# FIX-14: No insecure default — will raise ImproperlyConfigured if SECRET_KEY is missing from .env
SECRET_KEY = config('SECRET_KEY')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=lambda v: [s.strip() for s in v.split(',')])


# ============================================================
# APPLICATIONS
# ============================================================

DJANGO_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'drf_spectacular',
    'django_celery_beat',
]

LOCAL_APPS = [
    'apps.core',
    'apps.rq',
    'apps.warehouse',
    'apps.administracion',
    'apps.support',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS


# ============================================================
# MIDDLEWARE
# ============================================================

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]


# ============================================================
# URL / WSGI
# ============================================================

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'


# ============================================================
# TEMPLATES
# ============================================================

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]


# ============================================================
# DATABASE
# ============================================================

DATABASES = {
    'default': {
        'ENGINE': config('DB_ENGINE', default='django.db.backends.sqlite3'),
        'NAME': config('DB_NAME', default=str(BASE_DIR / 'db.sqlite3')),
    }
}


# ============================================================
# REDIS & CACHING
# ============================================================

REDIS_URL = config('REDIS_URL', default='redis://localhost:6379/0')

CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': REDIS_URL,
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
            'SOCKET_CONNECT_TIMEOUT': 5,
            'SOCKET_TIMEOUT': 5,
            'RETRY_ON_TIMEOUT': True,
            'MAX_CONNECTIONS': 50,
            'CONNECTION_POOL_KWARGS': {'max_connections': 50},
        },
        'KEY_PREFIX': 'syspcclog',
        'TIMEOUT': 300,  # 5 minutes default
    }
}


# ============================================================
# SESSION (Redis-backed)
# ============================================================

SESSION_ENGINE = 'django.contrib.sessions.backends.cache'
SESSION_CACHE_ALIAS = 'default'


# ============================================================
# CELERY
# ============================================================

CELERY_BROKER_URL = config('CELERY_BROKER_URL', default='redis://localhost:6379/1')
CELERY_RESULT_BACKEND = config('CELERY_RESULT_BACKEND', default='redis://localhost:6379/2')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'America/Lima'
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 300  # 5 minutes max per task
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

CELERY_BEAT_SCHEDULE = {
    'check-sla-deadlines': {
        'task': 'rq.check_sla_deadlines',
        'schedule': crontab(hour=8, minute=0),  # Every day at 8 AM Lima time
    },
    'send-pending-approval-reminders': {
        'task': 'rq.send_pending_approval_reminders',
        'schedule': crontab(hour='9,14', minute=0),  # 9 AM and 2 PM
    },
    'invalidate-dashboard-caches': {
        'task': 'rq.invalidate_dashboard_caches',
        'schedule': crontab(minute='*/15'),  # Every 15 minutes
    },
    'warehouse-low-stock-check': {
        'task': 'warehouse.check_low_stock',
        'schedule': crontab(hour=7, minute=30),  # Every day at 7:30 AM Lima time
    },
}

# ============================================================
# EMAIL
# ============================================================
EMAIL_BACKEND = config('EMAIL_BACKEND', default='django.core.mail.backends.console.EmailBackend')
EMAIL_HOST = config('EMAIL_HOST', default='smtp.office365.com')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='sistemas@pcc.com.pe')

# Recipients for warehouse low-stock alerts
WAREHOUSE_ALERT_RECIPIENTS = config(
    'WAREHOUSE_ALERT_RECIPIENTS',
    default='sistemas@pcc.com.pe',
    cast=lambda v: [s.strip() for s in v.split(',') if s.strip()],
)


# ============================================================
# AUTH
# ============================================================

AUTH_USER_MODEL = 'core.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    # FIX-22: Raise minimum password length from 8 to 12 characters
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 12},
    },
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


# ============================================================
# DJANGO REST FRAMEWORK
# ============================================================

REST_FRAMEWORK = {
    # FIX-02: Use cookie-based JWT authentication instead of Authorization header
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'apps.core.authentication.CookieJWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'EXCEPTION_HANDLER': 'apps.core.exceptions.custom_exception_handler',
    # FIX-09: Rate limiting to protect all endpoints and login specifically
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '30/min',
        'user': '200/min',
        'login': '5/min',
    },
}


# ============================================================
# SIMPLE JWT
# ============================================================

SIMPLE_JWT = {
    # FIX-04: Reduced token lifetimes for security
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_HEADER_NAME': 'HTTP_AUTHORIZATION',
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
    'TOKEN_OBTAIN_SERIALIZER': 'apps.core.serializers.auth.CustomTokenObtainPairSerializer',
}


# ============================================================
# CORS
# ============================================================

CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:5173,http://localhost:3000',
    cast=lambda v: [s.strip() for s in v.split(',')],
)
CORS_ALLOW_CREDENTIALS = True


# ============================================================
# DRF SPECTACULAR (OpenAPI)
# ============================================================

SPECTACULAR_SETTINGS = {
    'TITLE': 'SYSPCCLOG - Sistema RQ API',
    'DESCRIPTION': 'Supply Request Management System para PCC S.A.C.',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'COMPONENT_SPLIT_REQUEST': True,
    'TAGS': [
        {'name': 'auth', 'description': 'Autenticación y tokens JWT'},
        {'name': 'users', 'description': 'Gestión de usuarios'},
        {'name': 'projects', 'description': 'Proyectos de obra'},
        {'name': 'departments', 'description': 'Departamentos administrativos'},
        {'name': 'requests', 'description': 'Requerimientos (RQ)'},
        {'name': 'approvals', 'description': 'Cadena de aprobaciones'},
        {'name': 'suppliers', 'description': 'Proveedores'},
        {'name': 'quotations', 'description': 'Cotizaciones'},
        {'name': 'purchase-orders', 'description': 'Órdenes de Compra'},
        {'name': 'claims', 'description': 'Reclamos'},
        {'name': 'warehouse', 'description': 'Almacén e inventario'},
        {'name': 'notifications', 'description': 'Notificaciones'},
    ],
}


# ============================================================
# ONEDRIVE INTEGRATION (SYSPCC-016)
# ============================================================
# Implementation: apps/warehouse/services/onedrive.py, apps/warehouse/views.py.

# Azure AD / Microsoft Graph OAuth2 client_id for the OneDrive integration
# (device code flow). No default — the integration is OPTIONAL: when this is
# unset, ONEDRIVE_CLIENT_ID is '' and apps/warehouse/views.py::OneDriveViewSet
# rejects connect/poll with a clear "OneDrive no configurado" error instead
# of crashing. SYSPCC-017: a real GUID must never be a version-controlled
# default — set ONEDRIVE_CLIENT_ID in the environment (see .env.example).
ONEDRIVE_CLIENT_ID = config('ONEDRIVE_CLIENT_ID', default='')

# Selects the Microsoft identity platform authority used for the device-code
# flow (https://login.microsoftonline.com/<ONEDRIVE_TENANT>/...):
#   - 'consumers'     -> personal Microsoft accounts only (current default,
#                        matches the public client ID above).
#   - 'organizations' -> any Azure AD / Microsoft 365 work-or-school account.
#   - '<tenant-guid-or-domain>' -> a specific company tenant, once PCC
#                        registers its own Azure AD app for OneDrive for
#                        Business / SharePoint.
# NOT validated against PCC's real tenant here — no Microsoft 365 admin
# credentials are available in this environment. Left configurable so the
# company can point it at their tenant without a code change.
ONEDRIVE_TENANT = config('ONEDRIVE_TENANT', default='consumers')

# Scope sent to Microsoft Graph's `createLink` when generating a share link
# for an uploaded document (apps/warehouse/services/onedrive.py::_create_share_link):
#   - 'organization' (default): link only opens for someone signed into the
#     same Microsoft tenant. Requires a OneDrive for Business / SharePoint
#     drive, i.e. ONEDRIVE_TENANT pointed at a real org/tenant — it is NOT
#     supported for personal ('consumers') accounts and will fail there
#     (the code degrades to the item's own webUrl in that case, it does not
#     fall back to a public link).
#   - 'anonymous': link is public to anyone with the URL, no auth required.
#     Matches how a personal ('consumers') account is normally used. This
#     must be a deliberate, explicit config choice — never a silent default
#     — because every warehouse document (RQ numbers, suppliers, pricing)
#     becomes link-accessible to anyone who obtains the URL.
#
# Decision matrix: personal account (ONEDRIVE_TENANT='consumers') -> normally
# 'anonymous'. Corporate account (ONEDRIVE_TENANT='organizations' or a real
# tenant id) -> 'organization'.
ONEDRIVE_SHARE_SCOPE = config('ONEDRIVE_SHARE_SCOPE', default='organization')

# ============================================================
# ENCRYPTION AT REST — OneDrive tokens (SYSPCC-016)
# ============================================================
# Fernet key (cryptography.fernet) used by apps.core.fields.EncryptedTextField
# to encrypt OneDriveToken.access_token / refresh_token at rest. Generate a
# dedicated key with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
#
# If unset, apps.core.fields derives a deterministic key from SECRET_KEY so
# the app works without extra config in dev. PRODUCTION MUST set this
# explicitly to a dedicated key — SECRET_KEY also signs JWTs/sessions, so
# reusing it means rotating SECRET_KEY silently breaks decryption of every
# stored token, and a SECRET_KEY leak would also compromise these tokens.
ONEDRIVE_TOKEN_ENCRYPTION_KEY = config('ONEDRIVE_TOKEN_ENCRYPTION_KEY', default='')


# ============================================================
# SUNAT RUC API (apisperu.com)
# ============================================================

RUC_API_URL = 'https://dniruc.apisperu.com/api/v1/ruc/'
RUC_API_TOKEN = config('RUC_API_TOKEN', default='')


# ============================================================
# INTERNATIONALIZATION
# ============================================================

LANGUAGE_CODE = 'es-pe'
TIME_ZONE = 'America/Lima'
USE_I18N = True
USE_TZ = True


# ============================================================
# STATIC & MEDIA FILES
# ============================================================

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'


# ============================================================
# DEFAULT PRIMARY KEY
# ============================================================

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# ============================================================
# SECURITY HARDENING (base defaults, overridden per environment)
# ============================================================

# FIX (hardening): Prevent browsers from MIME-sniffing content type
SECURE_CONTENT_TYPE_NOSNIFF = True

# FIX (hardening): Deny embedding in iframes to prevent clickjacking
X_FRAME_OPTIONS = 'DENY'

# ============================================================
# CSRF (SYSPCC-015)
# ============================================================
# Auth is cookie-based JWT (CookieJWTAuthentication), so Django's CSRF
# protection must stay active for state-changing requests — see
# apps.core.authentication.CookieJWTAuthentication.enforce_csrf().
#
# CSRF_COOKIE_HTTPONLY must be False: the SPA reads `csrftoken` via JS and
# echoes it back as the `X-CSRFToken` header (double-submit pattern). This is
# NOT a secret — pairing it with an httpOnly-protected value would defeat the
# pattern, not strengthen it. Do not set this to True.
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_NAME = 'csrftoken'  # Django default, pinned explicitly per the frontend contract
CSRF_HEADER_NAME = 'HTTP_X_CSRFTOKEN'  # Django default -> `X-CSRFToken` header, pinned explicitly
# CSRF_COOKIE_SECURE stays at the Django default (False) here; production.py
# turns it on since the site is only ever served over HTTPS there.
#
# When the SPA is served from a different origin than the API (e.g. Vite dev
# server on :5173 vs Django on :8000), Django's origin check rejects every
# state-changing request unless that origin is trusted. Empty by default;
# development.py sets the local dev origins, production sets its own via env.
CSRF_TRUSTED_ORIGINS = config(
    'CSRF_TRUSTED_ORIGINS',
    default='',
    cast=lambda v: [s.strip() for s in v.split(',') if s.strip()],
)


# ============================================================
# LOGGING
# ============================================================

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {asctime} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
        'apps': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
    },
}
