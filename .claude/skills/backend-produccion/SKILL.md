---
name: backend-produccion
description: Estándares obligatorios para código backend Django/DRF que va a producción en SYSPCC. Úsalo SIEMPRE que escribas o modifiques services, views, tasks de Celery, o cualquier código que toque la base de datos o procese peticiones. Cubre manejo de errores, logging estructurado, idempotencia, validaciones, transacciones, retries y observabilidad. Dispara ante "servicio", "endpoint", "vista", "tarea Celery", "workflow", "guardar en BD", "producción", "manejo de errores".
---

# Backend a producción — SYSPCC

Reglas no negociables para código backend que sale a producción. Aplícalas al escribir services (`apps/*/services/`), views/viewsets, serializers y tasks de Celery. Si un requisito no aplica al caso concreto, dilo explícitamente en vez de omitirlo en silencio.

Convenciones del repo que DEBES respetar:
- Lógica de negocio en `apps/<app>/services/`, no en views.
- Excepciones custom en `apps/core/exceptions.py` (`WorkflowError`, `BudgetValidationError`, `PermissionDeniedForAction`). Crea nuevas ahí si hace falta; nunca lances `Exception` pelado.
- Logger por módulo: `logger = logging.getLogger(__name__)` (namespace `apps` ya está configurado en `LOGGING`).

---

## 1. Manejo de errores

- **Nunca** `except Exception:` a secas para tragar errores. Captura tipos concretos: `IntegrityError`, `OperationalError`, `ValidationError`, `ObjectDoesNotExist`, tus excepciones de dominio.
- Un `except Exception` general SOLO es válido como última barrera que **loguea con `logger.exception()` y re-lanza** (o convierte a una respuesta 500 controlada). Nunca `except Exception: pass`.
- Toda escritura multi-paso va dentro de `transaction.atomic()` para rollback automático.
- Traduce errores de infraestructura a errores de dominio antes de que suban a la view.

```python
import logging
from django.db import transaction, IntegrityError, OperationalError, DatabaseError
from django.core.exceptions import ValidationError, ObjectDoesNotExist
from apps.core.exceptions import WorkflowError

logger = logging.getLogger(__name__)


class RequestService:
    @classmethod
    def transition(cls, request_id: int, action: str, user, *, request_id_hdr: str = None):
        ctx = {"request_id": request_id, "action": action, "user_id": getattr(user, "id", None),
               "correlation_id": request_id_hdr}
        try:
            with transaction.atomic():
                rq = Request.objects.select_for_update().get(pk=request_id)  # bloqueo → evita race
                rq.apply_action(action, user)          # puede lanzar WorkflowError (dominio)
                rq.save(update_fields=["status", "updated_at"])
                logger.info("rq.transition.ok", extra=ctx | {"new_status": rq.status})
                return rq

        except ObjectDoesNotExist:
            logger.warning("rq.transition.not_found", extra=ctx)
            raise
        except WorkflowError as exc:                   # error de negocio esperado → warning, no exception
            logger.warning("rq.transition.invalid", extra=ctx | {"reason": exc.message})
            raise
        except IntegrityError as exc:                  # UNIQUE / FK — rollback ya hecho por atomic()
            logger.warning("rq.transition.integrity", extra=ctx | {"db_error": str(exc)})
            raise
        except OperationalError as exc:                # timeout / conexión perdida — reintentable
            logger.warning("rq.transition.db_unavailable", extra=ctx | {"db_error": str(exc)})
            raise
        except Exception:                              # última barrera: loguea con stack y re-lanza
            logger.exception("rq.transition.unexpected", extra=ctx)
            raise
```

Notas:
- `transaction.atomic()` hace rollback al propagarse cualquier excepción. No llames `rollback()` a mano.
- No pongas `logger.exception()` en un `except` que re-lanza un error de negocio esperado (llenarías los logs de stacks ruidosos); usa `warning` para esperados y `exception` solo para inesperados.

## 2. Logging estructurado

- Un logger por módulo: `logger = logging.getLogger(__name__)`.
- Niveles: `logger.info()` flujo normal / hitos; `logger.warning()` errores esperados y recuperables; `logger.exception()` SOLO dentro de un `except` inesperado (adjunta el stack automáticamente); `logger.error()` fallo sin stack disponible.
- Pasa contexto por `extra=`, nunca concatenado en el mensaje. Campos mínimos en cada evento de negocio: `request_id`/`event_id`, `correlation_id`, `user_id`, `firm_id`/`project_id` cuando aplique.
- Mensaje = clave estable y greppable (`rq.transition.ok`), los datos van en `extra`. No metas PII ni tokens en los logs.
- Para que `extra` salga en el log JSON, usa el formatter estructurado (ver `references/observabilidad.md`).

## 3. Idempotencia

- Operaciones que se pueden reintentar (webhooks, tasks Celery, POST de creación) deben ser idempotentes.
- Mecanismo preferido: **constraint `UNIQUE`** sobre una clave de idempotencia (`idempotency_key`, o combinación natural de negocio) + `get_or_create` / `INSERT ... ON CONFLICT` dentro de `atomic()`.
- Evita race conditions con `select_for_update()` o dependiendo del `UNIQUE`, nunca con "primero consulto y luego escribo" sin lock.

```python
from django.db import IntegrityError, transaction

def register_event(idempotency_key: str, payload: dict):
    try:
        with transaction.atomic():
            obj, created = Event.objects.get_or_create(
                idempotency_key=idempotency_key,
                defaults={"payload": payload},
            )
    except IntegrityError:                 # carrera: otro proceso lo insertó primero
        obj, created = Event.objects.get(idempotency_key=idempotency_key), False
    if not created:
        logger.info("event.duplicate.ignored", extra={"idempotency_key": idempotency_key})
    return obj, created
```

## 4. Validaciones

- Valida en el **serializer** (DRF): campos obligatorios, tipos, rangos, choices, formato. No confíes en el payload.
- Reglas de negocio (presupuesto, transición de estado válida) van en el **service**, no en el serializer.
- Rechaza JSON malformado y campos desconocidos explícitamente. Valida rangos numéricos (`MinValueValidator`, `MaxValueValidator`) y longitudes.
- Nunca hagas `.get(**request.data)` ni pases datos crudos a `filter()`/`create()` sin validar.

```python
class RequestCreateSerializer(serializers.ModelSerializer):
    estimated_cost = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0"))
    class Meta:
        model = Request
        fields = ["title", "flow", "project", "estimated_cost", "items"]
    def validate(self, attrs):
        if attrs["flow"] == RQFlowChoices.OPERATIONS and not attrs.get("project"):
            raise serializers.ValidationError({"project": "Requerido para RQ de operaciones."})
        return attrs
```

## 5. Base de datos

- Toda escritura de más de un statement → `transaction.atomic()`.
- Lecturas-antes-de-escribir con concurrencia → `select_for_update()`.
- `OperationalError`/pérdida de conexión: reintenta SOLO operaciones idempotentes/de solo lectura, con backoff acotado (ver `retry` de Celery en la sección 6). Nunca reintentes a ciegas una escritura no idempotente.
- Configura timeouts (`OPTIONS: {"connect_timeout": ...}` y `statement_timeout` en Postgres) — no dejes queries colgadas indefinidamente.
- Usa `update_fields=[...]` en `.save()` para escrituras acotadas; `select_related`/`prefetch_related` para evitar N+1.

## 6. Tareas Celery / trabajo async

- `bind=True`, retries acotados con backoff y jitter, y `autoretry_for` SOLO en errores transitorios.
- Idempotencia obligatoria (la task puede ejecutarse más de una vez).
- Propaga el `correlation_id` en `headers`/`kwargs` para trazar la petición end-to-end.
- Agotados los reintentos → manda a **Dead Letter Queue** y alerta (ver `references/observabilidad.md`).

```python
@shared_task(bind=True, max_retries=5, default_retry_delay=10,
             autoretry_for=(OperationalError, ConnectionError), retry_backoff=True, retry_jitter=True)
def process_rq(self, rq_id, correlation_id=None):
    log = {"rq_id": rq_id, "correlation_id": correlation_id, "task_id": self.request.id,
           "retries": self.request.retries}
    try:
        RequestService.process(rq_id)
        logger.info("task.process_rq.ok", extra=log)
    except OperationalError:
        logger.warning("task.process_rq.retry", extra=log)
        raise                                   # autoretry se encarga
    except Exception:
        logger.exception("task.process_rq.failed", extra=log)
        send_to_dlq("process_rq", {"rq_id": rq_id}, correlation_id)   # no lo pierdas
        raise
```

## 7. Observabilidad y monitoreo (infra)

Para métricas (Prometheus), trazas (OpenTelemetry/Jaeger), correlation IDs por middleware, dashboards (Grafana/Datadog/CloudWatch), alertas y Dead Letter Queue: ver **`references/observabilidad.md`**. No inventes endpoints ni exporters sin confirmar la infra disponible con el usuario.

---

## Checklist antes de dar por terminado

Recórrelo y ver **`references/checklist.md`** para la versión detallada. En resumen, cada pieza de backend debe: capturar excepciones concretas + última barrera con `logger.exception`; envolver escrituras en `atomic()`; loguear con contexto (`request_id`, `correlation_id`, `user_id`); validar el payload en el serializer; ser idempotente si es reintentable; manejar timeouts/pérdida de conexión de BD; y, en async, tener retries acotados + DLQ.
