# Local development

For whoever maintains the code. If you are the business owner, you do not need
this file — `01-SETUP-FOR-BEGINNERS.md` is yours.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20 or 22 LTS | build tooling |
| npm | 10+ | packages |
| PostgreSQL | 15 or 16, client + server | running the SQL test suite locally |
| Supabase CLI | latest | optional; managing migrations against a project |

---

## First run

```bash
cd doctor-visit-tracker
npm install
cp .env.example .env      # then fill in the two Supabase values
npm start
```

`.npmrc` sets `legacy-peer-deps=true`. That is deliberate: `expo-router` pulls
in web-only transitive packages (`vaul` → `@radix-ui/*` → `react-dom`) whose
peer ranges are stricter than the React version Expo SDK 57 pins. Those
packages are never bundled for iOS or Android.

---

## Quality gates

Everything below must pass before a phase is considered done.

```bash
npm run typecheck        # tsc --noEmit, zero errors
npm run lint             # eslint, zero errors
npm test                 # vitest, all green
./scripts/run-sql-tests.sh   # database rules, all green
npx expo export --platform android   # proves the app really bundles
```

---

## The database test harness

The SQL tests run against a **plain PostgreSQL server**, not against Supabase.
That is on purpose: the tests then run on any machine and in CI with no
account, no network and no cost.

`supabase/tests/00_supabase_stub.sql` supplies the small part of Supabase the
migrations touch — the `auth` schema, `auth.uid()`, and the `anon`,
`authenticated`, `service_role` roles. It also reproduces Supabase's default
blanket grants on new `public` tables, so the `REVOKE` statements in the
migration are exercised exactly as they will be in production.

**The stub is never applied to a real Supabase project.**

### Starting a local server

```bash
PGDIR=/tmp/dvt-pg
initdb -D "$PGDIR" -U postgres --auth=trust -E UTF8
pg_ctl -D "$PGDIR" -o "-p 55432 -k /tmp" -l "$PGDIR/server.log" start
```

### Rebuilding the schema

```bash
./scripts/local-db.sh            # migrations only
./scripts/local-db.sh --seed     # migrations plus test data
```

> **The locale matters.** Under the `C` locale PostgreSQL's `lower()` leaves
> Cyrillic untouched, which silently breaks the duplicate-detection indexes on
> clinic and doctor names — the tests would pass while the real behaviour was
> wrong. `local-db.sh` therefore creates the database with a UTF-8 locale and
> refuses to run if none is installed. Supabase projects already use one.

### Running the tests

```bash
./scripts/run-sql-tests.sh              # summary
./scripts/run-sql-tests.sh --verbose    # every individual assertion
```

Each `*.test.sql` file runs inside a transaction that is rolled back at the
end, so the tests never leave anything behind and can run in any order.

Assertions run with `SET LOCAL ROLE authenticated`, exactly as PostgREST does.
Running them as the table owner would prove nothing, because the owner bypasses
Row Level Security.

Two helpers exist because a refusal looks different depending on the verb:

* a blocked `INSERT` raises `violates row-level security policy` →
  `expect_error`
* a blocked `UPDATE`/`DELETE` raises nothing; the rows are simply invisible, so
  zero rows change → `expect_no_rows_changed`

Confusing the two is the easiest way to write a test that passes while proving
nothing.

---

## Applying migrations to a Supabase project

Either paste each file into the SQL Editor in filename order, or use the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Migrations are append-only. To change something already applied, add a new
numbered file — never edit an old one, or environments will drift apart.

Naming: `YYYYMMDDHHMMSS_p<phase>_<subject>.sql`.

---

## Project layout

```
app/                       Expo Router screens (the UI; all text Mongolian)
  (auth)/                  login, verify, no-access
  (app)/                   role-based tabs; nested folders are stacks
src/
  config/env.ts            environment loading and validation
  domain/                  pure business logic — the heavily tested part
  i18n/                    Mongolian strings, Ulaanbaatar date/time
  services/auth/           AuthProvider interface + Supabase implementation
  services/api/            all Supabase calls, one file
  state/                   React context for session and profile
  theme/, ui/              design tokens and shared components
supabase/
  migrations/              numbered SQL, applied in filename order
  seed/                    invented test data
  tests/                   SQL test suite + the Supabase stub
scripts/                   local database and test runners
tests/                     Vitest suites
docs/                      design documents and manuals
```

---

## Conventions

* **All user-facing text lives in `src/i18n/mn.ts`.** No Mongolian string
  belongs in a screen file, so a native speaker can review the whole interface
  in one place.
* **Business rules live in `src/domain/`** as pure functions with no imports
  from React or Supabase, which is what makes them cheap to test.
* **Every rule that matters is enforced in the database too.** The client
  version exists for a fast, friendly error message; the database version is
  what is actually true.
* **No placeholder buttons.** A feature either works or renders
  `<NotImplemented />`, which says "Хараахан хэрэгжээгүй" and names the phase.
* **Timezone.** Only `src/i18n/datetime.ts` converts between UTC and
  Asia/Ulaanbaatar. Nowhere else should do date arithmetic.

---

## Adding a new phase

1. Write the migration(s) under `supabase/migrations/`.
2. Add or extend RLS policies **in the same phase** — never leave a table
   without policies "for now".
3. Add SQL tests for the new rules.
4. Add the data-access functions to `src/services/api/`.
5. Add the domain logic to `src/domain/` and unit-test it.
6. Build the screens, replacing the matching `<NotImplemented />`.
7. Run all five quality gates.
8. Update `docs/setup/02-HOW-TO-TEST-PHASE-*.md`.
