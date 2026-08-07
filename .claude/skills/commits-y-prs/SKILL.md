---
name: commits-y-prs
description: Convenciones de commits y pull requests para SYSPCC — mensajes consistentes, PRs revisables. Úsalo al crear commits, preparar un PR, o escribir mensajes de cambio. Dispara ante "commit", "PR", "pull request", "mensaje de commit", "mergear".
---

# Commits y PRs — SYSPCC

## Commits (Conventional Commits)

Formato: `tipo(scope): descripción en imperativo`.

Tipos: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`.
Scopes del proyecto: `core`, `rq`, `warehouse`, `administracion`, `support`, `frontend`, `workflow`, `auth`, `almacen`.

Ejemplos:
```
feat(rq): añadir clasificación presupuestal para RQ de operaciones
fix(workflow): resolver transición según flow en IN_STOCK
refactor(core): mover validación de presupuesto a service
test(rq): cubrir transición ilegal y rol no autorizado
```

Reglas:
- Descripción en imperativo ("añadir", no "añadido"), ≤ 72 chars en el título.
- Un commit = un cambio lógico. La migración va con el cambio de modelo que la genera.
- Cuerpo (opcional) explica el **por qué**, no el qué (el diff ya dice el qué).
- **No commitees** si no te lo piden. Si te lo piden y estás en `main`/`develop`, crea rama primero.
- Nunca commitees secretos, `.env`, `db.sqlite3`, ni `console.log`/`print` de depuración.
- Cierre de mensajes de commit con:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Ramas y tickets (obligatorio)
- **Cada cambio sustantivo = un ticket + una rama + un PR.** No commitees trabajo sustantivo directo sobre `develop`/`main`.
- **Ticket**: próximo `SYSPCC-NNN` desde `TICKETS.md` (mayor ID + 1); registra la fila.
- **Rama** desde `develop`: `<tipo>/SYSPCC-NNN-<slug>` con tipo ∈ {feature, fix, chore, refactor, perf, docs, test}. Ej: `fix/SYSPCC-021-transicion-in-stock`.
- **Commit**: cuerpo con `Refs SYSPCC-NNN`. Commitea solo los archivos del cambio (el repo tiene cambios pre-existentes — nunca `git add -A` a ciegas).
- **Push + PR hacia `develop`**: muestra el plan y **confirma con el usuario antes de subir**. PR con `gh` (requiere estar instalado/autenticado); si no, push + link de comparación.

## Pull Requests

Título = mismo estilo que el commit. Cuerpo con esta estructura:

```markdown
## Qué
Resumen de una frase.

## Por qué
Contexto / problema que resuelve.

## Cambios
- Punto por área tocada.

## Cómo probar
Pasos concretos (endpoints, pantallas, comandos).

## Checklist
- [ ] Tests pasan (`pytest`, `npm run lint`).
- [ ] Estándares aplicados (ver skill `code-review-syspcc`).
- [ ] Sin cambios a los flujos de gerencia (o justificados y confirmados).
- [ ] Migraciones seguras si hay cambios de modelo.
```

- Cierre del cuerpo del PR con:
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- PR pequeño y enfocado > PR gigante. Si crece, divídelo.
- Usa `gh` para operaciones de GitHub.
