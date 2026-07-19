# ADR-0038: Data lifecycle — retention, trim, DSAR report, and erasure

**Status:** Accepted

**Date:** 2026-07-19

## Context

The system stores personal data (names, emails, addresses, NFC tag UIDs,
visit/usage/billing history) across Firestore, Firebase Auth, Storage, and
external processors, with — until now — no retention limits and no tooling
for data-subject requests under the Swiss DSG (access Art. 25, erasure
Art. 32). `audit_log` additionally holds full before/after copies of nine
business collections. Two legal constraints pull in opposite directions:
the DSG's data-minimization/erasure duties, and OR Art. 958f's 10-year
retention duty for accounting records (invoice PDFs).

Load-bearing code facts (verified 2026-07-18): `assembleInvoiceData`
tolerates deleted checkouts (partitions on `exists`, issue #364); a token
pointing at a missing user hard-rejects badge-in
(`handle_terminal_checkin.ts:121`); users doc ID == Firebase Auth UID;
`closedAt` is written exactly once (no reopen path); audit docs store
`collection` + `docId` as two fields; a registered user's PII also lives in
OTHER owners' checkouts via `persons[].userRef`/email (family roster picks).

## Decision

**Firestore is the operational store with a 3-year retention**, enforced by
a yearly, manually triggered trim (`privacyTrim`, driven by
`scripts/privacy-cli.ts trim`, always dry-run-reviewed first — the January
ops-calendar entry). No cron: destructive + annual; convertible to
onSchedule later if chronically forgotten.

**The subject-data map is the single source of truth for policy**
(`functions/src/privacy/subject_data_map.ts`): every collection's PII
fields, legal basis, retention, trim spec, and erasure strategy. The DSAR
report and the processing register in `docs/data-protection.md` consume it
directly; the erasure engine and the trim implement their per-collection
queries in code, kept aligned with the map by coverage unit tests that
also fail CI if an audited collection lacks an entry.

**Erasure = per-subject trim (all ages) + identity deletion.** Blockers
first (open checkout, unpaid bill, active owned membership, person in an
open checkout → `failed-precondition` with the full list, zero writes;
admin settles via existing UIs). Then: flush-before-delete into the stats
sink (ADR-0039); recursiveDelete of owned checkouts (by `userId` ref OR
`firebaseUid`); bills **deleted, not anonymized-in-place** — an anonymized
bill doc re-links trivially to its PDF via amount/referenceNumber — with
the PDF moved to the escrow archive first; tokens deleted **in one
WriteBatch with the users doc** (the invariant that keeps badge-in sane);
persons[] entries in other owners' checkouts redacted in place (match by
`userRef` or email — this covers registered subjects AND anonymous
walk-ins with the same paged scan); `items.tokenId` (tag UID) nulled via
the collection-group index; Auth account deleted last.

**Erasure receipts** live in `erasures/{subjectId}` (uid, or HMAC(email)
for walk-ins — PII-free by construction), tracking phase
(`flush → delete → auth → audit → done`), counts, and the audit-purge path
set. Re-runs are idempotent; re-running a *completed* erasure re-executes
only the audit purge.

**Two-phase audit purge.** The erasure's own deletes/redactions fire the
audit trigger, writing fresh `before` copies. Phase A accumulates
`collection/docId` paths (deleted docs + persons-redacted checkouts — the
latter exceed the original plan but close a real leak: their audit history
holds the redacted PII); phase B deletes matching audit entries via
`where collection == X and docId in [≤30 chunk]`. Trigger delivery is
async, so the CLI waits (~60s) and re-runs the purge until a pass removes
nothing.

**PDF escrow** (OR Art. 958f vs re-identification): trim/erasure MOVE
invoice PDFs to `<project>-invoice-archive` (Archive class, uniform
access). Functions SA holds `objectCreator` only — write, never read; the
IAM baseline check in the deployment checklist verifies no project-level
role leaks `storage.objects.get` to that SA. Copies use
`ifGenerationMatch: 0` (412 ⇒ already archived ⇒ finish the move);
`customTime` = bill paid date + a `daysSinceCustomTime ≈ 3650` lifecycle
rule gives the archive its legal 10-year expiry.

**Guards shared by trim + erasure**: never delete a doc whose age-basis
timestamp is past its export watermark (unexported → flush or skip); never
delete a bill referenced by a non-null `memberships.pendingRenewalBill`
(presence-guard at `renewal_invoicer.ts:173` would silently skip that
renewal forever — a >3y bill can't normally be pending, so this is cheap
insurance).

**DSAR access** (`privacyReport`): the subject's full graph serialized with
the audit-trigger convention, appearances in other owners' checkouts
reduced to the subject's own entry, audit_log as per-collection counts,
plus static disclosure blocks (BigQuery pseudonymization, processors,
residuals) and the processing register. All three callables are admin-only,
registered in `authCall` (a conscious choice: DSAR traffic is rare and
shares the warm login instance; the salt secret rides along), and logged to
`operations_log` (severity `info`) for accountability.

## Consequences

**Pros:**
- DSG Art. 25/32 requests become one CLI invocation each, with dry-run
  previews and receipts.
- Retention is enforced (bounded PII half-life ≈ 3–4 years) while
  statistics and the legal PDF archive survive.
- The map + coverage test make "new collection, no policy" a CI failure.

**Cons:**
- The persons[] scan is O(all checkouts) per erasure/report (bounded,
  paged 500 — ~30k docs today, cents).
- Erasure leaves residuals, documented in `docs/data-protection.md`:
  backups/PITR (~7 days), operations_log + machine_reports free text until
  trim, Cloud Logging (~30d), Resend, the org's own bank records
  ((date, amount) join outside our systems), and post-export stats
  divergence (admin-SDK edits after export never reach BigQuery).
- Redacted checkouts lose their audit history (phase B deletes it) —
  accepted: PII removal outranks ops provenance for those docs.

**Tradeoffs:**
- *Anonymize bills in place* instead of deleting — rejected: the
  (referenceNumber, amount) pair re-links to the archived PDF trivially.
- *Cron'd trim* — rejected for now: an annual destructive job wants a
  human reviewing dry-run counts more than it wants automation.
- *Skip audit purge for redacted (non-deleted) checkouts* (the original
  plan) — rejected during implementation: their audit entries retain the
  redacted persons[] PII indefinitely otherwise.
