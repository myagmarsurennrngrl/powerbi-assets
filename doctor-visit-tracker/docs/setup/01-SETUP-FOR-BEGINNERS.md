# Setup — step by step, for someone with no coding background

This guide gets Phase 1 of the app running on your own phone. Follow it in
order. Nothing is skipped and nothing assumes prior knowledge.

Time needed: about **45–60 minutes** the first time.

> **A note on words.** A few technical words appear because the buttons you
> click use them. Each one is explained the first time it appears.

---

## What you are building

Three pieces:

1. **A database in the cloud** (Supabase) — where the information lives.
2. **The app** — what runs on the phone.
3. **A small settings file** (`.env`) — tells the app where its database is.

---

## Part 1 — Install the tools on your computer (once)

### 1.1 Node.js

Node.js is the program that runs the app's build tools.

1. Open <https://nodejs.org>
2. Download the version marked **LTS**.
3. Install it, accepting the defaults.
4. Open a terminal:
   * **Windows** — press the Windows key, type `powershell`, press Enter.
   * **macOS** — press Cmd+Space, type `terminal`, press Enter.
5. Type this and press Enter:
   ```
   node --version
   ```
   You should see something like `v22.x.x`. If you see "not recognised",
   close the terminal, open it again, and retry.

### 1.2 Git (only if the project is not already on your computer)

1. Open <https://git-scm.com/downloads> and install, accepting the defaults.
2. Check it worked: `git --version`

### 1.3 The Expo Go app on your phone

* **iPhone** — App Store, search "Expo Go", install.
* **Android** — Play Store, search "Expo Go", install.

This lets you run the app without publishing it to an app store.

---

## Part 2 — Create the database (Supabase)

### 2.1 Create the account and project

1. Open <https://supabase.com> and click **Start your project**.
2. Sign up (GitHub or e-mail — either is fine).
3. Click **New project**.
4. Fill in:
   * **Name:** `doctor-visit-tracker-dev`
   * **Database Password:** click **Generate a password**, then
     **copy it into your password manager immediately.** You cannot see it
     again, and you need it for backups later.
   * **Region:** choose **Northeast Asia (Tokyo)** or **Southeast Asia
     (Singapore)** — the closest to Mongolia, so the app feels faster.
5. Click **Create new project** and wait about two minutes.

### 2.2 Copy the two values the app needs

1. In the left sidebar click the **gear icon** (Project Settings).
2. Click **API**.
3. You will see:
   * **Project URL** — looks like `https://abcdefgh.supabase.co`
   * **anon public** key — a very long string of letters
4. Copy both into a scratch note. You will paste them in Part 4.

> **Is the anon key a secret?** No. It is safe inside the app. On its own it
> can read and write nothing, because every table in the database is protected
> by rules that check who you are. The key that *is* secret is called
> **service_role** — never copy that one anywhere.

### 2.3 Create the database tables

1. In the left sidebar click **SQL Editor**.
2. Click **New query**.
3. Open the folder `doctor-visit-tracker/supabase/migrations/` on your
   computer. There are six files whose names start with `20260727`.
4. **In filename order, one at a time:** open a file, select all the text,
   copy it, paste it into the SQL Editor, and click **Run**.
   * The order matters. Run `...090000...` first, then `...090100...`, and so
     on to `...090500...`.
   * Each one should say **Success**. If one fails, stop and send me the
     error message — do not run the rest.

The order, for reference:

| # | File |
|---|---|
| 1 | `20260727090000_p1_extensions_enums_utils.sql` |
| 2 | `20260727090100_p1_identity.sql` |
| 3 | `20260727090200_p1_auth_helpers_and_login_gate.sql` |
| 4 | `20260727090300_p1_master_data.sql` |
| 5 | `20260727090400_p1_settings_and_audit.sql` |
| 6 | `20260727090500_p1_rls_and_grants.sql` |

### 2.4 Set your real company e-mail domain

The test data uses `company.mn`. Change it to your real domain.

In the SQL Editor, run this — replacing `yourcompany.mn`:

```sql
insert into public.approved_email_domains (domain, note)
values ('yourcompany.mn', 'Company domain')
on conflict (domain) do nothing;
```

> Only e-mail addresses ending in a domain on this list can ever create an
> account. This is enforced by the database, not by the app, so it cannot be
> bypassed.

### 2.5 Create the first administrator — you

Replace the name and e-mail with your own:

```sql
insert into public.app_users (email, full_name, employee_code, role)
values ('your.name@yourcompany.mn', 'Таны нэр', 'EMP-001', 'administrator');
```

> **Important:** a person must exist in this table *before* they can log in.
> That is deliberate: it means a stranger who happens to have a company
> address still cannot get in.

**Create a second administrator too.** If you are the only one and you lose
access, nobody can fix it.

### 2.6 (Optional) Load the test data

Only for a practice project — never on the real one.

Open `supabase/seed/seed.sql`, copy everything, paste into the SQL Editor and
Run. That creates 11 fictional staff, 15 clinics, 50 doctors, 10 brands and
50 products so you can click around with realistic data.

> The seed file uses `company.mn`. If you changed the domain in step 2.4, the
> seeded staff will not be able to log in — which is fine for looking at data.

### 2.7 Turn on e-mail login

1. Left sidebar → **Authentication** → **Sign In / Providers**.
2. Make sure **Email** is enabled.
3. Turn **Confirm email** ON.
4. Turn **Enable email OTP** ON if you see it (this sends a 6-digit code).
5. Under **Rate Limits**, set e-mails per hour to something modest such as 30.

> Supabase's built-in e-mail sender is limited to a handful of messages per
> hour, which is fine for testing but not for eleven people. Before real use,
> connect a proper e-mail service under **Project Settings → Authentication →
> SMTP Settings**. Ask your IT provider for the company SMTP details.

---

## Part 3 — Get the project onto your computer

In the terminal:

```
git clone https://github.com/myagmarsurennrngrl/powerbi-assets.git
cd powerbi-assets/doctor-visit-tracker
npm install
```

`npm install` downloads the building blocks the app uses. It takes a few
minutes and prints a lot of text — that is normal.

---

## Part 4 — Create the settings file

1. In the `doctor-visit-tracker` folder there is a file called `.env.example`.
2. Make a copy of it in the same folder and name the copy exactly **`.env`**
   (a dot, then `env`, with no extension).
3. Open `.env` in Notepad or TextEdit and replace each `REPLACE_ME`:

```
EXPO_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...the long key...
EXPO_PUBLIC_ALLOWED_EMAIL_DOMAINS=yourcompany.mn
EXPO_PUBLIC_APP_VERSION=0.1.0
EXPO_PUBLIC_DEBUG_LOGGING=false
```

4. Save and close.

> **Never** e-mail this file, paste it into a chat, or put it on GitHub. The
> project is already configured to keep it out of GitHub automatically.

---

## Part 5 — Run the app on your phone

1. Make sure your phone and computer are on the **same Wi-Fi network**.
2. In the terminal, inside `doctor-visit-tracker`:
   ```
   npm start
   ```
3. A square black-and-white pattern (a QR code) appears.
4. **iPhone** — open the Camera app, point it at the code, tap the banner.
   **Android** — open Expo Go, tap **Scan QR code**, point at the code.
5. The app opens. First load takes 30–60 seconds.

### If it does not work

| What you see | What to do |
|---|---|
| "Тохиргоо дутуу байна" | The `.env` file is missing or a value is wrong. The screen lists which line. Fix it, then press `r` in the terminal. |
| Nothing happens after scanning | Phone and computer are on different networks. Reconnect both to the same Wi-Fi. |
| Stuck on the loading spinner | Press `r` in the terminal to reload. |
| "Таны хаяг системд бүртгэгдээгүй байна" | You skipped step 2.5, or the e-mail does not match exactly. |

---

## Part 6 — Log in

1. Type your work e-mail. Tap **Нэвтрэх код авах**.
2. Check your e-mail for a 6-digit code (look in Spam the first time).
3. Type the code, tap **Нэвтрэх**.
4. You should land on the home screen with **Администратор** next to your name.

---

## What works right now (Phase 1)

* Logging in with an approved company e-mail
* Everything an administrator needs for reference data: users, clinics,
  doctors, brands, products
* Browsing clinics, doctors, brands (all roles)
* Location privacy screen
* Audit log (managers and administrators)

Planning, visits, GPS check-in, KPI and reports arrive in later phases. Every
screen that is not built yet says **"Хараахан хэрэгжээгүй"** so nothing looks
broken or fake.

---

## Part 7 — Add the rest of the team

As administrator, tap **Хэрэглэгч** → **Хэрэглэгч нэмэх** and fill in name,
e-mail, employee code and role for each of the 7 representatives and 3
managers. They can log in as soon as you save.

---

## Everyday commands

Run these from inside the `doctor-visit-tracker` folder.

| Command | What it does |
|---|---|
| `npm start` | Start the app for phone testing |
| `npm test` | Run the automated checks (should say 126 passed) |
| `npm run typecheck` | Check the code for mistakes |
| `npm run lint` | Check code style |

---

## Getting help

If something fails, copy **the exact error text** and send it along with:
* which step number you were on,
* whether you are on Windows or macOS,
* what you expected to happen.

A screenshot of the whole screen is more useful than a description.
