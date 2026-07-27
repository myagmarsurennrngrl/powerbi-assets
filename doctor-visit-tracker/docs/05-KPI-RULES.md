# 05 — KPI Calculation Rules

All KPI logic is **configurable** and **versioned**. Every reporting period stores
the `kpi_rule_version_id` that produced it, so changing the configuration next
month never rewrites last month's numbers.

Week definition: **ISO week, Monday 00:00 → Sunday 23:59:59, Asia/Ulaanbaatar.**
Month definition: calendar month, Asia/Ulaanbaatar.

---

## 1. The headline KPI — Weekly visit completion

```
completion_rate_pct = completed_planned_visits / eligible_planned_visits * 100
```

Reported to one decimal place. If `eligible_planned_visits = 0`, the KPI is
reported as **"Тооцоолох боломжгүй"** (not calculable) — **never** as 0 % and
never as 100 %. This matters: a representative on approved leave for the whole
week must not appear as a 0 % performer.

### Numerator — `completed_planned_visits`
A planned visit where:
* `is_unplanned = false`, **and**
* `status = 'completed'`, **and**
* a submitted `visit_reports` row exists, **and**
* `planned_date` falls inside the period.

### Denominator — `eligible_planned_visits`

**Included** (per the requirements):

| Case | Condition |
|---|---|
| Completed | `status = 'completed'` |
| Missed | `status = 'missed'` |
| Cancelled without approval | `status = 'cancelled_unapproved'` |
| Incomplete after the planned date | `status in ('planned','in_progress')` **and** `planned_date < today` |

**Excluded**:

| Case | Condition |
|---|---|
| Manager-approved cancellation | `status = 'cancelled_approved'` |
| Manager-approved holiday | an `approved_absences` row of type `official_holiday`, status `approved`, covering `planned_date` for that representative |
| Manager-approved sick leave | same, type `sick_leave` |
| Manager-approved clinic closure | approved `visit_exceptions.reason_category = 'clinic_closed'` on that visit, **or** an approved `clinic_closure` absence |
| Officially rescheduled to a future date | `status = 'rescheduled'` **and** `rescheduled_to_visit_id` points at a visit with `planned_date > original planned_date` |
| Unplanned visits | `is_unplanned = true` — reported separately |

An exception only removes a visit from the denominator when **all** of these hold:
1. `status = 'approved'`,
2. `decided_by <> requested_by`,
3. `reason_category` is in the rule version's
   `exclude_approved_exception_reasons` list.

Pending and rejected exceptions change nothing. This is the single most important
integrity rule in the KPI — a representative cannot improve their own score by
filing requests.

### Worked example

| Rep: Б.Сарантуяа, week 2026-W31 | Count |
|---|---|
| Planned visits created | 20 |
| Completed | 14 |
| Missed | 3 |
| Cancelled — approved (clinic closed) | 2 |
| Cancelled — no approval | 1 |
| Unplanned visits also done | 4 |

```
eligible  = 14 completed + 3 missed + 1 unapproved  = 18
completed = 14
KPI       = 14 / 18 * 100 = 77.8 %
```
The 2 approved cancellations left the denominator. The 4 unplanned visits are
reported on their own line and do **not** inflate the 77.8 %.

---

## 2. All reported metrics

| # | Metric | Mongolian label | Definition |
|---|---|---|---|
| 1 | Planned visits | Төлөвлөсөн уулзалт | count of planned visits with `planned_date` in period, `is_unplanned=false` |
| 2 | Completed visits | Дууссан уулзалт | numerator above |
| 3 | Missed visits | Биелээгүй уулзалт | `status='missed'` **plus** `status in ('planned','in_progress')` with `planned_date < today` |
| 4 | Approved cancellations | Зөвшөөрөгдсөн цуцлалт | `status='cancelled_approved'` |
| 5 | Unapproved cancellations | Зөвшөөрөгдөөгүй цуцлалт | `status='cancelled_unapproved'` |
| 6 | Unplanned visits | Төлөвлөгөөт бус уулзалт | `is_unplanned=true and status='completed'` — **separate line, never merged** |
| 7 | Completion % | Гүйцэтгэлийн хувь | formula in §1 |
| 8 | Average visit duration | Дундаж үргэлжлэх хугацаа | mean of `visit_reports.duration_minutes` for completed visits; outliers > 240 min flagged, not removed |
| 9 | On-time start % | Цагтаа эхэлсэн хувь | completed visits where `check_in.server_timestamp ≤ planned_time + tolerance`, ÷ completed visits **that had a `planned_time`**. Visits with no planned time are excluded from both sides. Default tolerance 15 min. |
| 10 | Doctor coverage | Эмчийн хамрал | distinct doctors actually met (`meeting_status='doctor_met'`) ÷ distinct doctors planned |
| 11 | Clinic coverage | Эмнэлгийн хамрал | distinct clinics visited (completed) ÷ distinct clinics planned |
| 12 | Brand activity | Брэндийн идэвх | per brand: number of completed visits where that brand was discussed; also shown as % of the rep's completed visits |
| 13 | Follow-up completion | Дараагийн алхмын биелэлт | follow-ups due in the period with `status='completed'` ÷ follow-ups due in the period |

Additional integrity indicators shown to managers (not part of the score):

| Indicator | Meaning |
|---|---|
| Geofence exceptions | check-ins where `geofence_verified = false` |
| Poor GPS accuracy | check-ins with `gps_accuracy_m > threshold` |
| Clock skew | check-ins with `abs(clock_skew_seconds) > max_clock_skew_seconds` |
| Late submissions | visits completed after `planned_date` |
| Offline-created visits | `is_offline = true` |
| Zero-duration visits | duration < 3 minutes |

---

## 3. Rule versioning

```
kpi_rule_versions(version_no, effective_from, effective_to, definition jsonb, is_current)
```

* Only the administrator may create a new version. Existing versions are never
  edited — a change creates version *n+1* and closes version *n*.
* `weekly_plans.kpi_rule_version_id` is stamped when the plan is submitted.
* At period close, `kpi_period_snapshots` stores the computed `metrics jsonb`
  together with the `kpi_rule_version_id` and `is_final = true`.
* Power BI reads snapshots for closed periods and the live view for the current
  period. A closed period therefore always shows the same number, forever.

Snapshot job: an Edge Function invoked by a scheduled trigger every Monday at
02:00 Asia/Ulaanbaatar for the week that just ended, and on the 1st of each month
at 02:30 for the month that just ended.

---

## 4. Reference SQL

```sql
-- Eligible planned visits for one representative and one period
create or replace function public.kpi_eligible_visits(
  p_rep uuid, p_from date, p_to date, p_rule_version uuid
) returns table (visit_id uuid, is_completed boolean)
language sql stable as $$
  with rules as (
    select definition from public.kpi_rule_versions where id = p_rule_version
  ),
  candidate as (
    select pv.*
    from public.planned_visits pv
    where pv.representative_id = p_rep
      and pv.planned_date between p_from and p_to
      and pv.is_unplanned = false
  ),
  excluded as (
    select c.id
    from candidate c
    -- approved cancellation
    where c.status = 'cancelled_approved'
    union
    -- approved, KPI-excluding exception
    select c.id from candidate c
    join public.visit_exceptions ve on ve.planned_visit_id = c.id
    where ve.status = 'approved' and ve.excludes_from_kpi
    union
    -- approved absence covering the day
    select c.id from candidate c
    join public.approved_absences aa
      on aa.representative_id = c.representative_id
     and aa.status = 'approved'
     and c.planned_date between aa.start_date and aa.end_date
    union
    -- officially rescheduled forward
    select c.id from candidate c
    join public.planned_visits nxt on nxt.id = c.rescheduled_to_visit_id
    where c.status = 'rescheduled' and nxt.planned_date > c.planned_date
  )
  select c.id,
         (c.status = 'completed'
          and exists (select 1 from public.visit_reports r
                      where r.planned_visit_id = c.id and r.status = 'submitted'))
  from candidate c
  where c.id not in (select id from excluded)
    and (
      c.status in ('completed','missed','cancelled_unapproved')
      or (c.status in ('planned','in_progress') and c.planned_date < (now() at time zone 'Asia/Ulaanbaatar')::date)
    );
$$;
```

The same logic is implemented in TypeScript (`src/domain/kpi.ts`) so the phone can
show a KPI offline, and both implementations are tested against the **same
fixture set** to guarantee they agree.

---

## 5. Anti-gaming rules

| Attempt | Defence |
|---|---|
| File exceptions for every missed visit | Only a manager can approve; self-approval is blocked by constraint and by function check |
| Log many 30-second visits | Duration is computed from server timestamps; visits under 3 minutes are flagged to the manager |
| Fake GPS | Distance is recomputed server-side from the clinic row; `is_mock_location` is read on Android and stored; accuracy threshold rejects implausible fixes |
| Change the phone clock | Only `server_timestamp` is used for any calculation; skew is recorded and flagged |
| Create the plan after the visits happened | Plans lock at the deadline; `weekly_plans.submitted_at` and the audit log show when it was created; visits created after the planned date are marked `is_unplanned` |
| Complete a visit for a colleague | RLS: `representative_id = auth_user_id()` on every write path |
