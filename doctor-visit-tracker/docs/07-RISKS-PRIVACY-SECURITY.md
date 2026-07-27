# 07 — Privacy, Security, GPS and Audio-Recording Risks

This document lists the risks **before** implementation, so decisions are
deliberate rather than accidental. Each risk has a severity, the mitigation that
is actually built, and what remains your responsibility as the employer.

Severity: 🔴 high · 🟠 medium · 🟡 low

---

## 1. Privacy risks

### P1 🔴 Employee location monitoring becoming surveillance
**Risk.** A location-aware work app easily drifts into continuous tracking. That
damages trust, and in many jurisdictions employee monitoring must be
proportionate, announced and limited.

**Mitigation built in.**
* Background location is **not implemented and not installable** — the
  background permission is not declared in `app.json`, and `expo-task-manager`
  is not a dependency. There is no code path that could track anyone.
* Location is read at exactly three moments: check-in, check-out, and a
  voluntary exception request. That is at most 3 coordinates per visit.
* The app contains a "Байршлын нууцлал" screen that states this in Mongolian, so
  the employee can verify the limit themselves.
* iOS `NSLocationWhenInUseUsageDescription` and the Android rationale dialog
  explain the purpose in Mongolian.

**Your responsibility.** Announce the app in writing to the 7 representatives
before rollout, state what is collected and why, and keep a signed
acknowledgement. Mongolia's Law on Personal Data Protection (2021) requires a
lawful basis and informing the data subject.

### P2 🔴 Patient information leaking into free-text fields
**Risk.** A representative writes "patient X has rosacea, prescribed …" into the
summary. The company then holds health data about a third party who never
consented — the most sensitive category there is.

**Mitigation built in.**
* No field anywhere asks for or accepts patient data. The data model has no
  patient entity.
* Every free-text field shows a persistent hint:
  **"Өвчтөний талаарх мэдээлэл оруулахыг хатуу хориглоно."**
* Server-side validation rejects text matching Mongolian national-ID patterns
  (`^[А-ЯӨҮЁ]{2}[0-9]{8}$`) and 8+ digit sequences that look like registration
  numbers, with a clear Mongolian error.
* `doctors.professional_notes` is documented as *professional* notes only; the
  admin UI repeats the warning. Sensitive or personal remarks about doctors are
  explicitly out of scope and there is no field for them.

**Residual risk.** Free text can never be fully policed automatically. Train
staff, and give managers a way to raise an addendum flagging bad content (the
original stays, as required, but the addendum documents the problem).

### P3 🟠 Doctors' personal data held without their knowledge
Doctors' names, specialities, phones and e-mails are personal data.
* Only business-contact fields are stored; phone and e-mail are optional.
* Retention is configurable (`retention_visit_years`, default 5).
* The seed/test data uses invented names only — no real doctor appears in any
  test dataset.
* **Your responsibility:** be able to answer a doctor's access or deletion
  request. Soft delete plus a documented hard-delete procedure is provided.

### P4 🟠 Excessive retention
Location points and audit records accumulate.
* Retention settings exist for visits (5 y), location (2 y) and audit (7 y).
* A documented purge procedure removes coordinates older than the location
  retention while keeping the visit record itself — so KPI history survives but
  the movement data does not.

### P5 🟡 Data exported to Power BI escaping controls
* Power BI connects with a dedicated read-only role limited to the `reporting`
  schema.
* `reporting.fact_visit` exposes *distance from clinic* and *geofence_verified*
  but **not** raw latitude/longitude, except in one separately-granted view for
  the manager map. Reports therefore cannot become a movement map by accident.
* CSV exports are logged in `audit_logs` with the exporting user, row count and
  filter used.

---

## 2. GPS and geofence risks

### G1 🔴 GPS is inaccurate indoors and among tall buildings
**Risk.** A representative genuinely standing in the clinic is shown 300 m away
and cannot start the visit. This is the single most likely cause of the app being
rejected by its users.

**Mitigation.**
* Default radius **150 m**, and it is **per clinic** — an administrator raises it
  for a large hospital campus or a location with known poor signal.
* An accuracy threshold (default 50 m) prevents acting on a bad fix; the app
  waits and retries for up to 20 seconds, keeping the best reading.
* The screen always shows *your distance* and *the allowed radius*, so the
  problem is visible, not mysterious.
* A blocked check-in is never a dead end: the exception path is always available,
  and `wrong_clinic_coordinates` is a first-class reason category that tells the
  administrator to fix the master data.

### G2 🟠 Wrong clinic coordinates in master data
* Coordinates are validated on entry (range, and inside a Mongolia bounding box
  with a warning outside Ulaanbaatar).
* The admin screen shows the point on a map before saving.
* Repeated `wrong_clinic_coordinates` exceptions for one clinic surface on the
  administrator dashboard.

### G3 🟠 Fake GPS / mock location apps
* Android exposes `isFromMockProvider`; it is stored on the event and flagged.
* iOS gives no equivalent signal — this is an accepted limitation, documented.
* Server-side recomputation means the phone cannot simply post a distance of 0.
* Detection, not prevention, is the realistic goal: flagged events appear in the
  manager's "visits started outside expected conditions" list.

### G4 🟠 Location permission denied or "while using the app" downgraded
* The app degrades to a clear explanation screen with a button that opens the
  OS settings; it does not crash or silently fail.
* Without location, check-in is impossible by design — the exception path is
  offered instead.

### G5 🟡 Battery and data usage
* One-shot location with `Accuracy.Balanced`, escalating to `High` only if the
  first fix is too coarse. No polling, so battery impact is negligible.

---

## 3. Security risks

### S1 🔴 Someone logs in with a non-company e-mail
* Enforced at three layers: UI hint, an `auth.users` insert trigger that refuses
  the account, and RLS that returns nothing without a matching `app_users` row.
* Removing a domain from `approved_email_domains` does not retroactively delete
  accounts — deactivation is a separate, audited admin action. Documented.

### S2 🔴 Client-side-only permission checks
* Nothing is protected by hiding a button. Every table has RLS; every sensitive
  write goes through a `SECURITY DEFINER` function that re-checks the role.
* The Supabase **anon key** shipped in the app is a public identifier, not a
  secret — it grants nothing on its own. The **service-role key** never leaves
  the server and never appears in the repository.

### S3 🔴 Tampering with submitted records
* `UPDATE`/`DELETE` grants do not exist for `visit_events`, submitted
  `visit_reports`, `visit_addenda`, `visit_status_history`, `audit_logs`.
* Triggers raise an exception as a second line of defence, in case a future
  migration re-grants something by mistake.

### S4 🟠 SQL injection
* All access goes through PostgREST/parameterised RPC; no string-built SQL in
  the app. Every function declares `search_path = ''` and uses fully-qualified
  names, which also blocks search-path hijacking.

### S5 🟠 Insecure file upload (exception attachments)
* Private bucket, no public URLs, time-limited signed URLs only.
* Server-side checks: MIME allow-list (`image/jpeg`, `image/png`, `application/pdf`),
  5 MB limit, extension/MIME agreement, randomised object names, path scoped to
  `exceptions/{user_id}/{exception_id}/…` and enforced by a storage policy.
* Files are never executed or rendered as HTML.

### S6 🟠 OTP abuse / e-mail bombing
* Rate limits: 3 OTP requests per e-mail per 15 minutes, 30 per IP per hour,
  configured in Supabase Auth; the app enforces a 60-second resend cooldown.

### S7 🟠 Lost or stolen phone
* Tokens live in the iOS Keychain / Android Keystore, not in plain storage.
* Deactivating the user in the admin screen kills access at the next token
  refresh (≤ 1 hour); a documented "revoke all sessions" step makes it immediate.
* No sensitive data is cached beyond the operational minimum, and the local
  SQLite cache is cleared on sign-out.

### S8 🟡 Secrets in the repository
* `.env` is git-ignored; `.env.example` is committed with placeholder values.
* Production secrets live in EAS Secrets and Supabase Vault.
* A secret-scanning check runs in CI.

### S9 🟡 Backup and recovery
* Supabase automated daily backups (Pro plan) plus a documented weekly
  `pg_dump` to company storage, and a **tested** restore procedure — an untested
  backup is not a backup.

---

## 4. Audio-recording risks (feature is OFF)

Audio is **not** in the MVP. `app_settings.feature_audio_recording = false`, the
tables exist but RLS denies everything, and there is no UI. This section records
what must be true *before* anyone turns it on.

### A1 🔴 Recording a person without consent
In Mongolia, and under general data-protection principles, recording an
identifiable person requires a lawful basis and, in practice, consent. A doctor
recorded without agreement is both a legal and a commercial disaster.
**Required before enabling:** a consent screen, an explicit representative
confirmation, an explicit confirmation that the doctor consented aloud, both
timestamps stored, and a visible recording indicator for the whole recording.

### A2 🔴 Capturing a patient consultation
A recording made in a clinic can easily pick up a patient. That is special-category
health data about someone who cannot consent in that moment.
**Required before enabling:** an explicit prohibition in the consent text, an
enforced maximum recording length, and manager review before any retention.

### A3 🔴 Covert recording by a representative
**Required before enabling:** recording may only start from the consent screen —
never automatically, never on app launch, never in the background.

### A4 🟠 Storage, access and leakage
**Required before enabling:** encryption at rest, private bucket, signed URLs
with short expiry, access limited to named managers, and **every** playback or
download written to `audit_logs` with `action = 'audio_accessed'`.

### A5 🟠 Retention
**Required before enabling:** a configurable automatic deletion date on every
recording and a scheduled job that actually deletes, verified.

**Recommendation.** Do not enable audio recording. The business goal — proving
that visits happened and documenting what was discussed — is already met by
geofenced check-in/check-out plus a structured report, at a fraction of the legal
risk.

---

## 5. Operational and organisational risks

| # | Risk | Mitigation |
|---|---|---|
| O1 🟠 | Representatives feel policed and resist the app | Show them their own KPI, keep location to 3 points, communicate before rollout, run a 2-week pilot with 2 reps |
| O2 🟠 | Bad master data (wrong addresses, missing doctors) makes the app unusable on day one | Import and verify clinics with coordinates **before** rollout; the admin dashboard lists clinics missing coordinates |
| O3 🟠 | Weak mobile internet in hospital basements | Full offline capability with a durable outbox (Phase 7) |
| O4 🟡 | Single administrator becomes a bottleneck / single point of failure | Create at least two administrator accounts; document the recovery path |
| O5 🟡 | Supabase free tier pauses inactive projects | Use the Pro plan for production; documented |
| O6 🟡 | Key person leaves | All infrastructure is code (migrations, seeds, EAS config) and lives in this repository |

---

## 6. Compliance checklist to complete before go-live

- [ ] Written notice to the 7 representatives describing what the app collects
- [ ] Signed acknowledgement from each representative
- [ ] Internal policy stating that patient data must never be entered
- [ ] Named data owner inside the company
- [ ] Retention periods approved by management
- [ ] Doctor data-request procedure documented
- [ ] Backup restore tested at least once
- [ ] Two administrator accounts exist
- [ ] Audio recording confirmed disabled in production settings
- [ ] Power BI access granted only to named managers
