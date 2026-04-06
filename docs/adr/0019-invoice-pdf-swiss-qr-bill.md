# ADR-0019: Invoice PDF Generation with Swiss QR Bill

**Status:** Accepted

**Date:** 2026-04-06

**Applies to:** `functions/src/invoice/`, `firestore/schema.jsonc` (bills collection), `scripts/generate-env.ts` (payment params)

## Context

1. **Users expect an invoice after checkout.** Workshop users need a proper invoice for their records, and firma users need it for accounting.

2. **Swiss payment ecosystem.** Swiss invoices commonly include a QR bill payment slip (successor to the orange Einzahlungsschein). Banks and payment apps (TWINT, e-banking) scan the QR code for one-tap payment. Using a Creditor Reference (ISO 11649 SCOR) allows automatic reconciliation — the reference appears on the bank statement.

3. **Multi-checkout invoices.** A user may want one invoice covering several workshop visits. The data model must support N checkouts → 1 bill.

4. **Server-side generation.** PDFs must be generated server-side (Cloud Function) because: (a) the bill number counter must be atomic, (b) the PDF must be stored durably, and (c) client-side PDF generation has browser compatibility issues with QR code rendering.

## Decision

### Callable Cloud Function generates PDF with Swiss QR bill

A single `generateInvoice` callable function accepts checkout IDs, allocates a bill number, builds a PDF, and uploads it to Cloud Storage. It returns a signed URL (1-hour expiry) for immediate download.

### Sequential bill numbers with ISO 11649 SCOR references

Each bill gets a sequential number from an atomic Firestore counter (`config/billing.nextBillNumber`). The number is zero-padded to 9 digits and used as the payload for an ISO 11649 Structured Creditor Reference:

```
Bill #42 → payload "000000042" → RF32000000042
```

### PDFKit + swissqrbill for PDF generation

- **PDFKit** — Pure JavaScript PDF generation, no native dependencies (important for Cloud Functions deployment).
- **swissqrbill** v4 — Attaches a standards-compliant 105mm Swiss QR bill payment slip to any PDFKit document. Handles QR code generation, receipt slip, and layout per SIX payment standards.

The PDF builder (`build_invoice_pdf.ts`) is a pure function: `(InvoiceData, PaymentConfig) → Buffer`. No Firestore or Storage dependencies — those are handled by the Cloud Function wrapper.

### `bills` collection with reverse link on checkouts

```
bills/{billId}
├── userId: DocumentReference       → /users/{userId}
├── checkouts: DocumentReference[]  → /checkouts/{id}
├── referenceNumber: number         → 42 (SCOR reference RF32000000042 computed at render time)
├── amount, currency, storagePath, created, paidAt, paidVia
```

A reverse link (`billRef: DocumentReference | null`) on `CheckoutEntity` prevents double-billing.

### Generated PDFs stored in Cloud Storage

Uploaded to `invoices/{billId}.pdf` in the default bucket. Payment recipient details (IBAN, name, address) are provided via `defineString()` function parameters, sourced from the operations config via `generate-env.ts` (ADR-0018).

## Consequences

### Positive

- Users get a scannable QR bill they can pay with any Swiss banking app.
- SCOR reference enables automatic payment reconciliation.
- Sequential bill numbers provide a clean audit trail.
- Pure-function PDF builder is easy to test (content parsing + visual regression).
- No native dependencies — deploys cleanly to Cloud Functions.

### Negative

- **Counter bottleneck:** `config/billing.nextBillNumber` is a single Firestore document, limiting concurrent invoice generation. At the expected volume (~100/month) this is a non-issue; could be sharded if volume grows.
- **Signed URL expiry:** The 1-hour signed URL means users can't bookmark the download link. A persistent download mechanism would be needed for "download past invoices".

## Alternatives Considered

### QR-Reference (ISR format) instead of SCOR
A QR-Reference (27-digit format) requires a QR-IBAN — a special IBAN issued by the bank for structured reference payments. SCOR works with any regular IBAN and is the recommended format for new implementations per SIX payment standards. Avoids requiring the organization to obtain a QR-IBAN. If one is later obtained, the reference scheme would change from SCOR to QR-Reference — a breaking change for reference generation, but the PDF builder and data model would remain unchanged.

### Client-side PDF generation
Can't atomically allocate bill numbers, browser QR rendering is fragile, no durable storage, not suitable for emails.

