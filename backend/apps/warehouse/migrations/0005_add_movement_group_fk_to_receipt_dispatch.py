# Generated manually — links WarehouseReceipt and WarehouseDispatch
# to their auto-generated MovementGroup for full trazabilidad.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('warehouse', '0004_add_movement_group'),
    ]

    operations = [
        migrations.AddField(
            model_name='warehousereceipt',
            name='movement_group',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='warehouse_receipt',
                to='warehouse.movementgroup',
                verbose_name='vale de movimiento',
                help_text='MovementGroup (vale de entrada) generado automáticamente al registrar RECEIVED',
            ),
        ),
        migrations.AddField(
            model_name='warehousedispatch',
            name='movement_group',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='warehouse_dispatch',
                to='warehouse.movementgroup',
                verbose_name='vale de movimiento',
                help_text='MovementGroup (vale de salida) generado automáticamente al registrar DISPATCHED',
            ),
        ),
    ]
