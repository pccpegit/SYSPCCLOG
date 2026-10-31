"""
Shared fixtures for the warehouse tests (SYSPCC-025).

All person names used here are INVENTED. Never copy names from a real workbook.
"""
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache.backends.locmem import LocMemCache
from rest_framework.test import APIClient

from apps.core.enums import ItemTypeChoices, RoleChoices, WarehouseOriginChoices
from apps.core.models import Personal, UserRole
from apps.core.throttling import ThrottleCacheMixin
from apps.warehouse.models import Inventory, InventoryStock

User = get_user_model()


@pytest.fixture(autouse=True)
def isolated_throttle_counters(monkeypatch):
    """
    Rate-limit counters live in Redis in this stack and survive the per-test rollback, while
    SQLite reuses the same user ids test after test. A big parametrised matrix (several
    hundred requests from "user 1" inside one minute) therefore trips the 1000/min limit
    and answers 429 for no reason related to the behaviour under test. Give every test its
    own process-local counter store (the throttle classes resolve ``cache`` lazily).
    """
    local = LocMemCache(f'warehouse-throttle-{uuid.uuid4()}', {})
    monkeypatch.setattr(ThrottleCacheMixin, 'cache', property(lambda self: local))


@pytest.fixture(autouse=True)
def relaxed_exit_guards(monkeypatch):
    """
    SYSPCC-041 added two guards to the free exits (batch-exit, exit, epp-delivery): the
    ``warehouse_exit`` throttle (30/min) and the double-submit window (identical exit by the same
    user in 15 s -> 409 DUPLICATE_EXIT). Most tests of this suite register the same exit over and
    over on purpose, and the fuzz tests post hundreds of payloads, so both guards are off by default.
    A test that exercises them asks for ``real_exit_guards``.
    """
    from datetime import timedelta

    from apps.warehouse.services import movements
    from apps.warehouse.throttling import WarehouseExitThrottle

    monkeypatch.setattr(movements, 'DUPLICATE_EXIT_WINDOW', timedelta(0))
    monkeypatch.setattr(
        WarehouseExitThrottle, 'THROTTLE_RATES',
        {**WarehouseExitThrottle.THROTTLE_RATES, 'warehouse_exit': '1000000/min'},
    )


@pytest.fixture
def real_exit_guards(monkeypatch, relaxed_exit_guards):
    """Put the production values of the exit guards back (15 s window, 30 requests/min)."""
    from datetime import timedelta

    from apps.warehouse.services import movements
    from apps.warehouse.throttling import WarehouseExitThrottle

    monkeypatch.setattr(movements, 'DUPLICATE_EXIT_WINDOW', timedelta(seconds=15))
    monkeypatch.setattr(
        WarehouseExitThrottle, 'THROTTLE_RATES',
        {**WarehouseExitThrottle.THROTTLE_RATES, 'warehouse_exit': '30/min'},
    )


def make_user(username: str, role: str, project=None):
    u = User.objects.create_user(
        username=username,
        email=f'{username}@test.com',
        password='TestPass2026!',
        first_name=username.title(),
        last_name='Prueba',
    )
    UserRole.objects.create(user=u, role=role, project=project, is_primary=True)
    return u


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def central_warehouse(db):
    return make_user('central_wh', RoleChoices.CENTRAL_WAREHOUSE)


@pytest.fixture
def logistics_chief(db):
    return make_user('logistics_chief', RoleChoices.LOGISTICS_CHIEF)


@pytest.fixture
def logistics_supervisor(db):
    return make_user('logistics_sup', RoleChoices.LOGISTICS_SUPERVISOR)


@pytest.fixture
def make_item(db):
    def _make(code='EPP000001', description='CASCO DE SEGURIDAD', unit='EA', stock=None,
              warehouse=WarehouseOriginChoices.CENTRAL, **extra):
        # `project` in **extra is the catalog attribute Inventory.project (not the stock scope).
        item = Inventory.objects.create(
            product_code=code, description=description, unit=unit,
            category=extra.pop('category', 'EPP'),
            item_type=extra.pop('item_type', ItemTypeChoices.EPP),
            **extra,
        )
        if stock is not None:
            InventoryStock.objects.create(
                inventory=item, warehouse_type=warehouse, project=None, department=None,
                quantity=Decimal(str(stock)),
            )
        return item
    return _make


@pytest.fixture
def epp_item(make_item):
    return make_item('EPP000001', 'GUANTE DE CUERO T: L', 'EA', stock=10)


@pytest.fixture
def make_personal(db):
    counter = {'n': 0}

    def _make(full_name='Quispe Mamani, Rosa Test', active=True):
        counter['n'] += 1
        return Personal.objects.create(
            dni=f'9{counter["n"]:07d}',
            apellidos_nombres=full_name,
            estado='ACTIVO' if active else 'CESADO',
            puesto='Operario de prueba',
        )
    return _make


class _LogProbe:
    def __init__(self, caplog):
        self.caplog = caplog

    @property
    def records(self):
        return self.caplog.records

    def dump(self) -> str:
        """Every record rendered with its message AND its extra fields."""
        return '\n'.join(
            r.getMessage() + ' ' + repr(r.__dict__) + (r.exc_text or '') for r in self.caplog.records
        )

    def events(self) -> set[str]:
        return {r.getMessage() for r in self.caplog.records}


@pytest.fixture
def app_logs(caplog):
    """
    Capture the project's logs. The 'apps' logger does not propagate to the root
    logger (config/settings/base.py), so caplog needs its handler attached to it;
    otherwise a "no names in logs" assertion would pass vacuously.
    """
    import logging

    logger = logging.getLogger('apps')
    logger.addHandler(caplog.handler)
    caplog.set_level(logging.DEBUG, logger='apps')
    try:
        yield _LogProbe(caplog)
    finally:
        logger.removeHandler(caplog.handler)
