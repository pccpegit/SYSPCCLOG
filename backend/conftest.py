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
