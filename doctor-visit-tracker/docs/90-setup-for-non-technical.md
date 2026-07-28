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
* **Windows (PowerShell):** type `cd `, then paste the full path **in quotes**, press Enter:
  ```powershell
  cd "C:\dev\powerbi-assets-...\doctor-visit-tracker"
  ```
* **Windows (Command Prompt):** the same, but with `/d` so it can change drive:
  ```
  cd /d "C:\dev\powerbi-assets-...\doctor-visit-tracker"
  ```
  If npm gives you a "not digitally signed" error later, Command Prompt is the window you want —
  see A3.

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

The most common first error on Windows, and **not** a problem with the project. PowerShell blocks
scripts by default, and npm is a script.

**Use Command Prompt instead of PowerShell.** This restriction applies only to PowerShell, so the
simplest answer is to use a window where it does not exist. Everything in this guide works there
unchanged.

> **They are two different programs that look almost identical.** Tell them apart by the prompt:
>
> | | Prompt looks like |
> |---|---|
> | PowerShell | `PS C:\Users\you>` — starts with **`PS`** |
> | Command Prompt | `C:\Users\you>` — no `PS` |
>
> Commands are not interchangeable. `cd /d` works only in Command Prompt; PowerShell answers
> *"A positional parameter cannot be found"*. Pick one window and stay in it.

1. Press **Windows key + R**, type `cmd`, press Enter.
2. Check the prompt has no `PS` in front of it.
3. Move into the folder — `/d` lets it change drive:
   ```
   cd /d "C:\dev\powerbi-assets-...\doctor-visit-tracker"
   ```
4. `npm install`

Use Command Prompt for the rest of the setup.

##### Why not just change the PowerShell setting?

You may see this advice elsewhere:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**On a company laptop it usually does nothing.** Execution policy has five levels, and the two set
centrally by IT (`MachinePolicy` and `UserPolicy`) outrank anything you set for yourself. The
command is accepted without an error and then ignored — which is more confusing than the original
problem. Check with:

```powershell
Get-ExecutionPolicy -List
```

If `MachinePolicy` or `UserPolicy` is anything other than `Undefined`, that is your IT department's
setting and you cannot override it. Use Command Prompt.

On a personal machine, where those two are `Undefined`, the command does work and is safe: it
allows scripts you installed yourself to run while still blocking unsigned ones from the internet,
for your account only, with no administrator rights. Undo it with
`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined`.

##### Staying in PowerShell anyway

Add `.cmd` to `npm` and `npx` every time — `npm.cmd install`, `npx.cmd expo start`. This always
works, because `.cmd` files are not PowerShell scripts. Remember also that PowerShell's `cd` takes
no `/d`:

```powershell
cd "C:\dev\powerbi-assets-...\doctor-visit-tracker"
npm.cmd install
```

You have to remember `.cmd` on every command for the rest of the setup, which is why Command
Prompt is the easier route.

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

There are **25 migration files**, and they must all run, in number order.

#### The easy way (recommended)

One command does all 25, in order, and stops if anything fails. In your Terminal, in the
`doctor-visit-tracker` folder:

```
npx.cmd supabase login
npx.cmd supabase link --project-ref <your-project-ref>
npx.cmd supabase db push
```

*(macOS, or Windows Command Prompt: drop the `.cmd` — just `npx supabase ...`)*

Your **project ref** is the code in your Supabase address bar:
`https://supabase.com/dashboard/project/`**`abcdefghijklm`**. It will ask for the database
password you saved in B1.

This is worth the three commands. Pasting 25 files by hand is where this step goes wrong.

#### The manual way

If you would rather not install anything:

1. In Supabase, click **SQL Editor** in the left menu.
2. Open the folder `supabase/migrations` on your computer.
3. Open `0001_extensions_and_enums.sql` in any text editor (Notepad / TextEdit).
4. Select all the text (Ctrl+A / ⌘+A), copy it, paste it into the Supabase SQL Editor, click **Run**.
5. You should see **Success. No rows returned.** That is correct.
6. **Repeat for all 25 files in number order** — 0002, 0003, 0004 … through to 0025. Do not skip
   any, and do not change the order.

> ⚠️ **Three ways this goes wrong, all of which produce the same confusing error later:**
>
> * **Skipping a file.** Each depends on the ones before it.
> * **Text left selected in the SQL editor.** It then runs only the selection, not the whole file.
>   Click once in the editor before pressing Run so nothing is highlighted.
> * **A partial paste.** Some of these files are long. Check the last line you pasted matches the
>   last line of the file.
>
> The symptom is always the same: an error several files later saying something
> *"does not exist"* — pointing at the wrong file.

### B2b. Check every migration landed

Whatever route you took, verify it. Paste **`supabase/check-migrations.sql`** into the SQL editor
and run it.

You get one row per migration with ✅ or ❌, and a final line telling you exactly what to run
next. It reads nothing and changes nothing, so it is safe to run at any time.

```
 status     | #  | migration                   | purpose
 ✅         |  9 | 0009_planning_tables        | Weekly plans and planned visits
 ❌ MISSING | 10 | 0010_planning_logic         | Plan deadline and status machine
 ...
 Run this file next: supabase/migrations/0010_planning_logic.sql
```

Keep running the named file and re-checking until all 25 show ✅.

### B3. Add the test data

Three seed files, in order, the same way:

1. `supabase/seed/0001_phase1_master_data.sql` — clinics, doctors, brands, staff
2. `supabase/seed/0002_phase2_weekly_plans.sql` — example weekly plans
3. `supabase/seed/0003_phase3_visits.sql` — example completed visits, so the KPI screens have
   something to show

After the first one you should see a green message listing:
`7 reps, 3 managers, 1 admin, 15 clinics, 50 doctors, 85 doctor-clinic links, 10 brands, 50 products, 24 brand assignments`

> **This is fictional test data.** Never apply the seed files to the real production project — see
> `docs/82-production-deployment.md`.

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

Use the **Copy** button next to each value. Typing them by hand will not work.

> ### ⚠️ The third key on that page — read this
>
> There is also a **service_role** `secret` key. **Never** put it in the app, in `.env`, or in a
> message to anyone.
>
> It ignores every security rule in this project. If it reaches the app, then anyone who installs
> the app can read every doctor, every visit and every employee's movements, and can delete all of
> it. All 25 migrations' worth of protection becomes decoration.
>
> The app checks the key at startup and refuses to run if it finds a `service_role` one — but do
> not test that. Copy only the row labelled **anon** `public`.

### C2. Create the `.env` file

The `.env` file is how the app learns **which** database to talk to. Two lines: an address and a
key. It stays on your computer and is never uploaded — which is the whole reason the key does not
live in the code.

> **Windows: do not try this in File Explorer.** Explorer refuses to create a file whose name
> starts with a dot ("You must type a file name"), and it *hides* file extensions — so a file that
> looks like `.env` may really be `.env.txt`, and the app will not find it. Nothing on screen tells
> you. Use the Terminal instead; it takes three commands.

#### Windows (PowerShell or Command Prompt)

```powershell
cd "C:\dev\powerbi-assets-...\doctor-visit-tracker"
Copy-Item .env.example .env
notepad .env
```

*(Command Prompt: `copy .env.example .env` and `notepad .env`.)*

#### macOS / Linux

```bash
cd ~/path/to/doctor-visit-tracker
cp .env.example .env
open -e .env          # or: nano .env
```

#### Then fill in the two values

Find these two lines and replace the placeholders with what you copied in C1:

```
EXPO_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...(very long)...
```

Leave every other line alone. Then save and close.

**Four things that quietly break it:**

| Correct | Wrong |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL=https://...` | `EXPO_PUBLIC_SUPABASE_URL = https://...` — no spaces around `=` |
| `...ANON_KEY=eyJhbG...` | `...ANON_KEY="eyJhbG..."` — no quotation marks |
| The key on one unbroken line | The key wrapped onto two lines |
| Nothing after the value | A stray space at the end of the line |

Always use the **Copy** button in Supabase. Typing these by hand does not work.

#### Check it before moving on

```powershell
Get-Content .env | Select-String "EXPO_PUBLIC"     # Windows
grep EXPO_PUBLIC .env                              # macOS / Linux
```

Two lines, with your real values. If you still see `your-project-ref` or `paste-your`, the file
was not saved.

Confirm the name is right — this is the `.env.txt` trap:

```powershell
Get-ChildItem -Force -Filter ".env*" | Select-Object Name    # Windows
ls -a | grep env                                             # macOS / Linux
```

You want exactly `.env` and `.env.example`. If you see `.env.txt`, rename it:

```powershell
Move-Item .env.txt .env -Force
```

**Never email this file or put it on GitHub.** `.gitignore` already blocks it from being uploaded.

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
| `... does not exist` in Supabase | A migration was skipped, or only part of one ran | Run `supabase/check-migrations.sql` — it names the exact file to run next |
| No code arrives by email | Supabase's test email limit, or spam folder | Wait an hour, or set up SMTP (Part D3 note) |
| «Таны бүртгэл идэвхжээгүй байна» | Login worked, but no `app_user` row | Do step B6 for that person |
| App shows no clinics at all | Seed not loaded, or user not provisioned | Check B3 and B6 |

---

## What to do next

* Read `docs/91-manual-representative.md` before training the seven representatives.
* Read `docs/92-manual-administrator.md` before entering real clinics and doctors.
* **Back up before entering real data** — `docs/94-backup-and-recovery.md`.
