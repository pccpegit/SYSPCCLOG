from rest_framework import serializers

from apps.core.models import Personal


class HRPersonalSearchSerializer(serializers.ModelSerializer):
    """Minimal worker row for the picker: NO salary, bank or address."""

    class Meta:
        model = Personal
        fields = ['id', 'dni', 'apellidos_nombres', 'puesto', 'estado', 'fecha_ingreso']
        read_only_fields = fields
