---
name: django-testing
description: Estándares de testing con pytest para el backend de SYSPCC. Úsalo al escribir o revisar tests de models, services, endpoints, workflow o permisos. Usa los fixtures de conftest.py, cubre ramas de error e idempotencia, y valida autorización. Dispara ante "test", "pytest", "prueba", "cobertura", "fixture", "conftest".
---

# Testing backend — SYSPCC (pytest)

Los tests viven en `backend/apps/<app>/tests/`. No hay `pytest.ini`: `DJANGO_SETTINGS_MODULE` sale del entorno.
- En Docker (entorno habitual; `.env.docker` define `DJANGO_SETTINGS_MODULE`): `docker compose exec -T backend pytest -q -p no:cacheprovider`.
- Local desde `backend/`: `DJANGO_SETTINGS_MODULE=config.settings.development pytest`, o un solo test `pytest apps/rq/tests/test_foo.py::TestClass::test_method` con la misma variable.

## Fixtures disponibles — úsalos, no recrees usuarios a mano
Globales (`backend/conftest.py`):
- `api_client` — cliente sin autenticar.
- `user` — usuario sin roles. `auth_client` — cliente autenticado (`force_authenticate`) con `user`.
- `superuser`, `other_superuser`, `staff_user`.
- `project`, `other_project`, `department`, `other_department` — datos base.
- Usuarios por rol: `requester`, `project_resident`, `project_control`, `general_manager`, `admin_manager`, `hr_manager`, `pasajes_manager`, `logistics_coordinator`, `site_warehouse`, `direct_supervisor`, `department_requester`, `other_requester`, `other_requester_same_project`, `other_department_requester`.

Por app: `apps/rq/tests/conftest.py` (`ops_request` en DRAFT de `requester`, `admin_request`, `foreign_request`, …), `apps/warehouse/tests/conftest.py` (`central_warehouse`, `logistics_chief`, `logistics_supervisor`, `make_item`, `epp_item`, `make_personal`, …) y `apps/hr/tests/conftest.py` (`hr_env`, `hr_client`, `active_template`, `no_real_anthropic`, `fake_provider`, …). Si necesitas un rol nuevo, añade el fixture en el `conftest.py` que corresponda, no inline.

## Qué DEBE cubrir cada pieza

**Services / workflow**: camino feliz + cada rama de error concreta.
- Transición legal → estado esperado.
- Transición ilegal → `WorkflowError`.
- Actor sin rol → `PermissionDeniedForAction`.
- Idempotencia: ejecutar la misma operación dos veces produce un solo efecto.
- Transiciones `(auto)` encadenadas ocurren.

**Endpoints**: por cada uno, autenticado feliz + no autenticado (401) + autenticado sin rol (403) + payload inválido (400).

**Serializers**: campos obligatorios, rangos, choices inválidos → error de validación.

## Patrones

```python
import pytest
from apps.core.enums import ApprovalActionChoices, RQStatusChoices, RoleChoices
from apps.core.exceptions import WorkflowError, PermissionDeniedForAction
from apps.rq.services.workflow_engine import WorkflowEngine

pytestmark = pytest.mark.django_db          # tests que tocan la BD


class TestWorkflowTransition:
    # ops_request (apps/rq/tests/conftest.py) es un RQ de OPERATIONS en DRAFT creado por `requester`
    def test_requester_submits_draft(self, ops_request, requester):
        WorkflowEngine(ops_request, requester, RoleChoices.REQUESTER).execute(
            action=ApprovalActionChoices.SUBMITTED)
        ops_request.refresh_from_db()        # execute() recarga el RQ con lock: refresca tu instancia
        assert ops_request.status == RQStatusChoices.SUBMITTED

    def test_illegal_transition_raises(self, ops_request, requester):
        with pytest.raises(WorkflowError):   # desde DRAFT no existe CLOSED
            WorkflowEngine(ops_request, requester, RoleChoices.REQUESTER).execute(
                action=ApprovalActionChoices.CLOSED)

    def test_wrong_role_denied(self, ops_request, project_resident):
        with pytest.raises(PermissionDeniedForAction):   # SUBMITTED exige REQUESTER
            WorkflowEngine(ops_request, project_resident, RoleChoices.PROJECT_RESIDENT).execute(
                action=ApprovalActionChoices.SUBMITTED)

    def test_submit_twice_is_rejected(self, ops_request, requester):
        engine = WorkflowEngine(ops_request, requester, RoleChoices.REQUESTER)
        engine.execute(action=ApprovalActionChoices.SUBMITTED)
        with pytest.raises(WorkflowError):   # ya no está en DRAFT
            WorkflowEngine(ops_request, requester, RoleChoices.REQUESTER).execute(
                action=ApprovalActionChoices.SUBMITTED)


class TestRequestEndpoint:
    # Las rutas de rq cuelgan de la raíz /api/v1/ (no hay prefijo rq/)
    def test_list_requires_auth(self, api_client):
        assert api_client.get('/api/v1/requests/').status_code == 401

    def test_requester_sees_only_own(self, api_client, requester, ops_request, foreign_request):
        api_client.force_authenticate(user=requester)
        resp = api_client.get('/api/v1/requests/')
        ids = [r['id'] for r in resp.data['results']]
        assert ops_request.id in ids and foreign_request.id not in ids
```

El flujo de gerencia además está protegido por `apps/rq/tests/test_workflow_snapshot.py` (snapshot literal de `TRANSITIONS` y enums): no lo regeneres desde el código; si falla, revierte el cambio de flujo salvo autorización escrita de gerencia.

## Reglas
- Marca `@pytest.mark.django_db` (o `pytestmark`) en lo que toque la BD.
- Un assert conceptual por test; nombres descriptivos `test_<qué>_<condición>_<resultado>`.
- No hits de red reales — mockea notificaciones/servicios externos.
- Usa `factory`/fixtures para datos, no `create()` repetido en cada test.
- Prueba el fallo, no solo el éxito. La cobertura de ramas de error es lo que evita incidentes en prod.
