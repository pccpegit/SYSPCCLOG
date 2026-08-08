# Manually written (scoped) migration for SYSPCC-009.
#
# NOTE: `makemigrations rq` also detects an unrelated, pre-existing drift
# (RoleChoices change to Approval.role / WorkflowStep.responsible_role) that
# predates this ticket. That drift is intentionally NOT included here — see
# SYSPCC-009 instructions and .claude/agent-memory/django-backend/patterns_concurrency_locking.md.
# This migration only adds the `dedup_key` field + partial unique constraint
# used by apps/rq/tasks.py and SLACalculator-adjacent notification idempotency.
#
# Safe on a populated `notifications` table: `dedup_key` is added as
# nullable with no default, so every existing row simply gets NULL, which is
# exempt from the uniqueness check on both PostgreSQL and SQLite (each NULL
# is distinct under a partial/conditional unique index). No backfill needed,
# single-step migration.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('rq', '0004_add_inventory_item_fk'),
    ]

    operations = [
        migrations.AddField(
            model_name='notification',
            name='dedup_key',
            field=models.CharField(
                blank=True,
                help_text=(
                    'Clave determinística usada por tareas programadas (SLA, recordatorios) '
                    'para evitar notificaciones duplicadas si la tarea se reintenta o corre '
                    'más de una vez con el mismo estado. Nula para notificaciones creadas '
                    'por transiciones de workflow, que no requieren deduplicación.'
                ),
                max_length=255,
                null=True,
                verbose_name='clave de deduplicación',
            ),
        ),
        migrations.AddConstraint(
            model_name='notification',
            constraint=models.UniqueConstraint(
                condition=models.Q(('dedup_key__isnull', False)),
                fields=('dedup_key',),
                name='notification_dedup_key_unique_when_set',
            ),
        ),
    ]
