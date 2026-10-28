# Guía de Despliegue — Demo en Capa Gratuita (Supabase + Render + Vercel)

**Ticket:** SYSPCC-021 · **Fecha:** 2026-08-31

Esta guía despliega una demo funcional de SYSPCC usando únicamente planes gratuitos:

| Pieza | Servicio | Plan | Qué hospeda |
|---|---|---|---|
| Base de datos | Supabase | Free | PostgreSQL |
| Backend | Render | Free | Django + DRF (Docker, gunicorn) |
| Frontend | Vercel | Hobby (free) | React + Vite, y proxy hacia el backend |

```
Navegador ──HTTPS──▶ Vercel (https://<proyecto>.vercel.app)
                       ├── /            → SPA React (estáticos)
                       ├── /api/*   ────proxy───▶ Render (Django) ──SSL──▶ Supabase (PostgreSQL)
                       └── /media/* ────proxy───▶ Render (Django)
```

El truco central: **el navegador solo ve el dominio de Vercel**. Los rewrites de `frontend/vercel.json` reenvían `/api/*` y `/media/*` al backend en Render, así que las cookies JWT (`SameSite=Lax`, `Secure`, `HttpOnly`) y el CSRF double-submit funcionan igual que en producción, sin relajar nada.

---

## Requisitos previos

- Cuenta en [supabase.com](https://supabase.com), [render.com](https://render.com) y [vercel.com](https://vercel.com) (las tres permiten registrarse con GitHub).
- El repo en GitHub con este ticket ya mergeado a `develop` (Render y Vercel despliegan desde esa rama).
- Docker corriendo en tu máquina (solo para el paso del seed de datos).

---

## Paso 1 — Supabase: crear la base de datos

1. En el dashboard de Supabase: **New project**.
   - **Region:** elige una de EE. UU. del este (p. ej. *East US*), cercana a la región `ohio` que usa `render.yaml`.
   - **Database password:** genera una fuerte y **guárdala** — la necesitarás dos veces (Render y seed).
2. Cuando el proyecto termine de aprovisionarse, pulsa **Connect** (arriba) y busca la sección **Session pooler**. Anota:
   - `DB_HOST` → `aws-X-<region>.pooler.supabase.com`
   - `DB_PORT` → `5432`
   - `DB_USER` → `postgres.<ref-del-proyecto>` (el pooler incluye el ref en el usuario)
   - `DB_NAME` → `postgres`
   - `DB_PASSWORD` → la contraseña del punto 1.

> ⚠️ **Usa siempre el Session Pooler (puerto 5432).** El host directo `db.<ref>.supabase.co` solo resuelve por IPv6 y Render free no tiene salida IPv6: la conexión fallaría. El Transaction Pooler (puerto 6543) tampoco sirve aquí — Django necesita modo sesión.

---

## Paso 2 — Render: desplegar el backend

1. En el dashboard de Render: **New + → Blueprint**, conecta el repo y elige la rama `develop`. Render detecta `render.yaml` (raíz del repo) y propone el servicio `syspcc-demo-backend`.
2. Al crear el blueprint, Render pide los valores de las variables marcadas `sync: false`:
   - `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` → los del Paso 1.
   - `ALLOWED_HOSTS` → pon de momento `syspcc-demo-backend.onrender.com`; **después del primer deploy verifica la URL real** del servicio (Render puede añadir un sufijo, p. ej. `syspcc-demo-backend-x7k2.onrender.com`) y corrígela en **Environment** si difiere. Sin protocolo, solo el host.
   - `CSRF_TRUSTED_ORIGINS` → déjalo con un valor temporal cualquiera (p. ej. `https://localhost`); se completa en el Paso 3 cuando exista el proyecto de Vercel.
   - `SECRET_KEY` se genera sola (`generateValue: true`) — no la toques.
3. Lanza el deploy. El `dockerCommand` del blueprint ejecuta `migrate` + `collectstatic` + gunicorn en cada arranque, así que las migraciones contra Supabase se aplican solas.
4. Verifica: `https://<tu-servicio>.onrender.com/api/v1/` debe responder (un 401/403 JSON es señal de vida correcta; lo importante es que no sea un error de Render).

---

## Paso 3 — Vercel: desplegar el frontend

1. **Antes de importar**, edita `frontend/vercel.json` en el repo: reemplaza **las dos apariciones** de `https://syspcc-demo-backend.onrender.com` por la URL real de tu servicio de Render (Paso 2.4) — una en el rewrite de `/api/*` y otra en el de `/media/*`; si cambias solo una, la otra ruta queda rota en silencio. Commitea y mergea ese cambio a `develop` (es una edición trivial de configuración: según `CLAUDE.md` no requiere ticket ni rama propia).
2. En Vercel: **Add New → Project**, importa el repo.
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (lo detecta solo)
   - **Production Branch:** `develop` (en Settings → Git, si no lo ofrece al importar)
   - **Environment Variables:**
     | Nombre | Valor |
     |---|---|
     | `VITE_API_URL` | `/api/v1/` |
     | `VITE_BACKEND_URL` | (cadena vacía — crea la variable sin valor) |
3. Deploy. Anota tu dominio: `https://<proyecto>.vercel.app`.
4. Vuelve a Render → tu servicio → **Environment** y pon:
   - `CSRF_TRUSTED_ORIGINS` = `https://<proyecto>.vercel.app` (con esquema, sin barra final).
   - Guarda; Render redespliega solo.

> Las rutas relativas (`/api/v1/`, `VITE_BACKEND_URL` vacío) son las que activan el modo same-origin: todo el tráfico del navegador va al dominio de Vercel y los rewrites hacen el resto.

---

## Paso 4 — Sembrar datos de demo (desde tu máquina)

Render free no tiene shell, así que `seed_demo` se corre **localmente contra Supabase**, usando el contenedor de desarrollo. El guard de seguridad (`abort_if_production`) exige `DEBUG=true` explícito — en Render `DEBUG` nunca se define, así que el servicio desplegado jamás puede sembrarse a sí mismo.

```bash
# Desde la raíz del repo, con el stack local levantado:
docker compose exec \
  -e DJANGO_SETTINGS_MODULE=config.settings.demo \
  -e DEBUG=true \
  -e DB_NAME=postgres \
  -e DB_USER=postgres.<ref-del-proyecto> \
  -e DB_PASSWORD='<contraseña-de-supabase>' \
  -e DB_HOST=aws-X-<region>.pooler.supabase.com \
  -e DB_PORT=5432 \
  -e SEED_DEMO_PASSWORD='<contraseña-para-las-cuentas-demo>' \
  backend python manage.py seed_demo
```

Con eso quedan creados los usuarios demo (uno por rol del flujo) compartiendo la contraseña que definiste en `SEED_DEMO_PASSWORD`.

---

## Paso 5 — Probar la demo

1. Abre `https://<proyecto>.vercel.app`.
2. Inicia sesión con cualquiera de los usuarios demo y la contraseña del Paso 4.
3. Prueba el flujo completo: crear un RQ, aprobarlo con los distintos roles, etc.

> **Primer acceso lento (~1 min):** si el backend llevaba >15 min dormido, Render lo despierta con la primera petición. Es el comportamiento normal del plan free — abre la página, espera, y recarga.

### Verificación de seguridad posterior al deploy (recomendada antes de difundir el enlace)

El límite de intentos de login (5/min) depende de cómo el proxy de Render arma el header `X-Forwarded-For`, y ese comportamiento no está documentado oficialmente. Compruébalo contra tu propio servicio:

```bash
# 6 intentos fallidos seguidos, cada uno con un X-Forwarded-For falso distinto,
# directo contra la URL de Render (no la de Vercel):
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "intento $i -> HTTP %{http_code}\n" \
    -H "X-Forwarded-For: 10.0.0.$i" \
    -H "Content-Type: application/json" \
    -d '{"username":"noexiste","password":"incorrecta"}' \
    https://<tu-servicio>.onrender.com/api/v1/auth/login/
done
```

- **Esperado:** el sexto intento (o antes) responde `429`. El límite funciona: listo.
- **Si los 6 responden `400`/`401`/`403`:** el header falsificado está evadiendo el límite. No difundas la demo hasta ajustar la configuración del límite de intentos (repórtalo como ticket de seguridad).

---

## ⚠️ Solo datos ficticios

La demo es **pública** y sirve los archivos de `/media/` (firmas, adjuntos) **sin autenticación**, igual que el entorno de desarrollo. Úsala únicamente con los datos ficticios del seed: **nunca subas documentos reales** (cotizaciones verdaderas, firmas de personas reales, datos personales). Si necesitas mostrar el flujo de adjuntos, usa archivos de prueba inventados.

---

## Limitaciones del free tier (aceptadas para la demo)

- **Cold start:** el backend duerme tras 15 min sin tráfico; la primera petición tarda ~50 s.
- **Supabase pausa la BD tras 7 días sin uso.** Se reactiva con un clic en su dashboard.
- **Archivos subidos (media) son efímeros:** adjuntos y firmas se pierden en cada redespliegue o hibernación del servicio (el disco de Render free no persiste).
- **Sin tareas programadas:** no corre Celery beat, así que no hay recordatorios de SLA, alertas de stock bajo ni invalidación periódica de caché. Las tareas disparadas por acciones del usuario sí corren (en modo síncrono).
- **Límites de peticiones compartidos:** detrás del proxy de Vercel, el backend ve una sola IP de origen, así que los límites por IP (login 5/min, anónimos 30/min) se comparten entre **todos** los visitantes de la demo. Si dos personas fallan el login varias veces en el mismo minuto, el límite salta para ambas.
- **Emails:** no se envían; se imprimen en los logs del servicio en Render.

---

## Solución de problemas

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| `Bad Request (400)` en `/api/*` | `ALLOWED_HOSTS` no coincide con el host real de Render | Corrige la variable en Render → Environment con la URL exacta del servicio |
| `403 CSRF` al hacer login o guardar | `CSRF_TRUSTED_ORIGINS` no tiene el dominio de Vercel (o tiene barra final / le falta `https://`) | Formato exacto: `https://<proyecto>.vercel.app` |
| El backend no conecta a la BD (`could not translate host name` o timeout) | Estás usando el host directo `db.<ref>.supabase.co` (IPv6) | Cambia a los datos del **Session Pooler** (Paso 1.2) |
| Bucle infinito de redirects | Falta `SECURE_PROXY_SSL_HEADER` (solo si cambiaste el módulo de settings) | Confirma `DJANGO_SETTINGS_MODULE=config.settings.demo` en Render |
| La página carga pero toda llamada a la API va a `localhost:8000` | `VITE_API_URL`/`VITE_BACKEND_URL` mal configuradas en Vercel | Revisa el Paso 3.2 y redespliega el frontend (las env de Vite se fijan en build) |
| `/api/*` devuelve el HTML de la SPA | El rewrite del proxy no aplicó (placeholder sin reemplazar en `vercel.json`) | Paso 3.1: la URL de Render real debe estar commiteada en `frontend/vercel.json` |
| `seed_demo` aborta con error de producción | Falta `DEBUG=true` en el comando, o `DJANGO_ENV=production` en el entorno | Copia el comando del Paso 4 tal cual |
