"""
Django admin registration for core app models.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.translation import gettext_lazy as _

from apps.core.models import User, UserRole, Project, ProjectBudgetLine, Department, AnnualPlan, AnnualPlanLine, Personal


class UserRoleInline(admin.TabularInline):
    model = UserRole
    extra = 0
    fields = ['role', 'project', 'department_obj', 'is_primary']
    autocomplete_fields = ['project', 'department_obj']


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    inlines = [UserRoleInline]
    list_display = ['username', 'email', 'get_full_name', 'position', 'department', 'is_active', 'is_staff']
    list_filter = ['is_active', 'is_staff', 'is_superuser']
    search_fields = ['username', 'email', 'first_name', 'last_name', 'position']
    ordering = ['last_name', 'first_name']

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        (_('Información personal'), {'fields': ('first_name', 'last_name', 'email', 'position', 'department', 'phone', 'avatar_url')}),
        (_('Permisos'), {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        (_('Fechas'), {'fields': ('last_login', 'date_joined')}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'email', 'first_name', 'last_name', 'password1', 'password2'),
        }),
    )


@admin.register(UserRole)
class UserRoleAdmin(admin.ModelAdmin):
    list_display = ['user', 'role', 'project', 'department_obj', 'is_primary', 'assigned_at']
    list_filter = ['role', 'is_primary']
    search_fields = ['user__username', 'user__email']
    autocomplete_fields = ['user', 'project', 'department_obj']


class ProjectBudgetLineInline(admin.TabularInline):
    model = ProjectBudgetLine
    extra = 0
    fields = ['code', 'description', 'budgeted_amount', 'committed_amount', 'spent_amount']
    readonly_fields = ['committed_amount', 'spent_amount']


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    inlines = [ProjectBudgetLineInline]
    list_display = ['code', 'name', 'client', 'location', 'is_active', 'start_date', 'end_date']
    list_filter = ['is_active']
    search_fields = ['code', 'name', 'client']
    ordering = ['-created_at']


@admin.register(ProjectBudgetLine)
class ProjectBudgetLineAdmin(admin.ModelAdmin):
    list_display = ['project', 'code', 'description', 'budgeted_amount', 'committed_amount', 'spent_amount']
    list_filter = ['project']
    search_fields = ['code', 'description', 'project__code']
    readonly_fields = ['committed_amount', 'spent_amount']


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'manager', 'is_active']
    list_filter = ['is_active']
    search_fields = ['code', 'name']
    autocomplete_fields = ['manager']


class AnnualPlanLineInline(admin.TabularInline):
    model = AnnualPlanLine
    extra = 0
    fields = ['code', 'description', 'category', 'budgeted_amount', 'committed_amount', 'spent_amount']
    readonly_fields = ['committed_amount', 'spent_amount']


@admin.register(AnnualPlan)
class AnnualPlanAdmin(admin.ModelAdmin):
    inlines = [AnnualPlanLineInline]
    list_display = ['year', 'department', 'total_budget', 'is_active', 'approved_by', 'approved_at']
    list_filter = ['year', 'is_active', 'department']
    search_fields = ['department__name', 'department__code']
    autocomplete_fields = ['department', 'approved_by']


@admin.register(AnnualPlanLine)
class AnnualPlanLineAdmin(admin.ModelAdmin):
    list_display = ['annual_plan', 'code', 'description', 'category', 'budgeted_amount']
    list_filter = ['annual_plan__year', 'category']
    search_fields = ['code', 'description']


@admin.register(Personal)
class PersonalAdmin(admin.ModelAdmin):
    list_display = [
        'dni', 'apellidos_nombres', 'puesto', 'sede', 'proyecto',
        'estado', 'guardia', 'condicion_trabajo', 'fecha_ingreso',
    ]
    list_filter = ['estado', 'sexo', 'guardia', 'condicion_trabajo', 'proyecto', 'sede']
    search_fields = ['dni', 'apellidos_nombres', 'puesto', 'celular', 'email_personal']
    ordering = ['apellidos_nombres']
    autocomplete_fields = ['proyecto', 'user']
    readonly_fields = ['created_at', 'updated_at']

    fieldsets = (
        (_('Identidad'), {
            'fields': ('user', 'dni', 'apellidos_nombres', 'fecha_nacimiento', 'sexo', 'estado_civil'),
        }),
        (_('Contacto'), {
            'fields': ('celular', 'email_personal'),
        }),
        (_('Contacto de Emergencia'), {
            'classes': ('collapse',),
            'fields': (
                'contacto_emergencia_nombre',
                'contacto_emergencia_telefono',
                'contacto_emergencia_vinculo',
            ),
        }),
        (_('Domicilio'), {
            'classes': ('collapse',),
            'fields': (
                'departamento_residencia',
                'provincia_residencia',
                'distrito_residencia',
                'direccion_residencia',
            ),
        }),
        (_('Educacion'), {
            'classes': ('collapse',),
            'fields': ('nivel_educativo', 'grado_academico', 'especialidad_carrera'),
        }),
        (_('Empleo'), {
            'fields': (
                'estado', 'fecha_ingreso', 'fecha_cese', 'motivo_cese',
                'proyecto', 'sede', 'puesto', 'guardia', 'condicion_trabajo',
            ),
        }),
        (_('Remuneracion'), {
            'classes': ('collapse',),
            'fields': (
                'salario', 'sistema_pensiones',
                'entidad_bancaria', 'numero_cuenta', 'cci',
            ),
        }),
        (_('Familia'), {
            'classes': ('collapse',),
            'fields': (
                'tiene_hijos', 'hijos_menores_18',
                'cantidad_hijos_menores', 'nombres_hijos_menores',
                'asignacion_familiar',
            ),
        }),
        (_('Equipamiento'), {
            'classes': ('collapse',),
            'fields': (
                'numero_fotocheck',
                'talla_zapato', 'talla_pantalon', 'talla_camisa',
            ),
        }),
        (_('Auditoria'), {
            'classes': ('collapse',),
            'fields': ('created_at', 'updated_at'),
        }),
    )
