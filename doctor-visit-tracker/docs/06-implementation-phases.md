# 06 — Implementation Phases

Each phase ends with: tests run → "what works" → "what is unfinished" → "how you can test it" → **wait for your feedback**.
No working functionality is replaced without your confirmation.

---

## Phase 1 — Foundation: auth, roles, clinics, doctors, brands, users
**Deliverables**
* Repo scaffolding: Expo + TypeScript + Expo Router, theme, Mongolian i18n, date/timezone helpers.
* Migrations `0001`–`0007`: extensions, enums, `app_user`, `approved_email_domain`, `app_setting`,
  master data tables, RLS helper functions, RLS policies, audit log + triggers.
* Email-domain restriction at the database level.
* Seed data: 7 reps, 3 managers, 1 admin, 15 clinics, 50 doctors, 10 brands, 50 products, assignments.
* Screens: Login, Home (skeleton), Clinics, Clinic detail, Doctors, Brands, Settings.
* Tests: email-domain restriction, role helpers, RLS read/write matrix, soft-delete & duplicate constraints.

**Exit check:** an approved email logs in and sees real clinics/doctors/brands; a non-approved email is refused.

---

## Phase 2 — Weekly planning and today's route
* Migrations: `weekly_plan`, `planned_visit`, `planned_visit_doctor`, `planned_visit_brand`,
  duplicate-prevention trigger, plan status machine, `fn_submit_plan`, `fn_review_plan`.
* Screens: Weekly calendar, Plan builder wizard, Today's route (with distance-from-me), Visit detail.
* Seed: 4 weeks of plans.
* Tests: duplicate planned visit prevention, cross-rep same-doctor allowed, plan deadline, status transitions.

---

## Phase 3 — Location validation, check-in, active visit, check-out
* `fn_start_visit()` and `fn_complete_visit()` with **server-side Haversine** and server timestamps.
* `visit`, `visit_event` tables with immutability triggers and revoked grants.
* Screens: Start-visit confirmation (live GPS state), Active visit (timer), check-out capture.
* Tests: Haversine accuracy, all 7 start-eligibility conditions, duplicate active visit prevention,
  out-of-radius rejection, device-vs-server clock drift flagging.

---

## Phase 4 — Visit documentation and doctor history
* Completion form validation (client + server, one source of truth).
* `visit_addendum`, `follow_up`, `visit_status_history`.
* Screens: Complete visit form, Doctor profile & visit history with all 5 filters.
* Tests: required-field validation, immutability of completed records, addendum never overwrites,
  cross-rep read of submitted history, drafts stay private.

---

## Phase 5 — Exceptions and KPI
* `visit_exception`, `fn_review_exception`, no-self-approval guard.
* `kpi_rule_version`, `kpi_period_snapshot`, KPI SQL functions/views.
* Screens: Exception request, Exception approval queue, Representative KPI.
* Tests: approval workflow, KPI worked example from `docs/05` §4, approved-cancellation exclusion,
  missed-visit inclusion, rule-version freezing.

---

## Phase 6 — Manager dashboard, exports, audit log, Power BI
* `reporting` schema views (star schema), `reporting_reader` role.
* CSV export functions with audit entries.
* Screens: Manager dashboard, Audit log, User management, Master data management (incl. CSV import).
* Docs: Power BI connection guide, star-schema diagram, field descriptions, example DAX measures,
  incremental-refresh recommendation.

---

## Phase 7 — Offline, testing, hardening, deployment docs
* SQLite cache + outbox queue + sync status screen + conflict handling.
* Full test suite green; rate limiting; storage policies; secret audit.
* Docs: setup for a non-technical person, local dev, iOS test, Android test, production deployment,
  backup & recovery, admin manual, rep manual, manager manual, known limitations,
  security checklist, privacy checklist.

**Audio recording is not implemented in any phase.** The flag exists and is off.

---

## Cross-phase definition of done
1. `npm test` passes.
2. Every new table has RLS enabled and at least one explicit policy (asserted by an automated test).
3. No secret in source; `.env.example` updated.
4. Every new screen has loading / empty / error / offline states.
5. Anything visible but not working is labelled **«Хараахан хэрэгжээгүй»** (not implemented).
