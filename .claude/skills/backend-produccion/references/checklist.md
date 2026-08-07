# Checklist de revisión — backend a producción

Marca cada punto antes de dar por terminado un service/view/task. Si un punto no aplica, escríbelo explícitamente en el PR ("N/A: la task no escribe en BD").

## Manejo de errores
- [ ] No hay ningún `except Exception:` que trague el error sin loguear+re-lanzar.
- [ ] Se capturan tipos concretos: `IntegrityError`, `OperationalError`, `ValidationError`, `ObjectDoesNotExist`, excepciones de dominio.
- [ ] Última barrera `except Exception:` presente solo donde hace falta, con `logger.exception()` + `raise`.
- [ ] Escrituras multi-paso dentro de `transaction.atomic()` (rollback garantizado).
- [ ] Errores de infra (timeout, conexión) traducidos a algo accionable, no filtrados crudos al cliente.
- [ ] `IntegrityError` (UNIQUE/FK) manejado explícitamente donde puede ocurrir.

## Logging
- [ ] `logger = logging.getLogger(__name__)` por módulo.
- [ ] `logger.info` en hitos, `logger.warning` en errores esperados, `logger.exception` solo en `except` inesperados.
- [ ] Contexto vía `extra=`: `request_id`/`event_id`, `correlation_id`, `user_id`, `project_id`/`firm_id`.
- [ ] Sin PII, contraseñas ni tokens en los logs.
- [ ] Mensajes como claves estables y greppables.

## Idempotencia
- [ ] Operaciones reintentables tienen clave de idempotencia + constraint `UNIQUE`.
- [ ] Sin patrón "consulto y luego escribo" sin lock (`select_for_update`) o sin `UNIQUE`.
- [ ] Duplicados detectados y logueados, no procesados dos veces.

## Validaciones
- [ ] Payload validado en el serializer: obligatorios, tipos, rangos, choices, longitudes.
- [ ] Reglas de negocio en el service, no en el serializer.
- [ ] JSON malformado / campos desconocidos rechazados.
- [ ] Sin datos crudos del request pasados a `filter`/`create`/`get`.

## Base de datos
- [ ] Timeouts configurados (connect + statement).
- [ ] Retries solo en operaciones idempotentes/lectura, con backoff acotado.
- [ ] `select_related`/`prefetch_related` para evitar N+1.
- [ ] `update_fields` en saves acotados.

## Async / producción
- [ ] Tasks Celery con `max_retries`, backoff y `autoretry_for` solo en transitorios.
- [ ] Dead Letter Queue + alerta cuando se agotan los reintentos.
- [ ] `correlation_id` propagado a la task.
- [ ] Métricas de éxito/error emitidas (o TODO explícito con ticket).

## Tests
- [ ] Test del camino feliz.
- [ ] Test de cada rama de error concreta (integridad, no encontrado, workflow inválido).
- [ ] Test de idempotencia (misma operación dos veces → un solo efecto).
