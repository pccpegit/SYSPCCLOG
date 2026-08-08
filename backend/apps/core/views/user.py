"""
User and UserRole viewsets.
"""

import logging

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

logger = logging.getLogger(__name__)

# Signature photos are small handwritten images — 5 MB is generous headroom
# over any real camera/phone capture and keeps us from decoding an enormous
# file into memory via Pillow before we've even validated it's an image.
MAX_SIGNATURE_FILE_SIZE_BYTES = 5 * 1024 * 1024


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
        from PIL import UnidentifiedImageError
        from apps.core.services.signature import process_signature_image, process_base64_signature

        # Option 1: File upload (photo from camera/gallery)
        if 'file' in request.FILES:
            uploaded = request.FILES['file']

            # Reject oversized files BEFORE handing them to Pillow — Image.open()
            # + the per-pixel processing in process_signature_image() would
            # otherwise decode the whole file into memory first.
            if uploaded.size > MAX_SIGNATURE_FILE_SIZE_BYTES:
                return Response(
                    {
                        'detail': (
                            'El archivo supera el tamaño máximo permitido de '
                            f'{MAX_SIGNATURE_FILE_SIZE_BYTES // (1024 * 1024)} MB.'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                processed = process_signature_image(uploaded)
                user.signature.save(
                    f'signature_{user.username}.png',
                    ContentFile(processed.read()),
                    save=True,
                )
                return Response({
                    'detail': 'Firma guardada correctamente.',
                    'signature': user.signature.url,
                })
            except (UnidentifiedImageError, ValueError):
                # Expected: not a real/decodable image — user error, not ours.
                logger.warning(
                    'signature.upload.invalid_image',
                    extra={'user_id': user.id},
                )
                return Response(
                    {'detail': 'El archivo enviado no es una imagen válida.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Exception:
                logger.exception(
                    'signature.upload.unexpected',
                    extra={'user_id': user.id},
                )
                return Response(
                    {'detail': 'No se pudo procesar la imagen. Intente nuevamente.'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        # Option 2: Base64 from canvas drawing
        signature_data = request.data.get('signature_data')
        if signature_data:
            # Rough size guard on the base64 payload before decoding — base64
            # inflates size ~33%, so this stays conservative vs. the raw limit.
            if len(signature_data) > MAX_SIGNATURE_FILE_SIZE_BYTES * 2:
                return Response(
                    {
                        'detail': (
                            'Los datos de la firma superan el tamaño máximo permitido de '
                            f'{MAX_SIGNATURE_FILE_SIZE_BYTES // (1024 * 1024)} MB.'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

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
            except (UnidentifiedImageError, ValueError):
                # ValueError also covers base64.b64decode() rejecting malformed
                # input (binascii.Error is a ValueError subclass).
                logger.warning(
                    'signature.upload.invalid_base64',
                    extra={'user_id': user.id},
                )
                return Response(
                    {'detail': 'Los datos de la firma no son válidos.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Exception:
                logger.exception(
                    'signature.upload.unexpected',
                    extra={'user_id': user.id},
                )
                return Response(
                    {'detail': 'No se pudo procesar la firma. Intente nuevamente.'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
