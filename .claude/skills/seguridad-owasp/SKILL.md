---
name: seguridad-owasp
description: Seguridad web (OWASP) para el backend Django + frontend React de SYSPCC — autenticación JWT por cookie, RBAC, protección de endpoints, uploads seguros, validación de input, protección de datos sensibles. Úsalo al tocar auth, permisos, uploads, configuración de settings, o cualquier superficie expuesta. Dispara ante "seguridad", "OWASP", "vulnerabilidad", "auth", "JWT", "CORS", "CSRF", "inyección", "upload seguro".
---

# Seguridad — SYSPCC (OWASP)

Auth: JWT por cookie vía `CookieJWTAuthentication` (SimpleJWT, access 15 min / refresh 1 día, rotación + blacklist). Admin en `/mgmt-panel/`. Complementa este skill con `roles-y-permisos`.

## Control de acceso (OWASP A01 — el riesgo #1 aquí)
- **Autorización siempre en el backend.** El frontend oculta UI, no protege datos.
- Cada endpoint: `permission_classes` + queryset acotado por rol/propietario (object-level). Ver `roles-y-permisos`.
- Prohibido IDOR: no devuelvas un RQ por `pk` sin verificar que el usuario puede verlo.
- Valida el rol del actor en cada acción de workflow, no solo al entrar a la vista.

## Autenticación / sesiones
- Cookies de token: `HttpOnly`, `Secure` (prod), `SameSite`. Nunca el token en `localStorage`.
- No loguees tokens ni contraseñas. No los pongas en URLs.
- Respeta rotación + blacklist del refresh; no desactives la blacklist.
- Rate limits vigentes: anon 30/min, auth 200/min, login 5/min. No los relajes sin motivo.

## Input / inyección (A03)
- Valida TODO input con serializers DRF (tipos, rangos, choices, longitud). Ver `drf-api-design`.
- ORM de Django parametriza — **no** construyas SQL con f-strings/`.raw()` con input de usuario.
- Uploads (Excel, adjuntos): valida extensión, content-type y **tamaño máximo**; no confíes en el nombre del archivo; guarda fuera de rutas ejecutables. Ver `excel-processing`.
- Excel/CSV export: escapa valores que empiecen con `= + - @` (fórmula injection).
- Frontend: React escapa por defecto — **nunca** uses `dangerouslySetInnerHTML` con datos de usuario.

## Configuración segura (A05)
- `SECRET_KEY`, DB creds, etc. **solo** desde entorno (`config()` / `.env`), nunca hardcodeados ni en git. `.env` en `.gitignore`.
- `DEBUG=False` en prod; `ALLOWED_HOSTS` restringido.
- Prod: `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_CONTENT_TYPE_NOSNIFF`.
- **CORS**: `CORS_ALLOWED_ORIGINS` explícito (no `CORS_ALLOW_ALL_ORIGINS=True` en prod). Con cookies, `CORS_ALLOW_CREDENTIALS=True` exige orígenes específicos.
- **CSRF**: al usar cookies para auth, mantén la protección CSRF de Django activa para métodos que mutan.

## Datos sensibles (A02)
- No expongas campos sensibles en serializers (no incluyas `password`, hashes, tokens). Lista `fields` explícita, nunca `fields = '__all__'` en datos sensibles.
- Logs sin PII ni credenciales.
- Errores al cliente: mensaje genérico; el detalle va al log del servidor (el `custom_exception_handler` no debe filtrar stacktraces en prod).

## Dependencias / logging (A06, A09)
- No introduzcas dependencias sin necesidad; revisa vulnerabilidades conocidas.
- Loguea eventos de seguridad: logins fallidos, accesos denegados (403), cambios de rol — con contexto, para auditoría.

## Checklist de superficie nueva
- [ ] Endpoint autenticado + autorizado por rol + object-level.
- [ ] Input validado por serializer; sin SQL crudo.
- [ ] Upload con límites de tamaño/tipo.
- [ ] Sin secretos en código; settings de prod endurecidos.
- [ ] CORS/CSRF correctos; cookies `HttpOnly`/`Secure`.
- [ ] Serializer no filtra campos sensibles.
- [ ] Sin tokens/PII en logs; error genérico al cliente.
