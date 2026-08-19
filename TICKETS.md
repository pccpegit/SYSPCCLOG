# Registro de Tickets — SYSPCC

Registro incremental de cambios. **Cada cambio sustantivo** recibe un ID `SYSPCC-NNN`, su rama (`<tipo>/SYSPCC-NNN-<slug>`) y su PR hacia `develop`.

Para el próximo ID: toma el mayor de la tabla + 1. Tipos: `feature`, `fix`, `chore`, `refactor`, `perf`, `docs`, `test`.

| Ticket | Tipo | Rama | Descripción | PR | Estado |
|--------|------|------|-------------|-----|--------|
| SYSPCC-001 | chore | `chore/SYSPCC-001-setup-agent-team` | Equipo multiagente (13 agentes + 18 skills), modo-equipo permanente y flujo de trabajo Git con tickets | [#1](https://github.com/pccpegit/SYSPCCLOG/pull/1) | Mergeado |
| SYSPCC-002 | chore | `chore/SYSPCC-002-gitignore-higiene` | Higiene del repo: ignorar datos con PII (datapasajes), rle/, docs generados y carpetas .claude descolocadas | [#3](https://github.com/pccpegit/SYSPCCLOG/pull/3) | Mergeado |
| SYSPCC-003 | feature | `feature/SYSPCC-003-backend-estado-actual` | Estado actual del backend: apps rq, core, warehouse, administracion, support + config | [#4](https://github.com/pccpegit/SYSPCCLOG/pull/4) | Mergeado |
| SYSPCC-004 | feature | `feature/SYSPCC-004-frontend-estado-actual` | Estado actual del frontend: pages, components, api, context, assets | [#5](https://github.com/pccpegit/SYSPCCLOG/pull/5) | Mergeado |
| SYSPCC-005 | docs | `docs/SYSPCC-005-documentacion-tecnica` | Documentación técnica (casos de uso, arquitectura, diagramas, guía de despliegue) y config raíz | [#6](https://github.com/pccpegit/SYSPCCLOG/pull/6) | Mergeado |
| SYSPCC-006 | fix | `fix/SYSPCC-006-control-de-acceso` | Control de acceso (🔴): PII de personal, IDOR en adjuntos, suplantación en reclamos + 25 tests | [#8](https://github.com/pccpegit/SYSPCCLOG/pull/8) | Mergeado |
| SYSPCC-007 | fix | `fix/SYSPCC-007-concurrencia-transacciones` | Concurrencia (🔴): locks/atomicidad en stock, numeración, workflow, creación RQ + CheckConstraint + tests | [#9](https://github.com/pccpegit/SYSPCCLOG/pull/9) | Mergeado |
| SYSPCC-008 | fix | `fix/SYSPCC-008-import-pasajes-integridad` | Import pasajes (🔴): savepoints por fila (no envenena tx) + idempotencia (update_or_create sobre codigo_id_legado unique) + tests | [#10](https://github.com/pccpegit/SYSPCCLOG/pull/10) | Mergeado |
| SYSPCC-009 | fix | `fix/SYSPCC-009-error-handling-notificaciones` | Error handling (🔴): SLACalculator sin except silencioso + idempotencia de notificaciones (dedup_key) + fix bug task recordatorios + tests | [#11](https://github.com/pccpegit/SYSPCCLOG/pull/11) | Mergeado |
| SYSPCC-010 | chore | `chore/SYSPCC-010-migracion-drift-rolechoices` | Resuelve drift de migración preexistente (PASAJES_MANAGER en RoleChoices); migración 0006 no-op segura | [#12](https://github.com/pccpegit/SYSPCCLOG/pull/12) | Mergeado |
| SYSPCC-011 | fix | `fix/SYSPCC-011-seguridad-acceso-media` | Seguridad 🟡: scope de lecturas (RQ/cotiz/OC), update_items con rol, OneDrive org-scope, guarda de seeds en prod, CanPerformWorkflowAction + tests | [#13](https://github.com/pccpegit/SYSPCCLOG/pull/13) | Mergeado |
| SYSPCC-012 | fix | `fix/SYSPCC-012-error-handling-resiliencia` | Error handling 🟡: except concretos + logging, retries Celery, OneDrive async, fugas de excepción, última barrera en execute_action + tests | [#14](https://github.com/pccpegit/SYSPCCLOG/pull/14) | Mergeado |
| SYSPCC-013 | chore | `chore/SYSPCC-013-hardening-final` | Hardening 🟢: inyección Excel, límite de exports, agregaciones en BD, dinero en Decimal, validación de filtros, limpieza de adjunto huérfano + tests | [#15](https://github.com/pccpegit/SYSPCCLOG/pull/15) | Mergeado |
| SYSPCC-014 | chore | `chore/SYSPCC-014-tickets-status` | Corrige el estado de SYSPCC-013 en el registro (quedó "En progreso" sin ticket posterior que lo actualizara) | [#18](https://github.com/pccpegit/SYSPCCLOG/pull/18) | Mergeado |
| SYSPCC-015 | feature | `feature/SYSPCC-015-csrf-enforcement` | CSRF enforcement (follow-up): backend enforce_csrf en CookieJWTAuth + endpoint bootstrap; frontend interceptor X-CSRFToken + bootstrap; 8 tests back + 19 front | [#19](https://github.com/pccpegit/SYSPCCLOG/pull/19) | Mergeado |
| SYSPCC-016 | feature | `feature/SYSPCC-016-onedrive-seguridad` | OneDrive (follow-up): cifrado de tokens en reposo (Fernet + fallback legacy) + scope/tenant configurable por settings + tests | [#20](https://github.com/pccpegit/SYSPCCLOG/pull/20) | Mergeado |
| SYSPCC-017 | fix | `fix/SYSPCC-017-secretos-a-env` | Seguridad: sacar del repo el GUID de ONEDRIVE_CLIENT_ID y la DEMO_PASSWORD hardcodeada (los 3 seeds) → todo por env + tests | [#22](https://github.com/pccpegit/SYSPCCLOG/pull/22) | Mergeado |
| SYSPCC-018 | feature | `feature/SYSPCC-018-modulo-administracion` | Módulo de administración (solo superadmin) como módulo separado Administración del Sistema (/sistema): gestión de usuarios (CRUD, roles, activar/desactivar, reset de contraseña con cambio forzado) y de proyectos (CRUD, activar/desactivar) | [#24](https://github.com/pccpegit/SYSPCCLOG/pull/24) | Mergeado |
