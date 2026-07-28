# Phase 3 — Status Report

**Phase 3 scope:** Location validation, check-in, active visit, check-out.
**Date:** 2026-07-28
**Tests:** 191 passed / 191 (144 before + 47 new) · **Typecheck:** clean · **Bundles:** iOS ✅ Android ✅

This is the phase that decides whether the whole system is trustworthy, so this
report is mostly about *what cannot be faked* rather than what was built.

---

## 1. The eight conditions for starting a visit

All eight are evaluated **on the server**, from scratch, at the moment the check-in is attempted.

| # | Condition | Enforced |
|---|---|---|
| 1 | The signed-in user owns the planned visit | ✅ |
| 2 | It is scheduled for today (Ulaanbaatar) | ✅ |
| 3 | Its status is Planned | ✅ |
| 4 | No other visit is in progress for this user | ✅ + a unique index, so two concurrent taps cannot both win |
| 5 | Location permission enabled | ✅ (arrives at the server as missing coordinates) |
| 6 | A valid GPS location is available | ✅ incl. rejecting the 0,0 "no fix" placeholder |
| 7 | Accuracy within the configured threshold (50 m) | ✅ — an **unknown** accuracy counts as unacceptable |
| 8 | Inside the clinic's own radius (default 150 m, per-clinic) | ✅ Haversine, **computed by the server** |

### What a representative actually sees
Not a grey button. A tick or a cross against each of the seven visible conditions, plus the
numbers: *"Та эмнэлгээс 240 м зайд байна. Зөвшөөрөгдөх зай 150 м."* A dead button with no
explanation is what makes people distrust an app; a number is something they can act on.

---

## 2. What cannot be faked

| Attack | Why it fails |
|---|---|
| App sends a made-up distance | `fn_start_visit` has **no distance parameter**. The server recomputes it from the submitted coordinates. |
| Phone clock set back to fake an earlier start | `started_at_server` is the server's `now()`. The device clock is stored separately and the drift is recorded. |
| Client writes a `visit` row directly | The app has **no INSERT grant** on `visit` at all. Tested. |
| Client writes a `visit_event` directly | No INSERT grant, no policy. Tested. |
| Editing a check-in after the fact | Trigger blocks changes to `started_at_server`, rep, clinic, planned visit and date — in any status. |
| Editing a completed visit | Trigger: *"completed visits are immutable"*. Acceptance criterion 9. Tested. |
| Deleting a visit or an event | Blocked by trigger **and** by revoked grants, for everyone. |
| Double-tap or network retry creating two visits | Idempotent on a client-generated UUID. Tested. |
| Mock-location app | **Not prevented — made visible.** Android reports it, we store the flag, and the visit appears in the manager review list. Claiming otherwise would be dishonest. |

That last row matters. Nothing in a phone app can stop a determined person with a rooted device
and a mock-location tool. What this design does is make every anomaly *visible and permanent*:
distance, accuracy, clock drift, mocked flag, offline flag. See `docs/07-risks.md` G1.

---

## 3. Deliberate decisions

**Check-out is not geofenced.** A representative is often already walking to the car. Refusing the
check-out would leave the visit open for ever and the duration meaningless. The distance is
recorded either way, and an implausible check-out is flagged for a manager.

**Check-out does not complete the visit.** It records the event and fixes the duration; the visit
stays `in_progress` with «Тайлан бөглөгдөөгүй» until the Phase 4 form is filled in. This means the
duration reflects when the representative actually *left*, not when they got round to typing notes.

**An unknown GPS accuracy is treated as too poor.** An unknown error radius is not evidence of
being anywhere in particular.

**The clinic radius is snapshotted onto every event.** If an administrator widens a clinic's radius
next month, a past check-in cannot retroactively become "valid" — or invalid.

**A single active visit, enforced by a unique index** rather than a check-then-insert, so there is
no race window between two rapid taps.

---

## 4. Screens

| # | Screen | State |
|---|---|---|
| 7 | Уулзалт эхлүүлэх (start confirmation) | ✅ live GPS, all conditions ticked/crossed, distance vs radius, accuracy vs threshold |
| 8 | Идэвхтэй уулзалт (active visit) | ✅ running timer from the **server** start time, finish button |
| 3 | Өнөөдрийн маршрут | ✅ the placeholder is gone — a real **Уулзалт эхлүүлэх** button now |

The timer recomputes from `started_at_server` on every tick, so backgrounding the app or changing
the phone's clock does not distort it.

---

## 5. How to test it

Rebuild the database (migrations 0013–0015 and seed 0003 are new).

| # | Do this | Expected |
|---|---|---|
| 1 | Open **Өнөөдөр**, tap **Уулзалт эхлүүлэх** on a planned visit | The confirmation screen checks your location |
| 2 | Stand away from the clinic | Red ⛔, the exact distance, and the clinic's limit. Button disabled. |
| 3 | Be inside the radius | Green ✅ and an enabled button |
| 4 | Tap **Баталгаажуулж эхлүүлэх** | Active visit screen with a running timer |
| 5 | Go back to Өнөөдөр and try to start a different visit | Blocked: «Танд үргэлжилж буй өөр уулзалт байна» |
| 6 | Tap **Уулзалт дуусгах** | Location read once, timer stops, «Тайлан бөглөгдөөгүй» appears |
| 7 | Kill the app mid-visit and reopen | The timer shows the true elapsed time, not zero |

To test the geofence without travelling: an administrator can temporarily change a clinic's
coordinates in Supabase, or lower its `geofence_radius_m` to 30 m.

Developers: `npm test` (191), `npm run typecheck`, `node scripts/db-provision.mjs`.

---

## 6. Seed data

204 completed visits with 408 real check-in/check-out events across the past two weeks, with
coordinates scattered realistically around each clinic. Deliberately included anomalies so the
manager review list is not empty on day one: **4** check-ins outside the radius, **1** mocked
location, **3** badly skewed device clocks, **2** suspiciously short visits, **28** missed visits.
Average visit duration ≈ 35 minutes.

---

## 7. Bugs found while building this phase

1. **The append-only trigger blocked its own seed script.** Correct behaviour, caught immediately.
   The seed now disables the delete triggers around its cleanup and re-enables them straight
   after — possible only for the table owner, never for `authenticated`.
2. **The Phase 3 seed was not re-runnable**: it flips `planned_visit.status` to `completed`, so a
   second run found nothing to do and silently produced zero visits. Now verified idempotent —
   two consecutive runs produce byte-identical counts.
3. **A test helper produced invalid data.** It created planned visits with no doctors once a
   clinic's doctors were used up, which broke a Phase 2 assertion in a different file. Fixed by
   retiring the previous scaffolding visit first.
4. Phase 1's DELETE allowlist correctly caught Phase 3's new grants on the visit child lists.

---

## 8. Not in Phase 3

| Item | Phase |
|---|---|
| The structured completion form (уулзсан эмч, үр дүн, дараагийн үйлдэл…) | 4 |
| Doctor visit history with its five filters | 4 |
| Addenda (corrections to a submitted visit) | 4 |
| Exception requests — including the "I am here but cannot check in" path | **5** |
| Manager review list for flagged check-ins | 6 |
| Unplanned visits (the column exists; no screen starts one) | 5 |
| Offline check-in queue (the idempotency it needs is already built) | 7 |

**The exception path is the notable gap.** A representative who is genuinely at the clinic but
cannot check in — wrong coordinates in master data, no GPS indoors — currently sees the reason and
a note saying the request workflow arrives in Phase 5. Everything needed for it is in place
(reason codes, the eligibility detail, location capture); it is the approval workflow that is not.
If that gap is a problem for a pilot, say so and I will pull Phase 5's exception request forward
ahead of Phase 4.

---

## 9. Ready for your feedback

Worth testing on a real phone at a real clinic before Phase 4 — this is the phase where the
difference between "works in a test" and "works in a concrete hospital basement" actually shows up.
The accuracy threshold (50 m) and the default radius (150 m) are both configurable and may well
need tuning once you see real readings.
