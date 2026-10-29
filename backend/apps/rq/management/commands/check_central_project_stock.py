"""SYSPCC-026 · Fase 0 — Diagnóstico de SOLO LECTURA del stock CENTRAL atado a proyecto.

    python manage.py check_central_project_stock [--json] [--limit N] [--fail-on-findings]

Lista las filas de InventoryStock del almacén CENTRAL con `project` o `department` no
nulos. Esas filas no forman parte del pool central (project=NULL, department=NULL), así
que el despacho automático corregido de la Fase 3 (que descontará del pool) no las
consumirá. Úsalo ANTES de activar esa corrección.

Nunca escribe en la base de datos (solo SELECT). `--dry-run` se acepta por compatibilidad.
"""
import json

from django.core.management.base import BaseCommand, CommandError

from apps.rq.services.stock_diagnostics import central_scoped_stock, json_default


class Command(BaseCommand):
    help = (
        'SOLO LECTURA. Lista filas de stock del almacén CENTRAL atadas a un proyecto o '
        'departamento (fuera del pool central), que el despacho automático no consume.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Aceptado por compatibilidad: este comando nunca escribe en la base de datos.',
        )
        parser.add_argument('--json', action='store_true', dest='as_json',
                            help='Imprime solo JSON (resumen y todas las filas).')
        parser.add_argument('--limit', type=int, default=200,
                            help='Máximo de filas en la tabla de texto (0 = todas). Por defecto 200.')
        parser.add_argument('--fail-on-findings', action='store_true',
                            help='Termina con error (código 1) si hay al menos una fila.')

    def handle(self, *args, **options):
        result = central_scoped_stock()
        rows, summary = result['rows'], result['summary']

        if options['as_json']:
            self.stdout.write(json.dumps(result, default=json_default, ensure_ascii=False, indent=2))
        else:
            self._print_text(rows, summary, options['limit'])

        if options['fail_on_findings'] and rows:
            raise CommandError(
                f'Se encontraron {len(rows)} filas CENTRAL atadas a proyecto/departamento.'
            )

    def _print_text(self, rows, summary, limit):
        out = self.stdout.write
        out('check_central_project_stock — SOLO LECTURA (no modifica la base de datos)')
        if not rows:
            out(self.style.SUCCESS(
                'OK: no hay filas CENTRAL atadas a proyecto ni departamento; todo el stock '
                'central está en el pool.'
            ))
            return

        out(f'Filas CENTRAL atadas a proyecto/departamento: {summary["total_rows"]} '
            f'(cantidad > 0: {summary["positive_rows"]}, cantidad = 0: {summary["zero_rows"]}).')
        out(f'Productos distintos: {summary["distinct_products"]} · proyectos: '
            f'{summary["distinct_projects"]} · departamentos: {summary["distinct_departments"]}.')
        if summary['positive_units_by_unit']:
            units = ', '.join(f'{u or "s/u"}={q}' for u, q in summary['positive_units_by_unit'].items())
            out(f'Stock fuera del pool, por unidad de medida: {units}.')
        out('')

        shown = rows if limit <= 0 else rows[:limit]
        out(f'{"CÓDIGO":<16}{"DESCRIPCIÓN":<34}{"ÁMBITO":<26}{"CANT.":>12}  {"POOL":>12}')
        for r in shown:
            scope = ' / '.join(x for x in (
                f'PROY {r["project_code"]}' if r['project_code'] else '',
                f'DEPTO {r["department_code"]}' if r['department_code'] else '',
            ) if x)
            pool = '—' if r['pool_quantity'] is None else str(r['pool_quantity'])
            out(f'{r["product_code"][:15]:<16}{r["description"][:32]:<34}{scope[:25]:<26}'
                f'{str(r["quantity"]):>12}  {pool:>12}')
        if len(shown) < len(rows):
            out(f'... y {len(rows) - len(shown)} filas más (usa --limit 0 para verlas todas).')

        out('')
        out('Cómo leerlo:')
        out('  - Estas filas NO son parte del pool central. Al corregir el despacho (Fase 3) las '
            'salidas descontarán del pool y no las tocarán.')
        out('  - Cantidad = 0: fila agotada o vacía; no hay stock que mover.')
        out('  - Cantidad > 0: stock real fuera del pool. Antes de activar la Fase 3 decide, fila '
            'por fila, si se traspasa al pool con un ajuste documentado de almacén.')
