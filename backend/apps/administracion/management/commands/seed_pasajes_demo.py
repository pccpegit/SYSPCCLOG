"""
Demo seeder for the Administración — Pasajes module.

Creates realistic sample data so the UI can be explored end-to-end:
  - core.Personal      : sample employees (linked by DNI to pasajes)
  - administracion.Puesto
  - administracion.ProveedorPasajes
  - administracion.Pasaje : ~24 travel tickets across the last two months,
                            mixed tipo / moneda / estado.

Idempotent: reruns update the same records (matched by DNI / factura_ticket),
so running it twice will not duplicate data.

Usage:
    python manage.py seed_pasajes_demo
"""

from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.core.models import Personal, Project, User
from apps.administracion.models import Pasaje, ProveedorPasajes, Puesto


# --------------------------------------------------------------------------- #
# Reference data
# --------------------------------------------------------------------------- #

PUESTOS = [
    'Ingeniero de Proyecto',
    'Supervisor de Obra',
    'Operario',
    'Asistente Administrativo',
    'Jefe de Logística',
    'Técnico Electricista',
    'Almacenero',
    'Residente de Obra',
]

PROVEEDORES = [
    ('20100073722', 'Latam Airlines Perú S.A.'),
    ('20605763399', 'Sky Airline Perú S.A.C.'),
    ('20502776256', 'Transportes Cruz del Sur S.A.C.'),
    ('20601226879', 'Viva Air Perú S.A.C.'),
    ('20512178744', 'Turismo Civa S.A.C.'),
]

# Sample personnel: (dni, apellidos_nombres, sexo, puesto, tipo_trabajador, celular)
PERSONAL = [
    ('44112233', 'QUISPE MAMANI, Carlos Alberto',    'M', 'Ingeniero de Proyecto',    'STAFF',  '987654321'),
    ('45223344', 'HUAMAN CCAHUANA, Rosa María',      'F', 'Asistente Administrativo', 'STAFF',  '986543210'),
    ('46334455', 'FLORES CONDORI, Juan Pablo',        'M', 'Operario',                 'WORKER', '985432109'),
    ('47445566', 'TICONA APAZA, Luis Fernando',       'M', 'Supervisor de Obra',       'STAFF',  '984321098'),
    ('48556677', 'CHOQUE HUANCA, Ana Lucía',          'F', 'Jefe de Logística',        'STAFF',  '983210987'),
    ('49667788', 'MAMANI QUISPE, Pedro José',         'M', 'Operario',                 'WORKER', '982109876'),
    ('40778899', 'VILCA CALLA, Miguel Ángel',         'M', 'Técnico Electricista',     'WORKER', '981098765'),
    ('41889900', 'CACERES ROMERO, Diana Carolina',    'F', 'Almacenero',               'WORKER', '980987654'),
    ('42990011', 'ROJAS PAREDES, Jorge Luis',         'M', 'Residente de Obra',        'STAFF',  '979876543'),
    ('43001122', 'GUTIERREZ SALAS, Sofía Elena',      'F', 'Asistente Administrativo', 'STAFF',  '978765432'),
]

RUTAS_BAJADA = [
    ('Cusco', 'Lima'),
    ('Arequipa', 'Lima'),
    ('Juliaca', 'Lima'),
    ('Ayacucho', 'Lima'),
]
RUTAS_SUBIDA = [
    ('Lima', 'Cusco'),
    ('Lima', 'Arequipa'),
    ('Lima', 'Juliaca'),
    ('Lima', 'Ayacucho'),
]

# (dias_atras, tipo, moneda, monto, devolucion, estado, persona_idx, prov_idx)
# monto is in the ticket currency; devolucion is always in PEN.
PASAJES = [
    (0,  'B',   'SOLES',   '380.00', '0',      'PENDIENTE', 0, 0),
    (1,  'S',   'SOLES',   '420.00', '120.00', 'PENDIENTE', 1, 1),
    (2,  'S/B', 'SOLES',   '760.00', '0',      'PAGADO',    2, 2),
    (4,  'B',   'DOLARES', '95.00',  '0',      'PENDIENTE', 3, 0),
    (5,  'S',   'SOLES',   '510.00', '150.00', 'PAGADO',    4, 3),
    (7,  'B',   'SOLES',   '290.00', '0',      'PENDIENTE', 5, 4),
    (9,  'S/B', 'SOLES',   '840.00', '200.00', 'PAGADO',    6, 1),
    (11, 'B',   'DOLARES', '110.00', '0',      'PENDIENTE', 7, 0),
    (13, 'S',   'SOLES',   '460.00', '0',      'PAGADO',    8, 2),
    (15, 'B',   'SOLES',   '330.00', '90.00',  'PENDIENTE', 9, 3),
    (18, 'S/B', 'SOLES',   '720.00', '0',      'PAGADO',    0, 4),
    (20, 'B',   'SOLES',   '400.00', '0',      'PENDIENTE', 2, 1),
    (23, 'S',   'DOLARES', '130.00', '0',      'PAGADO',    4, 0),
    (26, 'B',   'SOLES',   '355.00', '120.00', 'PENDIENTE', 1, 2),
    (29, 'S/B', 'SOLES',   '690.00', '180.00', 'PAGADO',    3, 3),
    (32, 'B',   'SOLES',   '310.00', '0',      'PAGADO',    5, 4),
    (35, 'S',   'SOLES',   '480.00', '0',      'PENDIENTE', 6, 1),
    (38, 'B',   'DOLARES', '88.00',  '0',      'PAGADO',    7, 0),
    (41, 'S/B', 'SOLES',   '810.00', '220.00', 'PAGADO',    8, 2),
    (44, 'B',   'SOLES',   '365.00', '0',      'PENDIENTE', 9, 3),
    (47, 'S',   'SOLES',   '440.00', '130.00', 'PAGADO',    0, 4),
    (50, 'B',   'SOLES',   '295.00', '0',      'PAGADO',    2, 0),
    (53, 'S/B', 'DOLARES', '210.00', '0',      'PENDIENTE', 4, 1),
    (56, 'B',   'SOLES',   '375.00', '0',      'PAGADO',    6, 2),
]

TIPO_CAMBIO = Decimal('3.755')


class Command(BaseCommand):
    help = 'Seed demo data for the Pasajes module (personnel + travel tickets).'

    @transaction.atomic
    def handle(self, *args, **options):
        today = timezone.localdate()

        author = (
            User.objects.filter(is_superuser=True).first()
            or User.objects.order_by('id').first()
        )
        if author is None:
            self.stdout.write(self.style.ERROR(
                'No hay usuarios en la base de datos. Ejecuta primero "seed_demo".'
            ))
            return

        projects = list(Project.objects.all()[:5])

        # -- Puestos ---------------------------------------------------------
        puestos_creados = 0
        for cargo in PUESTOS:
            _, created = Puesto.objects.get_or_create(cargo=cargo)
            puestos_creados += int(created)

        # -- Proveedores -----------------------------------------------------
        proveedores = []
        prov_creados = 0
        for ruc, razon in PROVEEDORES:
            prov, created = ProveedorPasajes.objects.get_or_create(
                ruc=ruc, defaults={'razon_social': razon},
            )
            proveedores.append(prov)
            prov_creados += int(created)

        # -- Personal --------------------------------------------------------
        personal_objs = []
        pers_creados = 0
        for idx, (dni, nombres, sexo, puesto, _tipo, celular) in enumerate(PERSONAL):
            proyecto = projects[idx % len(projects)] if projects else None
            persona, created = Personal.objects.update_or_create(
                dni=dni,
                defaults={
                    'apellidos_nombres': nombres,
                    'sexo': sexo,
                    'celular': celular,
                    'email_personal': f'{dni}@demo.pcc.pe',
                    'estado': 'ACTIVO',
                    'fecha_ingreso': today - timedelta(days=365 + idx * 30),
                    'proyecto': proyecto,
                    'sede': 'Sede Central',
                    'puesto': puesto,
                    'condicion_trabajo': 'PLANILLA',
                    'salario': Decimal('2500.00') + Decimal(idx) * Decimal('150'),
                },
            )
            personal_objs.append(persona)
            pers_creados += int(created)

        # -- Pasajes ---------------------------------------------------------
        pasajes_creados = 0
        for i, row in enumerate(PASAJES):
            dias, tipo, moneda, monto, devol, estado, pidx, providx = row
            persona = personal_objs[pidx]
            dni, nombres, _sexo, puesto, tipo_trab, _cel = PERSONAL[pidx]
            proveedor = proveedores[providx]
            centro_costo = projects[i % len(projects)] if projects else None

            fecha = today - timedelta(days=dias)
            monto_dec = Decimal(monto)
            devol_dec = Decimal(devol)

            factura = f'DEMO-{i + 1:04d}'

            defaults = {
                'tipo': tipo,
                'personal': persona,
                'dni': dni,
                'nombres': nombres,
                'cargo': puesto,
                'tipo_trabajador': tipo_trab,
                'centro_costo': centro_costo,
                'proveedor': proveedor,
                'ruc': proveedor.ruc,
                'razon_social': proveedor.razon_social,
                'detalle': '',
                'fecha': fecha,
                'moneda': moneda,
                'devolucion': devol_dec,
                'tipo_cambio': TIPO_CAMBIO if moneda == 'DOLARES' else Decimal('0'),
                'monto_con_igv_soles': monto_dec if moneda == 'SOLES' else Decimal('0'),
                'monto_con_igv_dolares': monto_dec if moneda == 'DOLARES' else Decimal('0'),
                'estado': estado,
                'habilitado': True,
                'creado_por': author,
            }

            # Travel legs / route
            if tipo in ('B', 'S/B'):
                emb, dst = RUTAS_BAJADA[i % len(RUTAS_BAJADA)]
                defaults['fecha_bajada'] = fecha
                defaults['embarque_bajada'] = emb
                defaults['destino_bajada'] = dst
            if tipo in ('S', 'S/B'):
                emb, dst = RUTAS_SUBIDA[i % len(RUTAS_SUBIDA)]
                defaults['fecha_subida'] = fecha + timedelta(days=1)
                defaults['embarque_subida'] = emb
                defaults['destino_subida'] = dst
            defaults['detalle'] = (
                f'{defaults.get("embarque_bajada") or defaults.get("embarque_subida")} → '
                f'{defaults.get("destino_bajada") or defaults.get("destino_subida")}'
            )

            # Payment info
            if estado == 'PAGADO':
                defaults['fecha_pago'] = fecha + timedelta(days=3)
                defaults['numero_operacion'] = f'OP-{100000 + i}'

            _, created = Pasaje.objects.update_or_create(
                factura_ticket=factura, defaults=defaults,
            )
            pasajes_creados += int(created)

        self.stdout.write(self.style.SUCCESS(
            f'Seed Pasajes OK — '
            f'Puestos: {puestos_creados} nuevos / {len(PUESTOS)} totales, '
            f'Proveedores: {prov_creados} nuevos / {len(PROVEEDORES)} totales, '
            f'Personal: {pers_creados} nuevos / {len(PERSONAL)} totales, '
            f'Pasajes: {pasajes_creados} nuevos / {len(PASAJES)} totales. '
            f'(autor: {author.username})'
        ))
