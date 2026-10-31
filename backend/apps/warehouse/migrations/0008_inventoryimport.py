# SYSPCC-025: modelo de importación de inventario (aditivo).
# El AlterField de choices de item_type (EPP) va en 0009.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('warehouse', '0007_alter_onedrivetoken_access_token_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='InventoryImport',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('warehouse', models.CharField(choices=[('CENTRAL', 'Almacén Central'), ('SITE', 'Almacén de Obra'), ('OFFICE', 'Almacén/Bodega de Oficina')], default='CENTRAL', max_length=10, verbose_name='almacén')),
                ('file_name', models.CharField(max_length=200, verbose_name='nombre del archivo')),
                ('file_sha256', models.CharField(db_index=True, max_length=64, verbose_name='huella SHA-256')),
                ('file_bytes', models.BinaryField(blank=True, null=True, verbose_name='archivo')),
                ('status', models.CharField(choices=[('PREVIEWED', 'Previsualizada'), ('PROCESSING', 'En proceso'), ('CONFIRMED', 'Confirmada'), ('CANCELLED', 'Cancelada'), ('EXPIRED', 'Vencida'), ('FAILED', 'Fallida')], default='PREVIEWED', max_length=12, verbose_name='estado')),
                ('options', models.JSONField(blank=True, default=dict, verbose_name='opciones')),
                ('summary', models.JSONField(blank=True, default=dict, verbose_name='resumen')),
                ('problems', models.JSONField(blank=True, default=dict, verbose_name='problemas')),
                ('plan_digest', models.CharField(blank=True, max_length=64, verbose_name='huella del plan')),
                ('result', models.JSONField(blank=True, default=dict, verbose_name='resultado')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('confirmed_at', models.DateTimeField(blank=True, null=True, verbose_name='confirmada el')),
                ('expires_at', models.DateTimeField(blank=True, null=True, verbose_name='vence el')),
                ('uploaded_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='inventory_imports', to=settings.AUTH_USER_MODEL, verbose_name='subido por')),
            ],
            options={
                'verbose_name': 'importación de inventario',
                'verbose_name_plural': 'importaciones de inventario',
                'db_table': 'inventory_imports',
                'ordering': ['-created_at'],
                'constraints': [models.UniqueConstraint(condition=models.Q(('status', 'CONFIRMED')), fields=('file_sha256', 'warehouse'), name='inventory_import_confirmed_file_unique')],
            },
        ),
    ]
