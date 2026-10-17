# ADR-0051: Wallee Terminal via Local Till Interface, Settled by Webhook

**Status:** Accepted

**Date:** 2026-10-17

**Applies to:** `shared/src/payment-methods.ts` (`wallee_terminal`, `confirmsPayment`), `shared/src/terminal-payment.ts`, `functions/src/invoice/terminal_payment.ts` (`prepareTerminalPayment`, `settleTerminalPayment`), `functions/src/payments/wallee.ts`, `functions/src/payments/wallee_webhook.ts` (`walleeWebhook`, `reconcileTerminalPayments`), `checkout-kiosk/src/bridge/` (LTI client), the checkout's "Karte / TWINT" card, `scripts/wallee-webhook-setup.ts`

## Context

ADR-0044 reserved the method id `wallee_terminal` for the Wallee A35 payment terminal next to the kiosk screen. It is the first integration that **confirms** a payment: RaiseNow and the QR-Rechnung only carry the person's promise to pay. Since #750 the checkout closes only when its method is committed, and a terminal checkout must close only on an approved payment, so that "Abbrechen", "Zurück" and "Nochmals versuchen" can still reach an editable step 3.

A spike on 2026-10-15/17 against the real terminal and our Wallee space (results in `docs/plans/wallee-terminal.md`) found:
- The A35 speaks Wallee's **Local Till Interface (LTI 2.54)** on the LAN (TCP 50000): framed XML, no authentication, any `posId`.
- Our `merchantReference` reaches the Wallee backend transaction and can be searched by.
- Signed `Transaction` webhooks arrive within ~0.3 s of the state change, **out of order** and **without entity data**. An approved payment lands in `AUTHORIZED` and moves to `COMPLETED`/`FULFILL` at the daily closing (02:08).
- Unattended, the test terminal simulates a TWINT approval that **never reaches the backend**: the terminal's word is not proof of payment.

## Decision

1. **The kiosk drives the terminal over LTI** (`checkout-kiosk/src/bridge/`), not Wallee's Cloud Till Interface. The checkout webview asks the kiosk bridge to charge an amount under a reference and shows the terminal's progress. The web app sees LTI-agnostic events only (`TerminalPaymentEvent`/`TerminalPaymentResult` in `@oww/shared`).
2. **The terminal's result is for display only.** On "approved" the UI shows the confirmation and resets; it reports nothing to the backend. Someone who fakes an approval only fools their own screen: the checkout stays open and no bill exists.
3. **A priced attempt, not a bill, carries the reference.** No bill number exists while the checkout is open. `prepareTerminalPayment` validates and prices the close exactly like `closeCheckoutAndGetPayment` (shared helpers), stores it as attempt *n* on the open checkout (`terminalAttempts`), and returns the reference `{P|S}-{checkoutId}-{n}`. Each retry is a new attempt; older ones stay settleable while the checkout is open, because money may still arrive after an abort the terminal ignored once the card was read.
4. **Wallee's backend settles; the webhook is the fast path.** `walleeWebhook` verifies the ECDSA signature with the official `wallee` SDK over the raw body, then `settleTerminalPayment` **re-reads the transaction** (never trusting the body's state) and, in one Firestore transaction, closes the checkout from the attempt and mints the bill **paid** (`paidAt` = Wallee's authorization time, `paidVia: wallee_terminal`, ack source `terminal`). `onBillCreate` renders and mails the Quittung once (`isCommittedAtClose`). The Quittung prints Wallee's cardholder receipt text, which Wallee requires on the customer's document.
5. **A nightly reconcile is the safety net** (`reconcileTerminalPayments`, 04:30): it searches the last three days of paid terminal transactions, settles what a lost delivery missed, and alerts when Wallee deactivated our listener.
6. **No `trxSyncNumber`.** Recovery after a dropped connection comes from the backend, so the till never has to trigger final balances; the daily closing stays automatic. After an `unknown` result the UI checks whether the checkout closed before offering a retry.
7. **One space, two environments.** Staging and prod share the Wallee space and the one terminal; both receive every webhook. The reference's letter (`WALLEE_REFERENCE_PREFIX`) makes each ignore the other's payments.
8. **Nothing un-books automatically.** A double charge (money for a checkout already closed), an amount that differs from the attempt, a reversal after settlement and a sale started on the terminal itself only raise alerts (`terminal_double_charge`, `terminal_amount_mismatch`, `terminal_payment_voided`, `terminal_unmatched_payment`); refunds and corrections are done by hand in the Wallee portal and with the ADR-0042 correction.
9. **Clients can never claim the method.** The close callable and `acknowledgeBill` refuse a `confirmsPayment` method; the rules refuse a client-written `paymentMethod: wallee_terminal` and the attempt fields; the overnight commit treats an unconfirmed bill naming the terminal as a QR-Rechnung.

## Consequences

**Pros:**
- The checkout UI needs no backend round trip and no "checking payment" phase on the happy path; the Quittung arrives seconds later.
- A kiosk crash, reset or a customer walking away after the tap doesn't lose the payment: the webhook settles it anyway.
- LTI's weak points (unauthenticated LAN protocol, aborts ignored after card read, connections dropping mid-payment) are harmless, because nothing trusts the terminal.
- Wallee's own SDK does auth and signature checks; we maintain no crypto.

**Cons:**
- The Wallee backend shows the attempt reference, not the bill number; reconciliation goes through `bills.walleeTransactionId`.
- The SDK is large (~15 MB, every service loaded on import); it is imported lazily inside the Wallee code paths so other functions' cold starts don't pay for it.
- Double charges and post-settlement reversals need a human. Rare at one kiosk, but not automated.
- The webhook is a public endpoint (gated by the signature; a delivery only triggers a re-read).

**Tradeoffs:**
- *Cloud Till Interface:* Wallee drives the terminal from the cloud, no LAN socket — but it needs the terminal paired to a cloud till, adds a round trip per step, and still needs the webhook for settlement. LTI worked out of the box on the A35.
- *The kiosk reports the result to a callable:* simpler, but trusts the client — the test terminal's simulated approvals prove that a terminal-side "approved" is not money.
- *Allocate the bill (number) before paying:* gives the terminal the RE number, but burns a number per abandoned or declined attempt, contradicts "the checkout closes only on approval" and needed an overnight-commit special case for unpaid terminal bills.
- *Disjoint bill-number ranges per environment:* obsolete once the reference names the checkout, not a bill.

Out of scope: refunds and ADR-0042 corrections of terminal-paid bills from the admin app, reversal over LTI, NFC badge reading on the terminal.
