# 03 — User Roles and Permissions Matrix

Three roles: **Medical Representative** (Эмнэлгийн төлөөлөгч), **Manager**
(Менежер), **Administrator** (Администратор).

Every permission below is enforced in the database with Row Level Security (RLS)
or inside a `SECURITY DEFINER` function. **The mobile app only hides buttons —
hiding is not security.** If someone bypassed the app entirely and called the API
directly, the same answers apply.

Legend
`✅` allowed · `👤` allowed for own records only · `📄` read-only ·
`➕` may add an addendum but not change the original · `❌` denied

---

## 1. Master matrix

| # | Capability | Representative | Manager | Administrator |
|---|---|:--:|:--:|:--:|
| **Authentication** ||||
| 1 | Log in with an approved company e-mail | ✅ | ✅ | ✅ |
| 2 | Log in with any other e-mail | ❌ | ❌ | ❌ |
| **Weekly plans** ||||
| 3 | View own weekly plans | ✅ | ✅ | 📄 |
| 4 | View all representatives' plans | ❌ | ✅ | 📄 |
| 5 | Create / edit own future plan before the deadline | ✅ | ❌ | ❌ |
| 6 | Edit own plan after the deadline / after lock | ❌ | ❌ | ❌ |
| 7 | Edit another representative's plan | ❌ | ❌ | ❌ |
| 8 | Submit own plan | ✅ | ❌ | ❌ |
| 9 | Approve / reject a submitted plan | ❌ | ✅ | ❌ |
| 10 | Reassign or reschedule a visit | ❌ | ✅ | ❌ |
| **Visits** ||||
| 11 | Start own planned visit inside the geofence | ✅ | ❌ | ❌ |
| 12 | Start someone else's visit | ❌ | ❌ | ❌ |
| 13 | Complete own visit report | ✅ | ❌ | ❌ |
| 14 | Save a draft during a visit | 👤 | ❌ | ❌ |
| 15 | Edit a **submitted** visit report | ❌ | ❌ | ❌ |
| 16 | Delete a visit record | ❌ | ❌ | ❌ |
| 17 | Add an official addendum to a submitted visit | ❌ | ➕ | ➕ |
| 18 | View check-in / check-out location and time | 👤 | ✅ | ✅ |
| **Doctor history** ||||
| 19 | Read submitted visit history for any doctor | ✅ | ✅ | ✅ |
| 20 | Edit previous doctor visit history | ❌ | ❌ | ❌ |
| 21 | Filter history by date / brand / rep / clinic / outcome | ✅ | ✅ | ✅ |
| **Master data** ||||
| 22 | View clinics, doctors, brands, products | 📄 | 📄 | ✅ |
| 23 | Create / edit / soft-delete clinics | ❌ | ❌ | ✅ |
| 24 | Create / edit / soft-delete doctors | ❌ | ❌ | ✅ |
| 25 | Create / edit brands and products | ❌ | ❌ | ✅ |
| 26 | Set clinic GPS coordinates and geofence radius | ❌ | ❌ | ✅ |
| 27 | Import master data from Excel / CSV | ❌ | ❌ | ✅ |
| 28 | View brands assigned to self | ✅ | ✅ | ✅ |
| 29 | Change representative–brand assignments | ❌ | ❌ | ✅ |
| **Exceptions** ||||
| 30 | Submit an exception / cancellation request | ✅ | ❌ | ❌ |
| 31 | Approve or reject own exception | ❌ | ❌ | ❌ |
| 32 | Approve or reject another person's exception | ❌ | ✅ | ❌ |
| 33 | View own exceptions | ✅ | ✅ | ✅ |
| 34 | View all exceptions | ❌ | ✅ | ✅ |
| 35 | Approve absences (holiday / sick leave) | ❌ | ✅ | ❌ |
| **KPI & reporting** ||||
| 36 | View own KPI | ✅ | ✅ | ✅ |
| 37 | View team and individual KPIs | ❌ | ✅ | ✅ |
| 38 | Export CSV | ❌ | ✅ | ✅ |
| 39 | Configure KPI rules | ❌ | ❌ | ✅ |
| 40 | Connect Power BI (read-only DB role) | ❌ | ✅* | ✅* |
| **Administration** ||||
| 41 | View administrative configuration | ❌ | ❌ | ✅ |
| 42 | Manage users and roles | ❌ | ❌ | ✅ |
| 43 | Manage approved e-mail domains | ❌ | ❌ | ✅ |
| 44 | Configure retention settings | ❌ | ❌ | ✅ |
| 45 | Change own role | ❌ | ❌ | ❌ |
| **Audit** ||||
| 46 | View audit log | ❌ | ✅ | ✅ |
| 47 | Edit or delete audit records | ❌ | ❌ | ❌ |
| **Audio (disabled in MVP)** ||||
| 48 | Record audio | ❌ (flag off) | ❌ | ❌ |
| 49 | Play back audio, if ever enabled | ❌ | ✅ | ❌ |

\* Power BI access is a **separate database login** (`powerbi_reader`), not the
app account. It is granted by the administrator to a named person and is
read-only on the `reporting` schema.

---

## 2. Explicit "cannot" list from the requirements

**Representative cannot:** edit another representative's plan · edit completed
visit records · delete visit records · edit previous doctor visit history · view
administrative configuration · approve their own exceptions.

**Manager cannot:** silently alter an original submitted visit record. Managers
may only *append* an addendum, which is stored separately with author and
timestamp and is always displayed next to — never instead of — the original.

**Administrator cannot:** approve exceptions, submit visits, or change historical
records. Administrators configure the system; they do not operate it. This is a
deliberate separation of duties.

**Nobody can:** edit or delete `visit_events`, submitted `visit_reports`,
`visit_addenda`, `visit_status_history`, or `audit_logs`. These grants do not
exist in the database for any application role.

---

## 3. How this maps to RLS policies

Helper functions (all `stable security definer`, `search_path = ''`):

```sql
auth_user_id()   -- uuid of the signed-in app user, null if not signed in
auth_role()      -- 'representative' | 'manager' | 'administrator' | null
is_active_user() -- false for deactivated staff → they can read nothing
is_manager()     -- auth_role() in ('manager','administrator')
is_admin()       -- auth_role() = 'administrator'
```

Representative examples:

```sql
-- Read own plans only
create policy weekly_plans_select_own on public.weekly_plans
  for select using (is_active_user() and representative_id = auth_user_id());

-- Managers and admins read everything
create policy weekly_plans_select_all on public.weekly_plans
  for select using (is_active_user() and is_manager());

-- Update own plan only while it is a draft or rejected
create policy weekly_plans_update_own on public.weekly_plans
  for update using (
    is_active_user()
    and representative_id = auth_user_id()
    and status in ('draft','rejected')
    and locked_at is null
  );
```

Immutability example:

```sql
revoke update, delete on public.visit_events from authenticated;
create trigger trg_visit_events_immutable
  before update or delete on public.visit_events
  for each row execute function public.raise_immutable();
```

Self-approval prevention (belt and braces — constraint *and* function check):

```sql
alter table public.visit_exceptions
  add constraint chk_no_self_approval check (decided_by is null or decided_by <> requested_by);
```

---

## 4. Session and account rules

| Rule | Value |
|---|---|
| Session length | 7 days, refresh token rotation enabled |
| Idle re-authentication | Re-enter OTP after 7 days of inactivity |
| OTP validity | 10 minutes, single use |
| OTP request rate limit | 3 per e-mail per 15 minutes, 30 per IP per hour |
| Deactivated user | `is_active = false` → `is_active_user()` returns false → every policy fails → the app shows "Таны эрх идэвхгүй байна" and signs out |
| Role change | Written to `audit_logs`; takes effect on the user's next token refresh (≤ 1 hour) |
| Device | No device limit; sessions are stored in the OS keychain/keystore |
