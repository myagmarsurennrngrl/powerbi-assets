# Doctor Visit Tracker — Эмч уулзалтын бүртгэл

Internal mobile application for a Mongolian cosmetics and dermocosmetics
importer. Seven medical representatives visit dermatology clinics in
Ulaanbaatar; this app plans those visits, confirms that they really happened,
documents what was discussed, and reports on it.

**Interface language:** Mongolian.
**Code, database and documentation:** English.
**Timezone:** Asia/Ulaanbaatar, 24-hour clock.

---

## Status

| Phase | Scope | State |
|---|---|---|
| **1** | Authentication, roles, users, clinics, doctors, brands, products | ✅ **Complete** |
| 2 | Weekly planning and today's route | ⬜ Not started |
| 3 | Location validation, check-in, active visit, check-out | ⬜ Not started |
| 4 | Visit documentation and doctor history | ⬜ Not started |
| 5 | Exceptions and KPI | ⬜ Not started |
| 6 | Manager dashboard, exports, audit log, Power BI | ⬜ Not started |
| 7 | Offline capability, hardening, deployment | ⬜ Not started |

Every screen belonging to a later phase is present, explains what it will do,
and is labelled **"Хараахан хэрэгжээгүй"**. There are no placeholder buttons
and no fake functionality anywhere in the app.

---

## Start here

| If you are… | Read |
|---|---|
| The business owner, setting this up for the first time | [`docs/setup/01-SETUP-FOR-BEGINNERS.md`](docs/setup/01-SETUP-FOR-BEGINNERS.md) |
| Testing Phase 1 | [`docs/setup/02-HOW-TO-TEST-PHASE-1.md`](docs/setup/02-HOW-TO-TEST-PHASE-1.md) |
| A developer | [`docs/setup/03-LOCAL-DEVELOPMENT.md`](docs/setup/03-LOCAL-DEVELOPMENT.md) |

## Design documents

| Document | Contents |
|---|---|
| [`docs/01-ARCHITECTURE.md`](docs/01-ARCHITECTURE.md) | Stack, diagram, where each rule is enforced, offline design, Entra ID migration path |
| [`docs/02-DATABASE-SCHEMA.md`](docs/02-DATABASE-SCHEMA.md) | Every table and column, for all seven phases |
| [`docs/03-ROLES-PERMISSIONS.md`](docs/03-ROLES-PERMISSIONS.md) | 49-row permissions matrix and how it maps to RLS |
| [`docs/04-SCREENS-NAVIGATION.md`](docs/04-SCREENS-NAVIGATION.md) | 23 screens, navigation flows, design tokens |
| [`docs/05-KPI-RULES.md`](docs/05-KPI-RULES.md) | Formulas, inclusions, exclusions, rule versioning, anti-gaming |
| [`docs/06-IMPLEMENTATION-PHASES.md`](docs/06-IMPLEMENTATION-PHASES.md) | What each phase delivers and its definition of done |
| [`docs/07-RISKS-PRIVACY-SECURITY.md`](docs/07-RISKS-PRIVACY-SECURITY.md) | Privacy, GPS, security and audio-recording risks with mitigations |

---

## Two design decisions worth knowing

**The phone is never trusted.** It offers a distance and a timestamp; the
server recomputes both and stamps its own time. Hiding a button in the app is
a convenience, never a control — every rule is enforced again in PostgreSQL
with Row Level Security or a `SECURITY DEFINER` function, and the SQL test
suite proves it by running as the `authenticated` role.

**Location is not tracking.** Background location is not merely switched off;
the permission is not declared and `expo-task-manager` is not a dependency, so
there is no code path that could track anyone. Location is read at exactly
three moments: check-in, check-out, and a voluntary exception request. At most
three coordinates per visit. The app says so, in Mongolian, on its own privacy
screen.

---

## Technology

Expo SDK 57 · React Native 0.86 · TypeScript (strict) · Expo Router ·
TanStack Query · Zod · Supabase (PostgreSQL 15, Auth, RLS) · Vitest

---

## Verification

All five gates pass as of Phase 1:

```
npm run typecheck              # 0 errors
npm run lint                   # 0 errors
npm test                       # 126 tests passing
./scripts/run-sql-tests.sh     # 100 assertions passing across 3 files
npx expo export --platform android   # bundles successfully
```

The SQL suite runs against a real PostgreSQL server as the `authenticated`
role, so it tests the security policies as they will actually behave — not a
mock of them.

---

## Security posture in one paragraph

Login is gated twice: the e-mail domain must be on an administrator-managed
approved list, **and** an administrator must already have created the staff
record. Both are enforced by a trigger on `auth.users`, so an outsider never
obtains a usable account however many one-time codes they receive. Every table
has Row Level Security; the blanket grants Supabase adds by default are
revoked and re-granted verb by verb. Visit events, submitted reports, addenda
and the audit log have no `UPDATE` or `DELETE` grant for any application role,
and a trigger blocks those operations as a second line of defence. Nobody —
including an administrator — can change their own role or approve their own
exception. The Supabase anon key shipped in the app is a public identifier and
grants nothing on its own; the service-role key never leaves the server.
