"""
Helpers compartidos por los tests del Master de RQ (SYSPCC-030).

Crean los datos del almacén directamente (grupo de movimiento + despacho + línea) para poder
ubicar un RQ en CUALQUIER estado sin recorrer el flujo; el cálculo del Master lee esas mismas
tablas que escriben los servicios reales de entrega.
"""
import itertools
from decimal import Decimal

from apps.core.enums import (
    ApprovalActionChoices,
    MovementTypeChoices,
    RoleChoices,
    WarehouseOriginChoices,
)
from apps.rq.models import Approval
from apps.rq.tests.catalog_fixtures import make_user
from apps.warehouse.models import (
    MovementGroup,
    WarehouseDispatch,
    WarehouseDispatchItem,
)

_counter = itertools.count(1)


def set_status(rq, status):
    rq.status = status
    rq.save(update_fields=['status'])
    return rq


def make_delivery(rq, item, quantity, *, guide='GR-001-0001', on=None, by=None, reverses=None,
                  group_guide=''):
    """
    Una entrega (o reversa si `reverses` es otra entrega) de `quantity` del ítem `item`.
    `on` es la fecha operativa (MovementGroup.movement_date); `by` el usuario que registró.
    """
    n = next(_counter)
    if by is None:
        by = make_user(f'warehouse_clerk_{n}', RoleChoices.CENTRAL_WAREHOUSE)
    group = MovementGroup.objects.create(
        group_number=f'VMC-T{n:06d}',
        movement_type=MovementTypeChoices.EXIT if reverses is None else MovementTypeChoices.ENTRY,
        warehouse=WarehouseOriginChoices.CENTRAL,
        movement_date=on,
        guide_number=group_guide,
        registered_by=by,
    )
    dispatch = WarehouseDispatch.objects.create(
        request=rq,
        dispatched_by=by,
        origin=WarehouseOriginChoices.CENTRAL,
        dispatch_number=f'DSP-T{n:06d}',
        dispatch_guide_number=guide,
        movement_group=group,
        reverses=reverses,
    )
    WarehouseDispatchItem.objects.create(
        dispatch=dispatch, request_item=item, quantity_dispatched=Decimal(str(quantity)),
    )
    return dispatch


def make_approval(rq, new_status, *, previous_status='SUBMITTED', by=None, at=None):
    """Una fila de Approval con `new_status`; `at` fija performed_at (auto_now_add)."""
    if by is None:
        by = make_user(f'approver_{next(_counter)}', RoleChoices.GENERAL_MANAGER)
    approval = Approval.objects.create(
        request=rq,
        action=ApprovalActionChoices.SUBMITTED,
        performed_by=by,
        role=RoleChoices.GENERAL_MANAGER,
        previous_status=previous_status,
        new_status=new_status,
    )
    if at is not None:
        Approval.objects.filter(pk=approval.pk).update(performed_at=at)
    return approval


# ───────────────────────────── escenario común ─────────────────────────────
import datetime  # noqa: E402

import pytest  # noqa: E402
from django.utils import timezone  # noqa: E402

from apps.rq.tests.catalog_fixtures import (  # noqa: E402,F401  (fixtures reutilizadas)
    client_for,
    central_warehouse,
    logistics_chief,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_request,
    make_stock,
)

LIMA = timezone.get_fixed_timezone(-300)


def lima(year, month, day, hour=10):
    return datetime.datetime(year, month, day, hour, 0, tzinfo=LIMA)


class World:
    """Los RQs e ítems del escenario; cada atributo es el objeto ya creado."""


@pytest.fixture
def world(db, project, other_project, department, requester, other_requester,
          department_requester, logistics_coordinator):
    """
    A  OPS · `project` · requester · DELIVERED · área OP · prioridad HIGH
         A1 casco (vinculado) 10: entregado 6 (GR-A1, 05/10) + 4 (GR-A2, 08/10)  -> ATENDIDO
         A2 guantes (vinculado) 4: entregado 1 (GR-A1, 05/10)                    -> PARCIAL
         A3 servicio (fuera de catálogo) 1                                       -> ATENDIDO por flujo
         A4 sin vincular 2                                                       -> SIN VINCULAR
       aprobación (VALIDATED) 01/10; gerencia GM_REVIEW -> GM_APPROVED; DELIVERED 09/10
    B  OPS · `other_project` · other_requester · IN_STOCK · sin área
         B1 guantes (vinculado) 5 sin entregas                                   -> PENDIENTE
    C  ADM · `department` · department_requester · CANCELLED · área ADM
         C1 papel (vinculado) 3 con 1 ya entregado                               -> ANULADO + CON_MOVIMIENTOS
    """
    w = World()
    w.helmet = make_inventory('EPP-0001', 'Casco de seguridad blanco', 'UND', category='EPP')
    w.gloves = make_inventory('EPP-0002', 'Guantes de cuero', 'PAR', category='EPP')
    w.paper = make_inventory('MAT-0001', 'Papel bond A4', 'MLL', category='Otros')
    make_stock(w.helmet, 10)
    make_stock(w.gloves, 20)
    make_stock(w.paper, 5)

    w.clerk1 = make_user('clerk_one', RoleChoices.CENTRAL_WAREHOUSE)
    w.clerk2 = make_user('clerk_two', RoleChoices.CENTRAL_WAREHOUSE)

    w.a = make_request(number='RQ-2026-0101', requester=requester, project=project, status='DELIVERED')
    w.a.requesting_area = 'OP'
    w.a.priority = 'HIGH'
    w.a.fecha_necesidad = datetime.date(2026, 11, 1)
    w.a.save()
    w.a1 = make_item(w.a, 1, description='Casco de seguridad', quantity=10, inventory_item=w.helmet,
                     confirmed=True, item_source='EPP', presupuestado_adicional='P',
                     comentarios='Entrega urgente')
    w.a2 = make_item(w.a, 2, description='Guantes de cuero', quantity=4, unit='PAR',
                     inventory_item=w.gloves, confirmed=True, item_source='EPP')
    w.a3 = make_item(w.a, 3, description='Servicio de topografía', quantity=1, unit='GLB',
                     is_off_catalog=True)
    w.a4 = make_item(w.a, 4, description='Cinta señalizadora', quantity=2, unit='ROL')
    w.d_a1_1 = make_delivery(w.a, w.a1, 6, guide='GR-A1', on=datetime.date(2026, 10, 5), by=w.clerk1)
    make_delivery(w.a, w.a2, 1, guide='GR-A1', on=datetime.date(2026, 10, 5), by=w.clerk1)
    make_delivery(w.a, w.a1, 4, guide='GR-A2', on=datetime.date(2026, 10, 8), by=w.clerk2)
    make_approval(w.a, 'VALIDATED', at=lima(2026, 10, 1))
    make_approval(w.a, 'GM_REVIEW', at=lima(2026, 9, 29))
    make_approval(w.a, 'GM_APPROVED', at=lima(2026, 9, 30))
    make_approval(w.a, 'DELIVERED', at=lima(2026, 10, 9))

    w.b = make_request(number='RQ-2026-0102', requester=other_requester, project=other_project,
                       status='IN_STOCK')
    w.b1 = make_item(w.b, 1, description='Guantes dieléctricos', quantity=5, unit='PAR',
                     inventory_item=w.gloves, confirmed=True)
    make_approval(w.b, 'VALIDATED', at=lima(2026, 10, 12))

    w.c = make_request(number='RQ-2026-0103', requester=department_requester, department=department,
                       flow='ADMINISTRATIVE', status='CANCELLED')
    w.c.requesting_area = 'ADM'
    w.c.save()
    w.c1 = make_item(w.c, 1, description='Papel bond A4', quantity=3, unit='MLL',
                     inventory_item=w.paper, confirmed=True)
    make_delivery(w.c, w.c1, 1, guide='GR-C1', on=datetime.date(2026, 10, 3), by=w.clerk1)
    return w
