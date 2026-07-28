# 82 — Production Deployment

Taking this from a test project to something eleven people use every day.

Read [`93-security-checklist.md`](93-security-checklist.md) alongside this. This document is the
order of operations; that one is what must be true when you finish.

---

## 1. Two projects, not one

Create a **second** Supabase project for production and leave the existing one as the test
project. It costs nothing on the free tier and it is the difference between "I tried something on
the test data" and "I deleted a month of real visits".

| | Test | Production |
|---|---|---|
| Data | The fictional seed | Real clinics, real staff |
| Who has the password | Whoever is working on it | Two named people |
| Seeds applied | Yes | **Never** |
| Point-in-time recovery | Not needed | Required (see §7) |

The seed files under `supabase/seed/` contain invented doctors and clinics. Applying them to
production would mix fictional records into real data with no easy way to separate them
afterwards.

---

## 2. Order of operations

Do these in order. Each step assumes the one before it worked.

### Step 1 — Create the project
Supabase → **New project**. Region: choose the closest available to Ulaanbaatar (usually
Singapore or Tokyo — compare the latency, it is noticeable on a mobile connection). Save the
database password in the company password manager immediately; it is shown once.

### Step 2 — Apply the migrations
```bash
supabase link --project-ref <production-ref>
supabase db push
```

Or, without the CLI: open the SQL editor and paste each file in `supabase/migrations/` **in
numerical order**, 0001 through 0025. Do not skip one and do not reorder them.

Do **not** apply anything from `supabase/seed/` or `supabase/tests/`.

### Step 3 — Verify before going further
In the SQL editor:

```sql
SELECT * FROM public.fn_security_findings();
```

**Zero rows.** Anything here means stop and fix it before real data exists. This is the cheapest
moment in the project's life to find a problem.

### Step 4 — Configure authentication
Supabase → **Authentication**:

* **Providers → Email:** enabled. **Disable "Confirm email"** — the app uses one-time codes, not
  confirmation links.
* **Providers:** disable every other provider. Anything enabled is a way in.
* **Emails → Templates:** edit **Confirm signup** AND **Magic Link** so the body contains
  `{{ .Token }}`. Both ship with a confirmation *link* instead, which a phone app cannot use —
  the email arrives, the app is correct, and nobody can log in. See D4 in
  `docs/90-setup-for-non-technical.md` for the exact template text. Fixing only one of the two
  works for a person's first login and breaks on their second.
* **URL Configuration → Site URL:** the app scheme from `app.json`.
* **Emails → SMTP Settings:** connect the company mail server. Supabase's built-in sender is
  limited to a few messages an hour and is for testing only. Seven representatives signing in on
  a Monday morning will exceed it.
* **Rate limits:** set OTP sends to something sane (5 per hour per address is generous for
  eleven people).

### Step 5 — Approved email domain
```sql
INSERT INTO public.approved_email_domain (domain, is_active)
VALUES ('monos.mn', true);
```

Nobody outside this domain can sign in, enforced by a trigger on `auth.users`. Get it right
before creating any user.

### Step 6 — The first administrator
```sql
INSERT INTO public.app_user (email, full_name, role)
VALUES ('admin@monos.mn', 'Нэр Овог', 'administrator');
```

This is the only account created by hand. That person signs in — the account links itself on
first sign-in — and creates everyone else through **Хэрэглэгчийн удирдлага**.

> **Do not create a second administrator "just in case" and then forget it.** Every
> administrator can change roles and read the audit log. Two is the right number: one primary,
> one who can act if the first is unavailable.

### Step 7 — Real master data
Through the app, as the administrator: clinics, then doctors, then brands and products, then the
remaining staff and their brand assignments.

**The clinic coordinates need someone to physically go there.** See §4 — this is the single most
common cause of the app appearing broken.

### Step 8 — Point the app at production
In `.env` on the build machine:
```
EXPO_PUBLIC_SUPABASE_URL=https://<production-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<production anon key>
```
Only the `anon` key. The app refuses to start with a `service_role` key, but do not test that
theory.

### Step 9 — Build and distribute
```bash
eas build --profile preview --platform android    # .apk for internal distribution
eas build --profile preview --platform ios        # needs an Apple Developer account
```

Android: put the `.apk` on an internal link or send it directly. Devices need "install from
unknown sources" allowed once.

iOS: TestFlight, via App Store Connect. Internal testers do not need App Review, but the build
does need a paid developer account.

### Step 10 — Backups
Turn on point-in-time recovery **before** the first real visit is recorded. See
[`94-backup-and-recovery.md`](94-backup-and-recovery.md).

---

## 3. Network restrictions

Supabase → **Project Settings → Database → Network restrictions**.

Restricting database access to the office IP range is a real improvement, but note what it
affects:

* the **app** connects through the API, not the database port — unaffected;
* **Power BI** connects to the database port — its machine's IP must be allowed;
* **you** connecting with `psql` — same.

If representatives are in the field on mobile data, do not restrict the API. Restrict the
database port only.

---

## 4. Clinic coordinates — budget a day for this

The geofence decides whether a representative standing in the right building can record their
visit. Wrong coordinates produce a missed visit for someone who was there, and the KPI will be
wrong in a way nobody can see from a desk.

For each clinic:

1. Go there.
2. Open the clinic in **Мастер дата** and note the distance the app reports at the front door.
3. If it is more than about 50 m, the coordinates are wrong — get them from the phone's map at
   the entrance and correct them.
4. Set the radius from the building, not from habit: an ordinary clinic 150 m; a hospital with a
   large campus 300–500 m; a clinic inside a shopping centre may need more.

**Мастер дата** shows how many clinics still carry the untouched default. Aim for zero.

---

## 5. Releasing an update

1. `npm test`, `npm run typecheck`, `npx expo export --platform android` — all clean.
2. New migrations applied to the **test** project first, exercised there.
3. `SELECT * FROM public.fn_security_findings();` on test — zero rows.
4. Bump `version` in `app.json`.
5. Apply the migrations to production, **then** distribute the new build.

Order matters. The app tolerates a database that is ahead of it far better than one that is
behind: a missing column is a crash, an unused one is nothing.

Never edit a migration that has been applied. Write a new one.

---

## 6. Rolling back

**The app:** distribute the previous build. Keep the last two.

**The database:** there is no automatic rollback, by design — a `DROP TABLE` in a "down"
migration is one typo away from deleting real work. Recovery is:

1. a corrective forward migration, if the problem is a rule or a default;
2. point-in-time recovery, if data was damaged — see `94-backup-and-recovery.md`.

This is why step 3 above, and testing migrations on the test project, are not optional.

---

## 7. Who needs access to what

| Person | Supabase dashboard | Database password | Power BI login | App |
|---|---|---|---|---|
| System administrator | Yes | Yes | Sets it | Administrator |
| Second administrator | Yes | Yes | No | Administrator |
| Managers | No | No | Maybe | Manager |
| Representatives | No | No | No | Representative |
| Whoever builds reports | No | No | Yes | — |

The dashboard is not the app. Someone who needs to manage users needs the *app's* administrator
role, not a Supabase login. Handing out dashboard access to avoid explaining that is how a
database gets edited by hand at eleven at night.

---

## 8. Go-live checklist

- [ ] Production is a separate Supabase project from test
- [ ] Migrations 0001–0025 applied, in order, nothing skipped
- [ ] `SELECT * FROM public.fn_security_findings();` returns zero rows
- [ ] No seed data in production
- [ ] Company SMTP configured — not Supabase's test sender
- [ ] Email confirmation disabled; every non-email provider disabled
- [ ] `approved_email_domain` contains `monos.mn` and nothing else
- [ ] Exactly two administrators
- [ ] Every clinic visited in person and its coordinates verified
- [ ] Point-in-time recovery enabled
- [ ] A restore has been rehearsed once (`94-backup-and-recovery.md` §5)
- [ ] The app build points at production and uses the `anon` key
- [ ] Every representative has signed in successfully once
- [ ] `reporting_reader` has a password, stored in the password manager
- [ ] The two manuals have been handed to the people who need them
