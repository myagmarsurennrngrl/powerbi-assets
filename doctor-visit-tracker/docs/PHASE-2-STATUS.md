# Phase 2 — Status Report

**Phase 2 scope:** Weekly planning and today's route.
**Date:** 2026-07-27
**Tests:** 127 passed / 127 (95 from Phase 1 + 32 new) · **Typecheck:** clean · **Bundles:** iOS ✅ Android ✅

Your four answers are now the implemented defaults:
`monos.mn` is the only login domain · deadline is **Friday 18:00** of the preceding week ·
approved `doctor_unavailable` / `gps_problem` still count against the KPI ·
retention 5 years / 3 years / 1 year.

---

## 1. What works now

### Planning
| Capability | Status |
|---|---|
| One weekly plan per representative per ISO week | ✅ |
| Create a plan for a week (idempotent — double tap is harmless) | ✅ |
| Add a visit: day → clinic → doctors → brands → objective → time | ✅ |
| Doctor list filtered to doctors who actually work at that clinic | ✅ |
| Brand list filtered to the representative's **own** assignments | ✅ |
| Visit order within a day | ✅ |
| Remove a visit from a draft plan | ✅ (cancelled, never deleted — the trail survives) |
| Submit a plan for review | ✅ |
| Manager approve / reject with a mandatory reason | ✅ (server function; the manager *screen* is Phase 6) |
| Rejection comment shown to the representative | ✅ |
| Planning deadline: Friday 18:00 of the preceding week, configurable | ✅ |
| A rejected plan stays editable past the deadline | ✅ deliberate — see §3 |
| Plan status machine (7 states, illegal transitions refused) | ✅ |
| Every planned-visit status change recorded, append-only | ✅ |

### The duplicate rule you specifically asked for
| Case | Behaviour |
|---|---|
| Same rep, same doctor, same clinic, same day, twice | **Blocked**, with a Mongolian message naming the doctor and clinic |
| **Different** reps, same doctor, same clinic, same day | **Allowed** — they carry different brands |
| Same rep, same doctor, different day or different clinic | Allowed |

### Today's route (Өнөөдрийн маршрут)
Ordered cards with clinic, address, doctor names, planned brand chips, planned time, status pill,
working "open in map", and distance from the representative.

**Distance is opt-in.** Nothing is measured until the representative taps «Зайг харах». The app then
takes **one** position reading, computes distances locally, and stops. No watcher, no polling, no
background task. If they never tap, the app never learns where they are.

### Screens
| # | Screen | State |
|---|---|---|
| 2 | Нүүр | ✅ real today counts and this week's plan status |
| 3 | Өнөөдрийн маршрут | ✅ full |
| 4 | Долоо хоногийн хуваарь | ✅ week navigation, per-day counts, deadline, plan status |
| 5 | Төлөвлөгөө боловсруулах | ✅ step-by-step add-visit, submit |
| 6 | Уулзалтын дэлгэрэнгүй | ✅ full detail + status history |
| — | Өдрийн маршрут (any day) | ✅ new, reached from the calendar |

The tab bar is capped at **five** tabs — a sixth makes every label truncate on a 360 dp Android
screen. Clinics and brands moved to Home links; they are still fully reachable.

### Seed data
28 weekly plans (4 weeks × 7 reps), 466 planned visits, 606 doctor links, 652 brand links.
Positioned relative to today, so today's route is always populated. Every plan status appears
somewhere so you can see each one in the UI.

---

## 2. How to test it

Rebuild the database (migrations 0009–0011 and seed 0002 are new), then log in as a representative.

| # | Do this | Expected |
|---|---|---|
| 1 | Open **Өнөөдөр** | Today's visits, numbered in order, with clinic, doctors and brand chips |
| 2 | Tap **Зайг харах** | Phone asks for location once; distances appear; anything within the clinic radius is green |
| 3 | Tap **Газрын зураг** | The phone's own map app opens at the clinic |
| 4 | Open **Хуваарь**, move to next week | Per-day visit counts, plan status, and the submission deadline |
| 5 | Tap **Төлөвлөгөө засах** → **Уулзалт нэмэх** | Only doctors at the chosen clinic; only **your** brands |
| 6 | Add the **same doctor at the same clinic on the same day twice** | Blocked, in Mongolian, naming the doctor and clinic |
| 7 | Submit the plan | Status becomes «Илгээсэн» and it stops being editable |
| 8 | Log in as `rep03@monos.mn` | Next week's plan is «Татгалзсан» with the manager's reason visible |

Developers: `npm test` (127), `npm run typecheck`, `node scripts/db-provision.mjs`.

---

## 3. Decisions I made, and why

**A rejected plan is editable even after the deadline.** The manager sent it back and expects a
correction; enforcing the deadline there would leave the representative unable to comply. A first
submission is still blocked by the deadline.

**Removing a visit cancels it rather than deleting it.** A planned visit can never be deleted by
anyone — its status trail is permanent and the foreign key is `RESTRICT`. "Remove from plan" sets
`cancelled_unapproved`, which is exactly what the KPI rules already expect for a visit the
representative dropped without approval.

**`planned_visit.rep_id` is derived server-side from the plan owner**, overwriting whatever the app
sends. Tested: a representative cannot label a visit as belonging to someone else.

**`DELETE` is now granted on two tables** — `planned_visit_doctor` and `planned_visit_brand`. Removing
a doctor from a draft you are still writing is editing, not destroying a record. The structural test
now carries an explicit allowlist, so any *new* delete grant fails the build and has to be argued for.

---

## 4. Bugs found while building this phase

1. **Enum cast in `fn_review_plan`** — `CASE WHEN approve THEN 'approved' ELSE 'rejected' END`
   resolves to `text`, which will not assign to an enum column. Approving a plan failed outright.
   Caught by the test, fixed with an explicit cast.
2. Three test-setup errors of my own where the tests tried to walk plans *backwards* through the
   status machine. The machine was right and refused; the tests now build their own fixtures.
3. Phase 1's "DELETE is granted to nobody" structural test correctly caught Phase 2's new grants —
   working exactly as intended.

---

## 5. Not in Phase 2

| Item | Phase |
|---|---|
| Start visit, geofence check-in, active visit, check-out | 3 |
| Visit completion form, doctor visit history | 4 |
| Exception requests and approval screens | 5 |
| Manager dashboard, plan approval **screen** (the function works and is tested) | 6 |
| Drag-to-reorder visits (order is set automatically on add; a manual reorder UI is Phase 6) | 6 |
| Offline planning | 7 |

Also unchanged from Phase 1: Supabase's built-in email is rate-limited and needs company SMTP before
rollout; representatives can read colleague rows in `app_user`; icons are emoji.

---

## 6. Ready for your feedback

Nothing that works will be replaced until you have tested it. Phase 3 (location validation, check-in,
active visit, check-out) is next, and it is the one that decides whether the whole system is
trustworthy — so it is worth confirming the planning flow feels right first.

One question, answerable later: **should a manager be able to add a visit to a representative's plan
directly**, or only approve/reject and reschedule? The permissions matrix currently says
approve/reject/reschedule only, and that is what is built.
