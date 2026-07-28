# 97 — Privacy Checklist

This application tracks where employees are and what they said to doctors. That is a legitimate
business need and also, handled carelessly, a surveillance system. This document is the line
between the two, and how each promise is actually kept.

The people whose privacy is at stake are **the seven representatives** and, secondarily, **the
doctors they visit**. No patient information exists anywhere in this system, by construction.

---

## 1. The four promises

Each one is enforced in code, not by policy. The enforcement is named so it can be verified.

### 1.1 The app never tracks anyone

Location is read as a **one-shot**, at four moments, all of them initiated by the representative:

1. tapping **Зайг харах** on today's route,
2. starting a visit,
3. finishing a visit,
4. choosing to attach a position to an exception request.

- [ ] `src/lib/location.ts` is the only file that reads location
- [ ] It contains no watcher, no background task and no geofencing service
- [ ] Permission requested is "when in use" only
- [ ] `ACCESS_BACKGROUND_LOCATION` is blocked in `app.json`, so a dependency cannot acquire it
      even by accident
- [ ] The app's entry in the phone's own settings shows **While Using**, never **Always**
- [ ] Battery usage after an hour of idle time is unremarkable — a watcher would show

> If a representative never taps anything, the app never learns where they are. That is the
> whole promise, and it is testable on a real phone in ten minutes.

### 1.2 No movement history is stored

Only three tables hold coordinates:

| Table | What | Why it is acceptable |
|---|---|---|
| `clinic` | Where a clinic is | Not a person |
| `visit_event` | Check-in and check-out | Two points per visit, both initiated deliberately |
| `visit_exception` | An attached position | Opt-in, nullable, and the representative chooses |

- [ ] No other table has a latitude or longitude column
      *(enforced: `tests/db/security.test.ts` — the assertion lists exactly these three)*
- [ ] The route between two check-ins is not recorded, because it is never read
- [ ] Distances shown on today's route are computed on the device and never sent

### 1.3 No patient information, anywhere

- [ ] No field in any form asks about a patient
- [ ] No column name suggests one *(enforced: `fn_security_findings()`)*
- [ ] `doctor.professional_notes` carries an explicit warning in the interface
- [ ] The visit report's free-text fields carry the same warning
- [ ] Representatives are told this in training and in `91-manual-representative.md`

Free text can always be misused. The mitigations are the warning next to the field, the fact that
nothing in the form invites patient detail, and a manager who reads reports. If patient
information is ever found in a report, treat it as an incident: the addendum mechanism cannot
remove it, and a developer will need to redact the row.

### 1.4 Audio recording does not exist

- [ ] There is no microphone permission
- [ ] There is no audio column in any table
- [ ] There is no recording code in the repository
- [ ] `feature_audio_recording_enabled` is `false`
- [ ] **Тохиргоо → Нууцлал** says so in Mongolian, where representatives can read it

The flag guards a feature that was never written. That is deliberately stronger than a flag that
turns an existing one off.

**If audio recording is ever proposed**, it needs, before a line of code: the doctor's explicit
recorded consent, a legal review under Mongolian law, a retention period, and a way for a doctor
to withdraw consent and have recordings deleted. See `docs/07-risks.md` A1–A5.

---

## 2. What each person can see

| | Own visits | Colleagues' submitted visits | Colleagues' drafts | Audit log | Everyone's KPI |
|---|---|---|---|---|---|
| Representative | Yes | Yes | **No** | No | No |
| Manager | Yes | Yes | **No** | Yes | Yes |
| Administrator | Yes | Yes | **No** | Yes | Yes |

- [ ] A draft visit report is private to its author until submitted
      *(enforced: RLS policy `visit_select`, tested)*
- [ ] Representatives can read colleagues' **submitted** visits — this is the point of a shared
      doctor history, and representatives are told
- [ ] Nobody can read another person's unsubmitted work, including managers

> The shared doctor history is a deliberate trade-off. A representative walking in to see a
> doctor benefits enormously from knowing what a colleague discussed last month. Representatives
> should know their submitted reports are visible to the team — it is in their manual.

---

## 3. Transparency

A surveillance system people do not understand is worse than one they do, even if it collects
less.

- [ ] **Тохиргоо** states, in Mongolian, exactly when location is read
- [ ] It states that background tracking is off
- [ ] It states that audio recording does not exist
- [ ] It states that patient information must not be entered
- [ ] The start-visit screen shows what it measured and why it did or did not allow the check-in
- [ ] Every refusal explains itself with the actual numbers ("you are 240 m away, the limit is
      150 m") rather than a greyed-out button

- [ ] Every representative has been shown `91-manual-representative.md` §3 and §11 before first
      use

---

## 4. Retention

Decided by management (`docs/07-risks.md §5`):

| Data | Retention |
|---|---|
| Visits and reports | 5 years |
| Audit log | 3 years |
| Attachments | 1 year |

- [ ] These are documented
- [ ] **Not yet implemented.** No automatic deletion job exists. Recorded as a known limitation
      in [`95-known-limitations.md`](95-known-limitations.md)
- [ ] Someone owns the decision of when to implement it

> Saying "5 years" and never deleting anything is the common failure. It should be flagged again
> at the first anniversary, not left to be discovered at the fifth.

---

## 5. Leaving the company

- [ ] The account is deactivated the same day *(Хэрэглэгчийн удирдлага)*
- [ ] The account is **not** deleted — their historical visits must keep a valid author
- [ ] Their phone is collected, or the app is removed from it
- [ ] Signing out purges the on-device cache and queue
- [ ] Their name remains on their historical visits and in the audit log, which is the point of
      an audit log

---

## 6. Data leaving the system

- [ ] Every export is recorded in the audit log **before** the rows are returned
- [ ] Exports are available to managers and administrators only
- [ ] Power BI reports are shared with named people, not "everyone in the organisation"
- [ ] Doctor phone numbers and emails are absent from the reporting views — a `.pbix` file gets
      emailed around
- [ ] Anyone exporting knows the file contains employees' names, locations and times

---

## 7. Answering a representative who asks

Practise these. They will be asked.

**"Can you see where I am right now?"**
No. The app reads your location only when you tap something that needs it, and only that moment
is stored. There is no live position anywhere in the system.

**"Can you see where I went between two clinics?"**
No. Nothing between check-out and the next check-in is recorded, so there is nothing to see.

**"Is my phone recording me?"**
No. The app has never asked for microphone permission and there is no recording code in it. Your
phone's own settings will confirm the app cannot access the microphone.

**"Can my manager change what I wrote?"**
No. A submitted report cannot be edited by anyone, including administrators. A manager who
disagrees can add a note; your original stays exactly as you wrote it.

**"Can other representatives read my reports?"**
Your submitted reports, yes — that is how the shared doctor history works, and it works for you
too when you visit a doctor a colleague saw last month. Your drafts, no: those are yours until
you submit them.

**"What happens if I forget to close a visit?"**
The timer keeps running and it appears on your manager's "worth checking" list. Tell them what
happened; it is not treated as dishonesty.

---

## 8. Monthly

1. Location permission on a sample phone still shows **While Using**
2. No new table has acquired a coordinate column *(the test would have failed)*
3. Audit log filtered by export — every export looks expected
4. Any report containing something that looks like patient information → treat as an incident
