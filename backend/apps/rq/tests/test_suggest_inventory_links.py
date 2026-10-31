"""
SYSPCC-026 (Fase 0/1) — `suggest_inventory_links` (sugerencias de vínculo, SOLO LECTURA).

Propone, sin aplicar, el producto de catálogo de los ítems de RQ que no tienen vínculo. La
regla que importa: coincidencia EXACTA (palabra completa que es un código, o descripción
completa), nunca parcial. El motor de hoy adivina con `description__icontains` y con la
primera palabra; estas pruebas fijan que las sugerencias no repiten esa adivinanza.
"""
import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.enums import RQStatusChoices
from apps.rq.models import Request, RequestItem
from apps.rq.services.link_suggestions import (
    BASIS_CODE,
    BASIS_DESCRIPTION,
    MIN_CODE_LENGTH,
    STATUS_AMBIGUOUS,
    STATUS_NO_MATCH,
    STATUS_SUGGESTED,
    code_tokens,
    normalize_text,
    suggest_catalog_links,
)
from apps.rq.services.stock_diagnostics import TERMINAL_STATUSES
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    make_inventory,
    make_item,
    make_request,
    ops_rq,
)

pytestmark = pytest.mark.django_db


def _run(*args, verbosity=1):
    out = StringIO()
    call_command('suggest_inventory_links', *args, stdout=out, verbosity=verbosity)
    return out.getvalue()


def _rows_for(description, **item_extra):
    """Crea un ítem con esa descripción en el RQ abierto de la prueba y devuelve su(s) fila(s)."""
    rq = Request.objects.first()
    make_item(rq, rq.items.count() + 1, description=description, **item_extra)
    return [r for r in suggest_catalog_links()['rows'] if r['description'] == description]


@pytest.fixture
def cement():
    return make_inventory('CEM-001', 'Cemento portland tipo I bolsa 42.5 kg', unit='BLS', category='Otros')


@pytest.fixture(autouse=True)
def _a_request(ops_rq):
    """Un RQ abierto (SUBMITTED) donde caen los ítems de cada prueba."""
    return ops_rq


# ── normalización ─────────────────────────────────────────────────────────────

class TestNormalization:
    @pytest.mark.parametrize('raw, expected', [
        ('Casco  de   SEGURIDAD', 'casco de seguridad'),
        ('Pañuelo de algodón', 'panuelo de algodon'),
        ('  espacios\ty\nsaltos ', 'espacios y saltos'),
        ('', ''),
        (None, ''),
        (123, ''),
    ])
    def test_normalize_text(self, raw, expected):
        assert normalize_text(raw) == expected

    @pytest.mark.parametrize('raw, expected', [
        ('CEM-001 Cemento', {'cem-001', 'cemento'}),
        ('Cemento (CEM-001), bolsa', {'cem-001', 'cemento', 'bolsa'}),
        ('EPP.0001/A', {'epp.0001/a'}),
        ('pedir CEM-001.', {'pedir', 'cem-001', 'cem-001.'}),
        ('TUB.', {'tub', 'tub.'}),
        ('ab c', set()),
        ('', set()),
        (None, set()),
    ])
    def test_code_tokens_keep_dashes_dots_and_slashes(self, raw, expected):
        assert code_tokens(raw) == expected

    def test_the_minimum_code_length_is_three(self):
        assert MIN_CODE_LENGTH == 3


# ── coincidencia por código ───────────────────────────────────────────────────

class TestCodeMatch:
    def test_a_whole_word_equal_to_a_product_code_is_suggested(self, cement):
        (row,) = _rows_for('CEM-001 Cemento Sol')

        assert row['status'] == STATUS_SUGGESTED
        assert row['basis'] == BASIS_CODE
        assert [c['product_code'] for c in row['candidates']] == ['CEM-001']

    @pytest.mark.parametrize('description', [
        'cem-001 cemento', 'Cem-001', '(CEM-001) cemento', 'Cemento CEM-001, 10 bolsas', 'cemento cem-001.',
    ])
    def test_case_and_surrounding_punctuation_do_not_matter(self, cement, description):
        (row,) = _rows_for(description)

        assert row['status'] == STATUS_SUGGESTED
        assert row['candidates'][0]['inventory_id'] == cement.pk

    @pytest.mark.parametrize('description', [
        'CEM-0010 cemento',       # el código del catálogo es prefijo del escrito
        'XCEM-001 cemento',       # el código del catálogo es sufijo del escrito
        'CEM-00 cemento',         # el escrito es prefijo del código
        'CEM 001 cemento',        # separado por espacio
        'cemento CEM-001X',
    ])
    def test_a_partial_code_is_never_suggested(self, cement, description):
        (row,) = _rows_for(description)

        assert row['status'] == STATUS_NO_MATCH
        assert row['candidates'] == []

    def test_the_first_word_alone_is_not_enough_unless_it_is_the_whole_code(self):
        make_inventory('CEM', 'Cemento corto')   # código de solo 3 letras
        (row,) = _rows_for('Cemento portland')

        # El motor de hoy compara product_code con la PRIMERA palabra de la descripción.
        assert row['status'] == STATUS_NO_MATCH

    def test_codes_shorter_than_the_minimum_are_ignored(self):
        make_inventory('A1', 'Producto con código corto')
        (row,) = _rows_for('A1 llave')

        assert row['status'] == STATUS_NO_MATCH

    def test_two_different_codes_in_one_description_are_ambiguous(self, cement):
        other = make_inventory('CEM-002', 'Cemento tipo V')
        (row,) = _rows_for('CEM-001 o CEM-002 según disponibilidad')

        assert row['status'] == STATUS_AMBIGUOUS
        assert {c['inventory_id'] for c in row['candidates']} == {cement.pk, other.pk}

    def test_a_catalog_code_that_ends_with_a_dot_is_found(self):
        tube = make_inventory('TUB.', 'Tubo corto')
        (row,) = _rows_for('Necesito TUB. de 2 pulgadas')

        assert row['status'] == STATUS_SUGGESTED
        assert row['candidates'][0]['inventory_id'] == tube.pk

    def test_two_products_whose_codes_differ_only_in_case_are_ambiguous(self):
        lower = make_inventory('ab-100', 'Válvula pequeña')
        upper = make_inventory('AB-100', 'Válvula grande')
        (row,) = _rows_for('Válvula AB-100')

        assert row['status'] == STATUS_AMBIGUOUS
        assert {c['inventory_id'] for c in row['candidates']} == {lower.pk, upper.pk}

    def test_the_same_code_twice_is_still_one_product(self, cement):
        (row,) = _rows_for('CEM-001 cem-001 cemento')

        assert row['status'] == STATUS_SUGGESTED


# ── coincidencia por descripción ──────────────────────────────────────────────

class TestDescriptionMatch:
    def test_the_full_description_is_suggested(self):
        helmet = make_inventory('EPP-0001', 'Casco de seguridad blanco')
        (row,) = _rows_for('Casco de seguridad blanco')

        assert row['status'] == STATUS_SUGGESTED
        assert row['basis'] == BASIS_DESCRIPTION
        assert row['candidates'][0]['inventory_id'] == helmet.pk

    def test_case_accents_and_spaces_are_ignored(self):
        make_inventory('EPP-0002', 'Pañuelo de algodón')
        (row,) = _rows_for('  PANUELO   de ALGODON ')

        assert row['status'] == STATUS_SUGGESTED
        assert row['basis'] == BASIS_DESCRIPTION

    @pytest.mark.parametrize('description', [
        'Casco',                               # el ítem es parte de la descripción del catálogo
        'Casco de seguridad blanco clase E',   # el catálogo es parte de la del ítem
        'Casco de seguridad',
    ])
    def test_a_partial_description_is_never_suggested(self, description):
        make_inventory('EPP-0001', 'Casco de seguridad blanco')
        (row,) = _rows_for(description)

        assert row['status'] == STATUS_NO_MATCH

    def test_this_is_what_the_engine_fuzzy_match_would_have_picked(self):
        """
        `_resolve_inventory_item` hace `Inventory.description icontains item.description`:
        con "Casco" movería "Casco de seguridad blanco". Aquí no se propone.
        """
        make_inventory('EPP-0001', 'Casco de seguridad blanco')
        (row,) = _rows_for('Casco')

        assert row['status'] == STATUS_NO_MATCH and row['candidates'] == []

    def test_two_products_with_the_same_description_are_ambiguous(self):
        first = make_inventory('EPP-0001', 'Guantes de cuero')
        second = make_inventory('EPP-0002', 'GUANTES DE CUERO')
        (row,) = _rows_for('Guantes de cuero')

        assert row['status'] == STATUS_AMBIGUOUS
        assert {c['inventory_id'] for c in row['candidates']} == {first.pk, second.pk}


# ── código y descripción a la vez ─────────────────────────────────────────────

class TestCodeAndDescriptionTogether:
    def test_both_pointing_to_the_same_product_is_a_code_suggestion(self):
        # La descripción ES la del producto y además trae su código... imposible a la vez
        # salvo que el código forme parte de la descripción del catálogo.
        product = make_inventory('CEM-001', 'CEM-001 Cemento portland')
        (row,) = _rows_for('CEM-001 Cemento portland')

        assert row['status'] == STATUS_SUGGESTED
        assert row['basis'] == BASIS_CODE
        assert [c['inventory_id'] for c in row['candidates']] == [product.pk]

    def test_a_code_and_a_description_of_different_products_are_ambiguous(self):
        by_code = make_inventory('CEM-001', 'Cemento A')
        by_description = make_inventory('CEM-002', 'CEM-001 Cemento portland')
        (row,) = _rows_for('CEM-001 Cemento portland')

        # El código dice CEM-001 y la descripción completa es la de CEM-002: no se elige.
        assert row['status'] == STATUS_AMBIGUOUS
        assert {c['inventory_id'] for c in row['candidates']} == {by_code.pk, by_description.pk}


# ── unidad ────────────────────────────────────────────────────────────────────

class TestUnitMismatch:
    def test_a_different_unit_is_flagged(self, cement):
        (row,) = _rows_for('CEM-001 cemento', unit='KG')

        assert row['unit_mismatch'] is True

    def test_the_same_unit_ignoring_case_is_not_flagged(self, cement):
        (row,) = _rows_for('CEM-001 cemento', unit='bls')

        assert row['unit_mismatch'] is False

    def test_without_candidates_there_is_nothing_to_flag(self):
        (row,) = _rows_for('Algo que no existe', unit='KG')

        assert row['unit_mismatch'] is False


# ── qué ítems entran ──────────────────────────────────────────────────────────

class TestScope:
    def test_linked_items_are_left_out(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento', inventory_item=cement)

        assert suggest_catalog_links()['rows'] == []

    def test_off_catalog_items_are_left_out(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento', is_off_catalog=True)

        assert suggest_catalog_links()['rows'] == []

    @pytest.mark.parametrize('status', sorted(TERMINAL_STATUSES))
    def test_terminal_requests_are_left_out_by_default(self, project, requester, cement, status):
        rq = make_request(number='RQ-T-1', requester=requester, project=project, status=status)
        make_item(rq, 1, description='CEM-001 cemento')

        assert [r['rq_number'] for r in suggest_catalog_links()['rows']] == []
        assert [r['rq_number'] for r in suggest_catalog_links(include_terminal=True)['rows']] == ['RQ-T-1']

    def test_an_rq_number_limits_the_result(self, ops_rq, adm_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento')
        make_item(adm_rq, 1, description='CEM-001 cemento')

        rows = suggest_catalog_links(rq_number=adm_rq.rq_number)['rows']
        assert [r['rq_number'] for r in rows] == [adm_rq.rq_number]

    def test_the_rq_number_is_an_exact_match(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento')

        assert suggest_catalog_links(rq_number=ops_rq.rq_number[:-1])['rows'] == []

    def test_both_flows_are_covered(self, ops_rq, adm_rq, cement, project, department):
        make_item(ops_rq, 1, description='CEM-001 cemento')
        make_item(adm_rq, 1, description='CEM-001 cemento')

        scopes = {r['rq_number']: (r['flow'], r['scope_code']) for r in suggest_catalog_links()['rows']}
        assert scopes == {
            ops_rq.rq_number: ('OPERATIONS', project.code),
            adm_rq.rq_number: ('ADMINISTRATIVE', department.code),
        }

    def test_rows_are_ordered_by_rq_and_line(self, ops_rq, adm_rq):
        make_item(adm_rq, 1, description='Dos')
        make_item(ops_rq, 2, description='Tres')
        make_item(ops_rq, 1, description='Uno')

        rows = suggest_catalog_links()['rows']
        assert [(r['rq_number'], r['line_number']) for r in rows] == sorted(
            (r['rq_number'], r['line_number']) for r in rows
        )

    def test_summary_counts_each_outcome(self, ops_rq, cement):
        make_inventory('EPP-0001', 'Guantes de cuero')
        make_inventory('EPP-0002', 'Guantes de cuero ')
        make_item(ops_rq, 1, description='CEM-001 cemento')      # sugerido
        make_item(ops_rq, 2, description='Guantes de cuero')     # ambiguo
        make_item(ops_rq, 3, description='Algo desconocido')     # sin coincidencia

        summary = suggest_catalog_links()['summary']
        assert (summary['suggested'], summary['ambiguous'], summary['no_match']) == (1, 1, 1)
        assert summary['total_items'] == 3 and summary['total_requests'] == 1


# ── nunca escribe ─────────────────────────────────────────────────────────────

class TestReadOnly:
    def test_a_suggestion_does_not_link_nor_stamp_anything(self, ops_rq, cement):
        line = make_item(ops_rq, 1, description='CEM-001 cemento')
        before = RequestItem.objects.filter(pk=line.pk).values().get()

        _run()
        _run('--json')
        _run('--include-terminal', '--dry-run')

        assert RequestItem.objects.filter(pk=line.pk).values().get() == before
        line.refresh_from_db()
        assert line.inventory_item_id is None
        assert line.inventory_item_confirmed_at is None
        assert line.link_confirmed is False

    @pytest.mark.parametrize('flag', ['--apply', '--link', '--confirm', '--write', '--commit'])
    def test_there_is_no_option_that_writes(self, flag):
        with pytest.raises(CommandError):
            _run(flag)

    def test_dry_run_is_accepted(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento')

        assert 'CEM-001' in _run('--dry-run')

    def test_only_selects_are_executed(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento')

        with CaptureQueriesContext(connection) as queries:
            suggest_catalog_links()

        assert queries.captured_queries
        assert all(q['sql'].lstrip().upper().startswith('SELECT') for q in queries.captured_queries)

    def test_it_takes_two_queries_however_many_items_there_are(self, ops_rq, cement):
        def count_for(n_items):
            RequestItem.objects.all().delete()
            for n in range(1, n_items + 1):
                make_item(ops_rq, n, description=f'CEM-001 cemento {n}')
            with CaptureQueriesContext(connection) as queries:
                result = suggest_catalog_links()
            assert result['summary']['total_items'] == n_items
            return len(queries.captured_queries)

        assert count_for(2) == count_for(30) == 2

    def test_with_nothing_to_suggest_it_skips_the_catalog_query(self, ops_rq):
        with CaptureQueriesContext(connection) as queries:
            suggest_catalog_links()

        assert len(queries.captured_queries) == 1


# ── salida ────────────────────────────────────────────────────────────────────

class TestOutput:
    def test_text_says_ok_when_there_is_nothing(self):
        output = _run()

        assert 'SOLO LECTURA' in output
        assert 'OK: no hay ítems sin producto de catálogo' in output

    def test_text_lists_suggestions_and_hides_no_match_until_verbose(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento')
        make_item(ops_rq, 2, description='Servicio de flete')

        output = _run()
        assert 'SUGERIDO' in output and 'CEM-001' in output and BASIS_CODE in output
        assert 'Servicio de flete' not in output
        assert 'Servicio de flete' in _run(verbosity=2)
        assert 'Con sugerencia: 1 · Ambiguos: 0 · Sin coincidencia: 1' in output

    def test_text_does_not_print_an_empty_table_when_nothing_matches(self, ops_rq, cement):
        make_item(ops_rq, 1, description='Servicio de flete')

        output = _run()
        assert 'Ninguno tiene sugerencia' in output
        assert 'RESULTADO' not in output
        assert 'RESULTADO' in _run(verbosity=2)

    def test_text_lists_the_candidates_of_an_ambiguous_line(self, ops_rq):
        make_inventory('EPP-0001', 'Guantes de cuero')
        make_inventory('EPP-0002', 'GUANTES DE CUERO')
        make_item(ops_rq, 1, description='Guantes de cuero')

        output = _run()
        assert 'AMBIGUO' in output and '2 candidatos' in output
        assert 'candidato: EPP-0001' in output and 'candidato: EPP-0002' in output

    def test_text_flags_a_unit_mismatch(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento', unit='KG')

        assert '[UNIDAD DISTINTA]' in _run()

    def test_text_scope_follows_include_terminal(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento')

        assert '(RQs abiertos (no terminales))' in _run()
        assert '(todos los RQs)' in _run('--include-terminal')

    def test_limit_cuts_the_table_not_the_summary(self, ops_rq, cement):
        for n in range(1, 4):
            make_item(ops_rq, n, description=f'CEM-001 cemento {n}')

        output = _run('--limit', '1')
        assert 'Con sugerencia: 3' in output
        assert '... y 2 ítems más' in output
        assert '... y 2 ítems más' not in _run('--limit', '0')

    def test_json_is_the_only_output_and_has_every_row(self, ops_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento')
        make_item(ops_rq, 2, description='Servicio de flete')

        payload = json.loads(_run('--json'))
        assert set(payload) == {'rows', 'summary'}
        assert [r['status'] for r in payload['rows']] == [STATUS_SUGGESTED, STATUS_NO_MATCH]
        first = payload['rows'][0]
        assert set(first) == {
            'item_id', 'request_id', 'rq_number', 'flow', 'request_status', 'scope_code',
            'line_number', 'description', 'quantity', 'unit', 'status', 'basis', 'candidates',
            'unit_mismatch',
        }
        assert set(first['candidates'][0]) == {'inventory_id', 'product_code', 'description', 'unit'}

    def test_the_rq_option_filters_the_command(self, ops_rq, adm_rq, cement):
        make_item(ops_rq, 1, description='CEM-001 cemento')
        make_item(adm_rq, 1, description='CEM-001 cemento')

        rows = json.loads(_run('--json', '--rq', adm_rq.rq_number))['rows']
        assert [r['rq_number'] for r in rows] == [adm_rq.rq_number]

    def test_request_status_is_reported(self, ops_rq, cement):
        Request.objects.filter(pk=ops_rq.pk).update(status=RQStatusChoices.VALIDATED)
        make_item(ops_rq, 1, description='CEM-001 cemento')

        (row,) = json.loads(_run('--json'))['rows']
        assert row['request_status'] == RQStatusChoices.VALIDATED
