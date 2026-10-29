"""SYSPCC-026 · Fase 0/1 — Sugerencias de vínculo RQ ↔ catálogo (SOLO LECTURA).

    python manage.py suggest_inventory_links [--dry-run] [--json] [--limit N] [-v 2]
                                             [--rq RQ-2026-0001] [--include-terminal]

Lista los ítems de RQ sin producto de catálogo ni marca "fuera de catálogo" y, cuando hay
una coincidencia EXACTA (código completo o descripción completa), el producto que
podría corresponderle. Nunca vincula nada: el comando no tiene ninguna opción que escriba.
Logística confirma cada vínculo en la verificación de stock, que deja el sello de quién y
cuándo. Ver `apps/rq/services/link_suggestions.py` para las reglas de coincidencia.

Es el insumo para vincular los RQs en vuelo antes de activar la Fase 3 (despacho solo con
vínculos confirmados). `--dry-run` se acepta por compatibilidad: siempre es de solo lectura.
"""
import json

from django.core.management.base import BaseCommand

from apps.rq.services.link_suggestions import (
    STATUS_AMBIGUOUS,
    STATUS_NO_MATCH,
    STATUS_SUGGESTED,
    suggest_catalog_links,
)
from apps.rq.services.stock_diagnostics import json_default


class Command(BaseCommand):
    help = (
        'SOLO LECTURA. Propone, sin aplicar, el producto de catálogo de los ítems de RQ que '
        'no tienen vínculo, solo por coincidencia exacta de código o de descripción.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Aceptado por compatibilidad: este comando nunca escribe en la base de datos.',
        )
        parser.add_argument('--json', action='store_true', dest='as_json',
                            help='Imprime solo JSON (resumen y todas las filas, con sus candidatos).')
        parser.add_argument('--limit', type=int, default=100,
                            help='Máximo de filas en la tabla de texto (0 = todas). Por defecto 100.')
        parser.add_argument('--rq', dest='rq_number', default=None,
                            help='Limita a un RQ (número exacto, p. ej. RQ-2026-0001).')
        parser.add_argument('--include-terminal', action='store_true',
                            help='Incluye también los RQs cerrados, cancelados y rechazados '
                                 '(histórico). Por defecto solo los abiertos.')

    def handle(self, *args, **options):
        result = suggest_catalog_links(
            include_terminal=options['include_terminal'], rq_number=options['rq_number'],
        )
        if options['as_json']:
            self.stdout.write(json.dumps(result, default=json_default, ensure_ascii=False, indent=2))
            return
        self._print_text(result, options['limit'], options['verbosity'])

    def _print_text(self, result, limit, verbosity):
        out = self.stdout.write
        rows, summary = result['rows'], result['summary']
        scope = 'todos los RQs' if summary['include_terminal'] else 'RQs abiertos (no terminales)'
        out('suggest_inventory_links — SOLO LECTURA (no vincula nada: Logística confirma cada '
            'vínculo en la verificación de stock)')
        if not rows:
            out(self.style.SUCCESS(
                f'OK: no hay ítems sin producto de catálogo ni marca de fuera de catálogo ({scope}).'
            ))
            return

        out(f'Ítems sin producto de catálogo ni marca de fuera de catálogo: {summary["total_items"]} '
            f'en {summary["total_requests"]} RQs ({scope}).')
        out(f'  Con sugerencia: {summary["suggested"]} · Ambiguos: {summary["ambiguous"]} · '
            f'Sin coincidencia: {summary["no_match"]}')
        out('')

        # Sin coincidencia no se lista salvo con -v 2: no hay nada que proponer y taparía el resto.
        listed = [r for r in rows if r['status'] != STATUS_NO_MATCH or verbosity >= 2]
        if not listed:
            out(f'Ninguno tiene sugerencia: los {summary["no_match"]} ítems no coinciden con '
                'ningún producto. Usa -v 2 para verlos; se vinculan a mano con el buscador de '
                'catálogo o se marcan fuera de catálogo.')
            return
        shown = listed if limit <= 0 else listed[:limit]
        out(f'{"RQ":<16}{"LÍN":<5}{"RESULTADO":<18}{"SUGERENCIA":<20}{"BASE":<20}DESCRIPCIÓN DEL ÍTEM')
        for r in shown:
            if r['status'] == STATUS_SUGGESTED:
                suggestion = r['candidates'][0]['product_code']
            elif r['status'] == STATUS_AMBIGUOUS:
                suggestion = f'{len(r["candidates"])} candidatos'
            else:
                suggestion = '—'
            flag = '  [UNIDAD DISTINTA]' if r['unit_mismatch'] else ''
            out(f'{r["rq_number"][:15]:<16}{r["line_number"]:<5}{r["status"]:<18}'
                f'{suggestion[:19]:<20}{(r["basis"] or "—"):<20}{r["description"][:60]}{flag}')
            if r['status'] == STATUS_AMBIGUOUS or verbosity >= 2:
                for cand in r['candidates']:
                    out(f'    candidato: {cand["product_code"]} — {cand["description"]} ({cand["unit"]})')
        if len(shown) < len(listed):
            out(f'... y {len(listed) - len(shown)} ítems más (usa --limit 0 para verlos todos).')

        out('')
        out('Cómo leerlo:')
        out('  - SUGERIDO: coincidencia exacta con un único producto. Es una propuesta, no un '
            'vínculo: Logística debe confirmarla en la verificación de stock.')
        out('  - AMBIGUO: más de un producto cumple (o el código y la descripción apuntan a '
            'productos distintos). No se elige ninguno.')
        out('  - SIN_COINCIDENCIA no se lista (usa -v 2): el ítem se vincula a mano con el '
            'buscador de catálogo o se marca fuera de catálogo.')
        out('  - [UNIDAD DISTINTA]: la unidad del ítem no es la del catálogo; revisar antes de confirmar.')
        out('  - Nunca se propone por coincidencia parcial: "Casco" no propone "Casco de seguridad".')
