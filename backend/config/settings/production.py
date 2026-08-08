"""
Production settings for SYSPCCLOG project.
"""

from .base import *  # noqa: F401, F403
from decouple import config

DEBUG = False

# ============================================================
# DATABASE — PostgreSQL (DigitalOcean Managed Database)
# ============================================================

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
            'sslmode': 'require',
        },
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

# Production email
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = config('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = True
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='noreply@pcc.com.pe')

# Static files
STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.ManifestStaticFilesStorage'

# FIX-18/19: Cookie security for production
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_AGE = 3600  # 1 hour session lifetime
CSRF_COOKIE_HTTPONLY = True

# SYSPCC-011 (CSRF hardening, evaluated): Django already defaults both of
# these to 'Lax', matching the SameSite='Lax' already set on the access_token/
# refresh_token cookies in apps/core/views/auth.py. Pinning them explicitly
# here is a no-op behavior-wise but stops a future Django default change (or a
# stray override) from silently weakening this. This is NOT a substitute for
# real CSRF-token enforcement — CookieJWTAuthentication still never calls
# enforce_csrf (see apps/core/authentication.py), so a same-site form POST from
# a malicious page could still ride the cookies for state-changing requests.
# Turning enforce_csrf on requires the React client to start sending
# X-CSRFToken on every mutating request, which it does not do today — that is
# a coordinated frontend+backend change and is deferred as a follow-up ticket
# rather than done here, to avoid breaking the app in production.
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
