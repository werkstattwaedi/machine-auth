# ADR-0039: Pseudonymized statistics export to BigQuery

**Status:** Accepted

**Date:** 2026-07-19

## Context

Retention (ADR-0038) deletes operational data after 3 years and erasure
deletes it on request — but the Verein needs long-term statistics (visits,
workshop utilization, machine usage, revenue mix, membership development)
precisely across those deletions. The stats store must therefore be
separate from Firestore, survive erasure legally, and never contain data
that re-identifies a subject.

Useful denormalization already exists: `checkouts.summary` (frozen
totals), `usage_machine.billableSeconds` + `workshop`, and the
`UserType`/`UsageType`/`WorkshopId` dimensions in `@oww/shared`. There is
no BigQuery emulator. `closedAt` is written exactly once (no reopen path).

## Decision

**BigQuery dataset `stats` (europe-west6) is the statistics store**, fed by
a daily watermark-batched export (`dailyStatsExport`, 05:00 Zurich — before
the 06:00 bill run). Tables: `visits`, `visit_items`, `machine_usage`,
`bills` (paid only), `membership_snapshots` (active memberships × month).

**Append-only + dedup views.** Every table carries `doc_id` +
`exported_at`; a `*_v` view per table keeps the latest row per `doc_id`
(`ROW_NUMBER() = 1`). Analysts query only views. Re-exports and
crash-duplicates are harmless — no MERGE, no streaming-buffer DML. The
watermark (`export_state/{stream}`: timestamp + lastDocId) advances only
after a successful sink insert; resume is
`startAfter(watermark, lastDocId)` — never a bare `>`, which would skip
equal-timestamp docs at a page boundary.

**Export-once semantics.** A checkout exports when `closedAt` passes the
watermark and never again (no reopen path exists). Post-export admin-SDK
corrections do not reach BigQuery — accepted residual divergence.

**Pseudonymization, never claimed anonymous.**
`subject_key = HMAC-SHA256(uid, STATS_SUBJECT_SALT)` (uid == users doc id;
anonymous checkouts key on their per-visit anon principal). The salt is a
per-project Secret Manager secret; **destroying it is the documented
retroactive-anonymization switch**. Rows carry no name/email/tag UID;
`bills` rows deliberately exclude `referenceNumber` and `storagePath` (the
re-link vectors to the escrowed PDFs); event timestamps (`closed_at`,
`start_time`, `end_time`) are **truncated to the hour** — second-precision
timestamps were the strongest linkage vector, and hour granularity keeps
every stated stats use.

**Erasure keeps the rows, stable key** (no rotation, no key-nulling),
under the DSG Art. 31(2)(e) statistics clause with GDPR Art. 17(3)(d) as
benchmark — defensible because of the layered safeguards: HMAC key,
salt-destruction escape hatch, no direct identifiers, hour truncation,
excluded re-link fields, and the PDF escrow (ADR-0038) that removes the
(date, amount) join. Erasure *flushes before deleting* through the same
row builders, so statistics never lose data.

**`StatsSink` seam.** No BQ emulator → all logic tests through
`InMemorySink`/`CountingSink`; production uses streaming `insertAll`
(lazy-imported to keep authCall cold starts lean). Streaming has **no free
tier** — at a few MB/year this is cents; do not "optimize" to load jobs
without needing to. `is_member` resolves at export time (T+1 day
approximation). Backfill (`scripts/backfill-stats.ts`) loops the
production export core from epoch watermarks until drained; the
verification gate (counts, sums, spot checks) must be recorded before any
ADR-0038 deletion runs.

## Consequences

**Pros:**
- Statistics survive retention + erasure with full history from launch.
- One code path for daily export, backfill, and erasure-flush.
- Views make every failure mode (crash, re-run, resume) converge.

**Cons:**
- T+1 export means same-day corrections export once, later ones never.
- `is_member` is an export-time approximation, not visit-time truth.
- Backfill cannot reconstruct historical membership *snapshots* (they
  accumulate monthly from launch).

**Tradeoffs (rejected alternatives):**
- *Firestore→BigQuery extension / streaming triggers*: the extension
  mirrors raw docs — PII lands in BQ, defeating the whole design; triggers
  add per-write cost and retry complexity for zero freshness benefit at a
  daily-stats use case.
- *Dataflow / ETL pipeline*: massive overkill at <10k checkouts/year.
- *Random pseudonym mapping table* instead of HMAC: the mapping table is
  itself PII and needs its own lifecycle; HMAC + destroyable salt is
  simpler and strictly safer.
- *MERGE/upsert tables*: streaming-buffer DML restrictions and idempotency
  headaches; append+view costs nothing at this volume.
