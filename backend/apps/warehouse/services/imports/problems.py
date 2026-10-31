"""
Catalog of import problems (SYSPCC-025).

Every problem has a stable ``code`` (UI filters and the CSV/Excel report group by it),
a severity and a Spanish (es-PE) message. Messages are rendered from the structured
arguments only: they NEVER echo free text from the workbook (a cell may hold a
worker's name), just codes of items, numbers and sheet names.

Severities
----------
* ``blocker`` -> ``can_confirm`` is false until the workbook (or the data) is fixed.
* ``error``   -> the row is skipped; confirming requires ``accept_skipped_rows``.
* ``warning`` -> the row is imported; confirming requires ``accept_warnings``.
* ``info``    -> informative only.
"""
from dataclasses import dataclass

BLOCKER = 'blocker'
ERROR = 'error'
WARNING = 'warning'
INFO = 'info'

SEVERITIES = (BLOCKER, ERROR, WARNING, INFO)
SEVERITY_RANK = {name: rank for rank, name in enumerate(SEVERITIES)}
SEVERITY_LABELS = {
    BLOCKER: 'Bloqueante',
    ERROR: 'Error',
    WARNING: 'Advertencia',
    INFO: 'Informativo',
}

# code -> (severity, message template)
CATALOG: dict[str, tuple[str, str]] = {
    # --- blockers ---------------------------------------------------------
    'HOJA_FALTANTE': (BLOCKER, 'Falta la hoja {sheet} en el libro.'),
    'CABECERA_FALTANTE': (BLOCKER, 'En la hoja {sheet} faltan las columnas obligatorias: {columns}.'),
    'ITEM_DESCONOCIDO': (BLOCKER, 'El ítem {code} no figura en la hoja de catálogo ni en el inventario del sistema.'),
    'STOCK_NEGATIVO': (BLOCKER, 'El stock de {code} quedaría negativo ({quantity}) al aplicar los movimientos.'),
    'STOCK_EXCEDIDO': (
        BLOCKER, 'El stock de {code} superaría el máximo permitido ({quantity}) al aplicar los movimientos.',
    ),
    'CODIGO_DUPLICADO_DISTINTO': (BLOCKER, 'El código {code} aparece repetido con descripción o unidad distintas.'),
    # --- errors (row skipped) ---------------------------------------------
    'CANTIDAD_VACIA': (ERROR, 'La cantidad está vacía.'),
    'CANTIDAD_INVALIDA': (
        ERROR,
        'La cantidad no es válida: debe ser un número mayor que cero, con hasta 3 decimales '
        '(entero en unidades como EA, UND, PAR o JGO).',
    ),
    'FECHA_INVALIDA': (ERROR, 'La fecha no es válida.'),
    'FECHA_FUTURA': (ERROR, 'La fecha es posterior a hoy.'),
    'UNIDAD_EN_CONFLICTO': (ERROR, 'La unidad {file_unit} no coincide con la del sistema ({db_unit}) para {code}.'),
    'ITEM_VACIO': (ERROR, 'La fila no tiene código de ítem.'),
    'ITEM_OMITIDO': (ERROR, 'El ítem {code} se omitió por un error en su fila del catálogo.'),
    'FILA_INVALIDA': (ERROR, '{detail}'),
    # --- warnings (row imported) ------------------------------------------
    'FECHA_VACIA': (WARNING, 'La fila no tiene fecha; se importa sin fecha.'),
    'DESTINO_VACIO': (
        WARNING, "El egreso no indica usuario/destino; se cargará como 'Sin destino' para revisar.",
    ),
    'VALE_VACIO': (WARNING, 'El egreso no tiene N° de vale.'),
    'VALE_REUTILIZADO': (WARNING, 'El N° de vale se repite con otra fecha o destino, o ya existe en el sistema.'),
    'UBICACION_PISO_SIN_PABELLON': (
        WARNING, 'El ítem {code} solo indica el piso ({floor}); queda pendiente de ubicar.',
    ),
    'UBICACION_NO_RECONOCIDA': (WARNING, 'La ubicación del ítem {code} no existe en el layout del almacén y se ignoró.'),
    'DESTINO_SIN_PERSONAL': (
        WARNING, 'El destino no coincide con ningún trabajador registrado ({rows} fila(s) con este destino).',
    ),
    'DESTINO_AMBIGUO': (
        WARNING, 'El destino coincide con {candidates} trabajadores; no se vinculó ({rows} fila(s) con este destino).',
    ),
    'STOCK_DISTINTO_AL_LIBRO': (
        WARNING, 'El stock resultante de {code} ({projected}) difiere del stock del libro ({book}).',
    ),
    'LIBRO_SIN_VALORES_CALCULADOS': (
        WARNING,
        'La hoja {sheet} tiene {count} celda(s) con fórmulas sin valor calculado. '
        'Abra el libro en Excel, guárdelo y vuelva a subirlo.',
    ),
    'DESCRIPCION_DISTINTA': (WARNING, 'La descripción de {code} difiere de la del sistema; no se modificó.'),
    'PRODUCTO_SIN_STOCK_CERO': (WARNING, 'El ítem {code} quedará con stock cero (agotado).'),
    'FILAS_IMPORTADAS_AUSENTES': (
        WARNING,
        'Hay {count} movimiento(s) importados antes que ya no figuran en este libro (fila corregida o '
        'eliminada). Las filas ya importadas no se actualizan ni se borran: una fila corregida se '
        'importa como nueva y el stock podría duplicarse. Corrija con un ajuste y revise el stock.',
    ),
    # --- info -------------------------------------------------------------
    'PREFIJO_NO_CLASIFICADO': (INFO, 'El código {code} no tiene un prefijo conocido; se clasificó como "Otros".'),
    'PROYECTO_VACIO': (INFO, 'El ítem {code} no indica proyecto.'),
    'FILA_YA_IMPORTADA': (INFO, 'La fila ya fue importada antes; se omite.'),
    'SHIPMENT_QUANTITY_IGNORADA': (
        INFO, 'La columna Shipment Quantity no se importa (es un dato por embarque, no por ítem).',
    ),
    'CODIGO_DUPLICADO_IDENTICO': (INFO, 'El código {code} está repetido en la hoja; se usó la primera fila.'),
    'CATALOGO_DESDE_RESUMEN': (
        INFO, 'El libro no trae la hoja MATRIZ DE RECURSOS; el catálogo se tomó de RESUMEN DE MOVIMIENTO.',
    ),
}

BLOCKING_CODES = {code for code, (sev, _msg) in CATALOG.items() if sev == BLOCKER}

# code -> short, human "type of problem" (the screen's "Tipo de problema" column and the report).
# Keep in step with ``PROBLEM_CODE_LABELS`` in ``frontend/src/utils/almacenImport.js``.
CODE_LABELS: dict[str, str] = {
    'HOJA_FALTANTE': 'Falta una hoja del libro',
    'CABECERA_FALTANTE': 'Faltan columnas obligatorias',
    'ITEM_DESCONOCIDO': 'Ítem que no existe',
    'STOCK_NEGATIVO': 'El stock quedaría negativo',
    'STOCK_EXCEDIDO': 'El stock superaría el máximo permitido',
    'CODIGO_DUPLICADO_DISTINTO': 'Código repetido con datos distintos',
    'CANTIDAD_VACIA': 'Cantidad vacía',
    'CANTIDAD_INVALIDA': 'Cantidad no válida',
    'FECHA_INVALIDA': 'Fecha no válida',
    'FECHA_FUTURA': 'Fecha posterior a hoy',
    'UNIDAD_EN_CONFLICTO': 'Unidad distinta a la del sistema',
    'DESTINO_VACIO': 'Egreso sin destino (se carga como "Sin destino")',
    'ITEM_VACIO': 'Fila sin código de ítem',
    'ITEM_OMITIDO': 'Ítem omitido por un error previo',
    'FILA_INVALIDA': 'Fila no válida',
    'FECHA_VACIA': 'Fila sin fecha',
    'VALE_VACIO': 'Egreso sin N° de vale',
    'VALE_REUTILIZADO': 'N° de vale repetido',
    'UBICACION_PISO_SIN_PABELLON': 'Ubicación incompleta (solo el piso)',
    'UBICACION_NO_RECONOCIDA': 'Ubicación que no existe en el almacén',
    'DESTINO_SIN_PERSONAL': 'Destino sin trabajador en Personal',
    'DESTINO_AMBIGUO': 'Destino que coincide con varios trabajadores',
    'STOCK_DISTINTO_AL_LIBRO': 'Stock distinto al del libro',
    'LIBRO_SIN_VALORES_CALCULADOS': 'Fórmulas sin valor calculado',
    'DESCRIPCION_DISTINTA': 'Descripción distinta a la del sistema',
    'PRODUCTO_SIN_STOCK_CERO': 'Ítem que queda sin stock',
    'FILAS_IMPORTADAS_AUSENTES': 'Movimientos importados que ya no figuran',
    'PREFIJO_NO_CLASIFICADO': 'Código con prefijo desconocido',
    'PROYECTO_VACIO': 'Ítem sin proyecto',
    'FILA_YA_IMPORTADA': 'Fila ya importada antes',
    'SHIPMENT_QUANTITY_IGNORADA': 'Columna que no se importa',
    'CODIGO_DUPLICADO_IDENTICO': 'Código repetido (idéntico)',
    'CATALOGO_DESDE_RESUMEN': 'Catálogo tomado del resumen',
}


def code_label(problem_code: str) -> str:
    """Readable type of a problem code; an unknown code is returned as it is."""
    return CODE_LABELS.get(problem_code, problem_code)


@dataclass(frozen=True)
class Problem:
    code: str
    severity: str
    sheet: str
    row: int | None
    message: str

    def as_dict(self) -> dict:
        return {
            'code': self.code,
            'severity': self.severity,
            'sheet': self.sheet,
            'row': self.row,
            'message': self.message,
        }


def make_problem(problem_code: str, sheet: str = '', row: int | None = None, **params) -> Problem:
    """Build a ``Problem`` from the catalog; ``params`` fill the message template."""
    severity, template = CATALOG[problem_code]
    return Problem(
        code=problem_code, severity=severity, sheet=sheet, row=row,
        message=template.format(sheet=sheet, **params),
    )
