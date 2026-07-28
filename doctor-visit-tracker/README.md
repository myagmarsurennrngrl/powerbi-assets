# Doctor Visit Tracker · Эмчийн уулзалтын бүртгэл

Internal mobile application for a Mongolian cosmetics and dermocosmetics importer.
Seven medical representatives plan and record visits to dermatology clinics in Ulaanbaatar;
managers get visibility and KPIs; the data feeds Power BI.

**UI language: Mongolian. Code, schema and documentation: English.**

> **Never installed a developer tool before?**
> Start at **[`docs/90-setup-for-non-technical.md`](docs/90-setup-for-non-technical.md)**, not here.

---

## Current state

| | |
|---|---|
| **Phase** | 4 of 7 complete — see [`docs/PHASE-4-STATUS.md`](docs/PHASE-4-STATUS.md) |
| **Tests** | 221 passing |
| **Platforms** | iOS and Android bundles verified |
| **Audio recording** | Not implemented. Flag off. No recording code exists. |

Phase 1 delivered authentication, roles, row-level security, the audit log, and all master
data. Phase 2 adds weekly planning, the plan status machine with a Friday-18:00 submission
deadline, duplicate-visit prevention, and today's route with opt-in distance. Phase 3 adds the
evidence layer: geofenced check-in with all eight conditions enforced server-side, an active-visit
timer driven by the server clock, and check-out. Phase 4 adds the structured visit report, immutable
once submitted, corrections as separate addenda, and the shared doctor history every representative
reads. Exceptions, KPI, manager dashboards and offline support are Phases 5–7.

Phase reports: [1](docs/PHASE-1-STATUS.md) · [2](docs/PHASE-2-STATUS.md) · [3](docs/PHASE-3-STATUS.md) · [4](docs/PHASE-4-STATUS.md)

---

## Design documents — read these first

| Document | What it answers |
|---|---|
| [`01-architecture.md`](docs/01-architecture.md) | How the pieces fit; why the phone is never trusted; the Entra ID migration path |
| [`02-database-schema.md`](docs/02-database-schema.md) | Every table, column and constraint |
| [`03-roles-permissions.md`](docs/03-roles-permissions.md) | The 40-row permissions matrix and how each row is enforced |
| [`04-screens-and-navigation.md`](docs/04-screens-and-navigation.md) | All 23 screens, the navigation map, the visit form |
| [`05-kpi-rules.md`](docs/05-kpi-rules.md) | Exact KPI arithmetic, with a worked example |
| [`06-implementation-phases.md`](docs/06-implementation-phases.md) | What ships in each phase |
| [`07-risks.md`](docs/07-risks.md) | Privacy, GPS, security and audio risks — **includes decisions needed from management** |
| [`90-setup-for-non-technical.md`](docs/90-setup-for-non-technical.md) | Step-by-step setup with no assumed knowledge |

---

## Two principles that explain most of the code

**1. The phone is never trusted.**
The app may *disable* a button for usability. The server must *reject* the action
independently. Distances are recomputed server-side from submitted coordinates; timestamps
come from the server clock; permissions are row-level security policies. The test suite
proves each rule by connecting as a real `authenticated` user — the same way a stolen API
key would.

**2. Nothing visible is fake.**
Any screen or control that is not built yet says «Хараахан хэрэгжээгүй» and names the phase
it is coming in. There are no placeholder buttons.

---

## Developer quick start

```bash
npm install                 # .npmrc sets legacy-peer-deps — see PHASE-1-STATUS §5.6
cp .env.example .env        # then fill in the two Supabase values
npm start                   # scan the QR code with Expo Go
```

```bash
npm test                    # 221 tests (skips DB tests if no PostgreSQL is running)
npm run typecheck           # app + tests
node scripts/db-provision.mjs   # rebuild a local test database from scratch
```

### Layout
```
app/                    Expo Router screens
src/domain/             Pure business logic — no React, no Supabase, fully unit-tested
src/lib/auth/           AuthProvider interface (the Entra ID swap point)
src/data/               Repositories; the single place offline caching will be added
supabase/migrations/    Numbered, forward-only SQL
supabase/seed/          Fictional test data
tests/                  Domain tests + policy tests run as real database users
docs/                   Design documents and manuals
```

### Database tests

They are not mocked. `scripts/db-provision.mjs` builds a real PostgreSQL database from the
migrations, then each test runs inside a rolled-back transaction as the `authenticated` or
`anon` role with the same JWT claim PostgREST sets. A policy that passes here passes in
production.

`supabase/tests/00_local_shim.sql` recreates the small part of Supabase (`auth.users`,
`auth.uid()`, the three roles) that a plain PostgreSQL lacks. It is never applied to the
real project.

---

## Security posture

- Login restricted to approved company email domains, enforced by a trigger on `auth.users`.
- Row-level security on every table, with a structural test that fails the build if a new
  table ever lands without a policy.
- `DELETE` is granted almost nowhere: master data is soft-deleted and transactional data is
  immutable. The only exceptions are the child lists of a draft plan (a visit's doctors and
  brands), and a test with an explicit allowlist fails the build if that ever widens.
- Append-only audit log, protected by revoked grants *and* a trigger.
- Session tokens in the device keychain/keystore, not plain storage.
- The app refuses to start if a `service_role` key is found in its configuration.
- No background location. Location is read only at check-in, check-out, and an exception the
  representative chooses to submit.
- No patient information is collected anywhere, by design of the schema.
