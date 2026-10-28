"""Score, suggestion and experience years, computed by CODE (SYSPCC-023).

Pure functions (no DB, no network). The AI only classifies each requirement;
it can never 'give itself' 100 points or a recommendation.
"""

import re
from datetime import date

from django.conf import settings

from apps.hr.enums import CVRecommendation

MANDATORY_RE = re.compile(r'\s*\(\s*obligatorio\s*\)\s*$', re.IGNORECASE)
STATUS_VALUE = {'met': 1.0, 'partial': 0.5, 'unknown': 0.0, 'not_met': 0.0}
WEIGHT_NORMAL, WEIGHT_MANDATORY = 1, 3
MAX_REQUIREMENT_CHARS = 300


def parse_requirements(text: str) -> list[dict]:
    """One requirement per non-empty line. A trailing '(obligatorio)' gives weight 3."""
    result = []
    for line in (text or '').splitlines():
        line = line.strip().lstrip('-*•').strip()
        if not line:
            continue
        mandatory = bool(MANDATORY_RE.search(line))
        clean = MANDATORY_RE.sub('', line).strip() if mandatory else line
        if not clean:
            continue
        result.append({
            'id': len(result) + 1,
            'text': clean[:MAX_REQUIREMENT_CHARS],
            'weight': WEIGHT_MANDATORY if mandatory else WEIGHT_NORMAL,
        })
    return result


def normalize_results(requirements: list[dict], results: list[dict]) -> dict[int, dict]:
    """Map requirement id -> {status, evidence}. Unknown/duplicate ids from the
    model are ignored (first wins); missing ones become 'unknown'."""
    valid = {r['id'] for r in requirements}
    by_id: dict[int, dict] = {}
    for item in results or []:
        rid = item.get('requirement_id')
        if rid in valid and rid not in by_id:
            status = item.get('status') if item.get('status') in STATUS_VALUE else 'unknown'
            by_id[rid] = {'status': status, 'evidence': item.get('evidence', '') or ''}
    for rid in valid:
        by_id.setdefault(rid, {'status': 'unknown', 'evidence': ''})
    return by_id


def compute_score(requirements: list[dict], by_id: dict[int, dict]) -> int:
    total = sum(r['weight'] for r in requirements)
    if not total:
        return 0
    got = sum(r['weight'] * STATUS_VALUE[by_id[r['id']]['status']] for r in requirements)
    return int(round(100 * got / total))


def recommend(score: int, *, mandatory_missed: bool, injection: bool, poor_readability: bool):
    """Return (recommendation, caps). Caps only lower ADVANCE to REVIEW."""
    if score >= settings.HR_CV_SCORE_ADVANCE:
        rec = CVRecommendation.ADVANCE
    elif score >= settings.HR_CV_SCORE_REVIEW:
        rec = CVRecommendation.REVIEW
    else:
        rec = CVRecommendation.NO_ADVANCE
    caps = []
    if mandatory_missed:
        caps.append('mandatory_not_met')
    if injection:
        caps.append('injection_suspected')
    if poor_readability:
        caps.append('poor_readability')
    if caps and rec == CVRecommendation.ADVANCE:
        rec = CVRecommendation.REVIEW
    return rec, caps


def _parse_ym(raw, *, end: bool):
    """'YYYY-MM' or 'YYYY' -> month index (year*12+month0); None if unusable."""
    if not raw:
        return None
    m = re.fullmatch(r'\s*(\d{4})(?:-(\d{1,2}))?\s*', str(raw))
    if not m:
        return None
    year = int(m.group(1))
    if not 1950 <= year <= 2100:
        return None
    if m.group(2):
        month = int(m.group(2))
        if not 1 <= month <= 12:
            return None
    else:
        month = 12 if end else 1
    return year * 12 + (month - 1)


def experience_years(experience: list[dict], today: date, fallback: float | None):
    """Union of intervals (overlaps not double counted), rounded to 0.5.
    Returns (years|None, source) with source 'dates' | 'ai_estimate' | 'none'."""
    now_idx = today.year * 12 + (today.month - 1)
    intervals = []
    for e in experience or []:
        start = _parse_ym(e.get('start'), end=False)
        if start is None:
            continue
        end = now_idx if e.get('is_current') or not e.get('end') else _parse_ym(e.get('end'), end=True)
        if end is None:
            continue
        end = min(end, now_idx)
        if end < start:
            continue
        intervals.append((start, end + 1))  # inclusive months
    if intervals:
        intervals.sort()
        merged = [list(intervals[0])]
        for s, e in intervals[1:]:
            if s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        months = sum(e - s for s, e in merged)
        return round(months / 12 * 2) / 2, 'dates'
    if fallback is not None:
        return round(float(fallback) * 2) / 2, 'ai_estimate'
    return None, 'none'


def compute(report: dict, requirements: list[dict], today: date) -> dict:
    """`report` is a CVReport dump. Returns the 'computed' block."""
    years, source = experience_years(report.get('experience'), today, report.get('estimated_total_years'))
    computed = {
        'score': None, 'recommendation': '', 'experience_years': years,
        'experience_source': source, 'caps': [], 'requirements': [],
    }
    if requirements:
        evaluation = report.get('evaluation') or {}
        by_id = normalize_results(requirements, evaluation.get('requirement_results'))
        score = compute_score(requirements, by_id)
        missed = any(r['weight'] == WEIGHT_MANDATORY and by_id[r['id']]['status'] == 'not_met'
                     for r in requirements)
        rec, caps = recommend(
            score, mandatory_missed=missed, injection=bool(report.get('injection_suspected')),
            poor_readability=report.get('readability') == 'poor',
        )
        computed.update({
            'score': score, 'recommendation': rec.value, 'caps': caps,
            'requirements': [
                {'id': r['id'], 'text': r['text'], 'weight': r['weight'], **by_id[r['id']]}
                for r in requirements
            ],
        })
    return computed
