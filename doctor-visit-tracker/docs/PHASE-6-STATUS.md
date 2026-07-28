# Phase 6 — Status Report

**Phase 6 scope:** Manager dashboard, audit log, exports, Power BI views, user management, master
data management.
**Date:** 2026-07-28
**Tests:** 352 passed / 352 (251 before + 101 new) · **Typecheck:** clean · **Bundles:** iOS ✅ Android ✅

---

## 1. What you can now do that you could not before

| Who | New capability |
|---|---|
| Manager | See the whole team's numbers on one screen, and a list of visits worth a second look |
| Manager | Read the audit log — who did what, when — filtered by action |
| Manager | Export visits as rows (the export itself is recorded in the audit log) |
| Administrator | Create, edit, deactivate and reactivate staff accounts |
| Administrator | Assign and end brand coverage |
| Administrator | **Edit clinic coordinates and geofence radius** |
| Administrator | Add and edit doctors, brands and products; archive what is no longer used |
| Representative | Record a visit that was never planned |
| Anyone with Power BI | Connect to a clean star schema through a read-only login |

---

## 2. Power BI — the part you asked for

A separate `reporting` schema with a proper star schema: 6 dimensions, 6 fact tables, 3 bridges
for the many-to-many relationships, and a ready-made weekly KPI view.

**`docs/70-powerbi-guide.md`** is the connection guide: the exact steps, what each table means,
the relationships to build, DAX measures to start with, and a security checklist.

Three decisions worth knowing:

**The reporting login can read nothing else.** `reporting_reader` has access to the `reporting`
schema and nothing more — not the application tables, not the login system, and no ability to write
anywhere. A test called `fn_reporting_reader_leaks()` asserts this and must return zero rows.

**Doctors' phone numbers and emails are not in there.** A `.pbix` file gets emailed around. Contact
details have no reporting purpose, so they are simply absent.

**Use `vw_kpi_weekly_rep` rather than recomputing the KPI in DAX.** It calls the same function the
phone calls, so a Power BI report and a representative's screen cannot disagree. The rules are
subtle enough (see `docs/05`) that two implementations would eventually diverge and nobody would
know which to believe.

---

## 3. Manager dashboard

Team completion, missed visits, pending requests, clinics and doctors not visited in the period,
and a review list.

**The review list is framed as «Шалгах шаардлагатай» — "worth checking" — not as a verdict.** A visit
started 20 m outside the radius, or one lasting four minutes, has an innocent explanation most of the
time: a wrong coordinate in the master data, or a doctor who was genuinely between patients. The
screen shows the measurements and lets the manager judge. Presenting it as a list of offenders would
be the fastest way to make people stop recording honest data.

Export writes its `data_export` audit entry **before** it returns any rows. If the export fails
halfway, the fact that someone asked for it is still recorded.

---

## 4. Administration

### Users
Create, edit, change role, deactivate, reactivate, assign brands. Nobody is ever deleted — every
foreign key is `ON DELETE RESTRICT`, so deleting a user would orphan their visits.

Five refusals are enforced in the database, not in the app:

| Attempt | Refused because |
|---|---|
| Creating an account under an unapproved email domain | It could never sign in — it would look created and be permanently broken |
| Removing the last administrator's rights, or deactivating them | Nobody inside the app could ever restore administration |
| Deactivating yourself | Same reason, one step smaller |
| Deactivating someone with a visit still running | Only that person can check it out; the visit would stay open forever |
| Deactivating or demoting someone who still manages active staff | Their plans and requests would have no reviewer |

**The email address is read-only after creation.** It is the link to the login, so editing it would
silently detach the person from their account. The field is shown, disabled, with the reason.

### Master data
Clinics, doctors, brands and products. The clinic editor is the operationally important one:
coordinates and the allowed radius decide whether a representative standing in the right building
can check in at all. Get them wrong and the KPI records a missed visit that never happened.

- The summary counts how many clinics still carry the untouched default radius — that is almost
  always the cause of "I cannot check in".
- Coordinates outside Mongolia produce a **warning, not a block**: a swapped latitude and longitude
  looks exactly like that, but a bounding box is a heuristic and a real clinic must never be
  un-saveable because of one.
- Adding a doctor runs a fuzzy name check against existing records. Two clinics spelling the same
  person's name differently is how this table rots, and the visit history then splits across two
  records that look like two people.

**Archiving is a soft delete, guarded by a trigger.** A clinic with visits still planned cannot be
archived; nor can a doctor with planned visits or open follow-ups, nor a brand still assigned or
still holding products. The trigger says how many, so the administrator knows what to fix.

---

## 5. Unplanned visits

This was listed as an open item in Phase 5. It is now built.

A representative who is at a clinic anyway and gets ten minutes with a doctor can record it. Without
that, they either record nothing or invent a planned visit afterwards, and both are worse than the
truth.

**The geofence is not relaxed.** Same distance rule, same accuracy threshold, same server-computed
distance, same "one visit at a time". "Unplanned" changes what was scheduled, not where the person
is standing.

**A reason is required**, and it is stored as the visit's objective so it appears everywhere the
planned objective does. The manager reading the report later needs to know why it happened.

**It never touches the KPI denominator**, and the screen says so before you start. Otherwise the way
to a perfect score would be to plan two visits and walk into twenty. There is a test asserting the
completion percentage is unchanged by an unplanned visit.

If today's plan already includes that clinic, the screen warns and offers the route instead —
starting an unplanned visit there would leave the planned one looking missed.

---

## 6. Bugs and things found this phase

1. **The archive guard immediately caught an existing test.** A Phase 1 test soft-deleted a seeded
   clinic that has eleven planned visits. That is precisely what the new trigger exists to prevent,
   so the test was rewritten to archive a clinic of its own rather than the rule weakened.
2. **`fn_active_visit` showed a blank objective for unplanned visits.** It read the objective only
   from the planned visit. Fixed to prefer the visit's own value and fall back to the plan.
3. **`user_role` enum values.** The first draft of migration 0023 used `'admin'`; the enum value is
   `'administrator'`. Caught before the migration was applied.
4. **A helper function was revoked from the roles that need it.** The admin functions are
   `SECURITY INVOKER` by design, so they call the shared validator *as the signed-in user* — which
   means that user needs `EXECUTE` on it. Revoking it would have broken every user create and edit.
5. **`fn_is_email_domain_approved` is deliberately not executable by application roles**, so the
   friendly domain check now calls `fn_can_email_sign_in`, which is.
6. **The archive guards are `SECURITY DEFINER` on purpose.** As invoker they would count only the
   rows RLS shows the caller, and an archive could slip through simply because the person doing it
   could not see what it would break. A test asserts `prosecdef` is true.

---

## 7. Deviations from the design documents

**`docs/02` specified `security_invoker` views for the reporting schema.** They are owner-semantics
views instead. With invoker semantics, RLS would be applied *as `reporting_reader`* — a role with no
application identity — and every view would return zero rows. Recorded in migration 0021.

**`docs/03` says master data is edited by administrators only.** Still true. What changed is that
clinics, doctors, brands and products are written straight to the table (RLS restricts them,
CHECK constraints validate them, a trigger audits them) while *user accounts* go through functions,
because only the latter have cross-row consequences.

---

## 8. Screens

| # | Screen | State |
|---|---|---|
| 17 | Менежерийн самбар | ✅ team KPI, review list, uncovered clinics, recent visits, export |
| 19 | Хэрэглэгчийн удирдлага | ✅ list, create, edit, role, activate, brands |
| 20 | Мастер дата | ✅ clinics, doctors, brands, products; GPS & radius editor |
| 23 | Аудит лог | ✅ filterable, read-only, paged |
| 24 | Төлөвлөгөөнд байхгүй уулзалт | ✅ nearby clinics, reason, same geofence |

Administration is reached from **Нүүр → Түргэн холбоос**, not from a tab. There are seven
representatives and one administrator; a permanent tab for something used a few times a month would
crowd out the screens used every day.

---

## 9. How to test it

Rebuild the database first — migrations 0021–0024 are new:

```
node scripts/db-provision.mjs
```

### As a manager (`manager01@monos.mn`)

| # | Do this | Expected |
|---|---|---|
| 1 | Open **Самбар** | Team completion, missed, pending requests, uncovered clinics |
| 2 | Look at «Шалгах шаардлагатай» | Visits with distance, accuracy and duration — 18 in the seed |
| 3 | Tap the export button | A count of exported rows |
| 4 | Нүүр → **Аудит лог**, filter by «Дата экспортолсон» | Your export, just now, with your name |
| 5 | Try to find an edit button in the audit log | There is none — and the screen says why |

### As an administrator (`admin@monos.mn`)

| # | Do this | Expected |
|---|---|---|
| 6 | Нүүр → **Хэрэглэгчийн удирдлага** | 11 users, inactive ones listed separately |
| 7 | **+ Шинэ хэрэглэгч**, email `test@gmail.com` | Refused: the domain is not approved |
| 8 | Same with `test@monos.mn` | Created, marked «Нэвтрээгүй» until they first sign in |
| 9 | Open your own account and try to change your role | The buttons are disabled |
| 10 | Open `manager01`, tap **Идэвхгүй болгох** | Refused: they still manage other staff |
| 11 | Open `rep01`, remove a brand, add a different one | Both work; the old row is kept with an end date |
| 12 | **Мастер дата** → a clinic → change the radius to 400 | Saved |
| 13 | Set latitude to `106.9` and longitude to `47.9` | An orange warning about swapped coordinates — but you can still save |
| 14 | Set the radius to 10 | Refused: 30–2000 m |
| 15 | Try to archive a clinic that is still active | Told to deactivate it first |
| 16 | Deactivate it, then archive | Refused if it has planned visits, with the count |
| 17 | **Мастер дата → Эмч → + Шинэ эмч**, type a name close to an existing one | Similar doctors listed as you type |

### As a representative (`rep01@monos.mn`)

| # | Do this | Expected |
|---|---|---|
| 18 | **Өнөөдөр** → scroll to the bottom → **Төлөвлөгөөнд байхгүй уулзалт** | Nearby clinics sorted by distance |
| 19 | Read the blue note | States plainly that this does not count towards the KPI |
| 20 | Pick a clinic you are not near | Cannot start; the distance and the limit are shown |
| 21 | Pick the clinic you are at, leave the reason blank | The start button stays disabled |
| 22 | Write a reason and start | The active-visit timer, with your reason as the objective |
| 23 | Finish it and write the report | Same form as a planned visit |
| 24 | Open **KPI** | The completion percentage is unchanged; the unplanned visit is counted separately |

### Power BI
Follow `docs/70-powerbi-guide.md` §2 and §3. An administrator must set the `reporting_reader`
password once before anyone can connect.

Developers: `npm test` (352), `npm run typecheck`, `npx expo export --platform android`.

---

## 10. Not built — stated plainly

| Item | Why / when |
|---|---|
| **CSV / Excel import of master data** | Deferred. Import needs file picking, a preview with per-row validation, and a duplicate-resolution step to be safe; a half-built importer that writes rows it should have rejected is worse than typing them in. The duplicate-detection function it will use (`fn_find_similar_doctors`) is built and in use on the doctor form. |
| **CSV file download from the phone** | The export produces rows and audits them, but the app does not yet write a file and hand it to another app. Needs `expo-file-system` + `expo-sharing`. |
| **doctor_clinic editing** (which doctors work at which clinic) | Readable everywhere and used by the planning wizard; the editor is not built. Currently maintained by an administrator in Supabase. |
| **Editing an approved email domain from the app** | The table and its policies exist; there is no screen. One domain, changed approximately never. |
| **Offline queue, sync status screen (22)** | Phase 7 |
| **Backup, deployment and user manuals** | Phase 7 |

Nothing above appears in the app as a button that does nothing.

---

## 11. Ready for your feedback

The two things most worth your eyes:

1. **The clinic coordinates and radii in the seed data are invented.** Before any real use, someone
   needs to walk to each clinic and check that a representative standing at the door is inside the
   radius. The master-data screen tells you how many still carry the default 150 m.
2. **The Power BI model.** If the tables do not match how you want to slice the data, changing the
   `reporting` schema now is much cheaper than changing it after reports are built on it.

Phase 7 next: offline capability, the sync status screen, security hardening, and the deployment
and user documentation.
