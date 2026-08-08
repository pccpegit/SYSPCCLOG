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
    """Full serializer for create/retrieve/update — includes all fields."""

    edad = serializers.IntegerField(read_only=True)
    proyecto_nombre = serializers.CharField(
        source='proyecto.name', read_only=True, default=''
    )
    user_username = serializers.CharField(
        source='user.username', read_only=True, default=None
    )

    class Meta:
        model = Personal
        fields = '__all__'
        read_only_fields = ['created_at', 'updated_at']
