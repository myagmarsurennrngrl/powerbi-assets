# 93 — Security Checklist

What must be true before real data goes in, and every month afterwards.

Most of this is enforced automatically. Where it is, the check says which test or query proves
it — a checklist item nobody can verify is a checklist item nobody believes.

---

## 1. The one-minute version

Run this in the Supabase SQL editor:

```sql
SELECT * FROM public.fn_security_findings();
```

**Zero rows.** It checks every table for row-level security, every `SECURITY DEFINER` function
for a locked `search_path`, every function for an accidental `PUBLIC` grant, `anon` for any
access at all, `DELETE` outside the allowlist, the reporting login for leaks, credential-shaped
and patient-shaped column names, and the audio-recording flag.

Anything it returns, stop and fix. Everything below is the reasoning behind it plus the parts a
query cannot see.

---

## 2. Secrets

- [ ] No secret in source. `.env` is git-ignored; `.env.example` holds placeholders only
- [ ] The app carries the **anon** key, never `service_role`
      *(enforced: `src/lib/env.ts` decodes the key at startup and refuses to run)*
- [ ] `service_role` key exists only in the Supabase dashboard and, if needed, a server-side job
- [ ] Database password and the `reporting_reader` password are in the company password manager
- [ ] No password has ever been sent by email or chat
- [ ] `git log -p -- .env` returns nothing

> Anything prefixed `EXPO_PUBLIC_` is compiled into the app bundle and must be treated as public.
> Someone with the `.apk` can read it. That is fine for the anon key, which is designed for it,
> and catastrophic for anything else.

---

## 3. Database

- [ ] Every table has row-level security enabled **and** at least one policy
      *(enforced: `tests/db/rls.test.ts`, `fn_security_findings()`)*
- [ ] Every `SECURITY DEFINER` function sets `search_path = ''` and schema-qualifies everything
      *(enforced: `tests/db/security.test.ts`)*
- [ ] No function this project defines is executable by `PUBLIC`
      *(enforced: `tests/db/security.test.ts` — this was a real bug; see migration 0025)*
- [ ] `anon` can execute exactly one function and read no table
- [ ] `fn_audit` is executable by nobody — not even an administrator
- [ ] `DELETE` is granted only on the five child-list tables
- [ ] `audit_log`, `visit_event`, `visit_addendum` and `visit_status_history` are append-only,
      enforced by both revoked grants **and** triggers
- [ ] No application role has `BYPASSRLS`

### The two mistakes this project actually made

**`SET search_path = ''` silently breaks unqualified operators.** The `citext` `=` operator lives
in `public`; with an empty search path PostgreSQL cannot resolve it, falls back to case-sensitive
text comparison, and `Rep01@MONOS.MN` stops matching. Found in Phase 1 before shipping.

**Revoking from `anon` does not remove a privilege held through `PUBLIC`.** PostgreSQL grants
EXECUTE on every new function to PUBLIC by default. Migration 0008 revoked `fn_audit` "from anon,
authenticated" and stated in a comment that it was therefore not callable. It was. An
unauthenticated caller could forge audit log entries. Fixed in migration 0025.

Note that `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` **does not
work** — it was tried and verified not to. New functions must be revoked explicitly; the test
suite fails by name if one is missed.

---

## 4. Authentication

- [ ] Login restricted to approved company domains, enforced by a trigger on `auth.users` —
      not by the app
- [ ] Every non-email auth provider is disabled in the Supabase dashboard
- [ ] **"Confirm email" is off.** The app signs in with a password and no confirmation
      email can be delivered — left on, a new account stays unconfirmed and Supabase refuses
      the sign-in with the same message it uses for a wrong password (docs/99-password-login.md)
- [ ] Company SMTP configured — **not required for login any more**, but until it exists there
      is no self-service password reset and every reset is an administrator action
- [ ] An account with no `app_user` row can sign in but reaches nothing, and is told so clearly
- [ ] Session tokens are in the device keychain via `expo-secure-store`, never AsyncStorage
- [ ] Exactly two administrators

---

## 5. Rate limiting

Enforced by Supabase in front of PostgreSQL, configured in the dashboard. There is deliberately
no in-database imitation: a counter table is bypassed by anything that never reaches the
database, which is exactly what a flood does.

- [ ] **Authentication → Rate limits → sign-in attempts:** capped, so a password cannot be
      brute-forced
- [ ] **Authentication → Rate limits → token refresh, verification:** left at the defaults or
      lower
- [ ] **Project Settings → API:** request rate limits reviewed
- [ ] **Project Settings → Database → Network restrictions:** the database *port* restricted to
      known IPs (office, Power BI machine). The API is left open — representatives are on mobile
      data

---

## 6. Location and privacy

- [ ] Location is requested as "when in use" only
- [ ] `ACCESS_BACKGROUND_LOCATION` is blocked in `app.json` so a dependency cannot acquire it
- [ ] No watcher, no geofencing service, no polling — location is read as a one-shot, at four
      moments only *(`src/lib/location.ts` is the only file that reads it)*
- [ ] Coordinates are stored on exactly three tables: `clinic`, `visit_event`, `visit_exception`
      *(enforced: `tests/db/security.test.ts`)*
- [ ] Exception coordinates are nullable and opt-in
- [ ] The privacy statement in **Тохиргоо** matches what the code actually does

See [`97-privacy-checklist.md`](97-privacy-checklist.md) for the fuller treatment.

---

## 7. Data that must not exist

- [ ] No column name anywhere suggests patient information
      *(enforced: `tests/db/security.test.ts`, `fn_security_findings()`)*
- [ ] No column stores a credential
- [ ] No audio column, and `feature_audio_recording_enabled` is `false`
- [ ] No audio recording code exists in the repository — the flag guards a feature that was
      never written, which is a stronger guarantee than a flag that turns one off

---

## 8. Reporting and Power BI

- [ ] `reporting_reader` can read the `reporting` schema and nothing else
      *(`SELECT * FROM public.fn_reporting_reader_leaks();` → zero rows)*
- [ ] It has no write access anywhere
- [ ] Its password is in the password manager, not in a `.pbix` and not in an email
- [ ] Doctor phone numbers and emails are absent from the reporting views
- [ ] Unsubmitted drafts are excluded from the reporting views
- [ ] Published Power BI reports are shared with named people, not the whole organisation
- [ ] If representatives view a report, Power BI's own row-level security is configured — the
      database cannot filter per-user through a shared reporting login
- [ ] TLS is enabled on the Power BI connection

---

## 9. Storage

This project uses no Supabase Storage bucket. `visit_exception.attachment_path` is reserved for a
future photo attachment and is always NULL.

- [ ] No bucket exists
- [ ] If one is ever added: it is **private**, with policies written in the same style as the
      table policies, and this section is replaced by them

A public bucket would put photographs taken inside clinics on the open internet behind a
guessable URL.

---

## 10. Devices

- [ ] Company phones have a screen lock
- [ ] A lost phone is reported immediately and the account deactivated the same day
- [ ] Signing out purges the local cache and queue
      *(implemented: `purgeAll()` in `src/lib/offline/db.ts`)*
- [ ] Representatives know that signing out with items still queued loses them — the app warns

---

## 11. Audit

- [ ] The audit log records: logins denied by domain, plan changes, visit completions, exception
      decisions, addenda, role changes, deactivations, setting changes, master-data changes and
      **every data export**
- [ ] Exports write their audit entry **before** returning rows
- [ ] Nobody can edit or delete an audit entry
- [ ] Managers can read it; representatives cannot
- [ ] Someone actually reads it monthly — an audit log nobody opens is a cost, not a control

---

## 12. Before go-live

- [ ] Everything above
- [ ] `npm test` passes in full against a real PostgreSQL
- [ ] Production is a separate Supabase project from test
- [ ] No seed data in production
- [ ] Point-in-time recovery is on, and a restore has been rehearsed once
- [ ] The retention decisions in `docs/07-risks.md §5` have been implemented or explicitly
      deferred in writing

---

## 13. Monthly

Five minutes:

1. `SELECT * FROM public.fn_security_findings();` → zero rows
2. `SELECT * FROM public.fn_reporting_reader_leaks();` → zero rows
3. Audit log, filtered by **Дата экспортолсон** — does every export look expected?
4. Users list — is anyone active who has left?
5. Administrator count — still two?
