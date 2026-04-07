# SYSPCC Platform

Enterprise platform for supply chain management, procurement workflows, warehouse operations, and logistics coordination.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend | Django + Django REST Framework | 5.1 / 3.15 |
| Frontend | React + Tailwind CSS | 19 / 4.2 |
| Database | SQLite (dev) / PostgreSQL (prod) | — / 16 |
| Cache & Broker | Redis | 7 |
| Task Queue | Celery + Celery Beat | 5.4 |
| Auth | JWT (SimpleJWT) | 5.3 |
| API Docs | DRF Spectacular (Swagger/OpenAPI) | 0.27 |
| Bundler | Vite | 7.3 |
| Containerization | Docker + Docker Compose | — |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐
│   Frontend   │────>│   Backend    │────>│ Database  │
│  React/Vite  │     │  Django/DRF  │     │ SQLite/PG │
│  Port: 5173  │     │  Port: 8000  │     └───────────┘
└─────────────┘     └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    │    Redis     │
                    │  Port: 6379  │
                    └──────┬───────┘
                           │
                ┌──────────┴──────────┐
                │                     │
         ┌──────┴──────┐    ┌────────┴────────┐
         │ Celery Worker│    │  Celery Beat    │
         │ (async tasks)│    │ (scheduled jobs)│
         └─────────────┘    └─────────────────┘
```

## Modules

| App | Description |
|-----|------------|
| `core` | Users, roles, projects, departments, authentication |
| `rq` | Supply requests, approval workflow, suppliers, quotations, purchase orders, notifications |
| `warehouse` | Inventory, receipts, dispatch, quality control |

## Roles

| Role | Flow | Scope |
|------|------|-------|
| Requester | Both | Request creation |
| Project Resident | Operations | Technical review |
| Project Control | Operations | Budget review |
| Logistics Coordinator | Operations | Procurement |
| Site Warehouse | Operations | On-site reception |
| Direct Supervisor | Administrative | First approval |
| Admin Manager | Administrative | Budget vs annual plan |
| Logistics Supervisor | Administrative | Procurement |
| Logistics Chief | Administrative | Quote comparison |
| General Manager | Both | Final approval |
| Central Warehouse | Both | Reception & quality control |

## Prerequisites

- Docker and Docker Compose
- Git

## Getting Started

```bash
# Clone the repository
git clone https://github.com/pccpegit/syspcc-platform.git
cd syspcc-platform

# Copy environment variables
cp .env.docker.example .env.docker
# Edit .env.docker with your local values

# Build and start all services
docker compose --env-file .env.docker up --build

# Run database migrations
docker compose exec backend python manage.py migrate

# Load demo data (optional)
docker compose exec backend python manage.py seed_demo
```

## Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000/api/v1/ |
| API Documentation | http://localhost:8000/api/schema/swagger-ui/ |
| Django Admin | http://localhost:8000/admin/ |

## Project Structure

```
syspcc-platform/
├── backend/
│   ├── apps/
│   │   ├── core/          # Auth, users, projects, departments
│   │   ├── rq/            # Requests, approvals, workflow engine
│   │   └── warehouse/     # Inventory, receipts, dispatch
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py
│   │   │   ├── development.py
│   │   │   └── production.py
│   │   ├── urls.py
│   │   └── celery.py
│   ├── Dockerfile
│   ├── manage.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/           # API client (Axios)
│   │   ├── components/    # Reusable UI components
│   │   ├── context/       # Auth & toast context
│   │   ├── pages/         # Route pages
│   │   └── hooks/         # Custom React hooks
│   ├── Dockerfile
│   ├── package.json
│   └── vite.config.js
├── docs/                  # Architecture & design documents
├── docker-compose.yml
└── .gitignore
```

## Environment Configuration

| Variable | Dev | Production |
|----------|-----|-----------|
| `DEBUG` | `True` | `False` |
| `DB_ENGINE` | `sqlite3` | `postgresql` |
| `SECRET_KEY` | dev key | random 50+ chars |
| `ALLOWED_HOSTS` | `*` | domain only |
| `CORS_ALLOWED_ORIGINS` | `localhost:5173` | production URL |

## License

Proprietary. Internal use only.
