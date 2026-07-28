# 81 — Testing on Real Phones (iOS and Android)

Everything that matters about this app — GPS accuracy, geofences, losing signal in a basement —
can only be judged on a real handset. This document is how to get it onto one.

---

## 1. Which method to use

| Method | Effort | Use it for |
|---|---|---|
| **Expo Go** | minutes | Day-to-day development, and the first look for a manager |
| **Development build** | an hour, once | Anything involving native modules or a realistic install |
| **Internal distribution** | half a day | Giving all seven representatives a build to trial |
| **App Store / Play Store** | days, plus review | Only if the company decides to distribute publicly |

For an internal app used by eleven people, **internal distribution is the destination**. The
stores are not needed and add review delays for no benefit. See
[`82-production-deployment.md`](82-production-deployment.md).

---

## 2. Expo Go — the quick path

On your machine:

```bash
npm start
```

On the phone:

1. Install **Expo Go** from the App Store or Play Store.
2. **Android:** open Expo Go, scan the QR code in the terminal.
   **iOS:** open the Camera app, point it at the QR code, tap the banner.
3. The phone and the computer must be on the **same Wi-Fi network**. If the office network
   isolates clients from each other, run `npx expo start --tunnel` instead — slower, but it works
   from anywhere.

### What does not work in Expo Go
Nothing important for this project, as it happens: location, secure storage and SQLite all work.
What you *cannot* test is the app's own icon, its splash screen, and how the OS presents its
permission prompts under the real app name. Those need a development build.

---

## 3. Development build

Needed once you want the app installed under its own name, or when a native module is added.

```bash
npm install -g eas-cli
eas login
eas build:configure

eas build --profile development --platform android   # produces an .apk
eas build --profile development --platform ios       # needs an Apple Developer account
```

Android is much easier: the build produces an `.apk` you can email or put on a link, and the
phone installs it after allowing "install from unknown sources".

iOS requires a paid Apple Developer account (US$99/year) and the device's UDID registered before
the build. There is no way around this — Apple does not permit installing an unsigned app.

---

## 4. The test script — run this on a real phone before trusting anything

### 4.1 Login
| # | Do this | Expected |
|---|---|---|
| 1 | Enter a personal address, e.g. `you@gmail.com` | Refused with a clear Mongolian message, before any code is sent |
| 2 | Enter your work address | A six-digit code arrives by email |
| 3 | Enter a wrong code | Refused, and you can try again |
| 4 | Enter the right code | The home screen, greeting you by name |
| 5 | Force-quit the app and reopen it | Still signed in |

### 4.2 Location and permissions
| # | Do this | Expected |
|---|---|---|
| 6 | On **Өнөөдөр**, tap **Зайг харах** | The permission prompt, asking for "while using the app" |
| 7 | Refuse it | A message explaining what to do — not a crash and not a blank screen |
| 8 | Allow it | Distances appear next to each clinic |
| 9 | Check the OS's own location settings | The app must appear as "While Using", never "Always" |
| 10 | Leave the app open for ten minutes without touching it, then check battery usage | Negligible. There is no watcher; if this is not true, something is wrong |

### 4.3 A real visit — do this at an actual clinic
This is the test that cannot be faked at a desk.

| # | Do this | Expected |
|---|---|---|
| 11 | Standing outside, some distance away, open a visit and tap **Уулзалт эхлүүлэх** | Refused, showing your distance and the allowed radius |
| 12 | Tap **Чөлөөлөх хүсэлт** from there | The exception form, with the measured distance attached |
| 13 | Walk to the clinic door and tap **Дахин шалгах** | All conditions turn green |
| 14 | Start the visit | The timer begins |
| 15 | Go inside, where signal is usually poor | The timer keeps running; it counts from the server's start time |
| 16 | Write the report while inside | Saves. If there is no signal it says «Утсанд хадгаллаа» |
| 17 | Come out and finish the visit | Check-out succeeds |
| 18 | Compare the duration with your watch | They must agree |

**Step 11 is the important one.** If a representative standing at the door is refused, the
clinic's coordinates or radius are wrong in the master data — not the app. Fix it in
**Мастер дата** and note it down.

### 4.4 Offline
| # | Do this | Expected |
|---|---|---|
| 19 | Turn on flight mode | An orange bar appears at the top of the app |
| 20 | Open **Өнөөдөр** | Today's route still shows, labelled with when it was last updated |
| 21 | Write a visit report | Saves, and says it is stored on the phone |
| 22 | Submit it | Told it is queued, **not** that it was submitted |
| 23 | Open **Синк төлөв** | The queued items are listed |
| 24 | Try to start a visit | Refused, with the reason: check-in needs a connection because the server measures it |
| 25 | Turn flight mode off and wait ~10 seconds | The queue empties by itself; the bar disappears |
| 26 | Check the report on the doctor's history | It is there |

### 4.5 Things that must be absent
| # | Check | Expected |
|---|---|---|
| 27 | Search every screen for a microphone or record button | There is none |
| 28 | **Тохиргоо → Нууцлал** | States plainly that audio recording does not exist |
| 29 | Any field anywhere asking about a patient | There is none |
| 30 | The OS permission list for the app | Location only. No microphone, no contacts, no background location |

---

## 5. Testing with more than one person

The interesting bugs are between roles, not within one. Sign in on two phones — one
representative, one manager — and:

* the representative submits a plan; the manager sees it appear;
* the representative requests an exception; the manager approves it; the representative's KPI
  changes;
* the manager adds a visit to the representative's plan; it appears on their route;
* the representative tries to open the manager's dashboard — it must not be reachable at all.

---

## 6. Reading a crash

Shake the phone in Expo Go to open the developer menu, or run `npx expo start` and watch the
terminal — errors print there with a stack trace.

A red screen with a Mongolian sentence is **not** a crash. It is the app telling you the database
refused something, which is usually correct behaviour. Read the sentence before reporting it.

---

## 7. Before saying "it works"

- [ ] Tested on both an iPhone and an Android handset — the two behave differently around
      location permissions
- [ ] Tested at a real clinic, not at a desk
- [ ] Tested in flight mode
- [ ] Tested with a second person signed in as a manager
- [ ] Battery usage after an hour of normal use is unremarkable
- [ ] Every message you saw was in Mongolian
