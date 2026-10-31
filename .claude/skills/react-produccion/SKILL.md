---
name: react-produccion
description: Estándares de robustez para el frontend React de SYSPCC — manejo de errores, estados de carga/vacío/error, patrón de llamadas a la API con el cliente Axios y su interceptor 401, y rutas por rol. Úsalo al crear páginas, componentes, formularios o llamadas a la API. Dispara ante "componente", "página", "React", "fetch", "llamada API", "formulario", "estado de carga", "error boundary".
---

# React a producción — SYSPCC

Frontend en `frontend/src/`. Selector de módulos en `/` y seis shells: `AppShell` (`/rq/*`), `WarehouseShell` (`/almacen/*`), `AdminShell` (`/admin/*`), `SystemAdminShell` (`/sistema/*`), `SupportShell` (`/soporte/*`), `HRShell` (`/rrhh/*`). Estado con AuthContext + ToastContext + ThemeContext (sin Redux); tema claro/oscuro con la clase `.dark` en `<html>` y la variante `dark:` de Tailwind (`index.css`). Iconos Lucide.

## Llamadas a la API — usa el cliente, no `axios`/`fetch` directo

Toda petición pasa por los clientes de `frontend/src/api/` (`client.js` = instancia Axios con `withCredentials` + interceptor 401 con cola de refresh). Reglas:

1. **Nunca** llames `axios`/`fetch` directo en un componente. Importa la función del módulo `api/` correspondiente (`requests.js`, `almacen.js`, `hr.js`, etc.). Si no existe, créala ahí. Esas funciones devuelven la respuesta de Axios (`const { data } = await getRequests(params)`); las listas vienen paginadas (`data.results`, `data.count`).
2. El interceptor ya maneja el refresh del token en 401 (y adjunta el header CSRF al refresh) — **no** dupliques esa lógica ni redirijas a login desde el componente: si el refresh falla, los shells y guards (`AppShell`, `RoleRoute`, etc.) redirigen a `/login` según `isAuthenticated` de AuthContext.
3. **Todo llamado async tiene 3 estados en la UI**: `loading`, `error`, y `success/empty`. Nunca dejes una pantalla en blanco ni un spinner infinito.
4. **Muestra errores al usuario** vía ToastContext (`const { showToast } = useToast(); showToast({ type: 'error', message })`), con mensaje en español legible — nunca el error crudo de Axios.

```jsx
import { useState, useEffect } from 'react';
import { getRequests } from '../../api/requests';
import { useToast } from '../../context/ToastContext';

function MisRQsPage() {
  const [state, setState] = useState({ status: 'loading', rows: [] });
  const { showToast } = useToast();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await getRequests({ ordering: '-created_at' });
        if (alive) setState({ status: 'ready', rows: data.results ?? [] });
      } catch {
        if (alive) setState({ status: 'error', rows: [] });
        showToast({ type: 'error', message: 'No se pudieron cargar los RQs. Intenta de nuevo.' });
      }
    })();
    return () => { alive = false; };        // evita setState tras desmontar
  }, [showToast]);

  if (state.status === 'loading') return <p role="status">Cargando…</p>;
  if (state.status === 'error')   return <p role="alert">No se pudieron cargar los RQs.</p>;
  if (state.rows.length === 0)    return <p>No hay RQs todavía.</p>;
  return <RQTable rows={state.rows} />;
}
```

## Error Boundaries
- Hoy el frontend no tiene ningún Error Boundary. Si añades uno, envuelve los shells para mostrar una pantalla de fallo controlada en vez de romper toda la app.
- Un error en una tabla o widget no debe tumbar la página entera.

## Rutas por rol
- Páginas restringidas van dentro de `RoleRoute` (`requiredRoles`, `redirectTo`); `/sistema` usa `SuperUserRoute` (Django `is_superuser`). Esto es UX, **no seguridad** — el backend igual valida (ver skill `roles-y-permisos`).
- No muestres acciones (botones de aprobar/rechazar) que el rol del usuario no puede ejecutar.

## Formularios
- Validación en cliente para UX inmediata, pero **el backend es la autoridad**: muestra los errores 400 del backend mapeados por campo.
- Deshabilita el submit mientras la petición está en vuelo (evita doble envío → apoya la idempotencia del backend).
- Estados: pristine, submitting, error por campo, éxito.

## Rendimiento / calidad
- `useEffect` con cleanup y deps correctas; cancela o ignora respuestas tras desmontar.
- `React.memo`/`useMemo` solo donde haya un coste medible, no por defecto.
- Componentes funcionales + hooks. Reutiliza lo que existe antes de crear algo nuevo: `components/ui/` (`ConfirmModal`, `NotesField`, `NumberInput`, `PriorityBadge`, `StatusBadge`, `SummaryCard`, `ThemeToggleButton`) y, en almacén, `components/almacen/ui.jsx` (`LoadingBlock`, `ErrorBlock`, `EmptyBlock`, `Field`, `Pagination`, `PageHeader`, `Banner`, `Chip`, `Card`). No hay un `Spinner`/`DataTable` global: varias páginas definen su propio `LoadingSpinner` local.
- `npm run lint` debe pasar limpio.

## Checklist
- [ ] Llamadas vía módulos `api/`, no axios directo.
- [ ] Estados loading / error / empty / ready cubiertos.
- [ ] Errores mostrados vía toast en español.
- [ ] Cleanup en `useEffect`; sin setState tras desmontar.
- [ ] Submit deshabilitado durante la petición.
- [ ] Acciones ocultas según rol; sin depender del front para seguridad.
- [ ] Se ve bien en tema claro y oscuro.
- [ ] `npm run lint` limpio y `npm test` en verde.
