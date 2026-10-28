"""
SYSPCC-018 security-auditor hallazgo #2 — `role`/`project`/`department`
filters on `GET /api/v1/users/` must only take effect for a superadmin.

The design (`FASE 0 §4`) only gated the *serializer* shape (`roles` nested
or not) on `is_superuser`; the filters themselves were initially wired up
for any `IsAuthenticated` caller, which would let any employee enumerate
colleagues by business role/project/department (e.g. "who is
GENERAL_MANAGER") — a capability with no legitimate use outside the
superadmin-only UsersPage. `UserViewSet.filterset_class` is now a
`@property` that returns `UserAdminFilterSet` only for superusers and a
plain `UserFilterSet` (is_active/is_staff only, matching pre-SYSPCC-018
behavior) for everyone else — these tests pin that asymmetry.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.enums import RoleChoices
from apps.core.models import UserRole


def _client_for(actor):
    client = APIClient()
    client.force_authenticate(user=actor)
    return client


@pytest.fixture
def gm_and_non_gm_users(general_manager, requester):
    """`general_manager` (has GENERAL_MANAGER) and `requester` (does not) —
    the minimal pair needed to prove a role filter is applied or ignored."""
    return general_manager, requester


@pytest.mark.django_db
class TestRoleFilterScoping:
    def test_non_superadmin_query_with_role_filter_is_ignored(self, requester, gm_and_non_gm_users):
        gm_user, non_gm_user = gm_and_non_gm_users
        client = _client_for(requester)

        response = client.get('/api/v1/users/', {'role': RoleChoices.GENERAL_MANAGER})

        assert response.status_code == status.HTTP_200_OK
        usernames = {u['username'] for u in response.data['results']}
        # The filter must be a no-op for a non-superadmin: a user WITHOUT
        # the queried role still shows up.
        assert non_gm_user.username in usernames

    def test_superadmin_query_with_role_filter_is_applied(self, superuser, gm_and_non_gm_users):
        gm_user, non_gm_user = gm_and_non_gm_users
        client = _client_for(superuser)

        response = client.get('/api/v1/users/', {'role': RoleChoices.GENERAL_MANAGER})

        assert response.status_code == status.HTTP_200_OK
        usernames = {u['username'] for u in response.data['results']}
        assert gm_user.username in usernames
        assert non_gm_user.username not in usernames


@pytest.mark.django_db
class TestProjectFilterScoping:
    def test_non_superadmin_query_with_project_filter_is_ignored(self, requester, other_requester, project):
        client = _client_for(requester)

        response = client.get('/api/v1/users/', {'project': project.id})

        assert response.status_code == status.HTTP_200_OK
        usernames = {u['username'] for u in response.data['results']}
        # other_requester is assigned to a DIFFERENT project — if the filter
        # were applied it would be excluded; for a non-superadmin it must
        # still appear (filter ignored).
        assert other_requester.username in usernames

    def test_superadmin_query_with_project_filter_is_applied(self, superuser, requester, other_requester, project):
        client = _client_for(superuser)

        response = client.get('/api/v1/users/', {'project': project.id})

        assert response.status_code == status.HTTP_200_OK
        usernames = {u['username'] for u in response.data['results']}
        assert requester.username in usernames
        assert other_requester.username not in usernames


@pytest.mark.django_db
class TestDepartmentFilterScoping:
    def test_non_superadmin_query_with_department_filter_is_ignored(
        self, department_requester, other_department_requester, department
    ):
        client = _client_for(department_requester)

        response = client.get('/api/v1/users/', {'department': department.id})

        assert response.status_code == status.HTTP_200_OK
        usernames = {u['username'] for u in response.data['results']}
        assert other_department_requester.username in usernames

    def test_superadmin_query_with_department_filter_is_applied(
        self, superuser, department_requester, other_department_requester, department
    ):
        client = _client_for(superuser)

        response = client.get('/api/v1/users/', {'department': department.id})

        assert response.status_code == status.HTTP_200_OK
        usernames = {u['username'] for u in response.data['results']}
        assert department_requester.username in usernames
        assert other_department_requester.username not in usernames


@pytest.mark.django_db
class TestFilterScopingNoDuplicates:
    """`get_queryset()` adds `.distinct()` only when a role/project/department
    filter is actually present in the query params (they join across the
    `user_roles` reverse relation) — a user with several matching role rows
    should still come back exactly once."""

    def test_user_with_multiple_roles_appears_once_when_filtered_by_superadmin(
        self, superuser, requester, project, other_project
    ):
        # Give `requester` a second role so the `user_roles` join would
        # otherwise fan out into two rows for the same user.
        UserRole.objects.create(user=requester, role=RoleChoices.PROJECT_RESIDENT, project=other_project)

        client = _client_for(superuser)
        response = client.get('/api/v1/users/', {'project': project.id})

        assert response.status_code == status.HTTP_200_OK
        matches = [u for u in response.data['results'] if u['username'] == requester.username]
        assert len(matches) == 1
