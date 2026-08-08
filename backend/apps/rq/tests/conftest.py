"""
Shared fixtures for apps/rq access-control tests (SYSPCC-006).
"""
import datetime

import pytest

from apps.core.enums import AcquisitionTypeChoices, RQFlowChoices
from apps.rq.models import Request


@pytest.fixture
def ops_request(db, project, requester):
    """An OPERATIONS request owned by `requester`."""
    return Request.objects.create(
        rq_number='RQ-2026-0001',
        flow=RQFlowChoices.OPERATIONS,
        project=project,
        requested_by=requester,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )


@pytest.fixture
def foreign_request(db, other_project, other_requester):
    """
    An OPERATIONS request in `other_project`, owned by `other_requester` —
    genuinely outside `requester`'s scope (different owner AND different project).
    """
    return Request.objects.create(
        rq_number='RQ-2026-0002',
        flow=RQFlowChoices.OPERATIONS,
        project=other_project,
        requested_by=other_requester,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )


@pytest.fixture
def ops_request_same_project_other_owner(db, project, other_requester_same_project):
    """
    SYSPCC-011 FIX 1: an OPERATIONS request in the SAME `project` as `ops_request`,
    but owned by `other_requester_same_project` (not `requester`). Used to prove a
    plain REQUESTER's project-scoped UserRole does not grant visibility into a
    co-worker's RQ in the same project.
    """
    return Request.objects.create(
        rq_number='RQ-2026-0010',
        flow=RQFlowChoices.OPERATIONS,
        project=project,
        requested_by=other_requester_same_project,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )


@pytest.fixture
def admin_request(db, department, department_requester):
    """An ADMINISTRATIVE request owned by `department_requester`, in `department`."""
    return Request.objects.create(
        rq_number='RQ-2026-0011',
        flow=RQFlowChoices.ADMINISTRATIVE,
        department=department,
        requested_by=department_requester,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )


@pytest.fixture
def admin_request_same_department_other_owner(db, department, other_department_requester):
    """
    SYSPCC-011 FIX 1: an ADMINISTRATIVE request in the SAME `department` as
    `admin_request`, owned by a different REQUESTER. Department-flow counterpart
    of `ops_request_same_project_other_owner`.
    """
    return Request.objects.create(
        rq_number='RQ-2026-0012',
        flow=RQFlowChoices.ADMINISTRATIVE,
        department=department,
        requested_by=other_department_requester,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )


@pytest.fixture
def foreign_admin_request(db, other_department, other_department_requester):
    """
    An ADMINISTRATIVE request in `other_department`, genuinely outside
    `department_requester`'s / `direct_supervisor`'s scope.
    """
    return Request.objects.create(
        rq_number='RQ-2026-0013',
        flow=RQFlowChoices.ADMINISTRATIVE,
        department=other_department,
        requested_by=other_department_requester,
        acquisition_type=AcquisitionTypeChoices.COMPRA_LOCAL,
        fecha_necesidad=datetime.date.today() + datetime.timedelta(days=7),
    )
