---
name: workflow-engine
description: Reglas críticas para trabajar con la máquina de estados de RQ (WorkflowEngine, 47 estados en RQStatusChoices, 71 transiciones, 5 fases) en apps/rq/services/workflow_engine.py. Úsalo SIEMPRE que toques transiciones de estado, acciones de aprobación, el ciclo de reclamo a proveedor, o cualquier cambio de status de un Request. Los flujos están definidos por gerencia y NO se modifican. Dispara ante "workflow", "transición", "estado", "status", "aprobar", "rechazar", "WorkflowEngine", "máquina de estados".
---

# WorkflowEngine — máquina de estados de RQ

Fuente de verdad de los flujos: `CLAUDE.md` (sección "Workflows — DO NOT MODIFY") y el PDF de gerencia. Implementación: tabla `TRANSITIONS` (71 entradas) y clase `WorkflowEngine` en `apps/rq/services/workflow_engine.py`. Enums en `apps/core/enums.py`: `RQStatusChoices` (47 valores; 10 no aparecen en ninguna transición: `TECHNICAL_REVIEW`, `BUDGET_REVIEW`, `SUPERVISOR_REVIEW`, `ADMIN_BUDGET_REVIEW`, `STOCK_CHECK`, `QUALITY_CHECK`, `RECEPTION_CONFORMITY`, `RECEPTION_CLAIM`, `USER_CLAIM`, `CLAIM_RESOLVED`), `ApprovalActionChoices` (37), `RoleChoices` (13), `RQFlowChoices`.

**Red de seguridad:** `apps/rq/tests/test_workflow_snapshot.py` congela como literales escritos a mano todas las entradas de `TRANSITIONS`, los valores de esos cuatro enums y el conjunto terminal de `Request.is_terminal`. Si cambias el flujo sin autorización de gerencia, la suite falla; si gerencia lo autoriza, el snapshot se actualiza en el mismo PR citando la autorización.

## Regla #0 — LOS FLUJOS NO SE MODIFICAN

Las transiciones OPERATIONS y ADMINISTRATIVE están definidas por gerencia. **No inventes, elimines ni reordenes estados ni transiciones.** Si una tarea parece requerir cambiar el flujo:
1. Detente y confírmalo con el usuario citando la transición exacta de `CLAUDE.md`.
2. Nunca "arregles" el flujo por tu cuenta aunque parezca un bug.

Lo que SÍ puedes hacer sin tocar el flujo: mejorar validaciones, logging, manejo de errores, permisos, notificaciones, y añadir tests.

## Cómo se aplica una transición (lo que ya hace `WorkflowEngine.execute`)

Uso real (la vista `POST /api/v1/requests/{id}/action/` hace exactamente esto):

```python
from apps.core.enums import ApprovalActionChoices, RoleChoices
from apps.core.exceptions import WorkflowError, PermissionDeniedForAction
from apps.rq.services.workflow_engine import WorkflowEngine

engine = WorkflowEngine(request=rq, user=request.user, acting_role=RoleChoices.PROJECT_RESIDENT)
approval = engine.execute(
    action=ApprovalActionChoices.TECHNICAL_APPROVED,
    comments='Conforme',
    extra_data={},          # datos para los handlers condicionales (clasificación presupuestal, stock, etc.)
)                           # devuelve el registro Approval creado
```

Dentro de `execute` (todo en `@transaction.atomic`), en este orden:
1. **Valida el rol declarado** (`_validate_acting_role`): el usuario debe tener `acting_role` en `user.user_roles`; si no → `PermissionDeniedForAction`.
2. **Recarga el RQ con lock**: `Request.objects.select_for_update().get(pk=...)` (SYSPCC-007, evita doble aprobación).
3. **Estado terminal** → `WorkflowError` (salvo `CANCELLED`).
4. **Busca la transición** en `TRANSITIONS` por `flow` (o `ANY`), `from_status` y `action`. Si no hay → `WorkflowError`.
5. **Valida el rol requerido** de la transición contra la BD (`_check_role_permission`) → `PermissionDeniedForAction`.
6. **Handler condicional** si la transición lo declara (`handle_ops_budget_classification`, `handle_adm_budget_review`, `handle_stock_check`, `handle_quote_to_po`, `handle_cancellation`).
7. **Efectos laterales** (`_apply_side_effects`), guarda el RQ y crea el `Approval` inmutable (actor, rol, estado previo/nuevo, comentario).
8. **Registra actividad**, **envía notificaciones** y loguea la transición.
9. **Encadena las transiciones automáticas** (`_execute_system_chain`, p.ej. `WITHIN_PROPOSAL → VALIDATED`, `GM_APPROVED → VALIDATED`) con rol `SYSTEM`.

Si añades validaciones, logging o notificaciones, hazlo dentro de este recorrido; no crees un camino paralelo para cambiar `status`.

## Puntos delicados del flujo (no te los saltes)

- **OPERATIONS y ADMINISTRATIVE difieren**: p.ej. en ADM `IN_STOCK → DELIVERED (directo)` mientras que en OPS `IN_STOCK → DISPATCHED_TO_SITE → DELIVERED`. Resuelve la transición SIEMPRE en función de `rq.flow`.
- **Ciclo de reclamo a proveedor** (`QUALITY_REJECTED → SUPPLIER_CLAIM_SENT → ... → SUPPLIER_REPLACEMENT_RECEIVED → QC de nuevo`) puede re-entrar en QC varias veces. No lo cortes.
- **CANCELLED** es alcanzable desde cualquier estado no-terminal por roles autorizados (regla universal).
- Estados terminales (`Request.is_terminal`): `CLOSED`, `CANCELLED`, `TECHNICAL_REJECTED`, `SUPERVISOR_REJECTED`, `GM_REJECTED`, `COST_OVERRUN_REJECTED`. **`QUALITY_REJECTED` no es terminal**: abre el ciclo de reclamo al proveedor. No permitas transiciones fuera de los terminales.
- Transiciones automáticas (`(auto)`) no requieren una segunda acción del usuario; encadénalas en la misma operación atómica.

## Antes de cerrar
- [ ] No modifiqué ninguna transición del flujo de gerencia.
- [ ] Transición resuelta según `rq.flow`.
- [ ] `select_for_update` + `atomic`.
- [ ] Validación de estado legal → `WorkflowError`; validación de rol → `PermissionDeniedForAction`.
- [ ] Transiciones `(auto)` encadenadas.
- [ ] Actividad registrada + notificación al siguiente rol.
- [ ] Test que cubre la transición feliz y la ilegal.
- [ ] `apps/rq/tests/test_workflow_snapshot.py` en verde sin tocar el snapshot.
