---
name: code-review-syspcc
description: Checklist de revisión de código propio de SYSPCC — la última barrera antes de mergear. Úsalo al revisar un diff/PR, antes de commitear un cambio no trivial, o cuando el usuario pida "revisa esto". Consolida los estándares de backend, workflow, permisos, testing y frontend del proyecto. Dispara ante "revisa", "review", "PR", "antes de mergear", "revisión de código".
---

# Code review — SYSPCC

Revisión final que agrega los estándares de los demás skills. Para el detalle de cada área, consulta el skill correspondiente. Reporta hallazgos ordenados por severidad; distingue "bug" de "mejora".

## 1. Correctitud
- [ ] La lógica hace lo que dice; sin off-by-one, condiciones invertidas, ramas muertas.
- [ ] Casos límite: listas vacías, `None`/`null`, valores negativos/cero, duplicados.
- [ ] Sin race conditions en escrituras concurrentes (`select_for_update` donde toca).

## 2. Workflow (si toca estados de RQ) → skill `workflow-engine`
- [ ] **No se modificó ninguna transición del flujo de gerencia** (regla dura).
- [ ] Transición resuelta según `rq.flow` (OPS vs ADM difieren).
- [ ] `WorkflowError` en transición ilegal; transiciones `(auto)` encadenadas.

## 3. Seguridad y permisos → skills `roles-y-permisos`, `seguridad-owasp`
- [ ] Cada endpoint con `permission_classes`; queryset acotado por rol.
- [ ] Autorización en backend, no confiando en el frontend.
- [ ] Sin secretos hardcodeados; input de usuario validado; sin inyección.

## 4. Errores, logging, BD → skill `backend-produccion`
- [ ] Sin `except Exception` que trague; tipos concretos + última barrera con `logger.exception`.
- [ ] Escrituras multi-paso en `transaction.atomic()`.
- [ ] Logs con contexto (`request_id`, `correlation_id`, `user_id`), sin PII.
- [ ] Idempotencia donde el flujo es reintentable.
- [ ] Sin N+1 (`select_related`/`prefetch_related`).

## 5. API → skill `drf-api-design`
- [ ] Lógica en services, no en views/serializers.
- [ ] Serializer valida el payload; paginación y filtros declarados.
- [ ] `@extend_schema` documentado.

## 6. Frontend (si aplica) → skills `react-produccion`, `accesibilidad`
- [ ] Llamadas vía módulos `api/`; estados loading/error/empty.
- [ ] Submit deshabilitado en vuelo; errores mostrados en español.
- [ ] Acciones ocultas según rol; a11y básica.

## 7. Tests → skills `django-testing`, `react-testing`
- [ ] Camino feliz + ramas de error + acceso denegado cubiertos.
- [ ] Test de idempotencia donde aplique.

## 8. Calidad general
- [ ] El código lee como el de alrededor (naming, idioma, densidad de comentarios).
- [ ] Sin código muerto, TODOs sin ticket, `console.log`/`print` de depuración.
- [ ] Nombres en el idioma correcto: mensajes de usuario en español, código en inglés (ver `español-consistente`).
- [ ] Migraciones seguras si hay cambios de modelo (`django-migrations`).

## Cómo reportar
Agrupa por severidad: 🔴 bloqueante (bug, agujero de seguridad, flujo roto) → 🟡 debería arreglarse → 🟢 sugerencia. Para cada uno: archivo:línea, qué está mal, y el impacto concreto (no "esto es mejorable" sino "si llega un RQ sin project, esto lanza 500").
