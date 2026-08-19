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
def superuser(db):
    """
    SYSPCC-018: Django superuser — the sole gate for the admin module
    (users/projects management). No business-level SUPERADMIN role exists
    in `RoleChoices`; `is_superuser` is what `IsSuperUser` checks.
    """
    return User.objects.create_superuser(
        username='superadmin',
        email='superadmin@test.com',
        password='TestPass2026!',
        first_name='Super',
        last_name='Admin',
    )


@pytest.fixture
def other_superuser(db):
    """A second superuser, distinct from `superuser` — used for self-action
    guards (e.g. auto-deactivation) where the actor must differ from the
    target."""
    return User.objects.create_superuser(
        username='superadmin2',
        email='superadmin2@test.com',
        password='TestPass2026!',
        first_name='Super',
        last_name='Admin2',
    )


@pytest.fixture
def staff_user(db):
    """
    `is_staff=True` but NOT a superuser — pre-SYSPCC-018 this role could
    write to `UserViewSet`/`ProjectViewSet` via `IsAdminOrReadOnly`; the
    admin module now requires `IsSuperUser` instead, so this fixture models
    the "used to have access, must not anymore" actor for permission tests.
    """
    u = User.objects.create_user(
        username='staffuser',
        email='staffuser@test.com',
        password='TestPass2026!',
        first_name='Staff',
        last_name='User',
        is_staff=True,
    )
    return u


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


@pytest.fixture
def other_requester_same_project(db, project):
    """
    SYSPCC-011 FIX 1: a second REQUESTER assigned to the SAME `project` as
    `requester` (unlike `other_requester`, which is on `other_project`).
    Before the fix, a REQUESTER's UserRole.project alone granted visibility
    into every RQ in that project — this fixture proves that no longer holds:
    two REQUESTERs sharing a project must still only see their own RQs.
    """
    u = User.objects.create_user(
        username='other_requester_same_project',
        email='other_requester_same_project@test.com',
        password='TestPass2026!',
        first_name='Other',
        last_name='SameProject',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.REQUESTER,
        project=project,
        is_primary=True,
    )
    return u


@pytest.fixture
def project_control(db, project):
    """User with PROJECT_CONTROL role scoped to `project` (project-wide visibility)."""
    u = User.objects.create_user(
        username='project_control',
        email='project_control@test.com',
        password='TestPass2026!',
        first_name='Control',
        last_name='User',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.PROJECT_CONTROL,
        project=project,
        is_primary=True,
    )
    return u


@pytest.fixture
def site_warehouse(db, project):
    """User with SITE_WAREHOUSE role scoped to `project` (project-wide visibility,
    needed to act on DISPATCHED_TO_SITE -> DELIVERED for that project's RQs)."""
    u = User.objects.create_user(
        username='site_warehouse',
        email='site_warehouse@test.com',
        password='TestPass2026!',
        first_name='Site',
        last_name='Warehouse',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.SITE_WAREHOUSE,
        project=project,
        is_primary=True,
    )
    return u


@pytest.fixture
def other_department(db):
    """A second department, distinct from `department`."""
    return Department.objects.create(code='DEPT-OTHER', name='Otro Departamento')


@pytest.fixture
def direct_supervisor(db, department):
    """User with DIRECT_SUPERVISOR role scoped to `department` (department-wide visibility)."""
    u = User.objects.create_user(
        username='direct_supervisor',
        email='direct_supervisor@test.com',
        password='TestPass2026!',
        first_name='Supervisor',
        last_name='Directo',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.DIRECT_SUPERVISOR,
        department_obj=department,
        is_primary=True,
    )
    return u


@pytest.fixture
def department_requester(db, department):
    """
    A REQUESTER assigned to `department` (ADMINISTRATIVE flow) — the
    department-scope counterpart of `requester`, for SYSPCC-011 FIX 1
    department-visibility tests.
    """
    u = User.objects.create_user(
        username='department_requester',
        email='department_requester@test.com',
        password='TestPass2026!',
        first_name='Dept',
        last_name='Requester',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.REQUESTER,
        department_obj=department,
        is_primary=True,
    )
    return u


@pytest.fixture
def other_department_requester(db, other_department):
    """A second REQUESTER, assigned to `other_department` — outside `department_requester`'s scope."""
    u = User.objects.create_user(
        username='other_department_requester',
        email='other_department_requester@test.com',
        password='TestPass2026!',
        first_name='Other',
        last_name='DeptRequester',
    )
    UserRole.objects.create(
        user=u,
        role=RoleChoices.REQUESTER,
        department_obj=other_department,
        is_primary=True,
    )
    return u
