# 90 — Setup Guide (for someone with no coding knowledge)

This guide assumes you have never installed a developer tool. Follow it in order.
Nothing here can break anything permanently — if a step fails, you can always start again.

**Time needed:** about 60–90 minutes for the first time.

---

## What you are building

Three things have to exist:

| Part | What it is | Where it lives |
|---|---|---|
| **The database** | The filing cabinet that stores clinics, doctors, plans and visits. It also enforces the rules. | Supabase, on the internet |
| **The phone app** | What the representatives use. | Installed on iPhones and Android phones |
| **Power BI reports** | Reads from the database. | Your computer |

You will set them up in that order.

---

## Vocabulary (only these seven words matter)

| Word | What it actually means |
|---|---|
| **Supabase** | A company that runs a database for you on the internet, so you don't need your own server. |
| **Database** | The filing cabinet. |
| **Migration** | An instruction file that builds part of the filing cabinet. Run in numbered order. |
| **Seed data** | Fake test data, so you can try the app before real data exists. |
| **Environment variable** | A setting written in a file called `.env`, kept outside the code so passwords never end up on the internet. |
| **Terminal** | A black window where you type commands. |
| **Expo Go** | A free app from the App Store / Play Store that lets you run our app on your phone without publishing it. |

---

## Part A — Install the tools (once per computer)

### A1. Install Node.js
1. Go to <https://nodejs.org>.
2. Download the version labelled **LTS**.
3. Open the downloaded file and click Next until it finishes.

Check it worked. Open Terminal (macOS: press ⌘+Space, type `Terminal`. Windows: press Start, type `PowerShell`) and type:

```
node --version
```

Press Enter. You should see something like `v22.22.2`. If you see "command not found", restart your computer and try again.

### A2. Get the project onto your computer

If someone sent you a ZIP file, unzip it. If it is on GitHub: click the green **Code** button →
**Download ZIP** → unzip.

> **Check the branch first.** On GitHub, above the file list there is a dropdown showing the
> branch name. If the work is on a branch such as `claude/doctor-visit-tracker-app-...`, select it
> **before** clicking Code → Download ZIP. Downloading from the default branch gives you a folder
> without the app in it.

**Windows: do not leave the folder inside OneDrive.** The next step creates around 40,000 small
files, and OneDrive will try to sync every one of them — a slow install, sync errors, and files
locked while you work. Move it somewhere OneDrive does not watch, for example `C:\dev\`:

```powershell
mkdir C:\dev
Move-Item "C:\Users\<you>\OneDrive - monos\Documents\<the folder>" C:\dev\
```

Nothing is at risk in doing this — the real copy is on GitHub.

**Now move into the folder in the Terminal.**

* **macOS:** type `cd ` (with a space), then drag the folder onto the Terminal window, press Enter.
* **Windows:** type `cd `, then paste the full path **in quotes**, press Enter:
  ```powershell
  cd "C:\dev\powerbi-assets-...\doctor-visit-tracker"
  ```

> **You need the inner `doctor-visit-tracker` folder, not the outer one.** The repository holds
> the app in a subfolder. If you stop at the outer folder, the next step fails with
> *"Could not read package.json"*. That error always means you are one folder too high — type
> `cd doctor-visit-tracker` and try again.

Type `dir` (Windows) or `ls` (macOS) and press Enter. You are in the right place if you see
`package.json`, `app`, `src` and `docs` listed.

### A3. Install the project's building blocks
```
npm install
```

This takes 2–5 minutes and prints a lot of text. Yellow `warn` lines are normal. It has finished
when your prompt (`PS C:\...>` or `yourname@Mac ~ %`) comes back.

Red text saying `ERR!` is not normal — send it to a developer.

#### Windows: "npm.ps1 cannot be loaded ... is not digitally signed"

This is the most common first error on Windows, and it is **not** a problem with the project.
Windows blocks PowerShell from running scripts by default, and npm is a script.

Paste this once, answer `Y`, then run `npm install` again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**What it does:** allows scripts you installed yourself (like npm) to run, while still blocking
unsigned scripts downloaded from the internet. It applies to your user account only, needs no
administrator rights, and is the setting Microsoft recommends for development machines.

To undo it later: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined`.

#### If you would rather change no settings at all

Add `.cmd` to every command — `npm.cmd install` instead of `npm install`, `npx.cmd` instead of
`npx`. This works, but you must remember it every single time, which is why the setting above is
the better answer.

---

## Part B — Create the database

### B1. Make a Supabase account
1. Go to <https://supabase.com> and click **Start your project**.
2. Sign up (free plan is fine to begin with).
3. Click **New project**.
   * **Name:** `doctor-visit-tracker`
   * **Database Password:** click Generate, then **save it in your password manager**. You cannot recover it later.
   * **Region:** choose **Northeast Asia (Seoul)** or **Southeast Asia (Singapore)** — closest to Mongolia, so the app feels faster.
4. Click **Create new project** and wait ~2 minutes.

### B2. Build the tables
1. In Supabase, click **SQL Editor** in the left menu.
2. Open the folder `supabase/migrations` on your computer.
3. Open `0001_extensions_and_enums.sql` in any text editor (Notepad / TextEdit).
4. Select all the text (Ctrl+A / ⌘+A), copy it, paste it into the Supabase SQL Editor, and click **Run**.
5. You should see **Success. No rows returned.** That is correct.
6. **Repeat for every file in number order**: 0002, 0003, 0004, 0005, 0006, 0007, 0008.

> ⚠️ The order matters. Each file depends on the one before it. If you skip one you will get an error mentioning something that "does not exist".

### B3. Add the test data
Do the same with `supabase/seed/0001_phase1_master_data.sql`.

At the end you should see a green message listing:
`7 reps, 3 managers, 1 admin, 15 clinics, 50 doctors, 85 doctor-clinic links, 10 brands, 50 products, 24 brand assignments`

### B4. Check it worked
Click **Table Editor** in the left menu. You should see tables named `clinic`, `doctor`, `brand`, `product`, `app_user` and others. Click `clinic` — you should see 15 rows.

### B5. Set your company's real email domain
The test data allows `monos.mn`. If your real domain differs:

1. **Table Editor** → `approved_email_domain`
2. Click the `monos.mn` cell and change it to your domain (just the part after the `@`, no `@` symbol).

**Only email addresses under a domain in this table can ever log in.** This is the login lock.

### B6. Create the real user accounts
For each person: **Table Editor** → `app_user` → **Insert row**, then fill in:

| Field | What to put |
|---|---|
| `email` | Their real work email |
| `full_name` | Their name as it should appear |
| `phone` | Optional |
| `role` | `representative`, `manager`, or `administrator` (exactly these words) |
| `manager_id` | For a representative: click the field and pick their manager |
| `is_active` | Leave as `true` |

Leave everything else blank — the database fills it in.

> The first time that person signs in, the system links their login to this row automatically. **If you do not create the row, they can log in but will see a message telling them to contact the administrator, and no data.** That is deliberate.

---

## Part C — Connect the app to your database

### C1. Copy your two keys
In Supabase: **Project Settings** (gear icon) → **API**. You need:
* **Project URL** — looks like `https://abcdefgh.supabase.co`
* **anon public** key — a very long string

> ⚠️ There is also a **service_role** key on that page. **Never** put it in the app or send it to anyone. It ignores all security rules. The app refuses to start if it detects one.

### C2. Create the `.env` file
1. In the project folder, find `.env.example`.
2. Make a copy of it in the same folder.
3. Rename the copy to exactly `.env` (no `.txt`, nothing before the dot).
4. Open `.env` and replace the two placeholder values with your Project URL and anon key.

It should end up looking like:
```
EXPO_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...(very long)...
```

Save and close. **Never email this file or put it on GitHub.** The project already blocks it from being uploaded.

---

## Part D — Run the app on a phone

### D1. Install Expo Go on the phone
* iPhone: App Store → search **Expo Go**
* Android: Play Store → search **Expo Go**

The phone and the computer **must be on the same Wi-Fi**.

### D2. Start the app
In the Terminal, in the project folder:
```
npm start
```
A large QR code appears.

### D3. Open it
* **iPhone:** open the Camera app, point it at the QR code, tap the notification.
* **Android:** open Expo Go, tap **Scan QR code**, point it at the code.

The app opens on the phone. To stop it, click the Terminal and press **Ctrl + C**.

### D4. Log in
1. Type a work email that exists in `app_user`.
2. Tap **Код авах**.
3. Check that inbox for a 6-digit code (check spam).
4. Type the code and tap **Нэвтрэх**.

> **Free-tier email limit:** Supabase's built-in email sender is limited to a few messages per hour and is meant for testing only. Before real use, connect your company email server: **Authentication → Emails → SMTP Settings**. This is listed in `docs/95-known-limitations.md`.

---

## Part E — Prove the security actually works

Do these two checks yourself. They are the whole point of the project.

**Check 1 — an outside email cannot get in**
Log out. Try to log in with a personal Gmail address.
✅ Expected: *«Энэ и-мэйл хаягаар нэвтрэх боломжгүй...»* and no code is ever sent.

**Check 2 — a representative cannot change master data**
Log in as a representative. Open Эмнэлгүүд → any clinic.
✅ Expected: you can read everything, and there is no edit button anywhere.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `command not found: npm` | Node.js is not installed | Redo step A1, then restart the computer |
| `Аппын тохиргоо дутуу байна` | The app cannot find `.env` | Check the file is named exactly `.env` and sits next to `package.json` |
| `relation "..." does not exist` in Supabase | A migration was skipped or run out of order | Re-run the migrations from 0001 in order |
| No code arrives by email | Supabase's test email limit, or spam folder | Wait an hour, or set up SMTP (Part D3 note) |
| «Таны бүртгэл идэвхжээгүй байна» | Login worked, but no `app_user` row | Do step B6 for that person |
| App shows no clinics at all | Seed not loaded, or user not provisioned | Check B3 and B6 |

---

## What to do next

* Read `docs/91-manual-representative.md` before training the seven representatives.
* Read `docs/92-manual-administrator.md` before entering real clinics and doctors.
* **Back up before entering real data** — `docs/94-backup-and-recovery.md`.
