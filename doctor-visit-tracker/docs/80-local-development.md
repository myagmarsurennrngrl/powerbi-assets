# 80 — Local Development

For a developer setting this project up on their own machine.

If you are **not** a developer and just want the app working, read
[`90-setup-for-non-technical.md`](90-setup-for-non-technical.md) instead — it covers the same
ground without assuming any of this.

---

## 1. What you need

| Tool | Version | Why |
|---|---|---|
| Node.js | 20 LTS or newer | Expo and the test runner |
| npm | ships with Node | |
| PostgreSQL | 16 | The database tests run against a real one |
| Expo Go | latest, on a phone | Running the app without building it |
| Supabase CLI | optional | Only needed to push migrations to a real project |

A phone is genuinely required at some point. Nothing about GPS, geofencing or the location
permission flow can be tested in a simulator with any confidence.

---

## 2. First run

```bash
git clone <this repository>
cd doctor-visit-tracker
npm install
cp .env.example .env      # then fill in the two values, see §3
npm start                 # scan the QR code with Expo Go
```

### About `npm install` and `.npmrc`
The repository contains an `.npmrc` with `legacy-peer-deps=true`. It is there because
`expo-router` pulls in a web-only `react-dom` whose peer range is stricter than the React version
Expo SDK 57 pins. Without the flag, `npm install` fails with `ERESOLVE`. Nothing in the mobile app
uses `react-dom`.

---

## 3. Configuration

Two values, both from Supabase → **Project Settings → API**:

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the anon / public key>
```

**Only the `anon` key.** `src/lib/env.ts` decodes the key at startup and refuses to run if it
finds a `service_role` key, because anything prefixed `EXPO_PUBLIC_` is compiled into the app
bundle and must be assumed public. A `service_role` key there would hand every user of the app
full database access, bypassing every policy in this project.

`.env` is git-ignored. No secret is written in source anywhere; if you are about to add one, that
is the signal to stop.

---

## 4. The local test database

The database tests are not mocked. They build a real PostgreSQL database from the migrations and
run each test inside a rolled-back transaction *as the actual `authenticated` or `anon` role*,
with the same JWT claim PostgREST sets. A policy that passes here passes in production.

```bash
# Point libpq at your cluster (adjust to taste)
export PGHOST=/tmp PGPORT=5432 PGUSER=postgres

node scripts/db-provision.mjs   # drop, create, migrate, seed
npm test                        # 443 tests
```

If PostgreSQL is not reachable, `npm test` prints a warning and **skips** the database tests
rather than failing. The pure-domain tests still run, so the suite stays useful on a laptop with
no database. CI has one, so the policies are still enforced there.

### Starting a cluster from scratch
```bash
initdb -D ~/pgdata
pg_ctl -D ~/pgdata -l /tmp/pg.log -o "-p 5432 -k /tmp" start
```

### The Supabase shim
`supabase/tests/00_local_shim.sql` recreates the small part of Supabase that a plain PostgreSQL
lacks: the `auth.users` table, `auth.uid()`, and the `anon` / `authenticated` / `service_role`
roles. It is applied **only** by `db-provision.mjs` and is never applied to the real project.

---

## 5. Everyday commands

```bash
npm start                       # Expo dev server
npm run android                 # dev server, open on a connected Android device
npm run ios                     # dev server, open on a connected iOS device
npm test                        # everything
npm run test:watch              # re-run on change
npm run typecheck               # app and tests
npx expo export --platform android    # prove the bundle builds
node scripts/db-provision.mjs         # rebuild the test database
```

Before pushing, the three that matter: `npm test`, `npm run typecheck`, and one `expo export`.

---

## 6. Where things live

```
app/                    Expo Router screens. The file path IS the route.
src/domain/             Pure business logic. No React, no Supabase. Fully unit-tested.
src/data/               Repositories — the only place that talks to Supabase.
src/lib/auth/           AuthProvider interface (the Entra ID swap point)
src/lib/offline/        SQLite cache and the outbox queue
src/lib/i18n/mn.ts      Every user-visible string, in Mongolian
supabase/migrations/    Numbered, forward-only SQL
supabase/seed/          Fictional test data
tests/domain/           Pure logic tests — fast, no database
tests/db/               Policy tests as real database roles
docs/                   Design documents and manuals
```

### Two rules that explain most of the structure

**Business rules belong in `src/domain/` or in SQL, never in a screen.** If a rule can decide
whether someone's visit counts, it needs a test, and a rule embedded in a component is a rule
nobody tests.

**The server is the security boundary; the client is a convenience.** A screen may grey out a
button. The database must refuse the action independently. Every policy has a test that acts as
the role in question and asserts the refusal.

---

## 7. Adding a migration

1. Create `supabase/migrations/00NN_short_name.sql`. Numbered, forward-only — never edit a
   migration that has been applied to a real project.
2. If it creates a table: enable RLS and write at least one policy. A structural test fails the
   build otherwise.
3. If it creates a function:
   * `SECURITY DEFINER` needs `SET search_path = ''`, and then every reference must be
     schema-qualified. See §8.
   * **Revoke `EXECUTE` from `PUBLIC`**, then grant deliberately. PostgreSQL grants EXECUTE to
     PUBLIC by default and `ALTER DEFAULT PRIVILEGES` does not reliably stop it. `npm test` will
     fail by name if you forget — that is the guard.
4. `node scripts/db-provision.mjs && npm test`.

---

## 8. Two traps this project has already fallen into

**`SET search_path = ''` breaks unqualified operators.** With an empty search path, PostgreSQL
cannot resolve the `citext` `=` operator (it lives in `public`), silently falls back to a
case-sensitive text comparison, and `Rep01@MONOS.MN` stops matching `rep01@monos.mn`. Schema-
qualify everything: `public.similarity(...)`, `value::public.citext`, or compare
`lower(x::text)`. Regression-tested in `tests/db/emailDomain.test.ts`.

**Revoking from `anon` does not remove a privilege held through `PUBLIC`.** This shipped for six
phases and let an unauthenticated caller forge audit entries. See migration `0025` and
`tests/db/security.test.ts`.

---

## 9. Testing something that needs a signed-in user

```ts
import { actingAs, USERS } from './helpers';

await actingAs(USERS.rep1, async (s) => {
  const rows = await s.query('SELECT * FROM public.visit');
  const error = await s.expectDenied('DELETE FROM public.visit WHERE id = $1', [id]);
  await s.expectInvisible('SELECT * FROM public.audit_log');
});
```

`expectDenied` asserts an error and returns it. `expectInvisible` asserts zero rows — because RLS
hides rows rather than raising, "denied" for a read means "invisible", not "error". Everything
runs inside a transaction that is always rolled back.

Occasionally a test needs to build a scenario the application role cannot create — an
`in_progress` visit, for instance, since nothing may `INSERT` into `visit` directly. Step out and
back in *within the same transaction*:

```ts
await s.query('RESET ROLE');
await s.query('INSERT INTO public.visit ...');
await s.query('SET LOCAL ROLE authenticated');
```

---

## 10. Working on the offline layer

`src/domain/outbox.ts` and `src/domain/cachePolicy.ts` are pure and carry the real rules — order,
retry, collapse, freshness. `src/lib/offline/` is the thin SQLite and network layer around them.

Put logic in the domain files, where it is testable without a device. If you find yourself
wanting to test something in `src/lib/offline/`, that is usually a sign the decision belongs one
layer down.

To test offline behaviour on a real phone: enable flight mode, use the app, then turn it off
again and watch the sync screen. Metro's dev server disconnecting is not the same thing and will
mislead you.
