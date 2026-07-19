# Disaster Recovery — Firestore & Storage

How production data (`oww-maco`) is protected and how to restore it. Pairs
with [`deployment-checklist.md`](deployment-checklist.md).

## What is protected

| Data | Mechanism | Window |
|------|-----------|--------|
| Firestore `(default)` | **Point-in-Time Recovery (PITR)** | trailing 7 days, per-minute |
| Firestore `(default)` | **Daily scheduled backups** | 7-day retention |
| Firestore `(default)` | **Delete protection** | prevents accidental DB deletion |
| Cloud Storage (`invoices/`, `price-lists/`) | *Not backed up — regenerable* | n/a |

Storage PDFs are deliberately **not** backed up: invoice PDFs regenerate from
their `bills/{id}` doc via `retryBillProcessing` / `onBillCreate`, and
price-list PDFs regenerate on demand. Restoring Firestore restores the source
of truth; the PDFs follow.

## Enabling (one-time, idempotent)

Run against `oww-maco` (requires `gcloud` auth for the project). These are
also safe to re-run to confirm state.

```bash
# PITR + delete protection on the database
gcloud firestore databases update --database='(default)' \
  --enable-pitr --delete-protection --project=oww-maco

# Daily backups, 7-day retention
gcloud firestore backups schedules create --database='(default)' \
  --recurrence=daily --retention=7d --project=oww-maco
```

Verify:

```bash
gcloud firestore databases describe --database='(default)' --project=oww-maco \
  --format="yaml(pointInTimeRecoveryEnablement,deleteProtectionState)"
gcloud firestore backups schedules list --database='(default)' --project=oww-maco
gcloud firestore backups list --location=europe-west6 --project=oww-maco
```

> Retention: daily schedules allow up to 7 days. For longer history add a
> weekly schedule (`--recurrence=weekly --retention=14w`, up to 14 weeks).

## Restore procedures

Firestore restores **into a new database** — you cannot restore in place over
`(default)`. The recovery pattern is: restore to a temp database, inspect,
then either promote it or copy the needed documents back.

### Option A — PITR (recent, fine-grained: within 7 days)

Best for "someone/something corrupted or deleted data N minutes/hours ago".

```bash
# Restore the state as of a specific timestamp into a NEW database
gcloud firestore databases restore \
  --source-database='(default)' \
  --snapshot-time='2026-07-19T01:00:00Z' \
  --destination-database='recovery-20260719' \
  --project=oww-maco
```

`--snapshot-time` must be within the PITR window (last 7 days) and is rounded
to the minute. Inspect `recovery-20260719`, then copy the affected
collections/documents back into `(default)` with a one-off Admin-SDK script
(read from the recovery DB, write to default).

### Option B — Scheduled backup (older, or whole-DB loss)

Best for "restore yesterday's known-good snapshot".

```bash
# Find the backup you want
gcloud firestore backups list --location=europe-west6 --project=oww-maco

# Restore it into a NEW database
gcloud firestore databases restore \
  --source-backup=projects/oww-maco/locations/europe-west6/backups/<BACKUP_ID> \
  --destination-database='recovery-from-backup' \
  --project=oww-maco
```

Then promote or copy back as in Option A.

### Option C — Structural rebuild (no recovery needed)

If the loss is only the **structural/config** collections (permission, catalog,
maco, machine, price_lists, config/*) and user/runtime data is intact or
irrelevant, reseed from the operations repo instead of restoring:

```bash
cd ../machine-auth-operations
npm run seed:prod                 # structural only (idempotent upsert)
# or, full fixtures incl. 1 user/token/auth:
GOOGLE_CLOUD_PROJECT=oww-maco npx tsx scripts/seed.ts
```

See the seed contract in the root `CLAUDE.md`. This is what a from-scratch
launch reseed uses; it is **not** a substitute for PITR/backups of real
user data.

## Notes

- Restores create a new database; deleting the temporary recovery database
  afterwards avoids ongoing cost.
- Delete protection must be disabled before a database can be deleted — it is
  a guard against exactly the accidental-wipe scenario, so leave it **on** for
  `(default)`.
- There is currently no automated restore test. After enabling, do one manual
  PITR restore to a temp DB to confirm the flow, then delete the temp DB.
