# SYSPCC-025: campos aditivos (nullable / blank / default vacío) para el libro real de EPP.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0008_add_hr_manager_role_choice'),
        ('warehouse', '0008_inventoryimport'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='inventory',
            name='floor',
            field=models.PositiveSmallIntegerField(blank=True, choices=[(1, '1er piso'), (2, '2do piso')], help_text='Piso del almacén cuando aún no se conoce la ubicación exacta.', null=True, verbose_name='piso'),
        ),
        migrations.AddField(
            model_name='inventory',
            name='observation',
            field=models.CharField(blank=True, max_length=300, verbose_name='observación'),
        ),
        migrations.AddField(
            model_name='inventory',
            name='order_number',
            field=models.CharField(blank=True, max_length=50, verbose_name='número de orden'),
        ),
        migrations.AddField(
            model_name='inventory',
            name='packing_list',
            field=models.CharField(blank=True, max_length=50, verbose_name='packing list'),
        ),
        migrations.AddField(
            model_name='inventory',
            name='project',
            field=models.ForeignKey(blank=True, help_text='Proyecto propietario/asignado del ítem (atributo del catálogo, no alcance de stock).', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='inventory_items', to='core.project', verbose_name='proyecto'),
        ),
        migrations.AddField(
            model_name='inventory',
            name='purchase_order_ref',
            field=models.CharField(blank=True, help_text='Referencia de OC tal como figura en el libro (texto).', max_length=30, verbose_name='OC'),
        ),
        migrations.AddField(
            model_name='inventory',
            name='size',
            field=models.CharField(blank=True, max_length=20, verbose_name='talla'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='destination_personal',
            field=models.ForeignKey(blank=True, help_text='destination_detail se conserva siempre como texto (instantánea).', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='warehouse_movements', to='core.personal', verbose_name='trabajador destino'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='guide_number',
            field=models.CharField(blank=True, max_length=50, verbose_name='guía de remisión'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='import_batch',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='movements', to='warehouse.inventoryimport', verbose_name='importación'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='internal_transfer',
            field=models.CharField(blank=True, max_length=100, verbose_name='transferencia interna'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='movement_date',
            field=models.DateField(blank=True, help_text='Fecha operativa; distinta de created_at (auditoría). NULL solo en filas importadas sin fecha.', null=True, verbose_name='fecha del movimiento'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='po_number',
            field=models.CharField(blank=True, max_length=50, verbose_name='PO / OC'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='source_key',
            field=models.CharField(blank=True, help_text='Clave de idempotencia de la importación (huella de la fila).', max_length=64, null=True, unique=True, verbose_name='clave de origen'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='tag',
            field=models.CharField(blank=True, max_length=50, verbose_name='TAG'),
        ),
        migrations.AddField(
            model_name='inventorymovement',
            name='voucher_number',
            field=models.CharField(blank=True, max_length=30, verbose_name='N° de vale (físico)'),
        ),
        migrations.AddField(
            model_name='movementgroup',
            name='destination_personal',
            field=models.ForeignKey(blank=True, help_text='destination_detail se conserva siempre como texto (instantánea).', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='warehouse_groups', to='core.personal', verbose_name='trabajador destino'),
        ),
        migrations.AddField(
            model_name='movementgroup',
            name='guide_number',
            field=models.CharField(blank=True, max_length=50, verbose_name='guía de remisión'),
        ),
        migrations.AddField(
            model_name='movementgroup',
            name='internal_transfer',
            field=models.CharField(blank=True, max_length=100, verbose_name='transferencia interna'),
        ),
        migrations.AddField(
            model_name='movementgroup',
            name='movement_date',
            field=models.DateField(blank=True, db_index=True, help_text='Fecha operativa; distinta de created_at (auditoría). NULL solo en filas importadas sin fecha.', null=True, verbose_name='fecha del movimiento'),
        ),
        migrations.AddField(
            model_name='movementgroup',
            name='po_number',
            field=models.CharField(blank=True, max_length=50, verbose_name='PO / OC'),
        ),
        migrations.AddField(
            model_name='movementgroup',
            name='voucher_number',
            field=models.CharField(blank=True, db_index=True, help_text='Número impreso en el vale firmado. No es único: un vale lleva varias líneas.', max_length=30, verbose_name='N° de vale (físico)'),
        ),
        migrations.AlterField(
            model_name='inventory',
            name='item_type',
            field=models.CharField(choices=[('EQUIPMENT', 'Equipo'), ('CONSUMABLE', 'Consumible'), ('TOOL', 'Herramienta'), ('MATERIAL', 'Material'), ('EPP', 'EPP')], default='MATERIAL', max_length=20, verbose_name='tipo de item'),
        ),
        migrations.AddIndex(
            model_name='inventorymovement',
            index=models.Index(fields=['inventory', 'movement_date'], name='invmov_inv_date_idx'),
        ),
        migrations.AddIndex(
            model_name='inventorymovement',
            index=models.Index(fields=['movement_type', 'movement_date'], name='invmov_type_date_idx'),
        ),
    ]
