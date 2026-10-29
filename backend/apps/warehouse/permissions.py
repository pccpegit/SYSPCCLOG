"""
Warehouse permissions (SYSPCC-025).

``IsWarehouseRole`` is the module-wide gate and keeps its original definition and
role list. The classes below narrow individual actions to fewer roles. None of
them honours ``is_superuser`` / ``is_staff`` as a bypass: roles are checked
against ``UserRole`` only.
"""
from rest_framework.permissions import BasePermission

# Role names (strings on purpose: same convention as the original class).
CENTRAL_WAREHOUSE = 'CENTRAL_WAREHOUSE'
SITE_WAREHOUSE = 'SITE_WAREHOUSE'
LOGISTICS_COORDINATOR = 'LOGISTICS_COORDINATOR'
LOGISTICS_SUPERVISOR = 'LOGISTICS_SUPERVISOR'
LOGISTICS_CHIEF = 'LOGISTICS_CHIEF'


class _RolePermission(BasePermission):
    ALLOWED_ROLES: list[str] = []

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.user_roles.filter(role__in=self.ALLOWED_ROLES).exists()


class IsWarehouseRole(_RolePermission):
    """Allow access to warehouse and logistics users."""

    message = 'Se requiere el rol de Almacén, Logística o similar.'

    ALLOWED_ROLES = [
        CENTRAL_WAREHOUSE, SITE_WAREHOUSE,
        LOGISTICS_COORDINATOR, LOGISTICS_SUPERVISOR, LOGISTICS_CHIEF,
    ]


class CanImportInventory(_RolePermission):
    """Upload / confirm inventory workbooks."""

    message = 'Solo Almacén Central y Jefe Logístico pueden importar inventario.'
    ALLOWED_ROLES = [CENTRAL_WAREHOUSE, LOGISTICS_CHIEF]


class CanAssignLocations(_RolePermission):
    """Fase 3 (Almacenamiento): assign the exact location of items."""

    message = 'Solo Almacén Central y Jefe Logístico pueden asignar ubicaciones.'
    ALLOWED_ROLES = [CENTRAL_WAREHOUSE, LOGISTICS_CHIEF]


class CanLinkPersonal(_RolePermission):
    """Link free-text destinations to workers."""

    message = 'Solo Almacén Central y Jefe Logístico pueden vincular destinos.'
    ALLOWED_ROLES = [CENTRAL_WAREHOUSE, LOGISTICS_CHIEF]


class CanDeliverEPP(_RolePermission):
    """Counter delivery of EPP with a voucher (Fase 4, paso 5)."""

    message = 'Solo Almacén Central y Almacén de Obra pueden registrar entregas de EPP.'
    ALLOWED_ROLES = [CENTRAL_WAREHOUSE, SITE_WAREHOUSE]


class CanReverseDelivery(_RolePermission):
    """
    Annul an entrega registered against an RQ (SYSPCC-029). The design assigns it to the
    warehouse keeper who registered it or to the logistics chief; deliberately NOT derived
    from TRANSITIONS (it is a correction, not a workflow action). No is_superuser bypass.
    """

    message = 'Solo Almacén Central y Jefe Logístico pueden anular entregas.'
    ALLOWED_ROLES = [CENTRAL_WAREHOUSE, LOGISTICS_CHIEF]


class CanLookupPersonal(_RolePermission):
    """
    Search workers (id, name, position, project code of every ACTIVE worker).

    Only the roles whose screens need it: the counter roles pick the recipient of an EPP
    delivery and the roles that import/link link destinations to workers. Logistics
    coordinators and supervisors have no such screen, so they cannot enumerate the staff.
    """

    message = 'Solo Almacén Central, Almacén de Obra y Jefe Logístico pueden buscar trabajadores.'
    ALLOWED_ROLES = [CENTRAL_WAREHOUSE, SITE_WAREHOUSE, LOGISTICS_CHIEF]


# Roles that may operate warehouses other than the site one (entries, exits, transfers).
_NON_SITE_ROLES = frozenset({
    CENTRAL_WAREHOUSE, LOGISTICS_COORDINATOR, LOGISTICS_SUPERVISOR, LOGISTICS_CHIEF,
})

# Destinations that hand material to a person or to another floor/warehouse.
PERSON_DESTINATION_TYPES = frozenset({'EMPLOYEE', 'TRANSFER_OUT'})

SITE_WAREHOUSE_CODE = 'SITE'


def user_roles(user) -> set:
    return set(user.user_roles.values_list('role', flat=True))


def user_has_role(user, role: str) -> bool:
    return user.user_roles.filter(role=role).exists()


def can_assign_locations(user) -> bool:
    """Same rule as ``CanAssignLocations`` for code that has no request/view at hand."""
    return bool(user_roles(user) & set(CanAssignLocations.ALLOWED_ROLES))


def movement_scope_error(user, warehouse: str, *, person_destination: bool = False):
    """
    Scope check shared by ``entry``, ``exit``, ``batch-entry``, ``batch-exit`` and ``epp-delivery``.
    Returns the (Spanish) denial message, or ``None`` when the user may operate there.

    * ``SITE_WAREHOUSE`` operates only the site warehouse.
    * Handing material to a person (EMPLOYEE) or to another floor (TRANSFER_OUT) is the counter
      work of ``CanDeliverEPP``: Almacén Central / Almacén de Obra only. Without this rule the
      narrowing of ``epp-delivery`` would be cosmetic (``batch-exit`` accepts the same payload).
    * Only ``CENTRAL_WAREHOUSE`` hands out material from a non-site warehouse to a person.

    No ``is_superuser`` / ``is_staff`` bypass: roles only.
    """
    roles = user_roles(user)
    if person_destination:
        if not roles & set(CanDeliverEPP.ALLOWED_ROLES):
            return 'Solo Almacén Central y Almacén de Obra pueden entregar material a trabajadores o a otro piso.'
        if warehouse != SITE_WAREHOUSE_CODE and CENTRAL_WAREHOUSE not in roles:
            return 'Su rol solo permite entregas desde el almacén de obra.'
        return None
    if warehouse != SITE_WAREHOUSE_CODE and not roles & _NON_SITE_ROLES:
        return 'Su rol solo permite operar el almacén de obra.'
    return None
