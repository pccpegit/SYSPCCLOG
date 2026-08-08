"""
Import pasajes from legacy SQL Server CSV export.
Usage: python manage.py import_pasajes_csv /path/to/Pasaje.csv
"""
import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.db import transaction


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


class Command(BaseCommand):
    help = 'Import pasajes from a legacy CSV export'

    def add_arguments(self, parser):
        parser.add_argument('csv_path', type=str, help='Path to the Pasaje CSV file')
        parser.add_argument('--clear', action='store_true', help='Delete existing pasajes before import')

    @transaction.atomic
    def handle(self, *args, **options):
        from apps.administracion.models import Pasaje, ProveedorPasajes
        from apps.core.models import User

        csv_path = options['csv_path']

        if options['clear']:
            count = Pasaje.objects.count()
            Pasaje.objects.all().delete()
            self.stdout.write(self.style.WARNING(f'Deleted {count} existing pasajes.'))

        # Get default user for creado_por
        default_user = User.objects.filter(is_staff=True).first()

        # Build proveedor lookup by RUC
        proveedor_map = {p.ruc: p for p in ProveedorPasajes.objects.all()}

        self.stdout.write(f'Reading CSV from: {csv_path}')

        created = 0
        skipped = 0
        errors = 0

        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)

            batch = []
            for row in reader:
                try:
                    ruc = (row.get('Ruc') or '').strip()
                    proveedor = proveedor_map.get(ruc)

                    # Determine moneda based on which amount field has data
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

                    pasaje = Pasaje(
                        tipo=tipo,
                        fecha_bajada=parse_date(row.get('FechaBajada')),
                        embarque_bajada=(row.get('EmbarqueBajada') or '').strip(),
                        destino_bajada=(row.get('DestinoBajada') or '').strip(),
                        fecha_subida=parse_date(row.get('FechaSubida')),
                        embarque_subida=(row.get('EmbarqueSubida') or '').strip(),
                        destino_subida=(row.get('DestinoSubida') or '').strip(),
                        dni=(row.get('DNI') or '').strip(),
                        nombres=(row.get('Nombres') or '').strip(),
                        cargo=(row.get('Cargo') or '').strip(),
                        tipo_trabajador=tipo_trabajador,
                        proveedor=proveedor,
                        ruc=ruc,
                        razon_social=(row.get('RazonSocial') or '').strip(),
                        detalle=(row.get('Detalle') or '').strip(),
                        factura_ticket=(row.get('FacturaTicket') or '').strip(),
                        fecha=parse_date(row.get('Fecha')),
                        moneda=moneda,
                        monto_con_igv_soles=monto_soles,
                        monto_con_igv_dolares=monto_dolares,
                        tipo_cambio=parse_decimal(row.get('TipoCambio')),
                        devolucion=parse_decimal(row.get('Devolucion')),
                        total=parse_decimal(row.get('Total')),
                        estado=estado,
                        fecha_pago=parse_date(row.get('FechaPago')),
                        numero_operacion=(row.get('NumeroOperacion') or '').strip(),
                        habilitado=parse_bool(row.get('Habilitado')),
                        creado_por=default_user,
                    )

                    # Let save() auto-calculate mes from fecha
                    batch.append(pasaje)
                    created += 1

                    # Bulk create every 500 rows
                    if len(batch) >= 500:
                        Pasaje.objects.bulk_create(batch)
                        self.stdout.write(f'  ... {created} rows imported')
                        batch = []

                except Exception as exc:
                    errors += 1
                    if errors <= 10:
                        self.stdout.write(self.style.ERROR(
                            f'  Error row {created + skipped + errors}: {exc}'
                        ))

            # Final batch
            if batch:
                Pasaje.objects.bulk_create(batch)

        self.stdout.write(self.style.SUCCESS(
            f'\nImport complete: {created} created, {skipped} skipped, {errors} errors'
        ))
        self.stdout.write(f'Total pasajes in DB: {Pasaje.objects.count()}')
