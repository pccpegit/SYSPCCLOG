---
name: accesibilidad
description: Accesibilidad (a11y) para el frontend React de SYSPCC — dashboards y formularios enterprise usables con teclado y lectores de pantalla. Úsalo al crear UI: formularios, tablas, modales, menús, botones de acción. Dispara ante "accesibilidad", "a11y", "aria", "teclado", "lector de pantalla", "contraste", "foco".
---

# Accesibilidad — SYSPCC

App interna con uso intensivo de teclado (operadores de almacén, aprobadores). La a11y aquí es también productividad.

## Reglas base
1. **HTML semántico primero**: `<button>` para acciones, `<a>` para navegar, `<table>` para datos tabulares, `<label>` asociado a cada input. Un `<div onClick>` no es un botón.
2. **Teclado**: todo lo accionable con mouse debe funcionar con teclado (Tab, Enter, Espacio, Esc). Nada solo-hover para info crítica.
3. **Foco visible**: no elimines el outline de foco sin reemplazarlo por uno claro (ring Tailwind). El usuario debe ver dónde está.
4. **Modales**: atrapan el foco, cierran con `Esc`, devuelven el foco al disparador al cerrar, `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
5. **Labels y estados**: inputs con `<label>` o `aria-label`; errores con `aria-invalid` + `aria-describedby` apuntando al mensaje.
6. **Contraste**: texto normal ≥ 4.5:1, texto grande ≥ 3:1. Ojo con grises claros sobre blanco en badges de estado.
7. **No solo color**: los estados de RQ no se distinguen solo por color (daltonismo) — añade texto o icono. Un badge "Rechazado" lleva la palabra, no solo rojo.
8. **Feedback dinámico**: toasts y cambios async con `aria-live="polite"` (errores `assertive`) para que el lector los anuncie.
9. **Imágenes/iconos**: iconos Lucide decorativos → `aria-hidden="true"`; iconos que son la única etiqueta de un botón → `aria-label`.

## Patrones
```jsx
// Botón solo-icono
<button aria-label="Aprobar RQ" onClick={approve}>
  <Check aria-hidden="true" />
</button>

// Campo con error accesible
<label htmlFor="cantidad">Cantidad</label>
<input id="cantidad" type="number" aria-invalid={!!error}
       aria-describedby={error ? 'cantidad-error' : undefined} />
{error && <p id="cantidad-error" role="alert">{error}</p>}

// Badge de estado: color + texto + icono
<span className="...">
  <XCircle aria-hidden="true" /> Rechazado
</span>

// Región de notificaciones
<div aria-live="polite" aria-atomic="true">{toastMessage}</div>
```

## Tablas de datos (dashboards)
- `<th scope="col">` en encabezados.
- Orden por columna accesible por teclado con `aria-sort`.
- Acciones por fila alcanzables con Tab, con `aria-label` que incluya el contexto ("Ver RQ-001").

## Checklist
- [ ] Elementos semánticos correctos (`button`/`a`/`label`/`table`).
- [ ] Navegable 100% con teclado; foco visible.
- [ ] Modales con trap de foco + Esc + retorno de foco.
- [ ] Inputs etiquetados; errores con `role="alert"`/`aria-describedby`.
- [ ] Contraste suficiente; estados no dependen solo del color.
- [ ] Toasts en región `aria-live`.
- [ ] Iconos decorativos `aria-hidden`; iconos-botón con `aria-label`.
