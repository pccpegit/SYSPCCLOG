# RQ System — Security Architecture Design

**System:** Supply Request Management System (RQ System)
**Stack:** Django 5 + DRF + React + PostgreSQL
**Context:** Internal enterprise application
**Date:** 2026-03-07

---

## 1. Role-Based Access Control (RBAC)

### 1.1 Role Definitions

| Role | Code | Description |
|------|------|-------------|
| Usuario | `REQUESTER` | Creates supply requests, confirms delivery conformity |
| Residente de Proyecto | `PROJECT_RESIDENT` | Reviews technical specs, gives initial approval |
| Control de Proyecto | `PROJECT_CONTROL` | Reviews budget, classifies requests |
| Gerente General | `GENERAL_MANAGER` | Approves additionals and cost overruns |
| Coordinador Logístico | `LOGISTICS` | Stock check, procurement, supplier management |
| Almacén Central | `CENTRAL_WAREHOUSE` | Receives materials, quality control |
| Almacén de Obra | `SITE_WAREHOUSE` | Delivers to site, updates records |
| Administrador | `ADMIN` | Full system access, user management |

### 1.2 Permission Matrix

| Action | REQUESTER | RESIDENT | CONTROL | GM | LOGISTICS | WAREHOUSE_C | WAREHOUSE_S | ADMIN |
|--------|-----------|----------|---------|-----|-----------|-------------|-------------|-------|
| **Requests** | | | | | | | | |
| Create RQ | OWN | YES | - | - | - | - | - | YES |
| View own RQ | YES | - | - | - | - | - | - | YES |
| View project RQs | - | PROJECT | ALL | ALL | ALL | ALL | ALL | ALL |
| Edit draft RQ | OWN | - | - | - | - | - | - | YES |
| Delete draft RQ | OWN | - | - | - | - | - | - | YES |
| Submit RQ | OWN | - | - | - | - | - | - | YES |
| Cancel RQ | OWN | - | - | - | - | - | - | YES |
| **Approvals** | | | | | | | | |
| Technical review | - | YES | - | - | - | - | - | YES |
| Budget review | - | - | YES | - | - | - | - | YES |
| Classify request | - | - | YES | - | - | - | - | YES |
| GM approve/reject | - | - | - | YES | - | - | - | YES |
| Cost overrun approve | - | - | - | YES | - | - | - | YES |
| **Procurement** | | | | | | | | |
| Check stock | - | - | - | - | YES | - | - | YES |
| Request quotations | - | - | - | - | YES | - | - | YES |
| Select supplier | - | - | - | - | YES | - | - | YES |
| Generate PO | - | - | - | - | YES | - | - | YES |
| View POs | - | - | - | READ | YES | - | - | YES |
| **Warehouse** | | | | | | | | |
| Receive materials | - | - | - | - | - | YES | - | YES |
| Quality check | - | - | - | - | - | YES | - | YES |
| Dispatch to site | - | - | - | - | - | - | YES | YES |
| Confirm delivery | - | - | - | - | - | - | YES | YES |
| **User Actions** | | | | | | | | |
| Confirm conformity | OWN | - | - | - | - | - | - | YES |
| Raise claim | OWN | - | - | - | - | - | - | YES |
| **Admin** | | | | | | | | |
| Manage users | - | - | - | - | - | - | - | YES |
| View audit logs | - | - | - | YES | - | - | - | YES |
| System settings | - | - | - | - | - | - | - | YES |

### 1.3 Django Permission Implementation

```python
# apps/accounts/permissions.py

from rest_framework.permissions import BasePermission
from apps.accounts.models import Role


class HasRole(BasePermission):
    """
    Generic role-based permission check.
    Usage: permission_classes = [HasRole]
    Set `required_roles` on the view.
    """
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        required_roles = getattr(view, 'required_roles', [])
        if not required_roles:
            return True  # No role restriction
        # ADMIN always has access
        if request.user.has_role(Role.ADMIN):
            return True
        return request.user.has_any_role(required_roles)


class IsRequestOwner(BasePermission):
    """Object-level: only the request creator can modify."""
    def has_object_permission(self, request, view, obj):
        if request.user.has_role(Role.ADMIN):
            return True
        return obj.requested_by == request.user


class IsProjectMember(BasePermission):
    """Object-level: user must be assigned to the request's project."""
    def has_object_permission(self, request, view, obj):
        if request.user.has_role(Role.ADMIN):
            return True
        project = getattr(obj, 'project', None)
        if project is None:
            return False
        return project.resident == request.user


class CanPerformTransition(BasePermission):
    """
    Check if user's role can perform the requested action
    on the request's current status. Delegates to state machine.
    """
    def has_object_permission(self, request, view, obj):
        from apps.requests.state_machine import TRANSITION_MAP
        action = request.data.get('action')
        transitions = TRANSITION_MAP.get(obj.status, [])
        for to_status, allowed_roles, action_name in transitions:
            if action_name == action:
                return request.user.has_any_role(allowed_roles)
        return False
```

### 1.4 Double Enforcement Pattern

Permissions are checked at TWO levels:

1. **View level** (DRF `permission_classes`): Quick rejection of unauthorized users
2. **Service level** (`RequestTransitionService.execute()`): Business logic validation

```python
# View level
class RequestActionView(APIView):
    permission_classes = [IsAuthenticated, CanPerformTransition]

    def post(self, request, pk):
        supply_request = get_object_or_404(SupplyRequest, pk=pk)
        self.check_object_permissions(request, supply_request)
        # Service level also validates
        service = RequestTransitionService(supply_request, request.user)
        result = service.execute(
            action=request.data['action'],
            comments=request.data.get('comments', '')
        )
        return Response(RequestSerializer(result).data)
```

---

## 2. Secure File Uploads

### 2.1 File Type Whitelist

```python
# common/validators.py

import magic
from django.core.exceptions import ValidationError

ALLOWED_EXTENSIONS = {'.pdf', '.xlsx', '.xls', '.jpg', '.jpeg', '.png'}
ALLOWED_MIME_TYPES = {
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'image/jpeg',
    'image/png',
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def validate_upload(file):
    """Validate file extension, MIME type, and size."""
    # 1. Check file size
    if file.size > MAX_FILE_SIZE:
        raise ValidationError(f"File exceeds maximum size of 10MB.")

    # 2. Check extension (whitelist)
    import os
    ext = os.path.splitext(file.name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValidationError(
            f"File type '{ext}' not allowed. "
            f"Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # 3. Verify actual MIME type (not just Content-Type header)
    file_mime = magic.from_buffer(file.read(2048), mime=True)
    file.seek(0)  # Reset file pointer
    if file_mime not in ALLOWED_MIME_TYPES:
        raise ValidationError(
            f"File content type '{file_mime}' does not match allowed types."
        )

    return True
```

### 2.2 Secure File Storage

```python
# common/storage.py

import uuid
import os


def secure_upload_path(instance, filename):
    """
    Generate a secure upload path:
    - UUID filename prevents path traversal
    - Organized by year/month
    - Original filename stored in DB, not filesystem
    """
    ext = os.path.splitext(filename)[1].lower()
    new_filename = f"{uuid.uuid4().hex}{ext}"
    from django.utils import timezone
    now = timezone.now()
    return f"uploads/{now.year}/{now.month:02d}/{new_filename}"
```

### 2.3 Excel Parsing Security

```python
# apps/requests/excel_handler.py

import openpyxl
from django.core.exceptions import ValidationError

MAX_ROWS = 500
MAX_COLUMNS = 20


def parse_excel_safely(file):
    """
    Securely parse Excel file for supply request items.
    Prevents: formula injection, excessive data, macro execution.
    """
    try:
        # read_only=True: prevents macro execution
        # data_only=True: returns values, not formulas
        wb = openpyxl.load_workbook(file, read_only=True, data_only=True)
    except Exception:
        raise ValidationError("Invalid Excel file.")

    ws = wb.active
    if ws.max_row > MAX_ROWS:
        raise ValidationError(f"Excel file exceeds {MAX_ROWS} rows.")
    if ws.max_column > MAX_COLUMNS:
        raise ValidationError(f"Excel file exceeds {MAX_COLUMNS} columns.")

    items = []
    for row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=1):
        if row_num > MAX_ROWS:
            break
        if all(cell is None for cell in row):
            continue

        description = _sanitize_cell(row[0])
        quantity = _parse_number(row[1])
        unit = _sanitize_cell(row[2])
        specifications = _sanitize_cell(row[3]) if len(row) > 3 else ""

        if not description or quantity is None:
            continue

        items.append({
            "line_number": len(items) + 1,
            "description": description,
            "quantity": quantity,
            "unit": unit or "UND",
            "specifications": specifications,
        })

    wb.close()
    return items


def _sanitize_cell(value):
    """Remove formula injection characters from cell values."""
    if value is None:
        return ""
    text = str(value).strip()
    # Prevent formula injection (CSV injection / DDE)
    if text and text[0] in ('=', '+', '-', '@', '\t', '\r', '\n'):
        text = "'" + text  # Prefix with single quote
    return text[:500]  # Limit length


def _parse_number(value):
    """Safely parse a numeric value."""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None
```

### 2.4 Upload Endpoint Security

```python
# Django settings
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10MB in-memory limit
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FILES = 5

# MEDIA_ROOT should be OUTSIDE the web-accessible static directory
MEDIA_ROOT = '/var/data/syspcclog/uploads/'  # NOT inside static/
```

---

## 3. API Protection

### 3.1 JWT Authentication

```python
# config/settings/base.py

from datetime import timedelta

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),     # Work day
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,                   # New refresh on each use
    "BLACKLIST_AFTER_ROTATION": True,                 # Old refresh invalidated
    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
    "TOKEN_OBTAIN_SERIALIZER":
        "apps.accounts.serializers.CustomTokenObtainPairSerializer",
}
```

### 3.2 Rate Limiting

```python
# config/settings/base.py

REST_FRAMEWORK = {
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "5/minute",        # Login attempts
        "user": "100/minute",      # Authenticated users
        "uploads": "10/minute",    # File uploads
    },
}
```

### 3.3 CORS Configuration

```python
# config/settings/base.py

CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",      # React dev server
    "http://localhost:5173",      # Vite dev server
]
# Production: set to actual frontend domain

CORS_ALLOW_CREDENTIALS = True     # For httpOnly refresh token cookie
CORS_ALLOW_METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
CORS_ALLOW_HEADERS = [
    "accept", "authorization", "content-type", "x-csrftoken",
]
```

### 3.4 CSRF Protection

```python
# For JWT-based API (stateless), CSRF is enforced for cookie-based auth:
CSRF_COOKIE_HTTPONLY = False       # Frontend needs to read CSRF token
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
]

# Session cookie (if admin panel is used)
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = True      # Production only (HTTPS)
```

### 3.5 Input Validation & Sanitization

```python
# apps/requests/serializers.py

from rest_framework import serializers
import bleach


class SupplyRequestSerializer(serializers.ModelSerializer):
    description = serializers.CharField(max_length=2000)
    justification = serializers.CharField(max_length=5000, required=False)

    def validate_description(self, value):
        # Strip HTML tags to prevent XSS
        return bleach.clean(value, tags=[], strip=True)

    def validate_justification(self, value):
        return bleach.clean(value, tags=[], strip=True)


class RequestItemSerializer(serializers.ModelSerializer):
    description = serializers.CharField(max_length=500)
    quantity = serializers.DecimalField(
        max_digits=12, decimal_places=3,
        min_value=0.001  # Prevent zero/negative quantities
    )
    specifications = serializers.CharField(max_length=1000, required=False)

    def validate_description(self, value):
        return bleach.clean(value, tags=[], strip=True)
```

### 3.6 SQL Injection Prevention

Django ORM provides parameterized queries by default. Rules:
- **NEVER** use raw SQL with string formatting
- **ALWAYS** use ORM querysets or `.raw()` with params
- **ALWAYS** use `django.db.connection.cursor()` with parameterized queries

```python
# BAD - Never do this:
# SupplyRequest.objects.raw(f"SELECT * FROM requests WHERE id = {user_input}")

# GOOD - Always use parameterized:
SupplyRequest.objects.filter(id=user_input)
# or if raw SQL is needed:
SupplyRequest.objects.raw("SELECT * FROM requests WHERE id = %s", [user_input])
```

### 3.7 Error Handling (No Data Leakage)

```python
# common/exceptions.py

from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status
import logging

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is None:
        # Unhandled exception - log details, return generic message
        logger.exception("Unhandled exception", exc_info=exc)
        return Response(
            {"detail": "An internal error occurred."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # Never expose stack traces or internal paths
    if response.status_code >= 500:
        response.data = {"detail": "An internal error occurred."}

    return response
```

```python
# config/settings/base.py
REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "common.exceptions.custom_exception_handler",
}

# Production: DEBUG = False (never expose debug info)
```

### 3.8 Security Headers Middleware

```python
# config/settings/base.py

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    # ... other middleware
]

# Security headers
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# Production HTTPS settings
SECURE_SSL_REDIRECT = True           # Production only
SECURE_HSTS_SECONDS = 31536000       # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
```

### 3.9 Audit Logging

```python
# common/middleware.py

import logging
from django.utils.deprecation import MiddlewareMixin

audit_logger = logging.getLogger("audit")


class AuditLogMiddleware(MiddlewareMixin):
    """Log all mutating API requests for security audit."""

    MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    def process_response(self, request, response):
        if request.method in self.MUTATING_METHODS:
            user = getattr(request, 'user', None)
            user_id = user.id if user and user.is_authenticated else "anonymous"
            audit_logger.info(
                "API_AUDIT",
                extra={
                    "user_id": user_id,
                    "method": request.method,
                    "path": request.path,
                    "status_code": response.status_code,
                    "ip": self._get_client_ip(request),
                }
            )
        return response

    def _get_client_ip(self, request):
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")
```

---

## 4. Data Protection

### 4.1 Sensitive Data Identification

| Data Type | Sensitivity | Protection |
|-----------|-------------|------------|
| User passwords | HIGH | bcrypt hash (Django default) |
| JWT tokens | HIGH | Short-lived, httpOnly cookies for refresh |
| RUC/Tax IDs (suppliers) | MEDIUM | Access restricted to Logistics role |
| Budget amounts | MEDIUM | Access restricted to Control + GM |
| File uploads | MEDIUM | Stored outside web root, access via API only |
| Email addresses | LOW-MEDIUM | Not publicly exposed |

### 4.2 Encryption

- **In transit:** HTTPS/TLS (mandatory in production)
- **At rest:** PostgreSQL encryption (transparent data encryption if needed)
- **Passwords:** Django's default PBKDF2 with SHA256 (or bcrypt via `django[argon2]`)

### 4.3 Database Security

```python
# Production database with restricted permissions
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "syspcclog",
        "USER": "syspcclog_app",     # App-specific user, not superuser
        "PASSWORD": "...",           # From environment variable
        "HOST": "localhost",
        "PORT": "5432",
        "OPTIONS": {
            "sslmode": "require",    # Encrypted connection
        },
    }
}

# Always load secrets from environment
import os
DATABASES["default"]["PASSWORD"] = os.environ["DB_PASSWORD"]
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
```

---

## 5. Security Checklist for MVP

### P0 — Must Have (Block MVP if missing)

- [ ] JWT authentication with access/refresh token flow
- [ ] Role-based permission classes on all API endpoints
- [ ] Double enforcement: view-level + service-level role checks
- [ ] File upload validation (extension whitelist + MIME type check + size limit)
- [ ] Input sanitization on all text fields (prevent XSS)
- [ ] Django ORM for all queries (prevent SQL injection)
- [ ] CORS restricted to frontend origin only
- [ ] `DEBUG = False` in production
- [ ] Secrets from environment variables (not in code)
- [ ] Custom error handler (no stack traces in responses)
- [ ] HTTPS in production
- [ ] Password hashing (Django default)
- [ ] Rate limiting on login endpoint
- [ ] Secure file storage (outside web root, UUID filenames)

### P1 — Should Have (Complete within 2 weeks after MVP)

- [ ] Refresh token rotation with blacklisting
- [ ] Audit logging middleware (all mutating requests)
- [ ] Account lockout after N failed login attempts
- [ ] CSRF protection for cookie-based auth flows
- [ ] Security headers (X-Frame-Options, HSTS, Content-Type-Nosniff)
- [ ] Excel parsing security (read_only, data_only, row limits)
- [ ] Rate limiting on file upload endpoints
- [ ] Session timeout (JWT access token expiry = 8 hours)
- [ ] Object-level permissions (user can only edit own requests)
- [ ] Input length limits on all serializer fields

### P2 — Nice to Have (Post-MVP enhancements)

- [ ] Content Security Policy (CSP) headers
- [ ] Automated security scanning (bandit, safety)
- [ ] Penetration testing
- [ ] Database user with minimum required privileges
- [ ] Log aggregation and security alerting
- [ ] Two-factor authentication (2FA) for GM role
- [ ] IP allowlisting for admin endpoints
- [ ] Dependency vulnerability scanning (dependabot)
- [ ] File virus scanning (ClamAV integration)
- [ ] Database query monitoring for suspicious patterns
- [ ] Automated backup encryption

---

## 6. Additional Requirements

```
# Security-related pip packages
djangorestframework-simplejwt>=5.3
django-cors-headers>=4.3
python-magic>=0.4      # MIME type detection
bleach>=6.1             # HTML sanitization
```
