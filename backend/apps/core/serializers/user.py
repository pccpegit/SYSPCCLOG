"""
User and UserRole serializers.
"""

from rest_framework import serializers
from apps.core.models import User, UserRole


class UserRoleSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    flow_display = serializers.CharField(source='get_flow_display', read_only=True)
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
            'flow',
            'flow_display',
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


class UserSerializer(serializers.ModelSerializer):
    """Full user serializer with nested roles."""

    user_roles = UserRoleSerializer(many=True, read_only=True)
    full_name = serializers.CharField(read_only=True)

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
            'is_active',
            'is_staff',
            'user_roles',
            'date_joined',
            'last_login',
        ]
        read_only_fields = ['date_joined', 'last_login']


class UserCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating users (includes password)."""

    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            'username',
            'email',
            'password',
            'password_confirm',
            'first_name',
            'last_name',
            'position',
            'department',
            'phone',
        ]

    def validate(self, attrs):
        if attrs['password'] != attrs.pop('password_confirm'):
            raise serializers.ValidationError({'password_confirm': 'Las contraseñas no coinciden.'})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class UserListSerializer(serializers.ModelSerializer):
    """Compact user serializer for list views and FK fields."""

    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'full_name', 'position', 'is_active']


class ChangePasswordSerializer(serializers.Serializer):
    """Serializer for changing own password."""

    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, min_length=8)
    new_password_confirm = serializers.CharField(required=True)

    def validate(self, attrs):
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({'new_password_confirm': 'Las contraseñas no coinciden.'})
        return attrs
