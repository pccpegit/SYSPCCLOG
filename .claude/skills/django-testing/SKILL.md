---
name: django-testing
description: Estándares de testing con pytest para el backend de SYSPCC. Úsalo al escribir o revisar tests de models, services, endpoints, workflow o permisos. Usa los fixtures de conftest.py, cubre ramas de error e idempotencia, y valida autorización. Dispara ante "test", "pytest", "prueba", "cobertura", "fixture", "conftest".
---

# Testing backend — SYSPCC (pytest)

Ejecuta desde `backend/`: `pytest`, o un solo test `pytest tests/test_foo.py::TestClass::test_method`.

## Fixtures disponibles (`conftest.py`) — úsalos, no recrees usuarios a mano
- `api_client` — cliente sin autenticar.
- `user` — usuario sin roles.
- `auth_client` — cliente autenticado con `user`.
- `project`, `department` — datos base.
- Usuarios por rol: `requester`, `project_resident`, `general_manager`, etc. Si necesitas un rol nuevo, añade el fixture en `conftest.py`, no inline.

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
from apps.core.exceptions import WorkflowError, PermissionDeniedForAction
from apps.rq.services.workflow_engine import WorkflowEngine

pytestmark = pytest.mark.django_db          # tests que tocan la BD


class TestWorkflowTransition:
    def test_resident_approves_moves_to_technical_approved(self, submitted_ops_request, project_resident):
        rq = WorkflowEngine.apply(submitted_ops_request.id, 'approve_technical', project_resident)
        assert rq.status == 'TECHNICAL_APPROVED'

    def test_illegal_transition_raises(self, submitted_ops_request, project_resident):
        with pytest.raises(WorkflowError):
            WorkflowEngine.apply(submitted_ops_request.id, 'close', project_resident)

    def test_wrong_role_denied(self, submitted_ops_request, requester):
        with pytest.raises(PermissionDeniedForAction):
            WorkflowEngine.apply(submitted_ops_request.id, 'approve_technical', requester)

    def test_idempotent_submit(self, draft_request, requester):
        WorkflowEngine.apply(draft_request.id, 'submit', requester)
        with pytest.raises(WorkflowError):        # ya no está en DRAFT
            WorkflowEngine.apply(draft_request.id, 'submit', requester)


class TestRequestEndpoint:
    def test_list_requires_auth(self, api_client):
        assert api_client.get('/api/v1/rq/requests/').status_code == 401

    def test_requester_sees_only_own(self, auth_client, requester_request, other_request):
        resp = auth_client.get('/api/v1/rq/requests/')
        ids = [r['id'] for r in resp.data['results']]
        assert requester_request.id in ids and other_request.id not in ids
```

## Reglas
- Marca `@pytest.mark.django_db` (o `pytestmark`) en lo que toque la BD.
- Un assert conceptual por test; nombres descriptivos `test_<qué>_<condición>_<resultado>`.
- No hits de red reales — mockea notificaciones/servicios externos.
- Usa `factory`/fixtures para datos, no `create()` repetido en cada test.
- Prueba el fallo, no solo el éxito. La cobertura de ramas de error es lo que evita incidentes en prod.
