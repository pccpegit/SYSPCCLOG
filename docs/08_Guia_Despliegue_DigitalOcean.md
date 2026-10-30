# Guía de Despliegue — SYSPCC en DigitalOcean App Platform

**Tickets:** SYSPCC-024 (spec inicial) y SYSPCC-033 (opción Optimizada) | **Fecha:** 29 de octubre de 2026 | **Región:** NYC (Nueva York)

Esta guía explica cómo publicar SYSPCC en **DigitalOcean App Platform** usando el spec `.do/app.yaml` del repositorio, cuánto cuesta de verdad, qué debes hacer tú (cuenta, pago, tokens) y, sobre todo, **cómo destruir todo para dejar de pagar**.

> **Estado actual:** el código y el spec están preparados para la **opción Optimizada** (US$97.15 al mes), pero **no se creó ningún recurso en DigitalOcean**. Nada de lo que está aquí se cobra hasta que ejecutes el Paso 9. El spec ya cubre todo lo agregado hasta SYSPCC-032 (almacén con importación del libro, vínculo RQ↔catálogo, despacho real, entregas parciales, Master de RQ, borradores, egresos sin destino, análisis de CVs).

Complementa a `docs/05_Guia_Despliegue_y_Produccion.md` (servidor propio con Nginx). Es el único entorno de producción desplegado: la demo gratuita de Render + Supabase + Vercel (SYSPCC-021) se retiró del repositorio en SYSPCC-039.

---

## Tabla de contenidos

1. [Costos reales (léelo primero)](#1-costos-reales-léelo-primero)
2. [Qué se despliega](#2-qué-se-despliega)
3. [Lo que tienes que hacer tú](#3-lo-que-tienes-que-hacer-tú)
4. [Paso 1 — Cuenta, medio de pago y alertas de facturación](#paso-1--cuenta-medio-de-pago-y-alertas-de-facturación)
5. [Paso 2 — Conectar GitHub (cuenta pccpegit)](#paso-2--conectar-github-cuenta-pccpegit)
6. [Paso 3 — Token y doctl](#paso-3--token-y-doctl)
7. [Paso 4 — Spaces: buckets y llave de acceso](#paso-4--spaces-buckets-y-llave-de-acceso)
8. [Paso 5 — Cluster PostgreSQL, pool de conexiones y CA](#paso-5--cluster-postgresql-pool-de-conexiones-y-ca)
9. [Paso 6 — Cluster Valkey gestionado](#paso-6--cluster-valkey-gestionado)
10. [Paso 7 — Verificar la rama de despliegue (main)](#paso-7--verificar-la-rama-de-despliegue-main)
11. [Paso 8 — Preparar los secretos (.env.do)](#paso-8--preparar-los-secretos-envdo)
12. [Paso 9 — Crear la app](#paso-9--crear-la-app)
13. [Paso 10 — Verificar el despliegue](#paso-10--verificar-el-despliegue)
14. [Paso 11 — Superusuario y primeros datos](#paso-11--superusuario-y-primeros-datos)
15. [Paso 12 — Lista de verificación previa a datos reales](#paso-12--lista-de-verificación-previa-a-datos-reales)
16. [Operación diaria](#operación-diaria)
17. [Variantes y cambios de nivel](#variantes-y-cambios-de-nivel)
18. [Destruir todo para no pagar](#destruir-todo-para-no-pagar)
19. [Solución de problemas](#solución-de-problemas)
20. [Limitaciones aceptadas](#limitaciones-aceptadas)
21. [Variables de entorno](#variables-de-entorno)
22. [Fuentes](#fuentes)

---

## 1. Costos reales (léelo primero)

### 1.1 El crédito de bienvenida NO es de US$200

Los informes internos mencionan que DigitalOcean "suele ofrecer un crédito de bienvenida de US$200". **Eso ya no es lo que ofrece hoy.** A fecha de esta guía, la página oficial de precios dice que las cuentas nuevas reciben **US$5 de crédito, válidos por 90 días**.

- Verifica el monto real en **Billing → Credits** (o Facturación → Créditos) apenas crees la cuenta, **antes** de crear recursos.
- Si esperabas US$200 por un código de referido, el GitHub Student Pack u otra promoción, aplícalo o pídelo a soporte antes de empezar.
- Con US$5 no se sostiene la opción Optimizada: a US$0.133 por hora alcanza para **unas 37 horas (día y medio)**. Ese cálculo es optimista: el almacén de archivos (Spaces) cobra **US$5 al mes** desde que existe un bucket, así que en la práctica el crédito rinde menos.
- **DigitalOcean no apaga los recursos cuando se acaba el crédito: sigue cobrando a la tarjeta** hasta que los destruyas (ver [Destruir todo](#destruir-todo-para-no-pagar)).

### 1.2 Comparativo de escenarios

Antes de la tabla, cinco palabras que se repiten:

- **Servidor de aplicación:** el programa que atiende a los usuarios cuando abren SYSPCC en el navegador.
- **Procesos automáticos:** los programas que trabajan en segundo plano sin que nadie los pida (recordatorios, alertas de stock, análisis de CVs).
- **Cola y caché:** memoria compartida que usan los procesos automáticos para coordinarse. **Efímera** significa que se borra cada vez que el servicio se reinicia o se vuelve a desplegar; **gestionada** significa que DigitalOcean la opera, la respalda y no se borra al desplegar.
- **Spaces:** el almacén de archivos en la nube (firmas, adjuntos, contratos). Se cobra aparte, aunque casi no se use.
- **Redespliegue:** publicar de nuevo la aplicación (ocurre con cada actualización del código).

> **Ojo con el nombre "Estándar":** hay dos opciones distintas con ese nombre. El **Estándar de esta tabla (US$55.15 al mes)** viene del informe interno de costos de infraestructura. El informe a Gerencia del 27/10/2026 también llama "Estándar" a una opción de unos US$140; **no es la misma**. Ambos documentos son internos y no están en este repositorio. Por eso la tabla nombra siempre la fuente.

Precios mensuales en US$, sin IGV (DigitalOcean factura desde el extranjero; consulta a Contabilidad el tratamiento tributario). Precios de App Platform verificados el 29/10/2026.

| Componente | Prueba (spec anterior, SYSPCC-024) | Estándar (informe interno de costos) | **Optimizada (este spec, SYSPCC-033)** | Propuesto (informe interno de costos) |
|---|---|---|---|---|
| Servidor de aplicación | 10.00 | 10.00 | **50.00** (compartido, 2 vCPU / 4 GB) | 78.00 (dedicado) |
| Procesos automáticos | 5.00 | 10.00 | **12.00** (uno: tareas generales y CVs) | 10.00 |
| Base de datos PostgreSQL gestionada | 15.15 (1 GB) | 15.15 (1 GB) | **15.15** (1 GB) | 15.15 (1 GB) |
| Cola y caché | 5.00 (propia de la app, efímera) | 15.00 (gestionada, 1 GB) | **15.00** (gestionada, 1 GB) | 15.00 (gestionada, 1 GB) |
| Almacén de archivos (Spaces) | 5.00 | 5.00 | **5.00** | 5.00 |
| Portal web (lo que se ve en el navegador) | 0.00 | 0.00 | **0.00** | 0.00 |
| **Total mensual** | **40.15** | **55.15** | **97.15** | **123.15** |
| Total por hora (÷ 730) | 0.055 | 0.076 | 0.133 | 0.169 |
| Respaldos de la base de datos | Sí | Sí | Sí | Sí |
| La cola sobrevive a un redespliegue | No | Sí | Sí | Sí |

Notas:

- La columna **Optimizada** es la que describe `.do/app.yaml` desde SYSPCC-033. Es exactamente la opción Optimizada del informe a Gerencia del 27/10/2026: servidor US$50 + base US$15.15 + un proceso automático US$12 + cola y caché US$15 + archivos US$5 = **US$97.15**. Un proceso automático separado para los CVs (+US$12 = US$109.15) queda como mejora opcional (ver 1.3).
- Planes de App Platform de cada columna: Prueba `apps-s-1vcpu-1gb-fixed` + `apps-s-1vcpu-0.5gb`; Estándar `apps-s-1vcpu-1gb-fixed` (ambos); **Optimizada `apps-s-2vcpu-4gb` + `apps-s-1vcpu-1gb`**; Propuesto `apps-d-2vcpu-4gb` + `apps-s-1vcpu-1gb-fixed`. La cola y caché gestionada es Valkey (compatible con Redis).
- La columna **Prueba** ya no la describe ningún archivo: `.do/app.yaml` pasó a la Optimizada. Se conserva como referencia de lo que costaba el stack mínimo.
- Se usa la base PostgreSQL gestionada (no la "Dev Database" de US$7) porque esta última no concede permisos de creación sobre el schema `public` en PostgreSQL 15+ y el `migrate` del primer despliegue falla.
- El job `migrate` (que prepara la base de datos antes de cada despliegue) se factura por segundo solo mientras corre: centavos por despliegue.
- El portal web dentro de una app de pago cuesta US$0. Spaces cobra US$5/mes por 250 GB mientras exista al menos un bucket.
- **No incluido:** IGV, el consumo del API de Anthropic (asistente y análisis de CVs; se paga por uso o con créditos, ver el [Paso 12](#paso-12--lista-de-verificación-previa-a-datos-reales)), transferencia que exceda lo incluido y un dominio propio.
- Los precios salen de las listas oficiales de DigitalOcean (App Platform, Managed Databases, Spaces). Confírmalos en el panel antes de contratar: pueden variar.

### 1.3 La opción Optimizada al detalle

| Componente | Plan | Capacidad | Mensual (US$) | Anual (US$) | Para qué |
|---|---|---|---|---|---|
| `backend` | `apps-s-2vcpu-4gb` | 2 vCPU compartidas, 4 GiB | 50.00 | 600.00 | API Django con gunicorn 4 procesos × 4 hilos (16 peticiones en paralelo), LibreOffice, importación del libro del almacén |
| `worker` | `apps-s-1vcpu-1gb` | 1 vCPU, 1 GiB | 12.00 | 144.00 | Colas `celery` y `hr_cv` (2 procesos) + el programador de tareas (beat) |
| PostgreSQL gestionado | `db-s-1vcpu-1gb`, 1 nodo | 1 GiB | 15.15 | 181.80 | Base de datos (con pool de conexiones PgBouncer incluido, sin costo extra) |
| Valkey gestionado | `db-s-1vcpu-1gb`, 1 nodo | 1 GiB | 15.00 | 180.00 | Cola de tareas, resultados, caché, sesiones del panel y contadores anti-fuerza-bruta |
| Spaces | 250 GB incluidos | — | 5.00 | 60.00 | Firmas, adjuntos y archivos de RR. HH. (dos buckets) |
| `frontend` | sitio estático | — | 0.00 | 0.00 | SPA React |
| `migrate` | job `PRE_DEPLOY`, `apps-s-1vcpu-0.5gb` | — | centavos | centavos | `migrate` + `seed_data` antes de cada despliegue (por segundo) |
| **Total** | | | **97.15** | **1,165.80** | |

Comando del worker (un solo contenedor, `instance_count: 1`, **no escalar**):

```
celery -A config worker -B -Q celery,hr_cv -c 2 -O fair --prefetch-multiplier 1 --max-tasks-per-child 100 --scheduler django_celery_beat.schedulers:DatabaseScheduler -l info
```

`-O fair` y `--prefetch-multiplier 1` hacen que un proceso reciba una tarea nueva solo cuando se libera (un CV de 2 minutos no retiene tareas cortas detrás); `--max-tasks-per-child 100` recicla el proceso para contener la fragmentación de memoria. Las opciones existen en Celery 5.4 (la versión de `requirements.txt`) y una prueba automática lo comprueba; el prefetch va en la línea de comando porque el código no define `CELERY_WORKER_PREFETCH_MULTIPLIER`.

Variantes (se eligen con el spec vivo, ver [Variantes y cambios de nivel](#variantes-y-cambios-de-nivel)):

| Variante | Qué cambia | Mensual | Anual |
|---|---|---|---|
| **Optimizada (este spec)** | Un solo worker para `celery` y `hr_cv` | **97.15** | **1,165.80** |
| Mejora opcional: worker de CVs separado | `worker` solo `celery` + beat; nuevo `worker-hr` (`apps-s-1vcpu-1gb`, `-Q hr_cv`) | 109.15 | 1,309.80 |

**Cuándo conviene separar los CVs (+US$12):** mientras corre un lote de CVs, dos análisis a la vez (llamadas largas al API, hasta 180 s cada una) ocupan los **dos** procesos del worker y retrasan lo que esté en la cola `celery` (chequeo de SLA de las 8 AM, recordatorios de aprobación, alertas de stock, PDF de despachos) hasta que termine alguno. Si notas recordatorios o alertas que llegan tarde en los días de carga de CVs, pasa a la variante de 109.15. También aísla los reinicios por memoria: un OOM de CVs reiniciaría solo `worker-hr` y no el beat.

**Memoria del worker único (1 GiB, 2 procesos).** Medición con imágenes sintéticas (`cv_text.image_b64`, el paso que decodifica una imagen de CV), sobre ~160 MB de base por proceso de Django + Celery + Anthropic:

| Imagen | Memoria extra al decodificar (por proceso) |
|---|---|
| JPEG 12 Mpx | ~96 MB |
| JPEG 16 Mpx | ~114 MB |
| PNG con transparencia 16 Mpx | ~175 MB |
| JPEG 40 Mpx | ~277 MB |
| PNG con transparencia 40 Mpx | ~421 MB |

El límite actual `HR_CV_MAX_IMAGE_PIXELS` es de **40 millones** de píxeles. En el peor caso, dos procesos con una imagen así a la vez suman unos 840 MB sobre ~500 MB de base: más de 1 GiB, y el contenedor se reiniciaría (con él, beat). Los PDF y Word no tienen este problema (el límite de 10 MB por archivo y las 20 páginas lo acotan). Por eso el spec fija `HR_CV_MAX_IMAGE_PIXELS=16000000` (cubre fotos de 16 MP, el tamaño de un celular actual, y escaneos): el peor caso baja a ~350 MB para dos procesos y cabe con holgura. Son mediciones en macOS con imágenes de ruido (el peor caso de compresión), no en el contenedor de DigitalOcean: úsalas como orden de magnitud.

### 1.4 Qué hacer si solo es una prueba

| Camino | Costo | Cuándo |
|---|---|---|
| (a) Destruir todo **dentro de ~1 día** | El crédito de US$5 casi cubre el gasto | Solo querías ver el despliegue funcionar |
| (b) Mantener el stack | **~US$3.20 por día** (US$97.15 al mes) | Producción real o pruebas largas |
| (c) Bajar de nivel | Ver [Variantes y cambios de nivel](#variantes-y-cambios-de-nivel) | Reducir costo mientras no haya carga |

**Si pasas de ~1 día, o si olvidas borrar algo, DigitalOcean cobra a tu tarjeta.** Recuerda que Spaces cobra US$5 al mes aunque lo uses poco, y que borrar la app no borra las bases de datos ni los buckets (ver [Destruir todo](#destruir-todo-para-no-pagar)).

---

## 2. Qué se despliega

Todo vive en **una sola app** (`syspcc`) con un único dominio `*.ondigitalocean.app`, de modo que la SPA y `/api` comparten origen (las cookies JWT son `SameSite=Lax` y el CSRF usa doble envío).

| Componente | Tipo | Función | Tamaño |
|---|---|---|---|
| `frontend` | static site | SPA React 19 + Vite 7 (`npm run build`, carpeta `dist`) | gratis |
| `backend` | service | Django + gunicorn (`scripts/do-start.sh`), puerto 8080, LibreOffice incluido. 4 procesos × 4 hilos | `apps-s-2vcpu-4gb` |
| `worker` | worker | Celery colas `celery` (SLA, recordatorios, caché, stock bajo, PDF de despachos, purga de importaciones) y `hr_cv` (análisis de CVs y su recuperación), 2 procesos, con **beat embebido** (`-B`) | `apps-s-1vcpu-1gb` |
| `migrate` | job `PRE_DEPLOY` | `scripts/do-predeploy.sh`: `migrate` + `seed_data` antes de cada despliegue; conexión directa al cluster | `apps-s-1vcpu-0.5gb` |
| `db` | base de datos | Cluster Managed PostgreSQL 16 `syspcc-pg` (se crea aparte, el spec lo adjunta) + pool `syspccpool` | 1 GB |
| `cache` | base de datos | Cluster Managed Valkey `syspcc-valkey` (broker, resultados, caché, sesiones del admin, throttling); TLS verificado | 1 GB |
| Spaces | externo | `syspcc-media` (firmas, adjuntos, libros importados) y `syspcc-hr-private` (contratos, plantillas, CVs; datos personales) | 250 GB |

Enrutamiento (ingress): `/api`, `/mgmt-panel` y `/static` van al `backend` conservando el prefijo (`preserve_path_prefix: true`; sin eso Django recibiría `/v1/...` y respondería 404). Todo lo demás (`/`) va a la SPA, con `catchall_document: index.html` para que funcionen los enlaces profundos de React Router. Todo lo agregado en SYSPCC-025 a 032 (importación del almacén, Master de RQ, entregas parciales, borradores) cuelga de `/api/v1/`: **no hay rutas nuevas que publicar**. `/healthz` y `/media` **no se publican** a propósito: el healthcheck de la plataforma llega directo al componente (no pasa por el ingress) y exponerlo en Internet permitiría a cualquiera consumir conexiones de la base de datos; `/media` no lo sirve Django en producción (los archivos salen de Spaces con URLs firmadas).

Decisiones de diseño que conviene conocer:

- **IP del cliente:** el ingress de DigitalOcean escribe su propia IP en `X-Forwarded-For`; la del usuario llega en `do-connecting-ip`. Con `TRUST_DO_CONNECTING_IP=True` el backend usa esa cabecera (si llegara como lista separada por comas, toma la entrada **de más a la derecha**, la que escribe el ingress) y los límites de intentos son por usuario real, no compartidos por toda la empresa. **No definas `NUM_PROXIES`** en este archivo de configuración. Esto asume que el ingress **sobrescribe** la cabecera que envíe el cliente: es una hipótesis que se comprueba **obligatoriamente** en el [Paso 10](#paso-10--verificar-el-despliegue) (prueba de humo de seguridad).
- **Límites de login:** 5 intentos/min por IP **y** 10 intentos/min por nombre de usuario. El segundo límite protege cada cuenta aunque un atacante rote su IP o `do-connecting-ip` no se comportara como se espera. Contrapartida aceptada: quien conozca un usuario puede bloquearlo 1 minuto a la vez.
- **Valkey y límites de intentos:** los contadores de límites viven en Valkey, **compartidos y exactos entre los 4 procesos de gunicorn**. Por eso el spec fija `DJANGO_REDIS_IGNORE_EXCEPTIONS=False`: si Valkey cae, la API responde 5xx hasta que vuelva (**falla cerrada**) en lugar de degradar. Con `True` la caché degradaría pero los límites pasarían a una caché local de cada proceso (`THROTTLE_CACHE_ALIAS=throttle`), es decir, **4 veces más permisivos** (20 intentos/min por IP en vez de 5). Valkey es persistente, autenticado y gestionado, así que se prioriza la seguridad sobre la disponibilidad durante una caída. La cuota diaria del asistente de RR. HH. también falla cerrada.
- **Pool de conexiones:** `backend` y `worker` se conectan al **pool de PgBouncer** (`syspccpool`, modo *transaction*, tamaño 15) y no al servidor directo. Un cluster de 1 GB admite ~22 conexiones y solo los hilos de gunicorn (16) más Celery ya rozan ese límite, sin contar que durante un despliegue conviven la versión vieja y la nueva. Con el pool, las ~19 conexiones de cliente (el doble durante un despliegue) comparten 15 reales. El job `migrate` entra **directo** (DDL y bloqueos que PgBouncer en modo transaction no garantiza). `DB_DISABLE_SERVER_SIDE_CURSORS=True` evita los cursores del servidor, que no sobreviven en ese modo.
- **TLS verificado:** PostgreSQL con `DB_SSLMODE=verify-ca` y `DB_CA_CERT=${db.CA_CERT}`; Valkey con `rediss://` + `REDIS_CA_CERT=${cache.CA_CERT}` y `REDIS_SSL_CERT_REQS=required`. Si el CA no es un PEM válido el contenedor aborta el arranque (no degrada en silencio).
- **Dimensionado del backend (2 vCPU / 4 GB):** `GUNICORN_WORKERS=4`, `GUNICORN_THREADS=4`, `GUNICORN_TIMEOUT=120`, que `scripts/do-start.sh` lee. Cuatro procesos con ~200 MB cada uno dejan más de 2 GB libres para los picos de LibreOffice (contratos a PDF) y de openpyxl (importar el libro del almacén). El script además recicla cada proceso tras ~1000 peticiones (`--max-requests`) para contener fugas lentas de memoria.
- **Beat único:** el programador de tareas va embebido (`-B`) en el único `worker`; no escalar `worker` a más de 1 instancia (los recordatorios saldrían repetidos). Una prueba automática (`test_do_app_spec.py`) lo verifica y comprueba que cada cola a la que el código enruta tareas (`celery`, `hr_cv`) tiene un consumidor. Separar beat en su propio proceso (0.5 GB, +US$5) sería más a prueba de errores si alguien escala por descuido; no se hizo porque la cola general es liviana y el costo no lo justifica hoy.
- **Secretos por componente (mínimo privilegio):** el job `migrate` solo recibe `SECRET_KEY` y `DB_*`. `worker` recibe las llaves de Spaces (media y RR. HH.), `ANTHROPIC_API_KEY` (los CVs corren ahí), OneDrive y correo; `RUC_API_TOKEN` solo lo recibe `backend`. Se recomienda **dos llaves de Spaces** (media vs. RR. HH.): si se filtra la de media no se expone el bucket de datos personales.
- **Análisis de CVs:** `HR_CV_PROVIDER=anthropic` y `HR_CV_DISPATCH=celery` quedan fijos. El proveedor simulado (`fake`) está prohibido en producción: si alguien lo define, el backend **no arranca**.
- **Archivos:** el disco de los contenedores es efímero y no se comparte entre componentes. Por eso media (incluidos los libros del almacén en vista previa) va a Spaces con URLs firmadas (1 hora) y los archivos de RR. HH. a un bucket distinto con URLs de 60 segundos.
- **Estáticos del admin:** WhiteNoise sirve `/static`; `collectstatic` corre al arrancar el contenedor (en el build no existen `SECRET_KEY` ni `DB_*`).
- **Healthcheck:** `/healthz/` responde `200` si la BD contesta `SELECT 1` y `503` si no; contesta antes de la validación de `ALLOWED_HOSTS` y del redireccionamiento SSL.
- **Correo:** sin `EMAIL_HOST_PASSWORD` los correos van a los logs en lugar de fallar cada día con un error SMTP.
- **Datos de referencia:** `seed_data` (tipos de adquisición y pasos del workflow) corre en cada despliegue; es idempotente y no crea usuarios. `seed_demo` está bloqueado en producción a propósito.
- **Tareas programadas (beat):** SLA (8:00), recordatorios de aprobación (9:00 y 14:00), invalidación de caché (cada 15 min), alertas de stock bajo (7:30), purga de importaciones del almacén vencidas (3:00) y recuperación de CVs atascados (cada 5 min, en la cola `hr_cv`). Hora de Lima. Se cargan solas desde `CELERY_BEAT_SCHEDULE` al arrancar `worker`.

---

## 3. Lo que tienes que hacer tú

El código y el spec ya están preparados; lo siguiente **solo lo puedes hacer tú** (requiere tu identidad, tu tarjeta o tus tokens):

- [ ] Crear la cuenta de DigitalOcean y registrar un medio de pago.
- [ ] Verificar el crédito real en Billing → Credits.
- [ ] Crear alertas de facturación en US$5, US$60 y US$110 (la última avisa si el gasto del mes pasa de lo previsto).
- [ ] Autorizar la GitHub App de DigitalOcean sobre la organización `pccpegit` (repo `SYSPCCLOG`).
- [ ] Crear un token de API y ejecutar `doctl auth init` en tu terminal (**no lo compartas en el chat**).
- [ ] Crear los dos buckets de Spaces y las llaves de acceso.
- [ ] Crear el cluster PostgreSQL `syspcc-pg`, su pool `syspccpool` y restringir sus trusted sources.
- [ ] Crear el cluster Valkey `syspcc-valkey` y restringir sus trusted sources.
- [x] SYSPCC-024 está en `main` desde la v1.0.0; el spec despliega desde `main` (GitFlow, SYSPCC-038).
- [ ] Generar y guardar los secretos en `.env.do` (archivo local, fuera de git).
- [ ] Ejecutar `doctl apps create` y, tras el primer despliegue, `createsuperuser`.
- [ ] Completar la [lista de verificación previa a datos reales](#paso-12--lista-de-verificación-previa-a-datos-reales) antes de dar acceso a usuarios.
- [ ] Si es solo una prueba, **destruir los recursos** al terminar o decidir a qué nivel quedarte.

---

## Paso 1 — Cuenta, medio de pago y alertas de facturación

1. Crea la cuenta en <https://cloud.digitalocean.com> y registra una tarjeta (también se aceptan PayPal, Google Pay o Apple Pay). Sin medio de pago no se pueden crear recursos. Las cuentas nuevas pueden pasar por verificación o tener límites iniciales de recursos.
2. Ve a **Billing → Credits** y anota el crédito real y su vencimiento (esperable: US$5 por 90 días).
3. Ve a **Settings → Billing → Billing alerts** y crea tres alertas: **US$5** (se acabó el crédito), **US$60** (ya estás pagando de verdad) y **US$110** (el gasto del mes pasó lo previsto de la Optimizada).

## Paso 2 — Conectar GitHub (cuenta pccpegit)

App Platform necesita leer el repo `pccpegit/SYSPCCLOG` para construir y redesplegar en cada push a `main`.

1. En **Apps → Create App → GitHub**, pulsa *Configure GitHub* e instala/autoriza la **GitHub App de DigitalOcean**.
2. Hazlo con la cuenta que tenga permisos sobre el repo (la de la organización **pccpegit**); una cuenta sin permisos sobre el repositorio no lo verá.
3. Concede acceso al repositorio `SYSPCCLOG`. No hace falta terminar el asistente de creación: la app se crea desde el spec (Paso 9).

## Paso 3 — Token y doctl

Instala `doctl` si no lo tienes (`brew install doctl` en macOS; en otros sistemas, ver la documentación oficial).

1. En **API → Tokens → Generate New Token**, crea un token con vencimiento corto (por ejemplo 30 días) y permisos de **apps, databases y projects**. Si dudas, usa acceso completo con vencimiento corto y revócalo al terminar.
2. Ejecuta **en tu terminal** (pegando el token cuando lo pida):

```bash
doctl auth init
doctl account get          # confirma la cuenta y el estado
```

3. El token queda en tu configuración local de `doctl`. **No lo pegues en el chat, en un commit ni en `.env.do`.**

## Paso 4 — Spaces: buckets y llave de acceso

1. En **Spaces Object Storage → Create**, región **NYC3**, crea dos buckets:
   - `syspcc-media`
   - `syspcc-hr-private`

   Ambos: **sin CDN** y con **File Listing restringido** (privado). El de RR. HH. guarda contratos con datos personales: nunca debe ser público.
2. Los nombres de bucket son únicos dentro de la región. Si alguno está tomado, elige otro y actualiza `AWS_STORAGE_BUCKET_NAME` y `HR_PRIVATE_BUCKET_NAME` en `.do/app.yaml`.
3. En **Spaces → Access Keys → Create**, crea **dos llaves** con acceso limitado (*Limited Access*, lectura/escritura/borrado) cada una a **un solo bucket**:
   - una para `syspcc-media` → `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`;
   - otra para `syspcc-hr-private` → `HR_AWS_ACCESS_KEY_ID` / `HR_AWS_SECRET_ACCESS_KEY` (datos personales: DNI, sueldo).

   Guarda cada **Access Key** y **Secret** para el Paso 8: el secreto se muestra una sola vez. Si por simplicidad usas una sola llave, déjala solo en `AWS_*` y no definas `HR_AWS_*` (el bucket de RR. HH. reutiliza `AWS_*`), pero entonces comprometer la llave de media expone también los datos personales. **Rotación:** crea la llave nueva, actualiza `.env.do` y el spec vivo, redespliega y recién entonces borra la anterior.


## Paso 5 — Cluster PostgreSQL, pool de conexiones y CA

App Platform solo **adjunta** un cluster existente; hay que crearlo antes.

```bash
doctl databases options regions --engine pg      # opcional: regiones disponibles
doctl databases create syspcc-pg \
  --engine pg --version 16 \
  --region nyc3 --size db-s-1vcpu-1gb --num-nodes 1 --wait
```

- Usa **NYC3** (o NYC1) para estar en el mismo centro de datos que la app. Si al crear la app DigitalOcean rechaza el cluster por la región, créalo en la región que indique el error.
- El spec crea la base `syspcc` y el usuario `syspcc` dentro del cluster (`db_name`, `db_user`) y expone `${db.*}` a los componentes. **Esa base y ese usuario aún no existen cuando creas el pool** (los crea App Platform al adjuntar el cluster): por eso el pool se crea **después del primer `doctl apps create`**, ver el punto siguiente.
- **OBLIGATORIO — restringe el acceso de red del cluster apenas lo crees.** Un cluster nuevo acepta conexiones desde **cualquier IP de Internet** (autenticadas y con TLS, pero expuestas) hasta que configures *trusted sources*, y esta base guarda datos personales. En cuanto exista una regla, todo lo demás queda bloqueado:

```bash
CLUSTER_ID=$(doctl databases list --format ID,Name --no-header | awk '$2=="syspcc-pg"{print $1}')
# Ahora: solo tu IP (para poder cargar datos a mano si hiciera falta)
doctl databases firewalls append "$CLUSTER_ID" --rule ip_addr:<TU_IP>
# Después de `doctl apps create` (Paso 9): permite a la app y retira tu IP
doctl databases firewalls append "$CLUSTER_ID" --rule app:<APP_ID>
doctl databases firewalls list "$CLUSTER_ID"      # verificación: ninguna regla abierta (0.0.0.0/0)
```

  App Platform suele agregar la regla `app:` por sí mismo al adjuntar el cluster; aun así comprueba el resultado con `firewalls list` y retira tu IP al terminar (`doctl databases firewalls remove "$CLUSTER_ID" --uuid <UUID-de-la-regla>`).
- **Host privado (VPC):** si la app y el cluster están en la misma región/VPC, usa el host **privado** del cluster (el bindable entrega el que corresponda; confírmalo con `echo $DB_HOST` en la Console). El tráfico no sale a Internet.
- El cluster incluye respaldos diarios (7 días de retención).

### 5.1 TLS verificado (`verify-ca`)

El spec ya trae `DB_SSLMODE=verify-ca` y, en `backend`, `worker` y `migrate`, `DB_CA_CERT=${db.CA_CERT}` (el certificado raíz del cluster en texto PEM). Con `verify-ca` el cliente comprueba que el servidor presenta un certificado firmado por ese CA; el modo por defecto (`require`) solo cifra y **no** verifica al servidor. Se prefiere `verify-ca` a `verify-full` porque este último además valida el nombre del host y puede fallar con hosts privados (VPC) y con el host del pool.

- Si el valor de `DB_CA_CERT` no es un PEM (por ejemplo, el bindable llegó sin resolver y quedó como texto `${db.CA_CERT}`), el contenedor **aborta el arranque** en lugar de seguir sin verificar. Tras el primer despliegue, mira el log de `backend`: debe arrancar sin errores de certificado.
- Alternativa si el bindable no resolviera: `doctl databases get-ca "$CLUSTER_ID"` descarga el CA; inclúyelo en la imagen y usa `DB_SSLROOTCERT=<ruta>` en su lugar.

### 5.2 Connection pool (PgBouncer)

**Por qué:** un cluster de 1 GB admite unas 22 conexiones utilizables. Cada hilo de gunicorn (4 × 4 = 16) mantiene una conexión persistente (`DB_CONN_MAX_AGE=60`) y Celery suma las suyas (`worker`: 2 procesos más beat). Durante un despliegue conviven la versión vieja y la nueva. Sin pool, el límite se alcanzaría con carga normal; con él, las conexiones de cliente (cientos si hiciera falta) comparten pocas conexiones reales.

**Cómo (el spec no lo declara: la referencia del app spec no tiene un campo para pools).** Se crea con `doctl` y el spec lo **referencia** con los bindables de pool que documenta DigitalOcean, con la forma `${<componente>.<pool>.<VARIABLE>}`:

| En el spec (`backend`, `worker`) | Valor |
|---|---|
| `DB_HOST` | `${db.syspccpool.HOSTNAME}` |
| `DB_PORT` | `${db.syspccpool.PORT}` |
| `DB_NAME` | `${db.syspccpool.DATABASE}` |
| `DB_USER` | `${db.syspccpool.USERNAME}` |
| `DB_PASSWORD` | `${db.syspccpool.PASSWORD}` |

El nombre del pool es `syspccpool` (solo letras y números, para evitar ambigüedad en el bindable). El job `migrate` **no** usa el pool: migra directo al cluster (`${db.HOSTNAME}` etc.).

Orden (el pool necesita que la base `syspcc` y el usuario `syspcc` ya existan, y los crea App Platform al adjuntar el cluster; por eso el pool se crea **después** del primer despliegue):

1. **Primer despliegue "directo".** Renderiza el spec con la bandera `--direct-db` (Paso 9): `backend` y `worker` apuntan al cluster (`${db.HOSTNAME}` y compañía) y `DB_DISABLE_SERVER_SIDE_CURSORS` queda en `False`. `migrate` crea el esquema.
2. Con la app creada y `migrate` ejecutado, crea el pool:

```bash
doctl databases pool create "$CLUSTER_ID" syspccpool \
  --db syspcc --user syspcc --size 15 --mode transaction
doctl databases pool list "$CLUSTER_ID"
```

3. **Pasa la app al pool**, partiendo del spec vivo (`doctl apps spec get`, ver [Operación diaria](#operación-diaria)): en `backend` y `worker` cambia los cinco `DB_*` a los bindables de la tabla de arriba y `DB_DISABLE_SERVER_SIDE_CURSORS` a `"True"`. Aplica con `doctl apps propose` y luego `doctl apps update`. El redespliegue deja el spec vivo igual a `.do/app.yaml` en este punto.
4. **Verifica** en la Console de `backend`: `echo $DB_HOST $DB_PORT $DB_NAME` debe mostrar el host del pool, su puerto (normalmente `25061`) y `syspccpool`. Si algún valor llega literal (`${db.syspccpool....}`), el bindable de pool no resolvió: **el despliegue falla en el healthcheck y la plataforma conserva la versión anterior** (el sistema no queda caído). Vuelve a los bindables directos y, para entrar igualmente por el pool, escribe los valores a mano con `doctl databases pool get "$CLUSTER_ID" syspccpool` (host, puerto y base del pool) en `DB_HOST`, `DB_PORT` y `DB_NAME`. Sin pool, con el límite de ~22 conexiones, reduce `GUNICORN_WORKERS` a 3.

Detalles:

- **Tamaño 15:** deja ~7 conexiones libres para el job `migrate`, la Console y `psql` de emergencia. Si ves esperas por conexiones, sube a 18.
- **Modo transaction:** el más eficiente, y el que exige no usar cursores del servidor (`DB_DISABLE_SERVER_SIDE_CURSORS=True`, ya en el spec; el código del proyecto evita `.iterator()` por este motivo) ni bloqueos de sesión (advisory locks, `LISTEN`). Las transacciones normales (`atomic()`, `select_for_update()`) funcionan porque viven dentro de una sola transacción.
- Los *trusted sources* del cluster también rigen para el pool.

## Paso 6 — Cluster Valkey gestionado

Reemplaza al Redis interno de la versión de prueba (sin contraseña y efímero). Se crea aparte y el spec lo adjunta como `cache`.

```bash
doctl databases options engines                  # confirma que `valkey` esté disponible
doctl databases create syspcc-valkey \
  --engine valkey --region nyc3 --size db-s-1vcpu-1gb --num-nodes 1 --wait

VALKEY_ID=$(doctl databases list --format ID,Name --no-header | awk '$2=="syspcc-valkey"{print $1}')
doctl databases firewalls append "$VALKEY_ID" --rule ip_addr:<TU_IP>      # ahora
doctl databases firewalls append "$VALKEY_ID" --rule app:<APP_ID>         # tras `doctl apps create`
doctl databases firewalls list "$VALKEY_ID"      # ninguna regla abierta (0.0.0.0/0)
```

- **Mismo centro de datos** que la app y el cluster PostgreSQL (NYC3).
- **Política de evicción: `noeviction`.** La cola de Celery no puede perder mensajes. Verifícala en el panel (*Databases → syspcc-valkey → Settings → Eviction policy*) o con `doctl databases configuration get "$VALKEY_ID" --engine valkey`; si es otra (por ejemplo `allkeys-lru`), cámbiala en el panel antes de usar la app.
- El spec arma las tres URLs con los bindables del cluster: `rediss://default:${cache.PASSWORD}@${cache.HOSTNAME}:${cache.PORT}/0` (caché y sesiones), `/1` (broker de Celery) y `/2` (resultados). El usuario de Valkey es siempre `default`.
- **Certificado verificado:** el certificado de DigitalOcean no está en el almacén de confianza del contenedor; por eso `backend` y `worker` reciben `REDIS_CA_CERT=${cache.CA_CERT}` (texto PEM) y el spec fija `REDIS_SSL_CERT_REQS=required`. El backend aplica la política tanto a Celery como a la caché, y si `REDIS_CA_CERT` no es un PEM válido aborta el arranque.
  - `REDIS_SSL_CERT_REQS=none` **no autentica al servidor**: un atacante en la ruta podría leer la contraseña de Valkey y las sesiones. No lo uses como configuración final; solo como excepción **temporal y consciente** mientras resuelves un problema de CA.
- **Verifica los bindables** con la Console (`echo $REDIS_URL` en `backend`): debe empezar con `rediss://default:` y llevar el host del cluster. Si `${cache.CA_CERT}` no resolviera, descarga el CA con `doctl databases get-ca "$VALKEY_ID"`, inclúyelo en la imagen y usa `REDIS_SSL_CA_CERTS=<ruta>`.
- El cluster incluye respaldos y mantenimiento gestionado. Revisa en el panel la **ventana de mantenimiento** y fíjala fuera del horario laboral (de lunes a viernes de 8:00 a 18:00, hora de Lima): durante un reinicio de Valkey la API responde 5xx unos segundos (ver "Valkey y límites de intentos" en la sección 2).

## Paso 7 — Verificar la rama de despliegue (main)

Desde SYSPCC-038 (GitFlow, ver `docs/09_Flujo_Git_y_Releases.md`) el spec despliega la rama **`main`**: solo llegan a producción las releases (`release/vX.Y.0`) y los hotfixes, con tag. `develop` es integración y no despliega. Los arreglos de SYSPCC-024 (cabecera de proxy SSL, WhiteNoise, Spaces, `/healthz/`, scripts de arranque) están en `main` desde la v1.0.0; sin ellos el despliegue entraría en un bucle de redirecciones 301, el admin quedaría sin CSS y los archivos subidos se perderían.

1. Confirma que la rama de los cuatro componentes en `.do/app.yaml` (y en el spec vivo) es `main` (`backend`, `worker`, `migrate` y `frontend`).
2. **Ojo con `deploy_on_push: true`:** una vez creada la app, **cada merge a `main` despliega** (por eso a `main` solo entran releases y hotfixes, con OK explícito). `develop` ya incluye hasta SYSPCC-032 (almacén con importación del libro, vínculo RQ↔catálogo, despacho real, entregas parciales, Master de RQ, borradores, egresos sin destino) y el análisis de CVs (SYSPCC-023), que corre en `worker`; lo que no se ha probado es su almacenamiento contra Spaces reales: tras el primer despliegue verifica que `PrivateS3Storage`, `hr_cv_purge_orphans` y la exportación de CVs (`apps/hr/services/cv_export.py`) operan sobre S3.

> Antes de cambiar el spec vivo a `main`, `main` debe tener la release vigente (v1.0.0 o posterior); si no, se despliega código viejo.


## Paso 8 — Preparar los secretos (.env.do)

El spec versionado **no contiene secretos**: los campos `type: SECRET` van con `value: ""`. Los inyecta un script local desde `.env.do`, que está en `.gitignore` (igual que `.do/*.rendered.yaml`).

Genera los valores:

```bash
# SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# ONEDRIVE_TOKEN_ENCRYPTION_KEY (clave Fernet)
backend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Crea `.env.do` en la raíz del repo (con permisos `chmod 600 .env.do`):

```bash
# --- Obligatorios ---
SECRET_KEY=<pegar>
ONEDRIVE_TOKEN_ENCRYPTION_KEY=<pegar>
AWS_ACCESS_KEY_ID=<access key de Spaces (bucket syspcc-media)>
AWS_SECRET_ACCESS_KEY=<secret de Spaces (bucket syspcc-media)>

# --- Opcionales (si quedan vacíos o ausentes, se omiten del spec) ---
HR_AWS_ACCESS_KEY_ID=         # recomendado: llave propia del bucket syspcc-hr-private
HR_AWS_SECRET_ACCESS_KEY=     # (ambas o ninguna)
EMAIL_HOST_PASSWORD=          # sin esto, los correos van a los logs
ANTHROPIC_API_KEY=            # asistente de RR. HH. y análisis de CVs (sin esto los CVs no se analizan)
RUC_API_TOKEN=                # consulta de RUC (apisperu.com)

# --- OneDrive (PDF de despachos del almacén; opcional) ---
ONEDRIVE_CLIENT_ID=           # sin esto la integración responde "OneDrive no configurado"
ONEDRIVE_TENANT=              # vacío = consumers; o organizations / id del tenant de la empresa
ONEDRIVE_SHARE_SCOPE=         # vacío = organization; anonymous solo con cuenta personal y decisión explícita

# --- Datos de la empresa impresos en los contratos (RR. HH.) ---
HR_COMPANY_NAME=
HR_COMPANY_RUC=
HR_COMPANY_ADDRESS=
HR_COMPANY_LEGAL_REP_NAME=
HR_COMPANY_LEGAL_REP_DNI=
HR_COMPANY_LEGAL_REP_TITLE=
HR_COMPANY_LEGAL_REP_POWERS=
HR_MIN_WAGE=
```

Si dejas `HR_COMPANY_*` vacíos, los contratos generados saldrán con esos datos en blanco. Al renderizar, el script lista los opcionales que quedaron sin valor y se omitieron del spec (rige el default del backend): revisa que ahí **no** figure `ANTHROPIC_API_KEY` si quieres usar CVs.

Formato de `.env.do`: una línea `CLAVE=valor` por variable. Se ignoran las líneas que empiezan con `#` y también los comentarios al final de la línea **precedidos de un espacio** (`CLAVE=valor   # nota`). Si un valor contiene ` #` (espacio + almohadilla), ponlo entre comillas (`CLAVE="a #b"`); un `#` pegado al texto (`abc#def`) se conserva tal cual.


## Paso 9 — Crear la app

```bash
# 1. Renderiza el spec (inyecta los secretos; genera .do/app.rendered.yaml, gitignored).
#    --direct-db SOLO en este primer despliegue: el pool syspccpool aún no existe (Paso 5.2).
backend/.venv/bin/python .do/render_spec.py --direct-db

# 2. (Recomendado) valida el spec contra la API de DigitalOcean sin crear nada
doctl apps propose --spec .do/app.rendered.yaml

# 3. Crea la app y espera a que termine el primer despliegue
doctl apps create --spec .do/app.rendered.yaml --wait
```

El script falla con un mensaje claro si falta algún secreto obligatorio y lista los opcionales que omitió. Los clusters `syspcc-pg` y `syspcc-valkey` (Pasos 5 y 6) deben existir **antes**: `doctl apps propose` lo comprueba.

**Justo después del `create`:** agrega la regla `app:<APP_ID>` al firewall de **ambos** clusters (Pasos 5 y 6) y confirma con `doctl databases firewalls list`.
Si el primer despliegue falla en `migrate` por *timeout* de conexión (la plataforma no alcanzó a agregar la regla de la app), agrega la regla `app:<APP_ID>` y redespliega con `doctl apps create-deployment "$APP_ID"`.

**A partir de aquí se empieza a cobrar** (con crédito mientras dure). Anota el `APP_ID` que devuelve el comando (`doctl apps list`).

El primer despliegue construye cuatro imágenes (`backend`, `worker`, `migrate` y la SPA) y puede tardar 10–15 minutos, sobre todo por LibreOffice en `backend`.

> **Riesgo del primer despliegue:** si el job `migrate` falla (por ejemplo, `permission denied for schema public`), el despliegue entero falla. Ver [Solución de problemas](#solución-de-problemas).


**Después del primer despliegue sano:** crea el pool de PgBouncer y pasa la app a él (Paso 5.2). Ese segundo cambio se hace sobre el spec vivo y deja la app idéntica a `.do/app.yaml`.

### 9.1 Si la cuenta solo admite una base gestionada adjunta (despliegue real del 2026-10-30)

En la cuenta de PCC, `doctl apps create` rechazó el spec con `databases.limit_exceeded: (2) new databases requested… limit (1)`, aunque los dos clusters ya existían. La app `syspcc` se creó así:

- **Spec sin el bloque `databases`.** Los valores de `${db.*}` y `${cache.*}` (host, puerto, usuario, contraseña y CA) se escribieron en el spec renderizado como variables `SECRET` (archivo local `.do/app.direct.rendered.yaml`, gitignored por `*.rendered.yaml`). Como la app no "adjunta" los clusters, App Platform **no** crea la base ni el usuario: se crearon con `doctl databases db create … syspcc` y `doctl databases user create … syspcc`, y como `doadmin` se ejecutó `ALTER DATABASE syspcc OWNER TO syspcc` (sin eso `migrate` falla con `permission denied for schema public`).
- **Firewall manual.** Por la misma razón la plataforma no agrega la regla `app:`; se agregó a mano en ambos clusters (`doctl databases firewalls append <ID> --rule app:<APP_ID>`).
- **Sin pool, `GUNICORN_WORKERS=3`.** Con conexión directa al cluster de ~22 conexiones, el spec vivo usa 3 × 4 hilos (12) en lugar de 4 × 4, como indica el Paso 5.2. La prueba de carga (99 usuarios + 100 CVs) llegó a 16 conexiones con 4 procesos y respondió con p95 de 56 ms.
- **Rotar la contraseña de la base** obliga a editar `DB_PASSWORD` en el spec vivo de `backend`, `worker` y `migrate`, porque ya no la entrega un bindable.

El pool (Paso 5.2) se puede crear igual con `doctl databases pool create`; para usarlo, escribe a mano su host, puerto y base en los `DB_*` del spec vivo.

## Paso 10 — Verificar el despliegue

```bash
APP_ID=$(doctl apps list --format ID,Spec.Name --no-header | awk '$2=="syspcc"{print $1}')
doctl apps get "$APP_ID" --format ID,DefaultIngress,ActiveDeployment.ID   # URL pública (DefaultIngress)
doctl apps list-deployments "$APP_ID"                                      # fase de cada despliegue
doctl apps logs "$APP_ID" backend      # runtime del backend
doctl apps logs "$APP_ID" migrate --type deploy   # salida del migrate / seed_data
doctl apps logs "$APP_ID" worker       # colas celery + hr_cv, y beat
```

El healthcheck `/healthz/` **no está publicado** en Internet (solo lo consulta la plataforma): el despliegue debe quedar en `ACTIVE` con el backend sano. Para verlo a mano, desde la Console del backend: `curl -s localhost:8080/healthz/` → `{"status":"ok"}`.

Verificaciones mínimas (reemplaza `<URL>` por el `DefaultIngress`):

```bash
curl -i https://<URL>/api/v1/auth/csrf/         # 200 y cookie csrftoken
curl -I https://<URL>/mgmt-panel/login/         # 200 (con CSS: abre en el navegador)
curl -I https://<URL>/                          # 200 (HTML de la SPA)
```

Comprobaciones en el navegador:

1. `https://<URL>/` carga la pantalla de login.
2. `https://<URL>/mgmt-panel/` se ve con estilos (WhiteNoise).
3. `worker` muestra en sus logs `celery@... ready`, las dos colas (`celery` y `hr_cv`) y `beat: Starting...`.
4. El backend arrancó sin errores de certificado (PostgreSQL `verify-ca` y Valkey `rediss://` con CA).

### Prueba de humo de seguridad (OBLIGATORIA antes de dar acceso a usuarios)

**Puerta de salida del despliegue:** ningún usuario recibe acceso hasta que esta prueba dé `401` cinco veces y luego `429`. Es condición de cierre del primer despliegue y de cada despliegue nuevo que cambie el ingress.

El anti-fuerza-bruta del login depende de que el ingress de DigitalOcean **sobrescriba** la cabecera `do-connecting-ip` que envía el cliente. Compruébalo cambiando esa cabecera en cada intento. Usa siempre el **mismo** usuario inexistente:

```bash
for i in 1 2 3 4 5 6 7 8; do
  curl -s -o /dev/null -w "intento $i -> HTTP %{http_code}\n" \
    -H "Content-Type: application/json" \
    -H "do-connecting-ip: 1.2.3.$i" \
    -d '{"username":"humo-seguridad","password":"incorrecta"}' \
    https://<URL>/api/v1/auth/login/
done
```

- **Esperado (seguro):** los intentos 1–5 devuelven `401` y el 6 en adelante `429`. Las IP falsas **no** reinician el contador: el ingress ignoró tu cabecera.
- **Si los 8 devuelven `401`:** el ingress NO sobrescribe la cabecera y cualquiera puede evadir el límite por IP. Pon `TRUST_DO_CONNECTING_IP=False` en el spec vivo, redespliega y define `NUM_PROXIES` según el salto que contenga la IP real (revisa el log de acceso del backend; no asumas el valor). Mientras tanto sigue vigente el límite **por usuario** (10/min), que no depende de la IP. Repite esta prueba tras el cambio.
- Espera 1 minuto antes de repetir (los contadores duran 60 s).

Verificación complementaria (desde tu red, sin la cabecera falsa): 6 intentos fallidos seguidos con un usuario inexistente terminan en `429`.

### Lista de verificación de seguridad del despliegue

- [ ] Prueba de humo de `do-connecting-ip` superada (arriba).
- [ ] `doctl databases firewalls list` de **ambos** clusters (`syspcc-pg` y `syspcc-valkey`) muestra solo `app:<APP_ID>` (y tu IP solo si estás cargando datos); ninguna regla abierta.
- [ ] Ambos buckets de Spaces en privado, sin listado público y sin CDN.
- [ ] El job `migrate` no recibe llaves de Spaces ni de terceros (solo `SECRET_KEY` y `DB_*`).
- [ ] El job `migrate` no recibe `ANTHROPIC_API_KEY` ni llaves de Spaces; `RUC_API_TOKEN` solo está en `backend`.
- [ ] PostgreSQL con `DB_SSLMODE=verify-ca` y Valkey con `rediss://` + `REDIS_SSL_CERT_REQS=required` (nunca `none`).
- [ ] Pool `syspccpool` en uso (`echo $DB_HOST` en la Console del backend).
- [ ] Política de evicción de Valkey en `noeviction`.
- [ ] Completar el [Paso 12](#paso-12--lista-de-verificación-previa-a-datos-reales) antes de cargar datos reales.


## Paso 11 — Superusuario y primeros datos

La instancia nace **vacía**: sin usuarios, proyectos ni departamentos (`seed_data` solo carga la configuración del workflow).

1. Abre una consola en el componente `backend` (panel: *Apps → syspcc → backend → Console*, o por terminal):

```bash
doctl apps console "$APP_ID" backend
# dentro del contenedor:
python manage.py createsuperuser
```

2. Entra a `https://<URL>/mgmt-panel/` con ese superusuario y crea, en este orden:
   - **Departamentos** y **Proyectos**.
   - **Usuarios** con sus **roles** (UserRole). Un superusuario sin rol no puede ejercer ningún flujo del sistema.
3. `seed_demo` **no está disponible** aquí: `seed_guard` lo bloquea porque `DEBUG=False` y `DJANGO_ENV=production`. Si necesitas datos ficticios, hazlo en otro entorno; no mezcles datos demo con esta base.

---

## Paso 12 — Lista de verificación previa a datos reales

Hasta aquí la instancia funciona, pero está **vacía y sin usuarios**. Antes de cargar el libro del almacén, dar acceso a las personas o subir CVs, completa esta lista en orden.

**1. Prueba de humo de `do-connecting-ip` (puerta de salida).** Ejecuta la [prueba de humo de seguridad del Paso 10](#prueba-de-humo-de-seguridad-obligatoria-antes-de-dar-acceso-a-usuarios): cinco `401` y luego `429`, con una IP falsa distinta en cada intento. Si los ocho devuelven `401`, el límite por IP se puede evadir: corrige antes de seguir.

**2. Primer superusuario y estructura mínima.** Crea el superusuario (Paso 11) y, desde `/mgmt-panel/`, **Departamentos y Proyectos primero** (la importación del almacén asocia el stock a proyectos existentes) y luego los **Usuarios con sus roles**. Entra con cada rol clave (Almacén Central, Jefe Logístico, un solicitante) y confirma que cambia la contraseña inicial.

**3. Importar el libro del almacén por la pantalla.**

- Entra con un usuario de **Almacén Central** o **Jefe Logístico** (son los únicos roles que pueden importar) y abre `/almacen` → **Importar Excel**.
- Sube el libro `INVENTARIO PCC - ALM` (`.xlsx`), revisa la **vista previa**, asocia las hojas/proyectos del libro a los proyectos del sistema, lee las advertencias y los egresos "Sin destino" (SYSPCC-032, quedan marcados para revisar) y **confirma**.
- Comprueba los totales contra la hoja `RESUMEN` del libro (con el libro actual, **6,857 unidades**).
- La importación corre dentro de la petición (límite `GUNICORN_TIMEOUT=120` s). El libro vive en Spaces mientras la vista previa está vigente; la tarea de las 3 AM purga las vencidas, y un libro ya importado se rechaza (misma huella digital). Para sumar solo las filas que antes se omitieron existe la opción de reimportar (`--reimport`, comando `import_warehouse_excel`, que además permite `--dry-run`).
- Hazlo **una sola vez** y con datos definitivos: el stock inicial sale de aquí.

**4. Confirmar los vínculos de los RQs en curso.** Si traes RQs abiertos de un sistema anterior (o los cargaste a mano), revisa qué ítems moverían stock. Desde la Console del backend (`doctl apps console "$APP_ID" backend`):

```bash
python manage.py report_rq_stock_gaps            # SOLO LECTURA: nunca escribe en la base
python manage.py report_rq_stock_gaps --json     # para guardarlo o compartirlo
```

El reporte tiene dos secciones: RQs ya despachados cuyo despacho no generó un movimiento de almacén, y **ítems con producto de catálogo que Logística aún no confirmó**. El motor de despacho ignora un vínculo propuesto hasta que Logística lo confirma, así que esos ítems **no descontarán stock** hasta entonces: haz que Logística los confirme desde la pantalla del RQ. Vuelve a correr el reporte hasta que quede en cero.

**5. Reclamar los créditos de API de Anthropic del plan Max para los CVs.** El análisis de CVs y el asistente de RR. HH. consumen el **API de Anthropic** (se factura por uso, aparte del chat).

- Entra a la consola del API con la cuenta de la organización y revisa en *Billing* si tu plan Max incluye **créditos de API**; si los hay, reclámalos ahora (suelen tener fecha de vencimiento: anota cuándo vencen y cuánto saldo queda).
- Crea una **API key dedicada** para producción (por ejemplo `syspcc-prod`) con un **límite mensual de gasto**, y cárgala como secreto `ANTHROPIC_API_KEY` en `.env.do` (Paso 8) o en el spec vivo. Solo la reciben `backend` y `worker`.
- Prueba con 2 o 3 CVs: la pantalla muestra el costo real de cada análisis. Los topes de uso se ajustan con `HR_CV_DAILY_LIMIT_PER_USER` (por defecto 500 CVs/usuario/día), `HR_CV_MAX_ITEMS_PER_ANALYSIS` (500) y `HR_CV_POSTING_MAX_COST_USD` (0.50 por lectura de convocatoria).
- Sin saldo o sin clave, los CVs fallan y quedan con error tras los reintentos (`HR_CV_MAX_ATTEMPTS`); no se pierde el archivo. Configura una alerta de saldo bajo en la consola del API.

**6. Resto de la lista.**

- [ ] `HR_COMPANY_*` completados (los contratos salen con esos datos).
- [ ] Correo: `EMAIL_HOST_PASSWORD` cargada y un correo de prueba recibido (recordatorio de aprobación o alerta de stock).
- [ ] OneDrive configurado (`ONEDRIVE_CLIENT_ID`, `ONEDRIVE_TENANT`, `ONEDRIVE_SHARE_SCOPE`) o aceptado como "no configurado".
- [ ] Un RQ de prueba recorre un flujo completo; se registra una entrada y una salida de almacén.
- [ ] `worker` activo, sin errores en logs y sin reinicios por memoria tras un lote de CVs de prueba; `beat` ejecutó al menos una tarea (alertas de stock de las 7:30 o la invalidación de caché cada 15 min).
- [ ] Firewalls de PostgreSQL y Valkey solo con la regla de la app; tu IP retirada.
- [ ] Ventana de mantenimiento de Valkey y PostgreSQL fuera del horario laboral.
- [ ] Alertas de facturación activas; token de API de `doctl` revocado o con vencimiento corto.
- [ ] Respaldo verificado: en el panel del cluster PostgreSQL, existe el respaldo de la noche anterior.

## Operación diaria

**Redespliegue:** cada push a `main` (merge de una release o hotfix) redespliega todos los componentes; el job `migrate` corre primero. Los merges a `develop` no despliegan.

**Cambiar el spec o una variable (SIEMPRE partiendo del spec vivo):**

```bash
doctl apps spec get "$APP_ID" > .do/live.rendered.yaml    # incluye secretos cifrados EV[...]
# edita .do/live.rendered.yaml (está gitignored por el patrón *.rendered.yaml)
doctl apps propose --app "$APP_ID" --spec .do/live.rendered.yaml
doctl apps update "$APP_ID" --spec .do/live.rendered.yaml
```

> **Nunca** apliques `.do/app.yaml` (la plantilla) a una app existente: sus secretos vacíos **borrarían** los ya cargados. Si cambiaste la plantilla, copia solo el cambio al spec vivo.

**Rotar o cargar un secreto:** edítalo en el panel (*Settings → App-Level Environment Variables*) o en el spec vivo; el valor en claro solo se envía una vez, luego aparece como `EV[...]`.

**Reiniciar sin código nuevo:** `doctl apps create-deployment "$APP_ID"`.

**Dominio propio:** agrégalo en *Settings → Domains*, y añade el nuevo host a `ALLOWED_HOSTS` y su URL con `https://` a `CSRF_TRUSTED_ORIGINS` y `CORS_ALLOWED_ORIGINS` (separados por comas, sin barra final).

**Logs y métricas:** `doctl apps logs "$APP_ID" <componente> [--follow]`; métricas en el panel de la app.

**Reglas importantes del worker:** nunca escales `worker` a más de 1 instancia (beat se duplicaría y los recordatorios/alertas saldrían repetidos). Si aparece OOM, baja `HR_CV_MAX_IMAGE_PIXELS` (el spec ya trae 16 millones; ver 1.3), baja a `-c 1` o sube el tamaño; si los lotes de CVs retrasan recordatorios, separa la cola `hr_cv` (variante de US$109.15). Una prueba automática del repositorio (`test_do_app_spec.py`) verifica que solo `worker` tenga beat, que las colas `celery` y `hr_cv` tengan consumidor y que las opciones de Celery existan.

**Cambios en `.do/app.yaml`:** la plantilla del repositorio nunca se aplica a una app existente. Si cambia, copia el cambio a mano al spec vivo.


---

## Variantes y cambios de nivel

Todos los cambios se hacen sobre el **spec vivo** (`doctl apps spec get`) y `doctl apps update`. Los clusters gestionados se crean aparte, igual que `syspcc-pg` y `syspcc-valkey`.

### Separar los CVs en su propio worker (US$97.15 → 109.15)

Mejora opcional si los lotes de CVs retrasan recordatorios, el SLA o las alertas (ver 1.3). En el spec vivo:

1. En `worker`, cambia `-Q celery,hr_cv` por `-Q celery` (sigue con `-B`, `-c 2` y `instance_count: 1`) y quita los secretos que ya no necesita: `ANTHROPIC_API_KEY`, `HR_AWS_ACCESS_KEY_ID`, `HR_AWS_SECRET_ACCESS_KEY`.
2. Agrega un componente `worker-hr` (mismo repo, rama, `source_dir`, `dockerfile_path`, bindables `DB_*`/`DB_CA_CERT`/`REDIS_*` y variables de TLS que `worker`), `instance_size_slug: apps-s-1vcpu-1gb`, `instance_count: 1`, `termination.grace_period_seconds: 190` y `run_command: celery -A config worker -Q hr_cv -n hr@%h -c 2 -O fair --prefetch-multiplier 1 --max-tasks-per-child 50 -l info` (**sin `-B`**). Sus únicos secretos: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `HR_AWS_ACCESS_KEY_ID`, `HR_AWS_SECRET_ACCESS_KEY` y `ANTHROPIC_API_KEY`.
3. Aplica con `doctl apps propose` y `doctl apps update`. La prueba automática del spec (`test_do_app_spec.py`) deberá actualizarse si la plantilla pasa a tener dos workers.

El aislamiento tiene un segundo efecto: un reinicio por memoria de los CVs ya no toca al beat.

### `worker-hr` chico (US$109.15 → 102.15)

Con la separación, `worker-hr` puede ser `apps-s-1vcpu-0.5gb` con `-c 1`. Con 512 MiB es obligatorio `HR_CV_MAX_IMAGE_PIXELS=12000000` (o menos). Si ves reinicios por memoria en `doctl apps logs "$APP_ID" worker-hr`, vuelve a 1 GB.

### Subir el servidor (Propuesto, US$123.15)

Backend a `apps-d-2vcpu-4gb` (US$78, CPU dedicada, permite autoscaling). Con varias instancias del backend cada una abre sus propias conexiones al pool: revisa que `GUNICORN_WORKERS × GUNICORN_THREADS × instancias` no desborde lo razonable para el pool (tamaño 15) y sube su tamaño si hace falta (`doctl databases pool update`). Los contadores anti-fuerza-bruta ya son compartidos (Valkey), así que escalar el backend no los debilita.

### Más conexiones a la base de datos

Primero sube el tamaño del pool (`doctl databases pool update "$CLUSTER_ID" syspccpool --size 20`); si no basta, sube el plan del cluster PostgreSQL (más RAM, más conexiones y más costo).

### Bajar de nivel (volver al Redis interno)

Es reversible pero pierdes persistencia y autenticación de la cola. El service `redis` (imagen `redis:7-alpine`, sin contraseña, efímero) ya no está en la plantilla; su bloque está en el historial de git de `.do/app.yaml` (versión de SYSPCC-024). Pasos: restaurar ese service, apuntar `REDIS_URL`/`CELERY_*` a `redis://redis:6379/N`, quitar `REDIS_CA_CERT` y `REDIS_SSL_CERT_REQS`, poner `DJANGO_REDIS_IGNORE_EXCEPTIONS=True` (los límites de intentos pasan a ser por proceso) y borrar el cluster `syspcc-valkey` (si no, sigue cobrando US$15). No se recomienda con datos reales.

---

## Destruir todo para no pagar

DigitalOcean factura cada recurso por separado y **no los apaga solo**. Borrar la app **no** borra los clusters de PostgreSQL y Valkey ni los buckets: hay que eliminarlos explícitamente. Revisa los cuatro puntos (los dos clusters cuentan como el punto 2).

> **Antes de borrar:** si ya cargaste datos que te importan, haz un respaldo. `pg_dump` con la cadena de `doctl databases connection <ID-cluster>` y copia el contenido de los buckets (los archivos de usuarios no se pueden recuperar luego). Una vez borrado, **no hay vuelta atrás**.

```bash
# 1. La app (frontend, backend, worker, job)
doctl apps delete "$APP_ID"

# 2. Los DOS clusters (el pool syspccpool se borra con syspcc-pg)
doctl databases list
doctl databases delete <ID-cluster-syspcc-pg>
doctl databases delete <ID-cluster-syspcc-valkey>
```

3. **Spaces:** vacía y elimina los buckets `syspcc-media` y `syspcc-hr-private` desde el panel (*Spaces → bucket → Settings → Destroy*; un bucket con objetos hay que vaciarlo antes, con la interfaz web o una herramienta S3). **Mientras exista algún bucket se cobran los US$5/mes de Spaces.** Revoca también la Access Key.
4. **Cuenta:** revoca el token de API (*API → Tokens*), y revisa *Billing → Current usage* al día siguiente: no debe quedar ningún recurso activo.

Comprobación final:

```bash
doctl apps list
doctl databases list
doctl projects list
```

Los tres deben estar sin recursos de SYSPCC.

---

## Solución de problemas

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| Bucle infinito de redirecciones `301` / healthcheck nunca pasa a sano | Falta `SECURE_PROXY_SSL_HEADER`, es decir, el despliegue sale de una rama sin SYSPCC-024 | Confirma que el app apunta a `main` con una release que incluya SYSPCC-024 (`doctl apps spec get`) |
| El despliegue falla en `migrate` con `permission denied for schema public` | El usuario `syspcc` no tiene `CREATE` sobre el schema `public` (típico en PG 15+) | Conéctate con el usuario `doadmin` (`doctl databases connection <ID-cluster> --format URI`) y ejecuta: `ALTER DATABASE syspcc OWNER TO syspcc;` y `GRANT ALL ON SCHEMA public TO syspcc;` (conectado a la base `syspcc`). Redespliega con `doctl apps create-deployment`. Si usaras una Dev Database: está documentado que hay que borrarla, lograr un despliegue exitoso y recrearla |
| El primer despliegue falla y los siguientes también | Una causa ajena a la BD (secreto vacío, healthcheck, imagen) impidió completar el primer deploy | Revisa `doctl apps logs "$APP_ID" migrate --type deploy` y `--type build`; corrige y vuelve a desplegar |
| Healthcheck `/healthz/` devuelve `503` | La BD no responde (credenciales, *trusted sources*, cluster aún creándose) | `doctl apps logs "$APP_ID" backend`; revisa **Network Access** del cluster y que `DB_*` tengan valor en la Console |
| `Bad Request (400)` en `/api/*` | `ALLOWED_HOSTS` no incluye el host real (dominio propio nuevo) | Agrega el host a `ALLOWED_HOSTS` en el spec vivo |
| `403 CSRF` al iniciar sesión o guardar | `CSRF_TRUSTED_ORIGINS` sin `https://` o sin el dominio | Formato exacto: `https://<host>` sin barra final |
| `/api/...` devuelve 404 | Falta `preserve_path_prefix: true` en la regla del ingress | Revisa las reglas del spec vivo |
| `/mgmt-panel/` sin estilos | `collectstatic` falló o `/static` no está enrutado | `doctl apps logs "$APP_ID" backend` al arranque; confirma la regla `/static` |
| Las llamadas de la SPA van a `localhost:8000` | `VITE_API_URL` / `VITE_BACKEND_URL` no llegaron al build (el spec fija `VITE_API_URL=/api/v1/` y `VITE_BACKEND_URL` vacío a propósito: SPA y API comparten origen) | Revisa el bloque `envs` del static site (scope `BUILD_TIME`) y redespliega: las variables de Vite se fijan al construir. Si `render_spec.py` quitó `VITE_BACKEND_URL` (versión antigua), la SPA cae a `localhost:8000` |
| `429` al iniciar sesión con un solo usuario tras varios intentos fallidos | Límite por usuario (10/min) o por IP (5/min) | Esperar 1 minuto; es el comportamiento esperado |
| `429` al iniciar sesión para varios usuarios a la vez | No está activo `TRUST_DO_CONNECTING_IP` (o hay un `NUM_PROXIES` definido): todos comparten IP | Pon `TRUST_DO_CONNECTING_IP=True` y quita `NUM_PROXIES` |
| Descarga de adjuntos o firma da `403`/`SignatureDoesNotMatch` | URL firmada vencida (media dura 1 h; RR. HH. 60 s), reloj/endpoint mal configurado o credenciales de Spaces erróneas | Recarga la pantalla para obtener una URL nueva; verifica `AWS_S3_ENDPOINT_URL=https://nyc3.digitaloceanspaces.com`, `AWS_S3_REGION_NAME=nyc3` y la llave |
| Los archivos subidos "desaparecen" tras un despliegue | `AWS_STORAGE_BUCKET_NAME` vacío: media quedó en el disco efímero | Define las variables de Spaces (Pasos 4 y 8) |
| No llegan correos | Falta `EMAIL_HOST_PASSWORD` (van a los logs) o el puerto 25 bloqueado | Define la contraseña SMTP; usa el puerto 587 |
| Se perdieron los secretos tras `doctl apps update` | Se aplicó la plantilla con `value: ""` sobre una app existente | Recarga los secretos en el panel; en adelante parte de `doctl apps spec get` |

---

| Errores `5xx` en toda la API y el log muestra `ConnectionError` de Redis/Valkey | Valkey caído, en mantenimiento o sin regla `app:` en su firewall (el spec **falla cerrada** a propósito) | `doctl databases get "$VALKEY_ID"`; revisa la ventana de mantenimiento y `doctl databases firewalls list "$VALKEY_ID"`. Vuelve solo al reconectar |
| `rediss://` falla con `certificate verify failed` | El CA de Valkey no llegó o no es el del cluster | En la Console: `echo "$REDIS_CA_CERT"` debe empezar con `-----BEGIN CERTIFICATE-----`. Si el bindable no resolvió, usa `doctl databases get-ca` + `REDIS_SSL_CA_CERTS`. No pongas `REDIS_SSL_CERT_REQS=none` |
| El backend no arranca: `DB_CA_CERT does not contain a PEM certificate` | `${db.CA_CERT}` no resolvió y llegó como texto | Revisa el nombre del componente en `databases:` (`db`); descarga el CA con `doctl databases get-ca` y usa `DB_SSLROOTCERT` |
| `SSL error: certificate verify failed` hacia PostgreSQL | CA equivocado, o `verify-full` contra un host privado | Usa `DB_SSLMODE=verify-ca` y el CA de **ese** cluster |
| `FATAL: remaining connection slots are reserved` / `too many connections` | Se agotaron las conexiones del cluster (app sin pool o pool muy grande) | Confirma que `backend` y workers usan el pool (`echo $DB_HOST`); si no, termina el Paso 5.2. Revisa que `size` del pool (15) + conexiones directas no pase del límite del cluster |
| `cursor "_django_curs_..." does not exist` o `named cursor` | Un `QuerySet.iterator()` con cursores del servidor a través del pool en modo transaction | Confirma `DB_DISABLE_SERVER_SIDE_CURSORS=True` en el backend y los workers |
| El despliegue falla en el healthcheck tras pasar al pool | Los bindables `${db.syspccpool...}` no resolvieron, o el pool no existe | `doctl databases pool list "$CLUSTER_ID"`; vuelve a los bindables directos (Paso 5.2, punto 4). La plataforma conserva la versión anterior |
| Cada análisis de CV queda `QUEUED` | `worker` caído, o su `run_command` sin `hr_cv` en `-Q` | `doctl apps logs "$APP_ID" worker`; el comando debe llevar `-Q celery,hr_cv`. La tarea de recuperación (cada 5 min) reencola los atascados |
| Los CVs fallan con error del proveedor | Falta `ANTHROPIC_API_KEY` en `worker`, saldo agotado o límite mensual alcanzado | Revisa el secreto en el spec vivo y el saldo en la consola del API |
| `worker` se reinicia por memoria (y con él beat) | CVs con imágenes grandes o picos de pandas/openpyxl | Baja `HR_CV_MAX_IMAGE_PIXELS` (el spec trae 16 millones; ver 1.3), `-c 1`, separa los CVs en su worker, o sube el tamaño |
| Recordatorios o alertas de stock repetidos | `worker` escalado a más de 1 instancia (beat duplicado) | Vuelve a `instance_count: 1` |
| La importación del libro del almacén da `502`/`504` | Libro muy grande: supera `GUNICORN_TIMEOUT` (120 s) o el límite del ingress | Divide la importación o sube `GUNICORN_TIMEOUT` en el spec vivo; revisa el log del backend |
| Las sesiones del `/mgmt-panel` se cierran tras un redespliegue | No debería ocurrir (las sesiones están en Valkey) | Revisa que `REDIS_URL` apunte a Valkey y no a un Redis local |


---

## Limitaciones aceptadas

- **Sin alta disponibilidad:** un solo contenedor por componente y un solo nodo por cluster; un despliegue o un mantenimiento puede provocar segundos de indisponibilidad. Para alta disponibilidad hay que pasar a 2 nodos en las bases de datos y a varias instancias del backend (más costo).
- **Valkey cae = la API cae (falla cerrada):** durante un reinicio o mantenimiento de Valkey la API responde 5xx unos segundos. Es una decisión de seguridad (los límites de intentos no se degradan en silencio); se mitiga con la ventana de mantenimiento fuera de horario.
- **Un solo programador de tareas (beat):** si `worker` se reinicia, las tareas programadas vuelven a ejecutarse en su siguiente hora; una tarea cuya hora cae durante el reinicio puede saltarse ese día.
- **Sin datos demo** y sin `seed_demo`: la instancia arranca vacía.
- **No se probó contra recursos reales** de DigitalOcean (Spaces, Valkey, PostgreSQL, pool): el código se verificó con pruebas, firma offline de URLs y carga de settings. En particular, **los bindables del pool (`${db.syspccpool.*}`) siguen la sintaxis que documenta DigitalOcean pero no se han resuelto en una app real**: por eso el Paso 5.2 los verifica y trae un plan de vuelta atrás. El primer `migrate` real ocurre en tu despliegue; revisa su log antes de declarar el despliegue "listo".
- **Latencia:** NYC está a unos 70–90 ms de Lima. App Platform no tiene región en Sudamérica.
- **Broker caído:** si Valkey no responde, los movimientos de almacén se registran igual pero el PDF/OneDrive del grupo no se encola (queda sin `document_url` y se registra en el log).
- **Costo del API de Anthropic:** no está en los US$97.15 y crece con el uso de CVs; se controla con la llave dedicada, su límite mensual y los topes por usuario.

---

## Variables de entorno

Todas son opcionales para Docker local (sin ellas su comportamiento no cambia); el spec de DigitalOcean fija las que se marcan. Están documentadas en `backend/.env.example`.

| Variable | Para qué | Valor en DO |
|---|---|---|
| `TRUST_DO_CONNECTING_IP` | Usar `do-connecting-ip` como IP del cliente y `NUM_PROXIES=0` | `True` |
| `NUM_PROXIES` | Saltos de proxy confiables para `X-Forwarded-For` (solo aplica si `TRUST_DO_CONNECTING_IP` está apagado) | no definir |
| `DB_CONN_MAX_AGE` | Conexiones persistentes a PostgreSQL (segundos); por defecto 0 | `60` |
| `AWS_STORAGE_BUCKET_NAME` | Activa Spaces para media; vacío = disco local | `syspcc-media` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Llave de Spaces | secretos |
| `AWS_S3_ENDPOINT_URL` / `AWS_S3_REGION_NAME` | Endpoint y región de Spaces | `https://nyc3.digitaloceanspaces.com` / `nyc3` |
| `AWS_QUERYSTRING_EXPIRE` | Vigencia (s) de las URLs firmadas de media | por defecto 3600 |
| `HR_FILE_STORAGE` | Storage de archivos de RR. HH. | `apps.hr.storage.PrivateS3Storage` |
| `HR_PRIVATE_BUCKET_NAME` | Bucket privado de RR. HH. (distinto al de media) | `syspcc-hr-private` |
| `REDIS_SSL_CERT_REQS` | Validación del certificado en `rediss://`: `required` / `optional` / `none` | `required` |
| `REDIS_SSL_CA_CERTS` / `REDIS_CA_CERT` | CA del proveedor para `rediss://`: ruta de archivo / texto PEM (bindable `${cache.CA_CERT}`) | `${cache.CA_CERT}` en `backend` y workers |
| `DB_SSLMODE` | `require` (defecto, no verifica el servidor) / `verify-ca` / `verify-full` | `verify-ca` |
| `DB_SSLROOTCERT` / `DB_CA_CERT` | CA de PostgreSQL: ruta de archivo / texto PEM (`${db.CA_CERT}`); obligatoria con `verify-*` | `${db.CA_CERT}` en `backend`, workers y `migrate` |
| `DB_DISABLE_SERVER_SIDE_CURSORS` | `True` cuando `DB_HOST` es un pool de PgBouncer en modo transaction (SYSPCC-033); por defecto `False` | `True` (`False` en el primer despliegue directo) |
| `HR_AWS_ACCESS_KEY_ID` / `HR_AWS_SECRET_ACCESS_KEY` | Llave de Spaces propia del bucket de RR. HH. (ambas o ninguna); si faltan se usa `AWS_*` | secretos (recomendado) |
| `DJANGO_REDIS_IGNORE_EXCEPTIONS` | Tolerar caídas de Redis en la caché/sesiones; mueve los límites de intentos a una caché local por proceso (`THROTTLE_CACHE_ALIAS=throttle`) | `False` (Valkey gestionado: límites exactos, falla cerrada) |
| `GUNICORN_WORKERS` / `GUNICORN_THREADS` | Procesos e hilos de gunicorn (`scripts/do-start.sh`); por defecto 1 y 4 | `4` y `4` |
| `GUNICORN_TIMEOUT` | Segundos máximos por petición (importación del libro, LibreOffice); por defecto 120 | `120` |
| `GUNICORN_MAX_REQUESTS` / `GUNICORN_MAX_REQUESTS_JITTER` | Reciclar cada proceso tras N peticiones (+ variación); por defecto 1000 y 100 | por defecto |
| `HR_CV_PROVIDER` | `anthropic` (real). `fake` está prohibido en producción: el backend no arranca | `anthropic` |
| `HR_CV_DISPATCH` | `celery` (cola `hr_cv`, la consume `worker`) / `thread` (sin worker, hilos en el proceso web) | `celery` |
| `ONEDRIVE_CLIENT_ID` / `ONEDRIVE_TENANT` / `ONEDRIVE_SHARE_SCOPE` | Integración OneDrive del almacén (opcionales) | desde `.env.do` si se usan |
| `EMAIL_BACKEND` | Backend de correo explícito; si no, SMTP solo con `EMAIL_HOST_PASSWORD` y consola si no | no definir |

Otros ya existentes que el spec fija: `DJANGO_SETTINGS_MODULE=config.settings.production`, `DJANGO_ENV=production`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `DB_*` (del pool), `REDIS_URL`, `CELERY_*`, `EMAIL_*`, `WAREHOUSE_ALERT_RECIPIENTS` y `HR_COMPANY_*`.

**Ajustes opcionales que usan su valor por defecto** (agrégalos al spec vivo solo si los necesitas): `HR_CV_MODEL`, `HR_CV_EFFORT`, `HR_CV_MAX_ATTEMPTS`, `HR_CV_DAILY_LIMIT_PER_USER`, `HR_CV_MAX_ITEMS_PER_ANALYSIS`, `HR_CV_MAX_FILE_BYTES`, `HR_CV_MAX_FILES_PER_REQUEST`, `HR_CV_MAX_PAGES`, `HR_CV_RETENTION_DAYS` (retención de CVs; `0` = no se purgan solos), `HR_CV_POSTING_*`, `HR_ASSISTANT_*`, `HR_PDF_ENABLED`, `HR_PDF_TIMEOUT`. El spec ya fija `HR_CV_MAX_IMAGE_PIXELS=16000000` (memoria del worker, ver 1.3) y `HR_CV_STALE_SECONDS=3600` (un lote de 100 CVs tarda ~27 min; con el default de 600 s se re-encolarían ítems que solo esperan turno). Los límites de peticiones por minuto (login, RR. HH., almacén, Master de RQ) están fijos en `settings/base.py`, no son variables de entorno.

---

## Fuentes

- App Platform — referencia del spec: <https://docs.digitalocean.com/products/app-platform/reference/app-spec/>
- Variables de entorno y bindables: <https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/>
- Pools de conexiones (PgBouncer) en bases gestionadas: <https://docs.digitalocean.com/products/databases/postgresql/how-to/manage-connection-pools/>
- Valkey gestionado: <https://docs.digitalocean.com/products/databases/valkey/>
- Bases de datos en App Platform: <https://docs.digitalocean.com/products/app-platform/how-to/manage-databases/>
- Cómo obtener la IP del cliente (`do-connecting-ip`): <https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/>
- Error `permission denied for schema public` en Dev Database: <https://docs.digitalocean.com/support/how-do-i-fix-a-permission-denied-for-schema-public-error-in-my-dev-database/>
- Precios: <https://www.digitalocean.com/pricing> y <https://docs.digitalocean.com/products/app-platform/details/pricing/>
- Informes internos, fuera del repositorio: informe de costos de infraestructura (Económico / Estándar / Propuesto) e informe a Gerencia del 27/10/2026 (Opción Optimizada ~US$97). Precios de App Platform verificados el 29/10/2026 (`apps-s-2vcpu-4gb` US$50, `apps-s-1vcpu-1gb` US$12, `apps-s-1vcpu-0.5gb` US$5).
