# 05 — KPI Calculation Rules

Every rule below is stored as data in `kpi_rule_version.config` (jsonb), not hard-coded. Each reporting period
is stamped with the rule version used, so **published historical KPI values never change** when configuration changes.

Timezone for every period boundary: **Asia/Ulaanbaatar**. Weeks are ISO weeks (Monday–Sunday).

---

## 1. Headline KPI — Weekly visit completion

```
completion_pct = (completed_planned_visits / eligible_planned_visits) × 100
```
Rounded to 1 decimal place. If `eligible_planned_visits = 0`, the KPI is reported as **NULL / «Хамаарахгүй»**,
never as 0% — a rep on approved leave for a whole week must not show a 0% score.

### Numerator — `completed_planned_visits`
A planned visit whose realised `visit.status = 'completed'` and `is_draft = false`.

### Denominator — `eligible_planned_visits`
| Included | Condition |
|---|---|
| Completed | `status = 'completed'` |
| Missed | `status = 'missed'` |
| Cancelled without approval | `status = 'cancelled_unapproved'` |
| Incomplete after the planned date | `status IN ('planned','in_progress')` **and** `planned_date < current_date` |

| Excluded | Condition |
|---|---|
| Manager-approved cancellation | approved exception with reason in the excluding set |
| Manager-approved official holiday | approved exception, reason `official_assignment` flagged holiday |
| Manager-approved sick leave | approved exception, reason `sick_leave` |
| Manager-approved clinic closure | approved exception, reason `clinic_closed` |
| Officially rescheduled to a future date | `status = 'rescheduled'` **and** `rescheduled_to_visit_id` points to a visit with `planned_date > original planned_date` |

**KPI-excluding reason set (default config):**
`sick_leave`, `clinic_closed`, `official_assignment`, `emergency`, `wrong_clinic_coordinates`, `appointment_rescheduled`.

**Not excluded even if approved:** `doctor_unavailable`, `gps_problem`, `other`.
Rationale — the rep still travelled or still owns the outcome; approving the explanation should not erase the
target. This is configurable per rule version if the business decides otherwise.

> A planned visit is counted **once**. If it has both an approved exclusion and a completion, completion wins.

---

## 2. Unplanned visits — reported separately, never mixed in

A visit with `planned_visit_id IS NULL` is an **unplanned visit** (`Төлөвлөгөөт бус уулзалт`).

* It is **excluded from both the numerator and the denominator** of the standard completion KPI.
* It is displayed as its own metric on every KPI screen and in Power BI.
* Optional secondary metric (shown, never substituted):
  `total_activity = completed_planned + unplanned`.

---

## 3. Full metric definitions

| # | Metric (Mongolian label) | Definition |
|---|---|---|
| 1 | Төлөвлөсөн уулзалт | count of `planned_visit` in period, any status |
| 2 | Биелсэн уулзалт | completed planned visits (numerator above) |
| 3 | Хийгдээгүй уулзалт | `status = 'missed'` + past-dated `planned`/`in_progress` |
| 4 | Зөвшөөрөгдсөн цуцлалт | planned visits with an approved KPI-excluding exception |
| 5 | Зөвшөөрөгдөөгүй цуцлалт | `status = 'cancelled_unapproved'` |
| 6 | Төлөвлөгөөт бус уулзалт | visits with `planned_visit_id IS NULL` |
| 7 | Биелэлтийн хувь | §1 formula |
| 8 | Дундаж үргэлжлэх хугацаа | `AVG(duration_seconds)` over completed visits, shown as `цаг:минут`. Visits shorter than `min_valid_duration_seconds` (default 120 s) are counted but flagged as **suspicious** in the manager dashboard. |
| 9 | Цагтаа эхэлсэн хувь | share of completed visits where `started_at_server ≤ planned_time + tolerance`. Tolerance default **15 minutes**, configurable. Visits with no `planned_time` are excluded from this metric only. |
| 10 | Эмчийн хамрал | `COUNT(DISTINCT doctor_id met) / COUNT(DISTINCT doctor_id assigned to my brands & active) × 100` |
| 11 | Эмнэлгийн хамрал | `COUNT(DISTINCT clinic visited) / COUNT(DISTINCT active clinics with ≥1 doctor for my brands) × 100` |
| 12 | Брэндийн идэвх | per brand: number of completed visits where the brand was discussed; shown as a bar list |
| 13 | Дараагийн үйлдлийн биелэлт | `follow_up.status='done' / all follow_ups due in period × 100` |

---

## 4. Worked example (this is the acceptance-criteria example)

A representative's week:

| Visit | Status | Exception | Counts in denominator? | Counts in numerator? |
|---|---|---|---|---|
| V1 | completed | — | ✓ | ✓ |
| V2 | completed | — | ✓ | ✓ |
| V3 | missed | — | ✓ | ✗ |
| V4 | cancelled_approved | sick_leave, approved | ✗ | ✗ |
| V5 | cancelled_unapproved | — | ✓ | ✗ |
| V6 | planned, date was 2 days ago | — | ✓ | ✗ |
| V7 | rescheduled → next week | approved | ✗ | ✗ |
| V8 | cancelled_approved | doctor_unavailable, approved | ✓ (not an excluding reason) | ✗ |
| U1 | unplanned, completed | — | ✗ (separate metric) | ✗ |

Denominator = V1,V2,V3,V5,V6,V8 = **6**
Numerator = V1,V2 = **2**
**Completion = 33.3%**, plus "Төлөвлөгөөт бус уулзалт: 1" shown separately.

This exact scenario is encoded in `tests/domain/kpi.test.ts`.

---

## 5. Rule versioning

```jsonc
// kpi_rule_version.config — version 1 (default, effective 2026-01-01)
{
  "numerator_statuses": ["completed"],
  "denominator_statuses": ["completed", "missed", "cancelled_unapproved"],
  "denominator_includes_past_incomplete": true,
  "excluding_exception_reasons": [
    "sick_leave", "clinic_closed", "official_assignment",
    "emergency", "wrong_clinic_coordinates", "appointment_rescheduled"
  ],
  "exclude_future_rescheduled": true,
  "on_time_tolerance_minutes": 15,
  "min_valid_duration_seconds": 120,
  "unplanned_visits_in_standard_kpi": false,
  "null_when_denominator_zero": true
}
```

* Changing a rule = **inserting a new row**, never updating the old one. `effective_to` is set on the previous row.
* `kpi_period_snapshot` stores the computed numbers plus `kpi_rule_version_id`.
* Snapshots for a closed week are written once (weekly job / manual admin action) and are then read-only.
* Live (in-progress) periods are computed on the fly with the currently effective rule and labelled
  **«Урьдчилсан»** (provisional) in the UI.

---

## 6. Manager-level aggregates

* **Team completion** = `SUM(numerators) / SUM(denominators)` across reps — *not* the average of percentages
  (a rep with 2 planned visits must not weigh the same as one with 20).
* **Rep ranking** sorts by completion %, with the raw counts always shown next to it so a 100% from 2 visits
  is visibly different from 95% from 20.
* **Visits started outside expected conditions** counts visits whose check-in had
  `distance_from_clinic_m > clinic.geofence_radius_m` (only possible via an approved exception path),
  or `gps_accuracy_m > threshold`, or `|device_ts − server_ts| > 5 minutes`, or `source = 'offline'`.
  This is an *investigation list*, not a punishment metric, and is labelled as such.
