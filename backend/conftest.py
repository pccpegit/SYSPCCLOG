"""
Global pytest fixtures for SYSPCCLOG backend tests.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.core.enums import RoleChoices
from apps.core.models import Department, Project, UserRole

User = get_user_model()


@pytest.fixture
def api_client():
    """Unauthenticated API client."""
    return APIClient()


@pytest.fixture
def user(db):
    """Regular user without roles."""
    return User.objects.create_user(
        username='testuser',
        email='testuser@test.com',
        password='TestPass2026!',
        first_name='Test',
        last_name='User',
    )


@pytest.fixture
def auth_client(user):
    """Authenticated API client."""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(db):
    """Demo project."""
    return Project.objects.create(
        code='PRY-TEST',
        name='Proyecto de Prueba',
        client='Cliente Test',
        location='Lima',
    )


@pytest.fixture
def department(db):
    """Demo department."""
    return Department.objects.create(
        code='DEPT-TEST',
        name='Departamento de Prueba',
    )


@pytest.fixture
def other_project(db):
    """A second project, distinct from `project` — used to model access outside a user's scope."""
    return Project.objects.create(
        code='PRY-OTHER',
        name='Otro Proyecto',
        client='Otro Cliente',
        location='Arequipa',
    )


@pytest.fixture
def requester(db, project):
    """User with REQUESTER role."""
    u = User.objects.create_user(
        username='requester',
        email='requester@test.com',
        password='TestPass2026!',
        first_name='Req',
        last_name='User',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.REQUESTER,

        project=project,
        is_primary=True,
    )
    return u


@pytest.fixture
def project_resident(db, project):
    """User with PROJECT_RESIDENT role."""
    u = User.objects.create_user(
        username='resident',
        email='resident@test.com',
        password='TestPass2026!',
        first_name='Res',
        last_name='User',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.PROJECT_RESIDENT,

        project=project,
        is_primary=True,
    )
    return u


@pytest.fixture
def general_manager(db):
    """User with GENERAL_MANAGER role."""
    u = User.objects.create_user(
        username='gm',
        email='gm@test.com',
        password='TestPass2026!',
        first_name='GM',
        last_name='User',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.GENERAL_MANAGER,
        is_primary=True,
    )
    return u


@pytest.fixture
def admin_manager(db):
    """User with ADMIN_MANAGER role (RRHH-privileged for personnel data)."""
    u = User.objects.create_user(
        username='admin_manager',
        email='admin_manager@test.com',
        password='TestPass2026!',
        first_name='Admin',
        last_name='Manager',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.ADMIN_MANAGER,
        is_primary=True,
    )
    return u


@pytest.fixture
def pasajes_manager(db):
    """User with PASAJES_MANAGER role (dedicated pasajes module access)."""
    u = User.objects.create_user(
        username='pasajes_manager',
        email='pasajes_manager@test.com',
        password='TestPass2026!',
        first_name='Pasajes',
        last_name='Manager',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.PASAJES_MANAGER,
        is_primary=True,
    )
    return u


@pytest.fixture
def logistics_coordinator(db, project):
    """User with LOGISTICS_COORDINATOR role (wide visibility over OPS requests)."""
    u = User.objects.create_user(
        username='logistics_coordinator',
        email='logistics_coordinator@test.com',
        password='TestPass2026!',
        first_name='Logistics',
        last_name='Coordinator',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.LOGISTICS_COORDINATOR,
        project=project,
        is_primary=True,
    )
    return u


@pytest.fixture
def other_requester(db, other_project):
    """
    A second REQUESTER, assigned to `other_project` (not `project`) — used to model
    requests/attachments/claims that are genuinely outside `requester`'s scope
    (own requests nor same-project visibility).
    """
    u = User.objects.create_user(
        username='other_requester',
        email='other_requester@test.com',
        password='TestPass2026!',
        first_name='Other',
        last_name='Requester',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.REQUESTER,
        project=other_project,
        is_primary=True,
    )
    return u
