"""Pydantic schemas the Claude assistant must fill (structured outputs).

Every field is Optional: absent in the request => null. Money and dates travel
as strings so nothing goes through float; the code parses them into
Decimal/date and validates them with the contract serializer.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ContractExtraction(BaseModel):
    worker_full_name: Optional[str] = Field(None, description='Nombre completo del trabajador, tal como aparece en la descripción.')
    position: Optional[str] = Field(None, description='Cargo o puesto.')
    contract_type: Optional[Literal['INDEFINITE', 'FIXED_TERM']] = Field(
        None, description='INDEFINITE si dice plazo indeterminado; FIXED_TERM si dice plazo fijo o da una duración.'
    )
    fixed_term_modality: Optional[
        Literal[
            'OBRA_SERVICIO', 'NECESIDAD_MERCADO', 'OCASIONAL', 'SUPLENCIA', 'EMERGENCIA',
            'INICIO_ACTIVIDAD', 'RECONVERSION', 'INTERMITENTE', 'TEMPORADA', 'EXPORTACION',
        ]
    ] = Field(None, description='Solo si la descripción nombra la modalidad de plazo fijo.')
    gross_salary: Optional[str] = Field(
        None, description='Sueldo bruto como número decimal con punto, sin símbolo ni separador de miles. Ej: "2000.00".'
    )
    start_date: Optional[str] = Field(None, description='Fecha de inicio en formato ISO AAAA-MM-DD.')
    end_date: Optional[str] = Field(None, description='Fecha de fin ISO AAAA-MM-DD, solo si la descripción da la fecha exacta.')
    term_months: Optional[int] = Field(None, description='Duración en meses, solo si la descripción dice "por N meses".')
    work_location: Optional[str] = Field(None, description='Lugar de trabajo (obra, sede).')
    work_schedule: Optional[str] = Field(None, description='Jornada u horario, tal como se dijo.')
    probation_months: Optional[int] = Field(None, description='Meses de período de prueba, solo si se mencionan.')
    job_description: Optional[str] = Field(None, description='Funciones del cargo, solo si la descripción las dicta.')
    clarifications: list[str] = Field(
        default_factory=list,
        description='Ambigüedades dla descripción, en español (Perú), máximo 3. Vacío si no hay.',
    )
