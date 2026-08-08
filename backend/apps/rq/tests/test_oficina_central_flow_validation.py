"""
SYSPCC-019: front_area 'OFICINA CENTRAL' must always route through the
ADMINISTRATIVE flow — regression/contract tests for the check added in
RequestCreateSerializer.validate() (apps/rq/serializers/request.py).

Rule is unidirectional (see handoff FASE 0, decision #3): front_area ==
'OFICINA CENTRAL' forces flow == 'ADMINISTRATIVE'. The inverse is NOT
enforced — an ADMINISTRATIVE request may have any/no front_area.
"""
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import Department
from apps.rq.models import Request


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _payload(**overrides):
    """Mirrors the payload helper in test_request_creation_atomicity.py."""
    payload = {
        'flow': 'OPERATIONS',
        'acquisition_type': 'COMPRA_LOCAL',
        'fecha_necesidad': '2026-12-31',
        'description': 'Materiales de prueba',
        'items': [
            {'line_number': 1, 'description': 'Cemento', 'quantity': '10.000', 'unit': 'bls'},
        ],
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def adm_department(db):
    """
    Department with code='ADM' — mirrors the real seed_demo department used
    for the legacy 'dept-oficina' fallback (frontend FASE 2, submit payload).
    Distinct from conftest's generic `department` fixture (code='DEPT-TEST')
    so the ADMINISTRATIVE happy-path test uses a realistic Oficina Central
    department, per the FASE 1 handoff suggestion.
    """
    return Department.objects.create(code='ADM', name='Administración', frente='OFICINA CENTRAL')


@pytest.mark.django_db
class TestOficinaCentralRequiresAdministrativeFlow:
    def test_oficina_central_with_operations_flow_is_rejected(self, requester, project):
        """
        Case 1: front_area='OFICINA CENTRAL' + flow='OPERATIONS' + project=<id>
        must 400 on the 'flow' key with the exact es-PE contract message
        (backend FASE 1 handoff, consumed verbatim by extractErrorMessage on
        the frontend).
        """
        client = _client_for(requester)
        payload = _payload(
            flow='OPERATIONS',
            project=project.pk,
            front_area='OFICINA CENTRAL',
        )

        response = client.post('/api/v1/requests/', payload, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.data
        # custom_exception_handler (apps/core/exceptions.py) wraps DRF's raw
        # {'flow': [...]} body under 'detail' — this is the exact contract
        # documented by django-backend for react-frontend in FASE 1.
        assert response.data['detail']['flow'] == [
            'El frente "Oficina Central" debe registrarse por el flujo de Administración.'
        ]
        assert not Request.objects.exists()

    def test_oficina_central_case_and_whitespace_normalization(self, requester, project):
        """
        Case 2: whitespace + lowercase variant must be normalized via
        .strip().upper() before comparison — confirms the check isn't a
        naive exact-string match.
        """
        client = _client_for(requester)
        payload = _payload(
            flow='OPERATIONS',
            project=project.pk,
            front_area=' oficina central ',
        )

        response = client.post('/api/v1/requests/', payload, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.data
        assert response.data['detail']['flow'] == [
            'El frente "Oficina Central" debe registrarse por el flujo de Administración.'
        ]

    def test_oficina_central_with_administrative_flow_succeeds(self, requester, adm_department):
        """
        Case 3: happy path — front_area='OFICINA CENTRAL' + flow='ADMINISTRATIVE'
        + a valid department must still create the RQ (201). The new check
        must not collide with the coherent case.
        """
        client = _client_for(requester)
        payload = _payload(
            flow='ADMINISTRATIVE',
            department=adm_department.pk,
            front_area='OFICINA CENTRAL',
        )

        response = client.post('/api/v1/requests/', payload, format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        # RequestCreateSerializer doesn't expose 'id' (see Meta.fields in
        # apps/rq/serializers/request.py) — look the row up by rq_number,
        # same pattern as test_request_creation_atomicity.py.
        created = Request.objects.get(rq_number=response.data['rq_number'])
        assert created.flow == 'ADMINISTRATIVE'
        assert created.department_id == adm_department.pk
        assert created.front_area == 'OFICINA CENTRAL'

    def test_other_front_area_with_operations_flow_is_unaffected(self, requester, project):
        """
        Case 4 (regression): the rule is unidirectional — any other
        front_area with OPERATIONS + project must keep working exactly as
        before this ticket. Guards against an overly-broad check.
        """
        client = _client_for(requester)
        payload = _payload(
            flow='OPERATIONS',
            project=project.pk,
            front_area='MINERA YANAOCHA',
        )

        response = client.post('/api/v1/requests/', payload, format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
        created = Request.objects.get(rq_number=response.data['rq_number'])
        assert created.flow == 'OPERATIONS'
        assert created.front_area == 'MINERA YANAOCHA'

    def test_blank_front_area_with_operations_flow_is_unaffected(self, requester, project):
        """
        Extra regression: front_area omitted entirely (the common case for
        every pre-existing OPERATIONS test in this suite) must not trip the
        new check — '' != 'OFICINA CENTRAL' after normalization.
        """
        client = _client_for(requester)
        payload = _payload(flow='OPERATIONS', project=project.pk)

        response = client.post('/api/v1/requests/', payload, format='json')

        assert response.status_code == status.HTTP_201_CREATED, response.data
