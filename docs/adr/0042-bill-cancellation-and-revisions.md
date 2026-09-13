# ADR-0042: Bill cancellation and corrected re-issue (Storno / Korrektur)

**Status:** Accepted

**Date:** 2026-09-13

## Context

A closed checkout and its bill were immutable: `bills` deny every client write, and the only
"cancel" in the system was for memberships. When a visit was billed wrongly (wrong material
quantity, wrong usage type, forgotten fee waiver) the treasurer fixed it by hand outside the system
and the customer kept a wrong PDF. Three constraints shaped the design:

1. **The as-sent document is the accounting record.** A PDF that went out must never be silently
   regenerated with different content.
2. **Bill numbers are load-bearing.** `referenceNumber` is the Swiss QR SCOR payload
   (`padStart(9)`), the bank-import join key, and the "one bill per number" invariant that every
   Map keyed on it relies on (ADR-0019).
3. **Statistics must stay honest.** BigQuery rows are export-once (ADR-0039); a cancelled visit that
   was already exported would otherwise count forever.

## Decision

### Numbering: `referenceNumber = base × 10 + revisionDigit`

The stored number carries the revision: digit 0 is the original, 1 the first corrected re-issue,
up to 9. `formatInvoiceNumber(42000010)` renders `RE-4200001`, `formatInvoiceNumber(42000011)`
renders `RE-4200001-2`. The SCOR payload is still the raw stored number, so every revision has its
own QR reference, uniqueness holds, and no lookup changes. `allocateBill` mints `counter × 10` (the
counter still advances by 1); `allocateBillRevision` mints `previous + 1` without touching the
counter and rejects a tenth correction.

A one-off migration (`scripts/migrate-bill-numbers.ts`) shifts every stored number ×10 and writes
`config/billing.referenceNumberFormat = "shifted-v1"`. `allocateBill` refuses to mint against an
existing config doc without that marker, so the new code cannot run on un-migrated data; a missing
config doc (fresh install) bootstraps with the marker. Existing PDFs keep their printed number and
legacy QR payload; the bank-import decoder tries the exact payload first and the ×10 reading second.
The migration asserts `max < min × 10`, which rules out collisions between legacy payloads and
migrated numbers and also detects a half-applied run.

### Documents: cancelled ones stay, replacements are new docs

A cancelled checkout gets `status: "cancelled"` plus `cancelledAt/By`, `cancellationReason` and
`supersededByCheckoutRef`; its bill gets the same cancellation fields and `supersededByBillRef`.
Neither PDF is touched. A corrected re-issue is a *new* closed checkout (copying `created`,
`closedAt`, `userId`, `firebaseUid`, `paymentMethod`; carrying the edited persons, usage type,
items and summary) with a *new* bill from `allocateBillRevision`. Both directions are linked
(`supersedes…` / `supersededBy…`). Legacy docs lack all of these fields, so "not cancelled" is always
checked client-side, never as a Firestore `== null` filter.

The audit trail is the existing `auditCheckouts` / `auditBills` triggers: every write carries the
admin uid in `modifiedBy`, so no separate correction record exists.

### One transaction, batched in the UI

The `correctCheckouts` callable (admin only) takes one reason and a list of `{checkoutId,
replacement?}`. Everything happens in a single transaction: cancel each checkout and bill, create
each replacement, and — when a Beleg inside a sent Sammelrechnung is touched — cancel that
Sammelrechnung and mint its revision from the surviving Belege plus the new replacements, using the
same `aggregateBelegeIntoInvoice` helper the monthly cron uses. There is no pending state, no
scheduled re-issue pass and no queue collection. Batching several Beleg fixes into one revision is
an admin choice made in the UI (the Sammelrechnung page edits N Belege and commits once); fixing
them one by one from the visit page yields one revision per commit, and the confirm dialog says so.

v1 guards: unpaid only (a paid bill, or a Beleg whose Sammelrechnung is paid, is rejected); no
membership or badge items; no `membership-renewal` bills; at most nine corrections per bill.

### One mail per top-level bill

A correction sends exactly one mail from the new top-level document: the corrected Rechnung,
Quittung or un-aggregated Beleg, or the Sammelrechnung revision with every replacement Beleg of that
commit attached. The revision stores those Belege in `correctedBillRefs` (stored, not derived:
Belege corrected in an earlier revision are re-pointed to the latest one and would otherwise be
attached again). Replacement Belege inside a revision never mail on their own. A pure cancellation
without replacement sends a short notice, locked by `cancellationNoticeSentAt` and retried by the
hourly `retryBillProcessing` sweep. Mail stays in `bill_triggers.ts` with the existing lock and
retry conventions; the callable sends inline like `monthlyBillRun` because pre-acked bills never see
the ack transition that drives the trigger-based send.

### Statistics

`visits` and `visit_items` gain a nullable `cancelled_at`. Cancelled and replacement checkouts are
written with an explicit `statsFlushedAt: null`; the daily export flushes those rows in a final step
(they sit behind the `closedAt` watermark) and stamps the timestamp. This revises ADR-0039's
"post-export corrections do not reach BigQuery". Only unpaid bills can be cancelled and the bills
stream exports paid bills only, so bill rows are unaffected.

## Consequences

**Pros:**
- No migration of PDFs, QR payloads or bank-import history; revisions are visible in the number.
- Cancelled documents remain exactly as sent; the audit log already records who did what.
- One transaction means the customer never holds a Sammelrechnung that references a voided Beleg.
- The aggregation and pricing logic is shared with the existing close and monthly paths.

**Cons:**
- A one-off data migration with a deploy-order dependency: deploy functions first (the new
  `allocateBill` refuses to mint until the marker exists), migrate right after. Migrating first
  would let the old code mint un-shifted numbers that the new formatter misreads forever.
- Nine corrections per bill is a hard cap; a tenth needs a fresh number by hand.
- Bank slips printed before the migration resolve through a fallback reading in the decoder.
- Paid bills cannot be corrected in v1 (credit notes / refunds are backlog).

**Tradeoffs:**
- *Fresh counter number for the replacement* would need no migration, but the printed number and
  the QR payload would then disagree with what the treasurer sees on the bank statement.
- *Deferring the Sammelrechnung re-issue to a nightly pass* batched same-day corrections for free
  but needed a pending state, a mark-paid guard, a queue collection and a retry loop. With ~60 bills
  a year, UI batching is the cheaper guarantee.
- *Per-Beleg correction mails* would have sent N+1 mails per Sammelrechnung fix.
- *Regenerating the cancelled PDF with a STORNIERT banner* overwrites the as-sent document; rejected
  for v1.
