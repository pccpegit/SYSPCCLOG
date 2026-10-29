"""
Shared fixtures/helpers for the SYSPCC-026 catalog-capture tests.

Kept in its own module (imported by name into each test module) instead of the
shared conftest files so these tests do not depend on, or collide with, edits
other work makes to the global fixtures.
"""
import contextlib
import datetime
import logging
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.core.enums import (
    AcquisitionTypeChoices,
    RoleChoices,
    RQFlowChoices,
    WarehouseOriginChoices,
)
from apps.core.models import UserRole
from apps.rq.models import Request, RequestItem
from apps.warehouse.models import Inventory, InventoryStock

User = get_user_model()


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def make_user(username, role, *, project=None, department=None):
    user = User.objects.create_user(
        username=username,
        email=f'{username}@test.com',
        password='TestPass2026!',
        first_name=username.title(),
        last_name='Test',
    )
    UserRole.objects.create(
        user=user, role=role, project=project, department_obj=department, is_primary=True,
    )
    return user


def make_inventory(code='EPP-0001', description='Casco de seguridad blanco', unit='UND',
                   category='EPP', **extra):
    return Inventory.objects.create(
        product_code=code, description=description, unit=unit, category=category, **extra,
    )


def make_stock(inventory, quantity, *, warehouse_type=WarehouseOriginChoices.CENTRAL,
               project=None, department=None):
    return InventoryStock.objects.create(
        inventory=inventory,
        warehouse_type=warehouse_type,
        project=project,
        department=department,
        quantity=Decimal(str(quantity)),
    )


def make_request(*, number, requester, flow=RQFlowChoices.OPERATIONS, project=None,
                 department=None, status='SUBMITTED'):
    return Request.objects.create(
        rq_number=number,
        flow=flow,
        project=project,
        department=department,
        requested_by=requester,
        status=status,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )


def make_item(request_obj, line_number=1, *, description='Casco de seguridad', quantity='10',
              unit='UND', **extra):
    return RequestItem.objects.create(
        request=request_obj,
        line_number=line_number,
        description=description,
        quantity=Decimal(str(quantity)),
        unit=unit,
        **extra,
    )


@pytest.fixture
def logistics_supervisor(db):
    return make_user('logistics_supervisor', RoleChoices.LOGISTICS_SUPERVISOR)


@pytest.fixture
def logistics_chief(db):
    return make_user('logistics_chief', RoleChoices.LOGISTICS_CHIEF)


@pytest.fixture
def central_warehouse(db):
    return make_user('central_warehouse', RoleChoices.CENTRAL_WAREHOUSE)


@pytest.fixture
def ops_rq(db, project, requester):
    """OPERATIONS request owned by `requester` (the fixture user of `project`)."""
    return make_request(number='RQ-2026-0501', requester=requester, project=project)


@pytest.fixture
def adm_rq(db, department, department_requester):
    """ADMINISTRATIVE request owned by `department_requester`."""
    return make_request(
        number='RQ-2026-0502', requester=department_requester,
        flow=RQFlowChoices.ADMINISTRATIVE, department=department,
    )


@pytest.fixture
def rq_in_editable_state(request):
    """
    update-items only edits the lines from VALIDATED up to before the dispatch
    (SYSPCC-026). `ops_rq` / `adm_rq` are born SUBMITTED, so a module that exercises
    that endpoint requests this fixture: it moves whichever of the two the test uses
    to VALIDATED. Tests about the state guard set their own status afterwards.
    """
    for name in ('ops_rq', 'adm_rq'):
        if name in request.fixturenames:
            rq = request.getfixturevalue(name)
            rq.status = 'VALIDATED'
            rq.save(update_fields=['status'])


@contextlib.contextmanager
def capture_logs(caplog, logger_name, level=logging.WARNING):
    """
    Attach caplog's handler straight to `logger_name`: config/settings/base.py sets
    propagate=False on the 'apps' namespace, so the default caplog capture misses it.
    """
    logger = logging.getLogger(logger_name)
    previous_level = logger.level
    logger.setLevel(level)
    logger.addHandler(caplog.handler)
    try:
        yield
    finally:
        logger.removeHandler(caplog.handler)
        logger.setLevel(previous_level)
