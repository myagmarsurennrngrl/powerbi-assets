# 94 — Backup and Recovery

What to turn on before the first real visit is recorded, and what to do on the day something
goes wrong.

**Written to be usable under pressure.** §5 is the part to read now, while nothing is broken.

---

## 1. What has to survive

| Data | Where | If lost |
|---|---|---|
| Visits, reports, evidence | Supabase PostgreSQL | Unrecoverable. This is the record of work done |
| Audit log | Supabase PostgreSQL | Compliance record; unrecoverable |
| Clinics, doctors, brands, users | Supabase PostgreSQL | Re-enterable, but days of work |
| Queued items on a phone | The phone's SQLite | Lost with the phone — see §7 |
| The app itself | Git | Rebuildable from source |

Everything that matters is in one PostgreSQL database. That makes this document short and makes
getting it right important.

---

## 2. Turn this on before real data exists

Supabase → **Project Settings → Database → Backups**.

| Setting | Value | Why |
|---|---|---|
| Daily backups | On | Included on all paid plans |
| **Point-in-time recovery (PITR)** | **On** | Restore to any second, not just last midnight |
| Retention | 7 days minimum, 30 preferred | A mistake is often noticed a week later |

**PITR is the one that matters.** A daily backup means a bad afternoon costs up to 24 hours of
visits. PITR means it costs the minutes between the mistake and noticing it.

PITR requires a paid plan. For a company recording its field force's work, the cost is not the
consideration.

- [ ] Daily backups on
- [ ] PITR on
- [ ] Retention set
- [ ] Enabled **before** the first real visit

---

## 3. A backup you can hold

Supabase's backups live in Supabase. If the account is lost, suspended, or the project is deleted
by mistake, they go with it. Take a copy the company controls.

**Monthly**, from a machine with the database password:

```bash
pg_dump \
  --host=db.<project-ref>.supabase.co \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --format=custom \
  --file=dvt-$(date +%Y-%m-%d).dump
```

- [ ] Stored somewhere the Supabase account cannot reach — company file server or a different
      cloud account
- [ ] Encrypted at rest, or on storage that is
- [ ] Access limited to the two administrators
- [ ] **Restored once**, to prove the file is not empty (see §5)

> This dump contains every doctor's name and every representative's movements. Treat the file the
> way you would treat a payroll export.

---

## 4. What is *not* backed up

**Queued items on a phone.** If a representative writes six reports offline and then loses the
phone, those six are gone. Nothing else can be true — they never reached a server.

Mitigations, all of them partial:

* the app syncs automatically the moment a connection returns;
* the sync screen shows exactly what is still waiting;
* signing out warns before discarding a non-empty queue;
* representatives are told to check **Синк төлөв** at the end of each day.

**The `.env` file.** Not in git, by design. Keep the two values in the password manager.

---

## 5. Rehearse the restore — do this once, now

An untested backup is a belief, not a backup. Book an hour.

1. Supabase → **New project**, call it `dvt-restore-test`.
2. Restore the most recent backup into it, or `pg_restore` the dump from §3:
   ```bash
   pg_restore --host=db.<restore-test-ref>.supabase.co --username=postgres \
              --dbname=postgres --no-owner --clean dvt-2026-07-01.dump
   ```
3. Check it is real:
   ```sql
   SELECT count(*) FROM public.visit;
   SELECT max(visit_date) FROM public.visit;
   SELECT count(*) FROM public.audit_log;
   SELECT * FROM public.fn_security_findings();   -- still zero rows
   ```
4. Point a development build at it and sign in. If the app works, the backup works.
5. **Delete the test project.** It contains a full copy of real data.

- [ ] Rehearsed on: ____________  by: ____________
- [ ] Time it actually took: ____________

Write the time down. "How long until we are back?" is the first question you will be asked, and
the answer should not be a guess.

---

## 6. When something goes wrong

### 6.1 Stop first

The instinct is to fix it. Resist for sixty seconds:

1. **Write down the time** the problem started, as precisely as you can. PITR restores to a
   moment; the moment is the thing you need.
2. **Do not delete anything.** A wrong row is recoverable; a deleted one after a second mistake
   may not be.
3. **Tell the representatives to keep working.** The app queues offline. Work done during an
   outage is not lost as long as they do not sign out.

### 6.2 Choose the response

| What happened | Do this |
|---|---|
| Someone edited a few master-data rows wrongly | Fix them in the app. Everything is audited; the audit log shows the old values |
| A user was deactivated by mistake | Reactivate in the app. Nothing was deleted |
| A migration went wrong, no data lost | Write a corrective forward migration |
| A migration destroyed or corrupted data | **PITR to the moment before it ran** — §6.3 |
| Data deleted or corrupted, cause unknown | **PITR to before it started** — §6.3 |
| The whole project is gone | Restore the §3 dump into a new project |

### 6.3 Point-in-time recovery

Supabase → **Database → Backups → Point in time**. Choose the timestamp from §6.1 and restore.

**Understand what this costs before pressing it.** PITR restores the entire database to that
moment. Everything recorded *after* it — including good work by people who had nothing to do with
the problem — is gone.

So:

1. Take a `pg_dump` of the current, broken state first. It is the only copy of the work you are
   about to discard, and some of it may be re-enterable by hand.
2. Restore.
3. Tell everyone which period was lost, precisely. A representative who knows Tuesday afternoon
   was rolled back can re-enter three visits. One who is not told will assume the system ate
   their work at random, and that is the end of their trust in it.
4. Ask representatives to check **Синк төлөв** — anything still queued on a phone will sync into
   the restored database by itself.

---

## 7. Recovering a phone

**Phone lost or stolen**
1. Deactivate the account **today** (Хэрэглэгчийн удирдлага). Their session stops working.
2. Anything queued on that phone is lost. Ask what they had been working on since their last
   sync.
3. Create nothing new — reactivate the same account on the replacement phone.

**Phone replaced normally**
1. **Before handing over the old one:** open **Синк төлөв** and make sure the queue is empty.
2. Install the app on the new phone, sign in with the same work email. Everything is on the
   server.
3. Wipe the old phone.

---

## 8. Ownership

| | Who |
|---|---|
| Backups are on and working | |
| Monthly `pg_dump` is taken and stored | |
| The restore rehearsal is repeated yearly | |
| Decides to invoke PITR | |

Fill these in with names. A backup nobody owns is a backup nobody checks.

---

## 9. Monthly

1. Supabase → Backups — is the most recent one from last night?
2. Is PITR still on? *(It switches off if a project is downgraded)*
3. Take the `pg_dump` and store it
4. Once a year: repeat §5 in full
