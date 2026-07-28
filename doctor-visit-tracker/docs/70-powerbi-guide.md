# 70 — Power BI Connection Guide

How to connect Power BI to the Doctor Visit Tracker database, what the tables mean, and the
measures to start with.

**Written for someone who knows Power BI but not this database.** No programming needed.

---

## 1. What you are connecting to

A separate `reporting` schema containing a clean **star schema**. You are *not* connecting to the
app's own tables.

That matters for three reasons:

1. **The reporting login can only read these views.** It has no access to the application tables,
   no access to the login system, and no ability to write anything anywhere.
2. **Unsubmitted drafts are excluded.** A representative's half-written report is private until
   they submit it, and it will never appear in your reports.
3. **Doctors' phone numbers and emails are excluded.** A `.pbix` file gets emailed around; personal
   contact details have no reporting purpose and are not exposed.

---

## 2. One-off setup by an administrator

The reporting login exists but has no password until someone sets one. In the Supabase **SQL
Editor**, run this once — replacing the password with a strong one from your password manager:

```sql
ALTER ROLE reporting_reader LOGIN PASSWORD 'paste-a-strong-password-here';
```

> Store that password in the company password manager. It is never written in any file in this
> project, and it must not be emailed.

To check the login is correctly restricted, run:

```sql
SELECT * FROM public.fn_reporting_reader_leaks();
```

**It must return zero rows.** Any row means the reporting login has picked up access it should not
have — stop and ask a developer.

---

## 3. Connect from Power BI Desktop

1. **Home → Get Data → More… → PostgreSQL database**
2. Fill in:
   * **Server:** `db.<your-project-ref>.supabase.co` — find it in Supabase under
     **Project Settings → Database → Connection info → Host**
   * **Database:** `postgres`
3. **Data Connectivity mode:** choose **Import**. (See §7 for why, not DirectQuery.)
4. Click **OK**. When asked for credentials choose **Database** and enter:
   * **User name:** `reporting_reader`
   * **Password:** the one set in §2
5. Under **Encryption**, leave TLS/SSL **enabled**. Never disable it.
6. In the Navigator, expand **reporting** and tick every view listed in §4. Click **Load**.

If the connection is refused, check Supabase → **Project Settings → Database → Network
restrictions**; your office IP may need to be allowed.

---

## 4. The tables and what they mean

### Dimensions (the "who / what / when")

| View | One row per | Key column | Notes |
|---|---|---|---|
| `dim_date` | calendar day, 2024–2030 | `date_key` | **Mark this as the date table** (see §5) |
| `dim_user` | employee | `user_key` | Representatives, managers, administrators |
| `dim_clinic` | clinic | `clinic_key` | Includes coordinates and the geofence radius |
| `dim_doctor` | doctor | `doctor_key` | No phone, no email — deliberately |
| `dim_brand` | brand | `brand_key` | |
| `dim_product` | product | `product_key` | Has `brand_key` for a brand → product hierarchy |

### Facts (the "what happened")

| View | One row per | Use it for |
|---|---|---|
| `fact_visit` | **submitted** visit | Duration, outcome, distance, anomaly flags |
| `fact_planned_visit` | planned visit | Plan vs actual, KPI classification flags |
| `fact_exception` | exception request | Approval rates, decision turnaround |
| `fact_follow_up` | follow-up task | Overdue and completion rates |
| `fact_visit_status_history` | status change | How a visit's state moved over time |
| `fact_audit_log` | audited action | Compliance reporting |

### Bridges (for the many-to-many relationships)

A visit can involve several doctors and several brands, so those cannot live as columns.

| View | Connects |
|---|---|
| `bridge_visit_doctor` | `fact_visit` ↔ `dim_doctor` |
| `bridge_visit_brand` | `fact_visit` ↔ `dim_brand` |
| `bridge_visit_product` | `fact_visit` ↔ `dim_product` |

### Ready-made KPI

| View | Notes |
|---|---|
| `vw_kpi_weekly_rep` | Weekly KPI per representative |

**Use this view rather than recreating the KPI in DAX.** It calls the same function the mobile app
uses, so a Power BI report and a representative's phone can never show different numbers. The rules
are subtle (see `docs/05-kpi-rules.md`); two implementations would eventually disagree and nobody
would know which to trust.

---

## 5. Building the model

### Mark the date table
Select `dim_date` → **Table tools → Mark as date table** → choose `date_key`.
Without this, Power BI's time-intelligence functions (`SAMEPERIODLASTYEAR`, `DATESYTD`, …) do not
work correctly.

### Relationships
Power BI usually detects these; verify them. All are **one-to-many**, single direction, from the
dimension to the fact.

```
dim_date[date_key]      1 ──→ *  fact_visit[date_key]
dim_date[date_key]      1 ──→ *  fact_planned_visit[date_key]
dim_date[date_key]      1 ──→ *  fact_exception[date_key]
dim_date[date_key]      1 ──→ *  fact_follow_up[date_key]

dim_user[user_key]      1 ──→ *  fact_visit[user_key]
dim_user[user_key]      1 ──→ *  fact_planned_visit[user_key]
dim_user[user_key]      1 ──→ *  fact_exception[user_key]

dim_clinic[clinic_key]  1 ──→ *  fact_visit[clinic_key]
dim_clinic[clinic_key]  1 ──→ *  fact_planned_visit[clinic_key]

dim_brand[brand_key]    1 ──→ *  dim_product[brand_key]
dim_doctor[doctor_key]  1 ──→ *  fact_follow_up[doctor_key]
```

**The bridges** need two relationships each, both single-direction *into* the bridge:

```
fact_visit[visit_key]   1 ──→ *  bridge_visit_doctor[visit_key]
dim_doctor[doctor_key]  1 ──→ *  bridge_visit_doctor[doctor_key]
```

To make a doctor slicer filter `fact_visit`, set the `dim_doctor → bridge_visit_doctor`
relationship's **Cross filter direction** to **Both**. Do this only for the bridges.

### Star-schema recommendation
Keep it a strict star: dimensions filter facts, facts never filter each other, and there are no
relationships between dimensions except brand → product. Resist adding calculated columns to the
facts — use measures instead, so the model stays small and fast.

---

## 6. Measures to start with

Paste these into a new measures table.

```dax
-- Headline. Matches the app exactly, including NULL when nothing was eligible.
Completion % =
DIVIDE (
    SUM ( vw_kpi_weekly_rep[completed_visits] ),
    SUM ( vw_kpi_weekly_rep[eligible_visits] )
) * 100

-- Deliberately SUM/SUM, not an average of percentages. A representative with
-- 2 planned visits must not weigh the same as one with 20.

Completed Visits = SUM ( vw_kpi_weekly_rep[completed_visits] )
Missed Visits    = SUM ( vw_kpi_weekly_rep[missed_visits] )
Eligible Visits  = SUM ( vw_kpi_weekly_rep[eligible_visits] )

-- Reported separately. NEVER add this into Completion %.
Unplanned Visits = SUM ( vw_kpi_weekly_rep[unplanned_visits] )

Avg Visit Minutes =
AVERAGE ( fact_visit[duration_minutes] )

Visits Needing Review =
CALCULATE ( COUNTROWS ( fact_visit ), fact_visit[needs_review] = TRUE () )

Doctors Visited =
DISTINCTCOUNT ( bridge_visit_doctor[doctor_key] )

Clinics Visited =
DISTINCTCOUNT ( fact_visit[clinic_key] )

Follow-ups Overdue =
CALCULATE ( COUNTROWS ( fact_follow_up ), fact_follow_up[is_overdue] = TRUE () )

Exception Approval Rate =
DIVIDE (
    CALCULATE ( COUNTROWS ( fact_exception ), fact_exception[status] = "approved" ),
    CALCULATE ( COUNTROWS ( fact_exception ), fact_exception[status] <> "pending" )
) * 100

Completion % vs Last Year =
CALCULATE ( [Completion %], SAMEPERIODLASTYEAR ( dim_date[date_key] ) )
```

### One warning about `Completion %`
Do **not** rewrite it as `AVERAGE(vw_kpi_weekly_rep[completion_pct])`. That averages percentages and
gives a different, wrong answer whenever workloads differ between representatives.

---

## 7. Refresh

**Use Import mode, not DirectQuery.** DirectQuery would send a database query for every visual
interaction, which is slow over the internet and puts avoidable load on the production database the
representatives depend on.

### Scheduled refresh
Publish to the Power BI Service, then **Dataset → Settings → Scheduled refresh**. Daily at
**07:00 Ulaanbaatar** works well — the previous day's visits are complete and the reports are ready
before anyone looks.

### Incremental refresh (recommended once you have a year of data)
Visit history never changes once submitted, so re-importing it every night is wasted effort.

1. In Power Query, add two parameters named exactly `RangeStart` and `RangeEnd` (Date/Time).
2. Filter `fact_visit` on `date_key` between them.
3. Right-click the table → **Incremental refresh**:
   * **Archive data starting:** 3 years before refresh date
   * **Incrementally refresh data in the last:** 10 days

Ten days rather than one, deliberately: a visit created offline can sync several days late, and a
manager's addendum can arrive later still. A one-day window would miss both.

---

## 8. Security checklist before sharing a report

- [ ] The `.pbix` uses `reporting_reader`, never a personal or administrator login
- [ ] `SELECT * FROM public.fn_reporting_reader_leaks();` returns zero rows
- [ ] TLS/SSL is enabled on the connection
- [ ] The password is in the password manager, not in a file or an email
- [ ] The published report is shared with named people, not "everyone in the organisation"
- [ ] No visual exposes doctor contact details — the views do not contain them, so this should be
      automatic
- [ ] Row-level security is applied in Power BI if representatives will view the report themselves
      (the database cannot enforce per-user filtering through a shared reporting login)

> **That last point matters.** The reporting login sees all rows by design. If you intend to give
> representatives access to a Power BI report, configure Power BI's own row-level security on
> `dim_user[email]`, or share only aggregate pages with them.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `password authentication failed` | Password never set, or wrong | Re-run §2 |
| `permission denied for schema reporting` | Connected as the wrong user | Check it is `reporting_reader` |
| Navigator shows no `reporting` schema | Migration 0021 not applied | Apply the migrations |
| Mongolian text shows as `????` | Not a database problem — a font issue in the visual | Choose a font with Cyrillic coverage, e.g. Segoe UI |
| Numbers differ from the app | Almost always a re-implemented KPI in DAX | Use `vw_kpi_weekly_rep` |
| A recent visit is missing | It is still an unsubmitted draft | Correct — drafts are private until submitted |
| Totals look too low | Filtering `fact_visit` through a bridge without both-direction cross filter | See §5 |
