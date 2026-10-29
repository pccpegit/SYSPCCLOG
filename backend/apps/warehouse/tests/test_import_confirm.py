"""SYSPCC-025 — importer: preview + atomic, idempotent confirmation (service level)."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.warehouse.models import (
    Inventory, InventoryImport, InventoryImportStatus, InventoryMovement, InventoryStock, MovementGroup,
)
from apps.warehouse.services import movements as movement_svc
from apps.warehouse.services.imports import applier, parser, service
from apps.warehouse.services.imports.errors import ImportConflict, ImportFileError, ImportNotConfirmable

from .import_workbooks import (
    D1, D2, D3, WORKER_A, WORKER_B, build_workbook, catalog_row, entry_row, exit_row, standard_workbook,
    summary_row,
)

pytestmark = pytest.mark.django_db


def upload(data, name='libro.xlsx'):
    return SimpleUploadedFile(name, data, content_type=parser.XLSX_CONTENT_TYPE)


def preview(data, user, name='libro.xlsx', **kwargs):
    return service.create_preview(uploaded_file=upload(data, name), user=user, **kwargs)


def confirm(imp, user, **kwargs):
    kwargs.setdefault('project_map', {'ON PLANT': None})
    kwargs.setdefault('accept_warnings', True)
    kwargs.setdefault('accept_skipped_rows', True)
    return service.confirm_import(imp.pk, user, expected_plan_digest=imp.plan_digest, **kwargs)


def stock(code):
    return InventoryStock.objects.filter(inventory__product_code=code).first().quantity


class TestPreview:
    def test_preview_stores_the_plan_without_touching_inventory(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        assert imp.status == 'PREVIEWED' and len(imp.plan_digest) == 64
        assert imp.expires_at > timezone.now() + timedelta(hours=23)
        assert bytes(imp.file_bytes).startswith(b'PK')
        assert imp.summary['counts']['blocker'] == 0
        assert Inventory.objects.count() == 0 and InventoryMovement.objects.count() == 0

    def test_destinations_are_kept_for_the_ui_until_the_import_ends(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        assert len(imp.summary['unmatched_destinations']) == 2

    def test_unsupported_warehouse(self, central_warehouse):
        with pytest.raises(ImportFileError) as exc:
            preview(standard_workbook(), central_warehouse, warehouse='SITE')
        assert exc.value.code == 'warehouse_not_supported'

    def test_invalid_file_creates_nothing(self, central_warehouse):
        with pytest.raises(ImportFileError):
            preview(b'no es un libro', central_warehouse)
        assert InventoryImport.objects.count() == 0

    def test_same_file_cannot_be_previewed_after_it_was_confirmed(self, central_warehouse):
        data = standard_workbook()
        first = preview(data, central_warehouse)
        confirm(first, central_warehouse)
        with pytest.raises(ImportConflict) as exc:
            preview(data, central_warehouse)
        assert exc.value.code == 'file_already_imported' and exc.value.extra['import_id'] == str(first.pk)

    def test_blockers_are_stored_and_block_the_confirmation(self, central_warehouse):
        imp = preview(build_workbook(entries=[entry_row('EPP1', 1)]), central_warehouse)
        assert imp.summary['counts']['blocker'] >= 1
        with pytest.raises(ImportNotConfirmable) as exc:
            confirm(imp, central_warehouse)
        assert exc.value.code == 'blockers' and exc.value.extra['problems']


class TestConfirm:
    def test_confirmation_writes_catalog_movements_and_stock(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        imp, replay = confirm(imp, central_warehouse)
        assert replay is False and imp.status == 'CONFIRMED' and imp.confirmed_at

        glove = Inventory.objects.get(product_code='EPP000001')
        assert (glove.size, glove.category, glove.item_type) == ('L', 'EPP', 'EPP')
        assert (glove.purchase_order_ref, glove.packing_list, glove.order_number) == ('1.02', '24003-13', 'ORD-1')
        assert (glove.floor, glove.location, glove.project_id) == (2, '', None)
        assert glove.location_status == 'FLOOR_ONLY'

        assert Inventory.objects.count() == 3
        assert (stock('EPP000001'), stock('EPP000002')) == (5, 4)
        assert InventoryMovement.objects.filter(movement_type='ENTRY').count() == 2
        assert InventoryMovement.objects.filter(movement_type='EXIT').count() == 3
        assert imp.result['catalog'] == {'created': 3, 'updated': 0}
        assert imp.result['movements'] == {'initial': 0, 'entries': 2, 'exits': 3}
        assert imp.result['groups'] == {'initial': 0, 'entries': 1, 'exits': 2}
        assert imp.result['reconciled'] is True and imp.result['stock_total'] == 9.0

    def test_stock_goes_to_the_central_pool_without_project(self, central_warehouse):
        confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        rows = InventoryStock.objects.all()
        assert rows and all(r.warehouse_type == 'CENTRAL' and r.project_id is None and r.department_id is None for r in rows)
        assert InventoryMovement.objects.exclude(project=None).count() == 0

    def test_movement_fields_come_from_the_workbook(self, central_warehouse):
        confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        entry = InventoryMovement.objects.get(movement_type='ENTRY', inventory__product_code='EPP000001')
        assert (entry.movement_date, entry.po_number, entry.guide_number) == (D1, 'PO-77', 'GR-1')
        assert entry.source_type == 'PURCHASE' and entry.source_key and entry.import_batch_id
        exits = InventoryMovement.objects.filter(movement_type='EXIT').order_by('id')
        assert [e.voucher_number for e in exits] == ['120', '120', '121']
        assert [e.movement_date for e in exits] == [D2, D2, D3]
        assert {e.destination_type for e in exits} == {'EMPLOYEE'}
        group = MovementGroup.objects.get(movement_type='EXIT', voucher_number='120')
        assert group.movements.count() == 2 and group.destination_detail == WORKER_A
        assert group.registered_by == central_warehouse

    def test_stock_is_never_inferred_from_a_wrong_order(self, central_warehouse):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')],
            exits=[exit_row('EPP1', 5, WORKER_A, voucher=1, when=D1)],         # exit sheet first...
            entries=[entry_row('EPP1', 5, when=D3)],                           # ...entry dated later
        )
        imp, _ = confirm(preview(data, central_warehouse), central_warehouse, project_map={})
        assert stock('EPP1') == 0 and imp.status == 'CONFIRMED'

    def test_undated_rows_are_imported_without_date(self, central_warehouse):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 5, when=None)],
            exits=[exit_row('EPP1', 1, WORKER_A, when=None)],
        )
        confirm(preview(data, central_warehouse), central_warehouse, project_map={})
        assert InventoryMovement.objects.filter(movement_date__isnull=True).count() == 2

    def test_internal_transfer_destination_is_transfer_out(self, central_warehouse):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 5, transfer='DESDE ALMACEN')],
            exits=[exit_row('EPP1', 2, 'ALM - PRIMER PISO', voucher=9, transfer='CAMBIO')],
        )
        confirm(preview(data, central_warehouse), central_warehouse, project_map={})
        out = InventoryMovement.objects.get(movement_type='EXIT')
        assert (out.destination_type, out.destination_personal_id, out.internal_transfer) == ('TRANSFER_OUT', None, 'CAMBIO')
        assert InventoryMovement.objects.get(movement_type='ENTRY').source_type == 'TRANSFER_IN'

    def test_entry_tag_and_notes_are_saved_per_line(self, central_warehouse):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 5, tag='LOTE-9', obs='Caja abierta')],
        )
        confirm(preview(data, central_warehouse), central_warehouse, project_map={})
        entry = InventoryMovement.objects.get()
        assert (entry.tag, entry.notes) == ('LOTE-9', 'Caja abierta')

    def test_import_never_enqueues_vale_pdfs(self, central_warehouse):
        with mock.patch('apps.warehouse.tasks.upload_group_pdf_task.delay') as delay:
            confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        delay.assert_not_called()

    def test_workbook_and_destinations_are_dropped_after_confirmation(self, central_warehouse):
        imp, _ = confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        imp.refresh_from_db()
        assert bytes(imp.file_bytes) == b'' and 'unmatched_destinations' not in imp.summary


class TestRequirements:
    def test_project_map_is_required_for_every_project_label(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        with pytest.raises(ImportNotConfirmable) as exc:
            confirm(imp, central_warehouse, project_map={})
        assert exc.value.code == 'project_map_required' and exc.value.extra['labels'] == ['ON PLANT']
        assert Inventory.objects.count() == 0

    def test_project_label_matching_ignores_case_and_punctuation(self, central_warehouse, project):
        imp = preview(standard_workbook(), central_warehouse)
        imp, _ = confirm(imp, central_warehouse, project_map={'on-plant': project.pk})
        assert set(Inventory.objects.values_list('project_id', flat=True)) == {project.pk}
        assert imp.options['project_map'] == {'ON PLANT': project.pk}

    def test_unknown_or_inactive_project_is_rejected(self, central_warehouse, project):
        imp = preview(standard_workbook(), central_warehouse)
        with pytest.raises(ImportNotConfirmable) as exc:
            confirm(imp, central_warehouse, project_map={'ON PLANT': 99999})
        assert exc.value.code == 'project_not_found'
        project.is_active = False
        project.save()
        with pytest.raises(ImportNotConfirmable):
            confirm(imp, central_warehouse, project_map={'ON PLANT': project.pk})

    def test_warnings_and_skipped_rows_must_be_accepted(self, central_warehouse):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', None), entry_row('EPP1', 3, when=None)],
        )
        imp = preview(data, central_warehouse)
        with pytest.raises(ImportNotConfirmable) as exc:
            confirm(imp, central_warehouse, project_map={}, accept_warnings=False, accept_skipped_rows=False)
        assert exc.value.code == 'acceptance_required'
        assert set(exc.value.extra['required']) == {'accept_warnings', 'accept_skipped_rows'}
        with pytest.raises(ImportNotConfirmable) as exc:
            confirm(imp, central_warehouse, project_map={}, accept_skipped_rows=False)
        assert exc.value.extra['required'] == ['accept_skipped_rows']
        confirm(imp, central_warehouse, project_map={})
        assert InventoryMovement.objects.count() == 1                # the empty-quantity row was skipped

    def test_nothing_to_accept_when_the_book_is_clean(self, central_warehouse):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 3, location='F1-1')],
        )
        imp = preview(data, central_warehouse)
        assert imp.summary['requires']['accept_warnings'] is False
        confirm(imp, central_warehouse, project_map={}, accept_warnings=False, accept_skipped_rows=False)


class TestIdempotency:
    def test_confirming_twice_returns_the_stored_result(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        first, replay1 = confirm(imp, central_warehouse)
        again, replay2 = confirm(imp, central_warehouse)
        assert (replay1, replay2) == (False, True) and again.result == first.result
        assert InventoryMovement.objects.count() == 5 and MovementGroup.objects.count() == 3

    def test_a_different_file_with_the_same_rows_adds_nothing_twice(self, central_warehouse):
        confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        data = standard_workbook(catalog=[
            catalog_row('EPP000001', 'GUANTE DE CUERO T: L'), catalog_row('EPP000002', 'CASCO BLANCO'),
            catalog_row('EPP000003', 'LENTE CLARO'), catalog_row('EPP000004', 'NUEVO'),
        ])
        imp = preview(data, central_warehouse)
        assert imp.summary['entries']['already_imported'] == 2 and imp.summary['exits']['already_imported'] == 3
        imp, _ = confirm(imp, central_warehouse)
        assert imp.result['movements'] == {'initial': 0, 'entries': 0, 'exits': 0}
        assert imp.result['catalog']['created'] == 1
        assert InventoryMovement.objects.count() == 5 and (stock('EPP000001'), stock('EPP000002')) == (5, 4)

    def test_a_longer_version_of_the_book_adds_only_the_new_rows(self, central_warehouse):
        confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        data = standard_workbook(
            entries=[
                entry_row('EPP000001', 10, D1, po='PO-77', guide='GR-1'),
                entry_row('EPP000002', 5, D1, po='PO-77', guide='GR-1'),
                entry_row('EPP000003', 8, D3, po='PO-78'),                             # new
            ],
            exits=[
                exit_row('EPP000001', 2, WORKER_A, voucher=120, when=D2),
                exit_row('EPP000002', 1, WORKER_A, voucher='120', when=D2),
                exit_row('EPP000001', 3, WORKER_B, voucher=121, when=D3),
                exit_row('EPP000003', 2, WORKER_B, voucher=122, when=D3),              # new
            ],
        )
        imp, _ = confirm(preview(data, central_warehouse), central_warehouse)
        assert imp.result['movements'] == {'initial': 0, 'entries': 1, 'exits': 1}
        assert InventoryMovement.objects.count() == 7
        assert (stock('EPP000001'), stock('EPP000002'), stock('EPP000003')) == (5, 4, 6)

    def test_rows_imported_before_that_disappear_or_change_are_reported_and_never_deleted(self, central_warehouse):
        confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        corrected = standard_workbook(exits=[
            exit_row('EPP000001', 2, WORKER_A, voucher=120, when=D2),
            exit_row('EPP000002', 1, WORKER_A, voucher='120', when=D2),
            exit_row('EPP000001', 4, WORKER_B, voucher=121, when=D3),            # was 3: corrected
        ])
        imp = preview(corrected, central_warehouse)
        missing = [p for p in imp.problems['items'] if p['code'] == 'FILAS_IMPORTADAS_AUSENTES']
        assert len(missing) == 1 and '1 movimiento' in missing[0]['message']
        assert imp.summary['exits']['to_import'] == 1                              # the corrected row is "new"
        assert imp.summary['stock']['mismatched_items'] >= 1                       # and the stock check shouts
        confirm(imp, central_warehouse)
        assert InventoryMovement.objects.filter(movement_type='EXIT').count() == 4  # nothing was deleted

    def test_no_report_for_a_first_import_or_a_book_that_only_grows(self, central_warehouse):
        first = preview(standard_workbook(), central_warehouse)
        assert 'FILAS_IMPORTADAS_AUSENTES' not in first.summary['by_code']
        confirm(first, central_warehouse)
        grown = preview(standard_workbook(entries=[
            entry_row('EPP000001', 10, D1, po='PO-77', guide='GR-1'),
            entry_row('EPP000002', 5, D1, po='PO-77', guide='GR-1'),
            entry_row('EPP000003', 8, D3),
        ]), central_warehouse)
        assert 'FILAS_IMPORTADAS_AUSENTES' not in grown.summary['by_code']

    def test_identical_rows_inside_one_book_are_all_imported_once(self, central_warehouse):
        rows = [entry_row('EPP1', 2, D1), entry_row('EPP1', 2, D1), entry_row('EPP1', 2, D1)]
        data = build_workbook(catalog=[catalog_row('EPP1', 'X')], entries=rows)
        confirm(preview(data, central_warehouse), central_warehouse, project_map={})
        assert stock('EPP1') == 6
        # uploading the same three rows plus a fourth identical one adds exactly one
        data2 = build_workbook(catalog=[catalog_row('EPP1', 'X')], entries=rows + [entry_row('EPP1', 2, D1)])
        confirm(preview(data2, central_warehouse), central_warehouse, project_map={})
        assert stock('EPP1') == 8 and InventoryMovement.objects.count() == 4

    def test_initial_load_is_applied_once_even_if_the_figure_changes(self, central_warehouse):
        def book(initial):
            return build_workbook(
                catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 1, D2)],
                summary=[summary_row('EPP1', 'X', initial=initial, stock=initial + 1, project=None)],
            )
        imp, _ = confirm(preview(book(7), central_warehouse), central_warehouse, project_map={})
        initial = InventoryMovement.objects.get(source_type='INITIAL_LOAD')
        assert initial.quantity == 7 and initial.movement_date == D2           # earliest movement date
        confirm(preview(book(9), central_warehouse), central_warehouse, project_map={})
        assert InventoryMovement.objects.filter(source_type='INITIAL_LOAD').count() == 1
        assert stock('EPP1') == 8

    def test_two_previews_racing_for_the_same_rows_the_second_gets_a_conflict(self, central_warehouse):
        first = preview(standard_workbook(), central_warehouse, name='a.xlsx')
        second = preview(standard_workbook(catalog=[
            catalog_row('EPP000001', 'GUANTE DE CUERO T: L'), catalog_row('EPP000002', 'CASCO BLANCO'),
            catalog_row('EPP000003', 'LENTE CLARO'), catalog_row('EPP000009', 'OTRO'),
        ]), central_warehouse, name='b.xlsx')
        confirm(first, central_warehouse)
        with pytest.raises(ImportConflict) as exc:
            confirm(second, central_warehouse)
        assert exc.value.code == 'plan_changed'
        assert InventoryMovement.objects.count() == 5 and Inventory.objects.count() == 3

    def test_integrity_error_during_apply_becomes_a_conflict(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        with mock.patch.object(applier, 'apply_plan', side_effect=IntegrityError('duplicate key')):
            with pytest.raises(ImportConflict) as exc:
                confirm(imp, central_warehouse)
        assert exc.value.code == 'import_conflict'
        imp.refresh_from_db()
        assert imp.status == 'PREVIEWED'


class TestAtomicity:
    def test_failure_halfway_leaves_no_trace(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        # groups and movements are already written when the stock step fails
        with mock.patch.object(applier._Writer, 'apply_stock', side_effect=RuntimeError('boom')):
            with pytest.raises(RuntimeError):
                confirm(imp, central_warehouse)
        assert Inventory.objects.count() == 0 and InventoryStock.objects.count() == 0
        assert InventoryMovement.objects.count() == 0 and MovementGroup.objects.count() == 0
        imp.refresh_from_db()
        assert imp.status == 'PREVIEWED' and bytes(imp.file_bytes).startswith(b'PK')

    def test_failure_while_writing_movements_leaves_no_trace(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        with mock.patch.object(InventoryMovement.objects, 'bulk_create', side_effect=RuntimeError('boom')):
            with pytest.raises(RuntimeError):
                confirm(imp, central_warehouse)
        assert Inventory.objects.count() == 0 and MovementGroup.objects.count() == 0

    def test_failed_confirmation_can_be_retried(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        with mock.patch.object(applier._Writer, 'apply_stock', side_effect=RuntimeError('boom')):
            with pytest.raises(RuntimeError):
                confirm(imp, central_warehouse)
        imp, _ = confirm(imp, central_warehouse)
        assert imp.status == 'CONFIRMED' and InventoryMovement.objects.count() == 5

    def test_stock_that_changed_after_the_preview_is_a_conflict_not_negative_stock(self, central_warehouse, make_item):
        data = build_workbook(
            catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 5)],
            exits=[exit_row('EPP1', 5, WORKER_A, voucher=1)],
        )
        imp = preview(data, central_warehouse)
        make_item('EPP1', 'X', stock=0)                       # the database changed in between
        with pytest.raises(ImportConflict) as exc:
            confirm(imp, central_warehouse, project_map={})
        assert exc.value.code == 'plan_changed'
        assert InventoryMovement.objects.count() == 0

    def test_the_writer_refuses_a_negative_final_stock(self):
        writer = applier._Writer.__new__(applier._Writer)
        writer.plan = mock.Mock(warehouse='CENTRAL')
        writer.delta = {123456: Decimal('-1')}                  # no stock row, nothing to take from
        with pytest.raises(ValueError):
            writer.apply_stock()

    def test_apply_level_stock_failure_rolls_everything_back(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        with mock.patch.object(applier, '_verify_stock', side_effect=ValueError('negativo')):
            with pytest.raises(ImportConflict) as exc:
                confirm(imp, central_warehouse)
        assert exc.value.code == 'plan_changed'
        assert Inventory.objects.count() == 0 and InventoryMovement.objects.count() == 0


class TestPlanChanged:
    def test_changes_in_the_database_after_the_preview_are_detected(self, central_warehouse, make_item):
        imp = preview(standard_workbook(), central_warehouse)
        make_item('EPP000002', 'CASCO BLANCO')
        with pytest.raises(ImportConflict) as exc:
            confirm(imp, central_warehouse)
        assert exc.value.code == 'plan_changed'

    def test_wrong_digest(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        with pytest.raises(ImportConflict) as exc:
            service.confirm_import(
                imp.pk, central_warehouse, expected_plan_digest='0' * 64, project_map={'ON PLANT': None},
                accept_warnings=True,
            )
        assert exc.value.code == 'plan_changed'


class TestLifecycle:
    def test_expired_preview_cannot_be_confirmed_and_loses_its_file(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        InventoryImport.objects.filter(pk=imp.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        with pytest.raises(ImportConflict) as exc:
            confirm(imp, central_warehouse)
        assert exc.value.code == 'import_expired'
        imp.refresh_from_db()
        assert imp.status == 'EXPIRED' and bytes(imp.file_bytes) == b''
        assert 'unmatched_destinations' not in imp.summary

    def test_cancel_drops_the_file_and_is_idempotent(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        service.cancel_import(imp.pk)
        service.cancel_import(imp.pk)
        imp.refresh_from_db()
        assert imp.status == 'CANCELLED' and bytes(imp.file_bytes) == b''
        with pytest.raises(ImportConflict) as exc:
            confirm(imp, central_warehouse)
        assert exc.value.code == 'import_not_confirmable'

    def test_a_confirmed_import_cannot_be_cancelled(self, central_warehouse):
        imp, _ = confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        with pytest.raises(ImportConflict) as exc:
            service.cancel_import(imp.pk)
        assert exc.value.code == 'import_not_cancellable'

    def test_a_preview_whose_file_is_gone_cannot_be_confirmed(self, central_warehouse):
        imp = preview(standard_workbook(), central_warehouse)
        InventoryImport.objects.filter(pk=imp.pk).update(file_bytes=b'')
        with pytest.raises(ImportConflict) as exc:
            confirm(imp, central_warehouse)
        assert exc.value.code == 'import_file_missing'

    def test_missing_import(self, central_warehouse):
        import uuid
        with pytest.raises(InventoryImport.DoesNotExist):
            service.confirm_import(uuid.uuid4(), central_warehouse, expected_plan_digest='x')

    def test_purge_expires_old_previews_and_clears_finished_imports(self, central_warehouse):
        old = preview(standard_workbook(), central_warehouse, name='old.xlsx')
        fresh = preview(standard_workbook(catalog=[
            catalog_row('EPP000001', 'GUANTE DE CUERO T: L'), catalog_row('EPP000002', 'CASCO BLANCO'),
            catalog_row('EPP000003', 'LENTE CLARO'), catalog_row('EPP000004', 'FRESCO'),
        ]), central_warehouse, name='fresh.xlsx')
        InventoryImport.objects.filter(pk=old.pk).update(expires_at=timezone.now() - timedelta(hours=1))
        # a finished import that (wrongly) kept its file
        leaked = InventoryImport.objects.create(
            uploaded_by=central_warehouse, file_name='x.xlsx', file_sha256='b' * 64,
            status=InventoryImportStatus.CONFIRMED, file_bytes=b'PKdata', summary={'unmatched_destinations': [1]},
        )
        outcome = service.purge_stale_imports()
        assert outcome == {'expired': 1, 'cleared': 1}
        old.refresh_from_db(), fresh.refresh_from_db(), leaked.refresh_from_db()
        assert old.status == 'EXPIRED' and bytes(old.file_bytes) == b''
        assert fresh.status == 'PREVIEWED' and bytes(fresh.file_bytes).startswith(b'PK')
        assert bytes(leaked.file_bytes) == b'' and 'unmatched_destinations' not in leaked.summary

    def test_purge_task_is_registered_and_scheduled(self):
        from django.conf import settings

        from apps.warehouse.tasks import purge_stale_imports
        assert purge_stale_imports.name == 'warehouse.purge_stale_imports'
        assert settings.CELERY_BEAT_SCHEDULE['warehouse-purge-stale-imports']['task'] == purge_stale_imports.name
        assert purge_stale_imports() == {'expired': 0, 'cleared': 0}


class TestPersonalLinking:
    def test_destinations_matching_one_worker_are_linked_automatically(self, central_warehouse, make_personal):
        person = make_personal(WORKER_A)
        confirm(preview(standard_workbook(), central_warehouse), central_warehouse)
        linked = InventoryMovement.objects.filter(destination_personal=person)
        assert linked.count() == 2 and linked.first().destination_detail == WORKER_A       # snapshot kept
        assert InventoryMovement.objects.filter(movement_type='EXIT', destination_personal__isnull=True).count() == 1

    def test_destination_map_links_the_ones_the_user_picked(self, central_warehouse, make_personal):
        person = make_personal('Otro Nombre Distinto')
        imp = preview(standard_workbook(), central_warehouse)
        key = next(d['key'] for d in imp.summary['unmatched_destinations'] if d['display'] == WORKER_B)
        confirm(imp, central_warehouse, destination_map={key: person.pk})
        assert InventoryMovement.objects.filter(destination_personal=person).count() == 1

    def test_destination_map_rejects_unknown_keys_and_workers(self, central_warehouse, make_personal):
        person = make_personal('Otro Nombre Distinto')
        imp = preview(standard_workbook(), central_warehouse)
        with pytest.raises(ImportNotConfirmable) as exc:
            confirm(imp, central_warehouse, destination_map={'clave inexistente': person.pk})
        assert exc.value.code == 'destination_map_invalid'
        key = imp.summary['unmatched_destinations'][0]['key']
        with pytest.raises(ImportNotConfirmable) as exc:
            confirm(imp, central_warehouse, destination_map={key: 987654})
        assert exc.value.code == 'personal_not_found'


class TestExistingItems:
    def test_blank_fields_are_filled_and_unit_and_description_are_untouched(self, central_warehouse, make_item):
        make_item('EPP000001', 'GUANTE ORIGINAL', unit='EA')
        data = build_workbook(
            catalog=[catalog_row('EPP000001', 'GUANTE ORIGINAL', oc=1.02, packing='PK-9')],
            summary=[summary_row('EPP000001', 'GUANTE ORIGINAL', location='F2-3', project=None)],
        )
        imp, _ = confirm(preview(data, central_warehouse), central_warehouse, project_map={})
        item = Inventory.objects.get(product_code='EPP000001')
        assert (item.purchase_order_ref, item.packing_list, item.location, item.floor) == ('1.02', 'PK-9', 'F2-3', 2)
        assert (item.description, item.unit) == ('GUANTE ORIGINAL', 'EA')
        assert imp.result['catalog'] == {'created': 0, 'updated': 1}

    def test_update_existing_overwrites_catalog_attributes(self, central_warehouse, make_item):
        make_item('EPP000001', 'GUANTE', purchase_order_ref='9.99')
        data = build_workbook(catalog=[catalog_row('EPP000001', 'GUANTE', oc=1.02)])
        confirm(preview(data, central_warehouse, update_existing=True), central_warehouse, project_map={})
        assert Inventory.objects.get().purchase_order_ref == '1.02'

    def test_without_update_existing_the_value_in_the_system_wins(self, central_warehouse, make_item):
        make_item('EPP000001', 'GUANTE', purchase_order_ref='9.99')
        data = build_workbook(catalog=[catalog_row('EPP000001', 'GUANTE', oc=1.02)])
        confirm(preview(data, central_warehouse), central_warehouse, project_map={})
        assert Inventory.objects.get().purchase_order_ref == '9.99'

    def test_stock_already_in_the_system_is_kept_and_added_to(self, central_warehouse, make_item):
        make_item('EPP1', 'X', stock=6)
        data = build_workbook(catalog=[catalog_row('EPP1', 'X')], entries=[entry_row('EPP1', 4)])
        confirm(preview(data, central_warehouse), central_warehouse, project_map={})
        assert stock('EPP1') == Decimal('10')


class TestPrivacy:
    def test_logs_never_contain_names_destinations_or_file_names(self, central_warehouse, make_personal, app_logs):
        make_personal(WORKER_A)
        imp = preview(standard_workbook(), central_warehouse, name='inventario_Quispe_Mamani.xlsx')
        confirm(imp, central_warehouse)
        dump = app_logs.dump()
        assert 'warehouse.import.preview' in app_logs.events() and 'warehouse.import.confirm' in app_logs.events()
        for needle in ('Quispe', 'Mamani', 'Ccori', 'Huaman', 'Rosa', 'Pedro', 'inventario_', '.xlsx'):
            assert needle not in dump, needle

    def test_rejected_upload_logs_only_the_reason(self, central_warehouse, app_logs):
        with pytest.raises(ImportFileError):
            preview(b'no es un libro', central_warehouse, name='Rosa_Quispe.xlsx')
        dump = app_logs.dump()
        assert 'warehouse.import.rejected' in dump and 'Rosa' not in dump

    def test_parse_failures_log_only_the_exception_type(self, central_warehouse, app_logs):
        from .import_workbooks import rewrite_zip
        broken = rewrite_zip(standard_workbook(), replace={'xl/workbook.xml': b'<workbook><oops'})
        with pytest.raises(ImportFileError):
            preview(broken, central_warehouse)
        assert 'warehouse.import.parse_failed' in app_logs.dump() and 'oops' not in app_logs.dump()


def _snapshot():
    """Everything the import writes, with surrogate keys replaced by business keys."""
    groups = {
        g.group_number: {
            'type': g.movement_type, 'warehouse': g.warehouse, 'source': g.source_type, 'supplier': g.supplier_name,
            'invoice': g.invoice_number, 'dest_type': g.destination_type, 'dest': g.destination_detail,
            'date': g.movement_date, 'voucher': g.voucher_number, 'po': g.po_number, 'guide': g.guide_number,
            'transfer': g.internal_transfer, 'personal': g.destination_personal_id, 'notes': g.notes,
            'project': g.project_id, 'by': g.registered_by_id, 'doc': g.document_url,
        } for g in MovementGroup.objects.all()
    }
    movements = {
        m.movement_number: {
            'type': m.movement_type, 'item': m.inventory.product_code, 'qty': m.quantity, 'warehouse': m.warehouse,
            'project': m.project_id, 'source': m.source_type, 'supplier': m.supplier_name, 'invoice': m.invoice_number,
            'dest_type': m.destination_type, 'dest': m.destination_detail, 'req': m.requested_by_id,
            'auth': m.authorized_by_id, 'group': m.group.group_number if m.group_id else None,
            'date': m.movement_date, 'voucher': m.voucher_number, 'po': m.po_number, 'guide': m.guide_number,
            'transfer': m.internal_transfer, 'tag': m.tag, 'personal': m.destination_personal_id,
            'key': m.source_key, 'notes': m.notes, 'by': m.registered_by_id, 'doc': m.document_url,
        } for m in InventoryMovement.objects.select_related('inventory', 'group')
    }
    stocks = {
        (s.inventory.product_code, s.warehouse_type, s.project_id, s.department_id): s.quantity
        for s in InventoryStock.objects.select_related('inventory')
    }
    items = {
        i.product_code: (i.description, i.unit, i.category, i.item_type, i.size, i.order_number,
                         i.purchase_order_ref, i.packing_list, i.observation, i.floor, i.location, i.project_id)
        for i in Inventory.objects.all()
    }
    return groups, movements, stocks, items


def _apply_with_the_manual_movement_services(plan, import_obj, user):
    """Oracle: what the importer wrote before the bulk writer, one service call per vale."""
    ids = {}
    for code, entry in plan.catalog.items():
        ids[code] = Inventory.objects.create(
            product_code=code, description=entry.description, unit=entry.unit, category=entry.category,
            item_type=entry.item_type, size=entry.size, order_number=entry.order_number,
            purchase_order_ref=entry.purchase_order_ref, packing_list=entry.packing_list,
            observation=entry.observation, floor=entry.floor, location=entry.location,
        ).pk

    def data(lines, with_tag=False):
        return [
            {'inventory_id': ids[ln.code], 'quantity': ln.quantity, 'line': i, 'notes': ln.notes,
             'tag': ln.tag if with_tag else '', 'source_key': ln.source_key}
            for i, ln in enumerate(lines, start=1)
        ]

    initial = [ln for ln in plan.initial_lines if not ln.already]
    if initial:
        movement_svc.register_entry_batch(
            data(initial), plan.warehouse, None, 'INITIAL_LOAD', '', '', applier.INITIAL_NOTE, user,
            movement_date=plan.opening_date, import_batch_id=import_obj.pk,
        )
    for g in plan.entry_groups:
        movement_svc.register_entry_batch(
            data(g.lines, True), plan.warehouse, None, 'TRANSFER_IN' if g.transfer else 'PURCHASE', '', '',
            applier.GROUP_NOTE, user, movement_date=g.date, undated=g.date is None, po_number=g.po,
            guide_number=g.guide, internal_transfer=g.transfer, import_batch_id=import_obj.pk,
        )
    for g in plan.exit_groups:
        movement_svc.register_exit_batch(
            data(g.lines), plan.warehouse, None, 'TRANSFER_OUT' if g.internal else 'EMPLOYEE', g.destination,
            None, None, applier.GROUP_NOTE, user, movement_date=g.date, undated=g.date is None,
            voucher_number=g.voucher, internal_transfer=g.transfer,
            destination_personal_id=None if g.internal else g.personal_id, import_batch_id=import_obj.pk,
        )


class TestBulkWriterMatchesTheMovementServices:
    """The bulk writer must leave exactly the rows register_entry_batch / register_exit_batch leave."""

    def _rich_workbook(self):
        return build_workbook(
            catalog=[
                catalog_row('EPP000001', 'GUANTE DE CUERO T: L', oc=1.02, packing='PK-1', order_number='O-1'),
                catalog_row('EPP000002', 'CASCO BLANCO'), catalog_row('EPP000003', 'LENTE CLARO T: 42'),
                catalog_row('TMT000009', 'TORNILLO'),
            ],
            entries=[
                entry_row('EPP000001', 10, D1, tag='L-1', po='PO-1', guide='GR-1', obs='caja 1'),
                entry_row('EPP000002', 5, D1, po='PO-1', guide='GR-1'),
                entry_row('EPP000003', 8, D2, transfer='DESDE PISO 1'),
                entry_row('EPP000001', 2, None), entry_row('EPP000002', 1, None, tag='S/F'),
            ],
            exits=[
                exit_row('EPP000001', 2, WORKER_A, voucher=120, when=D2, obs='talla L'),
                exit_row('EPP000002', 1, WORKER_A, voucher='120', when=D2),
                exit_row('EPP000001', 3, WORKER_B, voucher=121, when=D3, transfer='CAMBIO'),
                exit_row('EPP000003', 2, WORKER_B, voucher=None, when=None),
                exit_row('EPP000003', 1, 'ALM - PRIMER PISO', voucher=130, when=D3),
                exit_row('EPP000001', 1, WORKER_A, voucher=120, when=D2),
            ],
            summary=[
                summary_row('EPP000001', 'GUANTE DE CUERO T: L', initial=7, location='F3-2'),
                summary_row('EPP000002', 'CASCO BLANCO', initial=None),
                summary_row('EPP000003', 'LENTE CLARO T: 42', location='PISO 2'),
                summary_row('TMT000009', 'TORNILLO', initial=3, project=None),
            ],
        )

    def test_same_rows_as_the_services(self, central_warehouse, make_personal):
        make_personal(WORKER_A)
        data = self._rich_workbook()

        imp = preview(data, central_warehouse)
        confirm(imp, central_warehouse)
        bulk = _snapshot()
        assert len(bulk[1]) == 13 and len(bulk[0]) == 9                       # initial + 4 entry + 4 exit vales

        # wipe everything and replay the SAME plan through the manual-movement services
        InventoryMovement.objects.all().delete()
        MovementGroup.objects.all().delete()
        InventoryStock.objects.all().delete()
        Inventory.objects.all().delete()
        plan = service.build_plan_from_bytes(data, warehouse='CENTRAL', update_existing=False, file_sha256=imp.file_sha256)
        with transaction.atomic():
            _apply_with_the_manual_movement_services(plan, imp, central_warehouse)
        manual = _snapshot()

        groups_b, movements_b, stocks_b, items_b = bulk
        groups_m, movements_m, stocks_m, items_m = manual
        assert groups_b == groups_m
        assert movements_b == movements_m
        assert stocks_b == stocks_m
        assert items_b == items_m

    def test_a_confirmed_book_costs_a_bounded_number_of_queries(self, central_warehouse):
        codes = [f'EPP{n:06d}' for n in range(1, 251)]
        data = build_workbook(
            catalog=[catalog_row(code, f'ARTICULO {code}') for code in codes],
            entries=[entry_row(codes[i % 250], 40, D1 if i % 3 else None) for i in range(260)],
            exits=[
                exit_row(codes[i % 250], 1, f'Trabajador Prueba {i % 90}', voucher=(i // 2) if i % 3 else None,
                         when=D2 if i % 2 else None)
                for i in range(480)
            ],
        )
        imp = preview(data, central_warehouse)
        with CaptureQueriesContext(connection) as queries:
            confirm(imp, central_warehouse, project_map={})
        assert len(queries) < 120, f'{len(queries)} queries (the per-vale services need ~8 000)'


class TestVolume:
    def test_a_book_of_the_real_size_imports_quickly(self, central_warehouse):
        codes = [f'EPP{n:06d}' for n in range(1, 251)]
        catalog = [catalog_row(code, f'ARTICULO {code}') for code in codes]
        entries = [entry_row(codes[i % 250], 40, D1 if i % 3 else None, location='PISO 2') for i in range(260)]
        exits = [
            exit_row(codes[i % 250], 1, f'Trabajador Prueba {i % 90}', voucher=(i // 2) if i % 3 else None,
                     when=D2 if i % 2 else None)
            for i in range(480)
        ]
        started = timezone.now()
        imp = preview(build_workbook(catalog=catalog, entries=entries, exits=exits), central_warehouse)
        imp, _ = confirm(imp, central_warehouse, project_map={})
        assert (timezone.now() - started).total_seconds() < 60
        assert imp.result['movements']['entries'] == 260 and imp.result['movements']['exits'] == 480
        assert InventoryStock.objects.filter(quantity__lt=0).count() == 0
