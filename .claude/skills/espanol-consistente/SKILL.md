---
name: espanol-consistente
description: Consistencia de idioma en SYSPCC — texto de cara al usuario en español (es-PE), identificadores de código en inglés. Úsalo al escribir mensajes, labels de UI, errores, choices de enums, o cualquier texto que vea el usuario. Dispara ante "mensaje", "label", "texto", "traducción", "idioma", "enum choices", "error de usuario".
---

# Español consistente — SYSPCC

La app es interna para una empresa peruana. Regla base: **código en inglés, texto de usuario en español (es-PE)**.

## Qué va en cada idioma

**En inglés** (identificadores):
- Nombres de variables, funciones, clases, módulos, campos de modelo.
- Claves de enum (`RoleChoices.PROJECT_RESIDENT`, `RQStatusChoices.SUBMITTED`).
- Nombres de endpoints/rutas técnicas.
- Comentarios de código y docstrings (sigue el estilo del repo).
- Nombres de tests.

**En español** (lo que ve el usuario):
- Labels de los enums: `SUBMITTED = 'SUBMITTED', _('Enviado')` — la etiqueta traducida.
- Mensajes de error de negocio (`WorkflowError("El RQ no tiene partida presupuestal asignada.")`).
- Toasts, títulos de página, botones, placeholders, ayudas en la UI.
- Encabezados de reportes Excel.
- Notificaciones (correo/in-app).

## Cómo mantenerlo consistente

1. **Usa `gettext` (`_()`)** para los labels de `TextChoices` y textos traducibles del backend, como ya se hace en `enums.py`. No hardcodees el español fuera del patrón existente.
2. **Terminología de dominio unificada** — usa siempre el mismo término (el del label del enum). No mezcles sinónimos:
   - RQ / Requerimiento (no "solicitud" a veces y "pedido" otras).
   - "Partida presupuestal" (OPS) vs "Plan Anual" (ADM) — no los intercambies.
   - Roles: usa el label oficial ("Residente de Proyecto", "Coordinador Logístico", etc.), no variantes.
   - Estados: usa el texto exacto del `RQStatusChoices` label ("Aprobado técnicamente", "Requiere compra"...).
3. **Ortografía correcta con tildes** en el texto de usuario (á, é, í, ó, ú, ñ): "Cotización", "Aprobación", "Almacén". El código puede ir sin tildes (identificadores ASCII).
4. **Formato regional es-PE**: fechas `dd/mm/aaaa`, moneda en soles cuando aplique, zona `America/Lima`.
5. **Mensajes de error útiles y en español**, orientados a la acción: "El RQ ya fue enviado y no puede editarse." mejor que "Invalid state".
6. **Frontend**: los textos visibles en español; si hay i18n, centraliza; si no, mantén coherencia con los labels que envía el backend (no traduzcas de nuevo en el front lo que ya viene traducido).

## Ejemplos
```python
# Bien: clave en inglés, label en español con gettext
class PriorityChoices(models.TextChoices):
    URGENT = 'URGENT', _('Urgente')
    HIGH = 'HIGH', _('Alta')

# Bien: error de negocio en español, claro y accionable
raise WorkflowError("Solo el Residente de Proyecto puede aprobar técnicamente este RQ.")

# Mal: mezcla idiomas en texto de usuario / término inconsistente
raise WorkflowError("Request cannot be approved")          # inglés al usuario
toast.error("El pedido fue rechazado")                     # "pedido" en vez de "RQ/Requerimiento"
```

## Checklist
- [ ] Identificadores y comentarios en inglés; texto de usuario en español.
- [ ] Labels de enum con `_()` y término del dominio consistente.
- [ ] Tildes correctas en texto de usuario.
- [ ] Errores en español, claros y accionables.
- [ ] Front no re-traduce lo que el backend ya envía traducido.
