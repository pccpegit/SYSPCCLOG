#!/bin/sh
# SYSPCC-021: arranque del servicio demo en Render (ver render.yaml).
#
# Render pasa dockerCommand como exec-form (sin shell): los `&&` no se
# interpretan y un `sh -c "..."` anidado deja las comillas literales, asi
# que la secuencia de arranque vive aqui y dockerCommand solo invoca este
# script (deploys dep-daat6c15 y dep-daat8ri1, 2026-08-31).
set -e

python manage.py migrate --noinput
python manage.py collectstatic --noinput

# exec: gunicorn reemplaza al shell como proceso principal y recibe las
# senales de Render (SIGTERM en redeploys/hibernacion) directamente.
exec gunicorn config.wsgi:application \
  --bind 0.0.0.0:"${PORT:-8000}" \
  --workers 1 --threads 4 --timeout 120
