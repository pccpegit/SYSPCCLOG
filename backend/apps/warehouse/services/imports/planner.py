"""
Import planner (SYSPCC-025): parsed workbook + current database state -> ``ImportPlan``.

The planner is READ-ONLY: it never writes to the database. The preview stores its
summary/problems/digest; the confirmation recomputes it (same function, same
workbook bytes) and compares the digest to detect that the data changed in between.

Semantics (from the contract):

* Catalog = ``MATRIZ DE RECURSOS`` (or the summary sheet of a SYSPCC export).
* The stock goes to the central pool ``(warehouse, project=None, department=None)``.
* All entries are applied before the exits; initial loads (INV. INICIAL) first.
* Grouping into vales: exits with a vale number -> one group per
  ``(vale, date, destination)``; exits without vale -> one group per row; entries ->
  one group per ``(date, po, guide, transfer)``; undated entries -> one per row.
* Row idempotency: ``source_key`` = sha256 of the row's identifying fields plus its
  occurrence among identical rows of the file. Rows whose key already exists are
  skipped, so re-importing a book (or a longer version of it) never duplicates.
* Nothing is invented: empty dates stay empty, empty vales stay empty, locations
  that only say "PISO 2" stay "pending to locate".
"""
import hashlib
import json
from collections import Counter, OrderedDict, defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from django.db.models.functions import Trim, Upper
from django.utils import timezone

from apps.core.models import Project
from apps.warehouse.models import Inventory, InventoryMovement, InventoryStock, MovementGroup
from apps.warehouse.models.inventory import MAX_STOCK_QUANTITY
from apps.warehouse.services import catalog, locations
from apps.warehouse.services.epp import requires_integer_quantity
from apps.warehouse.services.imports import parser, validators
from apps.warehouse.services.imports.problems import (
    BLOCKER, ERROR, SEVERITIES, SEVERITY_RANK, WARNING, Problem, make_problem,
)
from apps.warehouse.services.personal_matching import (
    AMBIGUOUS, MATCHED, PersonalIndex, destination_key,
)

MAX_STORED_PROBLEMS = 5000
MAX_LISTED_DESTINATIONS = 500
CHUNK = 500
ZERO = Decimal('0')

KIND_ENTRY = 'ENTRY'
KIND_EXIT = 'EXIT'
KIND_INITIAL = 'INITIAL'

ACTION_CREATE = 'create'
ACTION_UPDATE = 'update'
ACTION_UNCHANGED = 'unchanged'
ACTION_EXTERNAL = 'external'     # exists in the database but not in the workbook catalog
ACTION_SKIP = 'skip'

_SHEET_RANK = {name: i for i, name in enumerate(parser.SHEET_ORDER)}


# ---------------------------------------------------------------------------
# Plan data structures
# ---------------------------------------------------------------------------

@dataclass
class CatalogEntry:
    code: str
    description: str
    unit: str
    sheet: str = ''
    row: int | None = None
    order_number: str = ''
    purchase_order_ref: str = ''
    packing_list: str = ''
    size: str = ''
    category: str = ''
    item_type: str = ''
    observation: str = ''
    project_key: str = ''
    floor: int | None = None
    location: str = ''
    action: str = ACTION_CREATE
    existing: Inventory | None = None
    changes: dict = field(default_factory=dict)
    db_stock: Decimal = ZERO
    projected: Decimal = ZERO
    sheet_stock: Decimal | None = None


@dataclass
class SummaryInfo:
    row: int
    initial: Decimal | None
    stock: Decimal | None
    location: str
    observation: str
    project: str


@dataclass
class Line:
    kind: str
    sheet: str
    row: int
    code: str
    quantity: Decimal
    date: date | None
    source_key: str
    tag: str = ''
    notes: str = ''
    po: str = ''
    guide: str = ''
    transfer: str = ''
    voucher: str = ''
    destination: str = ''
    dest_key: str = ''
    already: bool = False


@dataclass
class Group:
    kind: str
    key: tuple
    date: date | None
    po: str = ''
    guide: str = ''
    transfer: str = ''
    voucher: str = ''
    destination: str = ''
    dest_key: str = ''
    internal: bool = False
    personal_id: int | None = None
    match_status: str = ''
    lines: list = field(default_factory=list)

    @property
    def first_row(self) -> int:
        return self.lines[0].row


@dataclass
class ImportPlan:
    warehouse: str
    update_existing: bool
    file_sha256: str = ''
    catalog: OrderedDict = field(default_factory=OrderedDict)       # code -> CatalogEntry
    initial_lines: list = field(default_factory=list)
    opening_date: date | None = None
    entry_groups: list = field(default_factory=list)
    exit_groups: list = field(default_factory=list)
    problems: list = field(default_factory=list)
    project_labels: OrderedDict = field(default_factory=OrderedDict)  # key -> {'label','items'}
    project_matches: dict = field(default_factory=dict)
    unmatched_destinations: list = field(default_factory=list)
    sheet_rows: dict = field(default_factory=dict)
    catalog_source: str | None = None
    stats: dict = field(default_factory=dict)

    # -- derived -------------------------------------------------------------

    def counts(self) -> dict:
        counter = Counter(p.severity for p in self.problems)
        return {sev: counter.get(sev, 0) for sev in SEVERITIES}

    @property
    def blockers(self) -> list:
        return [p for p in self.problems if p.severity == BLOCKER]

    @property
    def can_confirm(self) -> bool:
        return not self.blockers

    @property
    def skipped_rows(self) -> int:
        return len({(p.sheet, p.row) for p in self.problems if p.severity == ERROR and p.row is not None})

    def requires(self) -> dict:
        counts = self.counts()
        return {
            'accept_warnings': counts[WARNING] > 0,
            'accept_skipped_rows': self.skipped_rows > 0,
            'project_labels': [v['label'] for v in self.project_labels.values()],
        }

    def sorted_problems(self) -> list:
        return sorted(
            self.problems,
            key=lambda p: (SEVERITY_RANK[p.severity], _SHEET_RANK.get(p.sheet, 99), p.row or 0, p.code),
        )

    def problems_payload(self) -> dict:
        ordered = self.sorted_problems()
        kept = ordered[:MAX_STORED_PROBLEMS]
        return {
            'items': [p.as_dict() for p in kept],
            'total': len(ordered),
            'truncated': len(ordered) > MAX_STORED_PROBLEMS,
        }

    def digest(self) -> str:
        """Fingerprint of everything that determines what ``apply_plan`` would write."""
        def line_keys(group):
            return [ln.source_key for ln in group.lines]

        payload = {
            'file': self.file_sha256,
            'warehouse': self.warehouse,
            'update_existing': self.update_existing,
            'catalog': sorted(
                [e.code, e.action, sorted([k, str(v)] for k, v in e.changes.items())]
                for e in self.catalog.values()
            ),
            'initial': sorted(ln.source_key for ln in self.initial_lines if not ln.already),
            'opening_date': str(self.opening_date or ''),
            'entries': [[str(g.key), line_keys(g)] for g in self.entry_groups],
            'exits': [[str(g.key), g.personal_id or 0, g.internal, line_keys(g)] for g in self.exit_groups],
            'problems': sorted([p.code, p.severity, p.sheet, p.row or 0] for p in self.problems),
            'projects': sorted(self.project_labels),
        }
        raw = json.dumps(payload, sort_keys=True, separators=(',', ':'), default=str)
        return hashlib.sha256(raw.encode()).hexdigest()

    def summary(self) -> dict:
        counts = self.counts()
        by_code = Counter(p.code for p in self.problems)
        stats = self.stats
        return {
            'sheets': {name: {'rows': n} for name, n in self.sheet_rows.items()},
            'catalog_source': self.catalog_source,
            'catalog': {
                'new': stats.get('catalog_new', 0),
                'existing': stats.get('catalog_existing', 0),
                'to_update': stats.get('catalog_to_update', 0),
                'conflicts': stats.get('catalog_conflicts', 0),
            },
            'initial_loads': {
                'to_import': sum(1 for ln in self.initial_lines if not ln.already),
                'already_imported': sum(1 for ln in self.initial_lines if ln.already),
            },
            'entries': self._movement_summary(KIND_ENTRY, parser.SHEET_ENTRIES),
            'exits': self._movement_summary(KIND_EXIT, parser.SHEET_EXITS),
            'stock': {
                'projected_total': float(stats.get('projected_total', ZERO)),
                'sheet_total': float(stats['sheet_total']) if stats.get('sheet_total') is not None else None,
                'mismatched_items': stats.get('mismatched_items', 0),
                'negative_items': stats.get('negative_items', 0),
            },
            'counts': counts,
            'by_code': dict(sorted(by_code.items())),
            # Rows imported before that this book no longer carries (corrected or deleted there).
            # The key of a row is its content, so a corrected row is imported again as a NEW
            # movement and the old one stays: the UI must say so next to the totals.
            'imported_rows_missing': stats.get('imported_rows_missing', 0),
            'skipped_rows': self.skipped_rows,
            'requires': self.requires(),
            'opening_date': self.opening_date.isoformat() if self.opening_date else None,
            'projects': self.projects_payload(),
            'unmatched_destinations': self.unmatched_destinations[:MAX_LISTED_DESTINATIONS],
        }

    def _movement_summary(self, kind: str, sheet: str) -> dict:
        groups = self.entry_groups if kind == KIND_ENTRY else self.exit_groups
        return {
            'to_import': sum(len(g.lines) for g in groups),
            'skipped_error': self.stats.get(f'skipped_{kind}', 0),
            'already_imported': self.stats.get(f'already_{kind}', 0),
            'groups': len(groups),
        }

    def projects_payload(self) -> list:
        payload = []
        for key, info in self.project_labels.items():
            matches = self.project_matches.get(key, [])
            payload.append({
                'label': info['label'],
                'items': info['items'],
                'matches': matches,
                'suggested_id': matches[0]['id'] if len(matches) == 1 else None,
            })
        return payload


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _chunks(values, size=CHUNK):
    values = list(values)
    for i in range(0, len(values), size):
        yield values[i:i + size]


def _fmt_qty(value: Decimal) -> str:
    return format(value.normalize(), 'f')


def make_source_key(warehouse, tag, code, when, quantity, voucher, dest_key, line_tag, occurrence) -> str:
    raw = '|'.join([
        warehouse, tag, code, when.isoformat() if when else '', _fmt_qty(quantity),
        voucher, dest_key, line_tag, str(occurrence),
    ])
    return hashlib.sha256(raw.encode()).hexdigest()


def initial_source_key(warehouse: str, code: str) -> str:
    """One initial load per item and warehouse (the quantity is NOT part of the key)."""
    return hashlib.sha256(f'{warehouse}|INIT|{code}'.encode()).hexdigest()


def is_internal_destination(text: str) -> bool:
    """'ALM - PRIMER PISO' (transfer between floors) is not a person."""
    label = parser.normalize_label(text)
    return label == 'ALM' or label.startswith('ALM ')


def _same_text(a: str, b: str) -> bool:
    return ' '.join((a or '').upper().split()) == ' '.join((b or '').upper().split())


def fetch_existing_items(codes) -> dict:
    """Normalized code -> Inventory (case/space-insensitive on the stored code)."""
    found: dict = {}
    for chunk in _chunks(sorted(codes)):
        qs = (
            Inventory.objects.annotate(code_norm=Upper(Trim('product_code')))
            .filter(code_norm__in=chunk).order_by('pk')
        )
        for item in qs:
            found.setdefault(item.code_norm, item)
    return found


# ---------------------------------------------------------------------------
# Planner
# ---------------------------------------------------------------------------

class _Planner:
    def __init__(self, parsed, warehouse, update_existing, file_sha256, today):
        self.parsed = parsed
        self.today = today or timezone.localdate()
        self.plan = ImportPlan(warehouse=warehouse, update_existing=update_existing, file_sha256=file_sha256)
        self.problems: list[Problem] = self.plan.problems
        self.problems.extend(parsed.problems)
        self.warehouse = warehouse
        self.catalog = self.plan.catalog
        self.summary: dict[str, SummaryInfo] = {}
        self.entry_rows: list = []
        self.exit_rows: list = []
        self.locations_raw: dict[str, list] = defaultdict(list)   # code -> [(rank, sheet, row, text)]
        self.referenced: set = set()
        self.skipped = Counter()

    # -- helpers ---------------------------------------------------------------

    def add(self, problem_code, sheet='', row=None, **params):
        self.problems.append(make_problem(problem_code, sheet=sheet, row=row, **params))

    def add_validation_errors(self, sheet, row, errors):
        for code, detail in errors:
            if code == 'FILA_INVALIDA':
                self.add(code, sheet, row, detail=detail)
            else:
                self.add(code, sheet, row)

    # -- run -------------------------------------------------------------------

    def run(self) -> ImportPlan:
        plan = self.plan
        plan.sheet_rows = {name: len(sheet.rows) for name, sheet in self.parsed.sheets.items()}
        plan.catalog_source = self.parsed.catalog_sheet
        if self.parsed.catalog_sheet is None:
            return self._finish()

        self._read_catalog_and_summary()
        self._read_movements()
        self._resolve_items()
        entry_lines = self._build_lines(self.entry_rows, KIND_ENTRY)
        exit_lines = self._build_lines(self.exit_rows, KIND_EXIT)
        initial_lines = self._build_initial_lines()
        self._mark_already_imported(entry_lines + exit_lines + initial_lines)
        self._set_opening_date(entry_lines + exit_lines)
        plan.initial_lines = initial_lines
        self._group_entries(entry_lines)
        self._group_exits(exit_lines)
        self._resolve_locations()
        self._resolve_projects()
        self._project_stock()
        return self._finish()

    # -- stage 1: catalog + summary ---------------------------------------------

    def _read_catalog_and_summary(self):
        parsed = self.parsed
        from_summary = parsed.catalog_sheet == parser.SHEET_SUMMARY
        catalog_sheet = parsed.sheets.get(parser.SHEET_CATALOG)

        if catalog_sheet is not None and not from_summary:
            for rr in catalog_sheet.rows:
                data, errors = validators.validate_row(validators.CatalogRowSerializer, rr.values)
                if errors:
                    self.add_validation_errors(parser.SHEET_CATALOG, rr.row, errors)
                    continue
                self._add_catalog_entry(data, parser.SHEET_CATALOG, rr.row)

        summary_sheet = parsed.sheets.get(parser.SHEET_SUMMARY)
        if summary_sheet is not None:
            serializer = validators.SummaryCatalogRowSerializer if from_summary else validators.SummaryRowSerializer
            for rr in summary_sheet.rows:
                data, errors = validators.validate_row(serializer, rr.values)
                if errors:
                    self.add_validation_errors(parser.SHEET_SUMMARY, rr.row, errors)
                    continue
                code = data['product_code']
                if code in self.summary:
                    self.add('CODIGO_DUPLICADO_IDENTICO', parser.SHEET_SUMMARY, rr.row, code=code)
                    continue
                self.summary[code] = SummaryInfo(
                    row=rr.row, initial=data['initial'], stock=data['stock'], location=data['location'],
                    observation=data['observation'], project=data['project'],
                )
                if from_summary:
                    self._add_catalog_entry(data, parser.SHEET_SUMMARY, rr.row)
                if data['location']:
                    self.locations_raw[code].append((0, parser.SHEET_SUMMARY, rr.row, data['location']))

        # Observation / project of the summary travel with the catalog entries.
        for code, info in self.summary.items():
            entry = self.catalog.get(code)
            if entry is not None:
                entry.observation = info.observation

    def _add_catalog_entry(self, data, sheet, row):
        code = data['product_code']
        existing = self.catalog.get(code)
        if existing is not None:
            if _same_text(existing.description, data['description']) and _same_text(existing.unit, data['unit']):
                self.add('CODIGO_DUPLICADO_IDENTICO', sheet, row, code=code)
            else:
                self.add('CODIGO_DUPLICADO_DISTINTO', sheet, row, code=code)
            return
        category, item_type, classified = catalog.classify_code(code)
        if not classified:
            self.add('PREFIJO_NO_CLASIFICADO', sheet, row, code=code)
        self.catalog[code] = CatalogEntry(
            code=code, description=data['description'], unit=data['unit'], sheet=sheet, row=row,
            order_number=data.get('order_number', ''),
            purchase_order_ref=data.get('purchase_order_ref', ''),
            packing_list=data.get('packing_list', ''),
            size=catalog.derive_size(data['description']),
            category=category, item_type=item_type,
        )

    # -- stage 2: movements, syntactic validation ----------------------------------

    def _read_movements(self):
        sheets = (
            (parser.SHEET_ENTRIES, validators.EntryRowSerializer, self.entry_rows, KIND_ENTRY, 0),
            (parser.SHEET_EXITS, validators.ExitRowSerializer, self.exit_rows, KIND_EXIT, 1),
        )
        for name, serializer, bucket, kind, rank in sheets:
            sheet = self.parsed.sheets.get(name)
            if sheet is None:
                continue
            for rr in sheet.rows:
                raw_code = rr.values.get('product_code')
                raw_location = rr.values.get('location')
                if raw_code is not None and isinstance(raw_location, str):
                    self.locations_raw[catalog.normalize_product_code(raw_code)].append(
                        (rank + 1, name, rr.row, raw_location)
                    )
                data, errors = validators.validate_row(serializer, rr.values)
                if errors:
                    self.add_validation_errors(name, rr.row, errors)
                    self.skipped[kind] += 1
                    continue
                if kind == KIND_EXIT and not destination_key(data['destination']):
                    self.add('DESTINO_VACIO', name, rr.row)
                    self.skipped[kind] += 1
                    continue
                bucket.append((name, rr.row, data))
                self.referenced.add(data['product_code'])
        self.referenced.update(self.summary)

    # -- stage 3: existing items ---------------------------------------------------

    def _resolve_items(self):
        wanted = set(self.catalog) | self.referenced
        existing = fetch_existing_items(wanted)
        update_existing = self.plan.update_existing

        for code, entry in list(self.catalog.items()):
            inv = existing.get(code)
            if inv is None:
                entry.action = ACTION_CREATE
                continue
            entry.existing = inv
            if not _same_text(inv.unit, entry.unit):
                self.add(
                    'UNIDAD_EN_CONFLICTO', entry.sheet, entry.row,
                    code=code, file_unit=entry.unit, db_unit=inv.unit,
                )
                entry.action = ACTION_SKIP
                self.skipped['catalog'] += 1
                continue
            if not _same_text(inv.description, entry.description):
                self.add('DESCRIPCION_DISTINTA', entry.sheet, entry.row, code=code)
            entry.changes = self._existing_changes(entry, inv, update_existing)
            entry.action = ACTION_UPDATE if entry.changes else ACTION_UNCHANGED

        # Items referenced by movements / summary but absent from the catalog sheet.
        for code in sorted(self.referenced - set(self.catalog)):
            inv = existing.get(code)
            if inv is not None:
                self.catalog[code] = CatalogEntry(
                    code=code, description=inv.description, unit=inv.unit, existing=inv,
                    action=ACTION_EXTERNAL,
                )

    @staticmethod
    def _existing_changes(entry, inv, update_existing) -> dict:
        changes = {}
        for name in ('order_number', 'purchase_order_ref', 'packing_list', 'size', 'observation'):
            new, old = getattr(entry, name), getattr(inv, name)
            if new and (not old or (update_existing and new != old)):
                changes[name] = new
        if not inv.category and entry.category:
            changes['category'] = entry.category
            if inv.item_type == 'MATERIAL':
                changes['item_type'] = entry.item_type
        return changes

    # -- stage 4: lines ------------------------------------------------------------

    def _entry_for(self, code, sheet, row):
        entry = self.catalog.get(code)
        if entry is None:
            self.add('ITEM_DESCONOCIDO', sheet, row, code=code)
            return None
        if entry.action == ACTION_SKIP:
            self.add('ITEM_OMITIDO', sheet, row, code=code)
            return None
        return entry

    @staticmethod
    def _is_fractional_piece(entry, quantity) -> bool:
        """A fractional quantity of an item counted in whole pieces (EA, UND, PAR, JGO)."""
        return requires_integer_quantity(entry.unit) and quantity != quantity.to_integral_value()

    def _build_lines(self, rows, kind) -> list:
        lines: list[Line] = []
        occurrences: Counter = Counter()
        tag = 'IN' if kind == KIND_ENTRY else 'OUT'
        for sheet, row, data in rows:
            code = data['product_code']
            entry = self._entry_for(code, sheet, row)
            if entry is None:
                self.skipped[kind] += 1
                continue
            if self._is_fractional_piece(entry, data['quantity']):
                # same rule as the manual entry/exit: EA / UND / PAR / JGO are whole pieces
                self.add('CANTIDAD_INVALIDA', sheet, row)
                self.skipped[kind] += 1
                continue
            when = data['date']
            if when is None:
                self.add('FECHA_VACIA', sheet, row)
            if kind == KIND_ENTRY:
                voucher, destination, dest_key = '', '', ''
            else:
                voucher, destination = data['voucher'], data['destination']
                dest_key = destination_key(destination)
                if not voucher:
                    self.add('VALE_VACIO', sheet, row)
            ident = (tag, code, when, data['quantity'], voucher, dest_key, data['tag'] if kind == KIND_ENTRY else '')
            occurrences[ident] += 1
            lines.append(Line(
                kind=kind, sheet=sheet, row=row, code=code, quantity=data['quantity'], date=when,
                source_key=make_source_key(
                    self.warehouse, tag, code, when, data['quantity'], voucher, dest_key,
                    ident[-1], occurrences[ident],
                ),
                tag=data['tag'] if kind == KIND_ENTRY else '',
                notes=data['observation'],
                po=data.get('po_number', ''), guide=data.get('guide_number', ''),
                transfer=data['internal_transfer'],
                voucher=voucher, destination=destination, dest_key=dest_key,
            ))
        return lines

    def _build_initial_lines(self) -> list:
        lines = []
        for code, info in self.summary.items():
            entry = self.catalog.get(code)
            if entry is None:
                self.add('ITEM_DESCONOCIDO', parser.SHEET_SUMMARY, info.row, code=code)
                continue
            if entry.action == ACTION_SKIP:
                self.add('ITEM_OMITIDO', parser.SHEET_SUMMARY, info.row, code=code)
                continue
            if info.initial and info.initial > 0:
                if self._is_fractional_piece(entry, info.initial):
                    self.add('CANTIDAD_INVALIDA', parser.SHEET_SUMMARY, info.row)
                    continue
                lines.append(Line(
                    kind=KIND_INITIAL, sheet=parser.SHEET_SUMMARY, row=info.row, code=code,
                    quantity=info.initial, date=None, source_key=initial_source_key(self.warehouse, code),
                    notes='Carga inicial (importación)',
                ))
        return lines

    def _mark_already_imported(self, lines):
        keys = [ln.source_key for ln in lines]
        present: set = set()
        for chunk in _chunks(keys):
            present.update(
                InventoryMovement.objects.filter(source_key__in=chunk).values_list('source_key', flat=True)
            )
        for ln in lines:
            if ln.source_key in present:
                ln.already = True
                self.add('FILA_YA_IMPORTADA', ln.sheet, ln.row)
                if ln.kind != KIND_INITIAL:
                    self.plan.stats[f'already_{ln.kind}'] = self.plan.stats.get(f'already_{ln.kind}', 0) + 1

        # Rows imported in earlier runs that this workbook no longer contains: they were
        # corrected (the new version has another key) or deleted. They are NEVER removed;
        # the user is told so a corrected quantity is not silently counted twice.
        imported_before = InventoryMovement.objects.filter(
            warehouse=self.warehouse, import_batch__isnull=False,
        ).count()
        missing = imported_before - len(present)
        if missing > 0:
            self.plan.stats['imported_rows_missing'] = missing
            self.add('FILAS_IMPORTADAS_AUSENTES', count=missing)

    def _set_opening_date(self, movement_lines):
        dates = [ln.date for ln in movement_lines if ln.date]
        self.plan.opening_date = min(dates) if dates else self.today

    # -- stage 5: groups -----------------------------------------------------------

    def _group_entries(self, lines):
        groups: OrderedDict = OrderedDict()
        for ln in lines:
            if ln.already:
                continue
            key = ('E', ln.date, ln.po, ln.guide, ln.transfer) if ln.date else ('E?', ln.row)
            group = groups.get(key)
            if group is None:
                group = groups[key] = Group(
                    kind=KIND_ENTRY, key=key, date=ln.date, po=ln.po, guide=ln.guide, transfer=ln.transfer,
                )
            group.lines.append(ln)
        self.plan.entry_groups = list(groups.values())

    def _group_exits(self, lines):
        groups: OrderedDict = OrderedDict()
        for ln in lines:
            if ln.already:
                continue
            if ln.voucher:
                key = ('X', ln.voucher, ln.date, ln.dest_key, ln.transfer)
            else:
                key = ('X?', ln.row)
            group = groups.get(key)
            if group is None:
                group = groups[key] = Group(
                    kind=KIND_EXIT, key=key, date=ln.date, voucher=ln.voucher, transfer=ln.transfer,
                    destination=ln.destination, dest_key=ln.dest_key,
                    internal=is_internal_destination(ln.destination),
                )
            group.lines.append(ln)
        exit_groups = list(groups.values())
        self._match_destinations(exit_groups)
        self._check_vouchers(exit_groups)
        self.plan.exit_groups = exit_groups

    def _match_destinations(self, groups):
        index = None
        per_destination: OrderedDict = OrderedDict()
        for group in groups:
            if group.internal:
                continue
            if index is None:
                index = PersonalIndex()
            result = index.match(group.destination)
            group.match_status = result.status
            group.personal_id = result.personal_id if result.status == MATCHED else None
            if result.status == MATCHED:
                continue
            info = per_destination.setdefault(group.dest_key, {
                'key': group.dest_key, 'display': group.destination, 'rows': 0,
                'candidates': result.candidates, 'first': group.first_row, 'status': result.status,
            })
            info['rows'] += len(group.lines)
        for info in per_destination.values():
            code = 'DESTINO_AMBIGUO' if info['status'] == AMBIGUOUS else 'DESTINO_SIN_PERSONAL'
            self.add(code, parser.SHEET_EXITS, info['first'], rows=info['rows'], candidates=info['candidates'])
            self.plan.unmatched_destinations.append({
                'key': info['key'], 'display': info['display'],
                'rows': info['rows'], 'candidates': info['candidates'],
            })

    def _check_vouchers(self, groups):
        by_voucher: dict = defaultdict(list)
        for group in groups:
            if group.voucher:
                by_voucher[group.voucher].append(group)
        flagged = set()
        for voucher, items in by_voucher.items():
            first = (items[0].date, items[0].dest_key)
            for group in items[1:]:
                if (group.date, group.dest_key) != first and voucher not in flagged:
                    self.add('VALE_REUTILIZADO', parser.SHEET_EXITS, group.first_row)
                    flagged.add(voucher)
        # Vouchers already used by a manual delivery in the system (not by an earlier import).
        known: set = set()
        for chunk in _chunks(by_voucher):
            known.update(
                MovementGroup.objects.filter(
                    movement_type='EXIT', warehouse=self.warehouse, voucher_number__in=chunk,
                ).exclude(movements__import_batch__isnull=False).values_list('voucher_number', flat=True)
            )
        for voucher in sorted(known - flagged):
            self.add('VALE_REUTILIZADO', parser.SHEET_EXITS, by_voucher[voucher][0].first_row)

    # -- stage 6: locations, projects --------------------------------------------

    def _resolve_locations(self):
        for code, entry in self.catalog.items():
            inv = entry.existing
            if entry.action in (ACTION_SKIP, ACTION_EXTERNAL):
                continue
            if inv is not None and locations.is_valid_location(inv.location):
                continue                                   # never overwrite an assigned location
            exact = floor = unknown = None
            for rank, sheet, row, text in sorted(self.locations_raw.get(code, []), key=lambda t: t[0]):
                parsed = locations.parse_location(text)
                if parsed and exact is None:
                    exact = parsed
                elif locations.parse_floor_label(text) and floor is None:
                    floor = (locations.parse_floor_label(text), sheet, row)
                elif not parsed and not locations.parse_floor_label(text) and unknown is None:
                    unknown = (sheet, row)
            if exact is not None:
                if inv is None or not inv.location:
                    entry.location, entry.floor = exact.code, exact.floor
                    if inv is not None:
                        entry.changes.update({'location': exact.code, 'floor': exact.floor})
                continue
            if floor is not None:
                number, sheet, row = floor
                entry.floor = number
                if inv is None or inv.floor is None:
                    if inv is not None:
                        entry.changes['floor'] = number
                    self.add('UBICACION_PISO_SIN_PABELLON', sheet, row, code=code, floor=f'PISO {number}')
            elif unknown is not None and (inv is None or not inv.location):
                self.add('UBICACION_NO_RECONOCIDA', unknown[0], unknown[1], code=code)

    def _resolve_projects(self):
        labels = self.plan.project_labels
        for code, info in self.summary.items():
            entry = self.catalog.get(code)
            if entry is None or entry.action in (ACTION_SKIP, ACTION_EXTERNAL):
                continue
            if not info.project:
                self.add('PROYECTO_VACIO', parser.SHEET_SUMMARY, info.row, code=code)
                continue
            key = parser.normalize_label(info.project)
            entry.project_key = key
            if entry.existing is not None and (entry.existing.project_id is None or self.plan.update_existing):
                entry.changes['project_key'] = key
            slot = labels.setdefault(key, {'label': info.project, 'items': 0})
            slot['items'] += 1
        if labels:
            projects = list(Project.objects.filter(is_active=True).only('id', 'code', 'name'))
            for key in labels:
                self.plan.project_matches[key] = [
                    {'id': p.pk, 'code': p.code, 'name': p.name}
                    for p in projects
                    if parser.normalize_label(p.code) == key or parser.normalize_label(p.name) == key
                ]

    # -- stage 7: stock ------------------------------------------------------------

    def _project_stock(self):
        plan = self.plan
        ids = [e.existing.pk for e in plan.catalog.values() if e.existing is not None]
        db_stock: dict = {}
        for chunk in _chunks(ids):
            for inv_id, qty in InventoryStock.objects.filter(
                inventory_id__in=chunk, warehouse_type=self.warehouse,
                project__isnull=True, department__isnull=True,
            ).values_list('inventory_id', 'quantity'):
                db_stock[inv_id] = qty

        delta: dict = defaultdict(lambda: ZERO)
        touched: set = set()
        for ln in plan.initial_lines:
            if not ln.already:
                delta[ln.code] += ln.quantity
                touched.add(ln.code)
        for group in plan.entry_groups:
            for ln in group.lines:
                delta[ln.code] += ln.quantity
                touched.add(ln.code)
        for group in plan.exit_groups:
            for ln in group.lines:
                delta[ln.code] -= ln.quantity
                touched.add(ln.code)

        stats = plan.stats
        stats.update(projected_total=ZERO, mismatched_items=0, negative_items=0)
        sheet_total = None
        for code, entry in plan.catalog.items():
            if entry.action == ACTION_SKIP:
                continue
            base = db_stock.get(entry.existing.pk, ZERO) if entry.existing is not None else ZERO
            entry.db_stock = base
            entry.projected = base + delta.get(code, ZERO)
            stats['projected_total'] += entry.projected
            if entry.projected < 0:
                stats['negative_items'] += 1
                self.add('STOCK_NEGATIVO', entry.sheet, entry.row, code=code, quantity=_fmt_qty(entry.projected))
            elif entry.projected > MAX_STOCK_QUANTITY:
                self.add('STOCK_EXCEDIDO', entry.sheet, entry.row, code=code, quantity=_fmt_qty(entry.projected))
            info = self.summary.get(code)
            if info is not None and info.stock is not None:
                entry.sheet_stock = info.stock
                sheet_total = (sheet_total or ZERO) + info.stock
                if info.stock != entry.projected:
                    stats['mismatched_items'] += 1
                    self.add(
                        'STOCK_DISTINTO_AL_LIBRO', parser.SHEET_SUMMARY, info.row, code=code,
                        projected=_fmt_qty(entry.projected), book=_fmt_qty(info.stock),
                    )
            if entry.projected == 0 and (entry.action == ACTION_CREATE or code in touched):
                self.add('PRODUCTO_SIN_STOCK_CERO', entry.sheet, entry.row, code=code)
        stats['sheet_total'] = sheet_total

    # -- finish --------------------------------------------------------------------

    def _finish(self) -> ImportPlan:
        plan = self.plan
        stats = plan.stats
        for entry in plan.catalog.values():
            if entry.action == ACTION_UNCHANGED and entry.changes:
                entry.action = ACTION_UPDATE
        in_sheet = [e for e in plan.catalog.values() if e.action != ACTION_EXTERNAL]
        stats['catalog_new'] = sum(1 for e in in_sheet if e.action == ACTION_CREATE)
        stats['catalog_existing'] = sum(1 for e in in_sheet if e.action in (ACTION_UPDATE, ACTION_UNCHANGED))
        stats['catalog_to_update'] = sum(1 for e in in_sheet if e.action == ACTION_UPDATE)
        stats['catalog_conflicts'] = sum(1 for p in plan.problems if p.code in (
            'UNIDAD_EN_CONFLICTO', 'CODIGO_DUPLICADO_DISTINTO',
        ))
        for kind in (KIND_ENTRY, KIND_EXIT):
            stats[f'skipped_{kind}'] = self.skipped.get(kind, 0)
        return plan


def build_plan(parsed, *, warehouse, update_existing=False, file_sha256='', today=None) -> ImportPlan:
    """Build the (read-only) import plan for a parsed workbook."""
    return _Planner(parsed, warehouse, update_existing, file_sha256, today).run()
