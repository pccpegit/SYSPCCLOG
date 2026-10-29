"""SYSPCC-025 — management command import_warehouse_excel (same pipeline as the API)."""
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.enums import RoleChoices
from apps.core.models import Project
from apps.warehouse.models import Inventory, InventoryImport, InventoryMovement

from .conftest import make_user
from .import_workbooks import WORKER_A, build_workbook, catalog_row, entry_row, standard_workbook

pytestmark = pytest.mark.django_db

NAMES = ('Quispe', 'Mamani', 'Ccori', 'Huaman', 'Rosa', 'Pedro')


@pytest.fixture
def book(tmp_path):
    path = tmp_path / 'libro.xlsx'
    path.write_bytes(standard_workbook())
    return str(path)


def run(*args, **kwargs):
    out = StringIO()
    call_command('import_warehouse_excel', *args, stdout=out, **kwargs)
    return out.getvalue()


class TestDryRun:
    def test_reports_counters_and_codes_and_writes_nothing(self, book):
        output = run(book, '--dry-run')
        assert 'Modo --dry-run: no se escribió nada.' in output
        assert 'Catálogo: nuevos=3' in output and 'Se puede confirmar: sí' in output
        assert 'DESTINO_SIN_PERSONAL [warning] x2' in output and 'UBICACION_PISO_SIN_PABELLON' in output
        assert 'Destinos sin vincular a Personal: 2 (no se muestran nombres)' in output
        assert Inventory.objects.count() == 0 and InventoryImport.objects.count() == 0

    def test_output_never_contains_names_or_the_file_name(self, book):
        output = run(book, '--dry-run')
        assert not any(name in output for name in NAMES) and 'libro.xlsx' not in output

    def test_dry_run_does_not_need_a_user(self, book):
        run(book, '--dry-run')

    def test_dry_run_reports_blockers_without_failing(self, tmp_path):
        path = tmp_path / 'malo.xlsx'
        path.write_bytes(build_workbook(entries=[entry_row('EPP1', 1)]))
        output = run(str(path), '--dry-run')
        assert 'HOJA_FALTANTE [blocker]' in output and 'Se puede confirmar: no' in output

    def test_invalid_file_is_a_command_error(self, tmp_path):
        path = tmp_path / 'falso.xlsx'
        path.write_bytes(b'no es un libro')
        with pytest.raises(CommandError, match='ARCHIVO_INVALIDO'):
            run(str(path), '--dry-run')

    def test_missing_file(self, tmp_path):
        with pytest.raises(CommandError, match='no existe'):
            run(str(tmp_path / 'nada.xlsx'), '--dry-run')


class TestImport:
    ACCEPT = ('--accept-warnings', '--accept-skipped-rows')

    def test_imports_with_a_project_map(self, book, central_warehouse, project):
        project.code = 'ON-PLANT'
        project.save()
        output = run(book, '--user', central_warehouse.email, '--project-map', 'ON PLANT=ON-PLANT', *self.ACCEPT)
        assert 'Importación confirmada' in output and 'conciliado=True' in output
        assert Inventory.objects.count() == 3 and InventoryMovement.objects.count() == 5
        assert set(Inventory.objects.values_list('project_id', flat=True)) == {project.pk}
        imp = InventoryImport.objects.get()
        assert imp.status == 'CONFIRMED' and imp.uploaded_by == central_warehouse and bytes(imp.file_bytes) == b''

    def test_project_can_be_matched_by_id(self, book, central_warehouse, project):
        run(book, '--user', central_warehouse.username, '--project-map', f'on plant={project.pk}', *self.ACCEPT)
        assert set(Inventory.objects.values_list('project_id', flat=True)) == {project.pk}

    def test_create_projects(self, book, central_warehouse):
        run(book, '--user', central_warehouse.email, '--create-projects', *self.ACCEPT)
        created = Project.objects.get(code='ON-PLANT')
        assert created.name == 'ON PLANT' and Inventory.objects.filter(project=created).count() == 3

    def test_skip_projects(self, book, central_warehouse):
        run(book, '--user', central_warehouse.email, '--skip-projects', *self.ACCEPT)
        assert Inventory.objects.filter(project__isnull=True).count() == 3

    def test_a_single_matching_project_is_used_without_a_map(self, book, central_warehouse):
        existing = Project.objects.create(code='ON-PLANT', name='On Plant')
        run(book, '--user', central_warehouse.email, *self.ACCEPT)
        assert Inventory.objects.filter(project=existing).count() == 3

    def test_missing_project_stops_before_writing_and_cleans_up(self, book, central_warehouse):
        with pytest.raises(CommandError, match='ON PLANT'):
            run(book, '--user', central_warehouse.email, *self.ACCEPT)
        assert Inventory.objects.count() == 0
        imp = InventoryImport.objects.get()
        assert imp.status == 'CANCELLED' and bytes(imp.file_bytes) == b''

    def test_acceptances_are_required(self, book, central_warehouse):
        with pytest.raises(CommandError, match='acceptance_required'):
            run(book, '--user', central_warehouse.email, '--skip-projects')
        assert Inventory.objects.count() == 0
        assert InventoryImport.objects.get().status == 'CANCELLED'

    def test_blockers_stop_the_import(self, tmp_path, central_warehouse):
        path = tmp_path / 'malo.xlsx'
        path.write_bytes(build_workbook(entries=[entry_row('EPP1', 1)]))
        with pytest.raises(CommandError, match='bloqueantes'):
            run(str(path), '--user', central_warehouse.email, *self.ACCEPT)
        assert InventoryMovement.objects.count() == 0

    def test_running_it_twice_is_rejected_not_duplicated(self, book, central_warehouse):
        run(book, '--user', central_warehouse.email, '--skip-projects', *self.ACCEPT)
        with pytest.raises(CommandError, match='file_already_imported'):
            run(book, '--user', central_warehouse.email, '--skip-projects', *self.ACCEPT)
        assert InventoryMovement.objects.count() == 5

    def test_update_existing(self, tmp_path, central_warehouse, make_item):
        make_item('EPP000001', 'GUANTE', purchase_order_ref='9.99')
        path = tmp_path / 'libro.xlsx'
        path.write_bytes(build_workbook(catalog=[catalog_row('EPP000001', 'GUANTE', oc=1.02)]))
        run(str(path), '--user', central_warehouse.email, '--update-existing')
        assert Inventory.objects.get().purchase_order_ref == '1.02'

    def test_bad_project_map_syntax(self, book, central_warehouse):
        with pytest.raises(CommandError, match='ETIQUETA=CODIGO_O_ID'):
            run(book, '--user', central_warehouse.email, '--project-map', 'sin-igual', *self.ACCEPT)

    def test_output_and_logs_have_no_personal_data(self, book, central_warehouse, make_personal, app_logs):
        make_personal(WORKER_A)
        output = run(book, '--user', central_warehouse.email, '--skip-projects', *self.ACCEPT)
        dump = output + app_logs.dump()
        assert not any(name in dump for name in NAMES) and 'libro.xlsx' not in dump
        assert 'Destinos sin vincular a Personal: 1' in output          # WORKER_B only
        assert InventoryMovement.objects.filter(destination_personal__isnull=False).count() == 2


class TestUserChecks:
    def test_user_is_required(self, book):
        with pytest.raises(CommandError, match='--user'):
            run(book, '--skip-projects')

    def test_unknown_user(self, book):
        with pytest.raises(CommandError, match='No existe un usuario activo'):
            run(book, '--user', 'nadie@test.com')

    @pytest.mark.parametrize('role', [RoleChoices.SITE_WAREHOUSE, RoleChoices.REQUESTER, RoleChoices.LOGISTICS_SUPERVISOR])
    def test_user_without_an_import_role(self, book, role):
        user = make_user(f'cmd_{role.lower()}', role)
        with pytest.raises(CommandError, match='rol'):
            run(book, '--user', user.email)
        assert InventoryImport.objects.count() == 0

    def test_logistics_chief_can_import(self, book):
        chief = make_user('cmd_chief', RoleChoices.LOGISTICS_CHIEF)
        run(book, '--user', chief.email, '--skip-projects', '--accept-warnings', '--accept-skipped-rows')
        assert InventoryMovement.objects.count() == 5

    def test_superuser_without_role_cannot_import(self, book, superuser):
        with pytest.raises(CommandError, match='rol'):
            run(book, '--user', superuser.email)
