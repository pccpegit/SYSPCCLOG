"""
Management command to layer a RICH, EXTRA demo dataset on top of the base
`seed_demo` command, for the SYSPCCLOG RQ System.

This command is purely ADDITIVE: it never touches the data created by
`seed_demo` (different code/number prefixes are used throughout) and it
NEVER re-implements or calls into the workflow engine — request statuses
are set directly on the model, exactly matching the frozen state machine
documented in `apps/rq/services/workflow_engine.py` /
`FLUJOGRAMA DE ABASTECIMIENTO DE RQ's OPERACIONES Rev.0 MAR2026.pdf`.

Goal: populate every reachable RQStatusChoices value (as used by
WorkflowEngine.TRANSITIONS) with at least one realistic Request, across
both the OPERATIONS and ADMINISTRATIVE flows, plus the related Quotation,
PurchaseOrder, WarehouseReceipt, WarehouseDispatch and Claim records so
every role/screen in the system has something concrete to show.

Idempotent: safe to run multiple times. All records are created via
get_or_create keyed on unique natural keys (rq_number, po_number,
receipt_number, dispatch_number, group_number, movement_number, etc.)
using the 'RQ-2026-1xxx' / 'PROY-2026-1xx' / 'OC-2026-1xxx' style number
ranges reserved for this command so nothing collides with `seed_demo`.

Usage:
    python manage.py seed_demo_extra
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.core.management.commands.seed_demo import DEMO_PASSWORD
from apps.core.management.seed_guard import abort_if_production

# ---------------------------------------------------------------------------
# Extra users (8) — reuses the DEMO_PASSWORD shared by every demo account.
# Adds more REQUESTERs spread across projects, and backups for key roles.
# ---------------------------------------------------------------------------

EXTRA_USERS = [
    {
        'username': 'lramirez',
        'first_name': 'Lucía',
        'last_name': 'Ramírez',
        'email': 'lramirez@pcc.pe',
        'position': 'Ingeniera de Campo',
        'department': 'Proyectos',
        'roles': [{'role': 'REQUESTER', 'is_primary': True, 'project_code': 'PROY-2026-101'}],
    },
    {
        'username': 'jflores',
        'first_name': 'Javier',
        'last_name': 'Flores',
        'email': 'jflores@pcc.pe',
        'position': 'Ingeniero de Campo',
        'department': 'Proyectos',
        'roles': [{'role': 'REQUESTER', 'is_primary': True, 'project_code': 'PROY-2026-102'}],
    },
    {
        'username': 'gsilva',
        'first_name': 'Gabriela',
        'last_name': 'Silva',
        'email': 'gsilva@pcc.pe',
        'position': 'Ingeniera de Campo',
        'department': 'Proyectos',
        'roles': [{'role': 'REQUESTER', 'is_primary': True, 'project_code': 'PROY-2026-103'}],
    },
    {
        'username': 'ncastro',
        'first_name': 'Natalia',
        'last_name': 'Castro',
        'email': 'ncastro@pcc.pe',
        'position': 'Analista de TI',
        'department': 'Tecnología de la Información',
        'roles': [{'role': 'REQUESTER', 'is_primary': True, 'department_code': 'TI'}],
    },
    {
        'username': 'rsalcedo',
        'first_name': 'Ricardo',
        'last_name': 'Salcedo',
        'email': 'rsalcedo@pcc.pe',
        'position': 'Residente de Proyecto',
        'department': 'Proyectos',
        'roles': [{'role': 'PROJECT_RESIDENT', 'is_primary': True, 'project_code': 'PROY-2026-102'}],
    },
    {
        'username': 'mnavarro',
        'first_name': 'Miguel',
        'last_name': 'Navarro',
        'email': 'mnavarro@pcc.pe',
        'position': 'Coord. Logístico (Suplente)',
        'department': 'Logística',
        'roles': [{'role': 'LOGISTICS_COORDINATOR', 'is_primary': True}],
    },
    {
        'username': 'aquispe',
        'first_name': 'Alejandra',
        'last_name': 'Quispe',
        'email': 'aquispe@pcc.pe',
        'position': 'Almacenera Central (Suplente)',
        'department': 'Almacén',
        'roles': [{'role': 'CENTRAL_WAREHOUSE', 'is_primary': True}],
    },
    {
        'username': 'ecordova',
        'first_name': 'Eduardo',
        'last_name': 'Córdova',
        'email': 'ecordova@pcc.pe',
        'position': 'Jefe de TI',
        'department': 'Tecnología de la Información',
        'roles': [{'role': 'DIRECT_SUPERVISOR', 'is_primary': True, 'department_code': 'TI'}],
    },
]

# ---------------------------------------------------------------------------
# Extra projects (5) — codes PROY-2026-1xx to avoid colliding with seed_demo.
# ---------------------------------------------------------------------------

EXTRA_PROJECTS = [
    {
        'code': 'PROY-2026-101',
        'name': 'Ampliación Planta Concentradora Toquepala',
        'location': 'Tacna',
        'client': 'Minera del Sur S.A.',
        'total_budget': Decimal('12500000.00'),
        'start_date': date(2026, 2, 10),
        'end_date': date(2027, 8, 31),
        'budget_lines': [
            {'code': 'PROY-101-MAT', 'description': 'Materiales de Construcción', 'budgeted_amount': Decimal('5000000.00')},
            {'code': 'PROY-101-EQP', 'description': 'Equipos y Herramientas', 'budgeted_amount': Decimal('3000000.00')},
            {'code': 'PROY-101-MO', 'description': 'Mano de Obra', 'budgeted_amount': Decimal('3500000.00')},
        ],
    },
    {
        'code': 'PROY-2026-102',
        'name': 'Condominio Vista Verde',
        'location': 'Trujillo',
        'client': 'Inmobiliaria Costa Norte S.A.C.',
        'total_budget': Decimal('6800000.00'),
        'start_date': date(2026, 1, 20),
        'end_date': date(2027, 1, 15),
        'budget_lines': [
            {'code': 'PROY-102-MAT', 'description': 'Materiales de Construcción', 'budgeted_amount': Decimal('2800000.00')},
            {'code': 'PROY-102-EQP', 'description': 'Equipos y Herramientas', 'budgeted_amount': Decimal('1200000.00')},
            {'code': 'PROY-102-ACA', 'description': 'Acabados e Instalaciones', 'budgeted_amount': Decimal('1500000.00')},
        ],
    },
    {
        'code': 'PROY-2026-103',
        'name': 'Planta de Tratamiento de Agua Chincha',
        'location': 'Chincha',
        'client': 'SEDAPAL',
        'total_budget': Decimal('9200000.00'),
        'start_date': date(2026, 3, 5),
        'end_date': date(2027, 5, 30),
        'budget_lines': [
            {'code': 'PROY-103-EST', 'description': 'Estructura y Obras Civiles', 'budgeted_amount': Decimal('4500000.00')},
            {'code': 'PROY-103-EQP', 'description': 'Equipos Especializados', 'budgeted_amount': Decimal('2700000.00')},
            {'code': 'PROY-103-MO', 'description': 'Mano de Obra Especializada', 'budgeted_amount': Decimal('2000000.00')},
        ],
    },
    {
        'code': 'PROY-2026-104',
        'name': 'Vía de Evitamiento Cusco',
        'location': 'Cusco',
        'client': 'MTC - Provías Nacional',
        'total_budget': Decimal('18000000.00'),
        'start_date': date(2026, 4, 1),
        'end_date': date(2028, 4, 30),
        'budget_lines': [
            {'code': 'PROY-104-EST', 'description': 'Movimiento de Tierras y Pavimentación', 'budgeted_amount': Decimal('9000000.00')},
            {'code': 'PROY-104-EQP', 'description': 'Maquinaria Pesada', 'budgeted_amount': Decimal('5000000.00')},
            {'code': 'PROY-104-MO', 'description': 'Mano de Obra', 'budgeted_amount': Decimal('4000000.00')},
        ],
    },
    {
        'code': 'PROY-2026-105',
        'name': 'Terminal Portuario Paita - Ampliación',
        'location': 'Piura',
        'client': 'Autoridad Portuaria Nacional',
        'total_budget': Decimal('25000000.00'),
        'start_date': date(2026, 5, 15),
        'end_date': date(2028, 6, 30),
        'budget_lines': [
            {'code': 'PROY-105-EST', 'description': 'Obras Marítimas y Estructura', 'budgeted_amount': Decimal('14000000.00')},
            {'code': 'PROY-105-EQP', 'description': 'Equipos Portuarios', 'budgeted_amount': Decimal('7000000.00')},
            {'code': 'PROY-105-MO', 'description': 'Mano de Obra Especializada', 'budgeted_amount': Decimal('4000000.00')},
        ],
    },
]

# ---------------------------------------------------------------------------
# Extra suppliers (2)
# ---------------------------------------------------------------------------

EXTRA_SUPPLIERS = [
    {
        'ruc': '20100060606',
        'business_name': 'Diselectro S.A.',
        'trade_name': 'Diselectro',
        'contact_name': 'Karina Ruiz',
        'contact_email': 'ventas@diselectro.com.pe',
        'contact_phone': '01-460-2200',
        'address': 'Av. Colonial 3450, Callao',
        'city': 'Lima',
        'category': 'Instalaciones Eléctricas',
    },
    {
        'ruc': '20100070707',
        'business_name': 'Importadora Rex S.A.',
        'trade_name': 'Rex Equipos',
        'contact_name': 'Hugo Ramos',
        'contact_email': 'comercial@rexequipos.pe',
        'contact_phone': '01-224-9090',
        'address': 'Av. Industrial 780, Ate',
        'city': 'Lima',
        'category': 'Maquinaria y Equipos',
    },
]

# ---------------------------------------------------------------------------
# Extra inventory (optional, kept small)
# ---------------------------------------------------------------------------

EXTRA_INVENTORY = [
    {
        'product_code': 'MAT-GEO-001',
        'description': 'Geomembrana HDPE 1.5mm',
        'unit': 'm2',
        'category': 'Impermeabilización',
        'item_type': 'MATERIAL',
        'brand': 'Solmax',
        'model_name': '',
        'location': 'Patio Geosintéticos',
        'min_stock': Decimal('500.000'),
    },
    {
        'product_code': 'EQP-EXC-001',
        'description': 'Excavadora Hidráulica 20 Ton',
        'unit': 'unidad',
        'category': 'Maquinaria Pesada',
        'item_type': 'EQUIPMENT',
        'brand': 'CAT',
        'model_name': '320GC',
        'location': 'Patio Equipos Pesados',
        'min_stock': Decimal('1.000'),
    },
    {
        'product_code': 'HER-TOP-001',
        'description': 'Estación Total Topográfica',
        'unit': 'unidad',
        'category': 'Instrumentos de Medición',
        'item_type': 'TOOL',
        'brand': 'Leica',
        'model_name': 'TS07',
        'location': 'Almacén Topografía',
        'min_stock': Decimal('1.000'),
    },
    {
        'product_code': 'CON-EPP-001',
        'description': 'Casco de Seguridad Dieléctrico',
        'unit': 'unidad',
        'category': 'EPP',
        'item_type': 'CONSUMABLE',
        'brand': '3M',
        'model_name': 'H-700',
        'location': 'Rack EPP-01',
        'min_stock': Decimal('40.000'),
    },
    {
        'product_code': 'OFI-COM-001',
        'description': 'Laptop Corporativa 14" i5',
        'unit': 'unidad',
        'category': 'Informática',
        'item_type': 'EQUIPMENT',
        'brand': 'Dell',
        'model_name': 'Latitude 5440',
        'location': 'Estante TI-01',
        'min_stock': Decimal('3.000'),
    },
]

EXTRA_INVENTORY_STOCK = [
    ('MAT-GEO-001', 'SITE', 'PROY-2026-103', None, Decimal('1200.000')),
    ('EQP-EXC-001', 'SITE', 'PROY-2026-104', None, Decimal('2.000')),
    ('HER-TOP-001', 'CENTRAL', None, None, Decimal('3.000')),
    ('CON-EPP-001', 'CENTRAL', None, None, Decimal('15.000')),   # BELOW min (40)
    ('OFI-COM-001', 'OFFICE', None, 'TI', Decimal('1.000')),     # BELOW min (3)
]


class Command(BaseCommand):
    help = (
        'Seed EXTRA demo data (projects, users, and requests covering every '
        'reachable RQ workflow status) on top of `seed_demo`. Additive and '
        'idempotent — safe to run multiple times. NEVER run in production.'
    )

    @transaction.atomic
    def handle(self, *args, **options):
        # SYSPCC-011 FIX 4: refuse to run outside development — this seeds a
        # shared, version-controlled password for every demo account.
        abort_if_production()

        from apps.core.models import (
            User, UserRole, Project, ProjectBudgetLine, Department,
        )
        from apps.rq.models import (
            Supplier, Request, RequestItem, Approval,
            Quotation, QuotationItem, PurchaseOrder, PurchaseOrderItem, Claim,
        )
        from apps.warehouse.models import (
            Inventory, InventoryStock, MovementGroup, InventoryMovement,
            WarehouseReceipt, WarehouseReceiptItem,
            WarehouseDispatch, WarehouseDispatchItem,
        )

        self.stdout.write(self.style.MIGRATE_HEADING('\n=== SYSPCCLOG Extra Demo Data Seeder ===\n'))

        if not Department.objects.filter(code='TI').exists() or not User.objects.filter(username='jrodriguez').exists():
            raise CommandError(
                'Base demo data not found. Run `python manage.py seed_demo` first, '
                'then re-run `seed_demo_extra`.'
            )

        users_map = self._seed_users(User, UserRole, Project, Department)
        projects_map = self._seed_projects(Project, ProjectBudgetLine)
        self._seed_suppliers(Supplier)
        self._seed_inventory(Inventory, InventoryStock, projects_map)

        # Merge with base seed_demo users/projects/departments so extra
        # requests can freely mix old + new reference data.
        for u in User.objects.all():
            users_map.setdefault(u.username, u)
        for p in Project.objects.all():
            projects_map.setdefault(p.code, p)
        departments_map = {d.code: d for d in Department.objects.all()}

        suppliers_map = {s.ruc: s for s in Supplier.objects.all()}

        ctx = _RequestBuilder(
            self, Request, RequestItem, Approval,
            Quotation, QuotationItem, PurchaseOrder, PurchaseOrderItem, Claim,
            MovementGroup, InventoryMovement,
            WarehouseReceipt, WarehouseReceiptItem,
            WarehouseDispatch, WarehouseDispatchItem,
            users_map, projects_map, departments_map, suppliers_map,
        )
        created = ctx.build_all()

        self.stdout.write(
            self.style.SUCCESS(f'\n  Requests (extra): {created} created.')
        )
        self.stdout.write(self.style.SUCCESS('\nExtra demo data seeding completed successfully.\n'))

    # -----------------------------------------------------------------------
    # Users / Projects / Suppliers / Inventory
    # -----------------------------------------------------------------------

    def _seed_users(self, User, UserRole, Project, Department):
        self.stdout.write('Seeding extra demo users...')
        users_map = {}
        created_count = 0
        hashed_password = make_password(DEMO_PASSWORD)

        for user_data in EXTRA_USERS:
            user_fields = {k: v for k, v in user_data.items() if k != 'roles'}
            roles_data = user_data['roles']

            user, created = User.objects.get_or_create(
                username=user_fields['username'],
                defaults={
                    **user_fields,
                    'password': hashed_password,
                    'is_active': True,
                    'is_staff': False,
                    'is_superuser': False,
                },
            )
            if not created:
                for field in ('first_name', 'last_name', 'email', 'position', 'department'):
                    setattr(user, field, user_fields[field])
                user.save(update_fields=['first_name', 'last_name', 'email', 'position', 'department'])
            else:
                created_count += 1

            users_map[user.username] = user

            for role_entry in roles_data:
                project = None
                department_obj = None
                if role_entry.get('project_code'):
                    project = Project.objects.filter(code=role_entry['project_code']).first()
                if role_entry.get('department_code'):
                    department_obj = Department.objects.filter(code=role_entry['department_code']).first()
                UserRole.objects.get_or_create(
                    user=user,
                    role=role_entry['role'],
                    project=project,
                    department_obj=department_obj,
                    defaults={'is_primary': role_entry['is_primary']},
                )

        self.stdout.write(self.style.SUCCESS(f'  Extra users: {created_count} created.'))
        return users_map

    def _seed_projects(self, Project, ProjectBudgetLine):
        self.stdout.write('Seeding extra demo projects...')
        projects_map = {}
        proj_created = 0
        line_created = 0

        for proj_data in EXTRA_PROJECTS:
            budget_lines = proj_data['budget_lines']
            proj_fields = {k: v for k, v in proj_data.items() if k != 'budget_lines'}

            project, created = Project.objects.get_or_create(
                code=proj_fields['code'],
                defaults=proj_fields,
            )
            if not created:
                for field in ('name', 'location', 'client', 'total_budget', 'start_date', 'end_date'):
                    setattr(project, field, proj_fields[field])
                project.save()
            else:
                proj_created += 1

            projects_map[project.code] = project

            for line_data in budget_lines:
                _, line_new = ProjectBudgetLine.objects.get_or_create(
                    project=project,
                    code=line_data['code'],
                    defaults=line_data,
                )
                if line_new:
                    line_created += 1

        self.stdout.write(
            self.style.SUCCESS(f'  Extra projects: {proj_created} created. Budget lines: {line_created} created.')
        )
        return projects_map

    def _seed_suppliers(self, Supplier):
        self.stdout.write('Seeding extra demo suppliers...')
        created_count = 0
        for supplier_data in EXTRA_SUPPLIERS:
            _, created = Supplier.objects.get_or_create(
                ruc=supplier_data['ruc'],
                defaults=supplier_data,
            )
            if created:
                created_count += 1
        self.stdout.write(self.style.SUCCESS(f'  Extra suppliers: {created_count} created.'))

    def _seed_inventory(self, Inventory, InventoryStock, projects_map):
        self.stdout.write('Seeding extra demo inventory...')
        inv_created = 0
        inv_map = {}
        for item_data in EXTRA_INVENTORY:
            inv, created = Inventory.objects.get_or_create(
                product_code=item_data['product_code'],
                defaults=item_data,
            )
            if created:
                inv_created += 1
            inv_map[inv.product_code] = inv

        from apps.core.models import Department
        departments_map = {d.code: d for d in Department.objects.all()}

        stock_created = 0
        for (code, wh_type, proj_code, dept_code, qty) in EXTRA_INVENTORY_STOCK:
            inv = inv_map.get(code)
            if not inv:
                continue
            project = projects_map.get(proj_code) if proj_code else None
            department = departments_map.get(dept_code) if dept_code else None
            _, created = InventoryStock.objects.get_or_create(
                inventory=inv,
                warehouse_type=wh_type,
                project=project,
                department=department,
                defaults={'quantity': qty},
            )
            if created:
                stock_created += 1

        self.stdout.write(
            self.style.SUCCESS(f'  Extra inventory items: {inv_created} created. Stock levels: {stock_created} created.')
        )


class _RequestBuilder:
    """
    Builds ~34 Request records — one per reachable RQStatusChoices value
    from WorkflowEngine.TRANSITIONS — plus their Approval audit trail and,
    where applicable, Quotation / PurchaseOrder / WarehouseReceipt /
    WarehouseDispatch / Claim records.

    Statuses are SET DIRECTLY on the model (never via WorkflowEngine),
    per instructions: the engine itself must not be touched or invoked.
    """

    def __init__(
        self, command, Request, RequestItem, Approval,
        Quotation, QuotationItem, PurchaseOrder, PurchaseOrderItem, Claim,
        MovementGroup, InventoryMovement,
        WarehouseReceipt, WarehouseReceiptItem,
        WarehouseDispatch, WarehouseDispatchItem,
        users, projects, departments, suppliers,
    ):
        self.cmd = command
        self.Request = Request
        self.RequestItem = RequestItem
        self.Approval = Approval
        self.Quotation = Quotation
        self.QuotationItem = QuotationItem
        self.PurchaseOrder = PurchaseOrder
        self.PurchaseOrderItem = PurchaseOrderItem
        self.Claim = Claim
        self.MovementGroup = MovementGroup
        self.InventoryMovement = InventoryMovement
        self.WarehouseReceipt = WarehouseReceipt
        self.WarehouseReceiptItem = WarehouseReceiptItem
        self.WarehouseDispatch = WarehouseDispatch
        self.WarehouseDispatchItem = WarehouseDispatchItem

        self.u = users
        self.p = projects
        self.d = departments
        self.s = suppliers

        self.today = date.today()
        self.now = timezone.now()
        self.created_count = 0
        self._seq = 1000  # shared counter for OC/REC/DSP/GRP/MOV numbers

    # -- generic helpers -----------------------------------------------------

    def _next(self, prefix):
        self._seq += 1
        return f'{prefix}-2026-{self._seq}'

    def _get_or_create_request(self, rq_number, defaults):
        obj, created = self.Request.objects.get_or_create(rq_number=rq_number, defaults=defaults)
        if created:
            self.created_count += 1
        return obj, created

    def _create_items(self, request, items_data):
        for item_data in items_data:
            line_num = item_data['line_number']
            if not self.RequestItem.objects.filter(request=request, line_number=line_num).exists():
                self.RequestItem.objects.create(request=request, **item_data)

    def _create_approval(self, request, user, role, action, prev, new, comment, performed_at):
        if user is None:
            return
        exists = self.Approval.objects.filter(request=request, action=action, new_status=new).exists()
        if exists:
            return
        obj = self.Approval.objects.create(
            request=request,
            workflow_step=None,
            action=action,
            performed_by=user,
            role=role,
            previous_status=prev,
            new_status=new,
            comments=comment,
        )
        self.Approval.objects.filter(pk=obj.pk).update(performed_at=performed_at)

    def _create_chain(self, request, steps, base_time):
        """steps: ordered list of (user, role, action, prev, new, comment)."""
        for i, (user, role, action, prev, new, comment) in enumerate(steps):
            self._create_approval(request, user, role, action, prev, new, comment, base_time + timedelta(hours=6 * i))

    def _create_quotations(self, request, items_data, supplier_keys, selected_index=None, selected_by=None, selected_at=None):
        """Creates one Quotation (+ QuotationItems) per supplier RUC in supplier_keys."""
        request_items = list(request.items.order_by('line_number'))
        quotations = []
        for idx, ruc in enumerate(supplier_keys):
            supplier = self.s.get(ruc)
            if not supplier:
                continue
            total = Decimal('0.00')
            factor = Decimal('1.00') + Decimal('0.05') * idx  # vary price per supplier
            for it in items_data:
                unit_price = (it.get('unit_price') or Decimal('0.00')) * factor
                total += unit_price * it['quantity']
            quotation, created = self.Quotation.objects.get_or_create(
                request=request,
                supplier=supplier,
                defaults={
                    'quotation_number': f'COT-{supplier.ruc[-4:]}-{request.rq_number[-4:]}',
                    'total_amount': total.quantize(Decimal('0.01')),
                    'currency': 'PEN',
                    'delivery_days': 5 + idx * 2,
                    'payment_terms': 'Contado contra entrega' if idx == 0 else 'Crédito 30 días',
                    'validity_days': 15,
                    'notes': f'Cotización recibida de {supplier.trade_name or supplier.business_name}.',
                },
            )
            if created:
                for ri, it in zip(request_items, items_data):
                    unit_price = (it.get('unit_price') or Decimal('0.00')) * factor
                    self.QuotationItem.objects.get_or_create(
                        quotation=quotation,
                        request_item=ri,
                        defaults={
                            'unit_price': unit_price.quantize(Decimal('0.01')),
                            'quantity': it['quantity'],
                            'total_price': (unit_price * it['quantity']).quantize(Decimal('0.01')),
                        },
                    )
            quotations.append(quotation)

        if selected_index is not None and quotations:
            selected = quotations[selected_index]
            if not selected.is_selected:
                selected.is_selected = True
                selected.selected_by = selected_by
                selected.selected_at = selected_at
                selected.save(update_fields=['is_selected', 'selected_by', 'selected_at'])
        return quotations

    def _create_purchase_order(self, request, quotation, generated_by, status, expected_delivery_date=None, actual_delivery_date=None):
        po_number = self._next('OC')
        po, created = self.PurchaseOrder.objects.get_or_create(
            request=request,
            quotation=quotation,
            defaults={
                'po_number': po_number,
                'supplier': quotation.supplier,
                'generated_by': generated_by,
                'status': status,
                'total_amount': quotation.total_amount,
                'currency': quotation.currency,
                'payment_terms': quotation.payment_terms,
                'expected_delivery_date': expected_delivery_date,
                'actual_delivery_date': actual_delivery_date,
                'notes': f'OC generada a partir de cotización {quotation.quotation_number}.',
            },
        )
        if created:
            for qi in quotation.items.select_related('request_item'):
                self.PurchaseOrderItem.objects.get_or_create(
                    purchase_order=po,
                    request_item=qi.request_item,
                    defaults={
                        'quotation_item': qi,
                        'description': qi.request_item.description,
                        'quantity': qi.quantity,
                        'unit': qi.request_item.unit,
                        'unit_price': qi.unit_price,
                        'total_price': qi.total_price,
                    },
                )
        return po

    def _create_entry_movement_group(self, request, warehouse, project, registered_by, supplier_name):
        group_number = self._next('VE')
        group, created = self.MovementGroup.objects.get_or_create(
            group_number=group_number,
            defaults={
                'movement_type': 'ENTRY',
                'warehouse': warehouse,
                'project': project,
                'source_type': 'PURCHASE',
                'supplier_name': supplier_name,
                'invoice_number': f'F001-{self._seq}',
                'registered_by': registered_by,
            },
        )
        if created:
            for item in request.items.all():
                if not item.inventory_item_id:
                    continue
                mv_number = self._next('MOV')
                self.InventoryMovement.objects.get_or_create(
                    movement_number=mv_number,
                    defaults={
                        'movement_type': 'ENTRY',
                        'inventory': item.inventory_item,
                        'quantity': item.quantity,
                        'warehouse': warehouse,
                        'project': project,
                        'source_type': 'PURCHASE',
                        'supplier_name': supplier_name,
                        'group': group,
                        'registered_by': registered_by,
                    },
                )
        return group

    def _create_exit_movement_group(self, request, warehouse, project, department, registered_by, destination_type, destination_detail):
        group_number = self._next('VS')
        group, created = self.MovementGroup.objects.get_or_create(
            group_number=group_number,
            defaults={
                'movement_type': 'EXIT',
                'warehouse': warehouse,
                'project': project,
                'destination_type': destination_type,
                'destination_detail': destination_detail,
                'registered_by': registered_by,
            },
        )
        if created:
            for item in request.items.all():
                if not item.inventory_item_id:
                    continue
                mv_number = self._next('MOV')
                self.InventoryMovement.objects.get_or_create(
                    movement_number=mv_number,
                    defaults={
                        'movement_type': 'EXIT',
                        'inventory': item.inventory_item,
                        'quantity': item.quantity,
                        'warehouse': warehouse,
                        'project': project,
                        'destination_type': destination_type,
                        'destination_detail': destination_detail,
                        'group': group,
                        'registered_by': registered_by,
                    },
                )
        return group

    def _create_receipt(
        self, request, po, received_by, conformity_passed=None,
        conformity_by=None, conformity_at=None, movement_group=None,
    ):
        receipt_number = self._next('REC')
        receipt, created = self.WarehouseReceipt.objects.get_or_create(
            request=request,
            purchase_order=po,
            defaults={
                'received_by': received_by,
                'receipt_number': receipt_number,
                'supplier_guide_number': f'GR-{self._seq}',
                'conformity_passed': conformity_passed,
                'conformity_checked_by': conformity_by,
                'conformity_checked_at': conformity_at,
                'movement_group': movement_group,
                'notes': 'Recepción registrada por demo seeder.',
            },
        )
        if created:
            po_items = {pi.request_item_id: pi for pi in po.items.all()} if po else {}
            for item in request.items.all():
                po_item = po_items.get(item.id)
                accepted = item.quantity if conformity_passed is not False else Decimal('0.000')
                rejected = Decimal('0.000') if conformity_passed is not False else item.quantity
                self.WarehouseReceiptItem.objects.get_or_create(
                    receipt=receipt,
                    request_item=item,
                    defaults={
                        'purchase_order_item': po_item,
                        'quantity_received': item.quantity,
                        'quantity_accepted': accepted,
                        'quantity_rejected': rejected,
                        'rejection_reason': '' if conformity_passed is not False else 'Producto dañado durante el transporte.',
                    },
                )
        return receipt

    def _create_dispatch(
        self, request, receipt, dispatched_by, origin,
        dest_project=None, dest_department=None,
        delivered_at=None, accepted_by=None, movement_group=None,
    ):
        dispatch_number = self._next('DSP')
        dispatch, created = self.WarehouseDispatch.objects.get_or_create(
            request=request,
            defaults={
                'receipt': receipt,
                'dispatched_by': dispatched_by,
                'dispatch_number': dispatch_number,
                'origin': origin,
                'destination_project': dest_project,
                'destination_department': dest_department,
                'dispatch_guide_number': f'GRI-{self._seq}',
                'delivered_at': delivered_at,
                'accepted_by': accepted_by,
                'movement_group': movement_group,
                'notes': 'Despacho registrado por demo seeder.',
            },
        )
        if created:
            for item in request.items.all():
                self.WarehouseDispatchItem.objects.get_or_create(
                    dispatch=dispatch,
                    request_item=item,
                    defaults={
                        'quantity_dispatched': item.quantity,
                        'quantity_delivered': item.quantity if delivered_at else None,
                    },
                )
        return dispatch

    def _create_claim(self, request, claim_type, raised_by, managed_by, status, description, resolution='', resolved_by=None, resolved_at=None):
        claim, created = self.Claim.objects.get_or_create(
            request=request,
            claim_type=claim_type,
            defaults={
                'raised_by': raised_by,
                'managed_by': managed_by,
                'status': status,
                'description': description,
                'resolution': resolution,
                'resolved_by': resolved_by,
                'resolved_at': resolved_at,
            },
        )
        return claim

    # -- default items ---------------------------------------------------

    def _ops_items(self, unit_price=Decimal('120.00')):
        return [
            {'line_number': 1, 'description': 'Plancha de acero galvanizado 1.20x2.40m', 'specifications': 'Calibre 22, uso estructural', 'quantity': Decimal('20.000'), 'unit': 'und', 'unit_price': unit_price, 'presupuestado_adicional': 'P'},
            {'line_number': 2, 'description': 'Perfil metálico C 100x50x15x2mm', 'specifications': 'Acero galvanizado, longitud 6m', 'quantity': Decimal('30.000'), 'unit': 'und', 'unit_price': unit_price * Decimal('0.7'), 'presupuestado_adicional': 'P'},
        ]

    def _adm_items(self, unit_price=Decimal('45.00')):
        return [
            {'line_number': 1, 'description': 'Silla giratoria de oficina', 'specifications': 'Base metálica, malla transpirable', 'quantity': Decimal('4.000'), 'unit': 'und', 'unit_price': unit_price},
            {'line_number': 2, 'description': 'Archivador metálico 4 gavetas', 'specifications': 'Pintura electrostática, con seguro', 'quantity': Decimal('2.000'), 'unit': 'und', 'unit_price': unit_price * Decimal('4')},
        ]

    # -- main entry point -----------------------------------------------

    def build_all(self):
        self._build_operations_requests()
        self._build_administrative_requests()
        return self.created_count

    # =====================================================================
    # OPERATIONS flow — one request per target status
    # =====================================================================

    def _build_operations_requests(self):
        u = self.u
        requester = u.get('lramirez') or u.get('jrodriguez')
        resident = u.get('rsalcedo') or u.get('mcastillo')
        control = u.get('clopez')
        gm = u.get('aperez')
        logistics = u.get('mnavarro') or u.get('rgarcia')
        central_wh = u.get('aquispe') or u.get('lmendoza')
        site_wh = u.get('psalas')

        project = self.p.get('PROY-2026-101')
        budget_line = project.budget_lines.filter(code='PROY-101-MAT').first() if project else None

        n = 1000  # rq_number sequence for OPS

        def mkrq(status, extra=None):
            nonlocal n
            n += 1
            rq_number = f'RQ-2026-1{n:03d}'
            defaults = {
                'flow': 'OPERATIONS',
                'project': project,
                'department': None,
                'requested_by': requester,
                'front_area': 'Frente D - Estructuras Metálicas',
                'service': 'Habilitación de Estructuras',
                'specific_use': 'Materiales para estructura metálica de plataforma',
                'description': 'Planchas y perfiles metálicos para habilitación de estructura.',
                'justification': 'Avance de obra según cronograma vigente.',
                'acquisition_type': 'COMPRA_LOCAL',
                'priority': 'NORMAL',
                'status': status,
                'budget_line': budget_line,
                'estimated_cost': Decimal('7200.00'),
                'fecha_necesidad': self.today + timedelta(days=10),
            }
            if extra:
                defaults.update(extra)
            rq, created = self._get_or_create_request(rq_number, defaults)
            if created:
                self._create_items(rq, self._ops_items())
            return rq, created

        base = self.now - timedelta(days=30)

        # 1) DRAFT — not yet submitted, no approvals at all.
        rq, created = mkrq('DRAFT', {'estimated_cost': Decimal('0.00')})

        # 2) SUBMITTED — pending PROJECT_RESIDENT technical review.
        rq, created = mkrq('SUBMITTED')
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para revisión técnica del Residente.'),
            ], base)

        # 3) TECHNICAL_APPROVED — resident approved, pending Control budget classification.
        rq, created = mkrq('TECHNICAL_APPROVED')
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para revisión técnica.'),
                (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED', 'Especificaciones técnicas conformes.'),
            ], base)

        # 4) TECHNICAL_REJECTED — resident rejected (terminal).
        rq, created = mkrq('TECHNICAL_REJECTED')
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para revisión técnica.'),
                (resident, 'PROJECT_RESIDENT', 'TECHNICAL_REJECTED', 'SUBMITTED', 'TECHNICAL_REJECTED', 'Especificaciones incompletas. Se solicita corregir y volver a enviar.'),
            ], base)

        # 5) WITHIN_PROPOSAL — transient auto-state, shown mid-classification.
        rq, created = mkrq('WITHIN_PROPOSAL')
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para revisión técnica.'),
                (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED', 'Especificaciones técnicas conformes.'),
                (control, 'PROJECT_CONTROL', 'BUDGET_CLASSIFIED', 'TECHNICAL_APPROVED', 'WITHIN_PROPOSAL', 'Monto dentro del presupuesto de la partida Materiales.'),
            ], base)

        # 6) ADDITIONAL_REQ — classified as additional, pending resident approval to escalate to GM.
        rq, created = mkrq('ADDITIONAL_REQ', {'estimated_cost': Decimal('45000.00')})
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para revisión técnica.'),
                (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED', 'Especificaciones técnicas conformes.'),
                (control, 'PROJECT_CONTROL', 'BUDGET_CLASSIFIED', 'TECHNICAL_APPROVED', 'ADDITIONAL_REQ', 'Monto excede la propuesta original. Clasificado como adicional.'),
            ], base)

        # 7) GM_APPROVED — GM approved the additional (transient auto-state before VALIDATED).
        rq, created = mkrq('GM_APPROVED', {'estimated_cost': Decimal('52000.00')})
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para revisión técnica.'),
                (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED', 'Especificaciones técnicas conformes.'),
                (control, 'PROJECT_CONTROL', 'BUDGET_CLASSIFIED', 'TECHNICAL_APPROVED', 'ADDITIONAL_REQ', 'Monto excede la propuesta original. Clasificado como adicional.'),
                (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'ADDITIONAL_REQ', 'GM_REVIEW', 'Adicional justificado y enviado a Gerencia General.'),
                (gm, 'GENERAL_MANAGER', 'GM_APPROVED', 'GM_REVIEW', 'GM_APPROVED', 'Adicional aprobado por Gerencia General.'),
            ], base)

        # 8) GM_REJECTED — GM rejected the additional (terminal).
        rq, created = mkrq('GM_REJECTED', {'estimated_cost': Decimal('61000.00')})
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para revisión técnica.'),
                (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED', 'Especificaciones técnicas conformes.'),
                (control, 'PROJECT_CONTROL', 'BUDGET_CLASSIFIED', 'TECHNICAL_APPROVED', 'ADDITIONAL_REQ', 'Monto excede la propuesta original. Clasificado como adicional.'),
                (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'ADDITIONAL_REQ', 'GM_REVIEW', 'Adicional justificado y enviado a Gerencia General.'),
                (gm, 'GENERAL_MANAGER', 'GM_REJECTED', 'GM_REVIEW', 'GM_REJECTED', 'Adicional rechazado: no prioritario para el trimestre.'),
            ], base)

        validated_chain = [
            (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para revisión técnica.'),
            (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED', 'Especificaciones técnicas conformes.'),
            (control, 'PROJECT_CONTROL', 'BUDGET_CLASSIFIED', 'TECHNICAL_APPROVED', 'WITHIN_PROPOSAL', 'Monto dentro del presupuesto de la partida Materiales.'),
            (control, 'PROJECT_CONTROL', 'VALIDATED', 'WITHIN_PROPOSAL', 'VALIDATED', 'RQ validado para atención logística.'),
        ]

        # 9) IN_STOCK — logistics found stock available.
        rq, created = mkrq('IN_STOCK')
        if created:
            self._create_chain(rq, validated_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'STOCK_CHECKED', 'VALIDATED', 'IN_STOCK', 'Stock disponible en almacén central.'),
            ], base)

        # 10) REQUIRES_PURCHASE — logistics found no stock, needs purchase.
        rq, created = mkrq('REQUIRES_PURCHASE')
        if created:
            self._create_chain(rq, validated_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'STOCK_CHECKED', 'VALIDATED', 'REQUIRES_PURCHASE', 'Sin stock disponible. Se procede con compra.'),
            ], base)

        requires_purchase_chain = validated_chain + [
            (logistics, 'LOGISTICS_COORDINATOR', 'STOCK_CHECKED', 'VALIDATED', 'REQUIRES_PURCHASE', 'Sin stock disponible. Se procede con compra.'),
        ]

        # 11) QUOTE_COMPARISON — quotations requested and being compared.
        rq, created = mkrq('QUOTE_COMPARISON')
        if created:
            self._create_chain(rq, requires_purchase_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores habilitados.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON', 'Cotizaciones recibidas. Comparativo elaborado.'),
            ], base)
            self._create_quotations(rq, self._ops_items(), ['20100010101', '20100030303', '20100070707'])

        # 12) QUOTE_SELECTED — best quotation selected, pending cost approval.
        rq, created = mkrq('QUOTE_SELECTED')
        if created:
            self._create_chain(rq, requires_purchase_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores habilitados.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON', 'Cotizaciones recibidas. Comparativo elaborado.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_SELECTED', 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'Proveedor seleccionado: Aceros Arequipa S.A.'),
            ], base)
            self._create_quotations(
                rq, self._ops_items(), ['20100010101', '20100030303'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )

        # 13) QUOTE_COST_APPROVED — cost approved by Control, pending PO generation.
        rq, created = mkrq('QUOTE_COST_APPROVED')
        if created:
            self._create_chain(rq, requires_purchase_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores habilitados.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON', 'Cotizaciones recibidas. Comparativo elaborado.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_SELECTED', 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'Proveedor seleccionado: Aceros Arequipa S.A.'),
                (control, 'PROJECT_CONTROL', 'QUOTE_COST_APPROVED', 'QUOTE_SELECTED', 'QUOTE_COST_APPROVED', 'Costo dentro del presupuesto disponible en la partida.'),
            ], base)
            self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )

        # 14) COST_OVERRUN_REVIEW — cost rejected by Control, escalated to GM.
        rq, created = mkrq('COST_OVERRUN_REVIEW', {'estimated_cost': Decimal('7200.00')})
        if created:
            self._create_chain(rq, requires_purchase_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores habilitados.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON', 'Cotizaciones recibidas. Comparativo elaborado.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_SELECTED', 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'Proveedor seleccionado: Importadora Rex S.A.'),
                (control, 'PROJECT_CONTROL', 'QUOTE_COST_REJECTED', 'QUOTE_SELECTED', 'COST_OVERRUN_REVIEW', 'Costo excede el presupuesto de la partida. Escalado a GG.'),
            ], base)
            self._create_quotations(
                rq, self._ops_items(unit_price=Decimal('980.00')), ['20100070707'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )

        cost_overrun_chain_base = requires_purchase_chain + [
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores habilitados.'),
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON', 'Cotizaciones recibidas. Comparativo elaborado.'),
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_SELECTED', 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'Proveedor seleccionado: Importadora Rex S.A.'),
            (control, 'PROJECT_CONTROL', 'QUOTE_COST_REJECTED', 'QUOTE_SELECTED', 'COST_OVERRUN_REVIEW', 'Costo excede el presupuesto de la partida. Escalado a GG.'),
        ]

        # 15) COST_OVERRUN_APPROVED — GM approved the overrun, pending PO generation.
        rq, created = mkrq('COST_OVERRUN_APPROVED', {'estimated_cost': Decimal('7200.00')})
        if created:
            self._create_chain(rq, cost_overrun_chain_base + [
                (gm, 'GENERAL_MANAGER', 'COST_OVERRUN_APPROVED', 'COST_OVERRUN_REVIEW', 'COST_OVERRUN_APPROVED', 'Sobrecosto aprobado: proveedor único disponible con stock inmediato.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(unit_price=Decimal('980.00')), ['20100070707'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )

        # 16) COST_OVERRUN_REJECTED — GM rejected the overrun (terminal).
        rq, created = mkrq('COST_OVERRUN_REJECTED', {'estimated_cost': Decimal('7200.00')})
        if created:
            self._create_chain(rq, cost_overrun_chain_base + [
                (gm, 'GENERAL_MANAGER', 'COST_OVERRUN_REJECTED', 'COST_OVERRUN_REVIEW', 'COST_OVERRUN_REJECTED', 'Sobrecosto rechazado. Se solicita nueva ronda de cotizaciones.'),
            ], base)
            self._create_quotations(
                rq, self._ops_items(unit_price=Decimal('980.00')), ['20100070707'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )

        quote_cost_approved_chain = requires_purchase_chain + [
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores habilitados.'),
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON', 'Cotizaciones recibidas. Comparativo elaborado.'),
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_SELECTED', 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'Proveedor seleccionado: Aceros Arequipa S.A.'),
            (control, 'PROJECT_CONTROL', 'QUOTE_COST_APPROVED', 'QUOTE_SELECTED', 'QUOTE_COST_APPROVED', 'Costo dentro del presupuesto disponible en la partida.'),
        ]

        # 17) PO_GENERATED — purchase order generated, pending reception.
        rq, created = mkrq('PO_GENERATED')
        if created:
            self._create_chain(rq, quote_cost_approved_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'PO_GENERATED', 'QUOTE_COST_APPROVED', 'PO_GENERATED', 'OC generada dentro del presupuesto estimado.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            self._create_purchase_order(rq, quotations[0], logistics, 'SENT', expected_delivery_date=self.today + timedelta(days=5))

        po_generated_chain = quote_cost_approved_chain + [
            (logistics, 'LOGISTICS_COORDINATOR', 'PO_GENERATED', 'QUOTE_COST_APPROVED', 'PO_GENERATED', 'OC generada dentro del presupuesto estimado.'),
        ]

        # 18) RECEIVING — goods being received at central warehouse.
        rq, created = mkrq('RECEIVING')
        if created:
            self._create_chain(rq, po_generated_chain + [
                (central_wh, 'CENTRAL_WAREHOUSE', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Materiales recibidos en almacén central. En verificación.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'CONFIRMED', expected_delivery_date=self.today - timedelta(days=1))
            entry_group = self._create_entry_movement_group(rq, 'CENTRAL', project, central_wh, quotations[0].supplier.business_name)
            self._create_receipt(rq, po, central_wh, movement_group=entry_group)

        # 19) QUALITY_APPROVED — QC passed, pending dispatch to site.
        rq, created = mkrq('QUALITY_APPROVED')
        if created:
            self._create_chain(rq, po_generated_chain + [
                (central_wh, 'CENTRAL_WAREHOUSE', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Materiales recibidos en almacén central.'),
                (central_wh, 'CENTRAL_WAREHOUSE', 'QUALITY_APPROVED', 'RECEIVING', 'QUALITY_APPROVED', 'Control de calidad conforme.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'FULLY_RECEIVED', expected_delivery_date=self.today - timedelta(days=2), actual_delivery_date=self.today - timedelta(days=1))
            entry_group = self._create_entry_movement_group(rq, 'CENTRAL', project, central_wh, quotations[0].supplier.business_name)
            self._create_receipt(rq, po, central_wh, conformity_passed=True, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3), movement_group=entry_group)

        # 20) QUALITY_REJECTED — QC failed, before claim is sent.
        rq, created = mkrq('QUALITY_REJECTED')
        if created:
            self._create_chain(rq, po_generated_chain + [
                (central_wh, 'CENTRAL_WAREHOUSE', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Materiales recibidos en almacén central.'),
                (central_wh, 'CENTRAL_WAREHOUSE', 'QUALITY_REJECTED', 'RECEIVING', 'QUALITY_REJECTED', 'Piezas con defectos de fabricación. No conforme.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'PARTIALLY_RECEIVED', expected_delivery_date=self.today - timedelta(days=2))
            entry_group = self._create_entry_movement_group(rq, 'CENTRAL', project, central_wh, quotations[0].supplier.business_name)
            self._create_receipt(rq, po, central_wh, conformity_passed=False, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3), movement_group=entry_group)

        quality_rejected_chain = po_generated_chain + [
            (central_wh, 'CENTRAL_WAREHOUSE', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Materiales recibidos en almacén central.'),
            (central_wh, 'CENTRAL_WAREHOUSE', 'QUALITY_REJECTED', 'RECEIVING', 'QUALITY_REJECTED', 'Piezas con defectos de fabricación. No conforme.'),
        ]

        # 21) SUPPLIER_CLAIM_SENT — claim sent to supplier.
        rq, created = mkrq('SUPPLIER_CLAIM_SENT')
        if created:
            self._create_chain(rq, quality_rejected_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'SUPPLIER_CLAIM_SENT', 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'Reclamo enviado al proveedor por no conformidad.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'PARTIALLY_RECEIVED')
            self._create_receipt(rq, po, central_wh, conformity_passed=False, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3))
            self._create_claim(
                rq, 'SUPPLIER_CLAIM', requester, logistics, 'OPEN',
                'Piezas metálicas recibidas con corrosión visible y medidas fuera de tolerancia.',
            )

        # 22) SUPPLIER_CLAIM_PENDING — waiting on supplier response.
        rq, created = mkrq('SUPPLIER_CLAIM_PENDING')
        if created:
            self._create_chain(rq, quality_rejected_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'SUPPLIER_CLAIM_SENT', 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'Reclamo enviado al proveedor por no conformidad.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'SUPPLIER_CLAIM_UPDATED', 'SUPPLIER_CLAIM_SENT', 'SUPPLIER_CLAIM_PENDING', 'Proveedor confirmó recepción del reclamo. En evaluación.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'PARTIALLY_RECEIVED')
            self._create_receipt(rq, po, central_wh, conformity_passed=False, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3))
            self._create_claim(
                rq, 'SUPPLIER_CLAIM', requester, logistics, 'IN_REVIEW',
                'Piezas metálicas recibidas con corrosión visible y medidas fuera de tolerancia.',
            )

        # 23) SUPPLIER_REPLACEMENT_RECEIVED — supplier sent replacement, pending re-QC.
        rq, created = mkrq('SUPPLIER_REPLACEMENT_RECEIVED')
        if created:
            self._create_chain(rq, quality_rejected_chain + [
                (logistics, 'LOGISTICS_COORDINATOR', 'SUPPLIER_CLAIM_SENT', 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'Reclamo enviado al proveedor por no conformidad.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'SUPPLIER_REPLACEMENT_RECEIVED', 'SUPPLIER_CLAIM_SENT', 'SUPPLIER_REPLACEMENT_RECEIVED', 'Reposición recibida del proveedor. Pendiente nuevo control de calidad.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'FULLY_RECEIVED')
            self._create_receipt(rq, po, central_wh, conformity_passed=False, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3))
            self._create_claim(
                rq, 'SUPPLIER_CLAIM', requester, logistics, 'RESOLVED',
                'Piezas metálicas recibidas con corrosión visible y medidas fuera de tolerancia.',
                resolution='Proveedor envió lote de reposición sin costo adicional.',
                resolved_by=logistics, resolved_at=base + timedelta(days=10),
            )

        quality_approved_chain = po_generated_chain + [
            (central_wh, 'CENTRAL_WAREHOUSE', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Materiales recibidos en almacén central.'),
            (central_wh, 'CENTRAL_WAREHOUSE', 'QUALITY_APPROVED', 'RECEIVING', 'QUALITY_APPROVED', 'Control de calidad conforme.'),
        ]

        # 24) DISPATCHED_TO_SITE — dispatched from central warehouse to site.
        rq, created = mkrq('DISPATCHED_TO_SITE')
        if created:
            self._create_chain(rq, quality_approved_chain + [
                (central_wh, 'CENTRAL_WAREHOUSE', 'DISPATCHED', 'QUALITY_APPROVED', 'DISPATCHED_TO_SITE', 'Materiales despachados a almacén de obra.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, central_wh, conformity_passed=True, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3))
            self._create_dispatch(rq, receipt, central_wh, 'CENTRAL', dest_project=project)

        # 25) DELIVERED — delivered at site warehouse.
        rq, created = mkrq('DELIVERED')
        if created:
            self._create_chain(rq, quality_approved_chain + [
                (central_wh, 'CENTRAL_WAREHOUSE', 'DISPATCHED', 'QUALITY_APPROVED', 'DISPATCHED_TO_SITE', 'Materiales despachados a almacén de obra.'),
                (site_wh, 'SITE_WAREHOUSE', 'DELIVERED', 'DISPATCHED_TO_SITE', 'DELIVERED', 'Materiales recibidos en almacén de obra y registrados en kardex.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, central_wh, conformity_passed=True, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3))
            self._create_dispatch(rq, receipt, central_wh, 'CENTRAL', dest_project=project, delivered_at=base + timedelta(days=8), accepted_by=site_wh)

        delivered_chain = quality_approved_chain + [
            (central_wh, 'CENTRAL_WAREHOUSE', 'DISPATCHED', 'QUALITY_APPROVED', 'DISPATCHED_TO_SITE', 'Materiales despachados a almacén de obra.'),
            (site_wh, 'SITE_WAREHOUSE', 'DELIVERED', 'DISPATCHED_TO_SITE', 'DELIVERED', 'Materiales recibidos en almacén de obra y registrados en kardex.'),
        ]

        # 26) USER_CONFORMITY — requester confirmed the delivery.
        rq, created = mkrq('USER_CONFORMITY')
        if created:
            self._create_chain(rq, delivered_chain + [
                (requester, 'REQUESTER', 'USER_CONFIRMED', 'DELIVERED', 'USER_CONFORMITY', 'Recepción conforme. Materiales en buenas condiciones.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, central_wh, conformity_passed=True, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3))
            self._create_dispatch(rq, receipt, central_wh, 'CENTRAL', dest_project=project, delivered_at=base + timedelta(days=8), accepted_by=site_wh)

        # 27) CLAIM_IN_REVIEW — requester filed a complaint about the delivery.
        rq, created = mkrq('CLAIM_IN_REVIEW')
        if created:
            self._create_chain(rq, delivered_chain + [
                (requester, 'REQUESTER', 'USER_CLAIMED', 'DELIVERED', 'CLAIM_IN_REVIEW', 'Cantidad entregada no coincide con lo solicitado. Se registra reclamo.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, central_wh, conformity_passed=True, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3))
            self._create_dispatch(rq, receipt, central_wh, 'CENTRAL', dest_project=project, delivered_at=base + timedelta(days=8), accepted_by=site_wh)
            self._create_claim(
                rq, 'USER_COMPLAINT', requester, logistics, 'IN_REVIEW',
                'Se entregaron 15 planchas en lugar de las 20 solicitadas.',
            )

        # 28) CLOSED (extra OPS instance, different project, for variety) — full happy path.
        rq, created = mkrq('CLOSED', {
            'final_cost': Decimal('6980.00'),
            'fecha_estimada_entrega': self.today - timedelta(days=3),
            'fecha_real_entrega': self.today - timedelta(days=2),
        })
        if created:
            self._create_chain(rq, delivered_chain + [
                (requester, 'REQUESTER', 'USER_CONFIRMED', 'DELIVERED', 'USER_CONFORMITY', 'Recepción conforme. Materiales en buenas condiciones.'),
                (logistics, 'LOGISTICS_COORDINATOR', 'CLOSED', 'USER_CONFORMITY', 'CLOSED', 'RQ cerrado exitosamente. Proceso completado.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._ops_items(), ['20100010101'],
                selected_index=0, selected_by=logistics, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, central_wh, conformity_passed=True, conformity_by=central_wh, conformity_at=base + timedelta(days=6, hours=3))
            self._create_dispatch(rq, receipt, central_wh, 'CENTRAL', dest_project=project, delivered_at=base + timedelta(days=8), accepted_by=site_wh)

        # 29) CANCELLED — cancelled mid-flight from VALIDATED.
        rq, created = mkrq('CANCELLED', {'estimated_cost': Decimal('3100.00')})
        if created:
            self._create_chain(rq, validated_chain + [
                (control, 'PROJECT_CONTROL', 'CANCELLED', 'VALIDATED', 'CANCELLED', 'Requerimiento cancelado: cambio de alcance del frente de trabajo.'),
            ], base)

    # =====================================================================
    # ADMINISTRATIVE flow — one request per remaining target status
    # =====================================================================

    def _build_administrative_requests(self):
        u = self.u
        requester = u.get('ncastro') or u.get('dmorales')
        supervisor = u.get('ecordova') or u.get('svargas')
        admin_manager = u.get('fchavez')
        gm = u.get('aperez')
        logistics_sup = u.get('atorres')
        logistics_chief = u.get('jhernandez')
        central_wh = u.get('aquispe') or u.get('lmendoza')

        department = self.d.get('TI')
        annual_plan_line = department.annual_plans.filter(year=2026).first().lines.first() if department and department.annual_plans.filter(year=2026).exists() else None

        n = 1000

        def mkrq(status, extra=None):
            nonlocal n
            n += 1
            rq_number = f'RQ-2026-2{n:03d}'
            defaults = {
                'flow': 'ADMINISTRATIVE',
                'project': None,
                'department': department,
                'requested_by': requester,
                'service': 'Renovación de Mobiliario',
                'specific_use': 'Mobiliario para nueva área de soporte técnico',
                'description': 'Sillas y archivadores para la nueva área de soporte técnico de TI.',
                'justification': 'Habilitación de nuevo puesto de trabajo según plan de crecimiento del área.',
                'acquisition_type': 'COMPRA_LOCAL',
                'priority': 'NORMAL',
                'status': status,
                'annual_plan_line': annual_plan_line,
                'estimated_cost': Decimal('570.00'),
                'fecha_necesidad': self.today + timedelta(days=12),
            }
            if extra:
                defaults.update(extra)
            rq, created = self._get_or_create_request(rq_number, defaults)
            if created:
                self._create_items(rq, self._adm_items())
            return rq, created

        base = self.now - timedelta(days=25)

        # 30) SUBMITTED (ADM) — pending DIRECT_SUPERVISOR review.
        rq, created = mkrq('SUBMITTED')
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
            ], base)

        # 31) SUPERVISOR_APPROVED — supervisor approved, pending ADMIN_MANAGER budget review.
        rq, created = mkrq('SUPERVISOR_APPROVED')
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'Necesidad justificada. Aprobado.'),
            ], base)

        # 32) SUPERVISOR_REJECTED — supervisor rejected (terminal).
        rq, created = mkrq('SUPERVISOR_REJECTED')
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_REJECTED', 'SUBMITTED', 'SUPERVISOR_REJECTED', 'No se justifica la compra en este trimestre.'),
            ], base)

        # 33) WITHIN_ANNUAL_PLAN — transient auto-state.
        rq, created = mkrq('WITHIN_ANNUAL_PLAN')
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'Necesidad justificada. Aprobado.'),
                (admin_manager, 'ADMIN_MANAGER', 'ADMIN_BUDGET_REVIEWED', 'SUPERVISOR_APPROVED', 'WITHIN_ANNUAL_PLAN', 'Monto dentro del Plan Anual 2026 del área.'),
            ], base)

        # 34) OUT_OF_ANNUAL_PLAN — pending supervisor re-approval for escalation to GM.
        rq, created = mkrq('OUT_OF_ANNUAL_PLAN', {'estimated_cost': Decimal('38000.00')})
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'Necesidad justificada. Aprobado.'),
                (admin_manager, 'ADMIN_MANAGER', 'ADMIN_BUDGET_REVIEWED', 'SUPERVISOR_APPROVED', 'OUT_OF_ANNUAL_PLAN', 'Monto excede el Plan Anual 2026. Requiere aprobación de GG.'),
            ], base)

        # 35) GM_REVIEW (ADM path) — pending GM decision.
        rq, created = mkrq('GM_REVIEW', {'estimated_cost': Decimal('42000.00')})
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'Necesidad justificada. Aprobado.'),
                (admin_manager, 'ADMIN_MANAGER', 'ADMIN_BUDGET_REVIEWED', 'SUPERVISOR_APPROVED', 'OUT_OF_ANNUAL_PLAN', 'Monto excede el Plan Anual 2026. Requiere aprobación de GG.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'OUT_OF_ANNUAL_PLAN', 'GM_REVIEW', 'Fuera de plan justificado y enviado a Gerencia General.'),
            ], base)

        # 36) GM_REJECTED (ADM path) — GM rejected the out-of-plan request (terminal).
        rq, created = mkrq('GM_REJECTED', {'estimated_cost': Decimal('55000.00')})
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'Necesidad justificada. Aprobado.'),
                (admin_manager, 'ADMIN_MANAGER', 'ADMIN_BUDGET_REVIEWED', 'SUPERVISOR_APPROVED', 'OUT_OF_ANNUAL_PLAN', 'Monto excede el Plan Anual 2026. Requiere aprobación de GG.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'OUT_OF_ANNUAL_PLAN', 'GM_REVIEW', 'Fuera de plan justificado y enviado a Gerencia General.'),
                (gm, 'GENERAL_MANAGER', 'GM_REJECTED', 'GM_REVIEW', 'GM_REJECTED', 'Rechazado: no prioritario dado el presupuesto anual restante.'),
            ], base)

        validated_chain = [
            (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
            (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'Necesidad justificada. Aprobado.'),
            (admin_manager, 'ADMIN_MANAGER', 'ADMIN_BUDGET_REVIEWED', 'SUPERVISOR_APPROVED', 'WITHIN_ANNUAL_PLAN', 'Monto dentro del Plan Anual 2026 del área.'),
            (admin_manager, 'ADMIN_MANAGER', 'VALIDATED', 'WITHIN_ANNUAL_PLAN', 'VALIDATED', 'RQ validado para atención logística.'),
        ]

        # 37) DELIVERED (ADM, direct IN_STOCK path) — Central Warehouse delivers straight from stock.
        rq, created = mkrq('DELIVERED')
        if created:
            self._create_chain(rq, validated_chain + [
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'STOCK_CHECKED', 'VALIDATED', 'IN_STOCK', 'Stock disponible en almacén central.'),
                (central_wh, 'CENTRAL_WAREHOUSE', 'DELIVERED', 'IN_STOCK', 'DELIVERED', 'Mobiliario entregado directamente desde almacén central.'),
            ], base)
            exit_group = self._create_exit_movement_group(
                rq, 'CENTRAL', None, department, central_wh,
                'DEPARTMENT', department.name if department else 'Departamento',
            )
            self._create_dispatch(rq, None, central_wh, 'CENTRAL', dest_department=department, delivered_at=base + timedelta(days=2), accepted_by=requester, movement_group=exit_group)

        requires_purchase_chain = validated_chain + [
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'STOCK_CHECKED', 'VALIDATED', 'REQUIRES_PURCHASE', 'Sin stock disponible. Se procede con compra.'),
        ]

        # 38) QUOTING (ADM instance, for extra variety on the Jefe Logístico screen).
        rq, created = mkrq('QUOTING', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, requires_purchase_chain + [
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores de mobiliario.'),
            ], base)

        # 39) QUOTE_COMPARISON (ADM) — Jefe Logístico comparing quotations.
        rq, created = mkrq('QUOTE_COMPARISON', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, requires_purchase_chain + [
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores de mobiliario.'),
                (logistics_chief, 'LOGISTICS_CHIEF', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON', 'Tres cotizaciones recibidas. Comparativo elaborado.'),
            ], base)
            self._create_quotations(rq, self._adm_items(), ['20100030303', '20100050505'])

        adm_quote_comparison_chain = requires_purchase_chain + [
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING', 'Cotizaciones solicitadas a proveedores de mobiliario.'),
            (logistics_chief, 'LOGISTICS_CHIEF', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON', 'Tres cotizaciones recibidas. Comparativo elaborado.'),
        ]

        # 40) RECEIVING (ADM) — goods being received / verified by Logistics Supervisor.
        rq, created = mkrq('RECEIVING', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_quote_comparison_chain + [
                (logistics_chief, 'LOGISTICS_CHIEF', 'QUOTE_SELECTED', 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'Seleccionado proveedor con mejor relación precio-calidad.'),
                (admin_manager, 'ADMIN_MANAGER', 'QUOTE_COST_APPROVED', 'QUOTE_SELECTED', 'QUOTE_COST_APPROVED', 'Costo dentro del presupuesto planificado.'),
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'PO_GENERATED', 'QUOTE_COST_APPROVED', 'PO_GENERATED', 'OC generada dentro del presupuesto planificado.'),
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Mobiliario recibido en oficina administrativa.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            self._create_purchase_order(rq, quotations[0], logistics_sup, 'CONFIRMED', expected_delivery_date=self.today + timedelta(days=3))

        adm_po_generated_chain = adm_quote_comparison_chain + [
            (logistics_chief, 'LOGISTICS_CHIEF', 'QUOTE_SELECTED', 'QUOTE_COMPARISON', 'QUOTE_SELECTED', 'Seleccionado proveedor con mejor relación precio-calidad.'),
            (admin_manager, 'ADMIN_MANAGER', 'QUOTE_COST_APPROVED', 'QUOTE_SELECTED', 'QUOTE_COST_APPROVED', 'Costo dentro del presupuesto planificado.'),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'PO_GENERATED', 'QUOTE_COST_APPROVED', 'PO_GENERATED', 'OC generada dentro del presupuesto planificado.'),
        ]

        # 41) QUALITY_REJECTED (ADM) — reception QC failed.
        rq, created = mkrq('QUALITY_REJECTED', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_po_generated_chain + [
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Mobiliario recibido en oficina administrativa.'),
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'QUALITY_REJECTED', 'RECEIVING', 'QUALITY_REJECTED', 'Sillas con soporte lumbar defectuoso. No conforme.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'PARTIALLY_RECEIVED')
            self._create_receipt(rq, po, logistics_sup, conformity_passed=False, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))

        # 42) SUPPLIER_CLAIM_SENT (ADM) — claim sent to supplier.
        rq, created = mkrq('SUPPLIER_CLAIM_SENT', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_po_generated_chain + [
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Mobiliario recibido en oficina administrativa.'),
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'QUALITY_REJECTED', 'RECEIVING', 'QUALITY_REJECTED', 'Sillas con soporte lumbar defectuoso. No conforme.'),
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'SUPPLIER_CLAIM_SENT', 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'Reclamo enviado al proveedor.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'PARTIALLY_RECEIVED')
            self._create_receipt(rq, po, logistics_sup, conformity_passed=False, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))
            self._create_claim(rq, 'SUPPLIER_CLAIM', requester, logistics_sup, 'OPEN', 'Sillas con soporte lumbar defectuoso, mecanismo de altura no funciona.')

        adm_quality_rejected_chain = adm_po_generated_chain + [
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Mobiliario recibido en oficina administrativa.'),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'QUALITY_REJECTED', 'RECEIVING', 'QUALITY_REJECTED', 'Sillas con soporte lumbar defectuoso. No conforme.'),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'SUPPLIER_CLAIM_SENT', 'QUALITY_REJECTED', 'SUPPLIER_CLAIM_SENT', 'Reclamo enviado al proveedor.'),
        ]

        # 43) SUPPLIER_REPLACEMENT_RECEIVED (ADM, direct path) — replacement received, pending re-QC.
        rq, created = mkrq('SUPPLIER_REPLACEMENT_RECEIVED', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_quality_rejected_chain + [
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'SUPPLIER_REPLACEMENT_RECEIVED', 'SUPPLIER_CLAIM_SENT', 'SUPPLIER_REPLACEMENT_RECEIVED', 'Reposición recibida. Pendiente nuevo control de calidad.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'FULLY_RECEIVED')
            self._create_receipt(rq, po, logistics_sup, conformity_passed=False, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))
            self._create_claim(
                rq, 'SUPPLIER_CLAIM', requester, logistics_sup, 'RESOLVED',
                'Sillas con soporte lumbar defectuoso, mecanismo de altura no funciona.',
                resolution='Proveedor envió lote de reposición sin costo adicional.',
                resolved_by=logistics_sup, resolved_at=base + timedelta(days=9),
            )

        adm_quality_approved_chain = adm_po_generated_chain + [
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'RECEIVED', 'PO_GENERATED', 'RECEIVING', 'Mobiliario recibido en oficina administrativa.'),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'QUALITY_APPROVED', 'RECEIVING', 'QUALITY_APPROVED', 'Control de calidad conforme.'),
        ]

        # 44) QUALITY_APPROVED (ADM) — QC passed, pending dispatch.
        rq, created = mkrq('QUALITY_APPROVED', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_quality_approved_chain, base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'FULLY_RECEIVED')
            self._create_receipt(rq, po, logistics_sup, conformity_passed=True, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))

        # 45) DISPATCHED_TO_SITE (ADM) — dispatched to department.
        rq, created = mkrq('DISPATCHED_TO_SITE', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_quality_approved_chain + [
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'DISPATCHED', 'QUALITY_APPROVED', 'DISPATCHED_TO_SITE', 'Mobiliario despachado al área de TI.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, logistics_sup, conformity_passed=True, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))
            self._create_dispatch(rq, receipt, logistics_sup, 'CENTRAL', dest_department=department)

        adm_dispatched_chain = adm_quality_approved_chain + [
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'DISPATCHED', 'QUALITY_APPROVED', 'DISPATCHED_TO_SITE', 'Mobiliario despachado al área de TI.'),
        ]

        # 46) WAREHOUSE_UPDATED — Central Warehouse updated records after delivery.
        rq, created = mkrq('WAREHOUSE_UPDATED', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_dispatched_chain + [
                (central_wh, 'CENTRAL_WAREHOUSE', 'DELIVERED', 'DISPATCHED_TO_SITE', 'DELIVERED', 'Mobiliario entregado y recibido conforme.'),
                (central_wh, 'CENTRAL_WAREHOUSE', 'WAREHOUSE_RECORDS_UPDATED', 'DELIVERED', 'WAREHOUSE_UPDATED', 'Registros de almacén actualizados correctamente.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, logistics_sup, conformity_passed=True, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))
            self._create_dispatch(rq, receipt, logistics_sup, 'CENTRAL', dest_department=department, delivered_at=base + timedelta(days=7), accepted_by=requester)

        adm_warehouse_updated_chain = adm_dispatched_chain + [
            (central_wh, 'CENTRAL_WAREHOUSE', 'DELIVERED', 'DISPATCHED_TO_SITE', 'DELIVERED', 'Mobiliario entregado y recibido conforme.'),
            (central_wh, 'CENTRAL_WAREHOUSE', 'WAREHOUSE_RECORDS_UPDATED', 'DELIVERED', 'WAREHOUSE_UPDATED', 'Registros de almacén actualizados correctamente.'),
        ]

        # 47) USER_CONFORMITY (ADM) — requester confirmed.
        rq, created = mkrq('USER_CONFORMITY', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_warehouse_updated_chain + [
                (requester, 'REQUESTER', 'USER_CONFIRMED', 'WAREHOUSE_UPDATED', 'USER_CONFORMITY', 'Mobiliario recibido conforme.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, logistics_sup, conformity_passed=True, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))
            self._create_dispatch(rq, receipt, logistics_sup, 'CENTRAL', dest_department=department, delivered_at=base + timedelta(days=7), accepted_by=requester)

        # 48) CLAIM_IN_REVIEW (ADM) — requester complaint under review.
        rq, created = mkrq('CLAIM_IN_REVIEW', {'estimated_cost': Decimal('890.00')})
        if created:
            self._create_chain(rq, adm_warehouse_updated_chain + [
                (requester, 'REQUESTER', 'USER_CLAIMED', 'WAREHOUSE_UPDATED', 'CLAIM_IN_REVIEW', 'Un archivador llegó con la cerradura dañada.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, logistics_sup, conformity_passed=True, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))
            self._create_dispatch(rq, receipt, logistics_sup, 'CENTRAL', dest_department=department, delivered_at=base + timedelta(days=7), accepted_by=requester)
            self._create_claim(rq, 'USER_COMPLAINT', requester, logistics_sup, 'IN_REVIEW', 'Un archivador llegó con la cerradura dañada.')

        # 49) CLOSED (ADM, extra instance for variety).
        rq, created = mkrq('CLOSED', {
            'estimated_cost': Decimal('890.00'),
            'final_cost': Decimal('865.00'),
            'fecha_estimada_entrega': self.today - timedelta(days=4),
            'fecha_real_entrega': self.today - timedelta(days=3),
        })
        if created:
            self._create_chain(rq, adm_warehouse_updated_chain + [
                (requester, 'REQUESTER', 'USER_CONFIRMED', 'WAREHOUSE_UPDATED', 'USER_CONFORMITY', 'Mobiliario recibido conforme.'),
                (logistics_sup, 'LOGISTICS_SUPERVISOR', 'CLOSED', 'USER_CONFORMITY', 'CLOSED', 'RQ cerrado. Proceso administrativo completado.'),
            ], base)
            quotations = self._create_quotations(
                rq, self._adm_items(), ['20100030303'],
                selected_index=0, selected_by=logistics_chief, selected_at=base + timedelta(days=3),
            )
            po = self._create_purchase_order(rq, quotations[0], logistics_sup, 'FULLY_RECEIVED')
            receipt = self._create_receipt(rq, po, logistics_sup, conformity_passed=True, conformity_by=logistics_sup, conformity_at=base + timedelta(days=7, hours=2))
            self._create_dispatch(rq, receipt, logistics_sup, 'CENTRAL', dest_department=department, delivered_at=base + timedelta(days=7), accepted_by=requester)

        # 50) CANCELLED (ADM instance) — cancelled mid-flight from SUBMITTED.
        rq, created = mkrq('CANCELLED', {'estimated_cost': Decimal('310.00')})
        if created:
            self._create_chain(rq, [
                (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED', 'RQ enviado para aprobación del Jefe Directo.'),
                (supervisor, 'DIRECT_SUPERVISOR', 'CANCELLED', 'SUBMITTED', 'CANCELLED', 'Solicitud cancelada: ya no se requiere el mobiliario.'),
            ], base)
