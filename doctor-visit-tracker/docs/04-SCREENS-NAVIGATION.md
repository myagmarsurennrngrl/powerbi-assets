# 04 — Screen List and Navigation Flow

23 screens. Mongolian titles are the ones the user sees; the English name and the
route are for developers.

---

## 1. Screen inventory

| # | Mongolian title (in app) | English | Route | Roles | Offline |
|---|---|---|---|:--:|:--:|
| 1 | Нэвтрэх | Login | `/(auth)/login` → `/(auth)/verify` | all | ❌ needs internet |
| 2 | Нүүр | Home dashboard | `/(app)/home` | all (content differs) | ✅ cached |
| 3 | Өнөөдрийн маршрут | Today's route | `/(app)/today` | rep | ✅ full |
| 4 | Долоо хоногийн хуанли | Weekly calendar | `/(app)/plan` | rep, manager | ✅ read |
| 5 | Төлөвлөгөө боловсруулах | Weekly plan builder | `/(app)/plan/builder/[weekId]` | rep | ✅ draft only |
| 6 | Уулзалтын дэлгэрэнгүй | Visit detail | `/(app)/visit/[id]` | owner, manager, admin | ✅ read |
| 7 | Уулзалт эхлүүлэх | Start visit confirmation | `/(app)/visit/[id]/start` | owner rep | ✅ full |
| 8 | Идэвхтэй уулзалт | Active visit | `/(app)/visit/[id]/active` | owner rep | ✅ full |
| 9 | Уулзалтын тайлан | Complete visit form | `/(app)/visit/[id]/complete` | owner rep | ✅ full |
| 10 | Онцгой тохиолдол илгээх | Exception request | `/(app)/visit/[id]/exception` | owner rep | ✅ queued |
| 11 | Эмнэлгүүд | Clinics | `/(app)/clinics` | all | ✅ read |
| 12 | Эмнэлгийн дэлгэрэнгүй | Clinic detail | `/(app)/clinics/[id]` | all | ✅ read |
| 13 | Эмч нар | Doctors | `/(app)/doctors` | all | ✅ read |
| 14 | Эмчийн түүх | Doctor profile & visit history | `/(app)/doctors/[id]` | all | ✅ recent only |
| 15 | Брэнд ба бүтээгдэхүүн | Brands and products | `/(app)/brands` | all | ✅ read |
| 16 | Миний KPI | Representative KPI | `/(app)/kpi` | rep (own), manager, admin | ✅ last value |
| 17 | Менежерийн самбар | Manager dashboard | `/(app)/manager` | manager, admin | ❌ live data |
| 18 | Онцгой тохиолдол батлах | Exception approval | `/(app)/manager/exceptions` | manager | ❌ live data |
| 19 | Хэрэглэгчийн удирдлага | User management | `/(app)/admin/users` | admin | ❌ |
| 20 | Үндсэн мэдээлэл | Master data management | `/(app)/admin/master-data` | admin | ❌ |
| 21 | Тохиргоо | Settings | `/(app)/settings` | all | ✅ |
| 22 | Синк төлөв | Sync status | `/(app)/settings/sync` | all | ✅ |
| 23 | Аудит бүртгэл | Audit log | `/(app)/audit` | manager, admin | ❌ |

---

## 2. Navigation shape

Bottom tabs differ by role. Everything else is pushed on top of a tab.

### Representative — 5 tabs
```
[ Нүүр ]  [ Өнөөдөр ]  [ Төлөвлөгөө ]  [ Лавлах ]  [ Миний KPI ]
   #2         #3            #4             ▼            #16
                                     Эмнэлгүүд #11
                                     Эмч нар    #13
                                     Брэнд      #15
```

### Manager — 5 tabs
```
[ Нүүр ]  [ Самбар ]  [ Онцгой ]  [ Лавлах ]  [ Тайлан ]
   #2        #17         #18          ▼          #16/#23
```

### Administrator — 4 tabs
```
[ Нүүр ]  [ Үндсэн мэдээлэл ]  [ Хэрэглэгч ]  [ Тохиргоо ]
   #2            #20                #19            #21
```

Settings (#21) and Sync status (#22) are reachable from the header icon on every
tab for every role.

---

## 3. The critical flow — one visit, start to finish

```
 #3 Өнөөдрийн маршрут
   │  card shows: order · clinic · doctors · address · distance · brands · status
   │
   ├── [Газрын зураг] ──────────► opens Google/Apple Maps with the clinic pin
   │
   ├── [Онцгой тохиолдол] ─────► #10 exception request ──► queued/sent ──► back
   │
   └── [Уулзалт эхлүүлэх] ─────► #7 Start visit confirmation
                                    │
                                    │ app asks for location ONCE
                                    │ computes Haversine distance
                                    │
                          ┌─────────┴──────────┐
                          │                    │
                 inside radius            outside radius
                 accuracy OK              or accuracy poor
                          │                    │
                          ▼                    ▼
                  [Баталгаажуулах]      button DISABLED
                          │              shows: "Та эмнэлгээс 412 м зайд байна.
                          │                      Зөвшөөрөгдөх зай: 150 м"
                          │              only option ▼
                          │              [Онцгой тохиолдол илгээх] → #10
                          ▼
                  rpc_start_visit()  ← server re-checks everything
                          │
                          ▼
                  #8 Идэвхтэй уулзалт
                     · timer running (server start time)
                     · doctor list, planned brands
                     · [Түр хадгалах] draft
                     · [Уулзалт дуусгах]
                          │
                          ▼
                  #9 Уулзалтын тайлан  (structured form)
                     · validation shows missing fields in Mongolian
                          │
                          ▼
                  location requested ONCE again (check-out)
                          │
                          ▼
                  rpc_complete_visit()
                          │
                          ▼
                  Success screen → back to #3, card now "Дууссан 🟢"
```

---

## 4. Authentication flow

```
App opens
   │
   ├─ session in SecureStore? ──yes──► role known? ──► route to role tabs
   │                                        │
   │                                        no ──► /(auth)/pending  (account
   │                                                not provisioned yet)
   └─ no session
          ▼
   #1a Нэвтрэх  — e-mail field only
          │  client-side hint: domain not in the allowed list → inline message
          │  (real enforcement is server-side)
          ▼
   requestOtp(email)
          ▼
   #1b Баталгаажуулах — 6-digit code, 10-minute countdown, "Дахин илгээх" after 60 s
          ▼
   verifyOtp → session → load app_user row
          │
          ├─ no app_users row / is_active = false
          │      ▼  sign out + "Таны хаяг идэвхгүй байна. Админд хандана уу."
          │
          └─ ok → audit_logs('login') → role tabs
```

---

## 5. Screen-by-screen content

### #2 Нүүр (Home dashboard)

**Representative**
| Card | Content |
|---|---|
| Өнөөдрийн уулзалт | planned count today |
| Дууссан | completed today |
| Үлдсэн | remaining today |
| Энэ долоо хоногийн KPI | % with a progress bar |
| Хүлээгдэж буй дараагийн алхам | open follow-ups, overdue in red |
| Синк | count of pending/failed records, tap → #22 |

**Manager**
| Card | Content |
|---|---|
| Багийн KPI | team completion % this week |
| Төлөөлөгчдийн эрэмбэ | reps ranked by completion |
| Биелээгүй уулзалт | missed visits this week |
| Хүлээгдэж буй хүсэлт | pending exceptions (badge) |
| Анхаарах уулзалт | visits started outside expected conditions (outside radius, poor accuracy, big clock skew, offline late submission) |
| Хамрагдаагүй эмнэлэг | clinics with no visit in N days |
| Хамрагдаагүй эмч | doctors with no visit in N days |
| Брэндийн идэвх | visits per brand |
| Сүүлийн уулзалтууд | map with check-in pins (last 7 days) |

**Administrator**: system health — user count by role, inactive users, clinics
missing coordinates, duplicate candidates, last master-data import, feature flags.

### #3 Өнөөдрийн маршрут — the most important screen
Sorted by `visit_order`. Each card:
```
┌────────────────────────────────────────────┐
│ 1️⃣  Улаанбаатар Арьс Судлалын Төв          │
│     Д.Оюунчимэг, Б.Ганбат                  │
│     ХУД, 3-р хороо, Их сургуулийн гудамж 5 │
│     📍 320 м зайд                          │
│     🏷 Brand A · Brand B                    │
│     Төлөв: Төлөвлөсөн   🟢 Синк хийгдсэн   │
│  ┌──────────┐ ┌──────────────┐ ┌─────────┐ │
│  │ Газрын   │ │  Уулзалт     │ │ Онцгой  │ │
│  │  зураг   │ │  эхлүүлэх    │ │ тохиолдол│ │
│  └──────────┘ └──────────────┘ └─────────┘ │
└────────────────────────────────────────────┘
```
Minimum touch target 48×48 dp; the primary button is full-width and coloured.

### #5 Төлөвлөгөө боловсруулах (plan builder)
Wizard, one decision per step to minimise typing:
1. Долоо хоног сонгох (week picker, defaults to next week)
2. Өдөр сонгох (chips Mon–Sat)
3. For each day: эмнэлэг сонгох (searchable list, recent first)
4. Эмч сонгох (only doctors linked to that clinic)
5. Брэнд/бүтээгдэхүүн (only brands assigned to this representative)
6. Зорилго (short text or a preset chip)
7. Цаг (time wheel, 24-hour) and drag-to-reorder
8. [Ноорог хадгалах] / [Илгээх]

Duplicate detection runs before saving and shows:
"Энэ эмчтэй тухайн өдөр төлөвлөгөө аль хэдийн үүссэн байна."

### #14 Эмчийн түүх (doctor profile & history)
Header: name, speciality, clinics, contact (if present).
Filters: огноо / брэнд / төлөөлөгч / эмнэлэг / үр дүн.
Timeline of **submitted** visits only, each showing date, representative, brands,
products, outcome, feedback, follow-up, and any addenda indented below with
"Албан ёсны нэмэлт — <author>, <date>".
Read-only for everyone; managers/admins see an [Нэмэлт тайлбар оруулах] button.

### #22 Синк төлөв
Three sections: Хүлээгдэж буй / Амжилтгүй / Сүүлд амжилттай.
Each failed row shows the Mongolian error reason and a [Дахин оролдох] button.
Header shows connectivity: 🟢 Онлайн / 🔴 Офлайн.

---

## 6. Shared UI states (every data screen implements all four)

| State | Mongolian |
|---|---|
| Loading | skeleton + "Ачааллаж байна…" |
| Empty | icon + "Мэдээлэл алга" + what to do next |
| Error | "Алдаа гарлаа" + reason + [Дахин оролдох] |
| Offline | orange banner "Офлайн горим — хадгалсан мэдээлэл харагдаж байна" |

Destructive actions (delete draft, cancel visit, deactivate user) always open a
confirmation sheet with the consequence spelled out. Submit buttons disable
themselves for the duration of the request to prevent double submission.

---

## 7. Design tokens

| Token | Value | Use |
|---|---|---|
| Primary | `#1B5E9B` | primary buttons, active tab |
| Success | `#137A4B` | completed, synced |
| Warning | `#B45309` | pending sync, exception pending |
| Danger | `#B3261E` | missed, failed sync, destructive |
| Neutral text | `#1A1C1E` | body |
| Muted text | `#5A5F66` | secondary |
| Surface | `#FFFFFF` / `#F5F7FA` | cards / background |
| Body text | 16 sp min | outdoor readability |
| Title | 20–24 sp bold | |
| Touch target | ≥ 48 dp | glove/one-hand use |
| Radius | 12 dp | cards and buttons |

Status colours are always paired with a text label and an icon, never colour
alone (accessibility, and sunlight makes colours hard to distinguish).
