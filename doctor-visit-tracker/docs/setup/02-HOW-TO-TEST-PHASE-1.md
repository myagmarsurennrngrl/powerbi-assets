# How to test Phase 1 — a checklist you can work through

Tick each box. If one fails, note the box number and what you saw instead; that
is enough for me to fix it.

You need two things:
* the app running on your phone (see `01-SETUP-FOR-BEGINNERS.md`),
* the Supabase **SQL Editor** open in a browser tab, for the two checks that
  cannot be done from the app.

---

## A. Logging in

| # | Do this | Expect |
|---|---|---|
| A1 | Type your work e-mail, tap **Нэвтрэх код авах** | A 6-digit code arrives by e-mail |
| A2 | Type the code, tap **Нэвтрэх** | Home screen, your name, role badge |
| A3 | Type a **Gmail address** on the login screen | Red message: "Энэ и-мэйл хаягаар нэвтрэх боломжгүй…" and **no code is sent** |
| A4 | Type a made-up address on your company domain, e.g. `nobody@yourcompany.mn` | Red message: "Таны хаяг системд бүртгэгдээгүй байна…" and **no code is sent** |
| A5 | Type a deliberately wrong 6-digit code | "Код буруу эсвэл хугацаа нь дууссан байна." |
| A6 | Close the app completely and reopen it | You are still logged in — no code needed |
| A7 | Тохиргоо → **Гарах**, confirm | Back at the login screen |

> A3 and A4 are acceptance criteria 1 and 2. They are the two most important
> boxes on this page.

---

## B. What an administrator can do

Log in as an administrator.

| # | Do this | Expect |
|---|---|---|
| B1 | Look at the tab bar | Four tabs: Нүүр · Мэдээлэл · Хэрэглэгч · Тохиргоо |
| B2 | **Мэдээлэл → Эмнэлгүүд → Эмнэлэг нэмэх**, fill it in, Хадгалах | The clinic appears in the list |
| B3 | Add a clinic with the **same name and district** as an existing one | Red message: "Ийм нэртэй эмнэлэг тухайн дүүрэгт аль хэдийн бүртгэгдсэн байна." |
| B4 | Same name, **different district** | Saves — it is a branch, which is allowed |
| B5 | Open a clinic, set **Радиус** to `10`, Хадгалах | "Радиус хамгийн багадаа 30 м байна." |
| B6 | Set the radius to `400`, Хадгалах, reopen it | 400 is stored |
| B7 | Enter latitude `39.9`, longitude `116.4` (Beijing) | Orange warning that the point is outside Mongolia — it still saves, because a warning is not a block |
| B8 | **Эмч нар → Эмч нэмэх** with name and speciality | Saves |
| B9 | Add a doctor with an identical name **and** speciality | "Ийм нэр, мэргэжилтэй эмч аль хэдийн бүртгэгдсэн байна." |
| B10 | Same name, different speciality | Saves — a different person |
| B11 | In **Мэргэжлийн тэмдэглэл** type `Өвчтөн УБ12345678 ирсэн` | Refused: patient identifiers are blocked |
| B12 | **Брэнд ба бүтээгдэхүүн → Брэнд нэмэх** | Saves |
| B13 | Add a product with a SKU that already exists | "Ийм кодтой бүтээгдэхүүн аль хэдийн бүртгэгдсэн байна." |
| B14 | **Хэрэглэгч → Хэрэглэгч нэмэх** with a company e-mail | Saves; the person can now log in |
| B15 | Try to add a user with a **Gmail** address | Refused |
| B16 | Open **your own** user record and try to change your role | Refused: "Та өөрийн эрхээ өөрчлөх боломжгүй." |
| B17 | Open **someone else's** record, change their role, save | Saves |
| B18 | Тохиргоо → **Аудит бүртгэл** | Your recent changes are listed with time, action and your e-mail |

---

## C. What a representative can do — and cannot

Add a test representative in B14, then log in as that person (a second phone,
or sign out and back in).

| # | Do this | Expect |
|---|---|---|
| C1 | Look at the tab bar | Five tabs: Нүүр · Өнөөдөр · Төлөвлөгөө · Лавлах · KPI. **No** Хэрэглэгч, **no** Мэдээлэл |
| C2 | **Лавлах → Эмнэлгүүд** | All clinics are listed and readable |
| C3 | Open a clinic | Address, coordinates and radius are shown; there is no edit button anywhere |
| C4 | **Лавлах → Эмч нар**, open one | Profile and clinics are shown; visit history says "Хараахан хэрэгжээгүй" |
| C5 | **Лавлах → Брэнд** | Brands assigned to this person carry a green **Надад хуваарилагдсан** badge |
| C6 | **Нүүр** | Reference counts appear; later-phase items are clearly marked as not built |
| C7 | Тохиргоо | There is **no** Аудит бүртгэл entry |
| C8 | **Өнөөдөр**, **Төлөвлөгөө**, **KPI** | Each explains what it will do and is marked "Хараахан хэрэгжээгүй" |

---

## D. Checks that need the Supabase SQL Editor

These prove the rules hold even for somebody who bypasses the app entirely.
Paste each block into the SQL Editor and click **Run**.

### D1 — An outside e-mail cannot get an account at all

```sql
insert into auth.users (email) values ('attacker@gmail.com');
```
**Expect:** an error containing `DVT_EMAIL_DOMAIN_NOT_ALLOWED`.
If this *succeeds*, stop and tell me — that would be a serious problem.

### D2 — An unregistered company address cannot either

```sql
insert into auth.users (email) values ('ghost@yourcompany.mn');
```
**Expect:** an error containing `DVT_USER_NOT_PROVISIONED`.

### D3 — Nobody can delete audit records

```sql
delete from public.audit_logs;
```
**Expect:** an error containing `DVT_IMMUTABLE_RECORD`.

> The SQL Editor runs with full owner rights — far more power than the app ever
> has. The fact that these three still fail is the point: the rules are in the
> database itself, not in the app.

---

## E. Deactivating somebody

| # | Do this | Expect |
|---|---|---|
| E1 | As administrator, open a test user and switch **Идэвхтэй эсэх** off, save | Saved; the list shows a red **Идэвхгүй** badge |
| E2 | On that person's phone, pull to refresh or reopen the app | "Таны эрх идэвхгүй байна. Администратортай холбогдоно уу." |
| E3 | Sign them out and try to log in again | No code is sent |
| E4 | Switch them back on; log in again | Works normally |

---

## F. Robustness

| # | Do this | Expect |
|---|---|---|
| F1 | Turn on aeroplane mode, then open Лавлах → Эмнэлгүүд | A clear error with a **Дахин оролдох** button — not a blank screen or a crash |
| F2 | Turn Wi-Fi back on, tap **Дахин оролдох** | The list loads |
| F3 | Rotate the phone / use a small phone | Nothing is cut off; buttons stay large |
| F4 | Tap **Хадгалах** twice quickly on a form | Only one record is created (the button disables itself) |
| F5 | Тохиргоо → **Байршлын нууцлал** | Six plain statements about location use |
| F6 | Тохиргоо → Системийн тохиргоо | **Дуу хураах боломж: Идэвхгүй (анхдагч)** |

---

## G. The automated tests

On the computer, inside `doctor-visit-tracker`:

```
npm test
```

**Expect:** `Test Files 4 passed (4)` and `Tests 126 passed (126)`.

If you have PostgreSQL installed locally, you can also run the database tests:

```
./scripts/run-sql-tests.sh
```

**Expect:** three files passing, 100 assertions. These are the same rules as
section D, run automatically. You do **not** need this to accept Phase 1 — it
is for the developer's machine and continuous integration.

---

## Phase 1 acceptance criteria covered here

| # | Criterion | Where |
|---|---|---|
| 1 | A representative can log in with an approved work e-mail | A1, A2 |
| 2 | An unauthorised e-mail cannot log in | A3, A4, D1, D2 |
| 11 | A representative cannot change another representative's data | C3, C7 |
| 16 | Important actions appear in the audit log | B18, D3 |
| 18 | No patient information is collected | B11 |
| 19 | No continuous employee location tracking occurs | F5 |
| 20 | Audio recording remains disabled by default | F6 |

Criteria 3–10, 12–15 and 17 depend on features that arrive in Phases 2–7 and
cannot be tested yet.

---

## When you are finished

Send me:
1. any box numbers that failed, with what you saw,
2. anything in the Mongolian wording that sounds wrong or unnatural,
3. anything that felt confusing or slow.

I will not change working functionality until I hear back from you.
