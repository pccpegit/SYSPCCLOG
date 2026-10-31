"""
Solo lectura de la tabla de transiciones de gerencia (SYSPCC-029).

Responde "¿qué roles puede ejecutar la acción X en este (flujo, estado)?" leyendo
`TRANSITIONS` tal como está. NO la modifica ni copia sus roles: así, si gerencia cambia un rol
en el motor, las operaciones de almacén que lo siguen (entrega parcial) cambian con él, y no
se crea ni amplía ningún permiso.
"""
from apps.rq.services.workflow_engine import ANY, TRANSITIONS


def roles_for_action(flow: str, status: str, action: str) -> frozenset:
    """
    Roles que la tabla exige para `action` desde `status` en `flow`.

    Vacío cuando no existe esa transición. Se ignoran las transiciones del sistema
    (automáticas) y las que no exigen rol (`required_role` None): para ellas no hay un rol que
    derivar, así que quien llama debe negar en lugar de permitir.
    """
    return frozenset(
        str(t['required_role'])
        for t in TRANSITIONS
        if (t['flow'] == ANY or t['flow'] == flow)
        and (t['from_status'] is None or t['from_status'] == status)
        and t['action'] == action
        and t.get('required_role') is not None
        and not t.get('system_action')
    )
