#!/bin/sh
# SYSPCC-024: arranque del servicio backend en DigitalOcean App Platform
# (ver .do/app.yaml, run_command: sh scripts/do-start.sh).
#
# A diferencia de render-start.sh NO corre migrate: eso lo hace el job
# PRE_DEPLOY (scripts/do-predeploy.sh). collectstatic va en runtime porque en
# build no existen SECRET_KEY ni DB_*. exec: gunicorn recibe SIGTERM directo.
set -e

python manage.py collectstatic --noinput

exec gunicorn config.wsgi:application \
  --bind 0.0.0.0:"${PORT:-8080}" \
  --workers "${GUNICORN_WORKERS:-1}" \
  --threads "${GUNICORN_THREADS:-4}" \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
