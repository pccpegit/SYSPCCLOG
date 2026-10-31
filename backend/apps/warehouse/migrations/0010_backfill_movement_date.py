# SYSPCC-025: rellena movement_date de los movimientos y vales ya existentes con
# la fecha local (America/Lima) de created_at. Idempotente: solo toca filas con
# movement_date NULL. Después de esta migración, NULL significa únicamente
# "fila importada sin fecha". Reversa: no-op (el campo se elimina con 0009).

from django.db import migrations
from django.utils import timezone

BATCH_SIZE = 1000


def _backfill(model):
    last_pk = 0
    while True:
        rows = list(
            model.objects.filter(movement_date__isnull=True, pk__gt=last_pk)
            .order_by('pk')
            .values_list('pk', 'created_at')[:BATCH_SIZE]
        )
        if not rows:
            return
        for pk, created_at in rows:
            if created_at is None:
                continue
            model.objects.filter(pk=pk, movement_date__isnull=True).update(
                movement_date=timezone.localtime(created_at).date()
            )
        last_pk = rows[-1][0]


def backfill_movement_date(apps, schema_editor):
    _backfill(apps.get_model('warehouse', 'MovementGroup'))
    _backfill(apps.get_model('warehouse', 'InventoryMovement'))


class Migration(migrations.Migration):

    dependencies = [
        ('warehouse', '0009_epp_fields'),
    ]

    operations = [
        migrations.RunPython(backfill_movement_date, migrations.RunPython.noop),
    ]
