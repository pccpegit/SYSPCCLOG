"""
Management command to seed demo users, projects, departments,
suppliers, and sample requests for the SYSPCCLOG RQ System.

Creates realistic demo data matching the MOCK_USERS from the React frontend.
Safe to run multiple times (idempotent via get_or_create).

Usage:
    python manage.py seed_demo
    python manage.py seed_demo --clear   # Delete demo data and re-create
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone


DEMO_PASSWORD = 'Demo2026Pcc!'

# ---------------------------------------------------------------------------
# Demo users data
# ---------------------------------------------------------------------------

DEMO_USERS = [
    {
        'username': 'jrodriguez',
        'first_name': 'Juan',
        'last_name': 'Rodríguez',
        'email': 'jrodriguez@pcc.pe',
        'position': 'Ingeniero de Campo',
        'department': 'Proyectos',
        'roles': [
            {'role': 'REQUESTER', 'is_primary': True},
        ],
    },
    {
        'username': 'mcastillo',
        'first_name': 'María',
        'last_name': 'Castillo',
        'email': 'mcastillo@pcc.pe',
        'position': 'Residente de Proyecto',
        'department': 'Proyectos',
        'roles': [
            {'role': 'PROJECT_RESIDENT', 'is_primary': True},
        ],
    },
    {
        'username': 'clopez',
        'first_name': 'Carlos',
        'last_name': 'López',
        'email': 'clopez@pcc.pe',
        'position': 'Jefe de Control',
        'department': 'Control de Proyecto',
        'roles': [
            {'role': 'PROJECT_CONTROL', 'is_primary': True},
        ],
    },
    {
        'username': 'aperez',
        'first_name': 'Ana',
        'last_name': 'Pérez',
        'email': 'aperez@pcc.pe',
        'position': 'Gerente General',
        'department': 'Gerencia',
        'roles': [
            {'role': 'GENERAL_MANAGER', 'is_primary': True},
        ],
    },
    {
        'username': 'rgarcia',
        'first_name': 'Roberto',
        'last_name': 'García',
        'email': 'rgarcia@pcc.pe',
        'position': 'Coord. Logístico',
        'department': 'Logística',
        'roles': [
            {'role': 'LOGISTICS_COORDINATOR', 'is_primary': True},
        ],
    },
    {
        'username': 'lmendoza',
        'first_name': 'Luis',
        'last_name': 'Mendoza',
        'email': 'lmendoza@pcc.pe',
        'position': 'Jefe de Almacén Central',
        'department': 'Almacén',
        'roles': [
            {'role': 'CENTRAL_WAREHOUSE', 'is_primary': True},
        ],
    },
    {
        'username': 'psalas',
        'first_name': 'Patricia',
        'last_name': 'Salas',
        'email': 'psalas@pcc.pe',
        'position': 'Almacenera de Obra',
        'department': 'Almacén',
        'roles': [
            {'role': 'SITE_WAREHOUSE', 'is_primary': True},
        ],
    },
    {
        'username': 'dmorales',
        'first_name': 'Diego',
        'last_name': 'Morales',
        'email': 'dmorales@pcc.pe',
        'position': 'Analista Administrativo',
        'department': 'Administración',
        'roles': [
            {'role': 'REQUESTER', 'is_primary': True},
        ],
    },
    {
        'username': 'svargas',
        'first_name': 'Sandra',
        'last_name': 'Vargas',
        'email': 'svargas@pcc.pe',
        'position': 'Jefa de RRHH',
        'department': 'Recursos Humanos',
        'roles': [
            {'role': 'DIRECT_SUPERVISOR', 'is_primary': True},
        ],
    },
    {
        'username': 'fchavez',
        'first_name': 'Fernando',
        'last_name': 'Chávez',
        'email': 'fchavez@pcc.pe',
        'position': 'Gerente Administrativo',
        'department': 'Administración',
        'roles': [
            {'role': 'ADMIN_MANAGER', 'is_primary': True},
        ],
    },
    {
        'username': 'atorres',
        'first_name': 'Andrea',
        'last_name': 'Torres',
        'email': 'atorres@pcc.pe',
        'position': 'Supervisor Logístico',
        'department': 'Logística',
        'roles': [
            {'role': 'LOGISTICS_SUPERVISOR', 'is_primary': True},
        ],
    },
    {
        'username': 'jhernandez',
        'first_name': 'Jorge',
        'last_name': 'Hernández',
        'email': 'jhernandez@pcc.pe',
        'position': 'Jefe Logístico',
        'department': 'Logística',
        'roles': [
            {'role': 'LOGISTICS_CHIEF', 'is_primary': True},
        ],
    },
]

# ---------------------------------------------------------------------------
# Projects data (Operations flow)
# ---------------------------------------------------------------------------

DEMO_PROJECTS = [
    {
        'code': 'PROY-2026-001',
        'name': 'Centro Comercial Plaza Norte Fase II',
        'location': 'Lima',
        'client': 'Inversiones Norte S.A.',
        'total_budget': Decimal('15000000.00'),
        'start_date': date(2026, 1, 15),
        'end_date': date(2027, 6, 30),
        'budget_lines': [
            {
                'code': 'PROY-001-MAT',
                'description': 'Materiales de Construcción',
                'budgeted_amount': Decimal('6000000.00'),
            },
            {
                'code': 'PROY-001-EQP',
                'description': 'Equipos y Herramientas',
                'budgeted_amount': Decimal('3500000.00'),
            },
            {
                'code': 'PROY-001-MO',
                'description': 'Mano de Obra',
                'budgeted_amount': Decimal('4000000.00'),
            },
            {
                'code': 'PROY-001-SUB',
                'description': 'Subcontratos',
                'budgeted_amount': Decimal('1500000.00'),
            },
        ],
    },
    {
        'code': 'PROY-2026-002',
        'name': 'Residencial Los Jardines',
        'location': 'Arequipa',
        'client': 'Constructora Sur S.A.C.',
        'total_budget': Decimal('8500000.00'),
        'start_date': date(2026, 2, 1),
        'end_date': date(2027, 3, 31),
        'budget_lines': [
            {
                'code': 'PROY-002-MAT',
                'description': 'Materiales de Construcción',
                'budgeted_amount': Decimal('3200000.00'),
            },
            {
                'code': 'PROY-002-EQP',
                'description': 'Equipos y Herramientas',
                'budgeted_amount': Decimal('1800000.00'),
            },
            {
                'code': 'PROY-002-MO',
                'description': 'Mano de Obra',
                'budgeted_amount': Decimal('2500000.00'),
            },
            {
                'code': 'PROY-002-ACA',
                'description': 'Acabados e Instalaciones',
                'budgeted_amount': Decimal('1000000.00'),
            },
        ],
    },
    {
        'code': 'PROY-2026-003',
        'name': 'Puente Río Mantaro',
        'location': 'Huancayo',
        'client': 'MTC - Provías Nacional',
        'total_budget': Decimal('22000000.00'),
        'start_date': date(2026, 3, 1),
        'end_date': date(2028, 2, 28),
        'budget_lines': [
            {
                'code': 'PROY-003-EST',
                'description': 'Estructura Metálica y Concreto',
                'budgeted_amount': Decimal('10000000.00'),
            },
            {
                'code': 'PROY-003-EQP',
                'description': 'Equipos Especializados',
                'budgeted_amount': Decimal('5000000.00'),
            },
            {
                'code': 'PROY-003-MO',
                'description': 'Mano de Obra Especializada',
                'budgeted_amount': Decimal('5500000.00'),
            },
            {
                'code': 'PROY-003-SUB',
                'description': 'Subcontratos Especializados',
                'budgeted_amount': Decimal('1500000.00'),
            },
        ],
    },
]

# ---------------------------------------------------------------------------
# Departments data (Administrative flow)
# ---------------------------------------------------------------------------

DEMO_DEPARTMENTS = [
    {'code': 'ADM', 'name': 'Administración', 'manager_username': 'fchavez'},
    {'code': 'RRHH', 'name': 'Recursos Humanos', 'manager_username': 'svargas'},
    {'code': 'TI', 'name': 'Tecnología de la Información', 'manager_username': None},
    {'code': 'CONT', 'name': 'Contabilidad', 'manager_username': None},
    {'code': 'LOG', 'name': 'Logística', 'manager_username': 'atorres'},
]

ANNUAL_PLAN_LINES_BY_DEPT = {
    'ADM': [
        {
            'code': 'ADM-MAT',
            'description': 'Materiales de Oficina y Papelería',
            'category': 'Materiales de Oficina',
            'budgeted_amount': Decimal('25000.00'),
        },
        {
            'code': 'ADM-EQP',
            'description': 'Equipos y Mobiliario de Oficina',
            'category': 'Equipos',
            'budgeted_amount': Decimal('40000.00'),
        },
        {
            'code': 'ADM-SVC',
            'description': 'Servicios Administrativos Generales',
            'category': 'Servicios',
            'budgeted_amount': Decimal('15000.00'),
        },
    ],
    'RRHH': [
        {
            'code': 'RRHH-CAP',
            'description': 'Capacitación y Desarrollo del Personal',
            'category': 'Capacitación',
            'budgeted_amount': Decimal('35000.00'),
        },
        {
            'code': 'RRHH-MAT',
            'description': 'Materiales de Bienestar y Salud Ocupacional',
            'category': 'Bienestar',
            'budgeted_amount': Decimal('18000.00'),
        },
    ],
    'TI': [
        {
            'code': 'TI-HW',
            'description': 'Hardware y Equipos de Cómputo',
            'category': 'Hardware',
            'budgeted_amount': Decimal('80000.00'),
        },
        {
            'code': 'TI-SW',
            'description': 'Licencias de Software',
            'category': 'Software',
            'budgeted_amount': Decimal('30000.00'),
        },
        {
            'code': 'TI-SVC',
            'description': 'Servicios y Mantenimiento TI',
            'category': 'Servicios TI',
            'budgeted_amount': Decimal('20000.00'),
        },
    ],
    'CONT': [
        {
            'code': 'CONT-SW',
            'description': 'Software Contable y ERP',
            'category': 'Software',
            'budgeted_amount': Decimal('22000.00'),
        },
        {
            'code': 'CONT-MAT',
            'description': 'Materiales y Útiles Contables',
            'category': 'Materiales',
            'budgeted_amount': Decimal('8000.00'),
        },
    ],
    'LOG': [
        {
            'code': 'LOG-EQP',
            'description': 'Equipos de Almacén y Manipuleo',
            'category': 'Equipos Logísticos',
            'budgeted_amount': Decimal('55000.00'),
        },
        {
            'code': 'LOG-MAT',
            'description': 'Materiales de Embalaje y Almacenamiento',
            'category': 'Materiales Logísticos',
            'budgeted_amount': Decimal('12000.00'),
        },
        {
            'code': 'LOG-SVC',
            'description': 'Servicios de Transporte y Distribución',
            'category': 'Transporte',
            'budgeted_amount': Decimal('30000.00'),
        },
    ],
}

# ---------------------------------------------------------------------------
# Suppliers data
# ---------------------------------------------------------------------------

DEMO_SUPPLIERS = [
    {
        'ruc': '20100010101',
        'business_name': 'Aceros Arequipa S.A.',
        'trade_name': 'Aceros Arequipa',
        'contact_name': 'Luis Paredes',
        'contact_email': 'ventas@acerosarequipa.com',
        'contact_phone': '01-517-1800',
        'address': 'Av. Argentina 3093, Callao',
        'city': 'Lima',
        'category': 'Materiales de Construcción',
    },
    {
        'ruc': '20100020202',
        'business_name': 'Cementos Pacasmayo S.A.A.',
        'trade_name': 'Pacasmayo',
        'contact_name': 'Rosa Mendoza',
        'contact_email': 'comercial@cementospacasmayo.com',
        'contact_phone': '01-317-6000',
        'address': 'Calle La Colonia 150, Surco',
        'city': 'Lima',
        'category': 'Materiales de Construcción',
    },
    {
        'ruc': '20100030303',
        'business_name': 'Sodimac Perú S.A.',
        'trade_name': 'Sodimac',
        'contact_name': 'Marco Quispe',
        'contact_email': 'proveedores@sodimac.com.pe',
        'contact_phone': '01-614-7600',
        'address': 'Av. Javier Prado Este 4200, Surco',
        'city': 'Lima',
        'category': 'Ferretería',
    },
    {
        'ruc': '20100040404',
        'business_name': 'Ferreyros S.A.',
        'trade_name': 'Ferreyros CAT',
        'contact_name': 'Patricia Vega',
        'contact_email': 'ventas@ferreyros.com.pe',
        'contact_phone': '01-625-3000',
        'address': 'Av. Argentina 1920, Lima',
        'city': 'Lima',
        'category': 'Maquinaria y Equipos',
    },
    {
        'ruc': '20100050505',
        'business_name': 'Promart Home Center S.A.',
        'trade_name': 'Promart',
        'contact_name': 'Carlos Soto',
        'contact_email': 'corporativo@promart.pe',
        'contact_phone': '01-500-1234',
        'address': 'Av. Universitaria 6135, Los Olivos',
        'city': 'Lima',
        'category': 'Acabados',
    },
]


class Command(BaseCommand):
    help = (
        'Seed demo users, projects, departments, suppliers, and sample requests '
        'for the SYSPCCLOG RQ System. '
        'WARNING: This command creates demo accounts with a SHARED password. '
        'NEVER run in production. For development and demonstration environments only.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help=(
                'Delete existing demo data before re-seeding (destructive!). '
                'Preserves the admin superuser.'
            ),
        )

    @transaction.atomic
    def handle(self, *args, **options):
        from apps.core.models import (
            User, UserRole, Project, ProjectBudgetLine,
            Department, AnnualPlan, AnnualPlanLine,
        )
        from apps.rq.models import Supplier, Request, RequestItem, Approval

        if options['clear']:
            self._clear_demo_data(
                User, UserRole, Project, Department,
                Supplier, Request, Approval,
            )

        self.stdout.write(self.style.MIGRATE_HEADING('\n=== SYSPCCLOG Demo Data Seeder ===\n'))

        # ── Step 1: Users ──────────────────────────────────────
        users_map = self._seed_users(User, UserRole)

        # ── Step 2: Projects ───────────────────────────────────
        projects_map = self._seed_projects(Project, ProjectBudgetLine)

        # ── Step 3: Departments ────────────────────────────────
        departments_map = self._seed_departments(Department, users_map)

        # ── Step 4: Annual Plans ───────────────────────────────
        annual_plan_lines_map = self._seed_annual_plans(
            AnnualPlan, AnnualPlanLine, departments_map, users_map,
        )

        # ── Step 5: Suppliers ──────────────────────────────────
        self._seed_suppliers(Supplier)

        # ── Step 6: Sample Requests ────────────────────────────
        self._seed_requests(
            Request, RequestItem, Approval,
            users_map, projects_map, departments_map,
            annual_plan_lines_map,
        )

        self.stdout.write(self.style.SUCCESS('\nDemo data seeding completed successfully.\n'))

    # -----------------------------------------------------------------------
    # Private helpers
    # -----------------------------------------------------------------------

    def _clear_demo_data(
        self, User, UserRole, Project, Department, Supplier, Request, Approval,
    ):
        self.stdout.write(self.style.WARNING('Clearing existing demo data...'))

        demo_usernames = [u['username'] for u in DEMO_USERS]
        Request.objects.filter(rq_number__startswith='RQ-2026-000').delete()
        self.stdout.write('  Deleted demo requests.')

        Supplier.objects.filter(ruc__in=[s['ruc'] for s in DEMO_SUPPLIERS]).delete()
        self.stdout.write('  Deleted demo suppliers.')

        from apps.core.models import AnnualPlan, AnnualPlanLine
        dept_codes = [d['code'] for d in DEMO_DEPARTMENTS]
        AnnualPlan.objects.filter(department__code__in=dept_codes).delete()
        Department.objects.filter(code__in=dept_codes).delete()
        self.stdout.write('  Deleted demo departments and annual plans.')

        project_codes = [p['code'] for p in DEMO_PROJECTS]
        Project.objects.filter(code__in=project_codes).delete()
        self.stdout.write('  Deleted demo projects.')

        User.objects.filter(username__in=demo_usernames).delete()
        self.stdout.write('  Deleted demo users.')

    def _seed_users(self, User, UserRole):
        self.stdout.write('Seeding demo users...')
        users_map = {}
        created_count = 0
        updated_count = 0

        hashed_password = make_password(DEMO_PASSWORD)

        for user_data in DEMO_USERS:
            # Work on a shallow copy so the module-level constant is never mutated
            # between repeated calls within the same process lifetime.
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
                # Update non-sensitive fields on subsequent runs
                for field in ('first_name', 'last_name', 'email', 'position', 'department'):
                    setattr(user, field, user_fields[field])
                user.save(update_fields=['first_name', 'last_name', 'email', 'position', 'department'])
                updated_count += 1
            else:
                created_count += 1

            users_map[user.username] = user

            # Seed roles
            for role_entry in roles_data:
                UserRole.objects.get_or_create(
                    user=user,
                    role=role_entry['role'],
                    project=None,
                    department_obj=None,
                    defaults={
                        'is_primary': role_entry['is_primary'],
                    },
                )

        # Assign GENERAL_MANAGER role to the admin superuser if it exists
        try:
            admin_user = User.objects.get(username='admin', is_superuser=True)
            UserRole.objects.get_or_create(
                user=admin_user,
                role='GENERAL_MANAGER',
                project=None,
                department_obj=None,
                defaults={'is_primary': False},
            )
            users_map['admin'] = admin_user
            self.stdout.write('  Assigned GENERAL_MANAGER role to superuser admin.')
        except User.DoesNotExist:
            pass

        self.stdout.write(
            self.style.SUCCESS(
                f'  Users: {created_count} created, {updated_count} updated.'
            )
        )
        return users_map

    def _seed_projects(self, Project, ProjectBudgetLine):
        self.stdout.write('Seeding demo projects...')
        projects_map = {}
        proj_created = 0
        line_created = 0

        for proj_data in DEMO_PROJECTS:
            # Work on a copy to avoid mutating the module-level constant
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
            self.style.SUCCESS(
                f'  Projects: {proj_created} created. Budget lines: {line_created} created.'
            )
        )
        return projects_map

    def _seed_departments(self, Department, users_map):
        self.stdout.write('Seeding demo departments...')
        departments_map = {}
        created_count = 0

        for dept_data in DEMO_DEPARTMENTS:
            # Work on a copy to avoid mutating the module-level constant
            manager_username = dept_data['manager_username']
            dept_fields = {k: v for k, v in dept_data.items() if k != 'manager_username'}
            manager = users_map.get(manager_username) if manager_username else None

            dept, created = Department.objects.get_or_create(
                code=dept_fields['code'],
                defaults={**dept_fields, 'manager': manager},
            )
            if not created:
                dept.name = dept_fields['name']
                dept.manager = manager
                dept.save(update_fields=['name', 'manager'])
            else:
                created_count += 1

            departments_map[dept.code] = dept

        self.stdout.write(
            self.style.SUCCESS(f'  Departments: {created_count} created.')
        )
        return departments_map

    def _seed_annual_plans(self, AnnualPlan, AnnualPlanLine, departments_map, users_map):
        self.stdout.write('Seeding demo annual plans (year 2026)...')
        annual_plan_lines_map = {}
        plans_created = 0
        lines_created = 0

        # Use aperez (Gerente General) as approver if present
        gm_user = users_map.get('aperez')

        for dept_code, lines_data in ANNUAL_PLAN_LINES_BY_DEPT.items():
            department = departments_map.get(dept_code)
            if not department:
                continue

            total_budget = sum(line['budgeted_amount'] for line in lines_data)

            plan, created = AnnualPlan.objects.get_or_create(
                year=2026,
                department=department,
                defaults={
                    'total_budget': total_budget,
                    'approved_by': gm_user,
                    'approved_at': timezone.now() - timedelta(days=30),
                    'is_active': True,
                },
            )
            if created:
                plans_created += 1

            annual_plan_lines_map[dept_code] = {}

            for line_data in lines_data:
                line, line_created = AnnualPlanLine.objects.get_or_create(
                    annual_plan=plan,
                    code=line_data['code'],
                    defaults=line_data,
                )
                if line_created:
                    lines_created += 1
                annual_plan_lines_map[dept_code][line_data['code']] = line

        self.stdout.write(
            self.style.SUCCESS(
                f'  Annual plans: {plans_created} created. Lines: {lines_created} created.'
            )
        )
        return annual_plan_lines_map

    def _seed_suppliers(self, Supplier):
        self.stdout.write('Seeding demo suppliers...')
        created_count = 0

        for supplier_data in DEMO_SUPPLIERS:
            _, created = Supplier.objects.get_or_create(
                ruc=supplier_data['ruc'],
                defaults=supplier_data,
            )
            if created:
                created_count += 1

        self.stdout.write(
            self.style.SUCCESS(f'  Suppliers: {created_count} created.')
        )

    def _seed_requests(
        self,
        Request, RequestItem, Approval,
        users_map, projects_map, departments_map, annual_plan_lines_map,
    ):
        self.stdout.write('Seeding demo requests...')
        today = date.today()
        now = timezone.now()
        created_count = 0

        # Resolve reusable objects
        jrodriguez = users_map.get('jrodriguez')
        mcastillo = users_map.get('mcastillo')
        clopez = users_map.get('clopez')
        aperez = users_map.get('aperez')
        rgarcia = users_map.get('rgarcia')
        lmendoza = users_map.get('lmendoza')
        psalas = users_map.get('psalas')
        dmorales = users_map.get('dmorales')
        svargas = users_map.get('svargas')
        fchavez = users_map.get('fchavez')
        atorres = users_map.get('atorres')
        jhernandez = users_map.get('jhernandez')

        proy001 = projects_map.get('PROY-2026-001')
        proy002 = projects_map.get('PROY-2026-002')
        dept_rrhh = departments_map.get('RRHH')
        dept_adm = departments_map.get('ADM')

        # Budget lines for requests
        proy001_mat_line = None
        proy001_eqp_line = None
        proy002_mat_line = None
        if proy001:
            proy001_mat_line = proy001.budget_lines.filter(code='PROY-001-MAT').first()
            proy001_eqp_line = proy001.budget_lines.filter(code='PROY-001-EQP').first()
        if proy002:
            proy002_mat_line = proy002.budget_lines.filter(code='PROY-002-MAT').first()

        rrhh_cap_line = annual_plan_lines_map.get('RRHH', {}).get('RRHH-CAP')
        adm_mat_line = annual_plan_lines_map.get('ADM', {}).get('ADM-MAT')

        # ──────────────────────────────────────────────────────────────────
        # RQ-2026-0001: OPERATIONS, CLOSED (full approval chain)
        # ──────────────────────────────────────────────────────────────────
        rq1, rq1_created = Request.objects.get_or_create(
            rq_number='RQ-2026-0001',
            defaults={
                'flow': 'OPERATIONS',
                'project': proy001,
                'department': None,
                'requested_by': jrodriguez,
                'front_area': 'Frente A - Cimentación',
                'service': 'Trabajos de Cimentación',
                'specific_use': 'Varillas de acero para losa de cimentación bloque A',
                'description': 'Solicitud de varillas de acero corrugado grado 60 para refuerzo de losa.',
                'justification': 'Inicio de trabajos de cimentación según cronograma aprobado.',
                'acquisition_type': 'COMPRA_LOCAL',
                'priority': 'HIGH',
                'status': 'CLOSED',
                'budget_classification': 'BC_WITHIN_PROPOSAL',
                'budget_line': proy001_mat_line,
                'estimated_cost': Decimal('18500.00'),
                'final_cost': Decimal('17850.00'),
                'fecha_necesidad': today - timedelta(days=25),
                'fecha_estimada_entrega': today - timedelta(days=22),
                'fecha_real_entrega': today - timedelta(days=21),
            },
        )
        if rq1_created:
            created_count += 1
            self._create_items(RequestItem, rq1, [
                {
                    'line_number': 1,
                    'description': 'Varilla de acero corrugado 1/2" Grado 60',
                    'specifications': 'ASTM A615, corrugado, longitud 12m',
                    'quantity': Decimal('150.000'),
                    'unit': 'var',
                    'unit_price': Decimal('85.00'),
                    'presupuestado_adicional': 'P',
                },
                {
                    'line_number': 2,
                    'description': 'Varilla de acero corrugado 3/8" Grado 60',
                    'specifications': 'ASTM A615, corrugado, longitud 9m',
                    'quantity': Decimal('80.000'),
                    'unit': 'var',
                    'unit_price': Decimal('48.00'),
                    'presupuestado_adicional': 'P',
                },
                {
                    'line_number': 3,
                    'description': 'Alambre recocido N°16',
                    'specifications': 'Rollo de 25kg',
                    'quantity': Decimal('10.000'),
                    'unit': 'rol',
                    'unit_price': Decimal('85.00'),
                    'presupuestado_adicional': 'P',
                },
            ])
            self._create_ops_closed_approvals(
                Approval, rq1, jrodriguez, mcastillo, clopez,
                aperez, rgarcia, lmendoza, psalas, now,
            )

        # ──────────────────────────────────────────────────────────────────
        # RQ-2026-0002: OPERATIONS, TECHNICAL_REVIEW (pending resident)
        # ──────────────────────────────────────────────────────────────────
        rq2, rq2_created = Request.objects.get_or_create(
            rq_number='RQ-2026-0002',
            defaults={
                'flow': 'OPERATIONS',
                'project': proy001,
                'department': None,
                'requested_by': jrodriguez,
                'front_area': 'Frente B - Columnas',
                'service': 'Trabajos de Concreto Armado',
                'specific_use': 'Encofrado para columnas del nivel 2',
                'description': 'Paneles de encofrado metálico para vaciado de columnas.',
                'justification': 'Avance según programa de obra semana 12.',
                'acquisition_type': 'COMPRA_LOCAL',
                'priority': 'NORMAL',
                'status': 'TECHNICAL_REVIEW',
                'budget_line': proy001_mat_line,
                'estimated_cost': Decimal('8200.00'),
                'fecha_necesidad': today + timedelta(days=5),
            },
        )
        if rq2_created:
            created_count += 1
            self._create_items(RequestItem, rq2, [
                {
                    'line_number': 1,
                    'description': 'Panel de encofrado metálico 0.60x1.20m',
                    'specifications': 'Espesor de lámina 3mm, con bordes reforzados',
                    'quantity': Decimal('40.000'),
                    'unit': 'und',
                    'unit_price': Decimal('185.00'),
                    'presupuestado_adicional': 'P',
                },
                {
                    'line_number': 2,
                    'description': 'Perno de encofrado M20x150mm',
                    'specifications': 'Acero galvanizado, incluye tuerca y arandela',
                    'quantity': Decimal('200.000'),
                    'unit': 'und',
                    'unit_price': Decimal('8.50'),
                    'presupuestado_adicional': 'P',
                },
            ])
            # Only the submission approval exists
            self._create_approval(
                Approval, rq2,
                performed_by=jrodriguez,
                role='REQUESTER',
                action='SUBMITTED',
                previous_status='DRAFT',
                new_status='TECHNICAL_REVIEW',
                comments='RQ enviado para revisión técnica del Residente.',
                performed_at=now - timedelta(hours=6),
            )

        # ──────────────────────────────────────────────────────────────────
        # RQ-2026-0003: OPERATIONS, VALIDATED (ready for logistics)
        # ──────────────────────────────────────────────────────────────────
        rq3, rq3_created = Request.objects.get_or_create(
            rq_number='RQ-2026-0003',
            defaults={
                'flow': 'OPERATIONS',
                'project': proy002,
                'department': None,
                'requested_by': jrodriguez,
                'front_area': 'Frente General',
                'service': 'Acabados Interiores',
                'specific_use': 'Pintura para ambientes interiores del bloque C',
                'description': 'Pintura látex interior, colores según especificación arquitectónica.',
                'justification': 'Inicio de trabajos de acabados programados para la semana 14.',
                'acquisition_type': 'COMPRA_LOCAL',
                'priority': 'NORMAL',
                'status': 'VALIDATED',
                'budget_classification': 'BC_WITHIN_PROPOSAL',
                'budget_line': proy002_mat_line,
                'estimated_cost': Decimal('5600.00'),
                'fecha_necesidad': today + timedelta(days=10),
            },
        )
        if rq3_created:
            created_count += 1
            self._create_items(RequestItem, rq3, [
                {
                    'line_number': 1,
                    'description': 'Pintura látex interior color blanco humo',
                    'specifications': 'Balde 20L, rendimiento 12m2/L, 2 manos',
                    'quantity': Decimal('15.000'),
                    'unit': 'bal',
                    'unit_price': Decimal('185.00'),
                    'presupuestado_adicional': 'P',
                },
                {
                    'line_number': 2,
                    'description': 'Imprimante para muros interiores',
                    'specifications': 'Balde 20L, para muros nuevos tarrajeados',
                    'quantity': Decimal('8.000'),
                    'unit': 'bal',
                    'unit_price': Decimal('95.00'),
                    'presupuestado_adicional': 'P',
                },
                {
                    'line_number': 3,
                    'description': 'Lija de papel grano 100 (pliego)',
                    'specifications': 'Para acabado de muros previo a pintura',
                    'quantity': Decimal('50.000'),
                    'unit': 'pli',
                    'unit_price': Decimal('3.50'),
                    'presupuestado_adicional': 'P',
                },
            ])
            self._create_ops_validated_approvals(
                Approval, rq3, jrodriguez, mcastillo, clopez, now,
            )

        # ──────────────────────────────────────────────────────────────────
        # RQ-2026-0004: ADMINISTRATIVE, SUPERVISOR_REVIEW (pending supervisor)
        # ──────────────────────────────────────────────────────────────────
        rq4, rq4_created = Request.objects.get_or_create(
            rq_number='RQ-2026-0004',
            defaults={
                'flow': 'ADMINISTRATIVE',
                'project': None,
                'department': dept_rrhh,
                'requested_by': dmorales,
                'service': 'Capacitación del Personal',
                'specific_use': 'Material de capacitación para inducción de nuevos colaboradores',
                'description': 'Folders, lapiceros, libretas y materiales de oficina para taller.',
                'justification': 'Programa de inducción trimestral para 15 nuevos colaboradores.',
                'acquisition_type': 'COMPRA_LOCAL',
                'priority': 'NORMAL',
                'status': 'SUPERVISOR_REVIEW',
                'annual_plan_line': rrhh_cap_line,
                'estimated_cost': Decimal('780.00'),
                'fecha_necesidad': today + timedelta(days=7),
            },
        )
        if rq4_created:
            created_count += 1
            self._create_items(RequestItem, rq4, [
                {
                    'line_number': 1,
                    'description': 'Folder manila tamaño A4',
                    'specifications': 'Con fastener metálico, colores surtidos',
                    'quantity': Decimal('50.000'),
                    'unit': 'und',
                    'unit_price': Decimal('1.50'),
                },
                {
                    'line_number': 2,
                    'description': 'Lapicero azul punta media',
                    'specifications': 'Marca Pilot o similar, caja x 12',
                    'quantity': Decimal('5.000'),
                    'unit': 'cja',
                    'unit_price': Decimal('28.00'),
                },
                {
                    'line_number': 3,
                    'description': 'Libreta espiral 100 hojas A5',
                    'specifications': 'Tapa dura, cuadriculada',
                    'quantity': Decimal('20.000'),
                    'unit': 'und',
                    'unit_price': Decimal('12.00'),
                },
            ])
            # Only submission approval
            self._create_approval(
                Approval, rq4,
                performed_by=dmorales,
                role='REQUESTER',
                action='SUBMITTED',
                previous_status='DRAFT',
                new_status='SUPERVISOR_REVIEW',
                comments='RQ enviado para aprobación del Jefe Directo.',
                performed_at=now - timedelta(hours=3),
            )

        # ──────────────────────────────────────────────────────────────────
        # RQ-2026-0005: OPERATIONS, QUOTING (in procurement)
        # ──────────────────────────────────────────────────────────────────
        rq5, rq5_created = Request.objects.get_or_create(
            rq_number='RQ-2026-0005',
            defaults={
                'flow': 'OPERATIONS',
                'project': proy001,
                'department': None,
                'requested_by': jrodriguez,
                'front_area': 'Frente C - Instalaciones',
                'service': 'Instalaciones Eléctricas',
                'specific_use': 'Materiales eléctricos para instalación en nivel 3',
                'description': 'Cables, tuberías conduit y accesorios eléctricos para el nivel 3.',
                'justification': 'Inicio de trabajos eléctricos del nivel 3 según cronograma.',
                'acquisition_type': 'COMPRA_LOCAL',
                'priority': 'HIGH',
                'status': 'QUOTING',
                'budget_classification': 'BC_WITHIN_PROPOSAL',
                'budget_line': proy001_eqp_line,
                'estimated_cost': Decimal('12400.00'),
                'fecha_necesidad': today + timedelta(days=8),
            },
        )
        if rq5_created:
            created_count += 1
            self._create_items(RequestItem, rq5, [
                {
                    'line_number': 1,
                    'description': 'Cable NYY 3x2.5mm2',
                    'specifications': '450/750V, cobre electrolítico, rollo 100m',
                    'quantity': Decimal('8.000'),
                    'unit': 'rol',
                    'unit_price': Decimal('420.00'),
                    'presupuestado_adicional': 'P',
                    'x_atender': Decimal('8.000'),
                },
                {
                    'line_number': 2,
                    'description': 'Tubería conduit PVC 3/4" x 3m',
                    'specifications': 'Liviana, incluye uniones y curvas',
                    'quantity': Decimal('60.000'),
                    'unit': 'und',
                    'unit_price': Decimal('8.50'),
                    'presupuestado_adicional': 'P',
                    'x_atender': Decimal('60.000'),
                },
                {
                    'line_number': 3,
                    'description': 'Caja rectangular PVC 4x2"',
                    'specifications': 'Con tapa ciega, profundidad 45mm',
                    'quantity': Decimal('40.000'),
                    'unit': 'und',
                    'unit_price': Decimal('3.20'),
                    'presupuestado_adicional': 'P',
                    'x_atender': Decimal('40.000'),
                },
                {
                    'line_number': 4,
                    'description': 'Interruptor termomagnético 2x20A',
                    'specifications': 'NEMA, marca Schneider o Siemens',
                    'quantity': Decimal('4.000'),
                    'unit': 'und',
                    'unit_price': Decimal('145.00'),
                    'presupuestado_adicional': 'P',
                    'x_atender': Decimal('4.000'),
                },
            ])
            self._create_ops_quoting_approvals(
                Approval, rq5, jrodriguez, mcastillo, clopez, rgarcia, now,
            )

        # ──────────────────────────────────────────────────────────────────
        # RQ-2026-0006: ADMINISTRATIVE, CLOSED (completed admin flow)
        # ──────────────────────────────────────────────────────────────────
        rq6, rq6_created = Request.objects.get_or_create(
            rq_number='RQ-2026-0006',
            defaults={
                'flow': 'ADMINISTRATIVE',
                'project': None,
                'department': dept_adm,
                'requested_by': dmorales,
                'service': 'Equipamiento de Oficina',
                'specific_use': 'Sillas ergonómicas para área administrativa',
                'description': 'Sillas de oficina ergonómicas con soporte lumbar para el personal del área.',
                'justification': 'Renovación de mobiliario deteriorado conforme evaluación de ergonomía.',
                'acquisition_type': 'COMPRA_LOCAL',
                'priority': 'NORMAL',
                'status': 'CLOSED',
                'budget_classification': 'BC_WITHIN_ANNUAL_PLAN',
                'annual_plan_line': adm_mat_line,
                'estimated_cost': Decimal('4200.00'),
                'final_cost': Decimal('4050.00'),
                'fecha_necesidad': today - timedelta(days=20),
                'fecha_estimada_entrega': today - timedelta(days=17),
                'fecha_real_entrega': today - timedelta(days=16),
            },
        )
        if rq6_created:
            created_count += 1
            self._create_items(RequestItem, rq6, [
                {
                    'line_number': 1,
                    'description': 'Silla ergonómica con soporte lumbar',
                    'specifications': 'Altura regulable, apoyabrazos ajustables, malla transpirable',
                    'quantity': Decimal('6.000'),
                    'unit': 'und',
                    'unit_price': Decimal('675.00'),
                },
                {
                    'line_number': 2,
                    'description': 'Reposapiés regulable',
                    'specifications': 'Plástico ABS con superficie antideslizante',
                    'quantity': Decimal('6.000'),
                    'unit': 'und',
                    'unit_price': Decimal('75.00'),
                },
            ])
            self._create_adm_closed_approvals(
                Approval, rq6, dmorales, svargas, fchavez,
                atorres, jhernandez, lmendoza, now,
            )

        self.stdout.write(
            self.style.SUCCESS(f'  Requests: {created_count} created.')
        )

    # -----------------------------------------------------------------------
    # Approval chain builders
    # -----------------------------------------------------------------------

    def _create_approval(
        self, Approval, request, performed_by, role,
        action, previous_status, new_status, comments, performed_at,
    ):
        """Create a single Approval record (skips if one with same request+action+new_status exists).

        Because Approval.performed_at uses auto_now_add=True the field cannot be
        supplied to objects.create(). We create the record first and then use a
        targeted queryset.update() call to back-date the timestamp so the audit
        trail reflects a realistic timeline instead of all being set to "now".
        """
        exists = Approval.objects.filter(
            request=request,
            action=action,
            new_status=new_status,
        ).exists()
        if not exists:
            obj = Approval.objects.create(
                request=request,
                workflow_step=None,
                action=action,
                performed_by=performed_by,
                role=role,
                previous_status=previous_status,
                new_status=new_status,
                comments=comments,
                # performed_at is auto_now_add; bypassed via .update() below
            )
            # Back-date the timestamp to produce a realistic audit trail.
            # queryset.update() bypasses auto_now_add on the field level.
            Approval.objects.filter(pk=obj.pk).update(performed_at=performed_at)

    def _create_ops_closed_approvals(
        self, Approval, rq, requester, resident, control,
        gm, logistics, warehouse, site_warehouse, now,
    ):
        """Full Operations approval chain for a CLOSED request."""
        base = now - timedelta(days=25)
        chain = [
            (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED',
             'RQ generado y enviado para revisión técnica.', base),
            (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED',
             'Especificaciones técnicas verificadas y aprobadas.', base + timedelta(hours=4)),
            (control, 'PROJECT_CONTROL', 'BUDGET_CLASSIFIED', 'TECHNICAL_APPROVED', 'WITHIN_PROPOSAL',
             'Monto dentro del presupuesto aprobado para la partida.', base + timedelta(hours=8)),
            (logistics, 'LOGISTICS_COORDINATOR', 'VALIDATED', 'WITHIN_PROPOSAL', 'VALIDATED',
             'RQ validado. Se procede con verificación de stock.', base + timedelta(hours=10)),
            (logistics, 'LOGISTICS_COORDINATOR', 'STOCK_CHECKED', 'VALIDATED', 'REQUIRES_PURCHASE',
             'Sin stock disponible en almacén central. Se procede con compra.', base + timedelta(hours=12)),
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING',
             'Cotizaciones solicitadas a proveedores habilitados.', base + timedelta(days=1)),
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_SELECTED', 'QUOTING', 'QUOTE_SELECTED',
             'Proveedor seleccionado: Aceros Arequipa S.A. Mejor precio y plazo.', base + timedelta(days=3)),
            (logistics, 'LOGISTICS_COORDINATOR', 'PO_GENERATED', 'QUOTE_SELECTED', 'PO_GENERATED',
             'OC generada. Precio dentro del presupuesto estimado.', base + timedelta(days=4)),
            (warehouse, 'CENTRAL_WAREHOUSE', 'RECEIVED', 'PO_GENERATED', 'RECEIVING',
             'Materiales recibidos en almacén central.', base + timedelta(days=6)),
            (warehouse, 'CENTRAL_WAREHOUSE', 'QUALITY_APPROVED', 'RECEIVING', 'QUALITY_APPROVED',
             'Control de calidad conforme. Todo dentro de especificaciones.', base + timedelta(days=6, hours=3)),
            (warehouse, 'CENTRAL_WAREHOUSE', 'DISPATCHED', 'QUALITY_APPROVED', 'DISPATCHED_TO_SITE',
             'Materiales despachados a almacén de obra.', base + timedelta(days=7)),
            (site_warehouse, 'SITE_WAREHOUSE', 'DELIVERED', 'DISPATCHED_TO_SITE', 'DELIVERED',
             'Materiales recibidos en almacén de obra y registrados en kardex.', base + timedelta(days=8)),
            (requester, 'REQUESTER', 'USER_CONFIRMED', 'DELIVERED', 'USER_CONFORMITY',
             'Recepción conforme. Materiales en buenas condiciones.', base + timedelta(days=8, hours=4)),
            (logistics, 'LOGISTICS_COORDINATOR', 'CLOSED', 'USER_CONFORMITY', 'CLOSED',
             'RQ cerrado exitosamente. Proceso completado.', base + timedelta(days=9)),
        ]
        for (user, role, action, prev, new, comment, ts) in chain:
            if user:
                self._create_approval(
                    Approval, rq, user, role, action, prev, new, comment, ts,
                )

    def _create_ops_validated_approvals(
        self, Approval, rq, requester, resident, control, now,
    ):
        """Operations approvals up to VALIDATED status."""
        base = now - timedelta(days=3)
        chain = [
            (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED',
             'RQ generado y enviado para revisión técnica.', base),
            (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED',
             'Especificaciones revisadas. Todo en orden.', base + timedelta(hours=5)),
            (control, 'PROJECT_CONTROL', 'BUDGET_CLASSIFIED', 'TECHNICAL_APPROVED', 'WITHIN_PROPOSAL',
             'RQ dentro del presupuesto de la partida Materiales.', base + timedelta(hours=9)),
            (control, 'PROJECT_CONTROL', 'VALIDATED', 'WITHIN_PROPOSAL', 'VALIDATED',
             'RQ validado para atención logística.', base + timedelta(hours=10)),
        ]
        for (user, role, action, prev, new, comment, ts) in chain:
            if user:
                self._create_approval(
                    Approval, rq, user, role, action, prev, new, comment, ts,
                )

    def _create_ops_quoting_approvals(
        self, Approval, rq, requester, resident, control, logistics, now,
    ):
        """Operations approvals up to QUOTING status."""
        base = now - timedelta(days=5)
        chain = [
            (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED',
             'RQ generado y enviado para revisión técnica.', base),
            (resident, 'PROJECT_RESIDENT', 'TECHNICAL_APPROVED', 'SUBMITTED', 'TECHNICAL_APPROVED',
             'Materiales eléctricos correctamente especificados.', base + timedelta(hours=3)),
            (control, 'PROJECT_CONTROL', 'BUDGET_CLASSIFIED', 'TECHNICAL_APPROVED', 'WITHIN_PROPOSAL',
             'Dentro del presupuesto de equipos nivel 3.', base + timedelta(hours=6)),
            (logistics, 'LOGISTICS_COORDINATOR', 'VALIDATED', 'WITHIN_PROPOSAL', 'VALIDATED',
             'Validado. Verificando disponibilidad de stock.', base + timedelta(hours=8)),
            (logistics, 'LOGISTICS_COORDINATOR', 'STOCK_CHECKED', 'VALIDATED', 'REQUIRES_PURCHASE',
             'Sin stock. Se requiere compra local.', base + timedelta(hours=10)),
            (logistics, 'LOGISTICS_COORDINATOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING',
             'Cotizaciones enviadas a Sodimac, Promart y Ferreyros.', base + timedelta(days=1)),
        ]
        for (user, role, action, prev, new, comment, ts) in chain:
            if user:
                self._create_approval(
                    Approval, rq, user, role, action, prev, new, comment, ts,
                )

    def _create_adm_closed_approvals(
        self, Approval, rq, requester, supervisor, admin_manager,
        logistics_sup, logistics_chief, warehouse, now,
    ):
        """Full Administrative approval chain for a CLOSED request."""
        base = now - timedelta(days=20)
        chain = [
            (requester, 'REQUESTER', 'SUBMITTED', 'DRAFT', 'SUBMITTED',
             'RQ generado y enviado para revisión del Jefe Directo.', base),
            (supervisor, 'DIRECT_SUPERVISOR', 'SUPERVISOR_APPROVED', 'SUBMITTED', 'SUPERVISOR_APPROVED',
             'Necesidad justificada. Mobiliario deteriorado confirmado.', base + timedelta(hours=5)),
            (admin_manager, 'ADMIN_MANAGER', 'ADMIN_BUDGET_REVIEWED', 'SUPERVISOR_APPROVED', 'WITHIN_ANNUAL_PLAN',
             'Monto dentro del Plan Anual 2026 para mobiliario ADM.', base + timedelta(hours=8)),
            (admin_manager, 'ADMIN_MANAGER', 'VALIDATED', 'WITHIN_ANNUAL_PLAN', 'VALIDATED',
             'RQ validado para atención por logística.', base + timedelta(hours=9)),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'STOCK_CHECKED', 'VALIDATED', 'REQUIRES_PURCHASE',
             'No hay stock de sillas en almacén. Se requiere compra.', base + timedelta(hours=11)),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'QUOTE_REQUESTED', 'REQUIRES_PURCHASE', 'QUOTING',
             'Cotizaciones solicitadas a proveedores de mobiliario.', base + timedelta(days=1)),
            (logistics_chief, 'LOGISTICS_CHIEF', 'QUOTE_COMPARED', 'QUOTING', 'QUOTE_COMPARISON',
             'Tres cotizaciones recibidas. Comparativo elaborado.', base + timedelta(days=3)),
            (logistics_chief, 'LOGISTICS_CHIEF', 'QUOTE_SELECTED', 'QUOTE_COMPARISON', 'QUOTE_SELECTED',
             'Seleccionado proveedor con mejor relación precio-calidad.', base + timedelta(days=4)),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'PO_GENERATED', 'QUOTE_SELECTED', 'PO_GENERATED',
             'OC generada dentro del presupuesto planificado.', base + timedelta(days=4, hours=3)),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'RECEIVED', 'PO_GENERATED', 'RECEIVING',
             'Sillas recibidas en oficina administrativa.', base + timedelta(days=7)),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'RECEPTION_CONFIRMED', 'RECEIVING', 'DELIVERED',
             'Recepción conforme. Todos los ítems en buen estado.', base + timedelta(days=7, hours=2)),
            (warehouse, 'CENTRAL_WAREHOUSE', 'WAREHOUSE_RECORDS_UPDATED', 'DELIVERED', 'WAREHOUSE_UPDATED',
             'Registros de almacén actualizados correctamente.', base + timedelta(days=8)),
            (requester, 'REQUESTER', 'USER_CONFIRMED', 'WAREHOUSE_UPDATED', 'USER_CONFORMITY',
             'Sillas recibidas y distribuidas. Conformes con el pedido.', base + timedelta(days=9)),
            (logistics_sup, 'LOGISTICS_SUPERVISOR', 'CLOSED', 'USER_CONFORMITY', 'CLOSED',
             'RQ cerrado. Proceso administrativo completado.', base + timedelta(days=10)),
        ]
        for (user, role, action, prev, new, comment, ts) in chain:
            if user:
                self._create_approval(
                    Approval, rq, user, role, action, prev, new, comment, ts,
                )

    # -----------------------------------------------------------------------
    # Item creation helper
    # -----------------------------------------------------------------------

    def _create_items(self, RequestItem, request, items_data):
        """Create RequestItems, skipping lines that already exist."""
        for item_data in items_data:
            line_num = item_data['line_number']
            if not RequestItem.objects.filter(request=request, line_number=line_num).exists():
                RequestItem.objects.create(request=request, **item_data)
