"""Migrations core/0008, rq/0007, hr/0001 and hr/0002 apply and revert without touching data
(SYSPCC-022, FASE 4). Named test_zz_* so it runs after the rest of the hr tests; it always restores
the schema to the latest state, even when an assertion fails."""

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.core.models import Personal, UserRole

pytestmark = pytest.mark.django_db(transaction=True)

USER_TABLE = get_user_model()._meta.db_table
ROLE_TABLE = UserRole._meta.db_table
PERSONAL_TABLE = Personal._meta.db_table
HR_TABLES = {'hr_document_template', 'hr_generated_document', 'hr_document_event',
             'hr_cv_analysis', 'hr_cv_analysis_item'}


def migrate(targets):
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    return MigrationExecutor(connection)


def latest():
    return MigrationExecutor(connection).loader.graph.leaf_nodes()


def tables():
    return set(connection.introspection.table_names())


def columns(table):
    with connection.cursor() as cursor:
        return {c.name for c in connection.introspection.get_table_description(cursor, table)}


def count(table):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT COUNT(*) FROM {table}')
        return cursor.fetchone()[0]


@pytest.fixture
def restore_schema():
    yield
    migrate(latest())


@pytest.fixture
def seeded(hr_manager, active_template, contract_data, hr_client):
    from apps.hr.tests.test_documents import create_draft

    Personal.objects.create(dni='44556677', apellidos_nombres='RAMOS DIAZ, LUIS')
    create_draft(hr_client, active_template, contract_data)
    return {'users': count(USER_TABLE), 'roles': count(ROLE_TABLE), 'personal': count(PERSONAL_TABLE)}


def test_hr_0002_reverts_and_reapplies_keeping_rows(seeded, restore_schema):
    assert 'pdf_docx_sha256' in columns('hr_generated_document')
    migrate([('hr', '0001_initial')])
    assert 'pdf_docx_sha256' not in columns('hr_generated_document')
    assert count('hr_generated_document') == 1  # the draft survives the column drop
    migrate(latest())
    assert 'pdf_docx_sha256' in columns('hr_generated_document')
    assert count('hr_generated_document') == 1


def test_hr_0003_cv_tables_revert_and_reapply(seeded, restore_schema):
    assert {'hr_cv_analysis', 'hr_cv_analysis_item'} <= tables()
    migrate([('hr', '0002_pdf_docx_sha256')])
    assert not {'hr_cv_analysis', 'hr_cv_analysis_item'} & tables()
    assert count('hr_generated_document') == 1  # SYSPCC-022 data untouched
    migrate(latest())
    assert {'hr_cv_analysis', 'hr_cv_analysis_item'} <= tables()
    assert {'uploaded_by_id', 'sha256', 'result', 'report_pdf'} <= columns('hr_cv_analysis_item')


POSTING_COLUMNS = {'posting_file', 'posting_original_name', 'posting_kind', 'posting_size_bytes', 'posting_sha256',
                   'posting_uploaded_at', 'posting_tokens_in', 'posting_tokens_out', 'posting_cost_usd'}


def test_hr_0004_posting_columns_are_additive_and_reversible(seeded, restore_schema):
    from django.utils import timezone

    assert POSTING_COLUMNS <= columns('hr_cv_analysis')
    migrate([('hr', '0003_cv_analysis')])
    assert not POSTING_COLUMNS & columns('hr_cv_analysis')
    assert 'requirements' in columns('hr_cv_analysis') and count('hr_generated_document') == 1
    with connection.cursor() as cursor:  # a row created before 0004 must survive the forward migration
        cursor.execute(
            "INSERT INTO hr_cv_analysis (name, requirements_text, requirements, model_name, prompt_version, "
            "created_at, updated_at) VALUES ('Previo', '', '[]', '', '', %s, %s)", [timezone.now(), timezone.now()])
    migrate(latest())
    assert POSTING_COLUMNS <= columns('hr_cv_analysis')
    with connection.cursor() as cursor:
        cursor.execute("SELECT posting_file, posting_size_bytes, posting_cost_usd, posting_uploaded_at "
                       "FROM hr_cv_analysis WHERE name = 'Previo'")
        row = cursor.fetchone()
    assert row[0] == '' and row[1] == 0 and float(row[2]) == 0 and row[3] is None  # defaults, no data loss
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM hr_cv_analysis WHERE name = 'Previo'")


def test_hr_zero_drops_only_hr_tables_and_forward_recreates_them(seeded, restore_schema):
    assert HR_TABLES <= tables()
    migrate([('hr', None)])
    assert not HR_TABLES & tables()
    assert count(USER_TABLE) == seeded['users'] and count(ROLE_TABLE) == seeded['roles']
    assert count(PERSONAL_TABLE) == seeded['personal']
    migrate(latest())
    assert HR_TABLES <= tables()
    assert count('hr_generated_document') == 0 and count('hr_document_template') == 0


def test_role_choice_migrations_revert_without_touching_role_rows(seeded, restore_schema):
    roles_before = count(ROLE_TABLE)
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT role FROM {ROLE_TABLE} WHERE role = 'HR_MANAGER'")
        assert cursor.fetchall() == [('HR_MANAGER',)]
    migrate([('core', '0007_add_user_must_change_password'), ('rq', '0006_add_pasajes_manager_role_choice')])
    assert count(ROLE_TABLE) == roles_before
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT role FROM {ROLE_TABLE} WHERE role = 'HR_MANAGER'")
        assert cursor.fetchall() == [('HR_MANAGER',)]  # AlterField on choices: no DDL, no data change
    assert not HR_TABLES & tables()  # hr depends on core/0008 and was reverted first
    migrate(latest())
    assert HR_TABLES <= tables()
    assert count(ROLE_TABLE) == roles_before


def test_no_pending_model_changes(db):
    from django.core.management import call_command

    call_command('makemigrations', '--check', '--dry-run')
