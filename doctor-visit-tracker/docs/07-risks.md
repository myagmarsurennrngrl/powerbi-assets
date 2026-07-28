# 07 — Privacy, Security, GPS and Audio-Recording Risks

This document is deliberately blunt. Several of these risks are **legal and people risks, not technical ones**,
and they need a decision from management, not from code.

Severity: 🔴 high · 🟠 medium · 🟡 low

---

## 1. Privacy risks

| # | Risk | Severity | Mitigation implemented | Requires your decision |
|---|---|---|---|---|
| P1 | Employees perceive the app as surveillance; trust and adoption collapse | 🔴 | No background location. Location captured **only** at check-in, check-out, and an exception the rep chooses to submit. The Settings screen states this in Mongolian. | Publish a written employee notice before rollout. |
| P2 | Patient data gets typed into a free-text field | 🔴 | No patient-related column exists. Every free-text field is labelled "no patient information". Manager review of the doctor-history screen. | Include in staff training; add to employment policy. |
| P3 | Doctor personal data (phone, email) is personal data under Mongolian law | 🟠 | Phone/email optional; visible to reps but not exported to CSV by default; soft-delete supported; retention setting configurable. | Confirm lawful basis and retention period with legal. |
| P4 | Inappropriate personal remarks about a doctor stored forever | 🟠 | `professional_notes` is separated from visit feedback and labelled "professional notes only". Addenda are append-only so a correction is visible, not a cover-up. | Define a written notes policy. |
| P5 | Location reveals a rep's whereabouts outside working hours | 🟠 | Location is only read when the rep taps a button. The app never requests "always" permission — only "when in use". | — |
| P6 | Data-subject access / deletion requests | 🟡 | Soft delete on master data; export per user; audit log shows all access. Transactional visit records are intentionally immutable — document this as a retention decision. | Agree a retention schedule (default proposal: visits 5 years, audit log 3 years, exception attachments 1 year). |

---

## 2. GPS-specific risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| G1 | **GPS spoofing** — a mock-location app fakes being at the clinic | 🔴 | `Location.getCurrentPositionAsync` returns `mocked` on Android; we store it and flag the visit. Server also flags: unrealistic accuracy (< 3 m indoors), device/server clock drift > 5 min, and travel speed between consecutive check-ins that is physically impossible. **We do not claim to prevent spoofing** — we make it visible and auditable. Rooted-device detection is *not* included (see limitations). |
| G2 | Poor GPS indoors in concrete hospitals → rep genuinely cannot check in | 🔴 | Configurable accuracy threshold (default 50 m); per-clinic radius (default 150 m, admin-tunable up to 2000 m); if it still fails, the rep submits a `gps_problem` exception with the measured distance and accuracy attached, and a manager decides. Nobody is blocked from working. |
| G3 | Wrong clinic coordinates in master data | 🟠 | Dedicated exception reason `wrong_clinic_coordinates`; admin screen shows the clinic on a map; the exception carries the rep's actual coordinates so an admin can correct the master record. |
| G4 | Client sends a fake distance | 🔴 | The server **ignores any client-supplied distance** and recomputes Haversine from the submitted lat/lng against the clinic row. Tested. |
| G5 | Phone clock changed to fake a start time | 🟠 | `server_ts` from `now()` is authoritative; `device_ts` stored separately; drift is flagged. |
| G6 | Battery drain / permission fatigue | 🟡 | One-shot location reads only; no geofencing service; no background task. |
| G7 | Offline check-in has no server timestamp at the moment it happens | 🟠 | The event is stamped with `device_ts` at creation and `server_ts` at sync, `source='offline'`, and both are shown to managers. Offline check-ins appear in the "started outside expected conditions" review list. This is an honest limitation, not a hidden one. |

---

## 3. Security risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| S1 | Anon key extracted from the mobile app and used to read all data | 🔴 | Every table has `ENABLE ROW LEVEL SECURITY` with explicit policies; no permissive fallback. An automated test fails the build if any table lacks RLS. The anon key alone grants nothing without a valid JWT. |
| S2 | Privilege escalation by a rep editing their own role | 🔴 | `app_user.role` is not updatable by non-admins (RLS + column-level guard in `fn_set_user_role`, which is `SECURITY DEFINER` and audits). |
| S3 | Client-side-only permission checks | 🔴 | Hard architectural rule: UI may disable, server must reject. Tested via direct API calls in `tests/rls/`. |
| S4 | SQL injection | 🟠 | No string-concatenated SQL. PostgREST parameterises; all functions use typed parameters and `search_path = ''`. |
| S5 | Malicious file upload as an exception attachment | 🟠 | Private Storage bucket, signed URLs only, MIME allow-list (`image/jpeg`, `image/png`, `application/pdf`), 5 MB size cap, randomised object key, no execution path. |
| S6 | Brute-force / password guessing | 🟠 | Supabase Auth rate limits on sign-in; minimum 10 characters with obvious choices refused (`src/domain/password.ts`); approved-domain restriction means an attacker must also know a real company address. |
| S9 | Password reset has no self-service path | 🟠 | Accepted, not mitigated. Email delivery does not work, so proving mailbox ownership is impossible and every reset is an administrator action (`npm run dev:set-password`). Revisit when company SMTP exists — see docs/99-password-login.md §6. |
| S7 | Audit log tampering | 🟠 | `UPDATE`/`DELETE` revoked from all application roles; writes only via `SECURITY DEFINER` functions. |
| S8 | Secrets committed to git | 🔴 | `.gitignore` blocks `.env*`; only `.env.example` is committed; `service_role` key never enters the mobile bundle; a test scans the repo for key-shaped strings. |
| S9 | Power BI credentials over-privileged | 🟠 | Dedicated `reporting_reader` login with `SELECT`-only on the `reporting` schema; no access to `public` or `auth`. |
| S10 | Lost/stolen phone with an active session | 🟠 | Session tokens in `expo-secure-store` (Keychain/Keystore); configurable session length; admin can deactivate a user, which immediately fails every RLS check. |
| S11 | Insecure transport | 🟡 | HTTPS/TLS only, enforced by Supabase; no cleartext endpoints. |
| S12 | Manager silently rewriting history | 🟠 | Structurally impossible: `visit` is immutable, corrections are separate `visit_addendum` rows shown alongside the original. |

---

## 4. Audio recording — why it stays off

Recording a conversation with a doctor is the highest-risk feature in the whole specification.

| # | Risk | Severity |
|---|---|---|
| A1 | Recording a doctor without valid, provable consent — potential legal liability | 🔴 |
| A2 | Accidentally capturing a **patient consultation** → health data of a third party | 🔴 |
| A3 | Storage, encryption and retention of sensitive audio | 🔴 |
| A4 | Recordings used for performance punishment → collapse of employee trust | 🔴 |
| A5 | Doctors refusing to meet representatives who carry a recording app | 🟠 |

**Decision implemented:** `feature_audio_recording_enabled = false` in `app_setting`. There is **no recording
code in the MVP** — not disabled UI, not a stub that records. The Settings screen shows the feature as
**«Идэвхгүй — хэрэгжээгүй»**.

If it is ever enabled, the specification in the brief becomes mandatory and must be built *before* the flag can
be turned on: explicit consent screen, rep consent + confirmation of doctor consent, consent timestamp, stated
purpose and retention, visible recording indicator, stop-at-any-time, encrypted storage, manager-only access,
audit entries for every playback and download, configurable auto-deletion, and an absolute prohibition on
recording patient consultations. My recommendation is to keep it off and take structured notes instead.

---

## 5. Open items needing a management decision

1. Retention periods (visits, audit log, attachments, doctor contact data).
2. Whether `doctor_unavailable` and `gps_problem` should excuse the KPI when approved (current default: no).
3. Written employee notice about what location data is collected and when.
4. Whether managers may export doctor contact details to CSV.
5. Target date for moving authentication to Microsoft Entra ID.
