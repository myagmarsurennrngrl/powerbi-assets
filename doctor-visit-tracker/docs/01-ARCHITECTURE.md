# 01 — Proposed Architecture

**Project:** Doctor Visit Tracker (Эмч уулзалтын бүртгэл)
**Owner:** Cosmetics / dermocosmetics importer, Ulaanbaatar
**UI language:** Mongolian. **Code / DB / docs language:** English.
**Timezone for all business logic:** `Asia/Ulaanbaatar` (UTC+8), 24-hour clock.

---

## 1. Plain-language summary (for non-technical readers)

Think of the system as three parts:

| Part | What it is | Everyday analogy |
|---|---|---|
| **Mobile app** | What the 7 medical representatives and 3 managers install on their phone | The form you fill in |
| **Database + rules server (Supabase)** | Where all data lives and where the rules are enforced | The locked filing cabinet with a guard at the door |
| **Power BI** | Read-only reporting that connects to the database | The report printer |

The most important design decision: **the phone is never trusted**. The phone
suggests things ("I am 40 metres from the clinic", "the time is 10:02"), but the
*server* decides whether that is acceptable and stamps the official time itself.
If we trusted the phone, a representative could change their phone clock or fake
their GPS and the record would be wrong.

---

## 2. Technology stack

| Layer | Choice | Version target | Why |
|---|---|---|---|
| Mobile app | Expo (React Native) | SDK 57 | One codebase for iOS + Android, over-the-air updates, no Mac needed for most work |
| Language | TypeScript (strict) | 5.9.x | Catches mistakes before the app ships |
| Navigation | Expo Router | 57.x | File-based routing, deep links, typed routes |
| Server data | TanStack Query | 5.x | Caching, retry, background refetch on weak networks |
| Local storage (offline) | `expo-sqlite` | SDK 57 build | Real SQL cache + durable outbox queue |
| Secure storage | `expo-secure-store` | SDK 57 build | Session tokens in Keychain / Keystore, never in plain files |
| Location | `expo-location` (foreground only) | SDK 57 build | One-shot reads only; **no** background location |
| Connectivity | `expo-network` | SDK 57 build | Detects online/offline for the sync engine |
| Database | PostgreSQL 15+ (Supabase) | managed | Row Level Security, views for Power BI |
| Auth | Supabase Auth — email OTP / magic link | managed | No passwords to leak; domain-restricted |
| Server logic | Postgres functions (`SECURITY DEFINER` RPCs) + Edge Functions | — | Business rules live next to the data, cannot be bypassed |
| Files | Supabase Storage (private buckets) | — | Exception attachments |
| Tests | Vitest | 4.x | Fast unit/integration tests for business rules |
| Migrations | Supabase CLI SQL migrations | — | Every DB change is a numbered, reviewable file |
| Reporting | Postgres views in a `reporting` schema | — | Clean star schema for Power BI |

**No secret is ever written in source code.** Configuration comes from
environment variables (`.env`, `.env.example` is committed, `.env` is not).

---

## 3. High-level diagram

```
┌───────────────────────────────────────────────────────────┐
│                    MOBILE APP (Expo)                      │
│                                                           │
│  UI layer (Mongolian)                                     │
│    app/  — Expo Router screens                            │
│                                                           │
│  Domain layer (pure TypeScript, 100% unit-tested)         │
│    src/domain/geo.ts        Haversine, radius eligibility │
│    src/domain/visitRules.ts Start-button eligibility      │
│    src/domain/kpi.ts        KPI formulas                  │
│    src/domain/validation.ts Zod schemas, email domain     │
│                                                           │
│  Data layer                                               │
│    src/services/auth/*   AuthProvider interface  ◄── swappable
│    src/services/api/*    Supabase calls / RPC wrappers    │
│    src/offline/db.ts     SQLite cache                     │
│    src/offline/outbox.ts Durable queue + sync engine      │
└───────────────┬───────────────────────────────────────────┘
                │ HTTPS (TLS 1.2+), JWT bearer token
                ▼
┌───────────────────────────────────────────────────────────┐
│                       SUPABASE                            │
│                                                           │
│  Auth (email OTP)                                         │
│    └─ trigger: reject e-mails outside approved domains    │
│    └─ hook:    put role + user id into the JWT            │
│                                                           │
│  PostgREST API  ── every table protected by RLS           │
│                                                           │
│  Postgres                                                 │
│    public.*      operational tables                       │
│    reporting.*   read-only views for Power BI             │
│    RPC functions: start_visit, complete_visit,            │
│                   submit_plan, decide_exception, …        │
│    Triggers: immutability, audit log, dedupe guard        │
│                                                           │
│  Storage (private buckets, signed URLs only)              │
└───────────────┬───────────────────────────────────────────┘
                │ read-only Postgres role `powerbi_reader`
                ▼
        ┌────────────────────────┐
        │  Power BI (DirectQuery │
        │  or scheduled import)  │
        └────────────────────────┘
```

---

## 4. Where each business rule is enforced

The golden rule: **client-side checks are only for user experience. Every rule is
re-checked on the server.**

| Rule | Client (UX) | Server (authoritative) |
|---|---|---|
| Only approved e-mail domain may log in | Hides the button, shows a message | Trigger on `auth.users` blocks the account; RLS blocks all data |
| Representative may only see own plans | Query filter | RLS policy `USING (representative_id = auth_user_id())` |
| Cannot start a visit outside the geofence | Button disabled + distance shown | `rpc_start_visit` recomputes Haversine from the clinic row and raises an error |
| Only one visit in progress at a time | Button disabled | Partial unique index + check inside `rpc_start_visit` |
| Completed visits are immutable | No edit UI | `BEFORE UPDATE` trigger raises an exception; `UPDATE`/`DELETE` revoked |
| Only managers approve exceptions | Screen hidden | `rpc_decide_exception` checks role; RLS on `visit_exceptions` |
| Audit log cannot be tampered with | — | `INSERT`-only grants; no `UPDATE`/`DELETE` for any application role |

---

## 5. Authentication design (and how to swap in Microsoft Entra ID later)

### Today — Supabase email OTP

1. The user types their work e-mail (e.g. `name@company.mn`).
2. The app calls `signInWithOtp`. Supabase e-mails a 6-digit code.
3. The user types the code. Supabase returns a session (JWT).
4. A DB trigger on `auth.users` **refuses to create** any account whose e-mail
   domain is not in the `approved_email_domains` table. An outsider therefore
   never gets a usable account, even if they receive a code.
5. Row Level Security reads the person's role through five small
   `SECURITY DEFINER` helper functions (`auth_user_id()`, `auth_role()`,
   `is_active_user()`, `is_manager()`, `is_admin()`). They are `STABLE`, so
   PostgreSQL evaluates them once per statement rather than once per row.
   A *custom access token hook* that copies the role into the JWT is a
   possible later optimisation; it is deliberately NOT used in Phase 1,
   because it needs manual dashboard configuration and would give a second,
   cacheable copy of the role that could go stale after a role change.

### Tomorrow — Microsoft Entra ID

The app never talks to Supabase Auth directly. It talks to this interface:

```ts
// src/services/auth/types.ts
export interface AuthProvider {
  getSession(): Promise<AppSession | null>;
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<AppSession>;
  signOut(): Promise<void>;
  onAuthStateChange(cb: (s: AppSession | null) => void): Unsubscribe;
}
```

Two implementations are possible: `SupabaseAuthProvider` (today) and
`EntraAuthProvider` (later). Because of this:

* Screens do **not** change when the provider changes.
* `app_users` has its own primary key and a *separate* `auth_user_id` column
  pointing at the identity provider's account, plus `auth_provider` and
  `external_id`. Because the staff record is never keyed on the provider's id,
  an Entra object-id can be attached to an existing person without a single
  plan, visit or audit row moving.
* RLS reads `auth_user_id()`, a single helper function — only that function has
  to learn about the new claim shape.

Estimated migration effort: **one new provider file + one helper-function
change + a user-mapping script**. No screen, table, or report changes.

---

## 6. Offline architecture

### What is cached on the phone

| Data | Refresh | Reason |
|---|---|---|
| Today's + this week's planned visits | On app open, on pull-to-refresh | The representative must see the route in a lift/basement |
| Clinics (active) | Daily | Address, coordinates, radius needed for the geofence check |
| Doctors + doctor–clinic links (active) | Daily | Needed to fill the report |
| Brands, products, my brand assignments | Daily | Needed to fill the report |
| Last 30 days of submitted visit summaries for viewed doctors | On view | Doctor history while offline |
| App settings (radius default, accuracy threshold, feature flags) | On app open | Rules must work offline |

### The outbox (queue)

Every write the representative makes goes into a local SQLite table `outbox`:

```
outbox(id, client_event_id UUID, operation, payload_json, created_at,
       attempts, last_error, state)   state ∈ pending | syncing | failed | synced
```

* Every operation carries a **`client_event_id`** generated on the phone.
* The server stores it with a `UNIQUE` constraint. If the phone retries because
  it never saw the reply, the second attempt is recognised and ignored — the
  visit is never duplicated. This is called *idempotency*.
* The sync engine runs when: the app opens, connectivity returns, the user taps
  "Дахин илгээх", and every 60 seconds while the app is in the foreground.
* Exponential backoff: 2s, 4s, 8s, 16s, 32s, then every 5 minutes.

### Offline geofence check

The clinic's latitude/longitude/radius are already cached, and the GPS chip works
without internet. So the phone **can** check the geofence offline and let the
visit start. When the record syncs, `rpc_start_visit` recomputes the distance
server-side. If the server disagrees (e.g. the admin moved the clinic
coordinates), the visit is accepted but flagged
`geofence_verified = false` and appears in the manager's "Visits started outside
expected conditions" list. Nothing is silently discarded.

### Conflict rules

| Situation | Resolution |
|---|---|
| Same `client_event_id` arrives twice | Server returns the original row, no duplicate |
| Visit was cancelled by a manager while the rep was offline and completed it | Server accepts the completion, records `late_submission = true`, notifies the manager |
| Two devices of the same user both hold an unsynced check-in for one visit | Server accepts the first, rejects the second with `VISIT_ALREADY_STARTED`; the phone marks it **failed to sync** and shows the reason |
| Master data changed after the phone cached it | Server data always wins; the phone refreshes on next sync |

### Sync status shown to the user

Every record on screen carries one of three badges, in Mongolian:

* 🟢 **Синк хийгдсэн** — synced
* 🟡 **Синк хүлээгдэж байна** — waiting to sync
* 🔴 **Синк амжилтгүй** — failed to sync (tap to see the reason and retry)

---

## 7. Location privacy architecture

* `expo-location` is used in **foreground, one-shot** mode only.
  `expo-location`'s background permission and `TaskManager` are **not installed**,
  so continuous tracking is impossible even by mistake.
* Location is requested at exactly three moments: check-in, check-out, and when
  the representative voluntarily submits an exception.
* Three rows of coordinates per visit maximum. No route, no trail, no polling.
* This is stated in the app's own privacy screen ("Байршлын нууцлал") so
  employees can see the limit for themselves.

---

## 8. Repository layout

```
doctor-visit-tracker/
├── app/                       Expo Router screens (the UI, Mongolian)
│   ├── (auth)/                login, otp
│   ├── (rep)/                 representative tabs
│   ├── (manager)/             manager tabs
│   ├── (admin)/               administrator tabs
│   └── _layout.tsx            role-based routing
├── src/
│   ├── domain/                pure business logic  ← heavily unit-tested
│   ├── services/
│   │   ├── auth/              AuthProvider interface + Supabase impl
│   │   └── api/               typed data access
│   ├── offline/               SQLite cache + outbox + sync engine
│   ├── i18n/                  Mongolian strings, date/time formatting
│   ├── ui/                    shared components (buttons, badges, states)
│   └── config/                env loading + validation
├── supabase/
│   ├── migrations/            numbered .sql files
│   ├── seed/                  test data
│   └── functions/             Edge Functions (CSV export, admin invite)
├── tests/                     Vitest suites
└── docs/                      this documentation set
```

---

## 9. Deployment topology

| Environment | Supabase project | App distribution | Who uses it |
|---|---|---|---|
| **dev** | `dvt-dev` | Expo Go / dev client on the developer's phone | Developer |
| **staging** | `dvt-staging` | EAS internal distribution (TestFlight / Android internal) | 1 manager + 2 representatives for acceptance testing |
| **production** | `dvt-prod` | EAS build → TestFlight/App Store (iOS), Play Console internal or closed track (Android) | All 11 staff |

Because it is an internal app for 11 people:
* **iOS:** Apple Business Manager custom app **or** TestFlight (simplest; 90-day builds).
* **Android:** Play Console *Internal testing* track (fastest, no review wait).
Both are documented step-by-step in `docs/setup/`.

---

## 10. Non-goals for the MVP (explicitly out of scope)

* Audio recording (tables + flag exist, feature is **off**, no UI).
* Background/continuous location tracking — deliberately impossible.
* Patient data of any kind — no field exists, and free-text fields carry a
  warning plus a server-side pattern check for national ID numbers.
* Offline creation of *new unplanned* visits in Phase 1–6 (added in Phase 7).
* Push notifications (candidate for a later phase).
