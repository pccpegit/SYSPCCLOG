---
name: react-produccion
description: Estándares de robustez para el frontend React de SYSPCC — manejo de errores, estados de carga/vacío/error, patrón de llamadas a la API con el cliente Axios y su interceptor 401, y rutas por rol. Úsalo al crear páginas, componentes, formularios o llamadas a la API. Dispara ante "componente", "página", "React", "fetch", "llamada API", "formulario", "estado de carga", "error boundary".
---

# React a producción — SYSPCC

Frontend en `frontend/src/`. Tres shells: `AppShell` (`/rq/*`), `WarehouseShell` (`/almacen/*`), `AdminShell` (`/admin/*`). Estado con AuthContext + ToastContext (sin Redux). Iconos Lucide.

## Llamadas a la API — usa el cliente, no `axios`/`fetch` directo

Toda petición pasa por los clientes de `frontend/src/api/` (`client.js` = instancia Axios con `withCredentials` + interceptor 401 con cola de refresh). Reglas:

1. **Nunca** llames `axios`/`fetch` directo en un componente. Importa la función del módulo `api/` correspondiente (`requests.js`, `warehouse.js`, etc.). Si no existe, créala ahí.
2. El interceptor ya maneja el refresh del token en 401 — **no** dupliques esa lógica ni redirijas a login desde el componente (lo hace AuthContext).
3. **Todo llamado async tiene 3 estados en la UI**: `loading`, `error`, y `success/empty`. Nunca dejes una pantalla en blanco ni un spinner infinito.
4. **Muestra errores al usuario** vía ToastContext, con mensaje en español legible — nunca el error crudo de Axios.

```jsx
import { useState, useEffect } from 'react';
import { listRequests } from '../api/requests';
import { useToast } from '../context/ToastContext';

function RequestsPage() {
  const [state, setState] = useState({ status: 'loading', data: [] });
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await listRequests();
        if (alive) setState({ status: 'ready', data });
      } catch (err) {
        if (alive) setState({ status: 'error', data: [] });
        toast.error('No se pudieron cargar los RQs. Intenta de nuevo.');
      }
    })();
    return () => { alive = false; };        // evita setState tras desmontar
  }, []);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error')   return <ErrorState onRetry={() => window.location.reload()} />;
  if (state.data.length === 0)    return <EmptyState message="No hay RQs todavía." />;
  return <RequestsTable rows={state.data} />;
}
```

## Error Boundaries
- Envuelve cada shell (`AppShell`, `WarehouseShell`, `AdminShell`) en un Error Boundary que muestre una pantalla de fallo controlada en vez de romper toda la app.
- Un error en una tabla o widget no debe tumbar la página entera.

## Rutas por rol
- Páginas restringidas van dentro de `RoleRoute`. Esto es UX, **no seguridad** — el backend igual valida (ver skill `roles-y-permisos`).
- No muestres acciones (botones de aprobar/rechazar) que el rol del usuario no puede ejecutar.

## Formularios
- Validación en cliente para UX inmediata, pero **el backend es la autoridad**: muestra los errores 400 del backend mapeados por campo.
- Deshabilita el submit mientras la petición está en vuelo (evita doble envío → apoya la idempotencia del backend).
- Estados: pristine, submitting, error por campo, éxito.

## Rendimiento / calidad
- `useEffect` con cleanup y deps correctas; cancela o ignora respuestas tras desmontar.
- `React.memo`/`useMemo` solo donde haya un coste medible, no por defecto.
- Componentes funcionales + hooks. Componentes reutilizables (`Spinner`, `EmptyState`, `ErrorState`, `DataTable`) — no reinventes.
- `npm run lint` debe pasar limpio.

## Checklist
- [ ] Llamadas vía módulos `api/`, no axios directo.
- [ ] Estados loading / error / empty / ready cubiertos.
- [ ] Errores mostrados vía toast en español.
- [ ] Cleanup en `useEffect`; sin setState tras desmontar.
- [ ] Submit deshabilitado durante la petición.
- [ ] Acciones ocultas según rol; sin depender del front para seguridad.
- [ ] `npm run lint` limpio.
