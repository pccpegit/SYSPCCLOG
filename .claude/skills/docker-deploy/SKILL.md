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

## Servicios de `docker-compose.yml` (desarrollo)
- **redis** — cache + broker/result backend de Celery.
- **backend** — `runserver` con hot reload; SQLite en el volumen `sqlite_data` (`/app/data/db.sqlite3`). No hay servicio de BD aparte en desarrollo.
- **frontend** — servidor de Vite con HMR (puerto 5173).
- **celery_worker** — `celery -A config worker -l info` (cola por defecto).
- **celery_worker_hr** — `celery -A config worker -Q hr_cv -c 3 -n hr@%h -l info` (análisis de CVs de RR. HH.; `CELERY_TASK_ROUTES` manda ahí `hr.process_cv_item` y `hr.cv_requeue_stale`).
- **celery_beat** — `celery -A config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler`.

En producción el backend corre con Gunicorn (no `runserver`) sobre PostgreSQL.

Tareas programadas (`CELERY_BEAT_SCHEDULE`, TZ Lima): SLA 8 AM, recordatorios de aprobación 9 AM/2 PM, invalidación de cache cada 15 min, low-stock 7:30 AM, purga de importaciones vencidas del almacén 3 AM, reencolado de CVs atascados cada 5 min (cola `hr_cv`). Verifica que los workers **y** beat estén corriendo o no se ejecutan.

## Entornos / settings
- `DJANGO_SETTINGS_MODULE=config.settings.production` en prod (dev usa `.development`). Producción vive **solo** en DigitalOcean App Platform: spec `.do/app.yaml`, arranque `backend/scripts/do-start.sh`, migraciones en el job PRE_DEPLOY `backend/scripts/do-predeploy.sh`, guía `docs/08_Guia_Despliegue_DigitalOcean.md`. La demo de capa gratuita (Render + Supabase + Vercel, SYSPCC-021) fue retirada en SYSPCC-039.
- Variables **solo** por entorno (`.env.docker`, secrets del orquestador), nunca en la imagen ni en git.
- Prod: `DEBUG=False`, `ALLOWED_HOSTS` real, Postgres, flags de seguridad (ver skill `seguridad-owasp`).

## Checklist de release
- [ ] `pytest`, `npm test` y `npm run lint`/`build` en verde.
- [ ] Migraciones revisadas y seguras (skill `django-migrations`); orden código↔migración pensado.
- [ ] Variables de entorno de prod configuradas (SECRET_KEY, DB, Redis, CORS, ALLOWED_HOSTS).
- [ ] `DEBUG=False` y flags de seguridad activos.
- [ ] `python manage.py migrate` ejecutado en el despliegue.
- [ ] `collectstatic` si aplica; estáticos del frontend servidos.
- [ ] Workers (por defecto y `hr_cv`) **y** beat de Celery corriendo.
- [ ] Redis accesible.
- [ ] Healthcheck / logs verificados tras el deploy.
- [ ] Plan de rollback (imagen anterior + migraciones reversibles).

## Notas
- No corras `runserver` en prod — usa Gunicorn/uvicorn.
- No expongas `/mgmt-panel/` ni `/api/docs/` sin auth.
- Backups de la BD antes de migraciones destructivas.
- Imagen mínima: `backend/.dockerignore` excluye `.env`, `db.sqlite3`, `.venv`/`venv`, `__pycache__`, `*.pyc`, `*.log`, `.git` y `private_media/`; `frontend/.dockerignore` excluye `node_modules`, `dist`, `.env`, `*.log` y `.git`. Los tests sí entran en la imagen.
