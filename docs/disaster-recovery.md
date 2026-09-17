# Disaster Recovery — Firestore & Storage

How production data (`oww-maco`) is protected and how to restore it. Pairs
with [`deployment-checklist.md`](deployment-checklist.md).

## What is protected

| Data | Mechanism | Window |
|------|-----------|--------|
| Firestore `(default)` | **Point-in-Time Recovery (PITR)** | trailing 7 days, per-minute |
| Firestore `(default)` | **Daily scheduled backups** | 30-day retention |
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

# Daily backups, 30-day retention
gcloud firestore backups schedules create --database='(default)' \
  --recurrence=daily --retention=30d --project=oww-maco

# Retention of an existing schedule can be changed in place
# (recurrence cannot — delete and recreate for that):
gcloud firestore backups schedules update --database='(default)' \
  --backup-schedule=<SCHEDULE_ID> --retention=30d --project=oww-maco
```

Verify:

```bash
gcloud firestore databases describe --database='(default)' --project=oww-maco \
  --format="yaml(pointInTimeRecoveryEnablement,deleteProtectionState)"
gcloud firestore backups schedules list --database='(default)' --project=oww-maco
gcloud firestore backups list --location=europe-west6 --project=oww-maco
```

> Retention: Firestore allows up to 14 weeks (98 days) for daily and weekly
> schedules alike. 30 days is deliberate: PITR covers the "noticed within a
> week" case, the backups cover the slow-burning kind — the 2026-09 cleanup
> bug deleted billed checkouts for two weeks before anyone looked, and the
> original 7-day retention had already aged the early ones out. Longer than
> 30 days would stretch the erasure residual promised in
> `docs/data-protection.md`; revisit both together if that ever changes.

## Deletion paths

Every code path that deletes data, with the guard that keeps it from deleting
too much (audited 2026-09-16 after the cleanup incident). The rule of thumb:
leaving unused data behind is always cheaper than one eager delete — a new
deletion path needs a row here and a test pinning its guard.

| Path | Trigger | Deletes | Guard |
|------|---------|---------|-------|
| `cleanupAbandonedCheckouts` | daily cron | anon/kiosk auth principals idle > 7 d; their **open, ownerless** carts | no provider + no e-mail + no phone; `status == "open" && userId == null && !billRef`; kept records counted in the run log |
| `privacyErase` (`privacy-cli.ts erase`) | admin, manual | the subject's own docs (checkouts by `userId`/`firebaseUid`, bills, usage, tokens, users doc, auth account); *redacts* their persons[] entry elsewhere | admin-only, blockers (open checkout / unpaid bill), export watermark, `--dry-run` first, receipt with phases |
| `privacyTrim` (`privacy-cli.ts trim`) | admin, yearly | operational docs older than 3 years | admin-only, dry-run review, export watermark, `pendingRenewalBill` skip, PDFs escrowed before the bill doc goes |
| Firestore TTL | automatic | `loginCodes` (5 min), in-progress `authentications` (5 min, `ttlAt` cleared on completion), pending `invites` (30 d, cleared on accept), `printJobs` | field is only ever set on transient docs |
| `handleCompleteTagAuth` | on failed tag auth | the in-progress `authentications` doc being processed | that doc only; TTL would take it anyway |
| `createUser` / `createManagedMember` / `import-members.ts` | rollback | the auth user created in the same call when the Firestore write fails | only `authUser.uid` from this call (`createUser` never rolls back a bare record it *adopted*) |
| Bare Auth record reclaim (`reclaimEmailFromBareRecord`, ADR-0043) | member login, `syncAuthIdentity` trigger, `updateUserEmail` | an Auth record holding a member's e-mail under a different uid — the leftover of an abandoned code request | no `users/{uid}` doc + no provider + no phone + **no custom claims** (every doc-backed record carries `{ admin }` from `syncCustomClaims`) + not disabled + not a `tag:` principal + **idle ≥ 2 h** since its latest creation / sign-in / refresh (a bare record can have a live session whose ID token outlives the deleted record); anything else is a conflict, never a delete; warn log with both uids; one test per guard term in `identity-resolve.test.ts` |
| Google sign-in orphan (`signInWithGoogle`, ADR-0043) | member, client-side | the doc-less Auth record the popup just signed in as | only `auth.currentUser`; only when `users/{uid}` does not exist **and** another users doc carries its e-mail (`hasProfile`); an unanswered check signs out and deletes nothing |
| `moveInvoicePdfToArchive` | erase / trim | the source PDF | only after the archive copy exists (`ifGenerationMatch: 0`, 412 = already there) |
| Admin UI "Besuch löschen" | admin click | an **open** visit and its items | button only rendered for `status == "open"`; billed visits go through correction (ADR-0042); rules: `checkouts` delete is admin-only |
| Admin UI "Berechtigung löschen" | admin click | a `permission` doc | confirm dialog; rules admin-only |
| Checkout wizard | member/visitor | items of their own **open** checkout (remove item, uncheck workshop) | rules: principal of the open checkout, or anon creator; NFC items excluded |
| Archive bucket lifecycle | automatic | escrowed PDFs 10 years after `customTime` | OR 958f retention; main bucket has no lifecycle rule |

The `syncAuthIdentity` trigger also *unlinks* an Auth phone number that
`users.phone` no longer names (ADR-0043). That clears a field, it deletes no
record; the member re-verifies on `/account/profile`.

Scheduled jobs other than the cleanup (`dailyMembershipMaintenance`,
`staleCheckoutReminders`, `retryBillProcessing`, `autoAcknowledgeBills`,
`monthlyBillRun`, `dailyStatsExport`, `dailyLogDigest`) do not delete
documents. Seeding scripts delete only against the emulator.

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
