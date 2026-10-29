# SYSPCC — Diseño de Seguridad

**Sistema:** Sistema de Gestión de Requerimientos de Abastecimiento (SYSPCC)
**Stack:** Django 5.1 + DRF + React 19 | SQLite (desarrollo) / PostgreSQL (producción)
**Contexto:** aplicación empresarial interna
**Fecha:** 2026-10-29 (actualizado al código de `develop`; incluye los endurecimientos de SYSPCC-006 a SYSPCC-026)

Cada control se cita con el archivo donde está implementado. Lo que no está implementado figura como pendiente en la sección 5.

---

## 1. Control de acceso basado en roles (RBAC)

### 1.1 Roles

`RoleChoices` (`backend/apps/core/enums.py`) define 13 roles. Se asignan con `UserRole` (un usuario puede tener varios, opcionalmente acotados a un proyecto o departamento). No hay rol de "Administrador" de negocio: la administración del sistema exige `is_superuser`.

| Rol | Código | Responsabilidad |
|-----|--------|-----------------|
| Solicitante | `REQUESTER` | Crea RQ, da conformidad o reclama |
| Residente de Proyecto | `PROJECT_RESIDENT` | Validación técnica y adicionales (OPS) |
| Control de Proyecto | `PROJECT_CONTROL` | Clasificación presupuestal y costo de cotización (OPS) |
| Gerente General | `GENERAL_MANAGER` | Adicionales, fuera de plan, sobrecostos; lectura de RR. HH. |
| Coordinador Logístico | `LOGISTICS_COORDINATOR` | Stock, compras, recepción, QC, despacho, cierre (OPS) |
| Almacén Central | `CENTRAL_WAREHOUSE` | Despacho desde stock, registros de almacén, importación de inventario |
| Almacén de Obra | `SITE_WAREHOUSE` | Recepción en obra (OPS), almacén de obra |
| Jefe Directo | `DIRECT_SUPERVISOR` | Validación administrativa (ADM) |
| Gerente Administrativo | `ADMIN_MANAGER` | Plan anual y costo de cotización (ADM); pasajes |
| Supervisor Logístico | `LOGISTICS_SUPERVISOR` | Stock, compras, recepción, QC, despacho, cierre (ADM) |
| Jefe Logístico | `LOGISTICS_CHIEF` | Comparación y selección de cotizaciones (ADM); importación de inventario |
| Gestor de Pasajes | `PASAJES_MANAGER` | Módulo de pasajes |
| Gestor de RR. HH. | `HR_MANAGER` | Contratos y análisis de CVs |

### 1.2 Matriz de permisos (backend)

| Recurso / acción | Quién | Implementación |
|------------------|-------|----------------|
| Ver RQ | Staff/superuser y roles amplios (`GENERAL_MANAGER`, `LOGISTICS_*`, `CENTRAL_WAREHOUSE`): todos; `PROJECT_RESIDENT`, `PROJECT_CONTROL`, `SITE_WAREHOUSE`: su proyecto; `DIRECT_SUPERVISOR`, `ADMIN_MANAGER`: su departamento; resto: solo los propios | `get_accessible_requests_queryset` (`apps/rq/permissions.py`) |
| Crear RQ | Cualquier autenticado | `RequestViewSet` |
| Editar / borrar RQ | Solo en `DRAFT` y dentro del alcance | `RequestViewSet.update` / `destroy` |
| Acción de workflow | Usuario con el `acting_role` declarado y el rol exigido por `TRANSITIONS` | `CanPerformWorkflowAction` + `WorkflowEngine` |
| Confirmar productos de las líneas (`update-items`) y ver disponibilidad (`stock-availability`) | `LOGISTICS_COORDINATOR`, `LOGISTICS_SUPERVISOR`, `LOGISTICS_CHIEF` | `IsLogisticsStaff` |
| Cotizaciones y OC (escritura) | Logística | `IsLogisticsStaff`; lectura filtrada por RQ accesible |
| Proveedores (escritura) | `is_staff` | `IsAdminOrReadOnly` |
| Reclamos (editar / borrar) | Logística | `IsLogisticsStaff` |
| Adjuntos | Staff y logística: todos; resto: los de sus RQ | `AttachmentViewSet.get_queryset` (SYSPCC-006) |
| Módulo almacén | 2 roles de almacén + 3 de logística | `IsWarehouseRole` (`apps/warehouse/permissions.py`) |
| Importar inventario, asignar ubicaciones, vincular personal | `CENTRAL_WAREHOUSE`, `LOGISTICS_CHIEF` | `CanImportInventory`, `CanAssignLocations`, `CanLinkPersonal` |
| Entrega de EPP / entregas a personas | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE` (`SITE_WAREHOUSE` solo desde el almacén de obra) | `CanDeliverEPP`, `movement_scope_error` |
| Buscar trabajadores (almacén) | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE`, `LOGISTICS_CHIEF` | `CanLookupPersonal` |
| Fichas completas de `Personal` | `ADMIN_MANAGER`, `PASAJES_MANAGER`, `GENERAL_MANAGER` o `is_staff` | `IsHRManager` |
| Autocompletar por DNI (pasajes) | `PASAJES_MANAGER`, `ADMIN_MANAGER` o `is_staff` | `IsPasajesStaff` |
| Pasajes | `ADMIN_MANAGER`, `GENERAL_MANAGER`, `PASAJES_MANAGER` o `is_staff` | `IsAdminOrAdminManager` |
| RR. HH. escritura / lectura | `HR_MANAGER` / `HR_MANAGER` + `GENERAL_MANAGER`, sin bypass por `is_staff` | `IsHRDocumentsManager`, `IsHRDocumentsReader` |
| Usuarios, roles y proyectos (escritura) | `is_superuser` | `IsSuperUser` (SYSPCC-018) |
| Configurar OneDrive | `is_staff` o `is_superuser` | `IsAdminUser` local de `apps/warehouse/views.py` |
| Tickets de soporte | Cada usuario los suyos; `is_staff` todos | `TicketViewSet.get_queryset` |
| Esquema y Swagger (`/api/schema/`, `/api/docs/`, `/api/redoc/`) | `is_staff` | `IsAdminUser` en `config/urls.py` |

Los roles siempre se comprueban contra `UserRole` en la base de datos. Las clases de `apps/warehouse/permissions.py` y las de RR. HH. no conceden bypass por `is_staff` / `is_superuser`.

### 1.3 Implementación

```python
# apps/core/permissions.py
class HasRole(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        required_roles = getattr(view, 'role_required', None)
        if required_roles is None:
            return True
        if isinstance(required_roles, str):
            required_roles = [required_roles]
        return request.user.user_roles.filter(role__in=required_roles).exists()
```

```python
# apps/rq/permissions.py
class CanPerformWorkflowAction(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.user_roles.exists()

    def has_object_permission(self, request, view, obj):
        acting_role = request.data.get('acting_role')
        if not acting_role:
            return False
        return request.user.user_roles.filter(role=acting_role).exists()
```

### 1.4 Doble verificación en el workflow

1. **Vista** (`RequestViewSet.get_permissions`): `CanPerformWorkflowAction` rechaza con 403 si el usuario no tiene el `acting_role` que declara. El RQ se obtiene con `get_object()` sobre el queryset con alcance (un RQ ajeno responde 404).
2. **Servicio** (`WorkflowEngine.execute`): `_validate_acting_role()` repite la verificación y `_check_role_permission()` exige el `required_role` de la transición. El RQ se relee con `select_for_update()` para evitar dobles aprobaciones concurrentes (SYSPCC-007).

La cancelación universal no fija `required_role`: la puede ejecutar cualquier usuario que vea el RQ y declare un rol que tenga asignado.

---

## 2. Carga segura de archivos

### 2.1 Adjuntos de RQ (`apps/rq/serializers/attachment.py`)

- Extensiones permitidas: `.pdf`, `.xlsx`, `.xls`, `.jpg`, `.jpeg`, `.png`, `.doc`, `.docx`.
- Tamaño máximo: 10 MB.
- Tipo real verificado con `python-magic` (`magic.from_buffer`) contra la lista de MIME de cada extensión.
- El archivo se guarda con `default_storage` bajo `attachments/` y la API nunca expone `file_path`: entrega un `download_url` calculado (URL firmada y temporal si se usa S3/Spaces).
- Si falla la creación del registro, el archivo ya guardado se borra (SYSPCC-013).

### 2.2 Importación del Excel de inventario (`apps/warehouse/services/imports/parser.py`)

El libro se trata como entrada hostil y con datos personales:
- Antes de abrirlo: extensión, content type, tamaño (máx. 10 MB), firma ZIP, número de entradas (máx. 500), path traversal, tamaño descomprimido (máx. 25 MB) y razón de compresión (zip bomb), macros y declaraciones DTD/entidades (XXE).
- Lectura con `openpyxl` en `read_only=True` y `data_only=True`: las fórmulas no se evalúan y los vínculos externos no se cargan.
- Límite de 5000 filas de datos por hoja.
- Flujo en dos pasos (previsualización y confirmación atómica e idempotente); las respuestas llevan `Cache-Control: no-store` y nada registra nombres, filas ni nombres de archivo (`apps/warehouse/views_imports.py`).
- Throttle `warehouse_import` (10/hora) en la subida; la tarea diaria `warehouse.purge_stale_imports` borra los libros guardados.

### 2.3 Plantillas y CVs de RR. HH.

- Plantillas Word (`apps/hr/services/template_service.py`): tamaño máximo `HR_TEMPLATE_MAX_BYTES` (5 MB por defecto) e inspección del ZIP (`inspect_zip`: máx. 1000 entradas, 50 MB descomprimidos, razón 100) que rechaza objetos incrustados, macros, plantillas adjuntas y campos DDE/INCLUDE/LINK.
- CVs (`apps/hr/services/cv_file_validation.py`): tipo real por libmagic (se ignoran la extensión y el content type del cliente), extensiones `.pdf`, `.docx`, `.jpg`, `.jpeg`, `.png`, máx. 10 MB por archivo y 25 archivos por petición (`HR_CV_MAX_FILE_BYTES`, `HR_CV_MAX_FILES_PER_REQUEST`), límite de páginas y de píxeles.

### 2.4 Almacenamiento

- `MEDIA_URL` solo lo sirve Django cuando `DEBUG=True` (`config/urls.py`).
- En producción, si se define `AWS_STORAGE_BUCKET_NAME`, los archivos van a un bucket S3/Spaces privado con URLs firmadas (`querystring_auth`, expiración `AWS_QUERYSTRING_EXPIRE`, 1 h por defecto) (`config/settings/production.py`).
- Los documentos de RR. HH. usan `PrivateDocumentStorage` (`apps/hr/storage.py`): fuera de `MEDIA_ROOT` (`HR_PRIVATE_ROOT`), permisos `0600` / `0700` y sin URL pública; solo salen por vistas con permiso. `HR_FILE_STORAGE` permite cambiarlo por un bucket privado.

---

## 3. Protección de la API

### 3.1 Autenticación JWT en cookies

```python
# config/settings/base.py
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'TOKEN_OBTAIN_SERIALIZER': 'apps.core.serializers.auth.CustomTokenObtainPairSerializer',
}
```

- `POST /api/v1/auth/login/` (`CustomTokenObtainPairView`) fija `access_token` (15 min) y `refresh_token` (1 día) como cookies `httponly`, `SameSite=Lax`, `secure` cuando `DEBUG=False`; el cuerpo solo trae el perfil.
- `CookieJWTAuthentication` (`apps/core/authentication.py`) es la única clase de autenticación registrada y lee el token de la cookie.
- `POST /api/v1/auth/logout/` agrega el refresh token a la blacklist y borra las cookies.
- Cambio de contraseña forzado (SYSPCC-018): mientras `must_change_password` sea verdadero, toda petición fuera de una lista corta (`users/me/`, `me/change-password/`, `auth/logout/`, `auth/csrf/`, `auth/token/refresh/`) responde 403 con código `must_change_password`.
- Limitación conocida: `auth/token/refresh/` usa el `TokenRefreshView` estándar, que lee `refresh` del cuerpo y no de la cookie; el frontend no lo envía, así que la sesión no se renueva automáticamente (ver `apps/core/tests/test_must_change_password_gate.py`).
- Contraseñas: validadores de Django con longitud mínima 12 (`AUTH_PASSWORD_VALIDATORS`).

### 3.2 Límites de tasa (throttling)

```python
# config/settings/base.py
'DEFAULT_THROTTLE_CLASSES': ['apps.core.throttling.AnonThrottle', 'apps.core.throttling.UserThrottle'],
'DEFAULT_THROTTLE_RATES': {
    'anon': '30/min', 'user': '200/min',
    'login': '5/min',           # por IP, solo en login
    'login_user': '10/min',     # por nombre de usuario, solo en login
    'hr_assistant': '20/min', 'hr_download': '60/min',
    'hr_cv_upload': '60/min', 'hr_cv_progress': '90/min', 'hr_cv_posting': '20/min',
    'warehouse_lookup': '120/min', 'warehouse_import': '10/hour',
},
```

La búsqueda de catálogo para RQ tiene además el throttle `rq_catalog` (120/min por defecto, `apps/rq/throttling.py`). Los contadores viven en `THROTTLE_CACHE_ALIAS`; si en producción se activa `DJANGO_REDIS_IGNORE_EXCEPTIONS`, pasan a una caché local del proceso para que el límite de login no quede abierto si Redis cae (`production.py`, `apps/core/throttling.py`). `development.py` usa límites más altos.

### 3.3 CORS

```python
# config/settings/base.py
CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS',
                              default='http://localhost:5173,http://localhost:3000', ...)
CORS_ALLOW_CREDENTIALS = True
```

`development.py` usa `CORS_ALLOW_ALL_ORIGINS = True`.

### 3.4 CSRF (SYSPCC-015)

- Como la autenticación va en cookies, `CookieJWTAuthentication.enforce_csrf()` aplica la verificación de `CsrfViewMiddleware` a todo POST/PUT/PATCH/DELETE autenticado.
- Patrón double-submit: el SPA llama a `GET /api/v1/auth/csrf/` al iniciar, lee la cookie `csrftoken` y la reenvía en el header `X-CSRFToken` (`frontend/src/api/client.js`).
- `CSRF_COOKIE_HTTPONLY = False` a propósito en todos los entornos (el SPA debe leer el token); `CSRF_COOKIE_SAMESITE = 'Lax'`; `CSRF_COOKIE_SECURE = True` en producción; `CSRF_TRUSTED_ORIGINS` por variable de entorno (en desarrollo, los orígenes de Vite).

### 3.5 Validación de entradas

- Serializadores DRF con campos explícitos y validaciones de negocio (por ejemplo `RequestItem.quantity` ≥ 0.001, línea vinculada o fuera de catálogo pero no ambas, límite de líneas por RQ, frente `OFICINA CENTRAL` solo en flujo ADM).
- Restricciones en base de datos: `inventory_stock_quantity_gte_0`, `request_item_not_linked_and_off_catalog`, unicidad de `rq_number`, `po_number`, `dedup_key`.
- `RejectNulQueryParamsMixin` (`apps/warehouse/query_guard.py`) rechaza bytes NUL en los query params del almacén (PostgreSQL no los admite).
- No se usa sanitización HTML (`bleach` no es dependencia del proyecto); React escapa el contenido al renderizar.

### 3.6 Inyección SQL

Todo el acceso a datos usa el ORM de Django. El único SQL directo es `SELECT 1` en `HealthCheckMiddleware` (`apps/core/middleware.py`).

### 3.7 Manejo de errores

```python
# apps/core/exceptions.py
def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        error_data = {'error': True, 'status_code': response.status_code}
        ...  # detail y code normalizados
        response.data = error_data
    return response
```

Unifica el formato de los errores que DRF maneja. Las excepciones no controladas siguen el flujo normal de Django (500 sin traza cuando `DEBUG=False`). Las vistas críticas (`execute_action`, `update_items`) registran el error con contexto (`logger.exception`) antes de re-lanzarlo.

### 3.8 Cabeceras de seguridad y transporte

```python
# config/settings/base.py
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# config/settings/production.py
DEBUG = False
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_SSL_REDIRECT = config('SECURE_SSL_REDIRECT', default=True, cast=bool)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
```

`production.py` también define `SECURE_BROWSER_XSS_FILTER = True`, pero Django 5.1 ya no emite esa cabecera (la opción no tiene efecto). Otras medidas: admin en `/mgmt-panel/` (no `/admin/`), `Cache-Control: no-store` en todo `/api/v1/hr/*` (`HRNoStoreMiddleware`) y en las importaciones del almacén, y `HealthCheckMiddleware` en `/healthz/` como primer middleware.

### 3.9 Auditoría

No hay middleware de auditoría de peticiones. La trazabilidad está en los datos:
- `Approval`: cada acción del workflow con usuario, rol, estado previo y nuevo (rol `SYSTEM` en las automáticas).
- `ActivityLog`: bitácora por RQ (el campo `ip_address` existe pero el código no lo llena).
- `DocumentEvent`: creación, edición, emisión, anulación, descarga y PDF de documentos de RR. HH.
- `TicketComment` con `is_status_change` para los cambios de estado de tickets.
- Logs estructurados (`logger.warning/exception` con `extra`) en workflow, `update-items`, logout, OneDrive y tareas Celery; los módulos con datos personales (importación, CVs) registran solo contadores.

---

## 4. Protección de datos

### 4.1 Datos sensibles

| Dato | Sensibilidad | Protección |
|------|--------------|------------|
| Contraseñas | Alta | Hash de Django (`AUTH_PASSWORD_VALIDATORS`, mínimo 12 caracteres) |
| Tokens JWT | Alta | Cookies httpOnly, vida corta, blacklist al cerrar sesión |
| Tokens de OneDrive | Alta | Cifrados en reposo con Fernet (`EncryptedTextField`, SYSPCC-016) |
| Ficha de personal (DNI, salario, banco, dirección) | Alta | `IsHRManager`; búsquedas del almacén y pasajes devuelven campos reducidos |
| Contratos y CVs | Alta | Almacenamiento privado, roles `HR_MANAGER` / `GENERAL_MANAGER`, `no-store` |
| Libros de inventario importados | Media | `no-store`, purga diaria, sin nombres en logs ni en el reporte de problemas |
| Presupuestos y costos | Media | Alcance de RQ por rol/proyecto/departamento |
| Archivos adjuntos | Media | Alcance por RQ; URL firmada si se usa S3/Spaces |

### 4.2 Cifrado

- **En tránsito:** HTTPS con `SECURE_SSL_REDIRECT` y HSTS en producción; conexión a PostgreSQL con `sslmode=require` por defecto (`verify-ca` / `verify-full` admitidos con CA) y Redis con TLS (`rediss://`) configurable.
- **En reposo:** tokens de OneDrive con Fernet. La clave es `ONEDRIVE_TOKEN_ENCRYPTION_KEY`; si falta, se deriva de `SECRET_KEY` (solo aceptable en desarrollo, `apps/core/fields.py`).
- **Contraseñas:** hasher por defecto de Django.

### 4.3 Base de datos y secretos

```python
# config/settings/production.py (resumen)
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME'), 'USER': config('DB_USER'),
        'PASSWORD': config('DB_PASSWORD'), 'HOST': config('DB_HOST'),
        'PORT': config('DB_PORT', default='25060'),
        'OPTIONS': {'connect_timeout': 10, 'sslmode': DB_SSLMODE, ...},
        'CONN_MAX_AGE': config('DB_CONN_MAX_AGE', default=0, cast=int),
        'CONN_HEALTH_CHECKS': True,
    }
}
```

- `SECRET_KEY` sin valor por defecto: si falta en el entorno, Django no arranca (`base.py`).
- Credenciales de base de datos, Redis, correo, OneDrive, Anthropic y buckets solo por variables de entorno (`python-decouple`); SYSPCC-017 sacó del repositorio el client ID de OneDrive y la contraseña de demo.
- Los comandos de datos de demostración (`seed_demo`, `seed_demo_extra`, `seed_screenshots`) se niegan a correr si `DEBUG` es falso o si `DJANGO_ENV=production` (`apps/core/management/seed_guard.py`).

---

## 5. Estado de los controles

### Implementados

- [x] JWT en cookies httpOnly con access de 15 min y refresh de 1 día
- [x] Rotación y blacklist de refresh tokens (`ROTATE_REFRESH_TOKENS`, `BLACKLIST_AFTER_ROTATION`)
- [x] CSRF obligatorio con autenticación por cookies (SYSPCC-015)
- [x] Permisos por rol en los endpoints y doble verificación en el workflow
- [x] Alcance de lectura de RQ, cotizaciones, OC, reclamos, adjuntos y bitácora (SYSPCC-006, SYSPCC-011)
- [x] Validación de archivos por extensión, tamaño y tipo real (adjuntos, CVs, plantillas, importación)
- [x] Lectura segura de Excel (`read_only`, `data_only`, límites de ZIP y filas)
- [x] Defensa contra inyección de fórmulas en exportaciones Excel (`sanitize_excel_value`, `apps/core/utils/excel.py`) y tope de filas por exportación
- [x] ORM para todas las consultas
- [x] Throttling global, de login (por IP y por usuario) y por módulo
- [x] `DEBUG = False`, HSTS, redirección HTTPS y cookies seguras en producción
- [x] Secretos por variables de entorno; `SECRET_KEY` obligatorio
- [x] Contraseña mínima de 12 caracteres y cambio forzado tras alta o reseteo
- [x] Cifrado en reposo de tokens de OneDrive
- [x] Almacenamiento privado para documentos de RR. HH.
- [x] Locks y restricciones contra condiciones de carrera (SYSPCC-007)

### Pendientes (no encontrados en el código)

- [ ] Refresco de sesión por cookie (hoy `token/refresh/` requiere el token en el cuerpo)
- [ ] Bloqueo de cuenta tras N intentos fallidos (solo hay throttling)
- [ ] Cabecera Content Security Policy (CSP)
- [ ] Doble factor de autenticación (2FA)
- [ ] Registro de IP en `ActivityLog` (el campo existe sin uso)
- [ ] Escaneo automático de seguridad y dependencias (no hay configuración de CI en el repositorio)
- [ ] Antivirus para archivos subidos
- [ ] Nombres de archivo aleatorios para adjuntos de RQ (hoy se guardan con el nombre original bajo `attachments/`)

---

## 6. Dependencias relacionadas con seguridad

```
# backend/requirements.txt
djangorestframework-simplejwt==5.3.1   # JWT + blacklist
django-cors-headers==4.6.0
python-magic==0.4.27                   # detección del tipo real de archivo (requiere libmagic1)
cryptography==43.0.3                   # Fernet para EncryptedTextField
pypdf==6.19.0                          # validación de PDF de CVs
django-storages[s3]==1.14.4            # bucket privado opcional
whitenoise==6.8.2                      # estáticos en producción
```
