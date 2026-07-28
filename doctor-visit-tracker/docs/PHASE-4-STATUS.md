# Phase 4 — Status Report

**Phase 4 scope:** Visit documentation and doctor history.
**Date:** 2026-07-28
**Tests:** 221 passed / 221 (191 before + 30 new) · **Typecheck:** clean · **Bundles:** iOS ✅ Android ✅

---

## 1. One decision you should overrule if you disagree

**The brief says "Doctor met" and "Doctor feedback" are always required. I made them conditional.**

Taken literally, a representative who arrives to find the clinic **closed** could never submit their
report — there is no doctor to name and no feedback to record. They would have to either abandon the
record or invent something. An invented record is worse than no record, and it poisons the KPI.

So the required set now depends on what actually happened:

| Уулзалтын төлөв | Doctor | Brands | Feedback | Interest |
|---|---|---|---|---|
| Эмчтэй уулзсан | ✅ required | ✅ | ✅ | ✅ |
| Зөвхөн ажилтантай уулзсан | — | ✅ | — | — |
| Эмнэлэг хаалттай / Эмч байгаагүй / Хойшилсон / Бусад | — | — | — | — |

**Always required, whatever happened:** objective, outcome, next action, summary, and an explicit
yes/no on whether a follow-up is needed.

The form adapts too: irrelevant sections are not shown at all, rather than shown and then rejected.
If you want the literal rule instead, it is a small change in one function.

---

## 2. What works now

| Capability | Status |
|---|---|
| Structured completion form, adapting to the meeting outcome | ✅ |
| Autosave — every change saved as a draft immediately | ✅ |
| Server tells the form exactly which fields are missing, in Mongolian | ✅ |
| A draft may be half-filled; rules apply only at submission | ✅ |
| **Completed reports are frozen** — author, manager and even the DB owner are refused | ✅ |
| Corrections as separate, attributed addenda that never overwrite | ✅ |
| Follow-ups created automatically and closable | ✅ |
| **Shared doctor history across all representatives** | ✅ |
| All five filters (date, brand, rep, clinic, outcome) | ✅ |
| Drafts stay private — never visible in a colleague's history | ✅ |
| No patient-data column anywhere, asserted by test | ✅ |

**Acceptance criteria met this phase:** 8 (structured report), 9 (completed records immutable),
10 (colleague can read doctor history), 18 (no patient information).

### Screens
| # | Screen | Route | State |
|---|---|---|---|
| 9 | Уулзалт дуусгах | `/report/[visitId]` | ✅ full adaptive form |
| 14 | Эмчийн түүх | `/doctor/[id]` | ✅ the Phase 1 placeholder is gone — real shared history with filters and addenda |

---

## 3. How to test it

Rebuild the database (migrations 0016–0017 are new).

| # | Do this | Expected |
|---|---|---|
| 1 | Start and finish a visit, then tap **Уулзалт дуусгах** | The report form opens |
| 2 | Choose **Эмнэлэг хаалттай** | Doctor, feedback and interest sections disappear |
| 3 | Choose **Эмчтэй уулзсан** | They come back, and are required |
| 4 | Leave a field blank | It is listed by name at the bottom; submit stays disabled |
| 5 | Fill everything, submit | Confirmation warns it cannot be edited; then it is submitted |
| 6 | Reopen that report | Read-only |
| 7 | Log in as a **different** rep, open the same doctor | You can read the report your colleague wrote |
| 8 | Use the filters | Date, brand, representative, clinic, outcome all narrow the list |
| 9 | Log in as a **manager**, open a doctor | **Залруулга нэмэх** appears; add one |
| 10 | Look at the visit again | The original text is unchanged; the correction sits beneath it with the manager's name and time |

Developers: `npm test` (221), `npm run typecheck`, `node scripts/db-provision.mjs`.

---

## 4. Bugs found while building this phase

1. **A real design flaw in Phase 3, caught by a test.** The `visit` table required
   `follow_up_date` whenever `follow_up_required` was true — unconditionally. That is right for a
   finished report but wrong for a form: tapping «Тийм» before choosing a date was rejected outright,
   making the field impossible to fill in. The constraint now applies only at completion; the rule
   still holds absolutely there. **This would have shipped as a broken form.**
2. **Route ambiguity, caught in review.** The report screen initially lived at
   `/visit/[id]/complete`, where its sibling routes use `[id]` to mean a *planned visit* id but the
   report needs a *visit* id. One parameter name meaning two things is a bug waiting to happen, so
   the report moved to its own unambiguous `/report/[visitId]`.
3. **Test cross-contamination.** Two test files scaffolded visits at the same clinic on the same
   day, exhausting the `planned_order` cap and colliding on the duplicate-doctor rule. Both helpers
   now retire each other's scaffolding first. The production rules were correct throughout — the
   tests were the problem.
4. A date-ordering assertion compared JavaScript `Date` objects with a default sort, which orders
   them as `"Wed Jul 15 2026…"` strings rather than chronologically.

---

## 5. Not in Phase 4

| Item | Phase |
|---|---|
| Exception requests and approval | 5 |
| KPI calculation and screens | 5 |
| Manager dashboard, audit log screen, exports, Power BI views | 6 |
| Unplanned visits (schema supports them; no screen starts one) | 5 |
| Offline drafting | 7 |

Unchanged: Supabase's built-in email is rate-limited and needs company SMTP before rollout;
representatives can read colleague rows in `app_user`; icons are emoji.

---

## 6. Ready for your feedback

The conditional-requirements decision in §1 is the one worth your attention — it is a business
rule, not a technical one, and I changed what the brief literally said. Everything else is
mechanical.

Phase 5 next: exceptions and KPI. That includes the gap flagged in Phase 3 — the representative who
is genuinely at the clinic but cannot check in.
