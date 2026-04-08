"""
Custom JWT token serializer that includes user info in the token response.
"""

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import Token


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Extends the default JWT serializer to include user data in the response.
    Returns: { access, refresh, user: { id, username, full_name, roles } }
    """

    @classmethod
    def get_token(cls, user) -> Token:
        token = super().get_token(user)
        # Embed non-sensitive claims in the token payload
        token['username'] = user.username
        token['full_name'] = user.get_full_name()
        token['roles'] = list(
            user.user_roles.values_list('role', flat=True).distinct()
        )
        return token

    def validate(self, attrs: dict) -> dict:
        data = super().validate(attrs)

        user = self.user
        raw_roles = user.user_roles.select_related('project', 'department_obj').all()
        roles = []
        for ur in raw_roles:
            roles.append(
                {
                    'role': ur.role,
                    'is_primary': ur.is_primary,
                    'project': ur.project_id,
                    'project_code': ur.project.code if ur.project else None,
                    'project_name': ur.project.name if ur.project else None,
                    'project_frente': ur.project.frente if ur.project else None,
                    'department_obj': ur.department_obj_id,
                    'department_code': ur.department_obj.code if ur.department_obj else None,
                    'department_name': ur.department_obj.name if ur.department_obj else None,
                    'department_frente': ur.department_obj.frente if ur.department_obj else None,
                }
            )

        data['user'] = {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'full_name': user.get_full_name(),
            'first_name': user.first_name,
            'last_name': user.last_name,
            'position': user.position,
            'department': user.department,
            'phone': user.phone,
            'avatar_url': user.avatar_url,
            'is_staff': user.is_staff,
            'roles': roles,
        }

        return data
