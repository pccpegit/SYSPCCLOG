"""
Import the "INVENTARIO PCC - ALM" workbook from the command line (SYSPCC-025).

Uses the SAME pipeline as the REST endpoints (parser -> planner -> applier), so the
validations, the preview and the idempotency are identical. It prints counters and
problem CODES only: never worker names, destinations or cell values.

    python manage.py import_warehouse_excel libro.xlsx --dry-run
    python manage.py import_warehouse_excel libro.xlsx --user almacen@pcc.com.pe \
        --project-map "ON PLANT=ON-PLANT" --accept-warnings --accept-skipped-rows
"""
import re
from collections import defaultdict
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from apps.core.models import Project
from apps.warehouse.permissions import CanImportInventory
from apps.warehouse.services.imports import parser, service
from apps.warehouse.services.imports.errors import ImportRejected
from apps.warehouse.services.imports.problems import SEVERITY_LABELS

SAMPLE_ROWS = 5


class Command(BaseCommand):
    help = 'Importa el libro de inventario del almacén (previsualiza y, sin --dry-run, confirma).'

    def add_arguments(self, arg_parser):
        arg_parser.add_argument('path', help='Ruta del libro .xlsx')
        arg_parser.add_argument('--user', help='Correo o usuario que registra la importación (rol Almacén Central o Jefe Logístico).')
        arg_parser.add_argument('--warehouse', default='CENTRAL')
        arg_parser.add_argument('--project-map', action='append', default=[], metavar='ETIQUETA=CODIGO_O_ID',
                                help='Proyecto del sistema para una etiqueta de PROYECTO (repetible).')
        arg_parser.add_argument('--create-projects', action='store_true', help='Crea los proyectos que no existan.')
        arg_parser.add_argument('--skip-projects', action='store_true', help='Deja los ítems sin proyecto.')
        arg_parser.add_argument('--update-existing', action='store_true')
        arg_parser.add_argument('--dry-run', action='store_true', help='Solo previsualiza; no escribe nada.')
        arg_parser.add_argument('--accept-warnings', action='store_true')
        arg_parser.add_argument('--accept-skipped-rows', action='store_true')

    # -- entry ---------------------------------------------------------------------

    def handle(self, *args, **options):
        data, name = self._read(options['path'])
        upload = service.BytesUpload(name, data)
        try:
            if options['dry_run']:
                plan, sha = service.dry_run(
                    upload, warehouse=options['warehouse'], update_existing=options['update_existing'],
                )
                self._report(plan, sha)
                self.stdout.write('Modo --dry-run: no se escribió nada.')
                return
            self._import(upload, options)
        except ImportRejected as exc:
            raise CommandError(f'{exc.code}: {exc.message}') from None

    # -- helpers -------------------------------------------------------------------

    @staticmethod
    def _read(path_arg):
        path = Path(path_arg)
        if not path.is_file():
            raise CommandError('El archivo indicado no existe.')
        with path.open('rb') as handle:
            data = handle.read(parser.MAX_UPLOAD_BYTES + 1)
        return data, path.name

    @staticmethod
    def _user(identifier):
        if not identifier:
            raise CommandError('Indique --user (correo o usuario) para registrar la importación.')
        user_model = get_user_model()
        user = user_model.objects.filter(
            Q(email__iexact=identifier) | Q(username__iexact=identifier), is_active=True,
        ).first()
        if user is None:
            raise CommandError('No existe un usuario activo con ese correo o usuario.')
        if not user.user_roles.filter(role__in=CanImportInventory.ALLOWED_ROLES).exists():
            raise CommandError('El usuario necesita el rol Almacén Central o Jefe Logístico.')
        return user

    def _import(self, upload, options):
        user = self._user(options['user'])
        imp = service.create_preview(
            uploaded_file=upload, user=user, warehouse=options['warehouse'],
            update_existing=options['update_existing'],
        )
        try:
            plan = service.build_plan_from_bytes(
                bytes(imp.file_bytes), warehouse=imp.warehouse,
                update_existing=options['update_existing'], file_sha256=imp.file_sha256,
            )
            self._report(plan, imp.file_sha256)
            if not plan.can_confirm:
                raise CommandError('El libro tiene problemas bloqueantes; no se importó nada.')
            project_map = self._project_map(plan, options)
        except (CommandError, ImportRejected):
            service.cancel_import(imp.pk)
            raise
        try:
            imp, _replay = service.confirm_import(
                imp.pk, user, expected_plan_digest=imp.plan_digest, project_map=project_map,
                destination_map={}, accept_warnings=options['accept_warnings'],
                accept_skipped_rows=options['accept_skipped_rows'],
            )
        except ImportRejected as exc:
            service.cancel_import(imp.pk)
            raise CommandError(f'{exc.code}: {exc.message}') from None
        result = imp.result
        self.stdout.write(self.style.SUCCESS(
            'Importación confirmada: '
            f"catálogo creado={result['catalog']['created']} actualizado={result['catalog']['updated']}; "
            f"ingresos={result['movements']['entries']} egresos={result['movements']['exits']} "
            f"carga inicial={result['movements']['initial']}; stock total={result['stock_total']}; "
            f"conciliado={result['reconciled']}"
        ))

    def _project_map(self, plan, options) -> dict:
        explicit = {}
        for entry in options['project_map']:
            label, sep, target = entry.partition('=')
            if not sep or not target.strip():
                raise CommandError('--project-map debe tener la forma ETIQUETA=CODIGO_O_ID.')
            explicit[parser.normalize_label(label)] = target.strip()

        resolved, missing = {}, []
        for key, info in plan.project_labels.items():
            if options['skip_projects']:
                resolved[info['label']] = None
                continue
            target = explicit.get(key)
            project = self._find_project(target) if target else None
            if project is None and not target and len(plan.project_matches.get(key, [])) == 1:
                project = Project.objects.get(pk=plan.project_matches[key][0]['id'])
            if project is None and options['create_projects']:
                project = self._create_project(target or info['label'], info['label'])
            if project is None:
                missing.append(info['label'])
                continue
            resolved[info['label']] = project.pk
        if missing:
            raise CommandError(
                'Falta el proyecto para: ' + ', '.join(missing)
                + '. Use --project-map, --create-projects o --skip-projects.'
            )
        return resolved

    @staticmethod
    def _find_project(target):
        if str(target).isdigit():
            return Project.objects.filter(pk=int(target), is_active=True).first()
        return Project.objects.filter(code__iexact=target, is_active=True).first()

    @staticmethod
    def _create_project(code_hint, label):
        code = re.sub(r'[^A-Z0-9]+', '-', code_hint.upper()).strip('-')[:20] or 'PROYECTO'
        project, _created = Project.objects.get_or_create(code=code, defaults={'name': label})
        return project

    def _report(self, plan, sha):
        summary = plan.summary()
        write = self.stdout.write
        write(f'Huella del libro: {sha[:16]}')
        write('Hojas leídas: ' + ', '.join(f'{k}={v["rows"]}' for k, v in summary['sheets'].items()))
        c = summary['catalog']
        write(f"Catálogo: nuevos={c['new']} existentes={c['existing']} por actualizar={c['to_update']} conflictos={c['conflicts']}")
        i = summary['initial_loads']
        write(f"Carga inicial: a importar={i['to_import']} ya importadas={i['already_imported']}")
        for label, key in (('Ingresos', 'entries'), ('Egresos', 'exits')):
            m = summary[key]
            write(
                f"{label}: a importar={m['to_import']} omitidas por error={m['skipped_error']} "
                f"ya importadas={m['already_imported']} vales={m['groups']}"
            )
        s = summary['stock']
        write(
            f"Stock: proyectado={s['projected_total']} libro={s['sheet_total']} "
            f"ítems distintos={s['mismatched_items']} ítems negativos={s['negative_items']}"
        )
        counts = summary['counts']
        write('Problemas: ' + ' '.join(f'{SEVERITY_LABELS[k].lower()}s={v}' for k, v in counts.items()))

        samples = defaultdict(list)
        for problem in plan.sorted_problems():
            if problem.row is not None and len(samples[problem.code]) < SAMPLE_ROWS:
                samples[problem.code].append(f'{problem.sheet}:{problem.row}')
        severity_of = {p.code: p.severity for p in plan.problems}
        for code, count in summary['by_code'].items():
            rows = ', '.join(samples.get(code, []))
            write(f'  {code} [{severity_of[code]}] x{count}' + (f'  filas: {rows}' if rows else ''))

        for project in summary['projects']:
            write(f"Proyecto del libro: {project['label']} ({project['items']} ítems), coincidencias={len(project['matches'])}")
        write(f"Destinos sin vincular a Personal: {len(summary['unmatched_destinations'])} (no se muestran nombres)")
        req = summary['requires']
        write(f"Requiere aceptar advertencias={'sí' if req['accept_warnings'] else 'no'}; "
              f"aceptar filas omitidas={'sí' if req['accept_skipped_rows'] else 'no'}")
        write(f"Se puede confirmar: {'sí' if plan.can_confirm else 'no'}")
