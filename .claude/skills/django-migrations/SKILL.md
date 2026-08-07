---
name: django-migrations
description: Migraciones de Django seguras para SYSPCC — cambios de esquema sin romper producción ni datos existentes. Úsalo al crear migraciones, cambiar modelos, añadir campos/constraints, o planear un despliegue con cambios de BD. Dispara ante "migración", "migrate", "makemigrations", "cambiar modelo", "campo nuevo", "constraint", "esquema".
---

# Migraciones seguras — SYSPCC

Dev usa SQLite, prod usa PostgreSQL. Lo que funciona en SQLite puede bloquear o fallar en Postgres — piensa siempre en el despliegue a prod.

## Flujo
```bash
python manage.py makemigrations          # genera
python manage.py makemigrations --check --dry-run   # CI: falla si faltan migraciones
python manage.py migrate                 # aplica
python manage.py sqlmigrate app 0007     # inspecciona el SQL antes de aplicar en prod
```

## Reglas de seguridad

1. **Revisa el SQL generado** con `sqlmigrate` antes de mergear cambios de esquema no triviales.
2. **Columnas NOT NULL nuevas en tablas con datos**: hazlo en 3 pasos, no de golpe:
   - Añade la columna como `null=True` (o con `default`).
   - Backfill de datos (migración de datos `RunPython` con `reverse_code`).
   - Marca `null=False` en una migración posterior.
   Un `NOT NULL` sin default sobre una tabla poblada rompe el despliegue.
3. **Migraciones de datos** (`RunPython`) siempre con función inversa (`reverse_code`) y usando el modelo histórico (`apps.get_model`), nunca el import directo del modelo.
4. **Renombrar/eliminar columnas** es peligroso con despliegue continuo: el código viejo puede seguir corriendo. Prefiere el patrón expand/contract (añade lo nuevo, migra, luego elimina lo viejo en un release posterior).
5. **Constraints `UNIQUE` nuevos**: verifica/limpia duplicados con una migración de datos ANTES de aplicar el constraint, o fallará.
6. **Índices en tablas grandes (Postgres)**: considera `AddIndexConcurrently` (`atomic = False` en la migración) para no bloquear la tabla.
7. **No edites migraciones ya aplicadas en prod.** Crea una nueva. Solo puedes editar/squashear migraciones que aún no salieron.
8. **Enums (`TextChoices`)**: añadir un valor nuevo no necesita migración de esquema (es validación de app), pero renombrar/quitar un valor sí requiere migrar los datos que lo usan. Ojo con `RQStatusChoices` — un estado en uso no se elimina sin migrar los RQ que lo tienen.
9. **Una migración por cambio lógico**, mensaje claro. Commit de la migración junto al cambio de modelo.

## Migración de datos — plantilla
```python
from django.db import migrations

def backfill_flow(apps, schema_editor):
    Request = apps.get_model('rq', 'Request')       # modelo histórico, NO import directo
    Request.objects.filter(flow__isnull=True).update(flow='OPERATIONS')

def reverse(apps, schema_editor):
    pass                                              # o revertir si aplica

class Migration(migrations.Migration):
    dependencies = [('rq', '0006_...')]
    operations = [migrations.RunPython(backfill_flow, reverse)]
```

## Checklist antes de mergear
- [ ] `makemigrations --check` pasa (no faltan migraciones).
- [ ] Revisé el SQL con `sqlmigrate` si hay cambios de esquema.
- [ ] NOT NULL nuevo → patrón de 3 pasos.
- [ ] UNIQUE nuevo → duplicados limpiados antes.
- [ ] Migración de datos con `reverse_code` y `apps.get_model`.
- [ ] No edité migraciones ya desplegadas.
- [ ] Pensé el orden código↔migración para despliegue sin downtime.
