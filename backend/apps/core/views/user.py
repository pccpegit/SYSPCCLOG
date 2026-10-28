"""
User and UserRole viewsets.
"""

import logging

import django_filters
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from django.db.models import Prefetch

from apps.core.models import User, UserRole
from apps.core.serializers.user import (
    UserSerializer,
    UserListSerializer,
    UserAdminCreateSerializer,
    UserAdminUpdateSerializer,
    UserAdminListSerializer,
    UserRoleSerializer,
    ChangePasswordSerializer,
)
from apps.core.permissions import IsSuperUser
from apps.core.services.user_admin import UserAdminService

logger = logging.getLogger(__name__)


class UserFilterSet(django_filters.FilterSet):
    """Filters available to any authenticated caller of `/users/` — unchanged
    from pre-SYSPCC-018 behavior."""

    class Meta:
        model = User
        fields = ['is_active', 'is_staff']


class UserAdminFilterSet(UserFilterSet):
    """
    SYSPCC-018: `role`/`project`/`department` are not direct `User` fields —
    they filter across the `user_roles` reverse relation, so a `User` can
    match through any one of their role assignments.

    Superadmin-only (see `UserViewSet.filterset_class`): these three let a
    caller enumerate colleagues by business role/project/department
    assignment (e.g. "who is GENERAL_MANAGER") — a capability the admin
    module's UsersPage needs, but that a regular authenticated employee has
    no legitimate reason to have against `/api/v1/users/`.
    """

    role = django_filters.CharFilter(field_name='user_roles__role')
    project = django_filters.NumberFilter(field_name='user_roles__project_id')
    department = django_filters.NumberFilter(field_name='user_roles__department_obj_id')

    class Meta(UserFilterSet.Meta):
        fields = UserFilterSet.Meta.fields + ['role', 'project', 'department']


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
    Reads: any authenticated user. Writes (create/update/reset-password/
    activate/deactivate): superadmin only (SYSPCC-018) — there is no
    business-level SUPERADMIN role, `is_superuser` is the gate. Users are
    never hard-deleted (`destroy` -> 405), only deactivated.
    """

    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]

    # Actions on own profile only require IsAuthenticated.
    SELF_ACTIONS = ('me', 'change_password', 'manage_signature')
    # Actions that mutate users/roles — superadmin only.
    SUPERUSER_ACTIONS = ('create', 'update', 'partial_update', 'destroy', 'reset_password', 'activate', 'deactivate')

    def get_permissions(self):
        if self.action in self.SELF_ACTIONS:
            return [IsAuthenticated()]
        if self.action in self.SUPERUSER_ACTIONS:
            return [IsAuthenticated(), IsSuperUser()]
        return [permission() for permission in self.permission_classes]

    search_fields = ['username', 'email', 'first_name', 'last_name', 'position']
    ordering_fields = ['last_name', 'first_name', 'date_joined']
    ordering = ['last_name', 'first_name']

    @property
    def filterset_class(self):
        # SYSPCC-018: role/project/department filtering is only meant for
        # the superadmin UsersPage — a `property` (not a plain class
        # attribute) lets `DjangoFilterBackend.get_filterset_class()`
        # (which does a plain `getattr(view, 'filterset_class', None)` on
        # the view *instance*) pick the right FilterSet per-request instead
        # of exposing the admin filters to every authenticated caller.
        user = getattr(self.request, 'user', None)
        if user is not None and user.is_authenticated and user.is_superuser:
            return UserAdminFilterSet
        return UserFilterSet

    def get_queryset(self):
        qs = User.objects.prefetch_related(
            Prefetch('user_roles', queryset=UserRole.objects.select_related('project', 'department_obj'))
        ).all()
        # UserAdminFilterSet's role/project/department filters join across
        # user_roles — a user with several matching role rows would
        # otherwise come back once per matching row.
        if self.request.query_params.keys() & {'role', 'project', 'department'}:
            qs = qs.distinct()
        return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return UserAdminCreateSerializer
        if self.action in ('update', 'partial_update'):
            return UserAdminUpdateSerializer
        if self.action == 'list':
            # SYSPCC-018: superadmins get the admin list shape (nested
            # roles, is_superuser); everyone else keeps the existing
            # compact list — no behavior change for non-superadmin callers.
            if self.request.user.is_superuser:
                return UserAdminListSerializer
            return UserListSerializer
        # FIX-13: Only the /me/ endpoint and admin users receive the full UserSerializer
        # (which includes is_staff, date_joined, last_login, and nested roles).
        # Non-admin users performing a retrieve get the compact UserListSerializer instead.
        if self.action == 'retrieve' and not self.request.user.is_staff:
            return UserListSerializer
        return UserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        data = UserSerializer(user, context=self.get_serializer_context()).data
        # Set by UserAdminCreateSerializer.create() — shown to the admin
        # exactly once, never persisted, never logged.
        data['temporary_password'] = user.temporary_password
        headers = self.get_success_headers(data)
        return Response(data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(UserSerializer(user, context=self.get_serializer_context()).data)

    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed(request.method, detail='Los usuarios no se eliminan. Use desactivar.')

    @extend_schema(tags=['users'], summary='Reset user password (admin-forced, one-time temporary password)',
                    request=None)
    @action(detail=True, methods=['post'], url_path='reset-password')
    def reset_password(self, request, pk=None):
        """SYSPCC-018: superadmin forces a password reset on another user."""
        user = self.get_object()
        temporary_password = UserAdminService.reset_password(actor=request.user, user=user)
        return Response({
            'detail': 'Contraseña restablecida correctamente.',
            'temporary_password': temporary_password,
        })

    @extend_schema(tags=['users'], summary='Activate user', request=None)
    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        user = self.get_object()
        user = UserAdminService.set_active(actor=request.user, user=user, is_active=True)
        return Response(UserSerializer(user, context=self.get_serializer_context()).data)

    @extend_schema(tags=['users'], summary='Deactivate user', request=None)
    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        user = UserAdminService.set_active(actor=request.user, user=user, is_active=False)
        return Response(UserSerializer(user, context=self.get_serializer_context()).data)

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
        # SYSPCC-018: this is the normal exit from the forced-password-change
        # flow — clearing the flag here (not just on admin reset) lets the
        # user back into the rest of the app once they've set a real password.
        user.must_change_password = False
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

    SYSPCC-018: create/delete require superadmin (`IsSuperUser`), same bar
    as every other write path in the admin module. Role assignment is a
    privilege-escalation-sensitive operation (a role like GENERAL_MANAGER or
    ADMIN_MANAGER unlocks real workflow approval power) — gating the rest of
    the module behind `is_superuser` while leaving this endpoint at
    `is_staff` would let any staff (non-superuser) account grant itself or
    anyone else an arbitrary business role through this back door. Reads
    stay `IsAuthenticated`, unchanged.
    """

    queryset = UserRole.objects.select_related('user', 'project', 'department_obj').all()
    serializer_class = UserRoleSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['user', 'role', 'project', 'department_obj', 'is_primary']
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_permissions(self):
        if self.action in ('create', 'destroy'):
            return [IsAuthenticated(), IsSuperUser()]
        return [IsAuthenticated()]
