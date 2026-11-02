# Changelog

Todos los cambios relevantes de SYSPCC se registran aquí. Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado [SemVer](https://semver.org/lang/es/). El detalle de cada ticket está en `TICKETS.md` y en su PR. Proceso: `docs/09_Flujo_Git_y_Releases.md`.

## [Sin publicar]

## [1.1.0] - 2026-11-02

### Agregado
- Almacén: N° de guía automático `GR-AAAA-NNNNNN` en toda salida (Salida, entregas de EPP, ajustes, entregas de Picking y despacho automático), impreso en el PDF; correlativo único por año, sin duplicados ni saltos (SYSPCC-041).
- Salida: selector opcional de RQ pendientes por entregar; una salida vinculada cuenta como entrega del RQ y actualiza el Master de RQ (SYSPCC-041).

### Cambiado
- Salida y Picking ya no piden N° de vale ni guía escritos a mano; los vales físicos históricos y la importación del Excel se conservan (SYSPCC-041).
- El filtro y el indicador «Egresos sin vale» excluyen las salidas con guía automática (SYSPCC-041).

### Seguridad
- Límite de salidas por usuario, protección contra salidas duplicadas por doble envío y rechazo de vales que imitan una guía (SYSPCC-041).

### Corregido
- Kardex y vales sin consultas repetidas por fila (N+1) (SYSPCC-041).

## [1.0.0] - 2026-10-30

Primera versión en producción (DigitalOcean App Platform). Reúne SYSPCC-001 a SYSPCC-040. Desde esta versión producción se despliega solo desde `main`.

### Agregado
- Requerimientos (RQ) con los flujos de gerencia Operaciones y Administración (WorkflowEngine, 5 fases), aprobaciones por rol, cotizaciones, órdenes de compra, recepción con control de calidad y ciclo de reclamo a proveedor.
- Almacén de EPP: catálogo, ubicaciones `{Pabellón}{Sección}-{Nivel}`, ingresos y egresos, kardex, entregas de EPP con vale, importación del libro Excel en dos pasos, despacho con stock real y entregas parciales por RQ (SYSPCC-025, 028, 029, 032).
- Vínculo de ítems de RQ con el catálogo del almacén y disponibilidad de stock para logística (SYSPCC-026).
- Master de RQ: seguimiento por ítem con exportación a Excel (SYSPCC-030).
- RR. HH.: contratos desde plantillas Word y análisis masivo de CVs con Claude (SYSPCC-022, 023).
- Administración del Sistema para superusuarios: usuarios, roles y proyectos (SYSPCC-018); tema claro/oscuro (SYSPCC-020); módulo de pasajes y soporte TI.
- Despliegue en DigitalOcean App Platform con PostgreSQL y Valkey gestionados, Spaces privados y opción Optimizada (SYSPCC-024, 033, 035).
- CI en GitHub Actions (pytest contra PostgreSQL 16, migraciones, lint, Vitest y build) y flujo GitFlow con releases versionadas (SYSPCC-037, 038).

### Eliminado
- Demo de capa gratuita en Render, Supabase y Vercel (settings, blueprint, proxy y guía); producción vive solo en DigitalOcean (SYSPCC-039).

### Corregido
- Documentos de RR. HH.: la lista ya no vuelve a la página 1 si se cambia de página antes de que corra el buscador (SYSPCC-037).
- Sesión: la renovación lee el refresh token de la cookie HttpOnly; ya no expulsa al login a los 15 minutos ni al recargar la página (SYSPCC-034).
- "Guardar Borrador" guarda el RQ como borrador en vez de enviarlo (SYSPCC-031).
- Control de acceso, concurrencia, idempotencia y manejo de errores (SYSPCC-006 a 013, 015 a 017).

### Rendimiento
- Carga inicial del frontend de 2,3 MB a 362 KB: módulos bajo demanda y ExcelJS solo al exportar (SYSPCC-036).

### Seguridad
- El login ya no trae precargada la contraseña de los usuarios demo (SYSPCC-036).
- CSRF double-submit en la autenticación por cookie, tokens de OneDrive cifrados en reposo y sin credenciales en el repositorio (SYSPCC-015 a 017).

[Sin publicar]: https://github.com/pccpegit/SYSPCCLOG/compare/v1.1.0...develop
[1.1.0]: https://github.com/pccpegit/SYSPCCLOG/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/pccpegit/SYSPCCLOG/releases/tag/v1.0.0
