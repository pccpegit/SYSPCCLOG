---
name: workflow-engine
description: Reglas críticas para trabajar con la máquina de estados de RQ (WorkflowEngine, 43 estados, 5 fases) en apps/rq/services/workflow_engine.py. Úsalo SIEMPRE que toques transiciones de estado, acciones de aprobación, el ciclo de reclamo a proveedor, o cualquier cambio de status de un Request. Los flujos están definidos por gerencia y NO se modifican. Dispara ante "workflow", "transición", "estado", "status", "aprobar", "rechazar", "WorkflowEngine", "máquina de estados".
---

# WorkflowEngine — máquina de estados de RQ

Fuente de verdad de los flujos: `CLAUDE.md` (sección "Workflows — DO NOT MODIFY") y el PDF de gerencia. Implementación: `apps/rq/services/workflow_engine.py`. Estados en `RQStatusChoices` (`apps/core/enums.py`).

## Regla #0 — LOS FLUJOS NO SE MODIFICAN

Las transiciones OPERATIONS y ADMINISTRATIVE están definidas por gerencia. **No inventes, elimines ni reordenes estados ni transiciones.** Si una tarea parece requerir cambiar el flujo:
1. Detente y confírmalo con el usuario citando la transición exacta de `CLAUDE.md`.
2. Nunca "arregles" el flujo por tu cuenta aunque parezca un bug.

Lo que SÍ puedes hacer sin tocar el flujo: mejorar validaciones, logging, manejo de errores, permisos, notificaciones, y añadir tests.

## Cómo aplicar una transición correctamente

Toda transición debe:
1. **Cargar el RQ con lock** para evitar carreras: `Request.objects.select_for_update().get(pk=...)` dentro de `transaction.atomic()`.
2. **Validar que la transición es legal** desde el estado actual para ese `flow` (OPERATIONS vs ADMINISTRATIVE) — la tabla del flujo manda. Si no lo es → `WorkflowError`.
3. **Validar el rol** del actor contra el rol autorizado para esa acción (ver `roles-y-permisos`). Si no → `PermissionDeniedForAction`.
4. **Ejecutar transiciones automáticas** encadenadas donde el flujo lo indica (p.ej. `GM_APPROVED → VALIDATED (auto)`, `WITHIN_PROPOSAL → VALIDATED (auto)`).
5. **Registrar** el cambio en el log de actividad / historial de aprobaciones con actor, estado previo, estado nuevo, timestamp y comentario.
6. **Disparar notificaciones** al siguiente rol responsable.
7. Loguear el evento (`logger.info("rq.transition.ok", extra={...})`).

```python
from django.db import transaction
from apps.core.exceptions import WorkflowError, PermissionDeniedForAction

class WorkflowEngine:
    @classmethod
    @transaction.atomic
    def apply(cls, request_id, action, user, comment=""):
        rq = Request.objects.select_for_update().get(pk=request_id)
        transition = cls._resolve_transition(rq.flow, rq.status, action)
        if transition is None:
            raise WorkflowError(
                f"Acción '{action}' no válida desde '{rq.status}'.",
                current_status=rq.status, attempted_action=action,
            )
        cls._assert_role(user, transition.required_role, action)
        previous = rq.status
        rq.status = transition.target
        rq.save(update_fields=["status", "updated_at"])
        cls._log_activity(rq, user, previous, rq.status, action, comment)
        rq.status = cls._auto_advance(rq)          # WITHIN_PROPOSAL→VALIDATED, etc.
        cls._notify_next(rq)
        return rq
```

## Puntos delicados del flujo (no te los saltes)

- **OPERATIONS y ADMINISTRATIVE difieren**: p.ej. en ADM `IN_STOCK → DELIVERED (directo)` mientras que en OPS `IN_STOCK → DISPATCHED_TO_SITE → DELIVERED`. Resuelve la transición SIEMPRE en función de `rq.flow`.
- **Ciclo de reclamo a proveedor** (`QUALITY_REJECTED → SUPPLIER_CLAIM_SENT → ... → SUPPLIER_REPLACEMENT_RECEIVED → QC de nuevo`) puede re-entrar en QC varias veces. No lo cortes.
- **CANCELLED** es alcanzable desde cualquier estado no-terminal por roles autorizados (regla universal).
- Estados terminales: `CLOSED`, `CANCELLED`, y los `*_REJECTED` según el flujo. No permitas transiciones fuera de ellos.
- Transiciones automáticas (`(auto)`) no requieren una segunda acción del usuario; encadénalas en la misma operación atómica.

## Antes de cerrar
- [ ] No modifiqué ninguna transición del flujo de gerencia.
- [ ] Transición resuelta según `rq.flow`.
- [ ] `select_for_update` + `atomic`.
- [ ] Validación de estado legal → `WorkflowError`; validación de rol → `PermissionDeniedForAction`.
- [ ] Transiciones `(auto)` encadenadas.
- [ ] Actividad registrada + notificación al siguiente rol.
- [ ] Test que cubre la transición feliz y la ilegal.
