# Plataforma SYSPCC

Plataforma interna de PCC Ingeniería y Construcción para la gestión del abastecimiento: requerimientos (RQ) con flujo de aprobaciones, cotizaciones y órdenes de compra, almacén e inventario, administración de pasajes, soporte TI y recursos humanos.

## Stack tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Backend | Django + Django REST Framework | 5.1 / 3.15 |
| Frontend | React + React Router + Tailwind CSS | 19 / 7 / 4.2 |
| Lenguaje / runtime | Python / Node.js | 3.12 / 22 |
| Base de datos | SQLite (desarrollo) / PostgreSQL (producción) | — / 16 |
| Caché y broker | Redis | 7 |
| Cola de tareas | Celery + Celery Beat | 5.4 |
| Autenticación | JWT (SimpleJWT) en cookies httpOnly + protección CSRF | 5.3 |
| Documentación de la API | DRF Spectacular (OpenAPI / Swagger) | 0.27 |
| Empaquetado del frontend | Vite | 7.3 |
| Pruebas | pytest + pytest-django / Vitest + Testing Library | 8.3 / 3.2 |
| Contenedores | Docker + Docker Compose | — |

## Arquitectura

```
┌──────────────┐     ┌───────────────┐     ┌────────────┐
│   Frontend   │────>│    Backend    │────>│  Base de   │
│ React / Vite │     │ Django / DRF  │     │   datos    │
│ Puerto: 5173 │     │ Puerto: 8000  │     │ SQLite/PG  │
└──────────────┘     └───────┬───────┘     └────────────┘
                             │
                     ┌───────┴───────┐
                     │     Redis     │
                     │ Puerto: 6379  │
                     └───────┬───────┘
         ┌───────────────────┼────────────────────┐
┌────────┴─────────┐ ┌───────┴────────┐ ┌─────────┴────────┐
│  Celery worker   │ │ Celery worker  │ │   Celery Beat    │
│ (cola por defecto)│ │ RR. HH. (hr_cv)│ │ (tareas program.)│
└──────────────────┘ └────────────────┘ └──────────────────┘
```

## Módulos

### Backend (apps de Django)

| App | Descripción |
|-----|------------|
| `core` | Usuarios, roles, autenticación (JWT en cookies), proyectos, departamentos, planes anuales y personal |
| `rq` | Requerimientos, motor de flujo de aprobaciones (`WorkflowEngine`), proveedores, cotizaciones, órdenes de compra, reclamos, adjuntos y notificaciones; búsqueda en el catálogo del almacén y disponibilidad de stock para capturar y revisar los ítems |
| `warehouse` | Catálogo e inventario, stock por almacén, movimientos y vales, entregas de EPP, ubicaciones, resumen de movimiento (kardex), importación del Excel de inventario, recepciones y despachos de RQ e integración con OneDrive |
| `administracion` | Pasajes, proveedores de pasajes, políticas de devolución, puestos y tipo de cambio |
| `support` | Tickets de soporte TI y sus comentarios |
| `hr` | Recursos Humanos: plantillas y contratos (Word/PDF), asistente de extracción de datos y análisis masivo de CVs |

### Frontend (módulos de la SPA)

| Ruta | Shell | Quién accede |
|------|-------|--------------|
| `/rq` | `AppShell` | Todo usuario autenticado (las opciones del menú dependen del rol) |
| `/almacen` | `WarehouseShell` | `CENTRAL_WAREHOUSE`, `SITE_WAREHOUSE`, `LOGISTICS_COORDINATOR`, `LOGISTICS_SUPERVISOR`, `LOGISTICS_CHIEF` |
| `/admin` | `AdminShell` | `ADMIN_MANAGER`, `GENERAL_MANAGER`, `PASAJES_MANAGER` |
| `/sistema` | `SystemAdminShell` | Solo superusuario de Django (`is_superuser`) |
| `/rrhh` | `HRShell` | `HR_MANAGER` (lectura y escritura) y `GENERAL_MANAGER` (solo lectura) |
| `/soporte` | `SupportShell` | Todo usuario autenticado |
| `/settings` | — | Todo usuario autenticado (perfil, apariencia claro/oscuro/automático, firma, seguridad) |

## Roles

| Rol | Flujo | Alcance |
|-----|-------|---------|
| Solicitante (`REQUESTER`) | Ambos | Creación del RQ y conformidad final |
| Residente de Proyecto (`PROJECT_RESIDENT`) | Operaciones | Validación técnica |
| Control de Proyecto (`PROJECT_CONTROL`) | Operaciones | Validación presupuestal y costo de la cotización |
| Coordinador Logístico (`LOGISTICS_COORDINATOR`) | Operaciones | Compras y logística |
| Almacén de Obra (`SITE_WAREHOUSE`) | Operaciones | Recepción en obra |
| Jefe Directo (`DIRECT_SUPERVISOR`) | Administrativo | Primera aprobación |
| Gerente Administrativo (`ADMIN_MANAGER`) | Administrativo | Presupuesto vs. plan anual y costo de la cotización |
| Supervisor Logístico (`LOGISTICS_SUPERVISOR`) | Administrativo | Compras y logística |
| Jefe Logístico (`LOGISTICS_CHIEF`) | Administrativo | Comparación y selección de cotizaciones |
| Gerente General (`GENERAL_MANAGER`) | Ambos | Aprobación final (adicionales, fuera de plan y sobrecostos) |
| Almacén Central (`CENTRAL_WAREHOUSE`) | Ambos | Recepción, control de calidad y despacho |
| Gestor de Pasajes (`PASAJES_MANAGER`) | — | Módulo de Administración (pasajes) |
| Gestor de RR. HH. (`HR_MANAGER`) | — | Módulo de Recursos Humanos |

El superadministrador (`is_superuser` de Django) no es un rol de negocio: solo él gestiona usuarios y proyectos en `/sistema`.

## Requisitos previos

- Docker y Docker Compose
- Git

## Puesta en marcha

```bash
# Clonar el repositorio
git clone https://github.com/pccpegit/SYSPCCLOG.git
cd SYSPCCLOG

# Crear el archivo .env.docker en la raíz del repositorio (no se versiona).
# Las variables de referencia están en backend/.env.example y frontend/.env.example.

# Construir y levantar todos los servicios
docker compose --env-file .env.docker up --build

# Ejecutar las migraciones
docker compose exec backend python manage.py migrate

# Cargar datos de demostración (opcional)
docker compose exec backend python manage.py seed_demo
```

## Pruebas

```bash
# Backend (pytest)
docker compose exec backend pytest

# Frontend (Vitest y ESLint), desde frontend/
npm test
npm run lint
```

## Acceso

| Servicio | URL |
|----------|-----|
| Frontend | http://localhost:5173 |
| API del backend | http://localhost:8000/api/v1/ |
| Documentación de la API (Swagger; requiere usuario staff) | http://localhost:8000/api/docs/ |
| Panel de administración de Django | http://localhost:8000/mgmt-panel/ |
| Verificación de salud | http://localhost:8000/healthz/ |

## Estructura del proyecto

```
SYSPCCLOG/
├── backend/
│   ├── apps/
│   │   ├── core/            # Autenticación, usuarios, proyectos, departamentos, personal
│   │   ├── rq/              # Requerimientos, aprobaciones, WorkflowEngine, compras
│   │   ├── warehouse/       # Inventario, movimientos, EPP, importación, recepciones/despachos
│   │   ├── administracion/  # Pasajes, políticas de devolución, proveedores de pasajes
│   │   ├── support/         # Tickets de soporte TI
│   │   └── hr/              # Contratos, plantillas y análisis de CVs
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py
│   │   │   ├── development.py
│   │   │   ├── production.py
│   │   │   └── guards.py
│   │   ├── urls.py
│   │   └── celery.py
│   ├── Dockerfile
│   ├── manage.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/             # Clientes de la API (Axios)
│   │   ├── components/      # Componentes reutilizables (layout, ui, almacen, rrhh, ...)
│   │   ├── context/         # Contextos de autenticación, avisos y tema
│   │   ├── data/            # Constantes de la interfaz
│   │   ├── hooks/           # Hooks personalizados
│   │   ├── pages/           # Páginas por módulo
│   │   └── utils/           # Utilidades (formato, exportación a Excel, tema, ...)
│   ├── Dockerfile
│   ├── package.json
│   └── vite.config.js
├── docs/                    # Documentos de arquitectura y diseño
├── TICKETS.md               # Registro de tickets (SYSPCC-NNN)
├── docker-compose.yml
└── .gitignore
```

## Configuración por entorno

| Variable | Desarrollo | Producción |
|----------|-----------|-----------|
| `DJANGO_SETTINGS_MODULE` | `config.settings.development` | `config.settings.production` |
| `DEBUG` | `True` (lo fuerza `development.py`) | `False` (lo fuerza `production.py`) |
| Base de datos | SQLite por defecto (`DB_ENGINE` y `DB_NAME` opcionales) | PostgreSQL: `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` (conexión con SSL) |
| `SECRET_KEY` | Obligatoria (no tiene valor por defecto) | Obligatoria; aleatoria y secreta |
| `ALLOWED_HOSTS` | `*` (lo fija `development.py`) | Solo los dominios del sistema |
| `CORS_ALLOWED_ORIGINS` | CORS abierto en desarrollo | URL(s) del frontend |
| `CSRF_TRUSTED_ORIGINS` | Orígenes locales del servidor de Vite | URL(s) del frontend |
| `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` | `redis://localhost:6379/0`, `/1` y `/2` por defecto | URL de Redis del entorno |

Integraciones opcionales (el sistema arranca sin ellas):

| Variable | Uso |
|----------|-----|
| `ANTHROPIC_API_KEY` | Asistente de contratos y análisis de CVs en RR. HH. Sin ella los contratos se generan solo con el formulario y el análisis de CVs queda deshabilitado (en desarrollo existe un proveedor simulado con `HR_CV_PROVIDER=fake`) |
| `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_TENANT`, `ONEDRIVE_TOKEN_ENCRYPTION_KEY` | Subida de los vales del almacén a OneDrive |
| `RUC_API_TOKEN` | Consulta de RUC de proveedores de pasajes |
| `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `WAREHOUSE_ALERT_RECIPIENTS` | Envío de correos y alertas de stock bajo |
| `HR_COMPANY_*` | Datos de la empresa que se imprimen en los contratos |

## Documentación

- `docs/01_Casos_de_Uso.md`: actores, casos de uso y secuencias por módulo.
- `docs/02_Arquitectura_Alto_Nivel.md`: contexto, capas, módulos y flujos de negocio.
- `docs/03_Arquitectura_Bajo_Nivel.md`: estructura interna del backend y del frontend, motor de flujo, autenticación, tareas y modelo de datos.
- `docs/04_Diagrama_de_Clases.md`: diagramas de clases por módulo.
- `TICKETS.md`: registro de cambios por ticket.

## Licencia

Propietario. Uso interno exclusivo.
