---
name: docker-deploy
description: Flujo de Docker y despliegue para SYSPCC — levantar el stack, migrar, sembrar datos, y checklist de release. Úsalo al trabajar con docker compose, preparar un despliegue, o configurar entornos. Dispara ante "docker", "compose", "deploy", "despliegue", "release", "producción", "contenedor".
---

# Docker y despliegue — SYSPCC

Stack: Django + DRF, React/Vite, Redis (cache/Celery), Postgres (prod). Timezone `America/Lima`.

## Desarrollo con Docker (desde raíz)
```bash
docker compose --env-file .env.docker up --build
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_demo
```

## Servicios que deben estar arriba
- **backend** (Django/Gunicorn en prod, no `runserver`).
- **frontend** (build de Vite servido estático / nginx).
- **redis** (cache + broker Celery).
- **db** (Postgres en prod).
- **celery worker** — `celery -A config worker -l info`.
- **celery beat** — `celery -A config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler`.

Tareas programadas (beat, TZ Lima): SLA 8 AM, recordatorios de aprobación 9 AM/2 PM, invalidación de cache cada 15 min, low-stock 7:30 AM. Verifica que worker **y** beat estén corriendo o no se ejecutan.

## Entornos / settings
- `DJANGO_SETTINGS_MODULE=config.settings.production` en prod (dev usa `.development`).
- Variables **solo** por entorno (`.env.docker`, secrets del orquestador), nunca en la imagen ni en git.
- Prod: `DEBUG=False`, `ALLOWED_HOSTS` real, Postgres, flags de seguridad (ver skill `seguridad-owasp`).

## Checklist de release
- [ ] `pytest` y `npm run lint`/`build` en verde.
- [ ] Migraciones revisadas y seguras (skill `django-migrations`); orden código↔migración pensado.
- [ ] Variables de entorno de prod configuradas (SECRET_KEY, DB, Redis, CORS, ALLOWED_HOSTS).
- [ ] `DEBUG=False` y flags de seguridad activos.
- [ ] `python manage.py migrate` ejecutado en el despliegue.
- [ ] `collectstatic` si aplica; estáticos del frontend servidos.
- [ ] Worker **y** beat de Celery corriendo.
- [ ] Redis accesible.
- [ ] Healthcheck / logs verificados tras el deploy.
- [ ] Plan de rollback (imagen anterior + migraciones reversibles).

## Notas
- No corras `runserver` en prod — usa Gunicorn/uvicorn.
- No expongas `/mgmt-panel/` ni `/api/docs/` sin auth.
- Backups de la BD antes de migraciones destructivas.
- Imagen mínima: `.dockerignore` excluye `.env`, `db.sqlite3`, `node_modules`, `.venv`, tests.
