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
