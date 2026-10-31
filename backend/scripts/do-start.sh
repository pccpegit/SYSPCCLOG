#!/bin/sh
# SYSPCC-024: arranque del servicio backend en DigitalOcean App Platform
# (ver .do/app.yaml, run_command: sh scripts/do-start.sh).
#
# No corre migrate: eso lo hace el job
# PRE_DEPLOY (scripts/do-predeploy.sh). collectstatic va en runtime porque en
# build no existen SECRET_KEY ni DB_*. exec: gunicorn recibe SIGTERM directo.
set -e

python manage.py collectstatic --noinput

# Dimensionado por entorno (SYSPCC-033). Defaults conservadores (1 x 4) para
# una instancia chica; el spec de la opcion Optimizada (2 vCPU / 4 GB) fija
# GUNICORN_WORKERS=4, GUNICORN_THREADS=4, GUNICORN_TIMEOUT=120.
#   * Concurrencia = WORKERS x THREADS. Cada hilo mantiene UNA conexion a la BD
#     (DB_CONN_MAX_AGE): con el pool de PgBouncer son conexiones baratas; sin el,
#     el limite del cluster (1 GB ~ 22) manda.
#   * TIMEOUT cubre la importacion del libro del almacen y la conversion
#     LibreOffice de contratos (ambas dentro de la peticion).
#   * MAX_REQUESTS recicla cada worker tras N peticiones (+ jitter para que no
#     reinicien todos a la vez): contiene fugas lentas de memoria.
#   * --worker-tmp-dir /dev/shm: el heartbeat de gunicorn no debe tocar el
#     disco del contenedor (si es lento, gunicorn mata workers sanos).
# Access log SIN query string (%(U)s = ruta sola; el formato por defecto imprime %(r)s y %(f)s,
# que incluyen la query): la UI busca trabajadores por GET (personal-lookup/?search=<nombre>,
# movements/?destination=<nombre>) y los nombres no deben acabar en los logs de la plataforma.
exec gunicorn config.wsgi:application \
  --bind 0.0.0.0:"${PORT:-8080}" \
  --workers "${GUNICORN_WORKERS:-1}" \
  --threads "${GUNICORN_THREADS:-4}" \
  --timeout "${GUNICORN_TIMEOUT:-120}" \
  --graceful-timeout 30 \
  --max-requests "${GUNICORN_MAX_REQUESTS:-1000}" \
  --max-requests-jitter "${GUNICORN_MAX_REQUESTS_JITTER:-100}" \
  --worker-tmp-dir /dev/shm \
  --access-logfile - \
  --access-logformat '%(h)s %(t)s "%(m)s %(U)s %(H)s" %(s)s %(b)s %(L)s' \
  --error-logfile -
