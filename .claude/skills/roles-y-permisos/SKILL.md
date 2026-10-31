---
name: roles-y-permisos
description: Control de acceso basado en roles (RBAC) para SYSPCC — los 13 roles y cómo protegerlos en cada endpoint y acción de workflow. Úsalo al escribir permisos, proteger endpoints, restringir acciones por rol, o filtrar querysets por lo que un usuario puede ver. Dispara ante "permiso", "rol", "autorización", "RBAC", "quién puede", "acceso", "HasRole".
---

# Roles y permisos — SYSPCC

Roles en `RoleChoices` (`apps/core/enums.py`, 13 valores). Permisos en `apps/core/permissions.py`, más los de cada app: `apps/rq/permissions.py` (`CanPerformWorkflowAction`, `get_accessible_requests_queryset`) y `apps/warehouse/permissions.py`. Un usuario tiene sus roles vía `user.user_roles` (relación `UserRole`).

## Los roles

**Comunes:** `REQUESTER` (Solicitante), `GENERAL_MANAGER` (Gerente General), `CENTRAL_WAREHOUSE` (Almacén Central).
**Operaciones:** `PROJECT_RESIDENT`, `PROJECT_CONTROL`, `LOGISTICS_COORDINATOR`, `SITE_WAREHOUSE`.
**Administrativo:** `DIRECT_SUPERVISOR`, `ADMIN_MANAGER`, `LOGISTICS_SUPERVISOR`, `LOGISTICS_CHIEF`.
**Módulo Pasajes:** `PASAJES_MANAGER` (acceso dedicado, separado de `ADMIN_MANAGER`).
**RR. HH.:** `HR_MANAGER` (Gestor de RR. HH.; contratos con DNI, sueldo y domicilio: acceso dedicado, sin bypass por `is_staff`/`is_superuser`).

No hay rol de negocio "superadmin": el módulo `/sistema` (usuarios y proyectos) lo protege `IsSuperUser` (Django `is_superuser`).

## Reglas de oro

1. **Autorización en el backend, siempre.** El frontend (`RoleRoute`) oculta UI pero NO es seguridad. Todo endpoint valida el rol en el servidor.
2. **Todo endpoint tiene `permission_classes`.** Mínimo `IsAuthenticated`. Nunca un endpoint abierto salvo login/refresh.
3. **Queryset acotado por rol** (object-level). Un requester solo ve sus RQs; staff ve más. No confíes solo en el permiso de vista.
4. **La acción de workflow valida el rol del actor** dentro del service, además del permiso de la view. La tabla de flujo dice qué rol ejecuta cada transición (p.ej. solo `PROJECT_RESIDENT` aprueba técnicamente en OPS).
5. **Comprueba pertenencia a rol** con `user.user_roles.filter(role__in=[...]).exists()`, nunca comparando un único campo `role`.

## Patrones

**Nivel de vista** — con `HasRole` + `role_required`:
```python
class BudgetReviewViewSet(viewsets.ModelViewSet):
    permission_classes = [HasRole]
    role_required = [RoleChoices.PROJECT_CONTROL, RoleChoices.ADMIN_MANAGER]
```

**Clases dedicadas** ya disponibles en `apps/core/permissions.py`: `IsGeneralManager`, `IsLogisticsStaff` (coordinator/supervisor/chief), `IsWarehouseStaff` (central/site), `IsHRManager` (lectura completa de Personal: ADMIN_MANAGER/PASAJES_MANAGER/GENERAL_MANAGER o `is_staff`), `IsHRDocumentsManager` / `IsHRDocumentsReader` (documentos de RR. HH.), `IsPasajesStaff`, `IsAdminOrReadOnly`, `IsSuperUser`, `IsOwnerOrAdmin`. En almacén (`apps/warehouse/permissions.py`, sin bypass por `is_staff`/`is_superuser`): `IsWarehouseRole` (almacén + logística), `CanImportInventory`, `CanAssignLocations`, `CanLinkPersonal` (CENTRAL_WAREHOUSE + LOGISTICS_CHIEF), `CanDeliverEPP` (CENTRAL_WAREHOUSE + SITE_WAREHOUSE), `CanLookupPersonal`.

**Object-level** — sobrescribe `get_queryset()` y/o `has_object_permission`. Para RQ, la visibilidad vive en un solo lugar (`apps/rq/permissions.py`) y la reutilizan las vistas de RQ, cotizaciones y OC; para un RQ puntual (p.ej. al crear un reclamo) se usa `user_can_access_request(user, rq)`:
```python
from apps.rq.permissions import get_accessible_requests_queryset

def get_queryset(self):
    # staff/superuser y WIDE_REQUEST_ACCESS_ROLES: todo; PROJECT_SCOPE_ROLES / DEPARTMENT_SCOPE_ROLES:
    # su proyecto/departamento; el resto (p.ej. REQUESTER): solo lo suyo (requested_by=user)
    return get_accessible_requests_queryset(self.request.user)
```

**En el service de workflow** — `WorkflowEngine` ya valida dos veces contra la BD: que el usuario tenga el `acting_role` que declara (`_validate_acting_role`) y que tenga el rol requerido por la transición (`_check_role_permission`); ambos lanzan `PermissionDeniedForAction`:
```python
def _check_role_permission(self, transition: dict) -> None:
    required = transition.get('required_role')
    if required is None or transition.get('system_action'):
        return
    if not self._user_has_role(required):          # user.user_roles.filter(role=required).exists()
        raise PermissionDeniedForAction(
            message=f'El usuario {self.user.username} no tiene el rol requerido "{required}" para esta acción.',
            required_role=required,
            user_roles=list(self.user.user_roles.values_list('role', flat=True)),
        )
```

## Mapa rol → acción (workflow) — referencia rápida
- Aprobación técnica OPS → `PROJECT_RESIDENT`; clasificación presupuestal OPS → `PROJECT_CONTROL`.
- Aprobación admin → `DIRECT_SUPERVISOR`; plan anual → `ADMIN_MANAGER`.
- Revisión GM / sobrecostos → `GENERAL_MANAGER`.
- Logística OPS → `LOGISTICS_COORDINATOR`; logística ADM → `LOGISTICS_SUPERVISOR` (+ `LOGISTICS_CHIEF` en cotización).
- Recepción, QC, reclamo al proveedor y cierre → la logística del flujo (`LOGISTICS_COORDINATOR` en OPS, `LOGISTICS_SUPERVISOR` en ADM).
- Despacho desde stock (`IN_STOCK`) → `CENTRAL_WAREHOUSE`; entrega en destino (`DISPATCHED_TO_SITE → DELIVERED`) → `SITE_WAREHOUSE` en OPS, `CENTRAL_WAREHOUSE` en ADM (que además registra `WAREHOUSE_UPDATED`).
- Conformidad final o reclamo → `REQUESTER`.

(La fuente exacta rol↔transición es la tabla de `CLAUDE.md`; consúltala, no la memorices.)

## Checklist
- [ ] `permission_classes` presente y correcto.
- [ ] `get_queryset()` acota por lo que el usuario puede ver.
- [ ] Acción de workflow valida el rol del actor en el service.
- [ ] Test de acceso denegado (usuario sin el rol → 403) y de acceso permitido.
- [ ] Sin confiar en el frontend para autorización.
