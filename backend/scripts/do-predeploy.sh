#!/bin/sh
# SYSPCC-024: job PRE_DEPLOY de App Platform. Migra el esquema y carga los
# datos de referencia (AcquisitionTypeConfig, WorkflowStep). seed_data es
# idempotente (get_or_create) y no crea usuarios. NUNCA seed_demo aqui:
# seed_guard lo bloquea en produccion.
set -e

python manage.py migrate --noinput
python manage.py seed_data
