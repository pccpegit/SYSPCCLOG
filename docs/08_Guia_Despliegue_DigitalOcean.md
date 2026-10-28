# Guía de Despliegue — SYSPCC en DigitalOcean App Platform

**Ticket:** SYSPCC-024 | **Fecha:** 27 de octubre de 2026 | **Región:** NYC (Nueva York)

Esta guía explica cómo publicar SYSPCC en **DigitalOcean App Platform** usando el spec `.do/app.yaml` del repositorio, cuánto cuesta de verdad, qué debes hacer tú (cuenta, pago, tokens) y, sobre todo, **cómo destruir todo para dejar de pagar**.

> **Estado actual:** el código y el spec están preparados, pero **no se creó ningún recurso en DigitalOcean**. Nada de lo que está aquí se cobra hasta que ejecutes el Paso 8.

Complementa a `docs/05_Guia_Despliegue_y_Produccion.md` (servidor propio con Nginx) y a `docs/07_Guia_Demo_Supabase_Vercel.md` (demo gratuita). No reemplaza a ninguna: la demo de Render/Vercel sigue funcionando igual.

---

## Tabla de contenidos

1. [Costos reales (léelo primero)](#1-costos-reales-léelo-primero)
2. [Qué se despliega](#2-qué-se-despliega)
3. [Lo que tienes que hacer tú](#3-lo-que-tienes-que-hacer-tú)
4. [Paso 1 — Cuenta, medio de pago y alertas de facturación](#paso-1--cuenta-medio-de-pago-y-alertas-de-facturación)
5. [Paso 2 — Conectar GitHub (cuenta pccpegit)](#paso-2--conectar-github-cuenta-pccpegit)
6. [Paso 3 — Token y doctl](#paso-3--token-y-doctl)
7. [Paso 4 — Spaces: buckets y llave de acceso](#paso-4--spaces-buckets-y-llave-de-acceso)
8. [Paso 5 — Cluster PostgreSQL gestionado](#paso-5--cluster-postgresql-gestionado)
9. [Paso 6 — Mergear SYSPCC-024 a develop](#paso-6--mergear-syspcc-024-a-develop)
10. [Paso 7 — Preparar los secretos (.env.do)](#paso-7--preparar-los-secretos-envdo)
11. [Paso 8 — Crear la app](#paso-8--crear-la-app)
12. [Paso 9 — Verificar el despliegue](#paso-9--verificar-el-despliegue)
13. [Paso 10 — Superusuario y primeros datos](#paso-10--superusuario-y-primeros-datos)
14. [Operación diaria](#operación-diaria)
15. [Subir o bajar de nivel](#subir-o-bajar-de-nivel)
16. [Destruir todo para no pagar](#destruir-todo-para-no-pagar)
17. [Solución de problemas](#solución-de-problemas)
18. [Limitaciones aceptadas del stack de prueba](#limitaciones-aceptadas-del-stack-de-prueba)
19. [Variables de entorno nuevas](#variables-de-entorno-nuevas)
20. [Fuentes](#fuentes)

---

## 1. Costos reales (léelo primero)

### 1.1 El crédito de bienvenida NO es de US$200

Los informes internos mencionan que DigitalOcean "suele ofrecer un crédito de bienvenida de US$200". **Eso ya no es lo que ofrece hoy.** A fecha de esta guía, la página oficial de precios dice que las cuentas nuevas reciben **US$5 de crédito, válidos por 90 días**.

- Verifica el monto real en **Billing → Credits** (o Facturación → Créditos) apenas crees la cuenta, **antes** de crear recursos.
- Si esperabas US$200 por un código de referido, el GitHub Student Pack u otra promoción, aplícalo o pídelo a soporte antes de empezar.
- Con US$5 no se sostiene ningún stack de SYSPCC durante 90 días. Alcanza, como mucho, para **unos 4 días** del stack de prueba (US$5 ÷ US$0.055 por hora ≈ 91 horas). Ese cálculo es optimista: el almacén de archivos (Spaces) cobra **US$5 al mes** desde que existe un bucket, así que en la práctica el crédito rinde menos.
- **DigitalOcean no apaga los recursos cuando se acaba el crédito: sigue cobrando a la tarjeta** hasta que los destruyas (ver [Destruir todo](#destruir-todo-para-no-pagar)).

### 1.2 Comparativo de escenarios

Antes de la tabla, cinco palabras que se repiten:

- **Servidor de aplicación:** el programa que atiende a los usuarios cuando abren SYSPCC en el navegador.
- **Procesos automáticos:** el programa que trabaja en segundo plano sin que nadie lo pida (recordatorios, alertas de stock, análisis de CVs).
- **Cola y caché:** memoria temporal que usan los procesos automáticos para coordinarse. **Efímera** significa que se borra cada vez que el servicio se reinicia o se vuelve a desplegar.
- **Spaces:** el almacén de archivos en la nube (firmas, adjuntos, contratos). Se cobra aparte, aunque casi no se use.
- **Redespliegue:** publicar de nuevo la aplicación (ocurre con cada actualización del código).

> **Ojo con el nombre "Estándar":** hay dos opciones distintas con ese nombre. El **Estándar de esta tabla (US$55.15 al mes)** viene del informe interno de costos de infraestructura. El informe a Gerencia del 27/10/2026 también llama "Estándar" a una opción de unos US$140; **no es la misma**. Ambos documentos son internos y no están en este repositorio. Por eso la tabla nombra siempre la fuente.

Precios mensuales en US$, sin IGV (DigitalOcean factura desde el extranjero; consulta a Contabilidad el tratamiento tributario).

| Componente | Prueba (este archivo de configuración) | Estándar (informe interno de costos) | Optimizado (informe a Gerencia 27/10/2026) | Propuesto (informe interno de costos) |
|---|---|---|---|---|
| Servidor de aplicación | 10.00 | 10.00 | 50.00 (compartido, más potente) | 78.00 (dedicado) |
| Procesos automáticos | 5.00 | 10.00 | 12.00 | 10.00 |
| Base de datos PostgreSQL gestionada | 15.15 (1 GB) | 15.15 (1 GB) | 15.15 (1 GB) | 15.15 (1 GB) |
| Cola y caché | 5.00 (propia de la app, efímera) | 15.00 (gestionada, 1 GB) | 15.00 (gestionada, 1 GB) | 15.00 (gestionada, 1 GB) |
| Almacén de archivos (Spaces) | 5.00 | 5.00 | 5.00 | 5.00 |
| Portal web (lo que se ve en el navegador) | 0.00 | 0.00 | 0.00 | 0.00 |
| **Total mensual** | **40.15** | **55.15** | **~97** | **123.15** |
| Total por hora (÷ 730) | 0.055 | 0.076 | 0.133 | 0.169 |
| Respaldos de la base de datos | Sí (la base gestionada los hace) | Sí | Sí | Sí |
| La cola sobrevive a un redespliegue | No | Sí | Sí | Sí |

Nota técnica (para quien configure): los planes de App Platform que corresponden a cada fila son `apps-s-1vcpu-1gb-fixed` (servidor de Prueba/Estándar) y `apps-s-1vcpu-0.5gb` (procesos de Prueba); `apps-s-1vcpu-1gb-fixed` (procesos Estándar/Propuesto); `apps-s-2vcpu-4gb` y `apps-s-1vcpu-1gb` (Optimizado); `apps-d-2vcpu-4gb` (servidor Propuesto, CPU dedicada). La cola y caché gestionada es Valkey (compatible con Redis).

Notas:

- La columna **Prueba** es la que describe `.do/app.yaml`. Usa la base PostgreSQL gestionada (no la "Dev Database" de US$7) porque esta última no concede permisos de creación sobre el schema `public` en PostgreSQL 15+ y el `migrate` del primer despliegue falla.
- La columna **Optimizado** sale del informe a Gerencia del 27/10/2026 (servidor US$50 + BD US$15 + procesos US$27 + archivos US$5 ≈ US$97). Esos US$27 de "procesos" se desglosan aquí como procesos automáticos US$12 + cola y caché gestionada US$15.
- El job `migrate` (que prepara la base de datos antes de cada despliegue) se factura por segundo solo mientras corre: centavos por despliegue.
- El portal web dentro de una app de pago cuesta US$0. Spaces cobra US$5/mes por 250 GB mientras exista al menos un bucket.
- Los precios salen de las listas oficiales de DigitalOcean (App Platform, Managed Databases, Spaces). Confírmalos en el panel antes de contratar: pueden variar.

### 1.3 Qué hacer con la prueba

| Camino | Costo | Cuándo |
|---|---|---|
| (a) Destruir todo **dentro de unos 4 días** | El crédito de US$5 cubre el gasto y no pagas de tu bolsillo | Terminaste de probar |
| (b) Mantener la prueba | ~US$40/mes | Pruebas largas con usuarios internos, sin datos críticos |
| (c) Subir de nivel | US$55 / ~97 / 123 | Producción real (ver [Subir o bajar de nivel](#subir-o-bajar-de-nivel)) |

**Si pasas de ~4 días, o si olvidas borrar algo, DigitalOcean cobra a tu tarjeta: unos US$1.30 por día** (US$40 al mes). Recuerda que Spaces cobra US$5 al mes aunque lo uses poco, y que borrar la app no borra la base de datos ni los buckets (ver [Destruir todo](#destruir-todo-para-no-pagar)).

---

## 2. Qué se despliega

Todo vive en **una sola app** (`syspcc`) con un único dominio `*.ondigitalocean.app`, de modo que la SPA y `/api` comparten origen (las cookies JWT son `SameSite=Lax` y el CSRF usa doble envío).

| Componente | Tipo | Función | Tamaño |
|---|---|---|---|
| `frontend` | static site | SPA React 19 + Vite 7 (`npm run build`, carpeta `dist`) | gratis |
| `backend` | service | Django + gunicorn (`scripts/do-start.sh`), puerto 8080, LibreOffice incluido | `apps-s-1vcpu-1gb-fixed` |
| `worker` | worker | Celery cola `celery` + `hr_cv`, con **beat embebido** (`-B`) | `apps-s-1vcpu-0.5gb` |
| `redis` | service interno | Redis 7 (broker, resultados, caché, sesiones del admin); sin ingress | `apps-s-1vcpu-0.5gb` |
| `migrate` | job `PRE_DEPLOY` | `scripts/do-predeploy.sh`: `migrate` + `seed_data` antes de cada despliegue | `apps-s-1vcpu-0.5gb` |
| `db` | base de datos | Cluster Managed PostgreSQL 16 `syspcc-pg` (se crea aparte, el spec lo adjunta) | 1 GB |
| Spaces | externo | `syspcc-media` (firmas, adjuntos) y `syspcc-hr-private` (contratos, plantillas; datos personales) | 250 GB |

Enrutamiento (ingress): `/api`, `/mgmt-panel` y `/static` van al `backend` conservando el prefijo (`preserve_path_prefix: true`; sin eso Django recibiría `/v1/...` y respondería 404). Todo lo demás (`/`) va a la SPA, con `catchall_document: index.html` para que funcionen los enlaces profundos de React Router. `/healthz` y `/media` **no se publican** a propósito: el healthcheck de la plataforma llega directo al componente (no pasa por el ingress) y exponerlo en Internet permitiría a cualquiera consumir conexiones de la base de datos; `/media` no lo sirve Django en producción (los archivos salen de Spaces con URLs firmadas).

Decisiones de diseño que conviene conocer:

- **IP del cliente:** el ingress de DigitalOcean escribe su propia IP en `X-Forwarded-For`; la del usuario llega en `do-connecting-ip`. Con `TRUST_DO_CONNECTING_IP=True` el backend usa esa cabecera (si llegara como lista separada por comas, toma la entrada **de más a la derecha**, la que escribe el ingress) y los límites de intentos son por usuario real, no compartidos por toda la empresa. **No definas `NUM_PROXIES`** en este archivo de configuración. Esto asume que el ingress **sobrescribe** la cabecera que envíe el cliente: es una hipótesis que se comprueba **obligatoriamente** en el [Paso 9](#paso-9--verificar-el-despliegue) (prueba de humo de seguridad).
- **Límites de login:** 5 intentos/min por IP **y** 10 intentos/min por nombre de usuario. El segundo límite protege cada cuenta aunque un atacante rote su IP o `do-connecting-ip` no se comportara como se espera. Contrapartida aceptada: quien conozca un usuario puede bloquearlo 1 minuto a la vez.
- **Redis y límites de intentos:** con `DJANGO_REDIS_IGNORE_EXCEPTIONS=True` (Redis efímero) la caché y las sesiones degradan si Redis cae, pero los límites de intentos pasan a una caché local del proceso (`THROTTLE_CACHE_ALIAS=throttle`): **siguen vigentes** durante la caída (por proceso de gunicorn; el spec usa 1) y se reinician al reiniciar el contenedor. La cuota diaria del asistente de RR. HH. responde `503` (falla cerrada) mientras Redis no conteste.
- **Secretos por componente (mínimo privilegio):** el job `migrate` solo recibe `SECRET_KEY` y `DB_*`. Las llaves de Spaces, `ANTHROPIC_API_KEY`, `ONEDRIVE_TOKEN_ENCRYPTION_KEY` y `EMAIL_HOST_PASSWORD` se inyectan solo en `backend` y `worker`; `RUC_API_TOKEN` solo en `backend`. Se recomienda **dos llaves de Spaces** (media vs. RR. HH.): si se filtra la de media no se expone el bucket de datos personales.
- **Archivos:** el disco de los contenedores es efímero y no se comparte entre `backend` y `worker`. Por eso media va a Spaces con URLs firmadas (1 hora) y los archivos de RR. HH. a un bucket distinto con URLs de 60 segundos.
- **Estáticos del admin:** WhiteNoise sirve `/static`; `collectstatic` corre al arrancar el contenedor (en el build no existen `SECRET_KEY` ni `DB_*`).
- **Healthcheck:** `/healthz/` responde `200` si la BD contesta `SELECT 1` y `503` si no; contesta antes de la validación de `ALLOWED_HOSTS` y del redireccionamiento SSL.
- **Correo:** sin `EMAIL_HOST_PASSWORD` los correos van a los logs en lugar de fallar cada día con un error SMTP.
- **Datos de referencia:** `seed_data` (tipos de adquisición y pasos del workflow) corre en cada despliegue; es idempotente y no crea usuarios. `seed_demo` está bloqueado en producción a propósito.

---

## 3. Lo que tienes que hacer tú

El código y el spec ya están preparados; lo siguiente **solo lo puedes hacer tú** (requiere tu identidad, tu tarjeta o tus tokens):

- [ ] Crear la cuenta de DigitalOcean y registrar un medio de pago.
- [ ] Verificar el crédito real en Billing → Credits.
- [ ] Crear alertas de facturación en US$5 y US$30.
- [ ] Autorizar la GitHub App de DigitalOcean sobre la organización `pccpegit` (repo `SYSPCCLOG`).
- [ ] Crear un token de API y ejecutar `doctl auth init` en tu terminal (**no lo compartas en el chat**).
- [ ] Crear los dos buckets de Spaces y una llave de acceso (Access Key + Secret).
- [ ] Crear el cluster PostgreSQL `syspcc-pg`.
- [ ] Revisar y mergear el PR de SYSPCC-024 a `develop` (el spec despliega desde `develop`).
- [ ] Generar y guardar los secretos en `.env.do` (archivo local, fuera de git).
- [ ] Ejecutar `doctl apps create` y, tras el primer despliegue, `createsuperuser`.
- [ ] Al terminar la prueba, **destruir los recursos** o decidir a qué nivel quedarte.

---

## Paso 1 — Cuenta, medio de pago y alertas de facturación

1. Crea la cuenta en <https://cloud.digitalocean.com> y registra una tarjeta (también se aceptan PayPal, Google Pay o Apple Pay). Sin medio de pago no se pueden crear recursos. Las cuentas nuevas pueden pasar por verificación o tener límites iniciales de recursos.
2. Ve a **Billing → Credits** y anota el crédito real y su vencimiento (esperable: US$5 por 90 días).
3. Ve a **Settings → Billing → Billing alerts** y crea dos alertas: **US$5** (se acabó el crédito) y **US$30** (ya estás pagando de verdad).

## Paso 2 — Conectar GitHub (cuenta pccpegit)

App Platform necesita leer el repo `pccpegit/SYSPCCLOG` para construir y redesplegar en cada push a `develop`.

1. En **Apps → Create App → GitHub**, pulsa *Configure GitHub* e instala/autoriza la **GitHub App de DigitalOcean**.
2. Hazlo con la cuenta que tenga permisos sobre el repo (la de la organización **pccpegit**); una cuenta sin permisos sobre el repositorio no lo verá.
3. Concede acceso al repositorio `SYSPCCLOG`. No hace falta terminar el asistente de creación: la app se crea desde el spec (Paso 8).

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

   Guarda cada **Access Key** y **Secret** para el Paso 7: el secreto se muestra una sola vez. Si por simplicidad usas una sola llave, déjala solo en `AWS_*` y no definas `HR_AWS_*` (el bucket de RR. HH. reutiliza `AWS_*`), pero entonces comprometer la llave de media expone también los datos personales. **Rotación:** crea la llave nueva, actualiza `.env.do` y el spec vivo, redespliega y recién entonces borra la anterior.

## Paso 5 — Cluster PostgreSQL gestionado

App Platform solo **adjunta** un cluster existente; hay que crearlo antes.

```bash
doctl databases options regions --engine pg      # opcional: regiones disponibles
doctl databases create syspcc-pg \
  --engine pg --version 16 \
  --region nyc3 --size db-s-1vcpu-1gb --num-nodes 1 --wait
```

- Usa **NYC3** (o NYC1) para estar en el mismo centro de datos que la app. Si al crear la app DigitalOcean rechaza el cluster por la región, créalo en la región que indique el error.
- El spec crea la base `syspcc` y el usuario `syspcc` dentro del cluster (`db_name`, `db_user`) y expone `${db.*}` a los componentes.
- **OBLIGATORIO — restringe el acceso de red del cluster apenas lo crees.** Un cluster nuevo acepta conexiones desde **cualquier IP de Internet** (autenticadas y con TLS, pero expuestas) hasta que configures *trusted sources*, y esta base guarda datos personales. En cuanto exista una regla, todo lo demás queda bloqueado:

```bash
CLUSTER_ID=$(doctl databases list --format ID,Name --no-header | awk '$2=="syspcc-pg"{print $1}')
# Ahora: solo tu IP (para poder cargar datos a mano si hiciera falta)
doctl databases firewalls append "$CLUSTER_ID" --rule ip_addr:<TU_IP>
# Después de `doctl apps create` (Paso 8): permite a la app y retira tu IP
doctl databases firewalls append "$CLUSTER_ID" --rule app:<APP_ID>
doctl databases firewalls list "$CLUSTER_ID"      # verificación: ninguna regla abierta (0.0.0.0/0)
```

  App Platform suele agregar la regla `app:` por sí mismo al adjuntar el cluster; aun así comprueba el resultado con `firewalls list` y retira tu IP al terminar (`doctl databases firewalls remove "$CLUSTER_ID" --uuid <UUID-de-la-regla>`).
- **Host privado (VPC):** si la app y el cluster están en la misma región/VPC, usa el host **privado** del cluster en `DB_HOST` (el bindable `${db.HOSTNAME}` entrega el que corresponda; confírmalo con `echo $DB_HOST` en la Console). El tráfico no sale a Internet.
- **TLS:** por defecto `sslmode=require` (cifra, pero **no** verifica el servidor). Para verificarlo, descarga el CA (`doctl databases get-ca "$CLUSTER_ID"`) y, tras comprobar en la Console que `${db.CA_CERT}` resuelve, agrega en `backend`, `worker` y `migrate`: `DB_SSLMODE=verify-ca` y `DB_CA_CERT=${db.CA_CERT}` (o `DB_SSLROOTCERT=<ruta>` si montas el archivo). Con `verify-full` además se valida el nombre del host, que puede fallar con hosts privados: prefiere `verify-ca`. Si el CA no es un certificado PEM válido el contenedor aborta el arranque (no degrada en silencio).
- El cluster incluye respaldos diarios (7 días de retención).

## Paso 6 — Mergear SYSPCC-024 a develop

El spec despliega la rama `develop`. Hasta que no estén en `develop` los arreglos de SYSPCC-024 (cabecera de proxy SSL, WhiteNoise, Spaces, `/healthz/`, scripts de arranque), el primer despliegue entraría en un bucle de redirecciones 301, el admin quedaría sin CSS y los archivos subidos se perderían.

1. Revisa el PR de `chore/SYSPCC-024-despliegue-digitalocean` hacia `develop` y mergéalo (el push y el PR se hacen con tu confirmación).
2. **Ojo con `deploy_on_push: true`:** a partir de aquí, **cada merge a `develop` despliega**. Esto aplica también a SYSPCC-023 (análisis de CVs): antes de mergearlo, verifica que `PrivateS3Storage` funciona contra Spaces y que `hr_cv_purge_orphans` y `cv_export` operan sobre S3. El worker del spec ya escucha la cola `hr_cv`, así que no hay que tocar el spec para 023.

> Si `develop` apunta a una versión sin las migraciones esperadas o el app apunta a `main`, se despliega código viejo. La rama del spec debe ser `develop`.

## Paso 7 — Preparar los secretos (.env.do)

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
ANTHROPIC_API_KEY=            # asistente de RR. HH. y análisis de CVs
RUC_API_TOKEN=                # consulta de RUC (apisperu.com)

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

Si dejas `HR_COMPANY_*` vacíos, los contratos generados saldrán con esos datos en blanco.

Formato de `.env.do`: una línea `CLAVE=valor` por variable. Se ignoran las líneas que empiezan con `#` y también los comentarios al final de la línea **precedidos de un espacio** (`CLAVE=valor   # nota`). Si un valor contiene ` #` (espacio + almohadilla), ponlo entre comillas (`CLAVE="a #b"`); un `#` pegado al texto (`abc#def`) se conserva tal cual.

## Paso 8 — Crear la app

```bash
# 1. Renderiza el spec (inyecta los secretos; genera .do/app.rendered.yaml, gitignored)
backend/.venv/bin/python .do/render_spec.py

# 2. (Recomendado) valida el spec contra la API de DigitalOcean sin crear nada
doctl apps propose --spec .do/app.rendered.yaml

# 3. Crea la app y espera a que termine el primer despliegue
doctl apps create --spec .do/app.rendered.yaml --wait
```

El script falla con un mensaje claro si falta algún secreto obligatorio.

**Justo después del `create`:** agrega la regla `app:<APP_ID>` al firewall del cluster (Paso 5) y confirma con `doctl databases firewalls list`.
Si el primer despliegue falla en `migrate` por *timeout* de conexión (la plataforma no alcanzó a agregar la regla de la app), agrega la regla `app:<APP_ID>` y redespliega con `doctl apps create-deployment "$APP_ID"`.

**A partir de aquí se empieza a cobrar** (con crédito mientras dure). Anota el `APP_ID` que devuelve el comando (`doctl apps list`).

El primer despliegue construye cuatro imágenes (`backend`, `worker`, `migrate` y la SPA) y puede tardar 10–15 minutos, sobre todo por LibreOffice en `backend`.

> **Riesgo del primer despliegue:** si el job `migrate` falla (por ejemplo, `permission denied for schema public`), el despliegue entero falla. Ver [Solución de problemas](#solución-de-problemas).

## Paso 9 — Verificar el despliegue

```bash
APP_ID=$(doctl apps list --format ID,Spec.Name --no-header | awk '$2=="syspcc"{print $1}')
doctl apps get "$APP_ID" --format ID,DefaultIngress,ActiveDeployment.ID   # URL pública (DefaultIngress)
doctl apps list-deployments "$APP_ID"                                      # fase de cada despliegue
doctl apps logs "$APP_ID" backend      # runtime del backend
doctl apps logs "$APP_ID" migrate --type deploy   # salida del migrate / seed_data
doctl apps logs "$APP_ID" worker
doctl apps logs "$APP_ID" redis        # confirma que Redis arrancó
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
3. El worker muestra en sus logs `celery@... ready` y `beat: Starting...`.

### Prueba de humo de seguridad (OBLIGATORIA antes de dar acceso a usuarios)

**Puerta de salida del despliegue:** ningún usuario recibe acceso hasta que esta prueba dé `401` cinco veces y luego `429`. Es una condición de cierre del PR de SYSPCC-024 y de cada despliegue nuevo que cambie el ingress.

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
- [ ] `doctl databases firewalls list "$CLUSTER_ID"` muestra solo `app:<APP_ID>` (y tu IP solo si estás cargando datos); ninguna regla abierta.
- [ ] `doctl apps get "$APP_ID" -o json` no muestra puertos públicos en el componente `redis` (hay un bug conocido de App Platform que agrega el 8080 a servicios internos).
- [ ] Ambos buckets de Spaces en privado, sin listado público y sin CDN.
- [ ] El job `migrate` no recibe llaves de Spaces ni de terceros (solo `SECRET_KEY` y `DB_*`).
- [ ] Antes de cargar datos reales: pasar a Managed Valkey con autenticación y TLS verificado (ver abajo) y a un plan de base de datos con respaldos.

## Paso 10 — Superusuario y primeros datos

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

## Operación diaria

**Redespliegue:** cada push a `develop` redespliega todos los componentes; el job `migrate` corre primero.

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

**Reglas importantes del worker:** nunca escales `worker` a más de 1 instancia (beat se duplicaría y los recordatorios/alertas saldrían repetidos). Si aparece OOM, baja la concurrencia (`-c 1`) o súbelo a `apps-s-1vcpu-1gb-fixed` (+US$5).

---

## Subir o bajar de nivel

Todos los cambios se hacen sobre el **spec vivo** (`doctl apps spec get`) y `doctl apps update`. Los clusters gestionados se crean aparte, igual que `syspcc-pg`.

### De Prueba (40.15) a Estándar (55.15)

Cambios: worker a `apps-s-1vcpu-1gb-fixed` (+US$5), Redis interno a Managed Valkey 1 GB (+US$10 neto: +US$15 del cluster, −US$5 del service `redis`).

1. Crea el cluster: `doctl databases create syspcc-valkey --engine valkey --region nyc3 --size db-s-1vcpu-1gb --num-nodes 1 --wait` (revisa `doctl databases options engines`).
2. En el spec vivo: agrega el bloque `databases: - name: cache, engine: VALKEY, production: true, cluster_name: syspcc-valkey`, elimina el service `redis`, y cambia las tres URLs:

```yaml
REDIS_URL:             rediss://default:${cache.PASSWORD}@${cache.HOSTNAME}:${cache.PORT}/0
CELERY_BROKER_URL:     rediss://default:${cache.PASSWORD}@${cache.HOSTNAME}:${cache.PORT}/1
CELERY_RESULT_BACKEND: rediss://default:${cache.PASSWORD}@${cache.HOSTNAME}:${cache.PORT}/2
```

3. Verifica los valores reales de los bindables con la Console (`echo $REDIS_URL`).
4. **TLS (`rediss://`)**: el certificado de DigitalOcean no está en el almacén de confianza del contenedor. **Camino recomendado: validar el servidor con el CA de DO.** En `backend` y `worker` define `REDIS_CA_CERT=${cache.CA_CERT}` (texto PEM; comprueba en la Console que el bindable resuelve) —o descarga el CA con `doctl databases get-ca <id>`, inclúyelo en la imagen y usa `REDIS_SSL_CA_CERTS=<ruta>`— y deja `REDIS_SSL_CERT_REQS=required` (es el valor por defecto). El backend aplica la política tanto a Celery como a la caché, y si `REDIS_CA_CERT` no es un PEM válido aborta el arranque.
   - `REDIS_SSL_CERT_REQS=none` **no autentica al servidor**: un atacante en la ruta podría leer la contraseña de Valkey y las sesiones. Úsalo solo como excepción **temporal y consciente** mientras resuelves el CA, y únicamente con el host privado (VPC) del cluster. No es una configuración final.
   - Restringe también los *trusted sources* del cluster Valkey a la app (`doctl databases firewalls append <id> --rule app:<APP_ID>`).
5. Quita `DJANGO_REDIS_IGNORE_EXCEPTIONS` (ya no hace falta con un Valkey estable).
6. Worker: `instance_size_slug: apps-s-1vcpu-1gb-fixed` y, si hay mucha carga de CVs, `-c 3`.

### De Estándar al Optimizado (~97)

Backend a `apps-s-2vcpu-4gb` (US$50, compartido) y worker a `apps-s-1vcpu-1gb` (US$12). Con `apps-s-1vcpu-1gb` (sin `-fixed`) podría haber varias instancias, pero **el worker con beat debe seguir en 1**. Si subes `GUNICORN_WORKERS` a 2–3 y `GUNICORN_THREADS` a 4, revisa el presupuesto de conexiones de la BD (con 1 GB hay unas 22 utilizables: hilos de gunicorn + procesos de Celery + job).

### Al Propuesto (123.15)

Backend a `apps-d-2vcpu-4gb` (US$78, CPU dedicada, permite autoscaling) y worker a `apps-s-1vcpu-1gb-fixed`. Si la carga de CVs crece, separa un `worker-hr` con `-Q hr_cv -n hr@%h` y deja el default sin esa cola.

### Bajar de nivel

Es el camino inverso y es reversible. Para volver de Valkey al Redis interno, restaura el service `redis` y las URLs `redis://redis:6379/N`, y elimina el cluster `syspcc-valkey` si ya no lo usas (si no, sigue cobrando).

---

## Destruir todo para no pagar

DigitalOcean factura cada recurso por separado y **no los apaga solo**. Borrar la app **no** borra el cluster de PostgreSQL ni los buckets: hay que eliminarlos explícitamente. Revisa los cuatro puntos.

> **Antes de borrar:** si ya cargaste datos que te importan, haz un respaldo. `pg_dump` con la cadena de `doctl databases connection <ID-cluster>` y copia el contenido de los buckets (los archivos de usuarios no se pueden recuperar luego). Una vez borrado, **no hay vuelta atrás**.

```bash
# 1. La app (frontend, backend, worker, redis, job)
doctl apps delete "$APP_ID"

# 2. El cluster PostgreSQL (e idem syspcc-valkey si lo creaste)
doctl databases list
doctl databases delete <ID-cluster-syspcc-pg>
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
| Bucle infinito de redirecciones `301` / healthcheck nunca pasa a sano | Falta `SECURE_PROXY_SSL_HEADER`, es decir, el despliegue sale de una rama sin SYSPCC-024 | Confirma que el app apunta a `develop` con SYSPCC-024 mergeado (`doctl apps spec get`) |
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
| Los archivos subidos "desaparecen" tras un despliegue | `AWS_STORAGE_BUCKET_NAME` vacío: media quedó en el disco efímero | Define las variables de Spaces (Paso 4/7) |
| Errores de caché/sesiones cuando Redis se reinicia | Redis interno efímero | `DJANGO_REDIS_IGNORE_EXCEPTIONS=True` degrada la caché y las sesiones; los límites de login siguen activos (caché local). Registrar una entrada/salida de almacén con el broker caído **ya no falla**: el movimiento se guarda y el PDF no se encola (log `warehouse.group_pdf.enqueue_failed`, sin `document_url`). El asistente de RR. HH. responde `503` hasta que Redis vuelva. Pasar a Valkey lo elimina |
| Las sesiones del `/mgmt-panel` se cierran tras cada despliegue | Las sesiones usan la caché (Redis efímero) | Esperado en la prueba; con Valkey persiste |
| El worker se reinicia por memoria | 512 MB con `-c 2` y pandas/openpyxl | `-c 1` o `apps-s-1vcpu-1gb-fixed` |
| Recordatorios o alertas de stock repetidos | `worker` escalado a más de 1 instancia (beat duplicado) | Vuelve a `instance_count: 1` |
| No llegan correos | Falta `EMAIL_HOST_PASSWORD` (van a los logs) o el puerto 25 bloqueado | Define la contraseña SMTP; usa el puerto 587 |
| Cada análisis de CV queda `QUEUED` (tras mergear 023) | El worker no escucha `hr_cv` | El spec ya lleva `-Q celery,hr_cv`; verifica que el worker usa esa línea de comandos |
| `rediss://` falla con error de certificado (Valkey) | CA de DO no confiable | Ver "De Prueba a Estándar", punto 4 |
| Se perdieron los secretos tras `doctl apps update` | Se aplicó la plantilla con `value: ""` sobre una app existente | Recarga los secretos en el panel; en adelante parte de `doctl apps spec get` |
| Docker Hub limita la descarga de `redis` | Límite de pulls anónimos | Agrega `registry_credentials` a la imagen en el spec, o pasa a Valkey |

---

## Limitaciones aceptadas del stack de prueba

- **Redis efímero:** cada redespliegue del componente `redis` pierde la cola de Celery, los resultados, la caché y las sesiones del admin.
- **Redis sin contraseña:** el service `redis` no tiene `requirepass`. Solo es alcanzable desde la red privada de la app (sin ingress), pero cualquier proceso dentro de esa red podría falsificar sesiones del admin o encolar tareas. Es aceptable **solo para la prueba**; antes de datos reales pasa a Managed Valkey (autenticación + TLS verificado, ver "Subir de nivel"). Confirma tras el primer despliegue que el componente no expone puertos públicos.
- **Un solo contenedor por componente**, sin alta disponibilidad; un despliegue puede provocar segundos de indisponibilidad.
- **Crédito de US$5 / ~4 días:** después se paga con tarjeta (unos US$1.30 por día) hasta que se destruya todo. Spaces suma US$5 al mes mientras exista un bucket.
- **Sin datos demo** y sin `seed_demo`: la instancia arranca vacía.
- **No se probó contra recursos reales** de DigitalOcean (Spaces, Valkey, PostgreSQL): el código se verificó con pruebas, firma offline de URLs y carga de settings. El primer `migrate` real ocurre en tu despliegue; revisa su log antes de declarar el despliegue "listo".
- **Latencia:** NYC está a unos 70–90 ms de Lima. App Platform no tiene región en Sudamérica.
- **Broker caído:** si Redis no responde, los movimientos de almacén se registran igual pero el PDF/OneDrive del grupo no se encola (queda sin `document_url` y se registra en el log).

---

## Variables de entorno nuevas

Todas son opcionales; sin ellas el comportamiento previo (Docker local, demo Render) no cambia. Están documentadas en `backend/.env.example`.

| Variable | Para qué | Valor en DO |
|---|---|---|
| `TRUST_DO_CONNECTING_IP` | Usar `do-connecting-ip` como IP del cliente y `NUM_PROXIES=0` | `True` |
| `NUM_PROXIES` | Saltos de proxy confiables para `X-Forwarded-For` (Render usa 1) | no definir |
| `DB_CONN_MAX_AGE` | Conexiones persistentes a PostgreSQL (segundos); por defecto 0 | `60` |
| `AWS_STORAGE_BUCKET_NAME` | Activa Spaces para media; vacío = disco local | `syspcc-media` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Llave de Spaces | secretos |
| `AWS_S3_ENDPOINT_URL` / `AWS_S3_REGION_NAME` | Endpoint y región de Spaces | `https://nyc3.digitaloceanspaces.com` / `nyc3` |
| `AWS_QUERYSTRING_EXPIRE` | Vigencia (s) de las URLs firmadas de media | por defecto 3600 |
| `HR_FILE_STORAGE` | Storage de archivos de RR. HH. | `apps.hr.storage.PrivateS3Storage` |
| `HR_PRIVATE_BUCKET_NAME` | Bucket privado de RR. HH. (distinto al de media) | `syspcc-hr-private` |
| `REDIS_SSL_CERT_REQS` | Validación del certificado en `rediss://`: `required` / `optional` / `none` | por defecto `required` |
| `REDIS_SSL_CA_CERTS` / `REDIS_CA_CERT` | CA del proveedor para `rediss://`: ruta de archivo / texto PEM (bindable `${cache.CA_CERT}`) | recomendado con Valkey |
| `DB_SSLMODE` | `require` (defecto, no verifica el servidor) / `verify-ca` / `verify-full` | `require`; `verify-ca` con CA |
| `DB_SSLROOTCERT` / `DB_CA_CERT` | CA de PostgreSQL: ruta de archivo / texto PEM (`${db.CA_CERT}`); obligatoria con `verify-*` | vacío |
| `HR_AWS_ACCESS_KEY_ID` / `HR_AWS_SECRET_ACCESS_KEY` | Llave de Spaces propia del bucket de RR. HH. (ambas o ninguna); si faltan se usa `AWS_*` | secretos (recomendado) |
| `DJANGO_REDIS_IGNORE_EXCEPTIONS` | Tolerar caídas de Redis en la caché/sesiones; mueve los límites de intentos a una caché local (`THROTTLE_CACHE_ALIAS=throttle`) | `True` con Redis interno |
| `EMAIL_BACKEND` | Backend de correo explícito; si no, SMTP solo con `EMAIL_HOST_PASSWORD` y consola si no | no definir |

Otros ya existentes que el spec fija: `DJANGO_SETTINGS_MODULE=config.settings.production`, `DJANGO_ENV=production`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `DB_*`, `REDIS_URL`, `CELERY_*`, `EMAIL_*`, `WAREHOUSE_ALERT_RECIPIENTS` y `HR_COMPANY_*`.

---

## Fuentes

- App Platform — referencia del spec: <https://docs.digitalocean.com/products/app-platform/reference/app-spec/>
- Variables de entorno y bindables: <https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/>
- Bases de datos en App Platform: <https://docs.digitalocean.com/products/app-platform/how-to/manage-databases/>
- Cómo obtener la IP del cliente (`do-connecting-ip`): <https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/>
- Error `permission denied for schema public` en Dev Database: <https://docs.digitalocean.com/support/how-do-i-fix-a-permission-denied-for-schema-public-error-in-my-dev-database/>
- Precios: <https://www.digitalocean.com/pricing> y <https://docs.digitalocean.com/products/app-platform/details/pricing/>
- Informes internos, fuera del repositorio: informe de costos de infraestructura (Económico / Estándar / Propuesto) e informe a Gerencia del 27/10/2026 (Opción Optimizada ~US$97).
