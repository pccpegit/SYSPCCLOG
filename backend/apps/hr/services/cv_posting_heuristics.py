"""Heuristic reading of a job posting without AI (SYSPCC-023, iteration 2).

Pure functions (no DB, no network, no settings): text in, candidate
requirements out. The result is only a PROPOSAL: the user reviews it.

Strategy:
  1. Split the text into sections by heading (requisitos, perfil, formación...
     vs. funciones, beneficios, condiciones...).
  2. Collect bullets (and plain lines under a requirements heading) of the
     requirement sections. Without headings, bullets outside the cut sections;
     without bullets, sentences that look like a requirement.
  3. Weight 3 when the line/section says indispensable/obligatorio/mínimo;
     weight 1 when it says deseable/valorable/opcional.
"""

import re
import unicodedata
from dataclasses import dataclass, field

MAX_CANDIDATES = 60  # hard stop; the service trims to HR_CV_MAX_REQUIREMENTS later

REQ_HEADERS = (
    'requisitos', 'requisito', 'requerimientos', 'requerimiento', 'perfil', 'se requiere', 'formacion',
    'experiencia', 'conocimientos', 'competencias', 'habilidades', 'indispensable', 'deseable', 'excluyente',
)
CUT_HEADERS = (
    'funciones', 'responsabilidades', 'ofrecemos', 'beneficios', 'condiciones', 'horario', 'remuneracion',
    'como postular', 'sobre nosotros',
)
KEYWORDS = (
    'experiencia', 'titulo', 'bachiller', 'colegiado', 'manejo', 'dominio', 'certificacion', 'licencia', 'anos',
)
BULLET_RE = re.compile(r'^\s*(?:[-•*·▪●–—]\s*|\d{1,2}[.)]\s+|[A-Za-z][.)]\s+|\(\w\)\s+)(\S.*)$')
MANDATORY_HINT = re.compile(r'indispensabl|obligatori|excluyent|imprescindibl|\bminim[oa]s?\b')
OPTIONAL_HINT = re.compile(r'deseabl|valorabl|opcional|\bplus\b|se valorar|ventaja')
TITLE_RE = re.compile(r'^\W*(?:convocatoria|se busca|puesto|cargo|vacante)[:\s-]+(.+)$', re.IGNORECASE)


@dataclass
class Candidate:
    text: str
    weight: int = 1


@dataclass
class RawPosting:
    """Unfiltered proposal from any source (AI, heuristic, simulated).
    `requirements` = [(text, weight)]."""
    position_title: str | None = None
    requirements: list[tuple[str, int]] = field(default_factory=list)
    omitted_protected: bool = False


@dataclass
class HeuristicResult:
    position_title: str | None = None
    requirements: list[Candidate] = field(default_factory=list)


def fold(text: str) -> str:
    """Lowercase without accents (for matching only)."""
    nfd = unicodedata.normalize('NFD', text or '')
    return ''.join(c for c in nfd if unicodedata.category(c) != 'Mn').lower()


@dataclass
class _Line:
    text: str
    mode: str | None  # 'req' | 'cut' | None
    hint: int | None  # section weight hint: 3, 1 or None
    bullet: bool


FILLER = frozenset({
    'del', 'de', 'la', 'el', 'los', 'las', 'y', 'e', 'puesto', 'cargo', 'academica', 'academico', 'laboral',
    'laborales', 'profesional', 'profesionales', 'general', 'generales', 'especifica', 'especifico', 'tecnica',
    'tecnicas', 'tecnico', 'requerida', 'requerido', 'minima', 'minimo', 'principales', 'candidato',
    'postulante', 'esperado', 'esperada', 'deseable', 'deseables', 'indispensable', 'indispensables',
    'obligatorio', 'obligatorios', 'excluyente', 'excluyentes', 'trabajo', 'salarial', 'economicas', 'que',
    'ofrecemos', 'empresa', 'nosotros', 'requisitos', 'complementaria', 'complementarias', 'adicional',
    'adicionales', 'valorable', 'valorables', 'minimos', 'para', 'ocupar',
})


def _header(stripped: str):
    """Return (kind, hint, inline) when the line is a section heading, else None.
    A heading is a short line that starts with a known keyword and either ends
    with ':' or contains only filler words after the keyword."""
    if BULLET_RE.match(stripped):
        return None
    folded = fold(stripped).strip()
    head, sep, rest = folded.partition(':')
    head = head.strip()
    if not head or re.search(r'\d', head):
        return None
    ends_colon = folded.endswith(':')
    for kind, keywords in (('cut', CUT_HEADERS), ('req', REQ_HEADERS)):
        for kw in keywords:
            if head != kw and not head.startswith(kw + ' '):
                continue
            tail = head[len(kw):].split()
            if sep:
                ok = len(tail) <= 5 and (ends_colon or all(w in FILLER for w in tail))
            else:
                ok = len(tail) <= 3 and all(w in FILLER for w in tail)
            if not ok:
                continue
            hint = 3 if MANDATORY_HINT.search(head) else (1 if OPTIONAL_HINT.search(head) else None)
            inline = stripped.partition(':')[2].strip() if (sep and kind == 'req') else ''
            return kind, hint, inline
    return None


def _split_lines(text: str) -> list[_Line]:
    lines: list[_Line] = []
    mode: str | None = None
    hint: int | None = None
    last: _Line | None = None
    for raw in (text or '').splitlines():
        stripped = raw.strip()
        if not stripped:
            last = None
            continue
        head = _header(stripped)
        if head:
            mode, hint, inline = head
            last = None
            if inline:
                last = _Line(inline, mode, hint, False)
                lines.append(last)
            continue
        m = BULLET_RE.match(stripped)
        if m:
            last = _Line(m.group(1).strip(), mode, hint, True)
            lines.append(last)
            continue
        # Continuation of the previous item (wrapped line) or a plain line.
        wrapped = last is not None and (
            stripped[:1].islower() or (last.bullet and raw[:1].isspace() and not re.search(r'[.;:]$', last.text)))
        if wrapped:
            last.text = f'{last.text} {stripped}'
            continue
        last = _Line(stripped, mode, hint, False)
        lines.append(last)
    return lines


def _weight(line: _Line) -> int:
    folded = fold(line.text)
    if OPTIONAL_HINT.search(folded):
        return 1
    if MANDATORY_HINT.search(folded):
        return 3
    return line.hint or 1


def _title(text: str) -> str | None:
    first: str | None = None
    for raw in (text or '').splitlines()[:15]:
        stripped = raw.strip()
        if not stripped:
            continue
        m = TITLE_RE.match(stripped)
        if m:
            title = m.group(1).strip(' :-')
            if title:
                return title[:100]
        if first is None and len(stripped) <= 100 and not BULLET_RE.match(stripped) and not _header(stripped):
            first = stripped
    return first


def extract(text: str) -> HeuristicResult:
    """Candidate requirements (unfiltered, unnormalized) and a title guess."""
    lines = _split_lines(text)
    req_sections = [ln for ln in lines if ln.mode == 'req']
    if req_sections:
        chosen = req_sections
    else:
        bullets = [ln for ln in lines if ln.bullet and ln.mode != 'cut']
        if bullets:
            chosen = bullets
        else:
            chosen = [ln for ln in lines if ln.mode != 'cut' and any(k in fold(ln.text) for k in KEYWORDS)]
    result = HeuristicResult(position_title=_title(text))
    for ln in chosen[:MAX_CANDIDATES]:
        result.requirements.append(Candidate(text=ln.text, weight=_weight(ln)))
    return result
