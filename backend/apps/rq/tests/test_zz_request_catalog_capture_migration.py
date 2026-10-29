"""
SYSPCC-026: migration rq/0008 (requesting_area, item_source, is_off_catalog + the
catalog/off-catalog CHECK constraint) is additive: it applies and reverts without
losing request rows, new columns default to blank/False for rows that predate it, and
the constraint is live afterwards.

Named test_zz_* so it runs after the rest of the rq tests; it always restores the
schema to the latest state, even when an assertion fails.
"""
import datetime

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor

from apps.rq.models import Request, RequestItem
from apps.warehouse.models import Inventory

pytestmark = pytest.mark.django_db(transaction=True)

BEFORE = [('rq', '0007_add_hr_manager_role_choice')]


def _migrate(targets):
    executor = MigrationExecutor(connection)
    executor.migrate(targets)


def _latest():
    return MigrationExecutor(connection).loader.graph.leaf_nodes()


def _columns(table):
    with connection.cursor() as cursor:
        return {c.name for c in connection.introspection.get_table_description(cursor, table)}


def _count(table):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT COUNT(*) FROM {table}')
        return cursor.fetchone()[0]


@pytest.fixture
def restore_schema():
    yield
    _migrate(_latest())


@pytest.fixture
def seeded(requester, project):
    request_obj = Request.objects.create(
        rq_number='RQ-2026-0900', flow='OPERATIONS', project=project, requested_by=requester,
        acquisition_type='COMPRA_LOCAL', requesting_area='OP',
        fecha_necesidad=datetime.date(2026, 12, 31),
    )
    RequestItem.objects.create(
        request=request_obj, line_number=1, description='Cemento', quantity=10, unit='BLS',
        item_source='MATERIALES',
    )
    return request_obj


def test_0008_reverts_and_reapplies_keeping_the_rows(seeded, restore_schema):
    assert 'requesting_area' in _columns('requests')
    assert {'item_source', 'is_off_catalog'} <= _columns('request_items')

    _migrate(BEFORE)

    assert 'requesting_area' not in _columns('requests')
    assert not {'item_source', 'is_off_catalog'} & _columns('request_items')
    assert _count('requests') == 1 and _count('request_items') == 1  # rows survive the column drop

    _migrate(_latest())

    assert 'requesting_area' in _columns('requests')
    assert {'item_source', 'is_off_catalog'} <= _columns('request_items')
    assert _count('requests') == 1 and _count('request_items') == 1


def test_rows_that_predate_0008_get_blank_defaults(seeded, restore_schema):
    _migrate(BEFORE)
    _migrate(_latest())

    request_obj = Request.objects.get(rq_number='RQ-2026-0900')
    item = request_obj.items.get()
    assert request_obj.requesting_area == ''
    assert item.item_source == ''
    assert item.is_off_catalog is False
    assert item.inventory_item_id is None
    # the pre-existing data of the row is intact
    assert item.description == 'Cemento' and str(item.quantity) == '10.000'


def test_the_check_constraint_is_live_after_the_migration(seeded, restore_schema):
    _migrate(BEFORE)
    _migrate(_latest())
    product = Inventory.objects.create(product_code='EPP-9', description='Casco', unit='UND')
    item = RequestItem.objects.get(request__rq_number='RQ-2026-0900')

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            RequestItem.objects.filter(pk=item.pk).update(inventory_item=product, is_off_catalog=True)

    RequestItem.objects.filter(pk=item.pk).update(inventory_item=product)  # either state alone is fine
    RequestItem.objects.filter(pk=item.pk).update(inventory_item=None, is_off_catalog=True)


def test_no_pending_model_changes_for_rq(db):
    from django.core.management import call_command

    call_command('makemigrations', 'rq', '--check', '--dry-run')
