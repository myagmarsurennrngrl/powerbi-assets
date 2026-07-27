# Phase 1 — Status Report

**Phase 1 scope:** Authentication, roles, clinics, doctors, brands, users.
**Date:** 2026-07-27
**Tests:** 95 passed / 95 · **Typecheck:** clean · **Bundles:** iOS ✅ Android ✅

---

## 1. What works right now

### Security and access (all enforced in the database, not the app)
| Capability | Status | Proof |
|---|---|---|
| Login by 6-digit code sent to a work email | ✅ | `app/login.tsx` |
| Only approved company domains may sign in | ✅ | 10 tests in `tests/db/emailDomain.test.ts` |
| Non-approved address is refused at the database | ✅ | `INSERT INTO auth.users` raises |
| Case-insensitive email handling | ✅ | regression test (a real bug found and fixed — see §4) |
| Login is linked to the administrator-provisioned account automatically | ✅ | tested |
| Authenticated but not provisioned → clear Mongolian message, zero data | ✅ | tested |
| Deactivating a user removes all access immediately | ✅ | tested |
| Representative cannot edit clinics, doctors, brands, settings | ✅ | 33 tests in `tests/db/rls.test.ts` |
| Representative cannot promote themselves | ✅ | tested |
| Representative cannot change another representative's record | ✅ | tested (acceptance criterion 11) |
| Manager can read the audit log but cannot alter it | ✅ | tested |
| Nobody, including administrators, can delete an audit entry | ✅ | tested |
| Nobody can hard-delete master data (soft delete only) | ✅ | tested |
| Anonymous callers get nothing | ✅ | tested |
| Every table has RLS enabled **and** a policy | ✅ | structural test fails the build otherwise |
| Audio recording flag is off and cannot be switched on by a rep | ✅ | tested |

### Data quality
Duplicate clinic detection · duplicate doctor detection · fuzzy near-duplicate warning ·
coordinate range validation · null-island (0,0) rejection · Mongolia bounding-box warning ·
geofence radius sanity limits (30–2000 m) · email format validation · orphan prevention ·
soft delete · created/modified by and at · brands assignable only to representatives.

### Screens (working, in Mongolian)
| # | Screen | State |
|---|---|---|
| 1 | Нэвтрэх (Login) | ✅ full two-step OTP, resend cooldown, all error messages |
| 2 | Нүүр (Home) | ⚠️ partial — identity, role, assigned brands are real; plan/KPI tiles are labelled **Хараахан хэрэгжээгүй** |
| 11 | Эмнэлгүүд (Clinics) | ✅ search, district filter, pull-to-refresh |
| 12 | Эмнэлгийн дэлгэрэнгүй | ✅ full detail, geofence radius, doctors here, **working** Open-in-map |
| 13 | Эмч нар (Doctors) | ✅ search, speciality filter |
| 14 | Эмчийн профайл | ⚠️ partial — profile and clinics real; visit history labelled not implemented |
| 15 | Брэнд ба бүтээгдэхүүн | ✅ own brands highlighted, expandable product lists |
| 21 | Тохиргоо (Settings) | ✅ profile, privacy disclosure, audio-off status, sign out |

**No screen contains a button that silently does nothing.** Anything not built shows
«Хараахан хэрэгжээгүй» with the phase it is coming in.

### Test data loaded
7 representatives · 3 managers · 1 administrator · 15 clinics (real Ulaanbaatar coordinates,
varied geofence radii) · 50 doctors · 85 doctor-clinic links · 10 brands · 50 products ·
24 brand assignments with deliberate overlap between representatives.
**All people, clinics and brands are fictional.**

---

## 2. How you can test it yourself

Full instructions: `docs/90-setup-for-non-technical.md`. The five checks that matter:

| # | Do this | Expected |
|---|---|---|
| 1 | Log in with a work email that exists in `app_user` | Code arrives, you get in, your name and role are correct |
| 2 | Log in with a personal Gmail address | Refused with a Mongolian message. **No code is sent.** |
| 3 | Log in with a work email that has **no** `app_user` row | «Таны бүртгэл идэвхжээгүй байна. Системийн администраторт хандана уу.» |
| 4 | As a representative, open a clinic | You can read everything; there is no edit control anywhere |
| 5 | Open Тохиргоо | Location policy stated plainly; Дуу хураах shows **Идэвхгүй — хэрэгжээгүй** |

Developers can run the whole suite with `npm test` (needs PostgreSQL; skips database
tests with a warning if none is running) and `npm run typecheck`.

---

## 3. What is NOT in Phase 1

Deliberately deferred, per the agreed phase plan:

| Item | Phase |
|---|---|
| Weekly plan builder, today's route, weekly calendar | 2 |
| Geofence check-in, active visit, check-out | 3 |
| Visit completion form, doctor visit history, addenda | 4 |
| Exceptions, approvals, KPI | 5 |
| Manager dashboard, exports, audit log screen, Power BI views | 6 |
| Offline cache and sync queue | 7 |
| Manager and administrator tab bars, user management, master-data CRUD screens | 6 |
| Audio recording | **never in MVP — flag off, no code exists** |

Master data is currently created in the Supabase table editor (documented in the setup
guide). The in-app administrator screens arrive in Phase 6.

---

## 4. Bugs found and fixed while building this phase

**A real security bug, caught by the tests, not by review.**

Every database function is hardened with `SET search_path = ''`, which is correct practice.
But it has a consequence I had not accounted for: the `citext` case-insensitive `=` operator
lives in the `public` schema, so with an empty search path PostgreSQL cannot resolve it and
**silently falls back to case-sensitive text comparison**.

Effect: `Rep01@Monos.mn` would have been refused at login, and the account-linking trigger
would have failed to connect a person to their record — with no error message anywhere.

Fixed by comparing `lower(...)` on explicit text in both places, with the reasoning written
into the migration so it is not "simplified" back later. Two regression tests now cover it.

Two smaller issues: `similarity()` and `citext` needed schema qualification inside function
bodies for the same reason (caught when the migrations first ran), and one test asserted an
exception where RLS correctly returns "zero rows affected" instead — the test was wrong, the
policy was right, and it now asserts on the resulting data.

---

## 5. Known limitations at this point

1. **Supabase's built-in email is rate-limited** and for testing only. Company SMTP must be
   configured before rollout (`Authentication → Emails → SMTP Settings`).
2. **Representatives can read colleague rows** in `app_user`. PostgreSQL RLS is row-level,
   not column-level, and the doctor history screen needs "which representative visited".
   Contact details are company-internal. If this must be tightened, the fix is a view — noted
   in `docs/03-roles-permissions.md §2`.
3. **`FORCE ROW LEVEL SECURITY` is deliberately not used.** It would break the
   `SECURITY DEFINER` identity helpers by making them subject to the very policies they
   answer. The owner role never serves application traffic. Documented in migration 0003.
4. **No offline support yet** — the app needs a connection. Phase 7.
5. **Icons are emoji.** Avoids a font dependency and licence review for Phase 1; swapping in
   an icon set touches one file.
6. `npm install` requires `legacy-peer-deps` (committed in `.npmrc`) because `expo-router`
   pulls a web-only `react-dom` with a stricter React peer range than Expo SDK 57 pins.
   Expo's own installer does the same thing.

---

## 6. Waiting for your feedback

Per our working method, I will not start Phase 2 or replace anything that works until you
have tested the above.

**Questions where your answer changes what I build next:**

1. **Is `monos.mn` the only login domain**, or are there others (a second company, contractors)?
2. **Plan submission deadline** — I have assumed *Friday 18:00 for the following week*, configurable.
   Is that right?
3. **The KPI question from `docs/07-risks.md §5.2`:** when a manager approves a
   `doctor_unavailable` or `gps_problem` exception, should it remove the visit from the KPI
   denominator? My default is **no** (the rep still travelled and still owns the outcome).
   This is configurable, but it changes how people behave, so it is a business decision.
4. **Retention periods** — I have proposed visits 5 years, audit log 3 years, attachments 1 year.
