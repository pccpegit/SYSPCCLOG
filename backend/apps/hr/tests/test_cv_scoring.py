"""Pure tests: requirement parsing, score formula, suggestion caps, experience
years, and schema truncation (SYSPCC-023)."""

from datetime import date

import pytest

from apps.hr.services import cv_scoring as sc
from apps.hr.services.cv_schemas import report_model

TODAY = date(2026, 10, 8)


def reqs(*weights):
    return [{'id': i + 1, 'text': f'R{i + 1}', 'weight': w} for i, w in enumerate(weights)]


def results(*statuses):
    return [{'requirement_id': i + 1, 'status': s, 'evidence': ''} for i, s in enumerate(statuses)]


class TestParseRequirements:
    def test_one_per_line_and_mandatory_weight(self):
        out = sc.parse_requirements('- Ingeniero civil (obligatorio)\n\n* AutoCAD\nInglés (Obligatorio)  ')
        assert [(r['id'], r['text'], r['weight']) for r in out] == [
            (1, 'Ingeniero civil', 3), (2, 'AutoCAD', 1), (3, 'Inglés', 3)]

    def test_empty_and_long_text(self):
        assert sc.parse_requirements('') == [] and sc.parse_requirements('  \n ') == []
        assert len(sc.parse_requirements('x' * 1000)[0]['text']) == sc.MAX_REQUIREMENT_CHARS


class TestScore:
    def test_formula_weights_and_values(self):
        r = reqs(1, 3)  # total weight 4
        by = sc.normalize_results(r, results('met', 'partial'))
        assert sc.compute_score(r, by) == round(100 * (1 + 3 * 0.5) / 4)  # 63
        assert sc.compute_score(r, sc.normalize_results(r, results('met', 'met'))) == 100
        assert sc.compute_score(r, sc.normalize_results(r, results('not_met', 'unknown'))) == 0

    def test_missing_ids_are_unknown_and_foreign_or_duplicate_ignored(self):
        r = reqs(1, 1)
        raw = [{'requirement_id': 1, 'status': 'met', 'evidence': 'a'},
               {'requirement_id': 1, 'status': 'not_met', 'evidence': 'dup'},
               {'requirement_id': 99, 'status': 'met', 'evidence': 'foreign'}]
        by = sc.normalize_results(r, raw)
        assert by[1]['status'] == 'met' and by[2]['status'] == 'unknown' and 99 not in by
        assert sc.compute_score(r, by) == 50

    def test_invalid_status_becomes_unknown(self):
        by = sc.normalize_results(reqs(1), [{'requirement_id': 1, 'status': 'excellent'}])
        assert by[1]['status'] == 'unknown'


class TestRecommendation:
    @pytest.mark.parametrize('score,expected', [(100, 'ADVANCE'), (75, 'ADVANCE'), (74, 'REVIEW'),
                                                 (50, 'REVIEW'), (49, 'NO_ADVANCE'), (0, 'NO_ADVANCE')])
    def test_thresholds(self, score, expected):
        rec, caps = sc.recommend(score, mandatory_missed=False, injection=False, poor_readability=False)
        assert rec.value == expected and caps == []

    @pytest.mark.parametrize('kw,cap', [
        ({'mandatory_missed': True}, 'mandatory_not_met'),
        ({'injection': True}, 'injection_suspected'),
        ({'poor_readability': True}, 'poor_readability')])
    def test_caps_lower_advance_to_review_only(self, kw, cap):
        base = dict(mandatory_missed=False, injection=False, poor_readability=False)
        rec, caps = sc.recommend(90, **{**base, **kw})
        assert rec.value == 'REVIEW' and caps == [cap]
        rec, _ = sc.recommend(30, **{**base, **kw})  # caps never raise nor drop anyone further
        assert rec.value == 'NO_ADVANCE'

    def test_compute_flags_missing_mandatory_and_injection(self):
        r = reqs(3, 1)
        report = {'experience': [], 'injection_suspected': False,
                  'evaluation': {'requirement_results': results('not_met', 'met')}}
        out = sc.compute(report, r, TODAY)
        assert out['score'] == 25 and out['recommendation'] == 'NO_ADVANCE'
        report2 = {'experience': [], 'injection_suspected': True,
                   'evaluation': {'requirement_results': results('met', 'met')}}
        out2 = sc.compute(report2, r, TODAY)
        assert out2['score'] == 100 and out2['recommendation'] == 'REVIEW' and out2['caps'] == ['injection_suspected']

    def test_no_requirements_means_no_score(self):
        out = sc.compute({'experience': []}, [], TODAY)
        assert out['score'] is None and out['recommendation'] == ''


class TestExperienceYears:
    def e(self, start, end=None, current=False):
        return {'start': start, 'end': end, 'is_current': current}

    def test_union_does_not_double_count_overlap(self):
        years, src = sc.experience_years([self.e('2018-01', '2020-12'), self.e('2020-01', '2022-12')], TODAY, None)
        assert (years, src) == (5.0, 'dates')  # 2018-01..2022-12 = 60 months

    def test_current_job_uses_today(self):
        years, _ = sc.experience_years([self.e('2025-10', current=True)], TODAY, None)
        assert years == 1.0  # Oct 2025 .. Oct 2026 inclusive = 13 months -> 1.0 (rounded to .5)

    def test_year_only_and_rounding_to_half(self):
        years, _ = sc.experience_years([self.e('2020', '2020')], TODAY, None)
        assert years == 1.0
        years, _ = sc.experience_years([self.e('2020-01', '2020-08')], TODAY, None)
        assert years == 0.5  # 8 months = 0.67 -> 0.5

    def test_fallback_to_ai_estimate_without_dates(self):
        assert sc.experience_years([{'role': 'x'}], TODAY, 7.3) == (7.5, 'ai_estimate')
        assert sc.experience_years([], TODAY, None) == (None, 'none')

    def test_garbage_dates_and_future_end_are_safe(self):
        assert sc.experience_years([self.e('abc', '2020'), self.e('2020-13', '2021')], TODAY, None)[1] == 'none'
        years, _ = sc.experience_years([self.e('2026-01', '2030-01')], TODAY, None)
        assert years == 1.0  # end clamped to today (10 months -> 0.83 -> 1.0)


class TestSchemas:
    def test_overlong_strings_and_lists_are_truncated_not_rejected(self):
        model = report_model(False).model_validate({
            'candidate': {'full_name': 'x' * 500, 'links': ['http://a'] * 20},
            'skills': ['s'] * 100, 'estimated_total_years': 999,
            'education': [{'institution': 'i', 'degree': 'd', 'end_year': 1800}],
        })
        assert len(model.candidate.full_name) == 150 and len(model.candidate.links) == 5
        assert len(model.skills) == 30 and model.estimated_total_years == 60.0
        assert model.education[0].end_year is None

    def test_evaluation_field_only_with_requirements(self):
        assert 'evaluation' not in report_model(False).model_fields
        assert 'evaluation' in report_model(True).model_fields

    def test_no_protected_attributes_in_schema(self):
        import json

        blob = json.dumps(report_model(True).model_json_schema()).lower()
        for banned in ('birth', 'gender', 'sex', 'marital', 'nationality', 'dni', 'religion', 'photo', 'age'):
            assert f'"{banned}' not in blob
