---
name: excel-processing
description: Manejo seguro de Excel en SYSPCC — validación de uploads en el backend (p.ej. el libro de inventario del almacén) y generación de reportes con ExcelJS en el frontend u openpyxl en el backend. Úsalo al procesar archivos .xlsx, importar datos masivos, o exportar reportes a Excel. Dispara ante "excel", "xlsx", "importar", "exportar", "carga masiva", "ExcelJS", "reporte".
---

# Procesamiento de Excel — SYSPCC

Qué existe hoy:
- **Export en frontend con ExcelJS** (client-side): el RQ se descarga como Excel (`frontend/src/utils/exportRQ.js`).
- **Export en backend con openpyxl**: exportes de almacén (`apps/warehouse/services/exports.py`, acciones `export`), personal (`apps/core/views/personal.py`), administración (`apps/administracion/views.py`) y el consolidado de CVs de RR. HH. (`apps/hr/services/cv_export.py`). Todos escapan fórmulas: `sanitize_excel_value` + tope `MAX_EXPORT_ROWS` en `apps/core/utils/excel.py`; `safe_cell` en el de CVs.
- **Import (upload) en backend**: el libro de inventario del almacén (SYSPCC-025) en `apps/warehouse/services/imports/` — previsualizar → confirmar, con límites en `parser.py` (`MAX_UPLOAD_BYTES` 10 MB, `MAX_DATA_ROWS` 5000 por hoja, tope de descompresión/ZIP) y throttle `warehouse_import` 10/hour; también por comando: `python manage.py import_warehouse_excel`. No existe import de RQ por Excel: el RQ se captura en el formulario.

## Upload / import (backend)

Un Excel subido por un usuario es **entrada no confiable**. Trátalo como cualquier payload hostil.

1. **Valida el archivo antes de parsear**: extensión `.xlsx`, content-type, y **tamaño máximo** (rechaza archivos enormes → riesgo de memoria/DoS). Limita nº de filas.
2. **Parsea de forma segura**: usa `openpyxl` con `read_only=True` para archivos grandes. No cargues todo en memoria si puedes iterar por filas.
3. **Valida cada fila con un serializer DRF**, no a mano. Acumula errores por fila y devuélvelos con nº de fila.
4. **Todo el import en una transacción** (`transaction.atomic()`): o entra todo válido, o no entra nada. Si prefieres import parcial, sé explícito y reporta qué filas fallaron.
5. **Idempotencia**: si el import se puede reintentar, usa una clave (nº de RQ, hash del archivo) para no duplicar. Ver skill `backend-produccion`.
6. **Errores claros al usuario**: `{ fila: 12, campo: "cantidad", error: "debe ser > 0" }`. No un stacktrace.
7. Imports grandes: en una **task de Celery** con progreso, o en dos pasos acotados como el import del almacén (previsualización guardada + confirmación atómica que re-planifica y compara el digest). No proceses un archivo sin límite dentro del request HTTP (evita timeouts).

```python
import openpyxl
from django.db import transaction
from rest_framework.exceptions import ValidationError

MAX_ROWS = 5000

def import_items(uploaded_file, user):
    wb = openpyxl.load_workbook(uploaded_file, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    if len(rows) > MAX_ROWS:
        raise ValidationError(f"Máximo {MAX_ROWS} filas por archivo.")

    errors, valid = [], []
    for i, row in enumerate(rows, start=2):
        ser = ItemImportSerializer(data=_row_to_dict(row))
        if ser.is_valid():
            valid.append(ser.validated_data)
        else:
            errors.append({"fila": i, "errores": ser.errors})

    if errors:
        raise ValidationError({"filas_invalidas": errors})    # nada se guarda

    with transaction.atomic():
        Item.objects.bulk_create([Item(**d, created_by=user) for d in valid])
    logger.info("excel.import.ok", extra={"rows": len(valid), "user_id": user.id})
    return len(valid)
```

## Export / reporte (frontend, ExcelJS)

- Genera del lado cliente con ExcelJS; no bloquees el hilo con datasets enormes (pagina o pide al backend un export async).
- **Nunca inyectes fórmulas desde datos de usuario** sin sanear (CSV/Excel injection: valores que empiezan con `=`, `+`, `-`, `@` pueden ejecutarse). Prefija con `'` o escápalos al exportar datos que vienen de inputs.
- Formatea números/fechas/moneda en la zona `America/Lima`.
- Encabezados en español, consistentes con la UI (ver skill `espanol-consistente`).
- Nombra el archivo con contexto: `RQs_Operaciones_2026-08.xlsx`.

## Checklist
- [ ] Tamaño y nº de filas limitados en el upload.
- [ ] Cada fila validada por serializer, errores con nº de fila.
- [ ] Import atómico (o parcial explícito y reportado).
- [ ] Idempotencia si es reintentable.
- [ ] Imports grandes en Celery, no en el request.
- [ ] Export: sin inyección de fórmulas, formato es-PE.
