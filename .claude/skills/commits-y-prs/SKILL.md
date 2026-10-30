---
name: commits-y-prs
description: Convenciones de commits y pull requests para SYSPCC — mensajes consistentes, PRs revisables. Úsalo al crear commits, preparar un PR, o escribir mensajes de cambio. Dispara ante "commit", "PR", "pull request", "mensaje de commit", "mergear".
---

# Commits y PRs — SYSPCC

## Commits (Conventional Commits)

Formato: `tipo(scope): descripción en imperativo`.

Tipos: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`.
Scopes del proyecto: `core`, `rq`, `warehouse`, `administracion`, `support`, `hr`, `frontend`, `workflow`, `auth`, `almacen`, `tickets` (actualizar `TICKETS.md`).

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
- **Sin atribución**: el mensaje termina en el cuerpo (con `Refs SYSPCC-NNN`). No añadas `Co-Authored-By`, firmas ni menciones de herramientas de IA.

## Ramas, tickets y releases (obligatorio)
Modelo GitFlow completo en `docs/09_Flujo_Git_y_Releases.md`.
- **Cada cambio sustantivo = un ticket + una rama + un PR.** Nunca commits directos a `develop`/`main` (la protección de ramas lo impide, también a administradores).
- **Ticket**: próximo `SYSPCC-NNN` desde `TICKETS.md` (mayor ID + 1); registra la fila en la misma rama. El estado `Mergeado` (con link del PR) se anota en el PR siguiente.
- **Rama** desde `develop`: `<tipo>/SYSPCC-NNN-<slug>` con tipo ∈ {feature, fix, chore, refactor, perf, docs, test}. Ej: `fix/SYSPCC-034-refresh-cookie`. Urgencias de producción: `hotfix/SYSPCC-NNN-<slug>` desde `main`. Releases: `release/vX.Y.0` desde `develop`.
- **Commit**: cuerpo con `Refs SYSPCC-NNN`. Commitea solo los archivos del cambio (nunca `git add -A` a ciegas).
- **Push + PR**: muestra el plan y **confirma con el usuario antes de subir**. Ticket → PR a `develop` (squash). Release/hotfix → PR a `main` (merge commit) + tag `vX.Y.Z` + `gh release create`.
- **CI obligatoria**: `backend-tests` y `frontend` en verde y la rama al día con su base antes de mergear.
- **Cuenta**: el push usa `pccpegit` (`gh auth switch --user pccpegit` y `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`); al terminar, restaura la cuenta anterior.

## Pull Requests

Título = mismo estilo que el commit. Cuerpo con esta estructura:

```markdown
## Resumen
Qué cambia y por qué, en dos o tres frases.

## Ticket
SYSPCC-NNN

## Cambios
- Punto por área tocada.

## Cómo probar
Pasos concretos (endpoints, pantallas, comandos).

## Checklist
- [ ] Tests pasan (`pytest`, `npm test`, `npm run lint`).
- [ ] Estándares aplicados (ver skill `code-review-syspcc`).
- [ ] Sin cambios a los flujos de gerencia (o justificados y confirmados; `test_workflow_snapshot.py` en verde).
- [ ] Migraciones seguras si hay cambios de modelo.
```

- El cuerpo del PR termina en el checklist: sin firmas, sin "Generated with…" ni atribución de herramientas de IA.
- PR pequeño y enfocado > PR gigante. Si crece, divídelo.
- Usa `gh` para operaciones de GitHub.
