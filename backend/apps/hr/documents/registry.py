"""Document type registry (SYSPCC-022).

One DocumentTypeSpec per document type. The services, endpoints and screens
are generic over this registry: adding "cese" or "boleta" later means
registering another spec (+ one HRDocumentType choice), not new plumbing.
"""

from dataclasses import dataclass, field
from typing import Any, Callable

from apps.hr.exceptions import HRDomainError


@dataclass(frozen=True)
class FieldSpec:
    """UI/validation metadata for one data field (API keys are English)."""

    key: str
    label: str
    type: str  # string | text | date | decimal | integer | choice
    required: bool = False
    required_when: str = ''  # human-readable condition, e.g. 'contract_type=FIXED_TERM'
    choices: tuple = ()  # ((value, label), ...)
    source: str = 'manual'  # 'personal' when it can be prefilled from Personal
    help: str = ''
    question: str = ''  # asked by the assistant when the field is missing
    default: Any = None


@dataclass(frozen=True)
class VariableSpec:
    """A variable RR. HH. may write in the Word template. `name` is Spanish
    snake_case without accents: it is a contract with the people who edit the
    template. `field` maps it back to the English data key (None = derived or
    company-level)."""

    name: str
    label: str
    group: str  # trabajador | contrato | derivada | empresa
    field: str | None = None
    required: bool = False  # warn at upload if the template does not use it


@dataclass(frozen=True)
class DocumentTypeSpec:
    key: str
    label: str
    prefix: str  # numbering prefix, e.g. 'CT' -> CT-2026-0001
    default_slug: str
    fields: tuple
    variables: tuple
    normalize: Callable  # (raw: dict, *, partial=False) -> (clean: dict, warnings: list[str])
    build_context: Callable  # (data: dict, company: dict, reference_number: str|None) -> dict
    prefill: Callable  # (personal) -> (data: dict, sources: dict)
    sample_data: Callable  # () -> dict valid for normalize()
    extraction_model: Any = None  # Pydantic model for the assistant (optional)
    filename_prefix: str = 'Documento'
    extras: dict = field(default_factory=dict)

    @property
    def variable_names(self) -> set:
        return {v.name for v in self.variables}

    @property
    def required_variable_names(self) -> set:
        return {v.name for v in self.variables if v.required}

    def field_spec(self, key: str):
        return next((f for f in self.fields if f.key == key), None)


def _build_registry() -> dict:
    from apps.hr.documents.contract import CONTRACT_SPEC

    return {CONTRACT_SPEC.key: CONTRACT_SPEC}


_REGISTRY: dict | None = None


def get_registry() -> dict:
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = _build_registry()
    return _REGISTRY


def get_spec(document_type: str) -> DocumentTypeSpec:
    try:
        return get_registry()[document_type]
    except KeyError:
        raise HRDomainError(
            'unsupported_document_type',
            'Tipo de documento no soportado todavía.',
        )
