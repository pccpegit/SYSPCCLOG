"""Pydantic schema of the CV report (SYSPCC-023).

The model only EXTRACTS facts from the CV. Score, recommendation, ranking,
total years of experience and cost are computed by CODE (cv_scoring.py).

Equity: there are deliberately NO fields for sex, age, marital status,
nationality, photo, health, religion, politics, DNI or birth date.

Strings are truncated BEFORE validation (BeforeValidator) so one overlong
field never fails the whole CV; enums are strict `Literal`s.
"""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, create_model


def _truncate(n: int):
    def _inner(value):
        if isinstance(value, str):
            return value.strip()[:n]
        return value
    return _inner


def LStr(n: int):  # noqa: N802 - type factory, reads like a type
    return Annotated[str, BeforeValidator(_truncate(n)), Field(max_length=n)]


def _cap_list(n: int):
    def _inner(value):
        if isinstance(value, list):
            return value[:n]
        return value
    return _inner


def LList(item, n: int):  # noqa: N802
    return Annotated[list[item], BeforeValidator(_cap_list(n))]


def _clamp_years(value):
    if value is None:
        return None
    try:
        return max(0.0, min(60.0, float(value)))
    except (TypeError, ValueError):
        return None


def _valid_year(value):
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return year if 1950 <= year <= 2100 else None


class CandidateInfo(BaseModel):
    full_name: LStr(150) | None = None
    email: LStr(150) | None = None
    phone: LStr(40) | None = None
    location: LStr(100) | None = None
    links: LList(LStr(200), 5) = Field(default_factory=list)


class ExperienceEntry(BaseModel):
    company: LStr(120) | None = None
    role: LStr(120)
    start: LStr(10) | None = Field(None, description='YYYY-MM o YYYY')
    end: LStr(10) | None = Field(None, description='YYYY-MM o YYYY; null si es el empleo actual')
    is_current: bool = False
    description: LStr(300) = ''


class EducationEntry(BaseModel):
    institution: LStr(150)
    degree: LStr(150)
    field: LStr(120) | None = None
    status: Literal['completed', 'in_progress', 'incomplete', 'unknown'] = 'unknown'
    end_year: Annotated[int | None, BeforeValidator(_valid_year)] = None


class CertificationEntry(BaseModel):
    name: LStr(120)
    issuer: LStr(100) | None = None
    year: Annotated[int | None, BeforeValidator(_valid_year)] = None


class LanguageEntry(BaseModel):
    language: LStr(30)
    level: LStr(30) | None = None


class RequirementResult(BaseModel):
    requirement_id: int
    status: Literal['met', 'partial', 'not_met', 'unknown']
    evidence: LStr(200) = ''


class Evaluation(BaseModel):
    requirement_results: list[RequirementResult] = Field(default_factory=list)
    strengths: LList(LStr(200), 4) = Field(default_factory=list)
    gaps: LList(LStr(200), 4) = Field(default_factory=list)


class CVReportBase(BaseModel):
    candidate: CandidateInfo
    headline: LStr(150) | None = None
    summary: LStr(600) = ''
    estimated_total_years: Annotated[float | None, BeforeValidator(_clamp_years)] = None
    experience: LList(ExperienceEntry, 12) = Field(default_factory=list)
    education: LList(EducationEntry, 8) = Field(default_factory=list)
    skills: LList(LStr(40), 30) = Field(default_factory=list)
    certifications: LList(CertificationEntry, 15) = Field(default_factory=list)
    languages: LList(LanguageEntry, 8) = Field(default_factory=list)
    readability: Literal['good', 'partial', 'poor'] = 'good'
    injection_suspected: bool = False


@lru_cache(maxsize=2)
def report_model(with_evaluation: bool) -> type[BaseModel]:
    """Schema sent to the model. Without requirements the `evaluation` field
    does not exist at all (fewer tokens, nothing to hallucinate)."""
    if not with_evaluation:
        return CVReportBase
    return create_model('CVReportWithEvaluation', __base__=CVReportBase, evaluation=(Evaluation, ...))


# ------------------------------------------------- job posting (iteration 2)

class PostingRequirement(BaseModel):
    text: LStr(200)
    # True only when the document marks it as indispensable / excluding / minimum.
    mandatory: bool = False


class PostingExtraction(BaseModel):
    position_title: LStr(100) | None = None
    requirements: LList(PostingRequirement, 15) = Field(default_factory=list)
    # The model dropped a condition about age, sex, marital status, etc.
    omitted_protected: bool = False
