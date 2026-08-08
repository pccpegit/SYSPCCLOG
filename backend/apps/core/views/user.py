"""
User and UserRole viewsets.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.core.models import User, UserRole
from apps.core.serializers.user import (
    UserSerializer,
    UserListSerializer,
    UserCreateSerializer,
    UserRoleSerializer,
    ChangePasswordSerializer,
)
from apps.core.permissions import IsAdminOrReadOnly


@extend_schema_view(
    list=extend_schema(tags=['users'], summary='List users'),
    retrieve=extend_schema(tags=['users'], summary='Get user detail'),
    create=extend_schema(tags=['users'], summary='Create user'),
    update=extend_schema(tags=['users'], summary='Update user'),
    partial_update=extend_schema(tags=['users'], summary='Partial update user'),
    destroy=extend_schema(tags=['users'], summary='Delete user'),
)
class UserViewSet(viewsets.ModelViewSet):
    """
    CRUD endpoints for User management.
    Admins have full access; regular users can only view.
    """

    queryset = User.objects.prefetch_related('user_roles').all()
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]

    # Actions on own profile only require IsAuthenticated
    SELF_ACTIONS = ('me', 'change_password', 'manage_signature')

    def get_permissions(self):
        if self.action in self.SELF_ACTIONS:
            return [IsAuthenticated()]
        return super().get_permissions()
    filterset_fields = ['is_active', 'is_staff']
    search_fields = ['username', 'email', 'first_name', 'last_name', 'position']
    ordering_fields = ['last_name', 'first_name', 'date_joined']
    ordering = ['last_name', 'first_name']

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        if self.action == 'list':
            return UserListSerializer
        # FIX-13: Only the /me/ endpoint and admin users receive the full UserSerializer
        # (which includes is_staff, date_joined, last_login, and nested roles).
        # Non-admin users performing a retrieve get the compact UserListSerializer instead.
        if self.action == 'retrieve' and not self.request.user.is_staff:
            return UserListSerializer
        return UserSerializer

    @extend_schema(tags=['users'], summary='Get current user profile')
    @action(detail=False, methods=['get'], url_path='me')
    def me(self, request):
        """Return the authenticated user's profile."""
        serializer = UserSerializer(request.user, context={'request': request})
        return Response(serializer.data)

    @extend_schema(tags=['users'], summary='Change password', request=ChangePasswordSerializer)
    @action(detail=False, methods=['post'], url_path='me/change-password')
    def change_password(self, request):
        """Allow user to change their own password."""
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data['old_password']):
            return Response(
                {'old_password': 'Contraseña actual incorrecta.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(serializer.validated_data['new_password'])
        user.save()
        return Response({'detail': 'Contraseña actualizada exitosamente.'})

    @extend_schema(tags=['users'], summary='Manage signature (POST=upload, DELETE=remove)')
    @action(detail=False, methods=['post', 'delete'], url_path='me/signature')
    def manage_signature(self, request):
        """
        POST: Upload a signature image. Accepts:
          - multipart/form-data with 'file' field (photo upload)
          - JSON with 'signature_data' field (base64 from canvas drawing)
        DELETE: Remove the user's signature.
        """
        user = request.user

        # ── DELETE ──
        if request.method == 'DELETE':
            if user.signature:
                user.signature.delete(save=True)
            return Response({'detail': 'Firma eliminada.'})

        # ── POST ──
        from django.core.files.base import ContentFile
        from apps.core.services.signature import process_signature_image, process_base64_signature

        # Option 1: File upload (photo from camera/gallery)
        if 'file' in request.FILES:
            try:
                processed = process_signature_image(request.FILES['file'])
                user.signature.save(
                    f'signature_{user.username}.png',
                    ContentFile(processed.read()),
                    save=True,
                )
                return Response({
                    'detail': 'Firma guardada correctamente.',
                    'signature': user.signature.url,
                })
            except Exception as exc:
                return Response(
                    {'detail': f'Error al procesar la imagen: {str(exc)}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Option 2: Base64 from canvas drawing
        signature_data = request.data.get('signature_data')
        if signature_data:
            try:
                processed = process_base64_signature(signature_data)
                user.signature.save(
                    f'signature_{user.username}.png',
                    ContentFile(processed.read()),
                    save=True,
                )
                return Response({
                    'detail': 'Firma guardada correctamente.',
                    'signature': user.signature.url,
                })
            except Exception as exc:
                return Response(
                    {'detail': f'Error al procesar la firma: {str(exc)}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        return Response(
            {'detail': 'Envie un archivo (file) o datos base64 (signature_data).'},
            status=status.HTTP_400_BAD_REQUEST,
        )


@extend_schema_view(
    list=extend_schema(tags=['users'], summary='List user roles'),
    retrieve=extend_schema(tags=['users'], summary='Get user role'),
    create=extend_schema(tags=['users'], summary='Assign role to user'),
    destroy=extend_schema(tags=['users'], summary='Remove role from user'),
)
class UserRoleViewSet(viewsets.ModelViewSet):
    """
    Manage role assignments for users.
    Only admins can create/delete.
    """

    queryset = UserRole.objects.select_related('user', 'project', 'department_obj').all()
    serializer_class = UserRoleSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['user', 'role', 'flow', 'project', 'department_obj', 'is_primary']
    http_method_names = ['get', 'post', 'delete', 'head', 'options']
