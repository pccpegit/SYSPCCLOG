import io
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.hr.management.commands.seed_hr_template import build_demo_docx
from apps.hr.services import template_service


@pytest.fixture(autouse=True)
def hr_env(settings, tmp_path):
    """Isolated private storage, deterministic company data, no PDF, local cache."""
    settings.HR_PRIVATE_ROOT = str(tmp_path / 'private_media')
    settings.HR_PDF_ENABLED = False
    settings.HR_COMPANY_NAME = 'EMPRESA DEMO S.A.C.'
    settings.HR_COMPANY_RUC = '20123456789'
    settings.HR_COMPANY_ADDRESS = 'Av. Demo 100, Lima'
    settings.HR_COMPANY_LEGAL_REP_NAME = 'REPRESENTANTE DEMO'
    settings.HR_COMPANY_LEGAL_REP_DNI = '87654321'
    settings.HR_COMPANY_LEGAL_REP_TITLE = 'Gerente General'
    settings.HR_COMPANY_LEGAL_REP_POWERS = 'Poderes inscritos'
    settings.ANTHROPIC_API_KEY = ''
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    from django.core.cache import cache

    cache.clear()


def client_for(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


@pytest.fixture
def hr_client(hr_manager):
    return client_for(hr_manager)


def upload(content: bytes, name='plantilla.docx'):
    return SimpleUploadedFile(
        name, content,
        content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )


@pytest.fixture
def active_template(db, hr_manager):
    template = template_service.create_template(
        user=hr_manager, document_type='CONTRACT', name='Contrato demo', slug=None, notes='',
        uploaded_file=upload(build_demo_docx()),
    )
    return template_service.activate_template(template.pk, user=hr_manager)


@pytest.fixture
def contract_data():
    return {
        'worker_full_name': 'Ana Pérez', 'worker_dni': '12345678',
        'worker_address': 'Av. Siempre Viva 123, Lima', 'position': 'Asistente',
        'work_location': 'Oficina Central', 'contract_type': 'INDEFINITE',
        'start_date': '2026-11-01', 'gross_salary': '2000.00',
        'work_schedule': '48 horas semanales',
    }


def docx_text(field_file) -> str:
    from docx import Document

    field_file.open('rb')
    try:
        doc = Document(io.BytesIO(field_file.read()))
    finally:
        field_file.close()
    return '\n'.join(p.text for p in doc.paragraphs)


def make_zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()
