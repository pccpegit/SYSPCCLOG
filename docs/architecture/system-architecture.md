# RQ System — System Architecture Design

**Project:** Supply Request Management System (Sistema de Gestión de Requerimientos)
**Stack:** Django + DRF | React + Tailwind CSS | PostgreSQL
**Date:** 2026-03-07
**Scope:** MVP Prototype

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     React SPA (Tailwind CSS)                │
│   Dashboard │ Requests │ Approvals │ Tracking │ Reports     │
└────────────────────────────┬────────────────────────────────┘
                             │ REST API (JWT Auth)
┌────────────────────────────▼────────────────────────────────┐
│                 Django REST Framework API                    │
│   accounts │ requests │ approvals │ logistics │ warehouse   │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                      PostgreSQL Database                    │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles
- **Single source of truth:** All state in PostgreSQL, frontend is stateless
- **RBAC everywhere:** Role checks at API layer + service layer
- **Immutable audit trail:** Every state change creates an Approval/Log record
- **Stateless API:** JWT authentication, no server sessions
- **Service layer:** Views → Services → Models (separation of concerns)

---

## 2. System Modules

| # | Django App | Responsibility |
|---|-----------|----------------|
| 1 | `accounts` | User auth (JWT), roles, profiles, permissions |
| 2 | `projects` | Project registry, budget lines |
| 3 | `requests` | SupplyRequest CRUD, line items, state machine, Excel upload |
| 4 | `approvals` | Multi-step approval chain, audit trail |
| 5 | `procurement` | Inventory check, quotations, supplier selection, Purchase Orders |
| 6 | `warehouse` | Reception, quality control, dispatch, delivery confirmation |
| 7 | `dashboard` | KPI aggregation, summary stats, reporting |
| 8 | `core` | Notifications, shared utils, audit log |

---

## 3. Request Lifecycle — State Machine

### 3.1 All States

```python
class RequestStatus(models.TextChoices):
    # Phase 1: Request Generation & Technical Validation
    DRAFT                = "DRAFT",                "Borrador"
    SUBMITTED            = "SUBMITTED",            "Enviado"
    TECHNICAL_REVIEW     = "TECHNICAL_REVIEW",     "Revisión Técnica"
    TECHNICAL_APPROVED   = "TECHNICAL_APPROVED",   "Aprobado Técnicamente"
    TECHNICAL_REJECTED   = "TECHNICAL_REJECTED",   "Rechazado por Residente"

    # Phase 2: Budget & Management Control
    BUDGET_REVIEW        = "BUDGET_REVIEW",        "Revisión Presupuestal"
    WITHIN_PROPOSAL      = "WITHIN_PROPOSAL",      "Dentro de Propuesta"
    ADDITIONAL_REQ       = "ADDITIONAL_REQ",       "Requerimiento Adicional"
    GM_REVIEW            = "GM_REVIEW",            "Revisión de Gerencia"
    GM_APPROVED          = "GM_APPROVED",          "Aprobado por Gerencia"
    GM_REJECTED          = "GM_REJECTED",          "Rechazado por Gerencia"
    VALIDATED            = "VALIDATED",            "Validado para Atención"

    # Phase 3: Inventory & Procurement
    STOCK_CHECK          = "STOCK_CHECK",          "Verificación de Stock"
    IN_STOCK             = "IN_STOCK",             "En Stock - Despachar"
    REQUIRES_PURCHASE    = "REQUIRES_PURCHASE",    "Requiere Compra"
    QUOTING              = "QUOTING",              "En Cotización"
    QUOTE_SELECTED       = "QUOTE_SELECTED",       "Cotización Seleccionada"
    COST_OVERRUN_REVIEW  = "COST_OVERRUN_REVIEW",  "Revisión Sobrecosto"
    PO_GENERATED         = "PO_GENERATED",         "OC Generada"

    # Phase 4: Reception & Closure
    RECEIVING            = "RECEIVING",            "En Recepción"
    QUALITY_CHECK        = "QUALITY_CHECK",        "Control de Calidad"
    QUALITY_REJECTED     = "QUALITY_REJECTED",     "Rechazado en Calidad"
    DISPATCHED_TO_SITE   = "DISPATCHED_TO_SITE",   "Despachado a Obra"
    DELIVERED            = "DELIVERED",            "Entregado al Usuario"
    USER_CONFORMITY      = "USER_CONFORMITY",      "Pendiente Conformidad"
    USER_CLAIM           = "USER_CLAIM",           "Reclamo del Usuario"
    CLOSED               = "CLOSED",              "Cerrado"
    CANCELLED            = "CANCELLED",           "Cancelado"
```

### 3.2 State Transition Diagram

```
                    ┌──────────────────────────────────────────────────┐
                    │              PHASE 1: GENERATION                 │
                    │                                                  │
  ┌───────┐  submit  ┌───────────┐  assign   ┌─────────────────┐     │
  │ DRAFT ├─────────►│ SUBMITTED ├──────────►│ TECHNICAL_REVIEW │     │
  └───┬───┘         └───────────┘           └────────┬──────────┘     │
      │cancel                                   approve│  │reject     │
      ▼                                               ▼  ▼            │
  ┌──────────┐                    ┌────────────────┐ ┌──────────────┐ │
  │CANCELLED │                    │TECH_APPROVED   │ │TECH_REJECTED │ │
  └──────────┘                    └───────┬────────┘ └──────────────┘ │
                    └─────────────────────┼────────────────────────────┘
                    ┌─────────────────────┼────────────────────────────┐
                    │          PHASE 2: BUDGET CONTROL                 │
                    │                     ▼                            │
                    │           ┌───────────────┐                      │
                    │           │ BUDGET_REVIEW  │                      │
                    │           └───┬────────┬──┘                      │
                    │    within_prop│        │additional                │
                    │              ▼        ▼                          │
                    │  ┌──────────────┐ ┌──────────────┐              │
                    │  │WITHIN_PROPOSAL│ │ADDITIONAL_REQ│              │
                    │  └──────┬───────┘ └──────┬───────┘              │
                    │         │                │ gm_review             │
                    │         │         ┌──────▼──────┐               │
                    │         │         │  GM_REVIEW   │               │
                    │         │         └───┬──────┬──┘               │
                    │         │    approve  │      │ reject            │
                    │         │         ┌───▼───┐ ┌▼───────────┐      │
                    │         │         │GM_APPR│ │GM_REJECTED │      │
                    │         │         └───┬───┘ └────────────┘      │
                    │         │             │                          │
                    │         └──────┬──────┘                          │
                    │                ▼                                  │
                    │          ┌───────────┐                           │
                    │          │ VALIDATED  │                           │
                    │          └─────┬─────┘                           │
                    └────────────────┼─────────────────────────────────┘
                    ┌────────────────┼─────────────────────────────────┐
                    │      PHASE 3: PROCUREMENT                       │
                    │                ▼                                  │
                    │         ┌─────────────┐                          │
                    │         │ STOCK_CHECK  │                          │
                    │         └──┬───────┬──┘                          │
                    │   in_stock │       │ no_stock                     │
                    │           ▼       ▼                              │
                    │  ┌──────────┐ ┌────────────────┐                │
                    │  │ IN_STOCK │ │REQUIRES_PURCHASE│                │
                    │  └────┬─────┘ └───────┬────────┘                │
                    │       │               ▼                          │
                    │       │        ┌──────────┐                      │
                    │       │        │ QUOTING  │                      │
                    │       │        └────┬─────┘                      │
                    │       │             ▼                             │
                    │       │    ┌───────────────┐                     │
                    │       │    │QUOTE_SELECTED │                     │
                    │       │    └───┬───────┬───┘                     │
                    │       │ within│       │overrun                    │
                    │       │       │  ┌────▼──────────────┐           │
                    │       │       │  │COST_OVERRUN_REVIEW│           │
                    │       │       │  └────────┬──────────┘           │
                    │       │       │           │ gm_approve            │
                    │       ▼       ▼           ▼                      │
                    │      ┌──────────────┐                            │
                    │      │ PO_GENERATED │ (or dispatched from stock) │
                    │      └──────┬───────┘                            │
                    └─────────────┼────────────────────────────────────┘
                    ┌─────────────┼────────────────────────────────────┐
                    │     PHASE 4: RECEPTION & CLOSURE                │
                    │             ▼                                     │
                    │      ┌───────────┐                               │
                    │      │ RECEIVING │                               │
                    │      └─────┬─────┘                               │
                    │            ▼                                      │
                    │   ┌───────────────┐                              │
                    │   │ QUALITY_CHECK │                              │
                    │   └───┬───────┬───┘                              │
                    │  pass │       │ fail                              │
                    │       │  ┌────▼───────────┐                      │
                    │       │  │QUALITY_REJECTED│──► claim to supplier │
                    │       ▼  └────────────────┘                      │
                    │ ┌──────────────────┐                             │
                    │ │DISPATCHED_TO_SITE│                             │
                    │ └────────┬─────────┘                             │
                    │          ▼                                        │
                    │    ┌───────────┐                                  │
                    │    │ DELIVERED │                                  │
                    │    └─────┬─────┘                                  │
                    │          ▼                                        │
                    │  ┌────────────────┐                              │
                    │  │USER_CONFORMITY │                              │
                    │  └───┬────────┬───┘                              │
                    │ ok   │        │ not ok                            │
                    │      ▼        ▼                                   │
                    │ ┌────────┐ ┌────────────┐                        │
                    │ │ CLOSED │ │ USER_CLAIM │──► logistics review    │
                    │ └────────┘ └────────────┘                        │
                    └──────────────────────────────────────────────────┘
```

### 3.3 Transition Rules

| From | To | Action | Triggered By |
|------|----|--------|-------------|
| DRAFT | SUBMITTED | `submit` | Usuario |
| DRAFT | CANCELLED | `cancel` | Usuario, Admin |
| SUBMITTED | TECHNICAL_REVIEW | `assign_review` | System/Residente |
| TECHNICAL_REVIEW | TECHNICAL_APPROVED | `approve_technical` | Residente de Proyecto |
| TECHNICAL_REVIEW | TECHNICAL_REJECTED | `reject_technical` | Residente de Proyecto |
| TECHNICAL_REVIEW | DRAFT | `return_for_correction` | Residente de Proyecto |
| TECHNICAL_APPROVED | BUDGET_REVIEW | `send_to_budget` | System |
| BUDGET_REVIEW | WITHIN_PROPOSAL | `classify_within_proposal` | Control de Proyecto |
| BUDGET_REVIEW | ADDITIONAL_REQ | `classify_additional` | Control de Proyecto |
| WITHIN_PROPOSAL | VALIDATED | `validate` | System |
| ADDITIONAL_REQ | GM_REVIEW | `escalate_to_gm` | System |
| GM_REVIEW | GM_APPROVED | `gm_approve` | Gerente General |
| GM_REVIEW | GM_REJECTED | `gm_reject` | Gerente General |
| GM_APPROVED | VALIDATED | `validate` | System |
| VALIDATED | STOCK_CHECK | `check_stock` | Coordinador Logístico |
| STOCK_CHECK | IN_STOCK | `mark_in_stock` | Coordinador Logístico |
| STOCK_CHECK | REQUIRES_PURCHASE | `mark_no_stock` | Coordinador Logístico |
| IN_STOCK | DISPATCHED_TO_SITE | `dispatch_from_stock` | Coordinador Logístico |
| REQUIRES_PURCHASE | QUOTING | `request_quotes` | Coordinador Logístico |
| QUOTING | QUOTE_SELECTED | `select_quote` | Coordinador Logístico |
| QUOTE_SELECTED | PO_GENERATED | `generate_po` | Coordinador Logístico |
| QUOTE_SELECTED | COST_OVERRUN_REVIEW | `escalate_cost` | System |
| COST_OVERRUN_REVIEW | PO_GENERATED | `gm_approve_cost` | Gerente General |
| PO_GENERATED | RECEIVING | `receive_materials` | Almacén Central |
| RECEIVING | QUALITY_CHECK | `start_qc` | Almacén Central |
| QUALITY_CHECK | DISPATCHED_TO_SITE | `pass_qc` | Almacén Central |
| QUALITY_CHECK | QUALITY_REJECTED | `fail_qc` | Almacén Central |
| DISPATCHED_TO_SITE | DELIVERED | `confirm_delivery` | Almacén de Obra |
| DELIVERED | USER_CONFORMITY | `request_conformity` | System |
| USER_CONFORMITY | CLOSED | `confirm_conformity` | Usuario |
| USER_CONFORMITY | USER_CLAIM | `raise_claim` | Usuario |
| USER_CLAIM | STOCK_CHECK | `reprocess_claim` | Coordinador Logístico |

---

## 4. Service Architecture

### 4.1 Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18 + Tailwind CSS | SPA UI |
| Routing | React Router v6 | Client-side routing |
| HTTP Client | Axios | API communication |
| Backend | Django 5.x + DRF 3.x | REST API |
| Auth | SimpleJWT | JWT token authentication |
| Database | PostgreSQL 16 | Primary data store |
| File Storage | Local (MVP) → S3 (prod) | Upload storage |
| Excel Parsing | openpyxl (backend), SheetJS (frontend) | Excel import |

### 4.2 Project Structure

```
syspcclog/
├── manage.py
├── requirements.txt
├── config/
│   ├── __init__.py
│   ├── settings/
│   │   ├── base.py
│   │   ├── development.py
│   │   └── production.py
│   ├── urls.py
│   └── wsgi.py
├── apps/
│   ├── accounts/
│   │   ├── models.py          # CustomUser, Role
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── permissions.py     # IsRole, IsProjectResident, etc.
│   │   ├── services.py
│   │   └── urls.py
│   ├── projects/
│   │   ├── models.py          # Project, BudgetLine
│   │   ├── serializers.py
│   │   ├── views.py
│   │   └── urls.py
│   ├── requests/
│   │   ├── models.py          # SupplyRequest, RequestItem, Attachment
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py        # RequestTransitionService
│   │   ├── state_machine.py   # TRANSITION_MAP
│   │   └── urls.py
│   ├── approvals/
│   │   ├── models.py          # Approval (audit trail)
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py
│   │   └── urls.py
│   ├── procurement/
│   │   ├── models.py          # Supplier, Quotation, PurchaseOrder
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py
│   │   └── urls.py
│   ├── warehouse/
│   │   ├── models.py          # InventoryItem, Reception, QualityCheck, Claim
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py
│   │   └── urls.py
│   └── dashboard/
│       ├── views.py
│       ├── services.py
│       └── urls.py
├── common/
│   ├── pagination.py
│   ├── exceptions.py
│   └── validators.py
└── frontend/                   # React app (separate build)
    ├── package.json
    ├── tailwind.config.js
    └── src/
        ├── components/
        ├── pages/
        ├── hooks/
        ├── services/
        ├── context/
        ├── utils/
        └── router/
```

---

## 5. API Responsibilities

### 5.1 Auth Module (`/api/v1/auth/`)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| POST | `/auth/login/` | JWT login, returns access + refresh | All |
| POST | `/auth/refresh/` | Refresh JWT token | All |
| GET | `/auth/me/` | Current user profile + role | All |
| POST | `/auth/logout/` | Blacklist refresh token | All |

### 5.2 Users Module (`/api/v1/users/`)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/users/` | List users (filtered by role) | Admin |
| POST | `/users/` | Create user | Admin |
| PATCH | `/users/{id}/` | Update user/role | Admin |

### 5.3 Projects Module (`/api/v1/projects/`)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/projects/` | List projects | All authenticated |
| GET | `/projects/{id}/` | Project detail + budget summary | All authenticated |
| GET | `/projects/{id}/budget/` | Budget breakdown | Control, GM, Admin |

### 5.4 Requests Module (`/api/v1/requests/`)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/requests/` | List requests (filtered by role, project, status) | All authenticated |
| POST | `/requests/` | Create new supply request | Usuario, Residente |
| GET | `/requests/{id}/` | Request detail with items + history | All authenticated |
| PATCH | `/requests/{id}/` | Update draft request | Owner (Usuario) |
| POST | `/requests/{id}/action/` | Execute state transition | Role-dependent |
| GET | `/requests/{id}/activity/` | Activity/audit log | All authenticated |
| POST | `/requests/{id}/attachments/` | Upload file | Owner, Residente |
| POST | `/requests/{id}/import-excel/` | Import items from Excel | Owner |

### 5.5 Approvals Module (`/api/v1/approvals/`)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/approvals/pending/` | My pending approvals queue | Residente, Control, GM |
| GET | `/approvals/history/` | My approval history | All |
| GET | `/approvals/request/{id}/` | Approval trail for a request | All authenticated |

### 5.6 Procurement Module (`/api/v1/procurement/`)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/procurement/suppliers/` | List suppliers | Logística |
| POST | `/procurement/quotations/` | Create quotation for request | Logística |
| POST | `/procurement/quotations/{id}/select/` | Select winning quotation | Logística |
| POST | `/procurement/purchase-orders/` | Generate PO | Logística |
| GET | `/procurement/purchase-orders/` | List POs | Logística, GM |

### 5.7 Warehouse Module (`/api/v1/warehouse/`)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/warehouse/inventory/` | Check stock levels | Logística, Almacén |
| POST | `/warehouse/receptions/` | Register material reception | Almacén Central |
| POST | `/warehouse/receptions/{id}/quality-check/` | Submit QC result | Almacén Central |
| POST | `/warehouse/dispatches/` | Dispatch to site | Almacén de Obra |
| POST | `/warehouse/claims/` | Register claim | Usuario, Almacén |

### 5.8 Dashboard Module (`/api/v1/dashboard/`)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | `/dashboard/summary/` | Role-specific KPI summary | All authenticated |
| GET | `/dashboard/requests-by-status/` | Request count by status | All authenticated |
| GET | `/dashboard/budget-consumption/` | Budget usage by project | Control, GM |

---

## 6. Roles & Permissions Matrix

| Action | Usuario | Residente | Control | Gerente | Logística | Almacén C. | Almacén O. |
|--------|---------|-----------|---------|---------|-----------|------------|------------|
| Create RQ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Edit draft RQ | ✅(own) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Submit RQ | ✅(own) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Tech review | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Budget review | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| GM approval | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Check stock | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Manage quotes | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Generate PO | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Receive materials | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Quality check | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Dispatch to site | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Confirm delivery | ✅(own) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Raise claim | ✅(own) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View all RQs | ❌ | ✅(proj) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dashboard | ✅(own) | ✅(proj) | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 7. MVP Screens (16 total)

| # | Screen | Primary Role(s) |
|---|--------|-----------------|
| 1 | Login | All |
| 2 | Dashboard (role-adaptive) | All |
| 3 | New Supply Request | Usuario |
| 4 | My Requests List | Usuario |
| 5 | Request Detail + Tracking | All |
| 6 | Pending Approvals Queue | Residente, Control, GM |
| 7 | Technical Review | Residente |
| 8 | Budget Review | Control de Proyecto |
| 9 | GM Approval | Gerente General |
| 10 | Logistics Queue | Logística |
| 11 | Stock Check | Logística |
| 12 | Quotation Management | Logística |
| 13 | Purchase Order View | Logística |
| 14 | Material Reception | Almacén Central |
| 15 | Site Dispatch | Almacén de Obra |
| 16 | User Profile | All |

---

## 8. MVP Development Roadmap

| Phase | Focus | Duration |
|-------|-------|----------|
| 1 | Foundation: Django project, auth, user roles, project model | 2 weeks |
| 2 | Request CRUD: create, edit, submit, list, Excel import | 2 weeks |
| 3 | Approval Workflow: tech review, budget review, GM approval | 2 weeks |
| 4 | Procurement: stock check, quotations, PO generation | 2 weeks |
| 5 | Warehouse: reception, QC, dispatch, delivery, conformity | 2 weeks |
| 6 | Dashboard, tracking, polish, testing | 3 weeks |

**Total MVP: ~13 weeks**

---

## 9. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth method | JWT (SimpleJWT) | Stateless API, easy React integration |
| State machine | Custom Python (not library) | Simple enough for this workflow, no dependency |
| File storage | Local filesystem (MVP) | Simplicity; migrate to S3 later |
| Monolith vs micro | Monolith (multi-app Django) | MVP speed; apps can be extracted later |
| Frontend state | React Context + custom hooks | Lightweight; can migrate to React Query |
| CSS framework | Tailwind CSS | Rapid prototyping, consistent design |
| API format | REST (not GraphQL) | DRF ecosystem, team familiarity |
| Excel handling | openpyxl (server) + SheetJS (client) | Preview on client, validate on server |
