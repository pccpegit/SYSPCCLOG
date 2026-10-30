# Flujo Git, revisiones y releases — SYSPCC

Estándar obligatorio para todo cambio que se sube al repositorio `pccpegit/SYSPCCLOG`. El repositorio es **público a propósito**: con el plan gratuito de GitHub la protección de ramas solo existe en repositorios públicos (al hacerlo privado GitHub borra las reglas). Por eso nunca se suben secretos ni datos personales: viven en archivos ignorados por git y en el spec vivo de DigitalOcean. Modelo: **GitFlow con releases versionadas**. Producción se despliega **solo desde `main`**.

```
feature/SYSPCC-NNN-*  ─┐
fix/SYSPCC-NNN-*      ─┼─► develop ──► release/vX.Y.0 ──► main ──► producción (DigitalOcean)
chore|perf|refactor…  ─┘  integración   congelada:         tag vX.Y.Z
                          (no despliega) solo correcciones
hotfix/SYSPCC-NNN-* ── sale de main ──► main (tag vX.Y.Z+1) ──► se integra a develop
```

## 1. Ramas

| Rama | Vida | Sale de | Entra a | Cómo se mergea |
|---|---|---|---|---|
| `main` | permanente | — | — | Solo recibe `release/*` y `hotfix/*` por PR. Cada merge lleva tag `vX.Y.Z` y **despliega producción** |
| `develop` | permanente | — | — | Solo recibe ramas de ticket por PR. **No despliega** |
| `<tipo>/SYSPCC-NNN-<slug>` | un ticket | `develop` | `develop` | PR con **squash** (un commit por ticket). La rama se borra al mergear |
| `release/vX.Y.0` | días | `develop` | `main` | PR con **merge commit** (conserva los commits de develop). Solo admite correcciones del propio release |
| `hotfix/SYSPCC-NNN-<slug>` | horas | `main` | `main`, luego `develop` | PR a `main` con merge commit + tag de parche; luego PR `main → develop` |

Tipos de rama de ticket: `feature`, `fix`, `chore`, `refactor`, `perf`, `docs`, `test`. Slug en kebab-case, en español, corto: `fix/SYSPCC-034-refresh-cookie`.

**Reglas en GitHub** (protección de ramas, también para administradores): PR obligatorio, checks `backend-tests` y `frontend` obligatorios, conversaciones resueltas, sin force push ni borrado. `develop` exige historial lineal (squash); `main` acepta merge commit (releases). El repositorio borra la rama al mergear y no permite rebase-merge.

**Prohibido:** commits directos a `main` o `develop`, `push --force` a ramas compartidas, mergear con la CI en rojo, mezclar varios tickets en una rama.

## 2. Tickets

Todo cambio sustantivo tiene un `SYSPCC-NNN` en `TICKETS.md` (siguiente número libre), registrado **en la misma rama** del cambio: tipo, rama, descripción y estado (`En progreso` → `Mergeado` con el link del PR). Las ediciones triviales (un typo) no requieren ticket.

## 3. Commits

[Conventional Commits](https://www.conventionalcommits.org/es/) en español: `tipo(scope): descripción en imperativo`, cuerpo con el porqué y `Refs SYSPCC-NNN` al final. Sin firmas, `Co-Authored-By` ni menciones a herramientas de IA. Se commitean solo los archivos del cambio (nunca `git add -A` a ciegas).

| Tipo | Efecto en la versión |
|---|---|
| `feat` | MINOR (`v1.2.0 → v1.3.0`) |
| `fix`, `perf` | PATCH (`v1.2.0 → v1.2.1`) |
| `feat!` / `BREAKING CHANGE:` | MAJOR |
| `chore`, `docs`, `refactor`, `test`, `ci`, `build` | no cambia la versión por sí solo |

## 4. Pull requests

- Plantilla obligatoria (`.github/pull_request_template.md`): resumen, ticket, cambios, cómo probar y checklist.
- Título = el commit de squash (Conventional Commits).
- **Puertas para mergear** (protección de ramas en GitHub, también para administradores):
  - CI en verde: jobs `backend-tests` y `frontend` (`.github/workflows/ci.yml`). `backend-tests` corre `makemigrations --check` y pytest contra PostgreSQL 16 y Redis 7, en paralelo con pytest-xdist (~12 min; cada worker con su BD de test y su BD de Redis, ver `config/settings/ci.py`). `frontend` corre lint, Vitest y build en Node 22 (~3 min).
  - La CI corre en Linux con Node 22: un test que pasa en el Mac puede fallar ahí (zona horaria, mayúsculas en rutas, `localStorage` de jsdom). Si la CI falla, se corrige la causa; nunca se reintenta hasta que pase.
  - Conversaciones resueltas, historial lineal en `develop`, sin force push ni borrado de `main`/`develop`.
  - Revisión: mientras el equipo tenga un solo desarrollador, la revisión la cubren la CI y el revisor automatizado (`code-reviewer`); con un segundo desarrollador se activa **1 aprobación obligatoria** en `develop` y `main`.
- Cambios de comportamiento: tests nuevos en el mismo PR. Los flujos de gerencia (WorkflowEngine) y las 6 fases del almacén no se modifican; `apps/rq/tests/test_workflow_snapshot.py` lo vigila.

## 5. Versiones y releases

Versionado [SemVer](https://semver.org/lang/es/) con tag anotado `vX.Y.Z` en `main`, GitHub Release y `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)).

Procedimiento de release:

1. Desde `develop` actualizado: `git switch -c release/vX.Y.0 origin/develop`.
2. En la rama: mover la sección `[Sin publicar]` de `CHANGELOG.md` a `[X.Y.0] - AAAA-MM-DD` y registrar el ticket de la release.
3. Probar en el Docker local (`docker compose --env-file .env.docker up --build`, migrar, flujo completo). Correcciones del release: commits `fix(...)` en la misma rama.
4. PR `release/vX.Y.0 → main` (merge commit). Con la CI en verde y el OK del responsable, se mergea.
5. Tag y GitHub Release sobre el merge en `main`: `git tag -a vX.Y.0 -m "vX.Y.0" <sha> && git push origin vX.Y.0`, luego `gh release create vX.Y.0 --notes-from-tag` (o las notas del CHANGELOG).
6. El merge a `main` despliega solo (DigitalOcean, `deploy_on_push`). Verificar: `/healthz/` 200, login y la funcionalidad liberada.
7. Si la rama de release tuvo correcciones propias: PR `main → develop` para no perderlas.

## 6. Hotfix (falla en producción)

1. `git switch -c hotfix/SYSPCC-NNN-<slug> origin/main`.
2. Corrección mínima + test que la cubra. Versión de parche en `CHANGELOG.md`.
3. PR a `main` (CI en verde) → merge → tag `vX.Y.Z+1` → despliegue y verificación.
4. PR `main → develop` para integrar la corrección.

## 7. Producción y rollback

- La app `syspcc` de DigitalOcean despliega en cada push a `main` (job `migrate` primero). `develop` no despliega.
- **Rollback:** en el panel, *Activity → deployment anterior → Rollback* (o `doctl apps create-deployment` tras revertir el merge en `main` con un PR de `revert`). Las migraciones no se revierten solas: por eso deben ser **compatibles hacia atrás** (primero se agrega, en una release posterior se elimina).
- Variables y secretos de producción viven en el spec vivo, no en el repositorio (ver `docs/08_Guia_Despliegue_DigitalOcean.md`).

## 8. Día a día

1. Ticket en `TICKETS.md` y rama desde `develop` (idealmente en un `git worktree` aparte).
2. Desarrollo y pruebas locales en Docker.
3. Commit(s), push y PR a `develop` con la plantilla.
4. CI en verde + revisión → squash merge → se borra la rama.
5. Cuando se decide publicar: release (sección 5).
