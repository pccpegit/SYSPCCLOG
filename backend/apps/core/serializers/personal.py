"""
Serializers for the Personal (RRHH) model.
"""
from rest_framework import serializers
from apps.core.models import Personal


class PersonalListSerializer(serializers.ModelSerializer):
    """Compact serializer for list views — omits sensitive compensation/banking fields."""

    edad = serializers.IntegerField(read_only=True)
    proyecto_nombre = serializers.CharField(
        source='proyecto.name', read_only=True, default=''
    )

    class Meta:
        model = Personal
        fields = [
            'id',
            'dni',
            'apellidos_nombres',
            'fecha_nacimiento',
            'edad',
            'sexo',
            'estado_civil',
            'celular',
            'email_personal',
            'estado',
            'fecha_ingreso',
            'proyecto',
            'proyecto_nombre',
            'sede',
            'puesto',
            'guardia',
            'condicion_trabajo',
            'numero_fotocheck',
        ]


class PersonalDetailSerializer(serializers.ModelSerializer):
    """
    Full serializer for create/retrieve/update — includes sensitive RRHH data
    (compensation, banking, address, emergency contact, family).

    SYSPCC-006 FIX 1: field list is explicit (no `fields = '__all__'`) so new
    model fields never leak by default, and access to this serializer is
    restricted to RRHH-privileged roles at the view layer
    (see PersonalViewSet.get_permissions / IsHRManager).
    """

    edad = serializers.IntegerField(read_only=True)
    proyecto_nombre = serializers.CharField(
        source='proyecto.name', read_only=True, default=''
    )
    user_username = serializers.CharField(
        source='user.username', read_only=True, default=None
    )

    class Meta:
        model = Personal
        fields = [
            'id',
            'user',
            'user_username',
            # Identity
            'dni',
            'apellidos_nombres',
            'fecha_nacimiento',
            'edad',
            'sexo',
            'estado_civil',
            # Contact
            'celular',
            'email_personal',
            # Emergency contact (sensitive)
            'contacto_emergencia_nombre',
            'contacto_emergencia_telefono',
            'contacto_emergencia_vinculo',
            # Address (sensitive)
            'departamento_residencia',
            'provincia_residencia',
            'distrito_residencia',
            'direccion_residencia',
            # Education
            'nivel_educativo',
            'grado_academico',
            'especialidad_carrera',
            # Employment
            'estado',
            'fecha_ingreso',
            'fecha_cese',
            'motivo_cese',
            'proyecto',
            'proyecto_nombre',
            'sede',
            'puesto',
            'guardia',
            'condicion_trabajo',
            # Compensation (sensitive)
            'salario',
            'sistema_pensiones',
            'entidad_bancaria',
            'numero_cuenta',
            'cci',
            # Family (sensitive)
            'tiene_hijos',
            'hijos_menores_18',
            'cantidad_hijos_menores',
            'nombres_hijos_menores',
            'asignacion_familiar',
            # Work gear
            'numero_fotocheck',
            'talla_zapato',
            'talla_pantalon',
            'talla_camisa',
            # Audit
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class PersonalDNILookupSerializer(serializers.ModelSerializer):
    """
    SYSPCC-006 FIX 1: minimal serializer used by `buscar_dni` (pasajes autofill).

    Exposes only what the pasajes module needs to pre-fill a form — nothing
    from compensation, banking, address, emergency contact, or family data.
    """

    proyecto_nombre = serializers.CharField(
        source='proyecto.name', read_only=True, default=''
    )

    class Meta:
        model = Personal
        fields = [
            'id',
            'dni',
            'apellidos_nombres',
            'proyecto',
            'proyecto_nombre',
            'puesto',
            'sede',
        ]
        read_only_fields = fields
