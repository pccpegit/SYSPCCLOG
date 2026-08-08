"""
SYSPCC-011 FIX 1: RequestViewSet / QuotationViewSet / PurchaseOrderViewSet read
scoping.

Before the fix, `RequestViewSet.get_queryset()` granted a user with *any* role
tied to a project (including a plain REQUESTER) visibility into every RQ in
that project — the docstring claimed "own requests only" but the query didn't
enforce it. The fix moves scoping into
`apps.rq.permissions.get_accessible_requests_queryset` and restricts the
project/department-wide clause to the roles that actually need it
(PROJECT_RESIDENT/PROJECT_CONTROL/SITE_WAREHOUSE for OPS,
DIRECT_SUPERVISOR/ADMIN_MANAGER for ADMINISTRATIVE). Quotation and
PurchaseOrder now filter through the same helper via their `request` FK.
"""
from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.rq.models import PurchaseOrder, Quotation, Supplier


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _ids(response):
    return {item['id'] for item in response.data['results']}


# ---------------------------------------------------------------------------
# Request visibility — OPERATIONS (project scope)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestRequesterOwnRequestsOnly:
    def test_requester_does_not_see_coworker_request_in_same_project(
        self, requester, ops_request, other_requester_same_project, ops_request_same_project_other_owner,
    ):
        """The core SYSPCC-011 regression: two REQUESTERs sharing a project
        must each see only their own RQ, not each other's."""
        client = _client_for(requester)
        response = client.get('/api/v1/requests/')
        assert response.status_code == status.HTTP_200_OK
        ids = _ids(response)
        assert ops_request.pk in ids
        assert ops_request_same_project_other_owner.pk not in ids

    def test_other_requester_same_project_does_not_see_first_requesters_request(
        self, requester, ops_request, other_requester_same_project, ops_request_same_project_other_owner,
    ):
        client = _client_for(other_requester_same_project)
        response = client.get('/api/v1/requests/')
        ids = _ids(response)
        assert ops_request_same_project_other_owner.pk in ids
        assert ops_request.pk not in ids

    def test_requester_can_still_retrieve_own_request_detail(self, requester, ops_request):
        """Legitimate access must not regress: a REQUESTER must still be able
        to open their own RQ."""
        client = _client_for(requester)
        response = client.get(f'/api/v1/requests/{ops_request.pk}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == ops_request.pk

    def test_requester_cannot_retrieve_coworker_request_by_id(
        self, requester, ops_request_same_project_other_owner,
    ):
        client = _client_for(requester)
        response = client.get(f'/api/v1/requests/{ops_request_same_project_other_owner.pk}/')
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestProjectScopeRolesKeepWideVisibility:
    """PROJECT_RESIDENT / PROJECT_CONTROL / SITE_WAREHOUSE must keep seeing
    every RQ in their assigned project — this is legitimate access the fix
    must NOT take away."""

    def test_project_resident_sees_every_request_in_project(
        self, project_resident, ops_request, ops_request_same_project_other_owner, foreign_request,
    ):
        client = _client_for(project_resident)
        response = client.get('/api/v1/requests/')
        ids = _ids(response)
        assert ops_request.pk in ids
        assert ops_request_same_project_other_owner.pk in ids
        assert foreign_request.pk not in ids  # different project — out of scope

    def test_project_control_sees_every_request_in_project(
        self, project_control, ops_request, ops_request_same_project_other_owner, foreign_request,
    ):
        client = _client_for(project_control)
        response = client.get('/api/v1/requests/')
        ids = _ids(response)
        assert ops_request.pk in ids
        assert ops_request_same_project_other_owner.pk in ids
        assert foreign_request.pk not in ids

    def test_site_warehouse_sees_every_request_in_project(
        self, site_warehouse, ops_request, ops_request_same_project_other_owner, foreign_request,
    ):
        client = _client_for(site_warehouse)
        response = client.get('/api/v1/requests/')
        ids = _ids(response)
        assert ops_request.pk in ids
        assert ops_request_same_project_other_owner.pk in ids
        assert foreign_request.pk not in ids

    def test_logistics_coordinator_keeps_global_visibility(
        self, logistics_coordinator, ops_request, foreign_request,
    ):
        """Wide-access roles (GM/logistics/central warehouse) are unaffected
        by this fix — they must still see everything."""
        client = _client_for(logistics_coordinator)
        response = client.get('/api/v1/requests/')
        ids = _ids(response)
        assert ops_request.pk in ids
        assert foreign_request.pk in ids


# ---------------------------------------------------------------------------
# Request visibility — ADMINISTRATIVE (department scope)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDepartmentRequesterOwnRequestsOnly:
    def test_department_requester_does_not_see_coworker_request(
        self, admin_request, admin_request_same_department_other_owner, department_requester,
    ):
        client = _client_for(department_requester)
        response = client.get('/api/v1/requests/')
        ids = _ids(response)
        assert admin_request.pk in ids
        assert admin_request_same_department_other_owner.pk not in ids


@pytest.mark.django_db
class TestDepartmentScopeRolesKeepWideVisibility:
    def test_direct_supervisor_sees_every_request_in_department(
        self, direct_supervisor, admin_request, admin_request_same_department_other_owner, foreign_admin_request,
    ):
        client = _client_for(direct_supervisor)
        response = client.get('/api/v1/requests/')
        ids = _ids(response)
        assert admin_request.pk in ids
        assert admin_request_same_department_other_owner.pk in ids
        assert foreign_admin_request.pk not in ids  # different department


# ---------------------------------------------------------------------------
# Quotation / PurchaseOrder visibility — scoped by the Request they belong to
# ---------------------------------------------------------------------------


@pytest.fixture
def supplier(db):
    return Supplier.objects.create(ruc='20111111111', business_name='Proveedor Visibilidad')


@pytest.fixture
def own_quotation(db, ops_request, supplier):
    return Quotation.objects.create(request=ops_request, supplier=supplier, total_amount=Decimal('500.00'))


@pytest.fixture
def foreign_quotation(db, foreign_request, supplier):
    return Quotation.objects.create(request=foreign_request, supplier=supplier, total_amount=Decimal('700.00'))


@pytest.fixture
def own_po(db, ops_request, own_quotation, supplier, logistics_coordinator):
    return PurchaseOrder.objects.create(
        po_number='OC-2026-9001',
        request=ops_request,
        quotation=own_quotation,
        supplier=supplier,
        generated_by=logistics_coordinator,
        total_amount=Decimal('500.00'),
    )


@pytest.fixture
def foreign_po(db, foreign_request, foreign_quotation, supplier, logistics_coordinator):
    return PurchaseOrder.objects.create(
        po_number='OC-2026-9002',
        request=foreign_request,
        quotation=foreign_quotation,
        supplier=supplier,
        generated_by=logistics_coordinator,
        total_amount=Decimal('700.00'),
    )


@pytest.mark.django_db
class TestQuotationVisibilityScope:
    def test_requester_sees_only_quotations_for_own_request(
        self, requester, own_quotation, foreign_quotation,
    ):
        client = _client_for(requester)
        response = client.get('/api/v1/quotations/')
        ids = _ids(response)
        assert own_quotation.pk in ids
        assert foreign_quotation.pk not in ids

    def test_requester_cannot_retrieve_foreign_quotation_by_id(self, requester, foreign_quotation):
        client = _client_for(requester)
        response = client.get(f'/api/v1/quotations/{foreign_quotation.pk}/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_logistics_coordinator_sees_all_quotations(
        self, logistics_coordinator, own_quotation, foreign_quotation,
    ):
        client = _client_for(logistics_coordinator)
        response = client.get('/api/v1/quotations/')
        ids = _ids(response)
        assert own_quotation.pk in ids
        assert foreign_quotation.pk in ids


@pytest.mark.django_db
class TestPurchaseOrderVisibilityScope:
    def test_requester_sees_only_pos_for_own_request(self, requester, own_po, foreign_po):
        client = _client_for(requester)
        response = client.get('/api/v1/purchase-orders/')
        ids = _ids(response)
        assert own_po.pk in ids
        assert foreign_po.pk not in ids

    def test_requester_cannot_retrieve_foreign_po_by_id(self, requester, foreign_po):
        client = _client_for(requester)
        response = client.get(f'/api/v1/purchase-orders/{foreign_po.pk}/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_logistics_coordinator_sees_all_pos(self, logistics_coordinator, own_po, foreign_po):
        client = _client_for(logistics_coordinator)
        response = client.get('/api/v1/purchase-orders/')
        ids = _ids(response)
        assert own_po.pk in ids
        assert foreign_po.pk in ids


@pytest.mark.django_db
class TestSupplierRemainsCompanyWideCatalog:
    """SYSPCC-011 FIX 1 (documented decision): Supplier has no per-RQ FK, so it
    intentionally stays unscoped master data — any authenticated user may read
    it. This test pins that decision so a future change doesn't silently break
    supplier lookups for REQUESTERs drafting a new RQ."""

    def test_requester_can_list_suppliers(self, requester, supplier):
        client = _client_for(requester)
        response = client.get('/api/v1/suppliers/')
        assert response.status_code == status.HTTP_200_OK
        ids = _ids(response)
        assert supplier.pk in ids
