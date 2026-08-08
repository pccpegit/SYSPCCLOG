# Registro de Tickets — SYSPCC

Registro incremental de cambios. **Cada cambio sustantivo** recibe un ID `SYSPCC-NNN`, su rama (`<tipo>/SYSPCC-NNN-<slug>`) y su PR hacia `develop`.

Para el próximo ID: toma el mayor de la tabla + 1. Tipos: `feature`, `fix`, `chore`, `refactor`, `perf`, `docs`, `test`.

| Ticket | Tipo | Rama | Descripción | PR | Estado |
|--------|------|------|-------------|-----|--------|
| SYSPCC-001 | chore | `chore/SYSPCC-001-setup-agent-team` | Equipo multiagente (13 agentes + 18 skills), modo-equipo permanente y flujo de trabajo Git con tickets | [#1](https://github.com/pccpegit/SYSPCCLOG/pull/1) | Mergeado |
| SYSPCC-002 | chore | `chore/SYSPCC-002-gitignore-higiene` | Higiene del repo: ignorar datos con PII (datapasajes), rle/, docs generados y carpetas .claude descolocadas | [#3](https://github.com/pccpegit/SYSPCCLOG/pull/3) | Mergeado |
| SYSPCC-003 | feature | `feature/SYSPCC-003-backend-estado-actual` | Estado actual del backend: apps rq, core, warehouse, administracion, support + config | [#4](https://github.com/pccpegit/SYSPCCLOG/pull/4) | Mergeado |
| SYSPCC-004 | feature | `feature/SYSPCC-004-frontend-estado-actual` | Estado actual del frontend: pages, components, api, context, assets | _pendiente_ | En progreso |
