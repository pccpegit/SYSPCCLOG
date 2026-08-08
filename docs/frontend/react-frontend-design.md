# RQ System — React Frontend Architecture Design

**Stack:** React 18 + Tailwind CSS + React Router v6 + Axios
**Date:** 2026-03-07

---

## 1. Dashboard Design

The dashboard adapts based on the authenticated user's role. All roles share a common layout shell.

### 1.1 Common Layout Shell

```
+------------------------------------------------------------------+
|  [LOGO]  RQ System                      [User Role] [User Name]  |
+------------------------------------------------------------------+
|          |                                                        |
| SIDEBAR  |  MAIN CONTENT AREA                                    |
|          |                                                        |
| Dashboard|                                                        |
| Requests |                                                        |
| Approvals|                                                        |
| Tracking |                                                        |
| Reports  |                                                        |
| Settings |                                                        |
|          |                                                        |
+----------+--------------------------------------------------------+
```

### 1.2 Dashboard — Usuario (Requester) View

```
+------------------------------------------------------------------+
| Dashboard                                         [+ New Request] |
+------------------------------------------------------------------+
|  [Total: 12]   [Pending: 3]   [In Procurement: 4]   [Done: 5]   |
+------------------------------------------------------------------+
|  My Recent Requests                              [View All]       |
|  +----------------------------------------------------------+    |
|  | RQ#   | Description        | Project   | Status  | Date  |    |
|  | RQ-042| Cemento Portland   | OBRA-14   | PENDING | 05/03 |    |
|  | RQ-041| Varillas 3/8"      | OBRA-14   | APPROVED| 02/03 |    |
|  | RQ-040| Encofrado metálico | OBRA-11   | IN PROC | 28/02 |    |
|  +----------------------------------------------------------+    |
|                                                                   |
|  Request Status Distribution                                      |
|  Pending     ===  3 (25%)                                        |
|  Approved    ======= 5 (42%)                                     |
|  Procurement ====  2 (17%)                                       |
|  Delivered   ===  2 (17%)                                        |
+------------------------------------------------------------------+
```

### 1.3 Dashboard — Residente de Proyecto View

```
+------------------------------------------------------------------+
| Dashboard                                                         |
+------------------------------------------------------------------+
|  [Awaiting Review: 5]  [Approved Today: 2]  [Rejected: 1]       |
+------------------------------------------------------------------+
|  Requests Awaiting Technical Review           [Go to Approvals]  |
|  +----------------------------------------------------------+    |
|  | RQ#   | Requester   | Project   | Priority | Received    |    |
|  | RQ-044| A. Torres   | OBRA-14   | HIGH     | 07/03 09:15 |    |
|  | RQ-043| M. Quispe   | OBRA-14   | NORMAL   | 06/03 14:00 |    |
|  | RQ-038| J. Salas    | OBRA-11   | URGENT   | 05/03 08:30 |    |
|  +----------------------------------------------------------+    |
|  My Projects:                                                     |
|  | OBRA-14  |  7 open  |  3 pending review  |  0 blocked  |     |
|  | OBRA-11  |  4 open  |  2 pending review  |  1 blocked  |     |
+------------------------------------------------------------------+
```

### 1.4 Dashboard — Control de Proyecto View

```
+------------------------------------------------------------------+
| Dashboard                                                         |
+------------------------------------------------------------------+
|  [Budget Queue: 4]  [Within Proposal: 28]  [Additional: 6]      |
+------------------------------------------------------------------+
|  Requests Awaiting Budget Review              [Go to Approvals]  |
|  | RQ-044| OBRA-14  | S/ 12,500  | Available: S/ 45,000 | HIGH  |
|  | RQ-043| OBRA-14  | S/ 3,200   | Available: S/ 45,000 | NORMAL|
|  | RQ-040| OBRA-11  | S/ 78,000  | Available: S/ 15,000 | URGENT|
|                                                                   |
|  Budget Consumption by Project                                    |
|  OBRA-14  [====================----] 68%  S/340k / S/500k       |
|  OBRA-11  [==============================] 98%  S/490k / S/500k |
+------------------------------------------------------------------+
```

### 1.5 Dashboard — Gerente General View

```
+------------------------------------------------------------------+
| Dashboard                                                         |
+------------------------------------------------------------------+
|  [Pending My Approval: 2]  [Approved This Month: 15]            |
|  [Total Spend: S/ 1,240,000]                                    |
+------------------------------------------------------------------+
|  Requires My Approval (Escalated)             [Go to Approvals]  |
|  | RQ-040| OBRA-11 | ADDITIONAL REQ | S/ 78,000  | 2 days wait |
|  | RQ-035| OBRA-09 | COST OVERRUN   | S/ 12,000  | 1 day wait  |
|                                                                   |
|  Company-wide Request Volume (Last 30 days)                      |
|  [Bar chart: requests by week, color-coded by status]            |
+------------------------------------------------------------------+
```

### 1.6 Dashboard — Coordinador Logístico View

```
+------------------------------------------------------------------+
| Dashboard                                                         |
+------------------------------------------------------------------+
|  [Stock Check: 3]  [Pending Quotes: 5]  [Active OCs: 8]         |
+------------------------------------------------------------------+
|  Requests Ready for Logistics                 [Go to Logistics]  |
|  | RQ-044| OBRA-14 | 5 items | PARTIAL STOCK | Check Stock     |
|  | RQ-043| OBRA-14 | 2 items | OUT OF STOCK  | Request Quote   |
|  | RQ-039| OBRA-11 | 3 items | IN STOCK      | Dispatch        |
|                                                                   |
|  Open Purchase Orders                                             |
|  | OC-089 | Ferretería ABC | S/ 8,500  | Expected: 10/03/2026  |
|  | OC-088 | Proveedor XYZ  | S/ 24,000 | Expected: 12/03/2026  |
+------------------------------------------------------------------+
```

**Summary Card Tailwind pattern:**
- Container: `bg-white rounded-2xl shadow-sm p-6 border-l-4 border-blue-500`
- Label: `text-sm font-medium text-gray-500 uppercase tracking-wide`
- Value: `text-3xl font-bold text-gray-900`

---

## 2. Request Creation Screen

```
+------------------------------------------------------------------+
| New Supply Request                              [Cancel] [Submit] |
+------------------------------------------------------------------+
|                                                                   |
|  -- SECTION 1: General Information ------------------------------ |
|  Project *             Priority *          Request Date           |
|  [Select Project  v]   [NORMAL      v]     [07/03/2026  ]        |
|                                                                   |
|  Request Description *                                            |
|  [________________________________________________]              |
|                                                                   |
|  Justification / Technical Basis *                               |
|  [________________________________________________]              |
|  [________________________________________________]              |
|                                                                   |
|  Required Delivery Date *     Work Location                       |
|  [__/__/____]                 [________________]                 |
|                                                                   |
|  -- SECTION 2: Line Items --------------------------------------- |
|  [+ Add Item]  [Upload Excel]                                    |
|  +--+------------------+-------+--------+------------------+-+   |
|  |# | Description      | Qty   | Unit   | Specifications   |X|   |
|  |1 | [_____________]  | [___] | [__v]  | [_____________]  |x|   |
|  |2 | [_____________]  | [___] | [__v]  | [_____________]  |x|   |
|  +--+------------------+-------+--------+------------------+-+   |
|                                                                   |
|  -- SECTION 3: Attachments ------------------------------------- |
|  +------------------------------------------------------+        |
|  |   Drag and drop files here, or click to browse       |        |
|  |   Supported: PDF, Excel (.xlsx), Images (JPG, PNG)   |        |
|  +------------------------------------------------------+        |
|  [spec-doc.pdf  X]  [lista-materiales.xlsx  X]                  |
|                                                                   |
|  -- SECTION 4: Excel Import ------------------------------------ |
|  Upload Excel with line items:  [Choose File]                    |
|  +----------------------------------------------------------+    |
|  | Excel Preview (5 rows found)                              |    |
|  | # | Description      | Qty | Unit | Specifications       |    |
|  | 1 | Cemento Portland | 50  | SACO | Tipo I, 42.5 kg      |    |
|  | 2 | Arena gruesa     | 5   | M3   | Limpia, sin arcilla  |    |
|  | [Import All] [Cancel]                                     |    |
|  +----------------------------------------------------------+    |
|                                                                   |
|                              [Cancel]  [Save Draft]  [Submit]    |
+------------------------------------------------------------------+
```

**Priority badge colors:**
| Priority | Tailwind Classes |
|----------|-----------------|
| URGENT   | `bg-red-100 text-red-700` |
| HIGH     | `bg-orange-100 text-orange-700` |
| NORMAL   | `bg-blue-100 text-blue-700` |
| LOW      | `bg-gray-100 text-gray-600` |

**Excel upload flow:**
1. User drops `.xlsx` file in `FileDropzone`
2. `parseExcelFile(file)` utility (SheetJS) returns array of row objects
3. `ExcelPreviewTable` shows parsed rows (valid=green, invalid=red)
4. User clicks "Import All" → rows merged into `lineItems` form state

---

## 3. Approval Screens

All approval screens use a two-column layout: left = read-only request detail, right = approval action panel.

### 3.1 Approval Queue Page

```
+------------------------------------------------------------------+
| Pending Approvals                        [Filter: All Projects v] |
+------------------------------------------------------------------+
|  Showing 5 requests awaiting your review                         |
|  | RQ-044| OBRA-14 | Materiales enc.. | A. Torres   | 1 day  > |
|  | RQ-043| OBRA-14 | Pintura base..   | M. Quispe   | 2 days > |
|  | RQ-038| OBRA-11 | Varillas 3/8"    | J. Salas    | 3 days > |
+------------------------------------------------------------------+
```

### 3.2 Residente de Proyecto — Technical Review

```
+------------------------------------------------------------------+
| RQ-044 — Technical Review                     [Back to Queue]    |
+------------------------------------------------------------------+
|  LEFT PANEL (60%)              RIGHT PANEL (40%)                 |
|  ----------------------        ----------------------            |
|  Project:   OBRA-14            Technical Review Action:          |
|  Requester: A. Torres                                            |
|  Priority:  [HIGH]             [x] Specifications reviewed       |
|  Required:  15/03/2026         [x] Items technically feasible    |
|                                [ ] Requires modification         |
|  Description:                                                    |
|  Encofrado metálico para       Resident Notes:                   |
|  columnas de 30x30cm...        +------------------------------+ |
|                                |                              | |
|  Line Items:                   +------------------------------+ |
|  |# |Desc  |Qty |Unit |Spec|                                    |
|  |1 |Enc.. |10  |UND  |..  |   [REJECT]        [APPROVE]       |
|  |2 |Pernos|20  |UND  |..  |                                    |
|                                Approval History:                 |
|  Attachments:                  -- Created by A. Torres 07/03 -- |
|  [spec.pdf]                    (awaiting your review)           |
+------------------------------------------------------------------+
```

### 3.3 Control de Proyecto — Budget Review

```
+------------------------------------------------------------------+
| RQ-044 — Budget Review                        [Back to Queue]    |
+------------------------------------------------------------------+
|  LEFT PANEL (60%)              RIGHT PANEL (40%)                 |
|  ----------------------        ----------------------            |
|  Project:   OBRA-14            Project Budget Summary:           |
|  Priority:  [HIGH]             Total:     S/ 500,000             |
|  Resident:  B. Mendez [OK]     Spent:     S/ 340,000             |
|                                Available: S/ 115,000             |
|  Technical Notes (Resident):                                     |
|  "Items verificados, usar      Estimated Request Cost:           |
|  encofrado ULMA modelo X"      [_______________] S/              |
|                                                                   |
|  Line Items + Est. Cost:       Classification:                   |
|  |# |Desc  |Qty |Cost |        ( ) Within Project Proposal       |
|  |1 |Enc.. |10  |8,000|        ( ) Additional Requirement        |
|  |2 |Pernos|20  |  500|                                          |
|  |  |Total |    |8,500|        Project Control Notes:            |
|                                +------------------------------+  |
|                                |                              |  |
|                                +------------------------------+  |
|                                                                   |
|                                [REJECT]  [APPROVE & CLASSIFY]    |
+------------------------------------------------------------------+
```

### 3.4 Gerente General — Additional Requirement Approval

```
+------------------------------------------------------------------+
| RQ-044 — Management Approval Required         [Back to Queue]    |
+------------------------------------------------------------------+
|  [!] This request has been classified as: ADDITIONAL REQUIREMENT  |
+------------------------------------------------------------------+
|  LEFT PANEL (60%)              RIGHT PANEL (40%)                 |
|  ----------------------        ----------------------            |
|  Project:    OBRA-14           Classification:                   |
|  Amount:     S/ 8,500          [ADDITIONAL REQUIREMENT]          |
|  Priority:   [HIGH]                                              |
|                                Budget impact:                    |
|  Approval Chain:               This request:  + S/ 8,500         |
|  1. Created:  A.Torres  OK     Budget used after: 70%            |
|  2. Resident: B.Mendez  OK     [=====================] 70%       |
|  3. Control:  C.Ruiz    OK                                       |
|     (Additional Req.)          GM Decision Notes:                |
|  4. GM:       PENDING          +------------------------------+  |
|                                |                              |  |
|  Project Control Notes:        +------------------------------+  |
|  "Requerimiento fuera del                                        |
|  alcance original, pero        [REJECT]    [APPROVE]            |
|  necesario para el avance"                                       |
+------------------------------------------------------------------+
```

**Tailwind conventions for approval components:**
- Approve: `bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium`
- Reject: `bg-red-100 hover:bg-red-200 text-red-700 px-6 py-2 rounded-lg border border-red-300`
- Escalation alert: `bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-4`
- Chain step (done): `flex items-center gap-2 text-green-700` + checkmark icon
- Chain step (pending): `flex items-center gap-2 text-gray-400` + clock icon

---

## 4. Request Tracking UI

### 4.1 Request List / Search Page

```
+------------------------------------------------------------------+
| All Requests                                  [+ New Request]     |
+------------------------------------------------------------------+
|  [Search by RQ#, description, project...]  [Filters v]           |
|                                                                   |
|  Status: [All v]  Project: [All v]  Priority: [All v]           |
|  Date from: [__/__/____]  to: [__/__/____]  [Apply] [Clear]     |
|                                                                   |
|  Showing 42 results                          [Export CSV]        |
|  | RQ-044| Encofrado..   | OBRA-14 | [TECH REVIEW] | 07/03  | > |
|  | RQ-043| Pintura base  | OBRA-14 | [BUDGET REV]  | 06/03  | > |
|  | RQ-041| Varillas 3/8" | OBRA-14 | [APPROVED]    | 02/03  | > |
|  | RQ-040| Encofrado met.| OBRA-11 | [IN PROCURE]  | 28/02  | > |
|  | RQ-039| Pintura epóx. | OBRA-09 | [DELIVERED]   | 20/02  | > |
|  [< Prev]  Page 1 of 5  [Next >]                                 |
+------------------------------------------------------------------+
```

### 4.2 Request Detail and Lifecycle Tracking

```
+------------------------------------------------------------------+
| RQ-044 — Encofrado metálico para columnas     [Edit] [Print]     |
| OBRA-14  |  HIGH Priority  |  07/03/2026  |  A. Torres           |
+------------------------------------------------------------------+
|                                                                   |
|  LIFECYCLE PROGRESS BAR                                          |
|                                                                   |
|  [1.Created]-->[2.Tech Review]-->[3.Budget]-->[4.Procure]-->[5.Done]
|    DONE(green)  ACTIVE(blue)    PENDING(gray)  PENDING       --  |
+------------------------------------------------------------------+
|  LEFT PANEL (60%)              RIGHT PANEL (40%)                 |
|                                                                   |
|  Request Information           Current Status                    |
|  Project:  OBRA-14             Status: TECHNICAL REVIEW          |
|  Requester:A. Torres           Phase: Phase 1                    |
|  Priority: HIGH                Assigned: B. Mendez               |
|  Required: 15/03/2026          Waiting since: 1 day              |
|                                                                   |
|  Description:                  Next expected action:             |
|  Encofrado metálico para       B. Mendez must review specs       |
|  columnas de 30x30cm...        and approve or reject.            |
|                                                                   |
|  Line Items:                   Approval Chain:                   |
|  |# |Desc  |Qty |Unit |        [CHECK] Created  A.Torres         |
|  |1 |Enc.. |10  |UND  |        [CLOCK] TechRev  B.Mendez         |
|  |2 |Pernos|20  |UND  |        [----] Budget    C.Ruiz           |
|                                [----] Procure   D.Lima           |
|  Attachments:                  [----] Delivery  Almacen          |
|  [spec.pdf] [materiales.xlsx]                                    |
+------------------------------------------------------------------+
|  Activity Log                                                    |
|  07/03 09:15  A. Torres    Created request RQ-044               |
|  07/03 09:20  System       Assigned to B. Mendez for review     |
|  07/03 10:00  B. Mendez    Opened for review                    |
|  [Load earlier activity...]                                      |
+------------------------------------------------------------------+
```

### 4.3 Status Badge Mapping

| Status Code | Display Label | Tailwind Classes |
|-------------|---------------|-----------------|
| DRAFT | Borrador | `bg-gray-100 text-gray-600` |
| TECHNICAL_REVIEW | Rev. Técnica | `bg-blue-100 text-blue-700` |
| BUDGET_REVIEW | Rev. Presupuestal | `bg-indigo-100 text-indigo-700` |
| GM_REVIEW | Aprob. Gerencia | `bg-purple-100 text-purple-700` |
| VALIDATED | Validado | `bg-green-100 text-green-700` |
| STOCK_CHECK | Verif. Stock | `bg-cyan-100 text-cyan-700` |
| QUOTING | En Cotización | `bg-yellow-100 text-yellow-700` |
| PO_GENERATED | OC Generada | `bg-orange-100 text-orange-700` |
| RECEIVING | En Recepción | `bg-amber-100 text-amber-700` |
| DELIVERED | Entregado | `bg-teal-100 text-teal-700` |
| CLOSED | Cerrado | `bg-gray-200 text-gray-700` |
| TECHNICAL_REJECTED | Rechazado | `bg-red-100 text-red-700` |
| GM_REJECTED | Rechazado GM | `bg-red-100 text-red-700` |
| USER_CLAIM | Reclamo | `bg-red-200 text-red-800` |
| CANCELLED | Cancelado | `bg-gray-300 text-gray-600` |

### 4.4 Lifecycle Bar Phases

```
Phase 1: Request      -> [Created, Submitted]
Phase 2: Validation   -> [Resident OK, Control OK, GM OK if needed]
Phase 3: Procurement  -> [Stock check, Quoting, OC generated]
Phase 4: Delivery     -> [Reception, QC, Delivery to site]
Phase 5: Closure      -> [User confirmation, Claim or Close]
```

Visual states: Completed (green + checkmark), Active (blue pulsing), Pending (gray dashed)

---

## 5. React Project Structure

```
src/
├── assets/                    # Static assets (logos, icons)
│   ├── logo.svg
│   └── icons/
│
├── components/
│   ├── layout/
│   │   ├── AppShell.jsx       # Main layout (sidebar + header + outlet)
│   │   ├── Sidebar.jsx        # Role-aware navigation
│   │   ├── Header.jsx         # User info, notifications, logout
│   │   └── PageHeader.jsx     # Page title + breadcrumb + actions
│   │
│   ├── ui/                    # Atomic UI components
│   │   ├── StatusBadge.jsx
│   │   ├── PriorityBadge.jsx
│   │   ├── Button.jsx
│   │   ├── Modal.jsx
│   │   ├── ConfirmDialog.jsx
│   │   ├── Card.jsx
│   │   ├── Spinner.jsx
│   │   ├── EmptyState.jsx
│   │   ├── Alert.jsx
│   │   └── Tooltip.jsx
│   │
│   ├── forms/
│   │   ├── FormField.jsx      # Label + input + error wrapper
│   │   ├── SelectField.jsx
│   │   ├── TextareaField.jsx
│   │   ├── DatePicker.jsx
│   │   └── FileDropzone.jsx   # Drag-and-drop upload
│   │
│   ├── data/
│   │   ├── DataTable.jsx      # Generic sortable/filterable table
│   │   ├── Pagination.jsx
│   │   ├── FilterBar.jsx
│   │   └── SummaryCard.jsx    # Dashboard KPI card
│   │
│   ├── requests/              # Domain-specific components
│   │   ├── LineItemsTable.jsx
│   │   ├── LineItemRow.jsx
│   │   ├── ExcelImportPanel.jsx
│   │   ├── AttachmentsList.jsx
│   │   ├── ApprovalActions.jsx
│   │   ├── ApprovalChain.jsx
│   │   ├── ActivityLog.jsx
│   │   ├── LifecycleBar.jsx
│   │   └── RequestCard.jsx
│   │
│   └── charts/
│       ├── StatusDonutChart.jsx
│       ├── BudgetProgressBar.jsx
│       └── VolumeBarChart.jsx
│
├── pages/
│   ├── auth/
│   │   └── LoginPage.jsx
│   ├── dashboard/
│   │   └── DashboardPage.jsx  # Role-aware rendering
│   ├── requests/
│   │   ├── RequestListPage.jsx
│   │   ├── RequestDetailPage.jsx
│   │   ├── RequestCreatePage.jsx
│   │   └── RequestEditPage.jsx
│   ├── approvals/
│   │   ├── ApprovalQueuePage.jsx
│   │   ├── TechReviewPage.jsx
│   │   ├── BudgetReviewPage.jsx
│   │   └── ManagerApprovalPage.jsx
│   ├── logistics/
│   │   ├── LogisticsQueuePage.jsx
│   │   ├── StockCheckPage.jsx
│   │   ├── QuotationPage.jsx
│   │   └── PurchaseOrderPage.jsx
│   └── warehouse/
│       ├── ReceptionPage.jsx
│       └── DeliveryPage.jsx
│
├── hooks/
│   ├── useAuth.js
│   ├── useRequests.js
│   ├── useApprovals.js
│   ├── usePagination.js
│   ├── useDebounce.js
│   ├── useExcelParser.js
│   └── usePermissions.js
│
├── services/                  # HTTP communication layer
│   ├── api.js                 # Axios instance + interceptors
│   ├── authService.js
│   ├── requestsService.js
│   ├── approvalsService.js
│   ├── logisticsService.js
│   ├── warehouseService.js
│   └── projectsService.js
│
├── context/
│   ├── AuthContext.jsx
│   └── NotificationContext.jsx
│
├── utils/
│   ├── formatters.js          # Date, currency formatters
│   ├── statusHelpers.js       # Status → label/color mapping
│   ├── excelParser.js         # Parse .xlsx to objects
│   ├── validators.js
│   └── constants.js           # ROLES, STATUS_CODES, UNITS
│
├── router/
│   ├── AppRouter.jsx
│   ├── ProtectedRoute.jsx
│   └── RoleRoute.jsx
│
└── App.jsx
```

---

## 6. Component Hierarchy

### 6.1 Layout Tree

```
App.jsx
  AuthProvider
    NotificationProvider
      AppRouter
        LoginPage  (public)
        AppShell   (protected)
          Sidebar
            NavLink x N (role-filtered)
          Header
            UserAvatar + RoleLabel
            NotificationBell
            LogoutButton
          <Outlet/>  (active page)
```

### 6.2 Dashboard Page Tree

```
DashboardPage
  PageHeader
  SummaryCardsRow
    SummaryCard x 4 (KPIs differ per role)
  RecentRequestsSection
    DataTable
      StatusBadge (per row)
    Pagination
  StatusDistributionSection
    StatusDonutChart or BudgetProgressBar
  QuickActionsSection
    Button("New Request")
    Button("Go to Approvals")
```

### 6.3 Request Creation Page Tree

```
RequestCreatePage
  PageHeader
  RequestForm
    GeneralInfoSection
      SelectField (project)
      SelectField (priority)
      FormField (description)
      TextareaField (justification)
      DatePicker (required delivery date)
    LineItemsSection
      LineItemsTable
        LineItemRow x N (editable)
      Button("+ Add Item")
      ExcelImportPanel
        FileDropzone
        ExcelPreviewTable
        Button("Import All")
    AttachmentsSection
      FileDropzone
      AttachmentsList
  FormActions
    Button("Cancel")
    Button("Save Draft")
    Button("Submit")
```

### 6.4 Approval Page Tree

```
TechReviewPage / BudgetReviewPage / ManagerApprovalPage
  PageHeader (RQ#, back button)
  StatusAlertBanner (if escalated)
  TwoColumnLayout
    LEFT: RequestDetailPanel
      RequestInfoGrid
      LineItemsTable (read-only)
      AttachmentsList (download only)
      ApprovalChain
    RIGHT: ApprovalActionPanel
      ReviewCheckboxes (role-specific)
      EstimatedCostInput (Budget only)
      ClassificationRadio (Budget only)
      BudgetSummaryPanel (Budget only)
      TextareaField (comments)
      ApprovalActions
        Button("Reject")
        Button("Approve")
```

### 6.5 Request Detail/Tracking Page Tree

```
RequestDetailPage
  PageHeader (RQ#, StatusBadge, Edit/Print)
  LifecycleBar (5-phase progress bar)
  TwoColumnLayout
    LEFT: RequestInfoPanel
      RequestInfoGrid
      LineItemsTable (read-only)
      AttachmentsList
    RIGHT: StatusPanel
      CurrentStatusCard
      NextActionCard
      ApprovalChain
  ActivityLog
    ActivityLogItem x N
```

---

## 7. State Management & API Integration

### 7.1 Authentication Flow (JWT)

```
Login Flow:
  LoginPage submit
  → authService.login({ email, password })
  → POST /api/v1/auth/login/
  → returns { access, refresh }
  → access token in memory (AuthContext)
  → refresh token in httpOnly cookie
  → redirect to /dashboard

Token Refresh (Axios interceptor):
  401 response → authService.refresh()
  → success: update token, retry request
  → failure: logout, redirect to /login
```

### 7.2 API Service Layer

```javascript
// src/services/api.js
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Request interceptor: attach JWT
// Response interceptor: auto-refresh on 401
```

```javascript
// src/services/requestsService.js
const requestsService = {
  list:   (params) => api.get('/requests/', { params }),
  get:    (id)     => api.get(`/requests/${id}/`),
  create: (data)   => api.post('/requests/', data),
  update: (id, data) => api.patch(`/requests/${id}/`, data),
  action: (id, action, comments) =>
    api.post(`/requests/${id}/action/`, { action, comments }),
  getActivity: (id) => api.get(`/requests/${id}/activity/`),
  uploadAttachment: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/requests/${id}/attachments/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
```

### 7.3 Role-Based Rendering

```javascript
// src/hooks/usePermissions.js
export function usePermissions() {
  const { role } = useAuth();
  return {
    canCreateRequest:    ['REQUESTER', 'PROJECT_RESIDENT'].includes(role),
    canTechReview:       role === 'PROJECT_RESIDENT',
    canBudgetReview:     role === 'PROJECT_CONTROL',
    canManagerApprove:   role === 'GENERAL_MANAGER',
    canLogistics:        role === 'LOGISTICS',
    canWarehouseReceive: ['CENTRAL_WAREHOUSE', 'SITE_WAREHOUSE'].includes(role),
  };
}
```

### 7.4 Route Protection

```javascript
// Public routes
<Route path="/login" element={<LoginPage />} />

// Protected routes (require auth)
<Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
  <Route index element={<DashboardPage />} />
  <Route path="requests" element={<RequestListPage />} />
  <Route path="requests/new" element={<RequestCreatePage />} />
  <Route path="requests/:id" element={<RequestDetailPage />} />

  // Role-restricted routes
  <Route path="approvals/tech-review/:id"
    element={<RoleRoute allowedRoles={['PROJECT_RESIDENT']}><TechReviewPage /></RoleRoute>} />
  <Route path="approvals/budget/:id"
    element={<RoleRoute allowedRoles={['PROJECT_CONTROL']}><BudgetReviewPage /></RoleRoute>} />
  <Route path="approvals/manager/:id"
    element={<RoleRoute allowedRoles={['GENERAL_MANAGER']}><ManagerApprovalPage /></RoleRoute>} />
</Route>
```

### 7.5 State Management Summary

| Concern | Approach | Location |
|---------|----------|----------|
| Auth / user session | React Context + useReducer | `AuthContext.jsx` |
| Notifications | React Context + queue | `NotificationContext.jsx` |
| Server data | Custom hooks (useState + useEffect) | `hooks/useRequests.js` etc. |
| Form state | Local useState or react-hook-form | Page components |
| UI state (modals) | Local useState | Component level |
| Permissions | Derived from auth role | `hooks/usePermissions.js` |
| URL filters | useSearchParams (React Router) | List pages |

---

## Appendix: Tailwind Class Conventions

**Layout:**
- Page container: `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8`
- Two-column: `grid grid-cols-1 lg:grid-cols-5 gap-6`
- Card: `bg-white rounded-2xl shadow-sm border border-gray-100 p-6`

**Tables:**
- `th`: `px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase`
- `td`: `px-4 py-3 text-sm text-gray-700`
- Row hover: `hover:bg-gray-50 transition-colors`

**Buttons:**
- Primary: `bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium`
- Secondary: `bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 px-4 py-2 rounded-lg`
- Danger: `bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 px-4 py-2 rounded-lg`
