# Phase 7 — Status Report

**Phase 7 scope:** Offline capability, full test suite, security hardening, deployment and user
documentation.
**Date:** 2026-07-28
**Tests:** 443 passed / 443 (352 before + 91 new) · **Typecheck:** clean · **Bundles:** iOS ✅ Android ✅

**This is the final phase. The application is complete.**

---

## 1. The security bug this phase found — read this one

**An unauthenticated caller could forge audit log entries.** Reproduced against the real database
before fixing it.

Migration 0008, written in Phase 1, said in a comment:

> *"fn_audit is SECURITY DEFINER and is called from triggers only. It is NOT granted to
> authenticated: a user must not be able to write arbitrary audit entries by hand."*

and enforced it with `REVOKE EXECUTE ON FUNCTION public.fn_audit(...) FROM anon, authenticated;`.

**That revoke did nothing.** PostgreSQL grants EXECUTE on every new function to the pseudo-role
`PUBLIC` by default, and revoking from `anon` does not remove a privilege held through `PUBLIC`.
Every function in the schema was callable by anyone holding the app's public key — which is
printed in the app bundle and is meant to be public.

Most functions survived this on their own merits: they are `SECURITY DEFINER` but check
`fn_is_admin()` or `fn_current_app_user_id()` internally, both of which fail for an anonymous
caller. That defence in depth is why the damage was limited to `fn_audit`. It is not why it was
acceptable.

**Fixed** in migration 0025 by sweeping EXECUTE from PUBLIC on every function this project
defines. Extension functions are excluded — revoking `citext_eq` from PUBLIC would break
case-insensitive comparison for everyone.

### A second finding while fixing the first

The obvious guard for future functions is:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

**It does not work.** PostgreSQL accepts it and a function created afterwards still comes out
with the built-in owner+PUBLIC access list. Verified, not assumed. Writing a line that looks like
protection and is not is exactly the mistake being corrected, so it is absent from the migration
and the migration says why.

What protects future functions instead is `fn_security_findings()` plus a test: add a function
without revoking it and the suite fails, by name, with the reason. A failing build is a stronger
guarantee than a default privilege that may or may not apply.

### And a third, from the fix itself

The sweep broke one legitimate caller. `fn_admin_set_user_active` is `SECURITY INVOKER` by design
so that RLS still applies underneath it — and it called `fn_audit` as the invoker, to attach the
administrator's *reason* to a deactivation. Caught immediately by `tests/db/admin.test.ts`.

Three ways to fix it; the one chosen and why:

* grant `fn_audit` to authenticated → reopens the hole just closed;
* make the admin function `SECURITY DEFINER` → loses the RLS layer, for one audit line;
* **a purpose-built definer function that writes one fixed action and checks the caller is an
  administrator.** Nothing about it is forgeable, because there is nothing to choose.

---

## 2. The standing self-check

```sql
SELECT * FROM public.fn_security_findings();
```

Zero rows is the only acceptable answer. It checks:

| | |
|---|---|
| Tables without RLS, or with RLS and no policy | |
| `SECURITY DEFINER` without a locked `search_path` | the Phase 1 citext bug |
| Any function executable by `PUBLIC` | the bug above |
| Any function executable by `anon` beyond the one allowed | |
| Any table privilege held by `anon` | |
| `DELETE` outside the five child-list tables | |
| `TRUNCATE` granted to anyone | it bypasses the append-only triggers |
| The reporting login holding anything outside its schema | |
| A role that can bypass RLS | |
| Column names that look like credentials or patient data | |
| The audio-recording flag being on | |

`tests/db/security.test.ts` asserts it returns nothing — **and asserts that it detects a real
problem when one is introduced**, because a check that can only ever return zero rows proves
nothing.

---

## 3. Offline

### What works without a connection

| | |
|---|---|
| Today's route | ✅ cached, and **labelled with its age** |
| Clinics, doctors, brands, products | ✅ cached |
| Writing a visit report | ✅ queued |
| Submitting a report | ✅ queued — and it says «queued», not «submitted» |
| Corrections (addenda) | ✅ queued |
| Exception requests | ✅ queued |
| **Check-in and check-out** | ❌ **deliberately not** — see below |

### Why check-in and check-out require a connection

Their entire value is that the **server** measured the distance from the submitted coordinates
and stamped the time with its own clock. A check-in queued on a phone and sent three hours later
has neither — the only timestamp would be the device's, which this project explicitly does not
trust, and the server would be recording a presence it cannot vouch for.

So the two screens say so, in Mongolian, with the reasoning. In practice: start the visit outside
where there is signal, then go in; the report can be written offline.

This is recorded as an accepted limitation in `docs/95-known-limitations.md` §1.1, with what it
would take to change it, so it is a decision management can revisit rather than a gap nobody
noticed.

### The rules, and where they live

The decisions are in `src/domain/outbox.ts` — pure functions, 43 tests, no React and no database:

**Order matters within a visit, not between visits.** A completion can never be sent before the
draft it completes. Two different visits are independent, so one being stuck must not hold the
other up.

**A blocked operation stops its own visit and nothing else.** Sending the completion after a
rejected draft would submit a half-written report to a manager as finished.

**Business refusals are permanent; network failures are not.** "You are 240 m from the clinic"
will say the same thing on the hundredth attempt. Retrying it forever hides a real problem behind
a spinner. Anything unrecognised is treated as retryable — wrongly retrying costs a request,
wrongly giving up costs an afternoon of work.

**Repeated edits collapse.** Typing a report generates a save every few seconds; only the last
matters. Collapsing is allowed **only** for whole-value writes — never for a completion, an
addendum or an exception request, because completing twice is not completing once and an addendum
is an append.

**A replayed operation the server already has counts as success.** Otherwise a submitted visit
would sit in the queue forever.

### Screen 22 — Синк төлөв

Separates *waiting for a connection* from *the server refused this*. Those need different actions
from the person, so they must not look the same. Blocked items show the server's own message and
offer retry or discard.

An orange bar appears at the top of the app whenever there is no connection or work is waiting,
and it is tappable. **An invisible queue and a lost afternoon look identical** — that is the
failure this screen exists to prevent.

Signing out purges everything local, so it warns first when the queue is not empty.

### Caching, honestly

`src/domain/cachePolicy.ts` sets a freshness window per dataset. Cached data is always shown with
its age; a screen displaying yesterday's route without saying so sends someone to the wrong
clinic.

There is **no cache key** for visit eligibility, the audit log, exports or the team dashboard —
those must be current or must not be seen. `freshnessOf()` throws on an unknown key rather than
silently working, and a test asserts it. The absence is the enforcement.

---

## 4. Documentation

| Document | For |
|---|---|
| [`80-local-development.md`](80-local-development.md) | A developer setting up |
| [`81-device-testing.md`](81-device-testing.md) | iOS and Android, with a 30-step script |
| [`82-production-deployment.md`](82-production-deployment.md) | Going live, in order |
| [`91-manual-representative.md`](91-manual-representative.md) | **Mongolian.** The seven representatives |
| [`92-manual-administrator.md`](92-manual-administrator.md) | **Mongolian.** The administrator |
| [`96-manual-manager.md`](96-manual-manager.md) | **Mongolian.** The three managers |
| [`93-security-checklist.md`](93-security-checklist.md) | Before go-live, and monthly |
| [`97-privacy-checklist.md`](97-privacy-checklist.md) | The four promises and how each is enforced |
| [`94-backup-and-recovery.md`](94-backup-and-recovery.md) | Written to be usable under pressure |
| [`95-known-limitations.md`](95-known-limitations.md) | Everything it does not do |

Two things worth knowing about these:

**The three manuals are in Mongolian**, because the people who need them read Mongolian. The
technical documents are in English.

**§7 of the privacy checklist is a script for answering a representative who asks "can you see
where I am right now?"** Those questions will be asked, and a hesitant answer does more damage
than the honest one.

---

## 5. How to test Phase 7

### Offline, on a real phone — flight mode, not a stopped dev server

| # | Do this | Expected |
|---|---|---|
| 1 | Turn on flight mode | An orange bar appears at the top |
| 2 | Open **Өнөөдөр** | The route still shows, with "updated N minutes ago" |
| 3 | Open a visit report and type | Saves, saying it is stored on the phone |
| 4 | Submit it | Told it is **queued**, not submitted |
| 5 | Write an exception request | Same |
| 6 | Tap the orange bar | The sync screen, listing what is waiting |
| 7 | Try to start a visit | Refused, with the reason — the server measures check-ins |
| 8 | Turn flight mode off, wait ~10 seconds | The queue empties by itself; the bar disappears |
| 9 | Check the doctor's history | The report is there |
| 10 | Queue something, then try to sign out | Warned that signing out will lose it |

### Security, in the Supabase SQL editor

| # | Run | Expected |
|---|---|---|
| 11 | `SELECT * FROM public.fn_security_findings();` | Zero rows |
| 12 | `SELECT * FROM public.fn_reporting_reader_leaks();` | Zero rows |

### Developers
`npm test` (443), `npm run typecheck`, `npx expo export --platform android`.

---

## 6. What is deliberately not built

Full list with reasoning in [`95-known-limitations.md`](95-known-limitations.md). The four most
likely to matter:

1. **Editing which doctors work at which clinic.** No screen; maintained in Supabase. A doctor
   not linked to a clinic cannot be selected when planning a visit there — **the most likely of
   these to bite you**.
2. **CSV import of master data.** A half-built importer that writes rows it should have rejected
   is worse than typing them in. The duplicate-detection function it will use is built and
   already in use on the doctor form.
3. **Automatic retention deletion.** The periods are decided and documented; nothing deletes
   anything yet. Flagged with an owner line to fill in, because the usual failure is discovering
   it in year five.
4. **Downloading an export as a file.** The export produces rows and audits them; handing a file
   to another app needs two more Expo packages.

Nothing above appears in the app as a button that does nothing.

---

## 7. Where the project stands

**Seven phases, complete.** 443 automated tests, run against a real PostgreSQL as the actual
`authenticated` and `anon` roles inside rolled-back transactions.

Bugs found by those tests before shipping, one per phase:

| Phase | |
|---|---|
| 1 | `citext` comparison silently case-sensitive under `SET search_path = ''` — `Rep01@MONOS.MN` would have been refused at login |
| 2 | An enum cast that made approving a plan fail outright |
| 3 | A CHECK constraint that made the follow-up field impossible to fill in |
| 4 | (found in 4, from 3) the same constraint, relaxed to apply only at completion |
| 5 | **NULL propagation gave every representative 100%** — caught only because the worked example in `docs/05 §4` is a test |
| 6 | An archive guard that immediately caught an existing test soft-deleting a clinic with eleven planned visits |
| 7 | **`REVOKE ... FROM anon` does not remove a `PUBLIC` grant** — an unauthenticated caller could forge audit entries |

---

## 8. Before real use

Three things, in order:

1. **Walk to every clinic and verify its coordinates.** The single most likely cause of the
   system appearing broken. A wrong coordinate refuses a representative standing at the door and
   records a missed visit that never happened. **Мастер дата** shows how many are still on the
   default radius. `82-production-deployment.md` §4.

2. **Work through `93-security-checklist.md` §12** on the production project, and get zero rows
   from `fn_security_findings()`.

3. **Rehearse a restore once** — `94-backup-and-recovery.md` §5. An untested backup is a belief.

Then hand the three Mongolian manuals to the people who need them.
