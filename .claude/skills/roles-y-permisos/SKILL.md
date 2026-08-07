---
name: roles-y-permisos
description: Control de acceso basado en roles (RBAC) para SYSPCC — los 12 roles y cómo protegerlos en cada endpoint y acción de workflow. Úsalo al escribir permisos, proteger endpoints, restringir acciones por rol, o filtrar querysets por lo que un usuario puede ver. Dispara ante "permiso", "rol", "autorización", "RBAC", "quién puede", "acceso", "HasRole".
---

# Roles y permisos — SYSPCC

Roles en `RoleChoices` (`apps/core/enums.py`). Permisos en `apps/core/permissions.py`. Un usuario tiene sus roles vía `user.user_roles` (relación `UserRole`).

## Los roles

**Comunes:** `REQUESTER` (Solicitante), `GENERAL_MANAGER` (Gerente General), `CENTRAL_WAREHOUSE` (Almacén Central).
**Operaciones:** `PROJECT_RESIDENT`, `PROJECT_CONTROL`, `LOGISTICS_COORDINATOR`, `SITE_WAREHOUSE`.
**Administrativo:** `DIRECT_SUPERVISOR`, `ADMIN_MANAGER`, `LOGISTICS_SUPERVISOR`, `LOGISTICS_CHIEF`.
**Módulo Pasajes:** `PASAJES_MANAGER` (acceso dedicado, separado de `ADMIN_MANAGER`).

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

**Clases dedicadas** ya disponibles: `IsGeneralManager`, `IsLogisticsStaff` (coordinator/supervisor/chief), `IsWarehouseStaff` (central/site), `IsAdminOrReadOnly`.

**Object-level** — sobrescribe `get_queryset()` y/o `has_object_permission`:
```python
def get_queryset(self):
    user = self.request.user
    if user.user_roles.filter(role__in=STAFF_ROLES).exists():
        return Request.objects.all()
    return Request.objects.filter(requester=user)
```

**En el service de workflow** — valida el rol del actor contra el rol autorizado de la transición:
```python
def _assert_role(user, required_role, action):
    if not user.user_roles.filter(role=required_role).exists():
        raise PermissionDeniedForAction(
            f"Se requiere el rol {required_role} para '{action}'.",
            required_role=required_role,
            user_roles=list(user.user_roles.values_list('role', flat=True)),
        )
```

## Mapa rol → acción (workflow) — referencia rápida
- Aprobación técnica OPS → `PROJECT_RESIDENT`; clasificación presupuestal OPS → `PROJECT_CONTROL`.
- Aprobación admin → `DIRECT_SUPERVISOR`; plan anual → `ADMIN_MANAGER`.
- Revisión GM / sobrecostos → `GENERAL_MANAGER`.
- Logística OPS → `LOGISTICS_COORDINATOR`; logística ADM → `LOGISTICS_SUPERVISOR` (+ `LOGISTICS_CHIEF` en cotización).
- Despacho / recepción → `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE`.
- Conformidad final → `REQUESTER`.

(La fuente exacta rol↔transición es la tabla de `CLAUDE.md`; consúltala, no la memorices.)

## Checklist
- [ ] `permission_classes` presente y correcto.
- [ ] `get_queryset()` acota por lo que el usuario puede ver.
- [ ] Acción de workflow valida el rol del actor en el service.
- [ ] Test de acceso denegado (usuario sin el rol → 403) y de acceso permitido.
- [ ] Sin confiar en el frontend para autorización.
