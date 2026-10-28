"""Per-candidate PDF report (SYSPCC-023). Pure function JSON -> bytes (reportlab).

SECURITY: reportlab's Paragraph parses a mini-HTML (<img src=...>, <font>,
<a>...). Every string that comes from the CV / the model goes through `esc()`
(XML-escape + cp1252 normalization + control-char stripping) BEFORE reaching
a Paragraph, so a CV containing `<img src="file:///etc/passwd">` is printed
as plain text and never fetched. The report is regenerable at any time from
the stored JSON (no new AI call).
"""

import io
import re
from xml.sax.saxutils import escape as xml_escape

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.hr.enums import CVRecommendation

DISCLAIMER = 'Generado con apoyo de IA a partir del CV. La IA ayuda a ordenar; la decisión final es de RR. HH.'
REC_LABEL = {r.value: str(r.label) for r in CVRecommendation}
REQ_STATUS = {'met': 'Cumple', 'partial': 'Parcial', 'not_met': 'No cumple', 'unknown': 'Sin información'}
EDU_STATUS = {'completed': 'Completa', 'in_progress': 'En curso', 'incomplete': 'Incompleta', 'unknown': ''}
READABILITY = {'good': 'Buena', 'partial': 'Parcial', 'poor': 'Baja'}
_CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
ACCENT = colors.HexColor('#5B21B6')


def esc(value) -> str:
    """Make any untrusted value safe for a reportlab Paragraph."""
    text = '' if value is None else str(value)
    text = _CTRL.sub('', text)
    text = text.encode('cp1252', 'replace').decode('cp1252')  # Helvetica = WinAnsi
    return xml_escape(text)


def _styles():
    base = getSampleStyleSheet()
    return {
        'title': ParagraphStyle('t', parent=base['Title'], fontName='Helvetica-Bold', fontSize=18,
                                textColor=ACCENT, alignment=TA_LEFT, spaceAfter=2),
        'h2': ParagraphStyle('h2', parent=base['Heading2'], fontName='Helvetica-Bold', fontSize=11,
                             textColor=ACCENT, spaceBefore=10, spaceAfter=4),
        'body': ParagraphStyle('b', parent=base['BodyText'], fontName='Helvetica', fontSize=9, leading=12),
        'small': ParagraphStyle('s', parent=base['BodyText'], fontName='Helvetica', fontSize=8,
                                leading=10, textColor=colors.HexColor('#444444')),
        'score': ParagraphStyle('sc', parent=base['Title'], fontName='Helvetica-Bold', fontSize=28,
                                textColor=ACCENT, alignment=TA_LEFT),
        'warn': ParagraphStyle('w', parent=base['BodyText'], fontName='Helvetica-Bold', fontSize=9,
                               leading=12, textColor=colors.HexColor('#92400E')),
    }


def _bullets(items, style):
    return [Paragraph('&bull; ' + esc(i), style) for i in items if i]


SIMULATED_NOTICE = 'DATOS SIMULADOS - modo de prueba'


def _make_footer(simulated: bool):
    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 7.5)
        canvas.setFillColor(colors.HexColor('#555555'))
        canvas.drawString(15 * mm, 10 * mm, DISCLAIMER)
        canvas.drawRightString(A4[0] - 15 * mm, 10 * mm, f'Página {doc.page}')
        if simulated:
            canvas.setFont('Helvetica-Bold', 8)
            canvas.setFillColor(colors.HexColor('#B91C1C'))
            canvas.drawString(15 * mm, 6 * mm, SIMULATED_NOTICE)
        canvas.restoreState()
    return _footer


def build(item) -> bytes:
    result = item.result or {}
    report = result.get('report') or {}
    computed = result.get('computed') or {}
    st = _styles()
    story = []

    cand = report.get('candidate') or {}
    name = cand.get('full_name') or item.candidate_name or 'Candidato sin nombre'
    story.append(Paragraph('Reporte de candidato', st['small']))
    story.append(Paragraph(esc(name), st['title']))
    if report.get('headline'):
        story.append(Paragraph(esc(report['headline']), st['body']))
    meta = [f'Análisis: {esc(item.analysis.name)}',
            f'Fecha: {timezone.localdate().strftime("%d/%m/%Y")}',
            f'Archivo original: {esc(item.original_name)}']
    story.append(Paragraph(' &nbsp;|&nbsp; '.join(meta), st['small']))
    story.append(Spacer(1, 6))

    warnings = []
    if report.get('readability') in ('partial', 'poor'):
        warnings.append('Legibilidad del archivo: ' + READABILITY[report['readability']]
                        + '. La ficha puede estar incompleta; revisa el CV original.')
    if report.get('injection_suspected') or item.injection_suspected:
        warnings.append('El CV contiene texto dirigido a una IA: revisar manualmente.')
    for w in warnings:
        story.append(Paragraph(esc(w), st['warn']))

    years = computed.get('experience_years')
    years_txt = ''
    if years is not None:
        years_txt = ('aprox. ' if computed.get('experience_source') == 'ai_estimate' else '') + f"{years:g} {'año' if years == 1 else 'años'}"
    rows = [
        ['Correo', cand.get('email')], ['Teléfono', cand.get('phone')],
        ['Ubicación', cand.get('location')], ['Experiencia total', years_txt],
        ['Enlaces', ', '.join(cand.get('links') or [])],
    ]
    table = Table(
        [[Paragraph(f'<b>{esc(k)}</b>', st['body']), Paragraph(esc(v), st['body'])] for k, v in rows if v],
        colWidths=[35 * mm, 140 * mm],
    )
    table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                               ('TOPPADDING', (0, 0), (-1, -1), 2)]))
    story.append(table)

    if report.get('summary'):
        story.append(Paragraph('Resumen', st['h2']))
        story.append(Paragraph(esc(report['summary']), st['body']))

    evaluation = report.get('evaluation')
    if computed.get('score') is not None:
        story.append(Paragraph('Evaluación frente al puesto', st['h2']))
        story.append(Paragraph(f'{int(computed["score"])} / 100', st['score']))
        rec = REC_LABEL.get(computed.get('recommendation'), '')
        caps = computed.get('caps') or []
        story.append(Paragraph(f'Sugerencia: <b>{esc(rec)}</b> (orientativa)', st['body']))
        if caps:
            labels = {'mandatory_not_met': 'no cumple un requisito obligatorio',
                      'injection_suspected': 'texto dirigido a una IA en el CV',
                      'poor_readability': 'archivo poco legible'}
            story.append(Paragraph('Se limitó a «Revisar» por: ' + esc(', '.join(labels.get(c, c) for c in caps)),
                                   st['small']))
        reqs = computed.get('requirements') or []
        if reqs:
            data = [[Paragraph('<b>Requisito</b>', st['body']), Paragraph('<b>Estado</b>', st['body']),
                     Paragraph('<b>Evidencia según el CV</b>', st['body'])]]
            for r in reqs:
                label = esc(r['text']) + (' <i>(obligatorio)</i>' if r.get('weight', 1) > 1 else '')
                data.append([Paragraph(label, st['body']), Paragraph(esc(REQ_STATUS.get(r['status'], '')), st['body']),
                             Paragraph(esc(r.get('evidence')), st['small'])])
            t = Table(data, colWidths=[65 * mm, 25 * mm, 85 * mm], repeatRows=1)
            t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#CCCCCC')),
                                   ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#EDE9FE')),
                                   ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
            story.append(Spacer(1, 4))
            story.append(t)
        if evaluation:
            if evaluation.get('strengths'):
                story.append(Paragraph('Fortalezas', st['h2']))
                story.extend(_bullets(evaluation['strengths'], st['body']))
            if evaluation.get('gaps'):
                story.append(Paragraph('Brechas', st['h2']))
                story.extend(_bullets(evaluation['gaps'], st['body']))

    if report.get('experience'):
        story.append(Paragraph('Experiencia', st['h2']))
        for e in report['experience']:
            period = f'{e.get("start") or "?"} - {"actual" if e.get("is_current") else (e.get("end") or "?")}'
            story.append(Paragraph(f'<b>{esc(e.get("role"))}</b> - {esc(e.get("company"))} ({esc(period)})',
                                   st['body']))
            if e.get('description'):
                story.append(Paragraph(esc(e['description']), st['small']))
            story.append(Spacer(1, 3))
    if report.get('education'):
        story.append(Paragraph('Formación', st['h2']))
        for e in report['education']:
            extra = ', '.join(x for x in (e.get('field'), EDU_STATUS.get(e.get('status'), ''),
                                          str(e['end_year']) if e.get('end_year') else '') if x)
            story.append(Paragraph(f'<b>{esc(e.get("degree"))}</b> - {esc(e.get("institution"))}'
                                   + (f' ({esc(extra)})' if extra else ''), st['body']))
    if report.get('skills'):
        story.append(Paragraph('Habilidades', st['h2']))
        story.append(Paragraph(esc(', '.join(report['skills'])), st['body']))
    if report.get('certifications'):
        story.append(Paragraph('Certificaciones', st['h2']))
        story.extend(_bullets(
            [' - '.join(x for x in (c.get('name'), c.get('issuer'), str(c['year']) if c.get('year') else '') if x)
             for c in report['certifications']], st['body']))
    if report.get('languages'):
        story.append(Paragraph('Idiomas', st['h2']))
        story.append(Paragraph(esc(', '.join(
            f'{l.get("language")}' + (f' ({l["level"]})' if l.get('level') else '') for l in report['languages'])),
            st['body']))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm,
                            bottomMargin=18 * mm, title='Reporte de candidato', author='SYSPCC')
    footer = _make_footer(bool((result.get('meta') or {}).get('simulated')))
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
