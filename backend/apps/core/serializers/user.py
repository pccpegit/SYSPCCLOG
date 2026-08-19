"""
User and UserRole serializers.
"""

from rest_framework import serializers
from apps.core.models import User, UserRole, Project, Department
from apps.core.enums import RoleChoices
from apps.core.services.user_admin import UserAdminService


class UserRoleSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    project_code = serializers.CharField(source='project.code', read_only=True, allow_null=True)
    project_name = serializers.CharField(source='project.name', read_only=True, allow_null=True)
    project_frente = serializers.CharField(source='project.frente', read_only=True, allow_null=True)
    department_code = serializers.CharField(source='department_obj.code', read_only=True, allow_null=True)
    department_name = serializers.CharField(source='department_obj.name', read_only=True, allow_null=True)
    department_frente = serializers.CharField(source='department_obj.frente', read_only=True, allow_null=True)

    class Meta:
        model = UserRole
        fields = [
            'id',
            'role',
            'role_display',
            'project',
            'project_code',
            'project_name',
            'project_frente',
            'department_obj',
            'department_code',
            'department_name',
            'department_frente',
            'is_primary',
            'assigned_at',
        ]
        read_only_fields = ['assigned_at']


class RelativeImageField(serializers.ImageField):
    """Always return relative URL (no host prefix) for image fields."""
    def to_representation(self, value):
        if not value:
            return None
        return value.url


class UserSerializer(serializers.ModelSerializer):
    """Full user serializer with nested roles."""

    user_roles = UserRoleSerializer(many=True, read_only=True)
    full_name = serializers.CharField(read_only=True)
    signature = RelativeImageField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'full_name',
            'position',
            'department',
            'phone',
            'avatar_url',
            'signature',
            'is_active',
            'is_staff',
            'is_superuser',
            'must_change_password',
            'user_roles',
            'date_joined',
            'last_login',
        ]
        read_only_fields = [
            'date_joined',
            'last_login',
            'is_superuser',
            'must_change_password',
        ]


class UserListSerializer(serializers.ModelSerializer):
    """Compact user serializer for list views and FK fields."""

    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'full_name', 'position', 'is_active']


class UserRoleAssignmentSerializer(serializers.Serializer):
    """
    SYSPCC-018: input-only shape for one entry of the nested `roles` array
    accepted by `UserAdminCreateSerializer`/`UserAdminUpdateSerializer`.
    Not a ModelSerializer — it never saves itself, the parent serializer's
    `create()`/`update()` hands the validated list to
    `UserAdminService.sync_roles()`.

    Deliberately does not validate role/project/department_obj coherence
    (e.g. that PROJECT_RESIDENT shouldn't carry a `department_obj`) — that
    is a business rule gerencia hasn't specified; only the `unique_together`
    on `UserRole` is enforced, by the service.
    """

    role = serializers.ChoiceField(choices=RoleChoices.choices)
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all(), required=False, allow_null=True)
    department_obj = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(), required=False, allow_null=True
    )
    is_primary = serializers.BooleanField(required=False, default=False)


class UserAdminCreateSerializer(serializers.ModelSerializer):
    """
    SYSPCC-018: creates a user for the superadmin-only admin module. No
    `password` field — the system always generates a temporary one
    (`UserAdminService.create_user`) and returns it once in the response;
    the admin never chooses it.
    """

    roles = UserRoleAssignmentSerializer(many=True, required=False)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'position',
            'department',
            'phone',
            'roles',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        roles_data = validated_data.pop('roles', [])
        request = self.context['request']
        user, temporary_password = UserAdminService.create_user(
            actor=request.user,
            roles_data=roles_data,
            **validated_data,
        )
        # Transient, never persisted — the view reads this once off
        # `serializer.instance` to build the 201 response, then it's gone.
        user.temporary_password = temporary_password
        return user


class UserAdminUpdateSerializer(serializers.ModelSerializer):
    """
    SYSPCC-018: edits a user's profile/role assignments. No `password`
    field — password changes only happen via `reset-password` (admin) or
    `me/change-password` (self).
    """

    roles = UserRoleAssignmentSerializer(many=True, required=False)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'position',
            'department',
            'phone',
            'is_active',
            'roles',
        ]
        read_only_fields = ['id']

    def update(self, instance, validated_data):
        # `roles` absent from the payload => `None` => leave role
        # assignments untouched. `roles: []` => validated_data holds `[]`
        # => clear every assignment. See UserAdminService.update_user.
        roles_data = validated_data.pop('roles', None)
        request = self.context['request']
        return UserAdminService.update_user(
            actor=request.user,
            user=instance,
            roles_data=roles_data,
            **validated_data,
        )


class UserAdminListSerializer(serializers.ModelSerializer):
    """
    SYSPCC-018: list serializer used only when the requester is a
    superuser (see `UserViewSet.get_serializer_class`) — includes nested
    role assignments and superuser/staff flags, not shown to regular users.
    """

    full_name = serializers.CharField(read_only=True)
    roles = UserRoleSerializer(source='user_roles', many=True, read_only=True)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'full_name',
            'position',
            'department',
            'is_active',
            'is_staff',
            'is_superuser',
            'date_joined',
            'roles',
        ]


class ChangePasswordSerializer(serializers.Serializer):
    """Serializer for changing own password."""

    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, min_length=8)
    new_password_confirm = serializers.CharField(required=True)

    def validate(self, attrs):
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({'new_password_confirm': 'Las contraseñas no coinciden.'})
        return attrs
