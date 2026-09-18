# Project: triple-d-ballet-class

## Architecture
- **Framework & Structure**: Nx Monorepo (Nx 20) with Angular 20+ frontend (`apps/triple-d-ballet-class`) and Python FastAPI backend (`apps/api`).
- **Data Access & State Flow**:
  - Backend: FastAPI REST API + SQLite database (`apps/api/triple_d_ballet.db`) with Pydantic v2 schemas configured with camelCase alias serialization (`alias_generator = to_camel`, `populate_by_name = True`) and CORS enabled for `http://localhost:4200`.
  - Frontend: `@libs/ballet/data-access` (`BalletStateService`) acts as the state store via Angular Signals (`signal`, `computed`), communicating with the FastAPI backend via Angular `HttpClient` while preserving 100% backward compatibility for `/kiosk`, `/student`, and `/admin`.
  - Sign-in & Signature: Mode A iPad Kiosk captures high-DPR HTML5 Canvas hand-drawn signature with bezier smoothing (requiring $\ge 5$ strokes), exports Base64 PNG Data URL (`data:image/png;base64,...`), persists in SQLite as `TEXT`, and provides immediate rendering in admin audit views.
  - 24-Hour Policy: $\Delta t = \text{ClassStartTime} - \text{RequestTime}$. $\Delta t \ge 24.0\text{h} \implies \text{leave\_advance}$ (0 deduction). $\Delta t < 24.0\text{h} \implies \text{leave\_late}$ (1 class deduction). Cancelling late leave refunds 1 class.
  - Break-Even Financials: Fixed venue rent $2,000, tuition $500/student, 4-person break-even threshold ($E_{\text{attendees}} < 4 \implies \text{isAtRisk}$ alert). Session deferral/cancellation triggers atomic refund of all deducted tickets.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F-01 | Student Management | CRUD student profiles (name, phone, Line ID, notes, registration date) | M1 | ORIGINAL_REQUEST:15, survey |
| F-02 | Ticket Pack Management | Purchase 5-class ($2,500, 60d) and 10-class ($5,000, 100d) packs with remaining count tracking | M1 | ORIGINAL_REQUEST:15, survey |
| F-03 | Pack Expiry Extension | Extend pack expiration date (default +30 days) and reactivate depleted/expired packs | M1 | survey, ballet-state.service |
| F-04 | Class Session Scheduling | Manage class sessions (date, time, title, venue $2000 cost, $500 fee, 10 capacity, 4 min threshold) | M1 | ORIGINAL_REQUEST:18, survey |
| F-05 | Mode A Kiosk Check-in | iPad Canvas check-in, stroke verification ($\ge 5$), Base64 PNG Data URL storage, deduct 1 class | M1 | ORIGINAL_REQUEST:16,34, survey |
| F-06 | Signature Audit & Retrieval | Display high-res Base64 signature with verified stamp in admin dashboard for dispute protection | M1 | ORIGINAL_REQUEST:16,34, survey |
| F-07 | 24h Leave Policy Rule | Automatic 24h calculation: $\ge 24$h = `leave_advance` (0 deduct); $< 24$h = `leave_late` (1 deduct) | M1 | ORIGINAL_REQUEST:17,33, survey |
| F-08 | Leave Cancellation & Refund | Cancel leave reverses state to registered; if previously late leave, restores 1 deducted ticket | M1 | survey, ballet-state.service |
| F-09 | Manual Status Override | Admin manual override of attendance status (`registered`, `attended`, `leave_advance`, `leave_late`, `absent`) | M1 | survey, ballet-state.service |
| F-10 | Financial Break-Even Monitor | Real-time calculation of revenue, rent $2,000, net profit, and 4-person break-even alert (`isAtRisk`) | M1 | ORIGINAL_REQUEST:18,35, survey |
| F-11 | Emergency Deferral & Refund | Cancel session due to threshold failure, atomically refunding all deducted tickets | M1 | survey, ARCHITECTURE:96 |
| F-12 | FastAPI Backend & SQLite DB | Python FastAPI service in `apps/api`, SQLite persistence, CORS, OpenAPI (`/docs`), automated testing | M1 | ORIGINAL_REQUEST:12-20, survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Production-Grade FastAPI Backend & SQLite DB | `apps/api` service setup, SQLite models, Pydantic schemas (camelCase serialization), routers for students/packs/sessions/attendance/financials, 24h leave engine, Mode A Base64 check-in, 4-person break-even alert, and comprehensive pytest suite | none | IN_PROGRESS |
| M2 | Angular Data Access Layer Integration | Configure `provideHttpClient()` in `apps/triple-d-ballet-class/src/app/app.config.ts`, update `@libs/ballet/data-access` (`BalletApiService` + `BalletStateService`) to sync with FastAPI backend while preserving 100% Signal API compatibility for `/kiosk`, `/student`, `/admin` | M1 | PLANNED |
| M3 | Full-Stack E2E Testing & PR Quality Gate | Requirement-driven test suite validation, adversarial coverage hardening, zero regression check, and 100% passing `npm run validate:pr` | M1, M2 | PLANNED |

## Interface Contracts

### Backend ↔ Frontend HTTP REST Contract
All endpoints are rooted at `http://localhost:8000/api/v1` (or `/api`).
CORS configured for `http://localhost:4200` with `allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"]`, `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`.

#### 1. Students & Ticket Packs
- `GET /api/v1/students` -> `List[StudentResponse]` (includes `activePack`, `daysUntilExpiry`, `isNearExpiry`)
- `POST /api/v1/students` -> `StudentResponse`
- `POST /api/v1/ticket-packs` -> `TicketPackResponse`
  - Request: `{ studentId: string, type: '5_class' | '10_class' | 'single', totalCount: number, validityDays: number, pricePaid?: number }`
- `PATCH /api/v1/ticket-packs/{id}/extend` -> `TicketPackResponse`
  - Request: `{ extraDays: number }`

#### 2. Class Sessions & Financials
- `GET /api/v1/sessions` -> `List[ClassSessionResponse]`
- `GET /api/v1/sessions/{id}` -> `ClassSessionResponse`
- `GET /api/v1/sessions/{id}/financials` -> `SessionFinancialStatsResponse`
  - Schema:
    ```typescript
    {
      totalCapacity: number;       // e.g. 10
      expectedAttendees: number;   // registered + attended
      actualAttendedCount: number; // attended
      advanceLeaveCount: number;   // leave_advance
      lateLeaveCount: number;      // leave_late
      absentCount: number;         // absent
      minThreshold: number;        // 4
      isAtRisk: boolean;           // expectedAttendees < 4
      effectiveRevenue: number;    // (attended + lateLeave + absent + registered) * 500
      venueCost: number;           // 2000
      estimatedNetProfit: number;  // effectiveRevenue - venueCost
    }
    ```
- `POST /api/v1/sessions/{id}/cancel-threshold` -> `{ message: string, refundedCount: number }`

#### 3. Attendance & Mode A Kiosk Check-in
- `GET /api/v1/sessions/{id}/attendance` -> `List[AttendanceRecordResponse]`
- `POST /api/v1/sessions/{id}/check-in`
  - Request: `{ studentId: string, signatureDataUrl: string }`
  - Response: `{ success: boolean, message: string, record: AttendanceRecordResponse }`
  - Error: 400 Bad Request if `remainingCount <= 0` or invalid signature
- `POST /api/v1/sessions/{id}/leave`
  - Request: `{ studentId: string, leaveReason?: string, simulationHours?: number }`
  - Response: `{ success: boolean, message: string, isAdvance: boolean, deductedCount: number, record: AttendanceRecordResponse }`
- `POST /api/v1/sessions/{id}/cancel-leave`
  - Request: `{ studentId: string }`
  - Response: `{ success: boolean, message: string, refunded: boolean }`
- `PUT /api/v1/sessions/{id}/attendance/{studentId}`
  - Request: `{ status: AttendanceStatus, remark?: string }`
  - Response: `AttendanceRecordResponse`

#### 4. System Utility
- `POST /api/v1/system/reset` -> `{ message: string }` (resets to initial seed data)

## Code Layout
```
apps/
├── api/                                      # Python FastAPI Backend
│   ├── project.json                          # Nx application configuration with "forwardAllArgs": false
│   ├── requirements.txt                      # Dependencies: fastapi, uvicorn, pydantic, httpx, pytest, pytest-asyncio
│   ├── main.py                               # Application factory, CORS, router mounts
│   ├── database.py                           # SQLite connection, session generator, init_db()
│   ├── models/                               # SQLite SQLModel / SQLAlchemy entities
│   │   ├── __init__.py
│   │   ├── student.py                        # Student, TicketPack
│   │   ├── session.py                        # ClassSession
│   │   └── attendance.py                     # AttendanceRecord (signature_data_url TEXT)
│   ├── schemas/                              # Pydantic v2 schemas (camelCase aliases)
│   │   ├── __init__.py
│   │   ├── student.py
│   │   ├── session.py
│   │   └── attendance.py
│   ├── routers/                              # REST API Route Controllers
│   │   ├── __init__.py
│   │   ├── students.py
│   │   ├── sessions.py
│   │   ├── attendance.py
│   │   └── system.py
│   ├── services/                             # Core Business Domain Logic
│   │   ├── __init__.py
│   │   ├── attendance_service.py             # Check-in, 24h leave rule (<24h vs >=24h), refunds
│   │   ├── financial_service.py              # $2000 rent, $500 fee, 4-person break-even threshold
│   │   └── ticket_service.py                 # 5/10-class pack lifecycle, expiry, FIFO deduction
│   └── tests/                                # Automated Pytest Suite
│       ├── __init__.py
│       ├── conftest.py                       # In-memory SQLite fixture, TestClient
│       ├── test_students.py                  # Student CRUD, pack purchase & recharge
│       ├── test_checkin.py                   # Mode A Canvas Base64 check-in, stroke check, idempotency
│       ├── test_leave_rules.py               # 24h advance vs late leave rule (<24h deducts 1, >=24h no deduct)
│       └── test_financials.py                # 4-person threshold alert, cancellation & atomic refund
│
└── triple-d-ballet-class/                    # Angular 20+ Application
    └── src/app/
        ├── app.config.ts                     # Added provideHttpClient()
        └── app.routes.ts

libs/
├── ballet/
│   ├── data-access/                          # Angular Data Access Library
│   │   └── src/lib/
│   │       ├── types/                        # TypeScript Interfaces (student, attendance, signature)
│   │       └── services/
│   │           ├── ballet-api.service.ts     # HttpClient wrapper communicating with FastAPI
│   │           └── ballet-state.service.ts   # State management (Signals) synced with backend
│   └── feature/                              # Angular Feature Views (/kiosk, /student, /admin)
└── shared/
    └── ui/                                   # Shared UI Components (signature-pad, navbar)
```
