# 03 — User Roles and Permissions Matrix

Three roles: **representative** (Эмнэлгийн төлөөлөгч), **manager** (Менежер), **administrator** (Админ).

Legend:
`✓` allowed · `✗` denied · `own` own records only · `team` own team only · `RO` read-only · `+A` may add an addendum but never overwrite

---

## 1. Master matrix

| # | Capability | Representative | Manager | Administrator | Enforced by |
|---|---|---|---|---|---|
| 1 | Log in with approved company email | ✓ | ✓ | ✓ | auth trigger + `approved_email_domain` |
| 2 | Log in with any other email | ✗ | ✗ | ✗ | auth trigger (server) |
| **Plans** |
| 3 | View weekly plans | own | ✓ all | ✓ all | RLS `weekly_plan` |
| 4 | Create weekly plan | own | ✗ | ✗ | RLS INSERT policy |
| 5 | Edit plan before deadline | own, status draft/rejected | ✗ | ✗ | RLS UPDATE + `fn_plan_editable()` |
| 6 | Edit another rep's plan | ✗ | ✗ | ✗ | RLS |
| 7 | Submit plan | own | ✗ | ✗ | `fn_submit_plan()` |
| 8 | Approve / reject plan | ✗ | ✓ team | ✓ | `fn_review_plan()` |
| 9 | Reassign / reschedule a visit | ✗ | ✓ | ✓ | `fn_reschedule_visit()` |
| **Visits** |
| 10 | Start visit | own, planned, today, in-radius | ✗ | ✗ | `fn_start_visit()` |
| 11 | Complete visit | own, in-progress | ✗ | ✗ | `fn_complete_visit()` |
| 12 | Save visit draft | own | ✗ | ✗ | RLS |
| 13 | Edit a completed visit | ✗ | ✗ | ✗ | immutability trigger |
| 14 | Delete a visit | ✗ | ✗ | ✗ | `REVOKE DELETE` |
| 15 | Add addendum to a submitted visit | ✗ | +A | +A | `fn_add_addendum()` |
| 16 | View own visit history | ✓ | ✓ | ✓ | RLS |
| 17 | View other reps' *submitted* visit summaries (doctor history) | RO | ✓ | ✓ | RLS SELECT policy |
| 18 | View other reps' visit **drafts** | ✗ | ✗ | ✗ | RLS (`is_draft = false` in the shared-read policy) |
| **Doctors / clinics** |
| 19 | View clinic & doctor master data | RO | RO | ✓ manage | RLS |
| 20 | Edit doctor visit history | ✗ | ✗ | ✗ | immutability |
| 21 | Create / edit / soft-delete clinics, doctors | ✗ | ✗ | ✓ | RLS `is_admin()` |
| **Brands** |
| 22 | View brands assigned to self | ✓ | ✓ all | ✓ all | RLS |
| 23 | Manage brands / products | ✗ | ✗ | ✓ | RLS |
| 24 | Manage rep–brand assignments | ✗ | ✗ | ✓ | RLS |
| **Exceptions** |
| 25 | Submit exception / cancellation request | own | ✗ | ✗ | RLS INSERT |
| 26 | Approve or reject an exception | ✗ | ✓ team | ✓ | `fn_review_exception()` |
| 27 | Approve **own** exception | ✗ | ✗ (blocked even for a manager's own visit) | ✗ | `CHECK approved_by <> rep_id` + function guard |
| **KPI & reporting** |
| 28 | View own KPI | ✓ | ✓ | ✓ | view RLS |
| 29 | View team / all KPI | ✗ | ✓ | ✓ | view RLS |
| 30 | Export data (CSV) | ✗ | ✓ | ✓ | `fn_export_*` + audit entry |
| 31 | View audit log | ✗ | ✓ RO | ✓ RO | RLS SELECT only |
| 32 | Edit / delete audit log | ✗ | ✗ | ✗ | grants revoked |
| **Administration** |
| 33 | View administrative configuration | ✗ | ✗ | ✓ | RLS |
| 34 | Manage users & roles | ✗ | ✗ | ✓ | RLS + `fn_set_user_role()` |
| 35 | Manage clinic GPS coords & radius | ✗ | ✗ | ✓ | RLS |
| 36 | Manage approved email domains | ✗ | ✗ | ✓ | RLS |
| 37 | Configure KPI settings (new rule version) | ✗ | ✗ | ✓ | `fn_create_kpi_rule_version()` |
| 38 | Configure retention settings | ✗ | ✗ | ✓ | RLS `app_setting` |
| 39 | Import master data from Excel/CSV | ✗ | ✗ | ✓ | admin screen + `fn_import_*` |
| 40 | Enable audio recording flag | ✗ | ✗ | ✓ (disabled by default, requires consent workflow) | `app_setting` |

---

## 2. Row-Level-Security policy summary

Every table has `ENABLE ROW LEVEL SECURITY`. There is no
"allow all" fallback policy anywhere; a table with no matching policy denies access.
An automated test (`tests/db/rls.test.ts`) fails the build if any table in `public`
ever lacks RLS or lacks a policy.

**`FORCE ROW LEVEL SECURITY` is deliberately NOT used.** `FORCE` applies policies to the
table *owner* as well. The identity helpers below are `SECURITY DEFINER` and read
`app_user`; under `FORCE` they would become subject to the very `app_user` policy that
calls them, and recurse. The owner role never serves application traffic — PostgREST
connects as `anon` or `authenticated` — so `FORCE` would add no protection against any
realistic attacker. Recorded here so it reads as a decision, not an oversight.

Helper functions (all `SECURITY DEFINER`, `STABLE`, `search_path = ''`):

```sql
fn_current_app_user()  -> app_user row for auth.uid()
fn_current_role()      -> user_role
fn_is_admin()          -> boolean
fn_is_manager()        -> boolean   -- manager OR administrator
fn_is_rep()            -> boolean
fn_manages(rep uuid)   -> boolean   -- admin, or manager_id = me
```

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `app_user` | self, or manager/admin | admin | admin (self may update `full_name`, `phone`) | none |
| `clinic`, `doctor`, `brand`, `product`, `doctor_clinic` | any active authenticated user | admin | admin | none (soft delete) |
| `rep_brand_assignment` | self, manager, admin | admin | admin | none |
| `weekly_plan` | own · manager/admin all | own rep, status=draft | own rep while editable; manager for review fields | none |
| `planned_visit` | own · manager/admin all | own, plan editable | own while plan editable; manager reschedule | none |
| `visit` | own · **all reps may read `is_draft=false`** · manager/admin all | own via `fn_start_visit` | own while `in_progress` and draft | **revoked** |
| `visit_event` | same as parent visit | function only | **revoked** | **revoked** |
| `visit_addendum` | same as parent visit | manager/admin | **revoked** | **revoked** |
| `visit_exception` | own · manager/admin all | own | manager/admin review fields only | none |
| `audit_log` | manager/admin | function only (`SECURITY DEFINER`) | **revoked** | **revoked** |
| `app_setting`, `approved_email_domain`, `kpi_rule_version` | admin (a safe subset readable by all: geofence + accuracy thresholds) | admin | admin | none |

### The critical "shared doctor history" policy
```sql
CREATE POLICY visit_read_submitted_for_all_reps ON public.visit
FOR SELECT TO authenticated
USING (
  public.fn_is_manager()
  OR rep_id = (public.fn_current_app_user()).id
  OR (is_draft = false AND status IN ('completed','missed','cancelled_approved','cancelled_unapproved'))
);
```
This delivers acceptance criterion #10 (another authorised representative can read the doctor's previous
visit history) while criterion #18 (drafts stay private) still holds.

---

## 3. Deliberate separation-of-duty rules

1. **No self-approval.** `fn_review_exception()` raises if `approved_by = rep_id`, and the table has a `CHECK`.
2. **No silent alteration.** A manager's correction lands in `visit_addendum`; `visit` itself is untouched, so the
   original submission is always recoverable and Power BI can show both.
3. **Admins do not approve business events.** Administrators manage configuration; they *can* act as a manager for
   exceptions only because the business has three managers and needs cover — this is a deliberate, documented choice
   and every such action is audited.
4. **No client-side-only enforcement.** Every row in the matrix above is also true if someone calls the REST API
   directly with a stolen anon key. Tests in `tests/rls/` assert this.
