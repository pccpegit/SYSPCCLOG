"""Simulated provider for CV analysis ("modo de prueba gratis", SYSPCC-023 iteration 2).

Deterministic generator of CV reports and job-posting requirements, to try the
whole flow without an API key or cost. Only reachable when
`cv_agent.provider_name() == 'fake'` (HR_CV_PROVIDER=fake AND DEBUG).

- Same file (sha256) -> same report. Uses an ISOLATED `random.Random`; the
  global RNG is never touched.
- All contact data is fictional: `@example.com` and `+51 900 000 ###`.
- The output is validated against the real schema by the caller
  (`report_model(has_requirements).model_validate`), so a generator bug fails
  loudly in tests instead of producing a half-valid report.
"""

import hashlib
import random
import re
import time

from django.conf import settings

from apps.hr.services import cv_posting_heuristics as heuristics
from apps.hr.services.cv_posting_heuristics import RawPosting
from apps.hr.services.cv_schemas import report_model

FIRST_NAMES = [
    'Luis', 'Carlos', 'José', 'Miguel', 'Jorge', 'Diego', 'Renzo', 'Alonso', 'Fabián', 'Hugo',
    'María', 'Ana', 'Rosa', 'Lucía', 'Carmen', 'Patricia', 'Daniela', 'Valeria', 'Milagros', 'Fiorella',
]
LAST_NAMES = [
    'Quispe', 'Huamán', 'Flores', 'Rojas', 'Mendoza', 'Torres', 'Vargas', 'Castillo', 'Ramos', 'Chávez',
    'Gutiérrez', 'Salazar', 'Paredes', 'Cárdenas', 'Valdivia', 'Rivera', 'Ccopa', 'Mamani', 'Soto', 'Delgado',
]
CITIES = ['Lima', 'Arequipa', 'Trujillo', 'Cusco', 'Piura', 'Chiclayo', 'Huancayo', 'Ica', 'Tacna', 'Cajamarca']
HEADLINES = [
    'Ingeniero civil residente de obra', 'Ingeniera civil con experiencia en edificaciones',
    'Supervisor de obras viales', 'Ingeniero de costos y presupuestos', 'Arquitecta proyectista',
    'Ingeniero mecánico de mantenimiento', 'Jefe de seguridad y salud ocupacional', 'Asistente administrativo de obra',
    'Ingeniero de planeamiento y control de obras', 'Técnico en topografía',
]
COMPANIES = [
    'Constructora Andina (demo)', 'Ingeniería del Sur (demo)', 'Obras y Proyectos Pacífico (demo)',
    'Grupo Vial Norte (demo)', 'Edificaciones Lima (demo)', 'Servicios Mineros Altiplano (demo)',
]
ROLES = [
    'Residente de obra', 'Supervisor de campo', 'Ingeniero de costos', 'Asistente de ingeniería',
    'Jefe de producción', 'Ingeniero de seguridad', 'Planner de obra', 'Coordinador técnico',
]
ROLE_TASKS = [
    'Control de avance y valorizaciones.', 'Supervisión de partidas de concreto y acero.',
    'Elaboración de presupuestos y metrados.', 'Coordinación con subcontratistas.',
    'Seguimiento del cronograma y cierre de la obra.', 'Gestión de seguridad en campo.',
]
INSTITUTIONS = [
    'Universidad Nacional de Ingeniería (demo)', 'Pontificia Universidad Católica (demo)',
    'Universidad Nacional San Agustín (demo)', 'Universidad Privada del Norte (demo)', 'TECSUP (demo)',
]
DEGREES = [
    ('Ingeniería Civil', 'Ingeniero civil'), ('Arquitectura', 'Arquitecto'),
    ('Ingeniería Industrial', 'Ingeniero industrial'), ('Ingeniería Mecánica', 'Ingeniero mecánico'),
    ('Administración de Empresas', 'Licenciado en administración'),
]
SKILLS = [
    'AutoCAD', 'Revit', 'MS Project', 'S10 Presupuestos', 'Excel avanzado', 'Primavera P6', 'Civil 3D',
    'Power BI', 'Gestión de obra', 'Control de costos', 'Seguridad en obra', 'Valorizaciones', 'Metrados',
    'Planeamiento Last Planner', 'Topografía',
]
CERTS = [
    ('PMP', 'PMI'), ('Seguridad en trabajos en altura', 'SENCICO'), ('Gestión de proyectos', 'PUCP'),
    ('Primeros auxilios', 'Cruz Roja (demo)'), ('ISO 9001 auditor interno', 'Bureau (demo)'),
    ('Last Planner System', 'Lean Construction (demo)'),
]
LANGS = [('Inglés', ['A2', 'B1', 'B2', 'C1']), ('Portugués', ['Básico', 'Intermedio']), ('Quechua', ['Nativo'])]

SAMPLE_REQUIREMENTS = [
    ('Ingeniero civil o arquitecto colegiado y habilitado', True),
    ('Experiencia mínima de 3 años en obras de edificación', True),
    ('Manejo de AutoCAD y MS Project', False),
    ('Conocimiento de valorizaciones y control de costos', False),
    ('Curso de seguridad y salud en el trabajo', False),
    ('Inglés a nivel intermedio', False),
    ('Experiencia en supervisión de subcontratistas', False),
    ('Manejo de S10 Presupuestos', False),
    ('Licencia de conducir B-I', False),
]


# ------------------------------------------------------------------ helpers

def _norm_seed(seed) -> str:
    """64-hex string from any seed (a real sha256 is returned untouched)."""
    value = str(seed or '')
    if re.fullmatch(r'[0-9a-f]{64}', value):
        return value
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def delay_seconds(seed) -> float:
    base = float(getattr(settings, 'HR_CV_FAKE_DELAY_SECONDS', 0) or 0)
    if base <= 0:
        return 0.0
    return base * (0.5 + int(_norm_seed(seed)[:2], 16) / 255)


def simulate_delay(seed) -> None:
    pause = delay_seconds(seed)
    if pause > 0:
        time.sleep(pause)


def should_fail(seed) -> bool:
    """Deterministic failure of FAIL_PERCENT % of the files (to try the error UI)."""
    percent = int(getattr(settings, 'HR_CV_FAKE_FAIL_PERCENT', 0) or 0)
    return percent > 0 and int(_norm_seed(seed)[:8], 16) % 100 < percent


def _ym(year: int, month: int) -> str:
    return f'{year:04d}-{month:02d}'


# ------------------------------------------------------------------ report

def _requirement_status(sha: str, rid: int) -> str:
    roll = random.Random(f'{sha}:{rid}').random()
    if roll < 0.45:
        return 'met'
    if roll < 0.70:
        return 'partial'
    if roll < 0.90:
        return 'not_met'
    return 'unknown'


def _evaluation(sha: str, requirements: list[dict], companies: list[str]) -> dict:
    results, strengths, gaps = [], [], []
    for req in requirements:
        status = _requirement_status(sha, req['id'])
        short = req['text'][:90]
        if status == 'met':
            evidence = f'Lo menciona en su experiencia en {companies[req["id"] % len(companies)]}.'
            strengths.append(f'Cumple: {short}')
        elif status == 'partial':
            evidence = 'Menciona algo parecido, pero no queda del todo claro.'
        elif status == 'not_met':
            evidence = 'No aparece en su CV.'
            gaps.append(f'No se evidencia: {short}')
        else:
            evidence = ''
            gaps.append(f'Sin información sobre: {short}')
        results.append({'requirement_id': req['id'], 'status': status, 'evidence': evidence})
    return {
        'requirement_results': results,
        'strengths': strengths[:4] or ['Perfil con experiencia en obras (datos simulados).'],
        'gaps': gaps[:4],
    }


def _data(sha: str, requirements: list[dict]) -> dict:
    rng = random.Random(int(sha[:16], 16))
    first, last1, last2 = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES), rng.choice(LAST_NAMES)
    full_name = f'{first} {last1} {last2}'
    degree_field, degree_title = rng.choice(DEGREES)
    graduation = rng.randint(2005, 2021)

    # Jobs: 1-3 consecutive, reference date fixed for determinism (the code
    # computes the years: overlaps and "is_current" are handled there).
    jobs_count = rng.randint(1, 3)
    year = graduation + 1
    experience = []
    companies = []
    for index in range(jobs_count):
        start_month = rng.randint(1, 12)
        duration = rng.randint(1, 5)
        company = rng.choice(COMPANIES)
        companies.append(company)
        current = index == jobs_count - 1 and rng.random() < 0.5
        end_year = min(year + duration, 2025)
        entry = {
            'company': company, 'role': rng.choice(ROLES), 'start': _ym(min(year, 2025), start_month),
            'end': None if current else _ym(end_year, min(12, start_month)),
            'is_current': current, 'description': rng.choice(ROLE_TASKS),
        }
        if not current and entry['end'] < entry['start']:
            entry['end'] = entry['start']
        experience.append(entry)
        year = end_year + 1
    skills = rng.sample(SKILLS, rng.randint(4, 8))
    certs = [{'name': n, 'issuer': i, 'year': rng.randint(2012, 2025)}
             for n, i in rng.sample(CERTS, rng.randint(0, 3))]
    languages = [{'language': 'Español', 'level': 'Nativo'}]
    if rng.random() < 0.75:
        lang, levels = rng.choice(LANGS[:2])
        languages.append({'language': lang, 'level': rng.choice(levels)})
    roll = rng.random()
    readability = 'good' if roll < 0.80 else ('partial' if roll < 0.95 else 'poor')
    injection = rng.random() < 0.02
    headline = rng.choice(HEADLINES)
    data = {
        'candidate': {
            'full_name': full_name,
            'email': f'{heuristics.fold(first)}.{heuristics.fold(last1)}@example.com',
            'phone': f'+51 900 000 {rng.randint(100, 999)}',
            'location': rng.choice(CITIES),
            'links': [],
        },
        'headline': headline,
        'summary': (f'{degree_title} con {jobs_count} experiencias en obras y proyectos. '
                    f'Destaca en {skills[0]} y {skills[1]}. Perfil generado en modo de prueba (datos simulados).'),
        'estimated_total_years': float(len(experience) * 2),
        'experience': experience,
        'education': [{
            'institution': rng.choice(INSTITUTIONS), 'degree': f'{degree_title}', 'field': degree_field,
            'status': 'completed', 'end_year': graduation,
        }],
        'skills': skills,
        'certifications': certs,
        'languages': languages,
        'readability': readability,
        'injection_suspected': injection,
    }
    if requirements:
        data['evaluation'] = _evaluation(sha, requirements, companies)
    return data


def fake_report(sha256, has_requirements: bool, requirements: list[dict] | None = None):
    """Valid pydantic report (with `evaluation` iff `has_requirements`)."""
    sha = _norm_seed(sha256)
    reqs = list(requirements or []) if has_requirements else []
    return report_model(bool(reqs)).model_validate(_data(sha, reqs))


# ----------------------------------------------------------------- posting

def fake_posting(seed, text: str | None):
    """Requirements for a posting in test mode. Real text goes through the
    heuristic; no text (or nothing found) yields 5-7 sample requirements."""
    result = heuristics.extract(text or '') if (text or '').strip() else None
    if result and result.requirements:
        return RawPosting(
            position_title=result.position_title,
            requirements=[(c.text, c.weight) for c in result.requirements],
        )
    rng = random.Random(int(_norm_seed(seed)[:16], 16))
    count = rng.randint(5, 7)
    picked = rng.sample(SAMPLE_REQUIREMENTS, count)
    mandatory = {i for i, (_t, base) in enumerate(picked) if base}
    if not mandatory:
        mandatory = {0}
    return RawPosting(
        position_title=rng.choice(['Residente de obra', 'Supervisor de obra', 'Ingeniero de costos']),
        requirements=[(t, 3 if i in mandatory else 1) for i, (t, _b) in enumerate(picked)],
    )
