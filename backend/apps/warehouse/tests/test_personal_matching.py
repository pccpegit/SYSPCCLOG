"""SYSPCC-025 — coincidencia destino -> Personal: solo exacta y única, sin fuzzy."""
import pytest

from apps.warehouse.services import personal_matching as pm


def test_normalize_name_ignores_accents_case_order_and_punctuation():
    assert pm.normalize_name('Pérez Lozano, ANA') == pm.normalize_name('ana  perez lozano')
    assert pm.normalize_name(None) == ''
    assert pm.normalize_name('   ') == ''


@pytest.mark.django_db
def test_unique_match_is_linked(make_personal):
    person = make_personal('Huaman Torres, Elena Test')
    result = pm.PersonalIndex().match('ELENA HUAMAN TORRES TEST')
    assert (result.status, result.personal_id) == (pm.MATCHED, person.pk)


@pytest.mark.django_db
def test_homonyms_are_ambiguous_and_not_linked(make_personal):
    make_personal('Huaman Torres, Elena Test')
    make_personal('Torres Huaman, Elena Test')  # same token set -> homonym
    result = pm.PersonalIndex().match('Elena Test Huaman Torres')
    assert result.status == pm.AMBIGUOUS
    assert result.personal_id is None
    assert result.candidates == 2


@pytest.mark.django_db
def test_partial_names_are_never_fuzzy_matched(make_personal):
    make_personal('Huaman Torres, Elena Test')
    assert pm.PersonalIndex().match('Elena Huaman').status == pm.NONE
    assert pm.PersonalIndex().match('').status == pm.NONE
    assert pm.PersonalIndex().match('ALM - PRIMER PISO').status == pm.NONE
