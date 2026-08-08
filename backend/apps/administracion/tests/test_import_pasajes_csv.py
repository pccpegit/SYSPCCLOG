"""
Tests for SYSPCC-008: import_pasajes_csv idempotency + transaction isolation.

Uses synthetic in-memory CSV rows (no real PII, no real legacy CSV file).
"""
import csv
from io import StringIO
from unittest import mock

import pytest
from django.core.management import call_command
from django.db import IntegrityError

from apps.administracion.models import Pasaje
from apps.core.models import User

CSV_FIELDS = [
    'CodigoId', 'Tipo', 'FechaBajada', 'EmbarqueBajada', 'DestinoBajada',
    'FechaSubida', 'EmbarqueSubida', 'DestinoSubida', 'DNI', 'Nombres',
    'Cargo', 'TipoTrabajador', 'Ruc', 'RazonSocial', 'Detalle',
    'FacturaTicket', 'Fecha', 'MontoConIGVSoles', 'MontoConIGVDolares',
    'TipoCambio', 'Devolucion', 'Total', 'Estado', 'FechaPago',
    'NumeroOperacion', 'Habilitado',
]


def _row(codigo_id, dni='00000000', nombres='Test Testeable', **overrides):
    """Build one synthetic CSV row dict with sane defaults, no real PII."""
    row = {
        'CodigoId': codigo_id,
        'Tipo': 'B',
        'FechaBajada': '2026-01-10',
        'EmbarqueBajada': 'Campamento',
        'DestinoBajada': 'Lima',
        'FechaSubida': '',
        'EmbarqueSubida': '',
        'DestinoSubida': '',
        'DNI': dni,
        'Nombres': nombres,
        'Cargo': 'Operario',
        'TipoTrabajador': 'WORKER',
        'Ruc': '',
        'RazonSocial': '',
        'Detalle': 'Ruta de prueba',
        'FacturaTicket': 'F001-000123',
        'Fecha': '2026-01-05',
        'MontoConIGVSoles': '150.00',
        'MontoConIGVDolares': '0',
        'TipoCambio': '0',
        'Devolucion': '0',
        'Total': '150.00',
        'Estado': 'PENDIENTE',
        'FechaPago': '',
        'NumeroOperacion': '',
        'Habilitado': 'true',
    }
    row.update(overrides)
    return row


def _write_csv(path, rows):
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction='ignore')
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


@pytest.fixture
def staff_user(db):
    """Default `creado_por` user the import command looks up (is_staff=True)."""
    return User.objects.create_user(
        username='importer',
        email='importer@test.com',
        password='TestPass2026!',
        first_name='Import',
        last_name='Bot',
        is_staff=True,
    )


@pytest.mark.django_db
class TestImportPasajesIdempotency:
    def test_reimporting_same_rows_does_not_duplicate(self, staff_user, tmp_path):
        """Running the import twice with identical rows must yield the same
        row count, not double it — proves update_or_create on codigo_id_legado
        makes the command idempotent."""
        csv_path = tmp_path / 'pasajes.csv'
        rows = [_row('LEG-001'), _row('LEG-002'), _row('LEG-003')]
        _write_csv(csv_path, rows)

        call_command('import_pasajes_csv', str(csv_path))
        assert Pasaje.objects.count() == 3

        call_command('import_pasajes_csv', str(csv_path))
        assert Pasaje.objects.count() == 3  # not 6

        # Natural key preserved, no duplicates per CodigoId either
        assert Pasaje.objects.filter(codigo_id_legado='LEG-001').count() == 1

    def test_reimport_updates_changed_fields_instead_of_duplicating(self, staff_user, tmp_path):
        csv_path = tmp_path / 'pasajes.csv'
        _write_csv(csv_path, [_row('LEG-001', Estado='PENDIENTE')])
        call_command('import_pasajes_csv', str(csv_path))

        pasaje = Pasaje.objects.get(codigo_id_legado='LEG-001')
        assert pasaje.estado == 'PENDIENTE'

        _write_csv(csv_path, [_row('LEG-001', Estado='PAGADO')])
        call_command('import_pasajes_csv', str(csv_path))

        assert Pasaje.objects.count() == 1
        pasaje.refresh_from_db()
        assert pasaje.estado == 'PAGADO'


@pytest.mark.django_db
class TestImportPasajesRowIsolation:
    def test_missing_codigo_id_is_skipped_without_affecting_other_rows(self, staff_user, tmp_path):
        csv_path = tmp_path / 'pasajes.csv'
        rows = [_row('LEG-001'), _row(''), _row('LEG-003')]
        _write_csv(csv_path, rows)

        out = StringIO()
        call_command('import_pasajes_csv', str(csv_path), stdout=out)

        assert Pasaje.objects.count() == 2
        assert 'created' in out.getvalue()

    def test_db_error_on_one_row_does_not_poison_the_rest_of_the_import(self, staff_user, tmp_path):
        """Regression test for the poisoned-transaction bug: a DB error on one
        row must be contained to a savepoint so the rows before and after it
        still get imported, with an accurate created/error count."""
        csv_path = tmp_path / 'pasajes.csv'
        rows = [_row('LEG-001'), _row('LEG-002'), _row('LEG-003')]
        _write_csv(csv_path, rows)

        real_update_or_create = Pasaje.objects.update_or_create
        call_count = {'n': 0}

        def flaky_update_or_create(*args, **kwargs):
            call_count['n'] += 1
            if call_count['n'] == 2:  # fail exactly the middle row
                raise IntegrityError('simulated constraint violation')
            return real_update_or_create(*args, **kwargs)

        out = StringIO()
        with mock.patch.object(Pasaje.objects, 'update_or_create', side_effect=flaky_update_or_create):
            call_command('import_pasajes_csv', str(csv_path), stdout=out)

        # Row 2 failed; rows 1 and 3 (before/after the failure) must still be
        # committed — proves the failure was isolated to its own savepoint
        # instead of aborting the whole outer transaction.
        assert Pasaje.objects.count() == 2
        assert set(Pasaje.objects.values_list('codigo_id_legado', flat=True)) == {'LEG-001', 'LEG-003'}
        assert '2 created' in out.getvalue()
        assert '1 errors' in out.getvalue()

    def test_error_log_never_includes_row_pii(self, staff_user, tmp_path, caplog):
        """The DB-error log path must log row_number + exception type only —
        never the field values (which may carry DNI/nombres)."""
        csv_path = tmp_path / 'pasajes.csv'
        secret_dni = '99999999'
        _write_csv(csv_path, [_row('LEG-001', dni=secret_dni)])

        with mock.patch.object(
            Pasaje.objects, 'update_or_create',
            side_effect=IntegrityError(f'duplicate key value violates unique constraint DETAIL: Key (dni)=({secret_dni})'),
        ):
            with caplog.at_level('WARNING'):
                call_command('import_pasajes_csv', str(csv_path))

        assert secret_dni not in caplog.text


@pytest.mark.django_db
class TestImportPasajesDefaultUserDeterminism:
    """SYSPCC-013 FIX 7: `default_user` selection must be deterministic."""

    def test_default_user_is_lowest_id_staff_user_regardless_of_creation_order(self, tmp_path):
        """Create two is_staff users where insertion order and id order could
        disagree with an unordered `.first()` — `.order_by('id').first()`
        must always pick the same one (the lowest id) run after run."""
        second_staff = User.objects.create_user(
            username='staff_two', email='staff_two@test.com',
            password='TestPass2026!', is_staff=True,
        )
        first_staff = User.objects.create_user(
            username='staff_one', email='staff_one@test.com',
            password='TestPass2026!', is_staff=True,
        )
        # Whichever of the two has the lower pk (creation order is
        # independent of pk order under some DB configs) must be picked.
        expected_user = min([second_staff, first_staff], key=lambda u: u.pk)

        csv_path = tmp_path / 'pasajes.csv'
        _write_csv(csv_path, [_row('LEG-DET-001')])
        call_command('import_pasajes_csv', str(csv_path))

        pasaje = Pasaje.objects.get(codigo_id_legado='LEG-DET-001')
        assert pasaje.creado_por_id == expected_user.pk

    def test_default_user_pick_is_stable_across_repeated_runs(self, tmp_path):
        """Re-running the import (idempotent update_or_create) must keep
        attributing to the same user every time — proves the ordering isn't
        incidentally stable only on the first call."""
        User.objects.create_user(
            username='staff_a', email='staff_a@test.com',
            password='TestPass2026!', is_staff=True,
        )
        User.objects.create_user(
            username='staff_b', email='staff_b@test.com',
            password='TestPass2026!', is_staff=True,
        )
        expected_user = User.objects.filter(is_staff=True).order_by('id').first()

        csv_path = tmp_path / 'pasajes.csv'
        _write_csv(csv_path, [_row('LEG-DET-002')])

        call_command('import_pasajes_csv', str(csv_path))
        call_command('import_pasajes_csv', str(csv_path))
        call_command('import_pasajes_csv', str(csv_path))

        pasaje = Pasaje.objects.get(codigo_id_legado='LEG-DET-002')
        assert pasaje.creado_por_id == expected_user.pk


@pytest.mark.django_db
class TestPasajeCodigoIdLegadoConstraint:
    def test_unique_constraint_enforced_at_db_level(self, staff_user):
        Pasaje.objects.create(
            tipo='B',
            dni='11111111',
            nombres='Uno',
            tipo_trabajador='WORKER',
            codigo_id_legado='DUP-001',
            creado_por=staff_user,
        )
        with pytest.raises(IntegrityError):
            Pasaje.objects.create(
                tipo='B',
                dni='22222222',
                nombres='Dos',
                tipo_trabajador='WORKER',
                codigo_id_legado='DUP-001',
                creado_por=staff_user,
            )

    def test_multiple_null_codigo_id_legado_allowed(self, staff_user):
        """Rows created outside the CSV import (no legacy id) must not collide
        with each other under the UNIQUE constraint — NULL != NULL."""
        Pasaje.objects.create(
            tipo='B', dni='11111111', nombres='Uno',
            tipo_trabajador='WORKER', creado_por=staff_user,
        )
        Pasaje.objects.create(
            tipo='B', dni='22222222', nombres='Dos',
            tipo_trabajador='WORKER', creado_por=staff_user,
        )
        assert Pasaje.objects.filter(codigo_id_legado__isnull=True).count() == 2
