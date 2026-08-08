"""
Import pasajes from legacy SQL Server CSV export.
Usage: python manage.py import_pasajes_csv /path/to/Pasaje.csv

Idempotent: rows are matched by the legacy `CodigoId` CSV column (stored as
`Pasaje.codigo_id_legado`, a UNIQUE natural key), so re-running the same CSV
updates existing rows instead of duplicating them.

Each row is imported inside its own DB savepoint (`transaction.atomic()`
nested block). A failure on one row only rolls back that row: it never
poisons the rest of the import (which happens on PostgreSQL if a bare
`except Exception` swallows a DB error without a savepoint — the connection
is left in an aborted-transaction state and every subsequent query raises
`TransactionManagementError`).

PII note: `dni` and `nombres` are personal data. Never log their values —
only row numbers and exception *types* are logged.
"""
import csv
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.db import DatabaseError, IntegrityError, transaction

logger = logging.getLogger(__name__)


def parse_date(val):
    """Parse '2024-12-31 00:00:00.000' or '' → date or None."""
    if not val or not val.strip():
        return None
    val = val.strip()
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    return None


def parse_datetime(val):
    """Parse datetime string → datetime or None."""
    if not val or not val.strip():
        return None
    val = val.strip()
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.strptime(val, fmt)
        except ValueError:
            continue
    return None


def parse_decimal(val):
    """Parse decimal string → Decimal or 0."""
    if not val or not val.strip():
        return Decimal('0')
    try:
        return Decimal(val.strip())
    except (InvalidOperation, ValueError):
        return Decimal('0')


def parse_bool(val):
    """Parse 'true'/'false'/1/0 → bool."""
    if not val:
        return True
    return str(val).strip().lower() in ('true', '1', 'yes')


def build_pasaje_defaults(row, proveedor_map, default_user):
    """Map a CSV row dict to the Pasaje field values used by update_or_create.

    Pure function, no DB access — safe to call outside the per-row savepoint.
    """
    ruc = (row.get('Ruc') or '').strip()
    proveedor = proveedor_map.get(ruc)

    monto_soles = parse_decimal(row.get('MontoConIGVSoles'))
    monto_dolares = parse_decimal(row.get('MontoConIGVDolares'))
    moneda = 'DOLARES' if monto_dolares > 0 and monto_soles == 0 else 'SOLES'

    tipo = (row.get('Tipo') or 'B').strip()
    if tipo not in ('B', 'S', 'S/B'):
        tipo = 'B'

    tipo_trabajador = (row.get('TipoTrabajador') or 'WORKER').strip().upper()
    if tipo_trabajador not in ('STAFF', 'WORKER'):
        tipo_trabajador = 'WORKER'

    estado = (row.get('Estado') or 'PENDIENTE').strip().upper()
    if estado not in ('PAGADO', 'PENDIENTE'):
        estado = 'PENDIENTE'

    return {
        'tipo': tipo,
        'fecha_bajada': parse_date(row.get('FechaBajada')),
        'embarque_bajada': (row.get('EmbarqueBajada') or '').strip(),
        'destino_bajada': (row.get('DestinoBajada') or '').strip(),
        'fecha_subida': parse_date(row.get('FechaSubida')),
        'embarque_subida': (row.get('EmbarqueSubida') or '').strip(),
        'destino_subida': (row.get('DestinoSubida') or '').strip(),
        'dni': (row.get('DNI') or '').strip(),
        'nombres': (row.get('Nombres') or '').strip(),
        'cargo': (row.get('Cargo') or '').strip(),
        'tipo_trabajador': tipo_trabajador,
        'proveedor': proveedor,
        'ruc': ruc,
        'razon_social': (row.get('RazonSocial') or '').strip(),
        'detalle': (row.get('Detalle') or '').strip(),
        'factura_ticket': (row.get('FacturaTicket') or '').strip(),
        'fecha': parse_date(row.get('Fecha')),
        'moneda': moneda,
        'monto_con_igv_soles': monto_soles,
        'monto_con_igv_dolares': monto_dolares,
        'tipo_cambio': parse_decimal(row.get('TipoCambio')),
        'devolucion': parse_decimal(row.get('Devolucion')),
        'total': parse_decimal(row.get('Total')),
        'estado': estado,
        'fecha_pago': parse_date(row.get('FechaPago')),
        'numero_operacion': (row.get('NumeroOperacion') or '').strip(),
        'habilitado': parse_bool(row.get('Habilitado')),
        'creado_por': default_user,
    }


class Command(BaseCommand):
    help = 'Import pasajes from a legacy CSV export (idempotent, matched by CodigoId)'

    def add_arguments(self, parser):
        parser.add_argument('csv_path', type=str, help='Path to the Pasaje CSV file')
        parser.add_argument('--clear', action='store_true', help='Delete existing pasajes before import')

    def handle(self, *args, **options):
        from apps.administracion.models import Pasaje, ProveedorPasajes
        from apps.core.models import User

        csv_path = options['csv_path']

        if options['clear']:
            with transaction.atomic():
                count = Pasaje.objects.count()
                Pasaje.objects.all().delete()
            self.stdout.write(self.style.WARNING(f'Deleted {count} existing pasajes.'))

        # SYSPCC-013 FIX 7: `.order_by('id')` makes the pick deterministic —
        # without it, `.first()` relies on whatever order the DB happens to
        # return rows in (undefined without an explicit ORDER BY), so the
        # `creado_por` attribution on freshly-imported rows could vary
        # between runs.
        default_user = User.objects.filter(is_staff=True).order_by('id').first()
        proveedor_map = {p.ruc: p for p in ProveedorPasajes.objects.all()}

        self.stdout.write(f'Reading CSV from: {csv_path}')

        created = 0
        updated = 0
        errors = 0
        row_number = 1  # header row

        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)

            for row in reader:
                row_number += 1
                codigo_id = (row.get('CodigoId') or '').strip()

                if not codigo_id:
                    # No natural key to match against on re-import — importing it
                    # anyway would either duplicate on every re-run or require a
                    # guess. Skip and count as an error; nothing was written to
                    # the DB, so no savepoint is needed for this branch.
                    errors += 1
                    logger.warning(
                        'import_pasajes_csv.row.missing_codigo_id',
                        extra={'row_number': row_number},
                    )
                    continue

                defaults = build_pasaje_defaults(row, proveedor_map, default_user)

                try:
                    # Savepoint per row: an IntegrityError/DatabaseError here rolls
                    # back only this row, leaving the outer transaction (and every
                    # row processed before/after it) unaffected.
                    with transaction.atomic():
                        _pasaje, was_created = Pasaje.objects.update_or_create(
                            codigo_id_legado=codigo_id,
                            defaults=defaults,
                        )
                except (IntegrityError, DatabaseError) as exc:
                    errors += 1
                    # Never log str(exc): DB error messages (esp. IntegrityError
                    # DETAIL on PostgreSQL) can echo back the offending value,
                    # which may be a DNI or name. Row number + exception type only.
                    logger.warning(
                        'import_pasajes_csv.row.db_error',
                        extra={'row_number': row_number, 'error_type': type(exc).__name__},
                    )
                    continue

                if was_created:
                    created += 1
                else:
                    updated += 1

                total_processed = created + updated
                if total_processed % 500 == 0:
                    self.stdout.write(f'  ... {total_processed} rows processed')

        self.stdout.write(self.style.SUCCESS(
            f'\nImport complete: {created} created, {updated} updated, {errors} errors'
        ))
        self.stdout.write(f'Total pasajes in DB: {Pasaje.objects.count()}')
