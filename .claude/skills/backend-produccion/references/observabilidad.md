# Observabilidad y monitoreo — patrones de infra

No implementes nada de esto sin confirmar con el usuario qué infra hay disponible (¿Prometheus? ¿Datadog? ¿CloudWatch?). Estos son los patrones de referencia.

## Correlation ID (middleware)

Genera/propaga un `X-Request-ID` por petición y adjúntalo a todos los logs vía un filter de logging.

```python
# apps/core/middleware.py
import uuid, contextvars
correlation_id_var = contextvars.ContextVar("correlation_id", default=None)

class CorrelationIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
    def __call__(self, request):
        cid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        correlation_id_var.set(cid)
        request.correlation_id = cid
        response = self.get_response(request)
        response["X-Request-ID"] = cid
        return response

# apps/core/logging_filters.py
import logging
class CorrelationIdFilter(logging.Filter):
    def filter(self, record):
        record.correlation_id = correlation_id_var.get()
        return True
```

Registrar el middleware en `MIDDLEWARE` (arriba, tras SecurityMiddleware) y el filter en `LOGGING`.

## Logging JSON estructurado

Cambia el formatter a JSON para que `extra=` y `correlation_id` salgan como campos indexables (logs centralizados: ELK, Loki, CloudWatch Logs, Datadog).

```python
# pip install python-json-logger
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"correlation": {"()": "apps.core.logging_filters.CorrelationIdFilter"}},
    "formatters": {
        "json": {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "format": "%(levelname)s %(asctime)s %(name)s %(message)s %(correlation_id)s",
        },
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "json", "filters": ["correlation"]},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {"apps": {"handlers": ["console"], "level": "INFO", "propagate": False}},
}
```

## Métricas (Prometheus)

```python
# pip install django-prometheus prometheus-client
# settings: INSTALLED_APPS += ['django_prometheus'] ; middleware Before/After ; urls: path("", include("django_prometheus.urls"))
from prometheus_client import Counter, Histogram
rq_transitions = Counter("rq_transitions_total", "Transiciones de RQ", ["action", "result"])
rq_latency = Histogram("rq_transition_seconds", "Latencia de transición", ["action"])

# en el service:
with rq_latency.labels(action).time():
    ...
rq_transitions.labels(action, "ok").inc()   # o "error"
```

`/metrics` lo scrapea Prometheus → dashboards en Grafana. Alertas vía Alertmanager (Prometheus) o monitores en Datadog/CloudWatch sobre `rate(rq_transitions_total{result="error"}[5m])`.

## Trazas distribuidas (OpenTelemetry → Jaeger)

```python
# pip install opentelemetry-distro opentelemetry-instrumentation-django \
#             opentelemetry-instrumentation-celery opentelemetry-exporter-otlp
# opentelemetry-bootstrap -a install
# Ejecutar con: opentelemetry-instrument python manage.py runserver
# Env: OTEL_SERVICE_NAME=syspcc-backend  OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4317
```

Spans manuales para operaciones de negocio:

```python
from opentelemetry import trace
tracer = trace.get_tracer(__name__)
with tracer.start_as_current_span("rq.transition") as span:
    span.set_attribute("rq.id", request_id)
    span.set_attribute("rq.action", action)
    ...
```

El instrumentador de Celery propaga el trace context a las tasks automáticamente.

## Dead Letter Queue (Celery)

Cola dedicada para trabajo que agotó reintentos. No pierdas mensajes: persístelos y alerta.

```python
# opción simple: tabla en BD
class DeadLetter(models.Model):
    task_name = models.CharField(max_length=200)
    payload = models.JSONField()
    correlation_id = models.CharField(max_length=64, null=True)
    error = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    reprocessed = models.BooleanField(default=False)

def send_to_dlq(task_name, payload, correlation_id, error=""):
    DeadLetter.objects.create(task_name=task_name, payload=payload,
                              correlation_id=correlation_id, error=error)
    logger.error("dlq.stored", extra={"task_name": task_name, "correlation_id": correlation_id})
    # + disparar alerta (Slack/PagerDuty/Datadog event)
```

Alternativa con broker: cola `dlq` en RabbitMQ/Redis + un worker/comando de reproceso manual (`manage.py replay_dlq`).

## Alertas y dashboards

- **Alertas**: tasa de errores 5xx, latencia p95, profundidad de la DLQ, fallos de tasks, conexiones de BD agotadas. Prometheus Alertmanager / Datadog monitors / CloudWatch alarms.
- **Dashboards**: RQ por estado, throughput de transiciones, latencia por acción, errores por endpoint, backlog de Celery. Grafana sobre Prometheus, o Datadog/CloudWatch.
- **SLOs**: define objetivo (p.ej. 99% de transiciones < 500ms) y alerta sobre error budget.
