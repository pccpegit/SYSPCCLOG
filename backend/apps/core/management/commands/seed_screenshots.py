"""
Seed ABUNDANT demo data for screenshots.

Generates many users, projects, suppliers, inventory and — most importantly —
a large volume of Requests (RQ) spread across the whole workflow (both flows),
each with items, approvals, activity log, and, where relevant, quotations,
purchase orders, warehouse receipts and dispatches.

Assumes `seed_demo` has already been run (base users/projects/suppliers exist).
Idempotent-friendly: uses get_or_create and unique numbers; safe to re-run.

Usage:
    python manage.py seed_screenshots
    python manage.py seed_screenshots --requests 120
"""

import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.core.management.commands.seed_demo import (
    DEMO_PASSWORD, warn_if_password_generated,
)
from apps.core.management.seed_guard import abort_if_production

# SYSPCC-017: DEMO_PASSWORD used to be its own hardcoded literal here,
# duplicating (and drifting from) the one in seed_demo.py. Now imported from
# the single source of truth in seed_demo.py — see that module for how it's
# resolved from SEED_DEMO_PASSWORD (env) or generated per run.

# ---------------------------------------------------------------------------
# Catalogs
# ---------------------------------------------------------------------------

EXTRA_USERS = [
    ('rquispe', 'Rosa', 'Quispe', 'Ingeniera de Campo', 'Proyectos', 'REQUESTER'),
    ('mflores', 'Miguel', 'Flores', 'Supervisor de Obra', 'Proyectos', 'REQUESTER'),
    ('ccondori', 'Cecilia', 'Condori', 'Ingeniera Residente', 'Proyectos', 'REQUESTER'),
    ('jvilca', 'José', 'Vilca', 'Asistente de Obra', 'Proyectos', 'REQUESTER'),
    ('aramos', 'Andrea', 'Ramos', 'Analista Administrativa', 'Administración', 'REQUESTER'),
    ('pnunez', 'Pablo', 'Núñez', 'Asistente de Compras', 'Administración', 'REQUESTER'),
    ('gsoto', 'Gabriela', 'Soto', 'Residente de Proyecto', 'Proyectos', 'PROJECT_RESIDENT'),
    ('hparedes', 'Héctor', 'Paredes', 'Residente de Proyecto', 'Proyectos', 'PROJECT_RESIDENT'),
    ('vchamorro', 'Valeria', 'Chamorro', 'Control de Proyecto', 'Control de Proyecto', 'PROJECT_CONTROL'),
    ('erojas', 'Enrique', 'Rojas', 'Coordinador Logístico', 'Logística', 'LOGISTICS_COORDINATOR'),
    ('nmamani', 'Nataly', 'Mamani', 'Almacenera de Obra', 'Almacén', 'SITE_WAREHOUSE'),
    ('dcastro', 'Daniel', 'Castro', 'Jefe de Almacén Central', 'Almacén', 'CENTRAL_WAREHOUSE'),
    ('laguilar', 'Lucía', 'Aguilar', 'Supervisor Directo', 'Administración', 'DIRECT_SUPERVISOR'),
    ('rortega', 'Ricardo', 'Ortega', 'Gerente Administrativo', 'Administración', 'ADMIN_MANAGER'),
    ('mcaceres', 'Mónica', 'Cáceres', 'Supervisora de Logística', 'Logística', 'LOGISTICS_SUPERVISOR'),
    ('fbravo', 'Fernando', 'Bravo', 'Jefe de Logística', 'Logística', 'LOGISTICS_CHIEF'),
]

EXTRA_PROJECTS = [
    ('PROY-2026-004', 'Ampliación Planta Industrial Sur', 'Arequipa'),
    ('PROY-2026-005', 'Edificio Corporativo Miraflores', 'Lima'),
    ('PROY-2026-006', 'Puente Vehicular Río Mantaro', 'Huancayo'),
    ('PROY-2026-007', 'Subestación Eléctrica Norte', 'Trujillo'),
    ('PROY-2026-008', 'Centro Logístico Callao', 'Callao'),
    ('PROY-2026-009', 'Remodelación Sede Central', 'Lima'),
]

EXTRA_SUPPLIERS = [
    ('20100060606', 'Distribuidora Norte S.A.C.', 'Materiales de construcción'),
    ('20100070707', 'Electro Industrial Perú E.I.R.L.', 'Material eléctrico'),
    ('20100080808', 'Tuberías y Conexiones del Sur S.A.', 'Gasfitería'),
    ('20100090909', 'Maestro Perú S.A.', 'Ferretería'),
    ('20100101010', 'Herramientas Bosch Perú S.A.C.', 'Herramientas'),
    ('20100111111', 'Grupo Ferretero Andino S.A.C.', 'Ferretería'),
    ('20100121212', 'Concretos y Agregados Lima S.A.', 'Concreto'),
    ('20100131313', 'Seguridad Industrial EPP S.A.C.', 'EPP y seguridad'),
    ('20100141414', 'Pinturas y Acabados CPP S.A.', 'Pinturas'),
    ('20100151515', 'Importaciones Técnicas Global S.A.C.', 'Equipos importados'),
    ('20100161616', 'Alquiler de Maquinaria Pesada S.A.', 'Alquiler de equipos'),
    ('20100171717', 'Suministros de Oficina Total E.I.R.L.', 'Útiles de oficina'),
]

MATERIALS = [
    ('Cemento Portland Tipo I 42.5kg', 'bls', 32, 40),
    ('Fierro corrugado 1/2" x 9m Grado 60', 'var', 42, 55),
    ('Fierro corrugado 3/8" x 9m Grado 60', 'var', 24, 32),
    ('Ladrillo King Kong 18 huecos', 'mll', 780, 950),
    ('Arena gruesa', 'm3', 55, 75),
    ('Piedra chancada 1/2"', 'm3', 60, 85),
    ('Tubería PVC 4" desagüe', 'und', 28, 38),
    ('Cable eléctrico THW 12 AWG', 'rll', 145, 190),
    ('Interruptor termomagnético 20A', 'und', 18, 28),
    ('Pintura látex blanco satinado galón', 'gln', 45, 65),
    ('Malla electrosoldada Q188', 'pln', 88, 110),
    ('Alambre negro N°16', 'kg', 5, 8),
    ('Clavos 3" con cabeza', 'kg', 6, 9),
    ('Disco de corte metal 7"', 'und', 9, 14),
    ('Casco de seguridad ABS', 'und', 22, 35),
    ('Guantes de nitrilo (par)', 'par', 6, 12),
    ('Botas de seguridad punta acero', 'par', 75, 110),
    ('Triplay fenólico 18mm', 'pln', 95, 130),
    ('Perfil metálico estructural 2"x2"', 'var', 48, 70),
    ('Soldadura E6011 1/8"', 'kg', 14, 20),
]

OFFICE_ITEMS = [
    ('Papel bond A4 75g millar', 'mll', 22, 30),
    ('Tóner impresora láser', 'und', 180, 260),
    ('Laptop empresarial Core i5', 'und', 2800, 3600),
    ('Silla ergonómica de oficina', 'und', 320, 480),
    ('Archivador de palanca A4', 'und', 8, 14),
    ('Monitor LED 24"', 'und', 520, 720),
    ('Útiles de escritorio (kit)', 'kit', 45, 80),
    ('Licencia software ofimático anual', 'und', 350, 520),
]

FRONTS = ['Frente A - Cimentación', 'Frente B - Estructuras', 'Frente C - Acabados',
          'Frente D - Instalaciones', 'Movimiento de Tierras', 'Obras Civiles']
SERVICES = ['Trabajos de Cimentación', 'Montaje Estructural', 'Instalaciones Eléctricas',
            'Instalaciones Sanitarias', 'Acabados y Pintura', 'Habilitación de Materiales']

# Purchase-path ordering used to decide which downstream records to create
PPATH = ['VALIDATED', 'STOCK_CHECK', 'REQUIRES_PURCHASE', 'QUOTING', 'QUOTE_COMPARISON',
         'QUOTE_SELECTED', 'QUOTE_COST_APPROVED', 'PO_GENERATED', 'RECEIVING',
         'QUALITY_APPROVED', 'DISPATCHED_TO_SITE', 'DELIVERED', 'WAREHOUSE_UPDATED',
         'USER_CONFORMITY', 'CLOSED']

def prank(status):
    return PPATH.index(status) if status in PPATH else -1

# (status, count) plan per flow
OPS_PLAN = [
    ('DRAFT', 4), ('SUBMITTED', 5), ('TECHNICAL_APPROVED', 4), ('ADDITIONAL_REQ', 3),
    ('GM_REVIEW', 3), ('TECHNICAL_REJECTED', 2), ('VALIDATED', 4), ('IN_STOCK', 3),
    ('REQUIRES_PURCHASE', 3), ('QUOTING', 4), ('QUOTE_COMPARISON', 3), ('QUOTE_SELECTED', 3),
    ('QUOTE_COST_APPROVED', 3), ('PO_GENERATED', 4), ('RECEIVING', 3), ('QUALITY_APPROVED', 3),
    ('DISPATCHED_TO_SITE', 3), ('DELIVERED', 4), ('USER_CONFORMITY', 3), ('CLOSED', 6),
    ('CANCELLED', 2),
]
ADM_PLAN = [
    ('SUBMITTED', 3), ('SUPERVISOR_APPROVED', 3), ('OUT_OF_ANNUAL_PLAN', 2),
    ('SUPERVISOR_REJECTED', 1), ('VALIDATED', 2), ('QUOTING', 2), ('QUOTE_SELECTED', 2),
    ('PO_GENERATED', 2), ('DELIVERED', 2), ('CLOSED', 3),
]


class Command(BaseCommand):
    help = 'Seed abundant demo data for screenshots (users, projects, suppliers, requests, quotations, POs, warehouse).'

    def add_arguments(self, parser):
        parser.add_argument('--requests', type=int, default=0,
                            help='Override total requests (0 = use built-in plan)')

    @transaction.atomic
    def handle(self, *args, **opts):
        # SYSPCC-011 FIX 4: refuse to run outside development — this seeds a
        # shared demo password for every demo account.
        abort_if_production()
        # SYSPCC-017: DEMO_PASSWORD is resolved in seed_demo.py at import
        # time; this is a separate process/import from `seed_demo`, so unless
        # SEED_DEMO_PASSWORD is fixed in .env it generates its OWN random
        # value here — tell the operator what it is.
        warn_if_password_generated(self)

        from apps.core.models import User, Project, Department
        from apps.core.models.user import UserRole
        from apps.core.models.project import ProjectBudgetLine
        from apps.rq.models import (Request, RequestItem, Approval, Supplier, Quotation,
                                    QuotationItem, PurchaseOrder, PurchaseOrderItem, ActivityLog)
        from apps.warehouse.models import (Inventory, InventoryStock, WarehouseReceipt,
                                           WarehouseReceiptItem, WarehouseDispatch,
                                           WarehouseDispatchItem)

        rng = random.Random(2026)
        now = timezone.now()
        today = now.date()
        counts = {}

        # ---- Users ----------------------------------------------------------
        created_users = 0
        for username, fn, ln, pos, dept, role in EXTRA_USERS:
            u, created = User.objects.get_or_create(
                username=username,
                defaults=dict(first_name=fn, last_name=ln, email=f'{username}@pcc.pe',
                              position=pos, department=dept, is_active=True,
                              password=make_password(DEMO_PASSWORD)),
            )
            if created:
                created_users += 1
                UserRole.objects.get_or_create(user=u, role=role, defaults={'is_primary': True})
        counts['usuarios_nuevos'] = created_users

        # role -> users map (from all users)
        def users_with(role):
            ids = UserRole.objects.filter(role=role).values_list('user_id', flat=True)
            return list(User.objects.filter(id__in=ids))

        requesters = users_with('REQUESTER') or list(User.objects.all()[:3])
        residents = users_with('PROJECT_RESIDENT') or requesters
        controls = users_with('PROJECT_CONTROL') or requesters
        gms = users_with('GENERAL_MANAGER') or requesters
        coords = users_with('LOGISTICS_COORDINATOR') or requesters
        central_wh = users_with('CENTRAL_WAREHOUSE') or requesters
        site_wh = users_with('SITE_WAREHOUSE') or requesters
        supervisors = users_with('DIRECT_SUPERVISOR') or requesters
        admin_mgrs = users_with('ADMIN_MANAGER') or requesters
        log_sups = users_with('LOGISTICS_SUPERVISOR') or coords
        log_chiefs = users_with('LOGISTICS_CHIEF') or coords

        def pick(lst):
            return rng.choice(lst) if lst else None

        # ---- Projects + budget lines ---------------------------------------
        created_proj = 0
        for code, name, loc in EXTRA_PROJECTS:
            defaults = dict(name=name)
            # set optional fields if they exist on the model
            for fname, val in (('location', loc), ('is_active', True), ('status', 'ACTIVE')):
                if any(f.name == fname for f in Project._meta.get_fields()):
                    defaults[fname] = val
            p, created = Project.objects.get_or_create(code=code, defaults=defaults)
            if created:
                created_proj += 1
                for suf, desc, amt in (('MAT', 'Materiales', 450000), ('EQP', 'Equipos', 220000),
                                       ('MO', 'Mano de Obra', 380000), ('SUB', 'Subcontratos', 300000)):
                    ProjectBudgetLine.objects.get_or_create(
                        project=p, code=f'{code[-3:]}-{suf}',
                        defaults=dict(description=desc, budgeted_amount=Decimal(amt),
                                      committed_amount=Decimal(0), spent_amount=Decimal(0)))
        counts['proyectos_nuevos'] = created_proj

        all_projects = list(Project.objects.all())
        all_departments = list(Department.objects.all())
        budget_lines_by_project = {}
        for bl in ProjectBudgetLine.objects.all():
            budget_lines_by_project.setdefault(bl.project_id, []).append(bl)

        # ---- Suppliers ------------------------------------------------------
        created_sup = 0
        for ruc, name, cat in EXTRA_SUPPLIERS:
            s, created = Supplier.objects.get_or_create(
                ruc=ruc,
                defaults=dict(business_name=name, trade_name=name.split(' S')[0],
                              contact_name='Contacto Comercial',
                              contact_email=f'ventas@{ruc[-4:]}.com.pe',
                              contact_phone=f'+51 1 {rng.randint(2000000, 7999999)}',
                              address=f'Av. Industrial {rng.randint(100, 3000)}', city='Lima',
                              category=cat, is_active=True))
            if created:
                created_sup += 1
        counts['proveedores_nuevos'] = created_sup
        all_suppliers = list(Supplier.objects.all())

        # ---- Extra inventory + stock ---------------------------------------
        created_inv = 0
        created_stock = 0
        for i, (desc, unit, lo, hi) in enumerate(MATERIALS + OFFICE_ITEMS):
            code = f'ITM-SS-{i+1:03d}'
            inv, created = Inventory.objects.get_or_create(
                product_code=code,
                defaults=dict(description=desc, unit=unit, category='GENERAL',
                              min_stock=Decimal(rng.randint(5, 40))))
            if created:
                created_inv += 1
            for wh in ('CENTRAL', 'SITE'):
                proj = pick(all_projects) if wh == 'SITE' else None
                st, screated = InventoryStock.objects.get_or_create(
                    inventory=inv, warehouse_type=wh, project=proj,
                    defaults=dict(quantity=Decimal(rng.randint(0, 500))))
                if screated:
                    created_stock += 1
        counts['inventario_nuevo'] = created_inv
        counts['stock_nuevo'] = created_stock

        # ---- Requests -------------------------------------------------------
        # unique rq_number sequence
        existing_nums = list(Request.objects.filter(rq_number__startswith='RQ-2026-')
                             .values_list('rq_number', flat=True))
        max_seq = 100
        for n in existing_nums:
            try:
                max_seq = max(max_seq, int(n.split('-')[-1]))
            except ValueError:
                pass
        seq = max(max_seq, 100)

        plan = [('OPERATIONS', s, c) for s, c in OPS_PLAN] + \
               [('ADMINISTRATIVE', s, c) for s, c in ADM_PLAN]

        status_counter = {}
        made = 0
        q_made = po_made = rc_made = dp_made = appr_made = act_made = 0

        for flow, status, count in plan:
            for _ in range(count):
                seq += 1
                rq_number = f'RQ-2026-{seq:04d}'
                requester = pick(requesters)
                is_ops = flow == 'OPERATIONS'
                project = pick(all_projects) if is_ops else None
                department = None if is_ops else pick(all_departments)
                bls = budget_lines_by_project.get(project.id, []) if project else []
                budget_line = pick(bls) if bls else None

                catalog = MATERIALS if is_ops else OFFICE_ITEMS
                n_items = rng.randint(1, 5)
                priority = rng.choices(['URGENT', 'HIGH', 'NORMAL', 'LOW'],
                                       weights=[1, 3, 5, 2])[0]
                acq = rng.choice(['COMPRA_LOCAL', 'COMPRA_LOCAL', 'COMPRA_FORANEA',
                                  'ALQUILER', 'IMPORTACION'])

                if is_ops:
                    bc = ('BC_ADDITIONAL' if status in ('ADDITIONAL_REQ', 'GM_REVIEW')
                          else 'BC_WITHIN_PROPOSAL')
                else:
                    bc = ('BC_OUT_OF_ANNUAL_PLAN' if status in ('OUT_OF_ANNUAL_PLAN', 'GM_REVIEW')
                          else 'BC_WITHIN_ANNUAL_PLAN')

                days_ago = rng.randint(1, 90)
                need_in = rng.randint(3, 30)
                rq = Request.objects.create(
                    rq_number=rq_number, flow=flow, project=project, department=department,
                    requested_by=requester, front_area=(pick(FRONTS) if is_ops else 'Oficina Central'),
                    service=(pick(SERVICES) if is_ops else 'Compra Administrativa'),
                    specific_use='Abastecimiento para avance de obra' if is_ops else 'Uso administrativo',
                    description=f'Requerimiento {rq_number} generado para pruebas de sistema.',
                    justification='Necesario para cumplir el cronograma y la operación.',
                    acquisition_type=acq, priority=priority, status=status,
                    budget_classification=(bc if status not in ('DRAFT', 'SUBMITTED') else None),
                    budget_line=budget_line,
                    fecha_necesidad=today + timedelta(days=need_in),
                    fecha_estimada_entrega=today + timedelta(days=need_in + rng.randint(1, 10)),
                )
                # backdate for varied lists
                created_dt = now - timedelta(days=days_ago, hours=rng.randint(0, 23))
                Request.objects.filter(pk=rq.pk).update(created_at=created_dt, updated_at=created_dt)

                items = []
                total = Decimal('0')
                for li in range(1, n_items + 1):
                    desc, unit, lo, hi = rng.choice(catalog)
                    qty = Decimal(rng.randint(1, 60))
                    price = Decimal(str(rng.randint(lo, hi)))
                    line_total = qty * price
                    total += line_total
                    it = RequestItem.objects.create(
                        request=rq, line_number=li, description=desc,
                        specifications='Según especificación técnica del proyecto.',
                        quantity=qty, unit=unit, unit_price=price, total_price=line_total,
                        presupuestado_adicional=('A' if bc in ('BC_ADDITIONAL', 'BC_OUT_OF_ANNUAL_PLAN') else 'P'))
                    items.append(it)

                rq.estimated_cost = total
                if status in ('DELIVERED', 'USER_CONFORMITY', 'CLOSED', 'WAREHOUSE_UPDATED'):
                    rq.final_cost = (total * Decimal('0.97')).quantize(Decimal('0.01'))
                    rq.fecha_real_entrega = today - timedelta(days=rng.randint(1, 10))
                rq.save(update_fields=['estimated_cost', 'final_cost', 'fecha_real_entrega'])

                made += 1
                status_counter[status] = status_counter.get(status, 0) + 1

                # ---- Approvals chain (simplified but valid) ----------------
                chain = []
                if status != 'DRAFT':
                    chain.append(('SUBMITTED', requester, 'REQUESTER', 'DRAFT', 'SUBMITTED'))
                if is_ops:
                    if status not in ('DRAFT', 'SUBMITTED', 'TECHNICAL_REJECTED'):
                        chain.append(('TECHNICAL_APPROVED', pick(residents), 'PROJECT_RESIDENT',
                                      'SUBMITTED', 'TECHNICAL_APPROVED'))
                    if status == 'TECHNICAL_REJECTED':
                        chain.append(('TECHNICAL_REJECTED', pick(residents), 'PROJECT_RESIDENT',
                                      'SUBMITTED', 'TECHNICAL_REJECTED'))
                    if prank(status) >= prank('VALIDATED') and prank(status) >= 0:
                        chain.append(('VALIDATED', pick(controls), 'PROJECT_CONTROL',
                                      'TECHNICAL_APPROVED', 'VALIDATED'))
                else:
                    if status not in ('DRAFT', 'SUBMITTED', 'SUPERVISOR_REJECTED'):
                        chain.append(('SUPERVISOR_APPROVED', pick(supervisors), 'DIRECT_SUPERVISOR',
                                      'SUBMITTED', 'SUPERVISOR_APPROVED'))
                    if status == 'SUPERVISOR_REJECTED':
                        chain.append(('SUPERVISOR_REJECTED', pick(supervisors), 'DIRECT_SUPERVISOR',
                                      'SUBMITTED', 'SUPERVISOR_REJECTED'))
                    if prank(status) >= prank('VALIDATED') and prank(status) >= 0:
                        chain.append(('ADMIN_BUDGET_REVIEWED', pick(admin_mgrs), 'ADMIN_MANAGER',
                                      'SUPERVISOR_APPROVED', 'VALIDATED'))
                if prank(status) >= prank('QUOTE_SELECTED') and prank(status) >= 0:
                    chain.append(('QUOTE_SELECTED', pick(coords if is_ops else log_chiefs),
                                  'LOGISTICS_COORDINATOR' if is_ops else 'LOGISTICS_CHIEF',
                                  'QUOTE_COMPARISON', 'QUOTE_SELECTED'))
                if prank(status) >= prank('QUOTE_COST_APPROVED') and prank(status) >= 0:
                    chain.append(('QUOTE_COST_APPROVED', pick(controls if is_ops else admin_mgrs),
                                  'PROJECT_CONTROL' if is_ops else 'ADMIN_MANAGER',
                                  'QUOTE_SELECTED', 'QUOTE_COST_APPROVED'))

                t = created_dt
                for action, who, role, prev, new in chain:
                    if not who:
                        continue
                    t = t + timedelta(hours=rng.randint(2, 40))
                    Approval.objects.create(request=rq, action=action, performed_by=who, role=role,
                                            previous_status=prev, new_status=new,
                                            comments='Aprobado conforme.' if 'REJECT' not in action
                                            else 'Observado, no procede.')
                    Approval.objects.filter(request=rq, action=action).update(performed_at=t)
                    appr_made += 1
                    ActivityLog.objects.create(request=rq, user=who, action=action,
                                               detail=f'{role} ejecutó {action} en {rq_number}.')
                    act_made += 1

                # ---- Quotations (purchase path from QUOTING onward) --------
                selected_q = None
                if prank(status) >= prank('QUOTING') and prank(status) >= 0:
                    n_q = rng.randint(2, 3)
                    chosen = rng.sample(all_suppliers, min(n_q, len(all_suppliers)))
                    for qi, sup in enumerate(chosen, 1):
                        factor = Decimal(str(rng.uniform(0.9, 1.15)))
                        q_total = (total * factor).quantize(Decimal('0.01'))
                        is_sel = (qi == 1 and prank(status) >= prank('QUOTE_SELECTED'))
                        q = Quotation.objects.create(
                            request=rq, supplier=sup, quotation_number=f'COT-{seq:04d}-{qi}',
                            total_amount=q_total, currency='PEN',
                            delivery_days=rng.randint(3, 20),
                            payment_terms=rng.choice(['Contado', '30 días', '15 días', '50% adelanto']),
                            validity_days=rng.choice([15, 30]), is_selected=is_sel,
                            selected_by=(pick(coords) if is_sel else None),
                            selected_at=(t if is_sel else None))
                        q_made += 1
                        if is_sel:
                            selected_q = q
                        for it in items:
                            up = (it.unit_price * factor).quantize(Decimal('0.01'))
                            QuotationItem.objects.create(
                                quotation=q, request_item=it, unit_price=up, quantity=it.quantity,
                                total_price=(up * it.quantity).quantize(Decimal('0.01')),
                                brand=rng.choice(['Genérico', 'Marca A', 'Marca B', 'Premium']))

                # ---- Purchase Order (PO_GENERATED onward) ------------------
                po = None
                if prank(status) >= prank('PO_GENERATED') and prank(status) >= 0:
                    sup = selected_q.supplier if selected_q else pick(all_suppliers)
                    po_status = ('FULLY_RECEIVED' if prank(status) >= prank('RECEIVING') else 'SENT')
                    po = PurchaseOrder.objects.create(
                        po_number=f'OC-2026-{seq:04d}', request=rq, quotation=selected_q, supplier=sup,
                        generated_by=pick(coords if is_ops else log_sups), status=po_status,
                        total_amount=(selected_q.total_amount if selected_q else total),
                        currency='PEN', payment_terms='30 días',
                        expected_delivery_date=today + timedelta(days=rng.randint(3, 20)))
                    po_made += 1
                    for it in items:
                        PurchaseOrderItem.objects.create(
                            purchase_order=po, request_item=it, description=it.description,
                            quantity=it.quantity, unit=it.unit, unit_price=it.unit_price,
                            total_price=it.total_price)

                # ---- Warehouse receipt (RECEIVING onward) ------------------
                receipt = None
                if prank(status) >= prank('RECEIVING') and prank(status) >= 0 and po:
                    passed = status != 'QUALITY_REJECTED'
                    receipt = WarehouseReceipt.objects.create(
                        request=rq, purchase_order=po, received_by=pick(central_wh),
                        receipt_number=f'GR-2026-{seq:04d}',
                        supplier_guide_number=f'G-{rng.randint(1000, 9999)}',
                        conformity_passed=passed,
                        conformity_checked_by=pick(coords),
                        conformity_notes='Conforme.' if passed else 'No conforme, se observa.')
                    rc_made += 1
                    for it in items:
                        WarehouseReceiptItem.objects.create(
                            receipt=receipt, request_item=it, quantity_received=it.quantity,
                            quantity_accepted=(it.quantity if passed else Decimal('0')),
                            quantity_rejected=(Decimal('0') if passed else it.quantity))

                # ---- Warehouse dispatch (DISPATCHED_TO_SITE onward) --------
                if prank(status) >= prank('DISPATCHED_TO_SITE') and prank(status) >= 0:
                    delivered = prank(status) >= prank('DELIVERED')
                    dp = WarehouseDispatch.objects.create(
                        request=rq, receipt=receipt, dispatched_by=pick(central_wh),
                        dispatch_number=f'GD-2026-{seq:04d}', origin='CENTRAL',
                        destination_project=project, destination_department=department,
                        dispatch_guide_number=f'GD-{rng.randint(1000, 9999)}',
                        delivered_at=(now if delivered else None),
                        accepted_by=(pick(site_wh) if delivered else None))
                    dp_made += 1
                    for it in items:
                        WarehouseDispatchItem.objects.create(
                            dispatch=dp, request_item=it, quantity_dispatched=it.quantity,
                            quantity_delivered=(it.quantity if delivered else Decimal('0')))

        counts['requests_creados'] = made
        counts['requests_por_estado'] = status_counter
        counts['cotizaciones'] = q_made
        counts['ordenes_compra'] = po_made
        counts['recepciones_almacen'] = rc_made
        counts['despachos_almacen'] = dp_made
        counts['aprobaciones'] = appr_made
        counts['activity_logs'] = act_made

        # ---- Summary --------------------------------------------------------
        self.stdout.write(self.style.SUCCESS('\n=== Seed de screenshots completado ==='))
        for k, v in counts.items():
            if isinstance(v, dict):
                self.stdout.write(f'  {k}:')
                for sk, sv in sorted(v.items()):
                    self.stdout.write(f'      {sk}: {sv}')
            else:
                self.stdout.write(f'  {k}: {v}')
        self.stdout.write(self.style.SUCCESS(
            f"\nTotal Requests en BD: {Request.objects.count()} | "
            f"Usuarios: {User.objects.count()} | Proyectos: {Project.objects.count()} | "
            f"Proveedores: {Supplier.objects.count()}"))
        self.stdout.write(f"Password de todos los usuarios demo: {DEMO_PASSWORD}")
