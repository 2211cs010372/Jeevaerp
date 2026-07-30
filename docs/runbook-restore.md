# Runbook: backup and restore

The hospital's records live in one Postgres database. This is what protects them
and what to do when something goes wrong.

An untested backup is not a backup. The only line in this document that matters
is the RTO at the bottom, and it stays empty until somebody actually restores.

---

## Two different disasters, two different protections

They are not interchangeable. You need both.

| Disaster | What saves you | Who owns it |
|---|---|---|
| Someone deleted or corrupted rows at 4 PM | Supabase point-in-time recovery | Supabase, once enabled |
| The project, account or provider is gone | The independent dump from `npm run backup` | You |

Point-in-time recovery rewinds the live database to a moment before the mistake.
It is the right tool for a bad `DELETE`, a broken migration, or a receptionist who
merged two patients who were not the same person.

It cannot help with a billing lapse, a deleted project, a compromised login, or a
decision to move off Supabase. For those you need a copy that is not inside the
account. That is what the dump is for.

---

## Go-live checklist

Two of these need Supabase credentials, so they are yours to do. Nothing else in
this repo can do them for you.

- [ ] **Enable point-in-time recovery** in the Supabase dashboard
      (Project Settings, Database, Point-in-Time Recovery). It requires a paid
      plan. Record the retention window here: `________ days`
- [ ] **Set `DIRECT_URL`** in `.env` to the session connection (port 5432, shown
      in Supabase as "direct connection"). `npm run backup` needs it; the pooled
      URL will not work.
- [ ] Install the PostgreSQL client tools so `pg_dump` and `pg_restore` exist:
      `winget install PostgreSQL.PostgreSQL.17` on Windows, `brew install libpq`
      on macOS, `apt install postgresql-client-17` on Debian.
- [ ] Take the first dump: `npm run backup`
- [ ] **Run the drill below** and write the RTO at the bottom of this file.
- [ ] Decide where the off-machine copy lives, and encrypt it. A dump is every
      patient record in the hospital in one file.
- [ ] Schedule `npm run backup` nightly (Task Scheduler on Windows, cron
      elsewhere). It exits non-zero when the dump is missing or suspiciously
      small, so the scheduler will tell you when it stops working.

---

## Taking a backup

```bash
npm run backup
```

Read-only against the database, so it is safe to run at any time, including
during clinic hours. Writes a compressed custom-format dump to `backups/`
(gitignored) and prunes to the newest 14. Override with `BACKUP_DIR` and
`BACKUP_KEEP`.

Custom format rather than plain SQL because `pg_restore` can pull a single table
out of it, which is what you want at 3 AM when only one table is wrong.

---

## The drill: prove the dump restores

Do this before go-live and once a quarter. It needs an empty scratch database,
not the live one.

```bash
# 1. Create a scratch database (any Postgres: a second Supabase project,
#    a local server, a container). It must be EMPTY and it must not be the
#    hospital database.

# 2. Restore into it and read the row counts back.
npm run backup:verify -- \
  --file backups/jeeva-2026-07-30T16-04-05Z.dump \
  --target postgresql://postgres:pw@localhost:5432/jeeva_restore_test \
  --yes-wipe-the-target
```

The script drops and rebuilds everything in `--target`, so it refuses to run
against the database in `DIRECT_URL` or `DATABASE_URL`, and it makes you type
`--yes-wipe-the-target` to say out loud what is happening. That guard fails
closed: if it cannot parse a URL it assumes the target is production and stops.

It passes only when the restored tables actually contain rows. A restore that
"succeeded" into empty tables is the exact failure this drill exists to catch.

---

## Recovering for real

### Case 1: bad data, database is fine

Use Supabase point-in-time recovery. Do not restore a dump for this: the dump is
from last night and you would throw away today's work along with the mistake.

1. Stop writes if you can. Take the app offline rather than let staff keep typing
   into a database you are about to rewind.
2. Supabase dashboard, Database, Point-in-Time Recovery, pick a timestamp a few
   minutes before the mistake.
3. Restore, then verify: open `/admin/errors` and the day-close screen for
   yesterday and confirm the totals match what was printed.
4. Tell the desk what window of work was lost so they can re-enter it.

### Case 2: the project or account is gone

1. Stand up a new Postgres (new Supabase project, or any host).
2. `npm run backup:verify` against it using the newest dump, with
   `--yes-wipe-the-target`. This is the same command as the drill, which is why
   the drill matters: you will have done it before.
3. Point `DATABASE_URL` and `DIRECT_URL` at the new database and redeploy.
4. `npx prisma migrate deploy` to bring the schema up to the current code, in
   case the dump predates the latest migration.
5. Verify: sign in to each portal, open the bed board, print yesterday's
   day-close and check the totals.

---

## What is not covered

Uploaded files are not in the database. Patient documents on local disk
(`/storage`, see `src/lib/storage.ts`) and Cloudinary uploads are separate and
this backup does not include them. If the hospital starts relying on uploaded
scans, that needs its own backup and its own line in this runbook.

---

## Measured RTO

Fill this in from the drill. Empty means it has never been tested.

| Date tested | Dump size | Restore time | Tested by | Notes |
|---|---|---|---|---|
| | | | | |
