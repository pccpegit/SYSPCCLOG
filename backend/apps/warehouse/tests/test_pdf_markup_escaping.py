"""
SYSPCC-025 (seguridad, ronda 1) — el texto de usuario del vale PDF no se interpreta como marcado.

ReportLab trata el texto de un ``Paragraph`` como mini-HTML: un N° de vale ``<img src="http://...">``
hacía que el servidor abriera una conexión saliente (SSRF ciego) y un ``<b>`` sin cerrar lanzaba
``ValueError`` (el PDF dejaba de generarse). Todos los datos de usuario se escapan antes de formatearse.
"""
import io
from unittest import mock

import pytest
from pypdf import PdfReader
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate

from apps.warehouse.models import MovementGroup
from apps.warehouse.services import movements as svc
from apps.warehouse.services.pdf_generator import _esc, generate_group_pdf, generate_movement_pdf

pytestmark = pytest.mark.django_db

SSRF_PROBE = '<img src="http://127.0.0.1:9/a.png"/>'      # 38 caracteres: se prueba directo sobre el modelo
SHORT_PROBE = '<img src="http://h/a.png"/>'              # 26 caracteres: cabe en un N° de vale (máx. 30)
UNCLOSED = '<b>sin cerrar'
AMPERSAND = 'Ferretería A & B <i>'


@pytest.fixture
def outbound():
    """Registra (y bloquea) cualquier intento de ReportLab de abrir una URL."""
    with mock.patch('reportlab.lib.utils.urlopen', side_effect=OSError('bloqueado')) as probe:
        yield probe


def _pdf_text(pdf: bytes) -> str:
    """Text of the PDF with whitespace collapsed (a long value wraps over several lines)."""
    reader = PdfReader(io.BytesIO(pdf))
    return ' '.join(' '.join(page.extract_text() or '' for page in reader.pages).split())


def _exit_group(user, item, **kwargs):
    base = dict(
        items_data=[{'inventory_id': item.pk, 'quantity': 1}], warehouse='CENTRAL', project_id=None,
        destination_type='EMPLOYEE', destination_detail='Persona Prueba', requested_by_id=None,
        authorized_by_id=None, notes='', registered_by=user,
    )
    base.update(kwargs)
    return svc.register_exit_batch(**base)


@pytest.fixture
def item(make_item):
    return make_item('EPP000001', 'GUANTE T: L', 'EA', stock=10)


def test_the_probe_detects_an_outbound_fetch_when_the_text_is_not_escaped(outbound):
    """Control del test: sin escapar, ReportLab sí intenta abrir la URL."""
    with pytest.raises(OSError):
        SimpleDocTemplate(io.BytesIO()).build([Paragraph(SHORT_PROBE, getSampleStyleSheet()['Normal'])])
    assert outbound.called


class TestEscapeHelper:
    @pytest.mark.parametrize('raw,expected', [
        ('<b>x', '&lt;b&gt;x'), ('A & B', 'A &amp; B'), (None, ''), (12, '12'), ('texto', 'texto'),
    ])
    def test_escapes_markup_and_tolerates_none_and_numbers(self, raw, expected):
        assert _esc(raw) == expected


class TestGroupPdf:
    def test_a_voucher_number_with_an_img_tag_is_printed_as_text_and_never_fetched(
        self, central_warehouse, item, outbound,
    ):
        group = _exit_group(central_warehouse, item, voucher_number=SHORT_PROBE)
        pdf = generate_group_pdf(MovementGroup.objects.get(pk=group.pk))
        assert pdf.startswith(b'%PDF')
        assert not outbound.called
        assert SHORT_PROBE in _pdf_text(pdf)

    def test_an_unclosed_tag_in_the_voucher_number_does_not_break_the_pdf(self, central_warehouse, item):
        group = _exit_group(central_warehouse, item, voucher_number=UNCLOSED)
        pdf = generate_group_pdf(MovementGroup.objects.get(pk=group.pk))
        assert pdf.startswith(b'%PDF')
        assert UNCLOSED in _pdf_text(pdf)

    def test_destination_notes_and_supplier_with_markup_and_ampersand(self, central_warehouse, item, outbound):
        group = _exit_group(
            central_warehouse, item,
            destination_detail=f'{AMPERSAND} {SSRF_PROBE}', notes=f'{UNCLOSED} & {SHORT_PROBE}',
        )
        pdf = generate_group_pdf(MovementGroup.objects.get(pk=group.pk))
        text = _pdf_text(pdf)
        assert pdf.startswith(b'%PDF') and not outbound.called
        assert 'Ferretería A & B <i>' in text
        assert UNCLOSED in text

    def test_entry_group_with_hostile_supplier_and_invoice(self, central_warehouse, item, outbound):
        group = svc.register_entry_batch(
            items_data=[{'inventory_id': item.pk, 'quantity': 2}], warehouse='CENTRAL', project_id=None,
            source_type='PURCHASE', supplier_name=f'{AMPERSAND}{SHORT_PROBE}', invoice_number=UNCLOSED,
            notes='', registered_by=central_warehouse,
        )
        pdf = generate_group_pdf(MovementGroup.objects.get(pk=group.pk))
        assert pdf.startswith(b'%PDF') and not outbound.called

    def test_a_registering_user_whose_name_has_markup_does_not_break_the_signature_block(
        self, central_warehouse, item, outbound,
    ):
        central_warehouse.first_name = '<b>Rosa'
        central_warehouse.last_name = 'A & B <img src="http://h/x.png"/>'
        central_warehouse.save()
        group = _exit_group(central_warehouse, item)
        pdf = generate_group_pdf(MovementGroup.objects.get(pk=group.pk))
        assert pdf.startswith(b'%PDF') and not outbound.called


class TestMovementPdf:
    def test_single_movement_pdf_with_markup_in_every_free_text_field(self, central_warehouse, item, outbound):
        group = _exit_group(
            central_warehouse, item, voucher_number=UNCLOSED,
            destination_detail=f'{AMPERSAND}{SHORT_PROBE}',
            # the single-movement vale prints the note of the LINE, not the one of the group
            items_data=[{'inventory_id': item.pk, 'quantity': 1, 'notes': f'{UNCLOSED} {SHORT_PROBE}'}],
        )
        movement = group.movements.get()
        pdf = generate_movement_pdf(movement)
        assert pdf.startswith(b'%PDF') and not outbound.called
        assert UNCLOSED in _pdf_text(pdf)


class TestEndpoints:
    """De punta a punta: el vale se registra por la API y el PDF se descarga."""

    URL = '/api/v1/warehouse/movements/'

    def test_epp_delivery_with_a_markup_voucher_number_yields_a_downloadable_pdf(
        self, central_warehouse, item, outbound,
    ):
        from rest_framework.test import APIClient

        from apps.warehouse.tests.conftest import client_for

        client: APIClient = client_for(central_warehouse)
        with mock.patch('apps.warehouse.views._enqueue_group_pdf_upload'):
            response = client.post(self.URL + 'epp-delivery/', {
                'warehouse': 'CENTRAL', 'voucher_number': SHORT_PROBE,
                'movement_date': '2026-10-01', 'recipient': {'name': AMPERSAND},
                'items': [{'inventory': item.pk, 'quantity': 1}],
            }, format='json')
        assert response.status_code == 201, response.content
        pdf_response = client.get(f"{self.URL}groups/{response.json()['id']}/pdf/")
        assert pdf_response.status_code == 200
        assert pdf_response['Content-Type'] == 'application/pdf'
        assert pdf_response.content.startswith(b'%PDF')
        assert not outbound.called
