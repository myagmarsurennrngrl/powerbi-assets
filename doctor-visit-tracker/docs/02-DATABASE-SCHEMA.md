# 02 — Database Schema

PostgreSQL 15+ (Supabase). All identifiers in English, `snake_case`.
All timestamps are `timestamptz` and stored in UTC; the app converts to
`Asia/Ulaanbaatar` for display. Dates that represent a *business day*
(`planned_date`, `follow_up_date`, …) are plain `date` in Ulaanbaatar terms.

Legend: **PK** primary key · **FK** foreign key · **U** unique · **IX** indexed

---

## 0. Conventions applied to every table

| Column | Type | Applies to | Meaning |
|---|---|---|---|
| `id` | `uuid` default `gen_random_uuid()` | all | Primary key |
| `created_at` | `timestamptz` default `now()` | all | Row creation (server time) |
| `updated_at` | `timestamptz` default `now()` | mutable tables | Maintained by trigger |
| `created_by` | `uuid` → `app_users.id` | master data + plans | Who created it |
| `updated_by` | `uuid` → `app_users.id` | master data + plans | Who last changed it |
| `deleted_at` | `timestamptz` null | **master data only** | Soft delete. Transactional data is never deleted. |

**Master data** (clinics, doctors, brands, products, users …) is *soft-deletable*
and *editable*. **Transactional data** (visit events, submitted reports, addenda,
audit log) is *append-only and immutable*.

---

## 1. Enumerated types

```sql
create type user_role          as enum ('representative','manager','administrator');
create type auth_provider      as enum ('supabase','entra_id');
create type clinic_type        as enum ('public_hospital','private_hospital','clinic',
                                        'dermatology_center','pharmacy_chain','other');
create type plan_status        as enum ('draft','submitted','approved','rejected',
                                        'active','completed','locked');
create type visit_status       as enum ('planned','in_progress','completed','missed',
                                        'rescheduled','cancellation_requested',
                                        'cancelled_approved','cancelled_unapproved');
create type visit_event_type   as enum ('check_in','check_out');
create type meeting_status     as enum ('doctor_met','doctor_unavailable','clinic_closed',
                                        'meeting_postponed','clinic_staff_only','other');
create type visit_outcome      as enum ('product_introduced','doctor_interested',
                                        'follow_up_requested','sample_requested',
                                        'training_requested','not_interested',
                                        'already_recommending','other');
create type interest_level     as enum ('none','low','medium','high','unknown');
create type report_status      as enum ('draft','submitted');
create type exception_reason   as enum ('doctor_unavailable','clinic_closed','emergency',
                                        'sick_leave','company_assignment','gps_problem',
                                        'wrong_clinic_coordinates','appointment_rescheduled',
                                        'other');
create type approval_status    as enum ('pending','approved','rejected');
create type absence_type       as enum ('official_holiday','sick_leave',
                                        'company_assignment','clinic_closure','other');
create type follow_up_status   as enum ('open','completed','cancelled','expired');
create type kpi_period_type    as enum ('week','month');
```

---

## 2. Identity & access

### `approved_email_domains`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| domain | `citext` | **U**, e.g. `company.mn`. Stored lower-case, without `@` |
| is_active | boolean | default `true` |
| note | text | |
| created_at / updated_at / created_by / updated_by | | |

Used by: the `auth.users` insert trigger, `rpc_is_email_allowed()`, and the login
screen (read-only, anonymous select on active domains is **not** granted — the
app calls a `SECURITY DEFINER` function that returns only true/false).

### `app_users`

**Identity model.** `app_users.id` is deliberately *not* `auth.users.id`. An
administrator creates the staff record first (name, e-mail, role); the record
is linked to an authentication account on that person's first login. This gives
two things: staff can be provisioned before they ever open the app, and moving
to Microsoft Entra ID later only relinks `auth_user_id` / `external_id`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK**, independent of the identity provider |
| auth_user_id | uuid | **U**, **FK** → `auth.users.id`, null until first login |
| email | citext | **U**, must match an approved domain (CHECK via trigger) |
| full_name | text | not null |
| employee_code | text | **U** nullable |
| role | `user_role` | not null, default `representative` |
| phone | text | |
| manager_id | uuid | **FK** → `app_users.id`, nullable (reporting line, informational) |
| auth_provider | `auth_provider` | default `supabase` — **future Entra ID switch** |
| external_id | text | **U** nullable — Entra object id when migrated |
| is_active | boolean | default `true`; inactive users cannot read anything (RLS) |
| last_login_at | timestamptz | |
| app_version | text | last seen client version |
| created_at / updated_at / created_by / updated_by / deleted_at | | |

**IX:** `(role) where deleted_at is null`, `(is_active)`

---

## 3. Master data

### `clinics`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| code | text | **U** nullable — the company's own code |
| name | text | not null |
| clinic_type | `clinic_type` | not null |
| district | text | not null (Улаанбаатарын дүүрэг) |
| address | text | not null |
| latitude | `double precision` | CHECK between −90 and 90 |
| longitude | `double precision` | CHECK between −180 and 180 |
| geofence_radius_m | integer | default 150, CHECK between 30 and 2000 |
| contact_phone | text | |
| notes | text | general notes |
| is_active | boolean | default true |
| created_at / updated_at / created_by / updated_by / deleted_at | | |

**Duplicate detection:** unique index on
`normalize_name(name), normalize_name(district) where deleted_at is null`.
`normalize_name()` is an IMMUTABLE helper that lower-cases and collapses
whitespace, so "  Түмэн   Арьс " and "түмэн арьс" collide. `unaccent()` is
deliberately not used: it is not IMMUTABLE (so it cannot go in an index) and it
adds nothing for Cyrillic. A separate, non-blocking warning lists active clinics
within 50 m of each other — `clinics_possible_duplicates()`.

**IX:** `(is_active) where deleted_at is null`, `(district)`

### `doctors`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| code | text | **U** nullable |
| full_name | text | not null |
| speciality | text | not null |
| phone | text | nullable |
| email | citext | nullable |
| professional_notes | text | **professional notes only** — see privacy rules |
| is_active | boolean | default true |
| created_at / updated_at / created_by / updated_by / deleted_at | | |

**Duplicate detection:** unique index on
`normalize_name(full_name), coalesce(btrim(phone),''), normalize_name(speciality)
where deleted_at is null`. The same name with a different speciality is allowed,
because it is a different person.

### `doctor_clinics` (many-to-many)
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| doctor_id | uuid | **FK** → doctors, on delete restrict |
| clinic_id | uuid | **FK** → clinics, on delete restrict |
| department | text | |
| room_or_floor | text | |
| available_days | `text[]` | e.g. `{mon,tue,thu}` |
| available_hours | text | e.g. `09:00-13:00` |
| is_active | boolean | default true |
| created_at / updated_at / created_by / updated_by | | |

**U:** `(doctor_id, clinic_id)`

### `brands`
| id | uuid **PK** · name text **U** (case-insensitive, active) · category text · is_active bool · audit cols |

### `products`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| name | text | not null |
| sku | text | **U** |
| brand_id | uuid | **FK** → brands, **restrict** (orphan prevention) |
| category | text | |
| is_active | boolean | default true |
| audit cols | | |

### `representative_brand_assignments`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| representative_id | uuid | **FK** → app_users (role must be `representative` — trigger check) |
| brand_id | uuid | **FK** → brands |
| start_date | date | not null |
| end_date | date | nullable, CHECK `end_date >= start_date` |
| is_active | boolean | default true |
| audit cols | | |

**Constraint:** no two *active, overlapping* rows for the same
(representative, brand) — enforced with an exclusion constraint on
`daterange(start_date, coalesce(end_date,'infinity'))`.

---

## 4. Weekly planning

### `weekly_plans`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| representative_id | uuid | **FK** → app_users |
| iso_year | integer | e.g. 2026 |
| iso_week | integer | 1–53 |
| week_start_date | date | Monday (Ulaanbaatar) |
| week_end_date | date | Sunday |
| status | `plan_status` | default `draft` |
| notes | text | |
| submitted_at | timestamptz | |
| decided_by | uuid | **FK** → app_users |
| decided_at | timestamptz | |
| decision_comment | text | |
| locked_at | timestamptz | after this the plan is read-only for everybody |
| kpi_rule_version_id | uuid | **FK** → `kpi_rule_versions`, stamped at submission |
| audit cols | | |

**U:** `(representative_id, iso_year, iso_week)`

### `planned_visits`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| plan_id | uuid | **FK** → weekly_plans, nullable *only* for unplanned visits |
| representative_id | uuid | **FK** → app_users (denormalised for RLS speed) |
| clinic_id | uuid | **FK** → clinics |
| planned_date | date | not null |
| visit_order | integer | not null, default 1 — order within the day |
| planned_time | time | nullable, estimated start |
| objective | text | expected visit objective |
| status | `visit_status` | default `planned` |
| is_unplanned | boolean | default false — **excluded from the standard KPI** |
| rescheduled_from_visit_id | uuid | **FK** self |
| rescheduled_to_visit_id | uuid | **FK** self |
| started_at | timestamptz | copied from the check-in event (read model) |
| completed_at | timestamptz | copied from the check-out event |
| geofence_verified | boolean | server-verified distance ≤ radius at check-in |
| late_submission | boolean | completed after the planned date |
| audit cols | | |

**U:** `(representative_id, planned_date, visit_order)` — *deferrable*, so the
plan builder can reorder rows inside one transaction.
**Partial U:** only one `in_progress` visit per representative:
`create unique index on planned_visits(representative_id) where status='in_progress';`
**IX:** `(planned_date, representative_id)`, `(clinic_id)`, `(status)`

### `planned_visit_doctors`
| id | **FK** planned_visit_id | **FK** doctor_id | is_primary bool |
**U:** `(planned_visit_id, doctor_id)`

**Duplicate-visit guard.** A trigger `trg_prevent_duplicate_planned_visit` raises
`DVT_DUPLICATE_PLANNED_VISIT` when the same *representative* would have two
non-cancelled planned visits to the same *doctor* at the same *clinic* on the
same *date*. Two **different** representatives may plan the same doctor on the
same day — that is expected, because they carry different brands.

### `planned_visit_brands` / `planned_visit_products`
| id | **FK** planned_visit_id | **FK** brand_id / product_id |
**U:** `(planned_visit_id, brand_id)` / `(planned_visit_id, product_id)`

---

## 5. Visit execution (immutable)

### `visit_events` — append-only
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| planned_visit_id | uuid | **FK** → planned_visits |
| event_type | `visit_event_type` | `check_in` / `check_out` |
| server_timestamp | timestamptz | **`default now()` — the only trusted time** |
| device_timestamp | timestamptz | what the phone claimed |
| clock_skew_seconds | integer | generated: server − device; large values are an exception signal |
| latitude / longitude | double precision | |
| gps_accuracy_m | double precision | |
| distance_from_clinic_m | double precision | **recomputed on the server** |
| user_id | uuid | **FK** → app_users |
| clinic_id | uuid | **FK** → clinics |
| app_version | text | |
| is_offline | boolean | true if created while the phone had no internet |
| client_event_id | uuid | **U** — idempotency key for offline replay |
| created_at | timestamptz | |

`UPDATE` and `DELETE` are revoked from all application roles and additionally
blocked by trigger. **U:** `(planned_visit_id, event_type)` — one check-in and one
check-out per visit.

### `visit_reports`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| planned_visit_id | uuid | **U**, **FK** → planned_visits |
| status | `report_status` | `draft` → `submitted`; **submitted rows are immutable** |
| doctor_met_id | uuid | **FK** → doctors, required when `meeting_status='doctor_met'` |
| meeting_status | `meeting_status` | required |
| visit_objective | text | required |
| outcome | `visit_outcome` | required |
| doctor_feedback | text | required |
| product_interest_level | `interest_level` | required |
| samples_provided | boolean | required |
| samples_description | text | required when `samples_provided` |
| follow_up_required | boolean | required |
| follow_up_date | date | required when `follow_up_required`; CHECK `> planned_date` |
| next_action | text | required |
| summary | text | required, min 20 characters |
| duration_minutes | integer | computed from the two events |
| submitted_at | timestamptz | |
| client_event_id | uuid | **U** idempotency |
| audit cols | | |

Validation lives in `rpc_complete_visit`, not in the client.

### `visit_report_brands` / `visit_report_products`
Join tables, `(visit_report_id, brand_id)` / `(visit_report_id, product_id)` unique.
At least one brand row is required for submission.

### `visit_addenda` — corrections, append-only
| id | **FK** planned_visit_id | correction_text | reason | author_id | created_at |

Never overwrites anything. Shown underneath the original record in the doctor
history, labelled "Албан ёсны нэмэлт тайлбар".

### `visit_status_history` — append-only
| id | **FK** planned_visit_id | from_status | to_status | changed_by | changed_at | reason |

Written by a trigger on every `planned_visits.status` change.

---

## 6. Exceptions & absences

### `visit_exceptions`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| planned_visit_id | uuid | **FK** → planned_visits |
| requested_by | uuid | **FK** → app_users |
| reason_category | `exception_reason` | required |
| explanation | text | required, min 10 characters |
| attachment_path | text | Supabase Storage object path (private bucket) |
| requested_at | timestamptz | server time |
| request_latitude / request_longitude / request_accuracy_m | double precision | optional |
| status | `approval_status` | default `pending` |
| manager_comment | text | required when rejecting |
| decided_by | uuid | **FK** → app_users, **CHECK `decided_by <> requested_by`** |
| decided_at | timestamptz | |
| excludes_from_kpi | boolean | set by `rpc_decide_exception` from the KPI rule version |
| client_event_id | uuid | **U** |
| created_at | timestamptz | |

**Partial U:** one pending exception per visit.

### `approved_absences`
Date-range approvals that remove *all* of a representative's planned visits in
that range from the KPI denominator.

| id | representative_id **FK** | absence_type | start_date | end_date | reason | status `approval_status` | decided_by | decided_at | audit cols |

---

## 7. Follow-ups

### `follow_ups`
| Column | Type | Notes |
|---|---|---|
| id | uuid | **PK** |
| source_visit_id | uuid | **FK** → planned_visits |
| representative_id | uuid | **FK** → app_users |
| doctor_id | uuid | **FK** → doctors |
| clinic_id | uuid | **FK** → clinics |
| due_date | date | from `visit_reports.follow_up_date` |
| next_action | text | |
| status | `follow_up_status` | `open` → `completed` / `cancelled` / `expired` |
| completed_by_visit_id | uuid | **FK** → planned_visits |
| completed_at | timestamptz | |

Created automatically by `rpc_complete_visit` when `follow_up_required` is true.
Closed automatically when the same representative later completes a visit with
the same doctor after `due_date − 7 days`.

---

## 8. Configuration & KPI

### `app_settings`
| key text **PK** | value jsonb | description | is_public boolean | updated_at | updated_by |

Seeded keys:

| Key | Default | Meaning |
|---|---|---|
| `default_geofence_radius_m` | `150` | Used when a clinic has no override |
| `gps_accuracy_threshold_m` | `50` | Reject a check-in if accuracy is worse |
| `max_clock_skew_seconds` | `300` | Flag the visit if the phone clock is far off |
| `planning_deadline_weekday` | `5` (Friday) | Last day to submit next week's plan |
| `planning_deadline_hour` | `18` | 18:00 Ulaanbaatar |
| `on_time_tolerance_minutes` | `15` | For the on-time-start KPI |
| `feature_audio_recording` | `false` | **Audio stays off** |
| `retention_visit_years` | `5` | |
| `retention_location_years` | `2` | |
| `retention_audit_years` | `7` | |

`is_public = true` rows are readable by all signed-in users; the rest by
administrators only.

### `kpi_rule_versions`
| id | version_no int **U** | effective_from date | effective_to date | definition jsonb | is_current bool | created_by | created_at |

`definition` holds the eligibility lists, e.g.:

```json
{
  "denominator_statuses": ["completed","missed","cancelled_unapproved"],
  "include_incomplete_past_planned": true,
  "exclude_approved_exception_reasons": ["clinic_closed","sick_leave",
      "company_assignment","emergency","wrong_clinic_coordinates"],
  "exclude_approved_absence_types": ["official_holiday","sick_leave",
      "company_assignment","clinic_closure"],
  "exclude_rescheduled_to_future": true,
  "include_unplanned_in_completion": false,
  "on_time_tolerance_minutes": 15
}
```

### `kpi_period_snapshots`
| id | period_type | period_start | period_end | representative_id (null = team) | kpi_rule_version_id **FK** | metrics jsonb | generated_at | is_final bool |

Frozen once the period closes, so **historical KPI values never change** when the
configuration is edited later.

---

## 9. Audit

### `audit_logs` — append-only, never editable
| Column | Type |
|---|---|
| id | bigint identity **PK** |
| occurred_at | timestamptz default now() |
| actor_id | uuid |
| actor_email | citext (denormalised, survives user deletion) |
| actor_role | user_role |
| action | text — see the list in `docs/07` |
| entity_type | text |
| entity_id | uuid |
| before_data | jsonb |
| after_data | jsonb |
| ip_address | inet |
| user_agent | text |
| app_version | text |
| note | text |

**IX:** `(occurred_at desc)`, `(actor_id)`, `(entity_type, entity_id)`, `(action)`

---

## 10. Audio (created, disabled)

Tables exist so that enabling the feature later needs no migration surprise.
While `app_settings.feature_audio_recording = false`, RLS denies every operation.

### `audio_consents`
| id | planned_visit_id **FK** | representative_consent bool | representative_consent_at | doctor_consent_confirmed bool | doctor_consent_at | purpose_text | retention_days | created_at |

### `visit_audio_recordings`
| id | planned_visit_id **FK** | consent_id **FK** | storage_path | duration_seconds | encrypted bool | delete_after date | created_at |

Every playback/download writes an `audit_logs` row with `action='audio_accessed'`.

---

## 11. Reporting schema (Power BI)

`reporting` schema, read-only role `powerbi_reader`, no access to `public`.

| View | Grain |
|---|---|
| `reporting.dim_date` | one row per calendar day, 2024-01-01 → 2030-12-31 |
| `reporting.dim_user` | one row per app user |
| `reporting.dim_clinic` | one row per clinic |
| `reporting.dim_doctor` | one row per doctor |
| `reporting.dim_brand` | one row per brand |
| `reporting.dim_product` | one row per product |
| `reporting.fact_visit` | one row per planned visit (planned or unplanned) |
| `reporting.fact_visit_brand` | one row per visit × brand discussed |
| `reporting.fact_weekly_plan` | one row per weekly plan |
| `reporting.fact_exception` | one row per exception request |
| `reporting.fact_follow_up` | one row per follow-up |
| `reporting.fact_visit_status_history` | one row per status change |
| `reporting.kpi_weekly_snapshot` | one row per representative × week |

Full field descriptions, relationships and DAX examples: `docs/POWERBI-GUIDE.md`
(Phase 6).

---

## 12. Entity-relationship overview

```
app_users ──< representative_brand_assignments >── brands ──< products
    │                                                 │
    │                                                 │
    └──< weekly_plans ──< planned_visits >── clinics ──┤
                              │  │  │                  │
                              │  │  └──< planned_visit_brands
                              │  └─────< planned_visit_doctors >── doctors
                              │                                      │
                              ├──< visit_events (immutable)          │
                              ├──< visit_reports ──< report_brands   │
                              │        │            report_products  │
                              ├──< visit_addenda (immutable)         │
                              ├──< visit_status_history (immutable)  │
                              ├──< visit_exceptions                  │
                              └──< follow_ups ──────────────────────-┘

doctors >──< doctor_clinics >──< clinics
audit_logs, app_settings, kpi_rule_versions, kpi_period_snapshots  (standalone)
```
