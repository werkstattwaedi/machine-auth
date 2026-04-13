# ADR-0020: Dual Payment Options — QR Bill + RaiseNow PayLink

**Status:** Accepted

**Date:** 2026-04-12

**Applies to:** `functions/src/invoice/get_payment_qr_data.ts`, `web/apps/checkout/src/components/checkout/payment-result.tsx`, `scripts/generate-env.ts`

## Context

1. **TWINT integration cost.** RaiseNow webhooks and API require the "Growth" plan (~CHF 50+/month). The free plan offers no webhook, no API, and charges 2.4% per TWINT transaction. QR bill bank transfers are free.

2. **Users expect convenient payment.** After checkout, users should be able to pay immediately — either via e-banking (scan QR code) or TWINT (for convenience).

3. **Payment reconciliation.** Without webhooks, there is no server-side payment detection. Payments must be reconciled manually via bank statements using the SCOR reference (ADR-0019).

## Decision

### QR Bill as primary, RaiseNow PayLink as secondary

The payment result page offers two options via radio-button selection:

- **E-Banking (default):** Displays a Swiss QR bill layout with QR code (including Swiss cross), creditor details, SCOR reference, and payer name. Pre-filled — user scans with any banking app. Labeled "Empfohlen" and "Gebührenfrei für den Verein".
- **TWINT:** Opens a RaiseNow PayLink URL. The PayLink is pre-filled with amount (fixed), SCOR reference, supporter name, and email. Uses the official RaiseNow PayLink button styling.

### Server assembles all payment data

The `getPaymentQrData` callable returns:
- `qrBillPayload` — complete SPC-format string for the QR code
- `paylinkUrl` — assembled from `RAISENOW_PAYLINK_SOLUTION_ID` config + pre-filled URL parameters
- Structured creditor fields (IBAN, name, street, location) for the QR bill display
- SCOR reference, payer name, amount, currency

No payment configuration is exposed to the client build — all sensitive data (IBAN, PayLink solution ID) stays server-side.

### No automatic payment detection

Neither payment method triggers a server-side callback. Bills remain in unpaid state until manually reconciled. The `paidAt`/`paidVia` fields on `BillEntity` are retained for future manual "mark as paid" functionality (e.g. from the admin UI).

## Consequences

**Pros:**
- No recurring platform cost (RaiseNow free plan).
- QR bill is the frictionless default — users scan and pay with pre-filled data.
- SCOR reference enables bank statement reconciliation.
- TWINT remains available for users who prefer it.

**Cons:**
- No real-time payment confirmation — the UI cannot show "Bezahlt" automatically.
- TWINT payments incur 2.4% transaction fees.
- Payment reconciliation is manual (bank statement matching by SCOR reference).

**Tradeoffs:**
- **RaiseNow Growth plan (webhooks):** Would enable automatic "paid" detection and receipt emails on payment, but the monthly cost is disproportionate to the transaction volume (~100/month).
- **Combined QR code (TWINT alternative scheme params):** A single QR code with both QR bill and TWINT data was previously implemented, but made TWINT too easy to use accidentally (2.4% fee on every scan). Separating the options with QR Bill as default steers users toward the free method.
