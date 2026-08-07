---
name: almacen-ciclo
description: Ciclo operativo del almacén de SYSPCC — las 6 fases (recepción, control, almacenamiento, picking, packing, despacho), el formato de ubicaciones y qué pasos interactúan con el sistema. Definido por gerencia, NO se modifica. Úsalo al trabajar en apps/warehouse o UI de /almacen. Dispara ante "almacén", "warehouse", "picking", "packing", "despacho", "recepción", "ubicación", "inventario", "stock".
---

# Ciclo del almacén — SYSPCC

Definido por gerencia (fuente: `CLAUDE.md`, "Ciclo Operativo del Almacen — DO NOT MODIFY"). Implementación en `apps/warehouse/`. **No modifiques las fases ni su orden.** Puedes mejorar validaciones, logging, permisos, UI y tests, no el proceso.

## Las 6 fases (secuenciales)
1. **RECEPCIÓN** — descarga, validación documentaria (guías/facturas), verificación física vs. documental (conteo, diferencias/daños/faltantes).
2. **CONTROL Y VERIFICACIÓN** — inspección de daños, vencimientos, cantidades, códigos vs. orden de compra. Resultado: **APROBACIÓN** (ingresa a inventario) o **RECHAZO** (separar, notificar proveedor, devolución/reposición).
3. **ALMACENAMIENTO** — asignar ubicación física, registrar en sistema, actualizar stock, optimizar por rotación (Alta/Media/Baja).
4. **PICKING** — recibir RQ (*), generar lista de picking cruzando inventario, identificar ubicaciones (*), recorrido, extracción, verificación + guía de remisión + descuento de stock.
5. **PACKING** — selección de empaque, protección, acomodo, cierre, etiquetado (proyecto + ubicación de descarga).
6. **DESPACHO** — carga del vehículo (por ruta y tipo), registro de salida (guías, hora, responsable, vehículo), reporte de salida.

(*) Pasos que **interactúan con el sistema SYSPCC** — son los que más código tocan: recepción del requerimiento y verificación de ubicaciones en picking, además del descuento de stock y la generación de guía.

## Formato de ubicación — validar SIEMPRE
`{Pabellón}{Sección}-{Nivel}` — ej. `B3-2` = Pabellón B, Sección 3, Nivel 2.
- **Pabellones**: A–K (1er piso A–E, 2do piso F–K).
- **Secciones**: 4–6 por pabellón (varía; B tiene además "Contenedor").
- **Niveles**: 1–5.

Al aceptar/guardar una ubicación, valida el patrón y los rangos por pabellón. No aceptes ubicaciones inexistentes en el layout.

## Reglas de implementación
- **Stock consistente**: todo movimiento (ingreso, picking, despacho) ajusta stock dentro de `transaction.atomic()` con lock (`select_for_update`) para evitar sobre-despacho por concurrencia. Ver `backend-produccion`.
- **Tipos de movimiento** en `MovementTypeChoices` / `MovementSourceChoices` / `MovementDestinationChoices` (`apps/core/enums.py`) — úsalos, no strings sueltos.
- **Trazabilidad**: cada movimiento registra quién, cuándo, cantidad, origen, destino, RQ asociado.
- **Enlace con el workflow de RQ**: picking/despacho del almacén corresponden a transiciones de RQ (`IN_STOCK → DISPATCHED_TO_SITE/DELIVERED`). Coordina con el skill `workflow-engine`; recuerda que OPS y ADM difieren en el despacho.
- **Permisos**: `CENTRAL_WAREHOUSE` y `SITE_WAREHOUSE` (ver `roles-y-permisos`).
- **Rechazo en fase 2** dispara el ciclo de reclamo a proveedor del workflow de RQ, no un flujo paralelo.

## Checklist
- [ ] No alteré fases ni su orden.
- [ ] Ubicación validada (`{Pabellón}{Sección}-{Nivel}`, rangos correctos).
- [ ] Ajuste de stock atómico + con lock.
- [ ] Movimiento trazado con enums, no strings.
- [ ] Coordinado con la transición de RQ correspondiente.
- [ ] Permisos de almacén aplicados.
