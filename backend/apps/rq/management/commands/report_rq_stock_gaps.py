"""SYSPCC-026 · Fase 0 — Evidencia del bug R1 y de vínculos sin confirmar (SOLO LECTURA).

    python manage.py report_rq_stock_gaps [--json] [--limit N] [-v 2] [--fail-on-findings]
                                          [--include-terminal] [--fail-on-unconfirmed]

Reporta los RQs OPERATIONS con proyecto que ya fueron "despachados" (Approval DISPATCHED
o estado posterior al despacho) y cuyo despacho automático no generó movimiento de
almacén: sin WarehouseDispatch y sin salida "Despacho automático RQ …".

R1 (corregido en SYSPCC-028): el despacho automático descontaba de la fila CENTRAL +
proyecto, mientras las recepciones ingresan al pool central (project=NULL). La salida fallaba
con "Stock insuficiente", el error se reducía a un warning y el RQ avanzaba igual. Desde
SYSPCC-028 el despacho descuenta del pool, así que este reporte sirve para los RQs HISTÓRICOS
(despachados antes del arreglo, que no se reprocesan solos) y para ver cuántos ítems de cada
RQ moverían stock hoy (ÍTEMS = con vínculo / total; columna CONF = vínculos confirmados).
Ver `apps/rq/services/stock_diagnostics.py`.

El indicio se calcula con el stock ACTUAL: es una pista, no una prueba.

Segunda sección: ítems con producto de catálogo (`inventory_item`) que Logística NO confirmó
(`inventory_item_confirmed_at` nulo). El solicitante puede proponer el producto al crear el
RQ; desde SYSPCC-028 el motor ignora el vínculo propuesto hasta que Logística lo confirme
(esos ítems no mueven stock). Esta lista es lo que hay que revisar o confirmar en bloque
(incluye vínculos de seeds e históricos). Por defecto solo RQs no terminales.

Nunca escribe en la base de datos (solo SELECT). `--dry-run` se acepta por compatibilidad.
"""
import json

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.rq.services.stock_diagnostics import (
    VERDICT_LABELS,
    dispatched_requests_without_movement,
    json_default,
    unconfirmed_catalog_links,
)


class Command(BaseCommand):
    help = (
        'SOLO LECTURA. Reporta RQs OPS con proyecto despachados cuyo despacho automático no '
        'generó movimiento de almacén (evidencia del bug R1, histórico) y los ítems con producto de '
        'catálogo propuesto que Logística no confirmó.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Aceptado por compatibilidad: este comando nunca escribe en la base de datos.',
        )
        parser.add_argument('--json', action='store_true', dest='as_json',
                            help='Imprime solo JSON (resumen, filas y evidencia por ítem).')
        parser.add_argument('--limit', type=int, default=100,
                            help='Máximo de filas en cada tabla de texto (0 = todas). Por defecto 100.')
        parser.add_argument('--fail-on-findings', action='store_true',
                            help='Termina con error (código 1) si hay al menos un RQ con indicio de R1.')
        parser.add_argument('--include-terminal', action='store_true',
                            help='En la sección de vínculos sin confirmar, incluye también los RQs '
                                 'cerrados, cancelados y rechazados (por defecto solo los abiertos).')
        parser.add_argument('--fail-on-unconfirmed', action='store_true',
                            help='Termina con error (código 1) si hay al menos un ítem con producto '
                                 'de catálogo sin confirmar por Logística.')

    def handle(self, *args, **options):
        result = dispatched_requests_without_movement()
        rows, summary = result['rows'], result['summary']
        unconfirmed = unconfirmed_catalog_links(include_terminal=options['include_terminal'])

        if options['as_json']:
            payload = {**result, 'unconfirmed_links': unconfirmed}
            self.stdout.write(json.dumps(payload, default=json_default, ensure_ascii=False, indent=2))
        else:
            self._print_text(rows, summary, options['limit'], options['verbosity'])
            self._print_unconfirmed(unconfirmed, options['limit'])

        if options['fail_on_findings'] and summary['r1_evidence_requests']:
            raise CommandError(
                f'{summary["r1_evidence_requests"]} RQs con indicio de R1 (despacho sin movimiento).'
            )
        if options['fail_on_unconfirmed'] and unconfirmed['summary']['total_items']:
            raise CommandError(
                f'{unconfirmed["summary"]["total_items"]} ítems con producto de catálogo sin '
                'confirmar por Logística.'
            )

    def _print_text(self, rows, summary, limit, verbosity):
        out = self.stdout.write
        out('report_rq_stock_gaps — SOLO LECTURA (no modifica la base de datos)')
        if not rows:
            out(self.style.SUCCESS(
                'OK: no hay RQs OPS con proyecto despachados sin movimiento de almacén.'
            ))
            return

        out(f'RQs OPS con proyecto despachados sin movimiento: {summary["total_requests"]}.')
        out('Por indicio:')
        for verdict, label in VERDICT_LABELS.items():
            count = summary['by_verdict'][verdict]
            if count:
                out(f'  {verdict}: {count} — {label}')
        out('')

        shown = rows if limit <= 0 else rows[:limit]
        out(f'{"RQ":<16}{"PROYECTO":<14}{"ESTADO":<22}{"DESPACHADO":<18}{"ÍTEMS":<20}INDICIO')
        for r in shown:
            when = '—'
            if r['dispatch_approved_at']:
                when = timezone.localtime(r['dispatch_approved_at']).strftime('%Y-%m-%d %H:%M')
            items = f'{r["items_linked"]}/{r["items_total"]} ({r["items_confirmed"]} conf.)'
            out(f'{r["rq_number"][:15]:<16}{r["project_code"][:13]:<14}{r["status"][:21]:<22}'
                f'{when:<18}{items:<20}{r["verdict"]}')
            if verbosity >= 2:
                for it in r['items']:
                    proj = '—' if it['project_row_quantity'] is None else it['project_row_quantity']
                    pool = '—' if it['pool_quantity'] is None else it['pool_quantity']
                    out(f'    línea {it["line_number"]} {it["product_code"]}: pedido {it["requested"]} · '
                        f'fila del proyecto {proj} · pool central {pool}')
        if len(shown) < len(rows):
            out(f'... y {len(rows) - len(shown)} RQs más (usa --limit 0 para verlos todos).')

        out('')
        out('Cómo leerlo:')
        out('  - ÍTEMS = ítems con inventory_item / total de ítems del RQ (entre paréntesis, los '
            'vínculos confirmados por Logística: solo esos mueven stock).')
        out('  - R1_PROBABLE es la evidencia histórica: había stock en el pool pero el despacho '
            'de entonces lo buscó en la fila del proyecto. El arreglo (SYSPCC-028) no reprocesa '
            'esos RQs: requieren un ajuste o despacho manual del almacén.')
        out('  - El indicio usa el stock de HOY, no el de la fecha del despacho. Usa -v 2 para ver '
            'la cantidad por ítem.')

    def _print_unconfirmed(self, result, limit):
        out = self.stdout.write
        rows, summary = result['rows'], result['summary']
        out('')
        out('Vínculos de catálogo propuestos y SIN confirmar por Logística')
        scope = 'todos los RQs' if summary['include_terminal'] else 'RQs abiertos (no terminales)'
        if not rows:
            out(self.style.SUCCESS(f'OK: no hay ítems con producto de catálogo sin confirmar en {scope}.'))
            return

        out(f'{summary["total_items"]} ítems en {summary["total_requests"]} RQs ({scope}).')
        flows = ', '.join(f'{flow}: {count}' for flow, count in summary['by_flow'].items())
        out(f'Por flujo: {flows}.')
        shown = rows if limit <= 0 else rows[:limit]
        out(f'{"RQ":<16}{"ÁMBITO":<14}{"ESTADO":<22}{"LÍNEA":<7}{"CÓDIGO":<18}DESCRIPCIÓN DEL ÍTEM')
        for r in shown:
            out(f'{r["rq_number"][:15]:<16}{r["scope_code"][:13]:<14}{r["status"][:21]:<22}'
                f'{r["line_number"]:<7}{r["product_code"][:17]:<18}{r["description"][:60]}')
        if len(shown) < len(rows):
            out(f'... y {len(rows) - len(shown)} ítems más (usa --limit 0 para verlos todos).')

        out('')
        out('Cómo leerlo:')
        out('  - El producto lo propuso el solicitante (o un seed/admin) y Logística no lo confirmó '
            'en la verificación de stock.')
        out('  - El motor NO mueve stock con un vínculo sin confirmar (ni al recibir ni al despachar). '
            'Revise esta lista y confirme los vínculos que correspondan antes de que el RQ '
            'llegue a RECEIVED o DISPATCHED.')
        out('  - Usa --include-terminal para ver también los RQs cerrados, cancelados y rechazados.')
