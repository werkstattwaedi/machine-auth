# ADR-0052: The Bill Stores Its Payment Method and Its Document

**Status:** Accepted (amends the `kind` design of #245, the "prefix from `kind`" part of [ADR-0042](0042-bill-cancellation-and-corrections.md) and `billDocument()` of [ADR-0044](0044-payment-methods.md))

**Date:** 2026-10-18

**Applies to:** `shared/src/bill-document.ts`, `functions/src/invoice/` (`create_bill.ts`, `commit_payment_method.ts`, `terminal_payment.ts`, `monthly_bill_run.ts`, `correct_checkouts.ts`, `bill_triggers.ts`, `build_invoice_pdf.ts`, `get_invoice_download_url.ts`, `mark_bills_paid.ts`), `functions/src/stats/`, `web/modules/lib/format.ts`, the admin invoice/visit pages and the account usage page, `scripts/backfill-bill-document.ts`

## Context

Issue #763 makes our document for a bill paid during the checkout (TWINT) a
**Beleg** numbered `BL-…`; #780 does the same for a CHF 0 checkout. Both
were blocked by how a bill described itself.

`bills.kind: "invoice" | "beleg"` (#245) carried three meanings at once:

1. **What the customer holds:** `BL-` prefix, "Beleg" title, file name
   (`formatBillReference(n, kind)`, `billDocumentPrefix`).
2. **The monthly queue:** `monthlyBillRun` collects every `kind == "beleg"`
   bill not yet aggregated; payment booking, corrections and the status
   pills read it the same way.
3. **The commit of a Sammelrechnung bill:** a `kind: "beleg"` bill is
   committed without an ack stamp, which `isBillCommitted`, the update
   trigger and the e-mail retry gate rely on.

Setting `kind: "beleg"` on a TWINT bill would therefore have put an
already-paid visit on the member's Sammelrechnung. At the same time, "what is
this document" was derived three times — `billDocument()` for the mail,
`billDocumentPrefix()`, the PDF title — each from `kind` plus
`checkouts[0].paymentMethod`, because **the bill did not store its payment
method**. The Sammelrechnung even needed a workaround that turned its
checkouts' "monthly" back into "rechnung" for the PDF.

## Decision

A bill stores two independent facts:

```ts
paymentMethod: PaymentMethod | null   // the committed method; null until committed, and for CHF 0
document: "rechnung" | "sammelrechnung" | "beleg" | "quittung"
```

- **Behaviour follows the method**, through `PAYMENT_METHOD_INFO`
  (ADR-0044): a bill is a *Beleg for the Sammelrechnung* exactly when its
  method `isAggregated` (`isCollectedBeleg`), and waits for the monthly run
  until `aggregatedIntoBillRef` is set (`awaitsSammelrechnung`); it is
  committed when acked or a Beleg for the Sammelrechnung; the QR slip and the
  mail (`billMailFor`) read method properties. A Sammelrechnung's own method
  is the QR-Rechnung.
- **Presentation follows the document**, through `BILL_DOCUMENT_INFO`
  (prefix, label, number label, payable). A Beleg asks for no payment itself
  — because the Sammelrechnung will, because the customer says they paid
  during the checkout (the RaiseNow TWINT paylink), or because nothing is
  due. A **Quittung** confirms a payment the provider verified
  (`confirmsPayment`: the Wallee terminal, ADR-0051). File name and title both use the label; every
  Sammelrechnung, one visit included, is titled and named "Sammelrechnung".
- **One derivation, `documentFor(choice, { isSammelrechnung })`**, takes a
  `PaymentChoice` (`PaymentMethod | "free"`). The server calls it at mint
  (every bill is committed at mint since #757) and when a repeated close
  commits a legacy bill (`billCommitFields`); the checkout
  can call it before a bill exists (#790). "free" is not a payment method:
  nobody chooses it and no client offers it, and "nothing was due" is
  already stored once, as `paidVia: "free"`.
- **The document is fixed at commit.** A printed number is a historical fact,
  so a later rule change reaches only new bills. A correction keeps its
  original's method and document (BIL-17); RaiseNow bills issued before #763
  stay `quittung` with their `RE-` number (BIL-46).
- **Never key the queue on `document == "beleg"`** — that is the double
  charge this ADR exists to prevent.
- The mail contract's `BILL_DOCUMENTS`/`BillDocument` become
  `BILL_MAILS`/`BillMail`: they name a mail, not the document. Template
  aliases are unchanged (`bill-receipt` carries the RaiseNow Beleg and the
  Wallee Quittung).

### Migration

`kind` retires in two steps, so no environment ever runs code that disagrees
with its data:

1. **This change:** every write sets `paymentMethod` and `document` *and*
   keeps `kind` in step (`"beleg"` iff the method is aggregated). Readers go
   through the `@oww/shared` resolvers (`billDocumentOf`,
   `billPaymentMethodOf`, `isCollectedBeleg`), which fall back to today's
   derivation for a bill without the fields. `monthlyBillRun` still queries
   `kind`, which dual-writing keeps exact. The index
   `(paymentMethod, aggregatedIntoBillRef, created)` ships ahead.
   `scripts/backfill-bill-document.ts` gives old bills the fields (deploy step
   `docs/deploy/2026-10-18-bill-document-backfill.md`) and ends with a gate.
2. **Follow-up**, once both environments pass the gate: stop writing `kind`,
   query `paymentMethod in AGGREGATED_PAYMENT_METHODS`, drop the fallbacks
   and the `kind` index. BigQuery keeps its `kind` column (filled from
   `isCollectedBeleg`) next to the new `document` and `payment_method`.

## Consequences

**Pros:**
- Each meaning has one field and one name; the 25 `kind === "beleg"` checks
  became `isCollectedBeleg`, and "what document is this" has one answer.
- The PDF, mail and download no longer reconstruct the method from
  `checkouts[0]` for new bills; the Sammelrechnung workaround is gone.
- A future rename of a document type reaches only new bills, by construction.

**Cons:**
- Until the follow-up lands, `kind` is written next to the fields and the
  resolvers carry a legacy branch.
- The backfill costs about two writes per bill (each write also fires the
  bill audit trigger).

**Tradeoffs:**
- *A `document` field next to `kind`, without a backfill* (the first plan):
  cheapest, but leaves `kind`, `document`, `billDocument()` and
  `billDocumentPrefix()` overlapping, with a precedence rule every reader must
  know.
- *Derive the document from the stored method on every read:* no second
  field, but old TWINT bills would turn into Belege on their next PDF, and
  every future wording change would renumber issued documents.
- *`paymentMethod: "free"`:* would make "committed" total, but leaks a
  non-choice into the offered-method config, the rules value list and the
  checkout UI, and duplicates `paidVia: "free"` (true only for bills free at
  mint, not for one corrected down to CHF 0).
