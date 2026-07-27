# 06 — Implementation Phases

Each phase ends with: tests run · a "what works" list · a "not finished" list ·
step-by-step test instructions for you · **then we stop and wait for your
feedback** before touching working functionality.

---

## Phase 1 — Foundation: authentication, roles, master data
**Delivers**
* Supabase migrations: enums, `app_users`, `approved_email_domains`, `clinics`,
  `doctors`, `doctor_clinics`, `brands`, `products`,
  `representative_brand_assignments`, `app_settings`, `audit_logs`
* RLS helper functions and policies for everything above
* E-mail domain restriction enforced by a database trigger
* Expo app: login → OTP → role-based tab routing
* Read-only master-data screens (clinics, doctors, brands) for everyone
* Administrator screens: users, clinics, doctors, brands, products
* Seed data: 7 reps, 3 managers, 1 admin, 15 clinics, 50 doctors, 10 brands, 50 products
* Tests: e-mail domain restriction, role permissions, validation schemas

**Acceptance criteria covered:** 1, 2, 11 (partly), 16 (partly), 18, 19

---

## Phase 2 — Weekly planning and today's route
**Delivers**
* `weekly_plans`, `planned_visits`, `planned_visit_doctors/brands/products`
* Duplicate-planned-visit guard trigger
* Planning-deadline enforcement
* `rpc_submit_plan`, `rpc_decide_plan`
* Screens: weekly calendar, plan builder wizard, visit detail, today's route
  (without the start button yet)
* Tests: duplicate prevention, deadline, plan status transitions, cross-rep
  isolation

**Acceptance criteria covered:** 3, 4, 11

---

## Phase 3 — Location validation, check-in, active visit, check-out
**Delivers**
* `visit_events` (immutable), `visit_status_history`
* `rpc_start_visit`, `rpc_check_out` with server-side Haversine
* Foreground-only, one-shot location; permission handling for iOS and Android
* Screens: start-visit confirmation, active visit with timer
* Tests: Haversine accuracy, start-button eligibility matrix, duplicate active
  visit prevention, accuracy threshold, clock skew

**Acceptance criteria covered:** 5, 6, 7, 19

---

## Phase 4 — Visit documentation and doctor history
**Delivers**
* `visit_reports` + brand/product joins, `visit_addenda`, `follow_ups`
* `rpc_save_visit_draft`, `rpc_complete_visit` (all validation server-side)
* Immutability triggers on submitted reports
* Screens: complete-visit form, doctor profile & visit history with filters,
  addendum entry for managers
* Tests: completion validation, immutability, addendum append-only, history
  visibility across representatives

**Acceptance criteria covered:** 8, 9, 10, 18

---

## Phase 5 — Exceptions and KPI
**Delivers**
* `visit_exceptions`, `approved_absences`, `kpi_rule_versions`,
  `kpi_period_snapshots`
* `rpc_request_exception`, `rpc_decide_exception` (self-approval blocked)
* KPI engine in SQL **and** TypeScript, tested against shared fixtures
* Screens: exception request, exception approval, representative KPI
* Tests: exception approval, approved-cancellation exclusion, missed-visit
  inclusion, KPI arithmetic, rule versioning

**Acceptance criteria covered:** 12, 13, 14

---

## Phase 6 — Manager dashboard, exports, audit log, Power BI
**Delivers**
* `reporting` schema with all dimension and fact views
* `powerbi_reader` role, connection guide, star-schema doc, DAX measure examples
* CSV export Edge Function for managers (audited)
* Manager dashboard cards and the recent-visits map
* Audit log screen with filters
* Tests: view correctness, export permission, audit entries for every listed action

**Acceptance criteria covered:** 15, 16

---

## Phase 7 — Offline, testing, hardening, deployment
**Delivers**
* SQLite cache + outbox + sync engine + conflict handling
* Sync status badges on every record and the sync status screen
* Rate limiting, input validation sweep, storage upload restrictions
* Full test suite green; security and privacy checklists completed
* All manuals: administrator, representative, manager; backup and restore;
  iOS/Android build and distribution

**Acceptance criteria covered:** 17, 20 (verified), plus a full re-run of 1–19

---

## Dependency order

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6 ──► Phase 7
   │                                    │           │
   └── seed data feeds every phase ─────┴───────────┘
```

Nothing is built out of order, because each phase's tables are foreign keys for
the next phase's tables.

---

## Definition of done for every phase

1. `npm run typecheck` passes with zero errors.
2. `npm run lint` passes.
3. `npm test` passes; new business rules have tests.
4. Migrations apply cleanly to an empty database (`supabase db reset`).
5. Seed data loads.
6. Every screen in the phase shows loading, empty, error and offline states.
7. No feature is visible in the UI unless it works, or it is labelled
   **"Хараахан хэрэгжээгүй"** (not implemented).
8. The phase's section in `docs/setup/HOW-TO-TEST.md` is written in plain language.
