"""
Access-control tests for the Personal (RRHH) endpoints — SYSPCC-006 FIX 1.

`Personal` holds sensitive RRHH data (salary, banking, address, emergency
contact, family). These tests verify:
  - Non-RRHH authenticated users get 403 on retrieve/export.
  - Sensitive fields never appear in a response served to a non-RRHH user.
  - `buscar_dni` (used by the pasajes module) stays reachable to pasajes
    staff but returns only non-sensitive fields.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import Personal

SENSITIVE_FIELDS = (
    'salario',
    'numero_cuenta',
    'cci',
    'entidad_bancaria',
    'sistema_pensiones',
    'direccion_residencia',
    'departamento_residencia',
    'provincia_residencia',
    'distrito_residencia',
    'contacto_emergencia_nombre',
    'contacto_emergencia_telefono',
    'contacto_emergencia_vinculo',
    'tiene_hijos',
    'hijos_menores_18',
    'cantidad_hijos_menores',
    'nombres_hijos_menores',
    'asignacion_familiar',
)


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def personal_record(db, project):
    """A Personal record with every sensitive field populated."""
    return Personal.objects.create(
        dni='12345678',
        apellidos_nombres='Perez Lopez, Juan',
        proyecto=project,
        puesto='Operario',
        sede='Lima',
        salario='5500.00',
        numero_cuenta='191-123456-0-01',
        cci='00219100123456000112',
        entidad_bancaria='BCP',
        sistema_pensiones='AFP_HABITAT',
        direccion_residencia='Av. Siempre Viva 123',
        departamento_residencia='Lima',
        provincia_residencia='Lima',
        distrito_residencia='Miraflores',
        contacto_emergencia_nombre='Maria Lopez',
        contacto_emergencia_telefono='999999999',
        contacto_emergencia_vinculo='Esposa',
        tiene_hijos=True,
        hijos_menores_18=True,
        cantidad_hijos_menores=2,
        nombres_hijos_menores='Pedro, Ana',
        asignacion_familiar=True,
    )


@pytest.mark.django_db
class TestPersonalRetrieveAccessControl:
    def test_non_rrhh_user_gets_403_on_retrieve(self, requester, personal_record):
        client = _client_for(requester)
        response = client.get(f'/api/v1/personal/{personal_record.pk}/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_admin_manager_can_retrieve_with_sensitive_fields(self, admin_manager, personal_record):
        client = _client_for(admin_manager)
        response = client.get(f'/api/v1/personal/{personal_record.pk}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['numero_cuenta'] == personal_record.numero_cuenta
        assert response.data['cci'] == personal_record.cci
        assert response.data['direccion_residencia'] == personal_record.direccion_residencia
        assert response.data['nombres_hijos_menores'] == personal_record.nombres_hijos_menores

    def test_general_manager_can_retrieve(self, general_manager, personal_record):
        client = _client_for(general_manager)
        response = client.get(f'/api/v1/personal/{personal_record.pk}/')
        assert response.status_code == status.HTTP_200_OK

    def test_pasajes_manager_can_retrieve_full_detail(self, pasajes_manager, personal_record):
        """PASAJES_MANAGER is one of the RRHH-privileged roles (ticket spec), so full detail is allowed."""
        client = _client_for(pasajes_manager)
        response = client.get(f'/api/v1/personal/{personal_record.pk}/')
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestPersonalExportAccessControl:
    def test_non_rrhh_user_gets_403_on_export(self, requester):
        client = _client_for(requester)
        response = client.get('/api/v1/personal/export/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_admin_manager_can_export(self, admin_manager, personal_record):
        client = _client_for(admin_manager)
        response = client.get('/api/v1/personal/export/')
        assert response.status_code == status.HTTP_200_OK
        assert response['Content-Type'] == (
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )


@pytest.mark.django_db
class TestPersonalListAccessControl:
    def test_non_rrhh_user_gets_403_on_list(self, requester, personal_record):
        client = _client_for(requester)
        response = client.get('/api/v1/personal/')
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestBuscarDniAccessControl:
    def test_non_pasajes_user_gets_403(self, requester, personal_record):
        client = _client_for(requester)
        response = client.get('/api/v1/personal/buscar-dni/', {'dni': personal_record.dni})
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_pasajes_manager_can_lookup_by_dni(self, pasajes_manager, personal_record):
        client = _client_for(pasajes_manager)
        response = client.get('/api/v1/personal/buscar-dni/', {'dni': personal_record.dni})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['dni'] == personal_record.dni
        assert response.data['apellidos_nombres'] == personal_record.apellidos_nombres
        assert response.data['puesto'] == personal_record.puesto
        assert response.data['sede'] == personal_record.sede

    def test_admin_manager_can_lookup_by_dni(self, admin_manager, personal_record):
        client = _client_for(admin_manager)
        response = client.get('/api/v1/personal/buscar-dni/', {'dni': personal_record.dni})
        assert response.status_code == status.HTTP_200_OK

    def test_buscar_dni_response_excludes_sensitive_fields(self, pasajes_manager, personal_record):
        client = _client_for(pasajes_manager)
        response = client.get('/api/v1/personal/buscar-dni/', {'dni': personal_record.dni})
        assert response.status_code == status.HTTP_200_OK
        for field_name in SENSITIVE_FIELDS:
            assert field_name not in response.data, (
                f'"{field_name}" must not be present in buscar_dni response'
            )
