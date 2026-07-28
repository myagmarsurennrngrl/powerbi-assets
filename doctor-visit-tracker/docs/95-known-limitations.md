# 95 — Known Limitations

Everything this system does not do, why, and what it would take.

Nothing here is hidden in the app as a button that does nothing. Where a feature is visible but
unbuilt, it is labelled **«Хараахан хэрэгжээгүй»**.

---

## 1. Deliberate design limits

These are not gaps to be closed. They are decisions, and changing one means accepting what it was
protecting against.

### 1.1 Check-in and check-out require a connection

A visit cannot be started or finished offline.

**Why.** The value of a check-in is that the **server** measured the distance from coordinates it
was given and stamped the time with its own clock. A check-in queued on a phone and sent three
hours later has neither: the only timestamp is the device's, which this project explicitly does
not trust, and the server would be recording a presence it cannot vouch for.

**What is unaffected.** Everything that is a *statement by the representative* queues normally —
the visit report, corrections, exception requests. A statement is just as true an hour later.

**In practice.** Start the visit outside the building where there is signal, then go in. The
report can be written offline.

**To change it** you would have to accept device-reported times as evidence, label them as such
everywhere they appear, and route every offline check-in to the manager's review list. That is a
management decision about what the KPI means, not a technical one.

### 1.2 A submitted report cannot be edited

Not by its author, not by a manager, not by an administrator. Corrections are separate **addendum**
rows shown beneath the original.

**Why.** A record that can be quietly changed after the fact is not evidence of anything.

### 1.3 Nothing is ever deleted

Users are deactivated. Master data is archived. Visits and audit entries cannot be removed at all.

**Why.** A deleted user orphans their visits; a deleted clinic orphans its history.

**Consequence.** A genuine mistake — a visit at the wrong clinic — stays visible, with an
addendum explaining it. That is the intended outcome.

### 1.4 Approved exceptions for `doctor_unavailable` and `gps_problem` still count against the KPI

A management decision, not an oversight. The reason may be entirely true and the visit still did
not happen. The app shows this consequence to the manager **before** they decide.

### 1.5 Unplanned visits never improve the completion percentage

They are counted and reported separately. Otherwise the route to a perfect score would be to plan
two visits and walk into twenty.

---

## 2. Not built yet

| Item | Effort | Notes |
|---|---|---|
| **CSV / Excel import of master data** | Medium | Needs file picking, a per-row validation preview and duplicate resolution. A half-built importer that writes rows it should have rejected is worse than typing them in. The fuzzy duplicate function it will use (`fn_find_similar_doctors`) is built and already in use on the doctor form |
| **Export as a downloadable file** | Small | The export produces rows and audits them; the app does not yet write a file and hand it to another app. Needs `expo-file-system` + `expo-sharing` |
| **Editing which doctors work at which clinic** | Small | `doctor_clinic` is readable everywhere and drives the planning wizard, but has no editor. Maintained in Supabase for now. **This is the most likely of these to be missed** — a doctor who is not linked to a clinic cannot be selected when planning a visit there |
| **Editing the approved email domain in-app** | Small | Table and policies exist; no screen. One domain, changed approximately never |
| **Photo attachment on an exception request** | Medium | `attachment_path` exists and is always NULL. Needs a private Storage bucket with policies — see `93-security-checklist.md` §9 |
| **Push notifications** | Medium | "Your plan was approved", "an exception is waiting". Needs `expo-notifications` and a device-token table |
| **Automatic data retention deletion** | Medium | The periods are decided (5 years visits / 3 years audit / 1 year attachments) and documented. **No deletion job exists.** See §4 |
| **A second language** | Small | The i18n layer takes one more file. Nothing is hard-coded in a screen |
| **Manager editing a rejected plan directly** | Small | They can add and reschedule visits, and reject with a reason. Editing someone else's plan wholesale was judged worse than asking them to |

---

## 3. Operational limits

### 3.1 Clinic coordinates must be verified in person
The single most likely cause of the system appearing broken. A wrong coordinate means a
representative standing in the right building is refused, and the KPI records a missed visit that
never happened. **Мастер дата** shows how many clinics still carry the untouched default radius.
Budget a day. See `82-production-deployment.md` §4.

### 3.2 GPS does not work everywhere
Deep basements, lift shafts, thick concrete. No app can fix this. The mitigation is the exception
request, which records the measured accuracy so a manager can see the difference between "no
signal" and "not there".

### 3.3 Mock-location apps are detected, not prevented
Android reports when a reading came from a mock provider. The app records the flag and the visit
appears on the manager's review list. It does not block the check-in, because blocking can be
worked around and would only push the behaviour somewhere invisible. Making it visible and
auditable is the stronger control.

### 3.4 The email code depends on the mail server
Sign-in needs an email to arrive. If company mail is down, nobody can sign in for the first time
that day. Already-signed-in sessions keep working. Supabase's built-in sender is rate-limited and
must be replaced with company SMTP before real use.

### 3.5 Only one visit at a time
A representative cannot have two visits in progress. Two doctors at the same clinic in one
sitting is one visit with two doctors on it, which is what the form expects.

---

## 4. Things with a deadline attached

**Data retention has no implementation.** The periods are agreed and written down; nothing
deletes anything. The failure mode is well known: it is discovered in year five, when the answer
is expensive.

- [ ] Raise this again at the first anniversary of go-live
- [ ] Owner: ____________

**The restore rehearsal expires.** A backup proven once in 2026 is not proven in 2028. Yearly.

---

## 5. Scale

Sized for the actual company: 7 representatives, 3 managers, ~15 clinics, ~50 doctors.

| Dimension | Comfortable | Where it strains |
|---|---|---|
| Representatives | up to ~50 | Nothing structural; the manager dashboard becomes a long list |
| Clinics | up to ~500 | The clinic picker needs pagination past a few hundred |
| Doctors | up to ~5,000 | Same |
| Visits | millions | Indexed; the reporting star schema handles the analytics side |
| Managers | tens | Fine |

Nothing here is close. If the company grows tenfold, the screens need pagination; the data model
does not need changing.

---

## 6. Pinned versions

Latest stable, mutually compatible at the time of writing. Referenced from
`docs/01-architecture.md` §5.

| | Version | Note |
|---|---|---|
| Expo SDK | 57 | |
| React Native | 0.86.0 | |
| React | 19.2.3 | |
| TypeScript | 6.0.3 | |
| Expo Router | 57 | typed routes |
| `@supabase/supabase-js` | 2.x | |
| PostgreSQL | 16 | Supabase's current default; the test suite runs on the same |
| Vitest | 4.x | |

**`.npmrc` sets `legacy-peer-deps=true`.** `expo-router` pulls in a web-only `react-dom` whose
peer range is stricter than the React version Expo SDK 57 pins, and `npm install` fails with
`ERESOLVE` without it. Nothing in the mobile app uses `react-dom`. Revisit when Expo Router
relaxes the peer dependency.

---

## 7. Depends on Supabase

Authentication, the API, storage and backups are Supabase. If Supabase is down, the app is
read-only from cache and the queue fills.

Two things reduce the lock-in:

* the database is **plain PostgreSQL** — every table, policy and function in `supabase/migrations/`
  runs on any PostgreSQL 16, which is how the test suite works;
* authentication sits behind the `AuthProvider` interface in `src/lib/auth/`, and the
  `app_user.auth_user_id` column is the single join point. Moving to Microsoft Entra ID means a
  new provider implementation and repopulating that one column — the requirement this
  architecture was designed around from Phase 1.

What is genuinely Supabase-specific: PostgREST's `authenticated`/`anon` roles and the
`request.jwt.claim.sub` setting the policies read. Both are thin, and the local test shim already
recreates them on plain PostgreSQL.

---

## 8. Audio recording

Not implemented, in any phase. The flag exists and is off, there is no audio column and no
recording code in the repository.

**Before it could be built:** the doctor's explicit recorded consent, a legal review under
Mongolian law, a retention period, and a way for a doctor to withdraw consent and have recordings
deleted. See `docs/07-risks.md` A1–A5.

---

## 9. Reporting the truth

If you are asked "does it do X?", the honest answers are in this file. Two that come up:

**"Can a representative log a visit without being there?"** They can request an exception, which
a manager reviews. They cannot record a completed visit from elsewhere: the distance is measured
by the server, not sent by the phone.

**"Can we see the full route someone drove?"** No, and not by configuration either. Those points
are never collected, so there is nothing to enable.
