# Phase 5 — Status Report

**Phase 5 scope:** Exception approval and KPI calculations.
**Date:** 2026-07-28
**Tests:** 251 passed / 251 (221 before + 30 new) · **Typecheck:** clean · **Bundles:** iOS ✅ Android ✅

---

## 1. The bug this phase found — read this one

The KPI was silently giving **everyone 100%**.

A planned visit that never became a real visit has no `visit` row, so the
"was it completed?" flag came out as SQL `NULL` rather than `false`. That NULL then
propagated through the eligibility logic and made the whole row NULL — so **every missed,
cancelled and un-actioned visit quietly dropped out of the denominator**, leaving only the
completed ones. Numerator and denominator both ended up counting the same thing.

It was caught because the worked example in `docs/05 §4` is encoded as a test: it expected
6 eligible visits and got 2. Without that test this would have shipped, and the first person to
notice would have been a manager wondering why nobody ever misses a visit.

Every flag is now explicitly `COALESCE`d to false, with the reasoning written into the migration.

---

## 2. Exceptions — the pressure valve

Every geofence produces false negatives: wrong coordinates in the master data, no GPS inside a
concrete hospital, a clinic that shut early. Without a way to say so, the system punishes people
for things outside their control and they stop trusting it.

| Capability | Status |
|---|---|
| Representative submits an exception with one of nine reasons | ✅ |
| **Location is optional and opt-in** | ✅ sick leave from home sends no coordinates |
| When attached, the measured distance from the clinic is recorded | ✅ usually the whole story for a "GPS problem" |
| One pending request per visit | ✅ |
| Manager approves or rejects; a rejection needs a reason | ✅ |
| **Nobody approves their own — enforced three ways** | ✅ CHECK constraint, function guard, and RLS |
| A decided request cannot be re-decided | ✅ |
| Rejected ⇒ becomes an unapproved cancellation and counts against the KPI | ✅ |
| A client cannot write or self-approve a row directly | ✅ no INSERT/UPDATE grant at all |

### The detail that makes approval fair
The queue shows the **KPI consequence before the decision**: approving sick leave removes the
visit from the denominator; approving "doctor unavailable" does not. A manager who only discovers
that afterwards cannot make a fair call.

**This closes the gap flagged in Phase 3** — the representative standing in the clinic who cannot
check in now has a real button, on both the route card and the start-visit screen.

---

## 3. KPI

Implements `docs/05` exactly, with the worked example as a test.

| Metric | Status |
|---|---|
| Completion % (completed ÷ eligible) | ✅ |
| Planned, completed, missed, approved/unapproved cancellations | ✅ |
| **Unplanned visits — separate, never mixed in** | ✅ tested |
| Average duration, on-time %, doctor & clinic coverage, follow-up completion | ✅ |
| Brand activity as a bar list | ✅ |
| Team KPI, **weighted by volume** not an average of percentages | ✅ |
| Rule versioning — history never recomputed | ✅ |
| Snapshots immutable once published | ✅ |

### Three decisions worth knowing

**Zero eligible visits shows «Хамаарахгүй», never 0%.** A representative on approved leave for a
whole week has not failed. Showing them 0% would be a false accusation by arithmetic.

**Team completion is `SUM(completed) ÷ SUM(eligible)`,** not the mean of the per-rep percentages.
Otherwise a rep with 2 planned visits moves the team number as much as one with 20.

**Rule changes cannot be backdated.** A new version starts from a future date and the current one
is closed, never edited — so a number somebody has already been shown can never change underneath
them.

### The KPI screen is built to be understood
The formula is printed on the screen. The raw counts sit next to the percentage, so 100% from 2
visits never looks like 100% from 20. An unfinished period is marked «Урьдчилсан».

---

## 4. Screens

| # | Screen | State |
|---|---|---|
| 10 | Чөлөөлөх хүсэлт | ✅ nine reasons, optional location, honest warnings |
| 16 | Миний KPI | ✅ four periods, all metrics, formula shown |
| 18 | Хүсэлт батлах | ✅ queue with evidence and KPI impact before deciding |

Tab bars stay at five. A representative now has: Нүүр · Өнөөдөр · Хуваарь · KPI · Тохиргоо.
A manager has: Нүүр · Хүсэлт · Эмч · Тохиргоо. Doctors left the representative's bar (it is a
reference screen reachable from Home and from any visit); it stays for managers.

---

## 5. How to test it

Rebuild the database (migrations 0018–0020 are new).

| # | Do this | Expected |
|---|---|---|
| 1 | As a rep, on Өнөөдөр tap **Чөлөөлөх** | The request form, with nine reasons |
| 2 | Pick **GPS-ийн асуудал**, tap **Одоогийн байршлыг хавсаргах** | Distance from the clinic is attached |
| 3 | Pick **Өвчтэй**, submit without location | Accepted — no coordinates required |
| 4 | Submit | The visit becomes «Цуцлах хүсэлт илгээсэн» |
| 5 | Log in as `manager01@monos.mn` → **Хүсэлт** | The request, with distance, accuracy, and the KPI impact |
| 6 | Approve a sick-leave request | Green "will be excluded from KPI" beforehand |
| 7 | Look at a doctor-unavailable request | Red "will still count" beforehand |
| 8 | Reject without a comment | Refused |
| 9 | As the rep, open **KPI** | Completion %, with counts and the formula |
| 10 | Compare a week with no visits | «Хамаарахгүй», not 0% |

Developers: `npm test` (251), `npm run typecheck`, `node scripts/db-provision.mjs`.

---

## 6. Other bugs found this phase

1. A trigger set an `updated_by` column that `visit_exception` does not have — every approval
   failed. Fixed with a timestamp-only trigger, since `approved_by` already records who decided.
2. The privacy guard test correctly caught Phase 5 adding location columns to `visit_exception`.
   That is intended and specified, so the allowlist now names all three permitted tables with the
   reason for each — and a new test asserts the exception coordinates stay **nullable**.
3. `docs/02` specified `excludes_from_kpi` as a generated column. A generated column cannot read
   the rule config in another table, so it would have frozen one answer while the KPI used another.
   It is a function of (status, reason, rule version) instead. Deviation recorded in migration 0019.
4. My own test setup put a "rescheduled to later" replacement inside the same week it was measuring,
   double-counting it.

---

## 7. Not in Phase 5

| Item | Phase |
|---|---|
| Manager dashboard, audit log screen, CSV export, Power BI views | 6 |
| User management and master-data screens | 6 |
| Starting an **unplanned** visit from the app (schema, KPI and tests support them; no button yet) | 6 |
| Offline queue and sync status | 7 |
| Backup, deployment and manual documents | 7 |

---

## 8. Ready for your feedback

The KPI numbers are now real — worth checking them against what you would expect for a week you
know about. If the completion percentages look wrong for a representative, that is exactly the
feedback that matters most at this point.

Phase 6 next: manager dashboard, audit log, exports and the Power BI views.
