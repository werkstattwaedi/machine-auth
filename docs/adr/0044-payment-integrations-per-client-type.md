# ADR-0044: Payment Integrations per Client Type

**Status:** Accepted (amended 2026-10-16: the server also refuses a members-only method for a non-member — see decision 5; amended 2026-10-18 by [ADR-0052](0052-bill-payment-method-and-document.md): a promise to pay made during the checkout (RaiseNow) yields a Beleg, a verified payment a Quittung, and the bill stores its committed method — `billDocument()` became `billMailFor()`)

**Date:** 2026-10-11

**Amends:** [ADR-0020](0020-dual-payment-qrbill-twint-paylink.md) (the RaiseNow PayLink becomes one switchable integration among several)

**Applies to:** `shared/src/payment-methods.ts`, `functions/src/payments/`, `functions/src/invoice/acknowledge_bill.ts`, `functions/src/invoice/commit_payment_method.ts`, `functions/src/invoice/close_checkout_and_get_payment.ts`, `web/apps/checkout/src/components/checkout/payment-{methods,options,confirmation}.tsx`, `web/apps/checkout/src/lib/payment-config.ts`, `scripts/generate-env.ts`

## Context

The checkout offered three hard-coded methods: QR bill (`rechnung`), Sammelrechnung (`monthly`) and TWINT through a RaiseNow PayLink (ADR-0020), stored as `"twint"`. A Wallee payment terminal, driven through the kiosk's local till interface, is about to replace RaiseNow at the kiosk. The future of RaiseNow on customers' own devices is open: it may stay, be replaced by Wallee e-commerce, or be removed.

Two problems followed:

1. **The id named the brand, not the integration.** The terminal accepts TWINT too, and Wallee e-commerce would as well, so `"twint"` would no longer say which path a customer took. The id also drives receipts, PDF titles, mail templates and bank reconciliation.
2. **Method behaviour was scattered** as `=== "twint"` / `=== "monthly"` checks across ~10 files, and nothing could switch a method off, let alone differently on the kiosk and on the web.

## Decision

1. **Method ids name the integration.** `"twint"` becomes `"raisenow"`, for both `checkouts.paymentMethod` and `bills.paidVia`. Future ids follow the same rule (`wallee_terminal`, `wallee_web`). The brand is only a label.
2. **One method table** in `@oww/shared` (`PAYMENT_METHOD_INFO`) holds the per-method behaviour: `paidDuringCheckout` (the document is a receipt / "Quittung" without a QR slip), `isAggregated` (becomes a Beleg for the Sammelrechnung), `requiresMembership`, and the label. Callers read properties; they don't compare ids. The checkout UI has a matching table for icon, panel, commit label and commit gate — since #761 `PAYMENT_CHOICE_UI` (`payment-methods.tsx`), keyed by method or the CHF 0 `free` card, with each method's card copy, commit button and confirmation, and no commit gate (the commit is the close).
3. **Stored ids are migrated, not aliased.** `scripts/migrate-payment-method-ids.ts` rewrote `checkouts.paymentMethod` and `bills.paidVia` on staging and prod (2026-10-12). During the rollout the rules, `acknowledgeBill` and `adminMarkBillsPaid` accepted `"twint"` from tabs still running an old bundle; that alias, the read-side normalizers and the retired `paidVia: "cash"` were removed afterwards, so the code knows only the current ids. BigQuery `stats.paid_via` history is **not** rewritten: rows exported before the rename keep `twint` (same meaning as `raisenow`).
4. **Enablement per client type, from the operations config.** `ClientType = "kiosk" | "web"`. `web.paymentMethodsKiosk` / `web.paymentMethodsWeb` are comma-separated ids in tab order. `generate-env` writes them to both `VITE_PAYMENT_METHODS_*` (checkout app) and `PAYMENT_METHODS_*` (functions), and rejects unknown ids. Empty means the defaults `rechnung,monthly,raisenow`.
5. **The server gates only "enabled for some client type".** `acknowledgeBill` refuses a method that is switched off everywhere (`failed-precondition`), and the PayLink is not built at all then. Which client type shows which tab is a UI decision: a customer gains nothing by picking a method another client offers, so it is not a security boundary.
   **Amendment (2026-10-16, #750):** a `requiresMembership` method (the Sammelrechnung) is refused unless the account holder has an active membership, a guest always. Unlike the client-type gating this protects something: a non-member's or a guest's Beleg is never collected by the monthly run, and a membership bought on it would never activate. `assertPaymentMethodAllowed` (`functions/src/invoice/commit_payment_method.ts`) is that gate, shared by `acknowledgeBill` and `closeCheckoutAndGetPayment`, which now takes the method when the person confirms it with the close. Confirming a method is the person's promise to pay, so the close commits it for the TWINT PayLink too — sent when the person clicks "Mit TWINT bezahlen" and the PayLink opens, not when the TWINT tab is selected; nothing confirms a PayLink payment afterwards, exactly as with the QR-Rechnung. A payment terminal (Wallee) is the exception: it confirms the payment, so its checkout stays open until the terminal reports an approved transaction and closes only then; a failed transaction leaves it open.
   **Amendment (2026-10-18, #757):** `acknowledgeBill` and the overnight `autoAcknowledgeBills` are removed; the close is the only place a person commits a method, and a close that costs something without one is refused (BIL-44). `assertPaymentMethodAllowed` gates the close alone.
6. **Integrations live in `functions/src/payments/`** (`raisenow.ts` today, `config.ts` for the switch). `PaymentData` carries one optional field per integration (`paylinkUrl: string | null`), and the UI drops a tab whose data is missing.

## Consequences

**Pros:**
- A new integration is one shared table entry, one UI entry, one provider module and a config value. No literal hunt.
- RaiseNow can be switched off for the kiosk (or entirely) by a config change plus deploy, with no code change.
- Stored data says which integration was used, which reconciliation and statistics need once two integrations take TWINT.

**Cons:**
- The rename needed a one-time migration plus a short-lived write alias (both done; see Decision 3).
- BigQuery holds two spellings for RaiseNow payments (`twint` before, `raisenow` after). Queries must treat them as one.
- A config change needs a hosting **and** functions deploy, because both read it at build/deploy time.
- `firestore.rules` still lists the allowed `paymentMethod` values literally, so each new method also needs a rules change.

**Tradeoffs:**
- *Keep `"twint"` as an alias for RaiseNow, without migrating:* cheaper, but leaves an id that will be wrong as soon as the terminal takes TWINT.
- *Runtime switch in Firestore (`config/payment`):* toggles without a deploy, but adds admin UI and seed data for a setting that changes rarely. Deploy-time config matches how the other payment settings (IBAN, PayLink id) are handled.
- *Server-enforced per-client gating* (the kiosk bearer on `acknowledgeBill`): stricter, but adds bearer plumbing to a payment callable without protecting anything of value.
