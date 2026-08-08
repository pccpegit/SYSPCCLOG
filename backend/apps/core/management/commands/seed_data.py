"""
Management command to populate initial/reference data.
Populates: AcquisitionTypeConfig, WorkflowStep definitions.
Safe to run multiple times (uses get_or_create).

Usage:
    python manage.py seed_data
    python manage.py seed_data --clear   # Delete and re-create everything
"""

from django.core.management.base import BaseCommand
from django.db import transaction


ACQUISITION_TYPE_DATA = [
    {
        'type': 'COMPRA_LOCAL',
        'min_days': 1,
        'max_days': 3,
        'max_extended_days': None,
        'requires_gm_approval': False,
        'requires_admin_approval': False,
        'requires_project_manager_approval': False,
        'requires_cost_control_approval': False,
        'notes': 'Compra local. 1-3 días puesto en obra.',
    },
    {
        'type': 'COMPRA_FORANEA',
        'min_days': 5,
        'max_days': 7,
        'max_extended_days': None,
        'requires_gm_approval': False,
        'requires_admin_approval': False,
        'requires_project_manager_approval': False,
        'requires_cost_control_approval': False,
        'notes': 'Compra foránea. 5-7 días puesto en obra.',
    },
    {
        'type': 'IMPORTACION',
        'min_days': 14,
        'max_days': 56,
        'max_extended_days': None,
        'requires_gm_approval': True,
        'requires_admin_approval': True,
        'requires_project_manager_approval': True,
        'requires_cost_control_approval': True,
        'notes': 'Importación. 2-8 semanas. Requiere aprobación GG + Gte.Proyecto + Control Costos + Gte.Admin.',
    },
    {
        'type': 'FABRICACION',
        'min_days': 7,
        'max_days': 15,
        'max_extended_days': 22,
        'requires_gm_approval': False,
        'requires_admin_approval': False,
        'requires_project_manager_approval': False,
        'requires_cost_control_approval': False,
        'notes': 'Fabricación. 7-15 días (+7d extensión). Talleres PCC u otros.',
    },
    {
        'type': 'ALQUILER',
        'min_days': 3,
        'max_days': 15,
        'max_extended_days': None,
        'requires_gm_approval': False,
        'requires_admin_approval': False,
        'requires_project_manager_approval': False,
        'requires_cost_control_approval': False,
        'notes': 'Alquiler. 3-15 días + tiempo homologación/permisos.',
    },
    {
        'type': 'CALIBRACION',
        'min_days': 7,
        'max_days': 10,
        'max_extended_days': None,
        'requires_gm_approval': False,
        'requires_admin_approval': False,
        'requires_project_manager_approval': False,
        'requires_cost_control_approval': False,
        'notes': 'Calibración. 7-10 días. Laboratorios INACAL Lima.',
    },
]


WORKFLOW_STEPS_DATA = [
    # ════════════════════════════════════════════
    # FLUJO OPERACIONES
    # ════════════════════════════════════════════

    # Phase 1: Request and technical validation
    {
        'flow': 'OPERATIONS', 'step_order': 1, 'phase': 1,
        'step_code': 'OPS_SUBMIT',
        'step_name': 'Usuario genera RQ',
        'responsible_role': 'REQUESTER',
        'from_status': 'DRAFT',
        'to_status_approve': 'SUBMITTED',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 2, 'phase': 1,
        'step_code': 'OPS_TECH_REVIEW',
        'step_name': 'Residente verifica especificaciones técnicas',
        'responsible_role': 'PROJECT_RESIDENT',
        'from_status': 'SUBMITTED',
        'to_status_approve': 'TECHNICAL_APPROVED',
        'to_status_reject': 'TECHNICAL_REJECTED',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': True,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 3, 'phase': 2,
        'step_code': 'OPS_BUDGET_REVIEW',
        'step_name': 'Control de Proyecto revisa RQ vs presupuesto',
        'responsible_role': 'PROJECT_CONTROL',
        'from_status': 'TECHNICAL_APPROVED',
        'to_status_approve': 'WITHIN_PROPOSAL',
        'to_status_reject': 'ADDITIONAL_REQ',
        'is_conditional': True,
        'condition_description': 'WITHIN_PROPOSAL si dentro de propuesta; ADDITIONAL_REQ si es adicional → solicita GG',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 4, 'phase': 2,
        'step_code': 'OPS_GM_REVIEW',
        'step_name': 'Gerente General revisa adicional',
        'responsible_role': 'GENERAL_MANAGER',
        'from_status': 'GM_REVIEW',
        'to_status_approve': 'GM_APPROVED',
        'to_status_reject': 'GM_REJECTED',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': True,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 5, 'phase': 2,
        'step_code': 'OPS_VALIDATED',
        'step_name': 'Requerimiento queda validado (sistema)',
        'responsible_role': 'LOGISTICS_COORDINATOR',
        'from_status': 'VALIDATED',
        'to_status_approve': 'STOCK_CHECK',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },

    # Phase 3: Logistics
    {
        'flow': 'OPERATIONS', 'step_order': 6, 'phase': 3,
        'step_code': 'OPS_STOCK_CHECK',
        'step_name': 'Coord. Logístico verifica stock',
        'responsible_role': 'LOGISTICS_COORDINATOR',
        'from_status': 'STOCK_CHECK',
        'to_status_approve': 'IN_STOCK',
        'to_status_reject': 'REQUIRES_PURCHASE',
        'is_conditional': True,
        'condition_description': 'IN_STOCK si hay stock; REQUIRES_PURCHASE si no hay',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 7, 'phase': 3,
        'step_code': 'OPS_QUOTING',
        'step_name': 'Coord. Logístico solicita cotizaciones',
        'responsible_role': 'LOGISTICS_COORDINATOR',
        'from_status': 'REQUIRES_PURCHASE',
        'to_status_approve': 'QUOTING',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 8, 'phase': 3,
        'step_code': 'OPS_QUOTE_SELECT',
        'step_name': 'Coord. Logístico selecciona proveedor',
        'responsible_role': 'LOGISTICS_COORDINATOR',
        'from_status': 'QUOTING',
        'to_status_approve': 'QUOTE_SELECTED',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 9, 'phase': 3,
        'step_code': 'OPS_PO_OR_OVERRUN',
        'step_name': 'Coord. Logístico verifica presupuesto vs cotización',
        'responsible_role': 'LOGISTICS_COORDINATOR',
        'from_status': 'QUOTE_SELECTED',
        'to_status_approve': 'PO_GENERATED',
        'to_status_reject': 'COST_OVERRUN_REVIEW',
        'is_conditional': True,
        'condition_description': 'PO_GENERATED si OK; COST_OVERRUN_REVIEW si excede presupuesto',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 10, 'phase': 3,
        'step_code': 'OPS_OVERRUN_GG',
        'step_name': 'GG aprueba sobrecosto',
        'responsible_role': 'GENERAL_MANAGER',
        'from_status': 'COST_OVERRUN_REVIEW',
        'to_status_approve': 'COST_OVERRUN_APPROVED',
        'to_status_reject': 'COST_OVERRUN_REJECTED',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': True,
    },

    # Phase 4: Reception
    {
        'flow': 'OPERATIONS', 'step_order': 11, 'phase': 4,
        'step_code': 'OPS_RECEIVING',
        'step_name': 'Almacén Central recibe bienes',
        'responsible_role': 'CENTRAL_WAREHOUSE',
        'from_status': 'PO_GENERATED',
        'to_status_approve': 'RECEIVING',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 12, 'phase': 4,
        'step_code': 'OPS_QC',
        'step_name': 'Almacén Central realiza control de calidad',
        'responsible_role': 'CENTRAL_WAREHOUSE',
        'from_status': 'RECEIVING',
        'to_status_approve': 'QUALITY_APPROVED',
        'to_status_reject': 'QUALITY_REJECTED',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 13, 'phase': 4,
        'step_code': 'OPS_DISPATCH',
        'step_name': 'Almacén Central despacha a Almacén Obra',
        'responsible_role': 'CENTRAL_WAREHOUSE',
        'from_status': 'QUALITY_APPROVED',
        'to_status_approve': 'DISPATCHED_TO_SITE',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 14, 'phase': 4,
        'step_code': 'OPS_SITE_WAREHOUSE',
        'step_name': 'Almacén Obra actualiza registros y marca entregado',
        'responsible_role': 'SITE_WAREHOUSE',
        'from_status': 'DISPATCHED_TO_SITE',
        'to_status_approve': 'DELIVERED',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },

    # Phase 5: Conformity
    {
        'flow': 'OPERATIONS', 'step_order': 15, 'phase': 5,
        'step_code': 'OPS_USER_CONFORMITY',
        'step_name': 'Usuario confirma recepción conforme',
        'responsible_role': 'REQUESTER',
        'from_status': 'DELIVERED',
        'to_status_approve': 'USER_CONFORMITY',
        'to_status_reject': 'USER_CLAIM',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'OPERATIONS', 'step_order': 16, 'phase': 5,
        'step_code': 'OPS_CLOSE',
        'step_name': 'Coord. Logístico cierra el RQ',
        'responsible_role': 'LOGISTICS_COORDINATOR',
        'from_status': 'USER_CONFORMITY',
        'to_status_approve': 'CLOSED',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },

    # ════════════════════════════════════════════
    # FLUJO ADMINISTRACIÓN
    # ════════════════════════════════════════════

    # Phase 1: Request and supervisor validation
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 1, 'phase': 1,
        'step_code': 'ADM_SUBMIT',
        'step_name': 'Usuario genera RQ',
        'responsible_role': 'REQUESTER',
        'from_status': 'DRAFT',
        'to_status_approve': 'SUBMITTED',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 2, 'phase': 1,
        'step_code': 'ADM_SUPERVISOR_REVIEW',
        'step_name': 'Jefe Directo revisa y aprueba/rechaza',
        'responsible_role': 'DIRECT_SUPERVISOR',
        'from_status': 'SUBMITTED',
        'to_status_approve': 'SUPERVISOR_APPROVED',
        'to_status_reject': 'SUPERVISOR_REJECTED',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': True,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 3, 'phase': 2,
        'step_code': 'ADM_BUDGET_REVIEW',
        'step_name': 'Gte. Administrativo revisa RQ vs Plan Anual',
        'responsible_role': 'ADMIN_MANAGER',
        'from_status': 'SUPERVISOR_APPROVED',
        'to_status_approve': 'WITHIN_ANNUAL_PLAN',
        'to_status_reject': 'OUT_OF_ANNUAL_PLAN',
        'is_conditional': True,
        'condition_description': 'WITHIN_ANNUAL_PLAN si en plan; OUT_OF_ANNUAL_PLAN → GG',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 4, 'phase': 2,
        'step_code': 'ADM_GM_REVIEW',
        'step_name': 'GG revisa requerimiento fuera de plan anual',
        'responsible_role': 'GENERAL_MANAGER',
        'from_status': 'GM_REVIEW',
        'to_status_approve': 'GM_APPROVED',
        'to_status_reject': 'GM_REJECTED',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': True,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 5, 'phase': 3,
        'step_code': 'ADM_STOCK_CHECK',
        'step_name': 'Sup. Logístico verifica stock',
        'responsible_role': 'LOGISTICS_SUPERVISOR',
        'from_status': 'VALIDATED',
        'to_status_approve': 'STOCK_CHECK',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 6, 'phase': 3,
        'step_code': 'ADM_STOCK_DECISION',
        'step_name': 'Decisión de stock',
        'responsible_role': 'LOGISTICS_SUPERVISOR',
        'from_status': 'STOCK_CHECK',
        'to_status_approve': 'IN_STOCK',
        'to_status_reject': 'REQUIRES_PURCHASE',
        'is_conditional': True,
        'condition_description': 'IN_STOCK o REQUIRES_PURCHASE según disponibilidad',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 7, 'phase': 3,
        'step_code': 'ADM_QUOTING',
        'step_name': 'Sup. Logístico solicita cotizaciones',
        'responsible_role': 'LOGISTICS_SUPERVISOR',
        'from_status': 'REQUIRES_PURCHASE',
        'to_status_approve': 'QUOTING',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 8, 'phase': 3,
        'step_code': 'ADM_QUOTE_COMPARE',
        'step_name': 'Jefe Logístico compara propuestas',
        'responsible_role': 'LOGISTICS_CHIEF',
        'from_status': 'QUOTING',
        'to_status_approve': 'QUOTE_COMPARISON',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 9, 'phase': 3,
        'step_code': 'ADM_QUOTE_SELECT',
        'step_name': 'Jefe Logístico selecciona proveedor',
        'responsible_role': 'LOGISTICS_CHIEF',
        'from_status': 'QUOTE_COMPARISON',
        'to_status_approve': 'QUOTE_SELECTED',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 10, 'phase': 3,
        'step_code': 'ADM_PO_OR_OVERRUN',
        'step_name': 'Sup. Logístico verifica presupuesto vs cotización',
        'responsible_role': 'LOGISTICS_SUPERVISOR',
        'from_status': 'QUOTE_SELECTED',
        'to_status_approve': 'PO_GENERATED',
        'to_status_reject': 'COST_OVERRUN_REVIEW',
        'is_conditional': True,
        'condition_description': 'PO_GENERATED si OK; COST_OVERRUN_REVIEW si excede',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 11, 'phase': 3,
        'step_code': 'ADM_OVERRUN_GG',
        'step_name': 'GG aprueba sobrecosto',
        'responsible_role': 'GENERAL_MANAGER',
        'from_status': 'COST_OVERRUN_REVIEW',
        'to_status_approve': 'COST_OVERRUN_APPROVED',
        'to_status_reject': 'COST_OVERRUN_REJECTED',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': True,
    },

    # Phase 4: Reception
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 12, 'phase': 4,
        'step_code': 'ADM_RECEIVING',
        'step_name': 'Sup. Logístico realiza recepción',
        'responsible_role': 'LOGISTICS_SUPERVISOR',
        'from_status': 'PO_GENERATED',
        'to_status_approve': 'RECEIVING',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 13, 'phase': 4,
        'step_code': 'ADM_CONFORMITY',
        'step_name': 'Sup. Logístico verifica conformidad de recepción',
        'responsible_role': 'LOGISTICS_SUPERVISOR',
        'from_status': 'RECEIVING',
        'to_status_approve': 'DELIVERED',
        'to_status_reject': 'RECEPTION_CLAIM',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 14, 'phase': 4,
        'step_code': 'ADM_WAREHOUSE_UPDATE',
        'step_name': 'Almacén Central actualiza registros',
        'responsible_role': 'CENTRAL_WAREHOUSE',
        'from_status': 'DELIVERED',
        'to_status_approve': 'WAREHOUSE_UPDATED',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },

    # Phase 5: Conformity
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 15, 'phase': 5,
        'step_code': 'ADM_USER_CONFORMITY',
        'step_name': 'Usuario confirma recepción conforme',
        'responsible_role': 'REQUESTER',
        'from_status': 'WAREHOUSE_UPDATED',
        'to_status_approve': 'USER_CONFORMITY',
        'to_status_reject': 'USER_CLAIM',
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
    {
        'flow': 'ADMINISTRATIVE', 'step_order': 16, 'phase': 5,
        'step_code': 'ADM_CLOSE',
        'step_name': 'Sup. Logístico cierra el RQ',
        'responsible_role': 'LOGISTICS_SUPERVISOR',
        'from_status': 'USER_CONFORMITY',
        'to_status_approve': 'CLOSED',
        'to_status_reject': None,
        'is_conditional': False,
        'condition_description': '',
        'is_terminal_on_reject': False,
    },
]


class Command(BaseCommand):
    # FIX-23: Explicit help text reminds operators never to embed default credentials.
    help = (
        'Populate initial reference data: AcquisitionTypeConfig and WorkflowStep. '
        'WARNING: This command must NEVER create default users, passwords, or credentials. '
        'All user accounts must be created separately with strong, unique passwords.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Delete existing records before seeding (destructive!)',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        from apps.rq.models import AcquisitionTypeConfig, WorkflowStep

        if options['clear']:
            self.stdout.write(self.style.WARNING('Clearing existing seed data...'))
            AcquisitionTypeConfig.objects.all().delete()
            WorkflowStep.objects.all().delete()

        # ── Acquisition Type Config ──────────────────────────
        self.stdout.write('Seeding AcquisitionTypeConfig...')
        created_count = 0
        for data in ACQUISITION_TYPE_DATA:
            obj, created = AcquisitionTypeConfig.objects.get_or_create(
                type=data['type'],
                defaults=data,
            )
            if not created:
                # Update existing record with current values
                for field, value in data.items():
                    setattr(obj, field, value)
                obj.save()
            else:
                created_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'  AcquisitionTypeConfig: {created_count} created, '
                f'{len(ACQUISITION_TYPE_DATA) - created_count} updated.'
            )
        )

        # ── Workflow Steps ────────────────────────────────────
        self.stdout.write('Seeding WorkflowStep...')
        created_count = 0
        for data in WORKFLOW_STEPS_DATA:
            obj, created = WorkflowStep.objects.get_or_create(
                flow=data['flow'],
                step_code=data['step_code'],
                defaults=data,
            )
            if not created:
                for field, value in data.items():
                    setattr(obj, field, value)
                obj.save()
            else:
                created_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'  WorkflowStep: {created_count} created, '
                f'{len(WORKFLOW_STEPS_DATA) - created_count} updated.'
            )
        )

        self.stdout.write(self.style.SUCCESS('\nSeed data completed successfully.'))
