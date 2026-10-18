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
2. **The terminal's result is for display only.** On "approved" the UI shows the confirmation and resets; it reports nothing to the backend. Someone who fakes an approval only fools their own screen: the checkout stays open and no bill exists. *(2026-10-19, #812: the kiosk now reports the approval, which parks the checkout as `awaiting_payment` — see the amendment below. It still can't make anything paid.)*
3. **A priced attempt, not a bill, carries the reference.** No bill number exists while the checkout is open. `prepareTerminalPayment` validates and prices the close exactly like `closeCheckoutAndGetPayment` (shared helpers), stores it as attempt *n* on the open checkout (`terminalAttempts`) together with a snapshot of the priced items and of the machine sessions each machine row held, and returns the reference `{P|S}-{checkoutId}-{n}`. Each retry is a new attempt; older ones stay settleable while the checkout is open, because money may still arrive after an abort the terminal ignored once the card was read. A checkout takes at most ten attempts.
4. **Wallee's backend settles; the webhook is the fast path.** `walleeWebhook` verifies the ECDSA signature with the official `wallee` SDK over the raw body, then `settleTerminalPayment` **re-reads the transaction** (never trusting the body's state) and, in one Firestore transaction, closes the checkout with exactly what the attempt priced and mints the bill **paid** (`paidAt` = Wallee's authorization time, `paidVia: wallee_terminal`, ack source `terminal`). `onBillCreate` renders and mails the Quittung once (`isCommittedAtClose`). The Quittung prints Wallee's cardholder receipt text, which Wallee requires on the customer's document. The person paid for what was priced, so whatever changed on the visit since (items added, changed or removed, a machine session uploaded later, persons) is set back to the snapshot — machine sessions that arrived during the payment stay linked to the checkout and go unbilled (`notBilledReason: after_verified_payment`), rather than turning up on a later visit — and reported once as `terminal_checkout_changed` for a person to follow up. The priced persons are restored too, which deliberately undoes a CHK-40 switch to Reguläre Nutzung caused by machine time that arrived during the payment. Nothing is locked and nothing is carried over to another checkout automatically: a lock can only end on a timer (the backend never learns of a declined or abandoned attempt), so a late confirmation would still meet a changed checkout; and a carry-over checkout opened the next night (reconcile) would charge a second usage fee for the same visit. We first want to see how often a checkout changes during a payment at all, and follow up by hand until then.
5. **A nightly reconcile is the safety net** (`reconcileTerminalPayments`, 04:30): it searches the last three days of paid terminal transactions, settles what a lost delivery missed, and alerts when Wallee deactivated our listener.
6. **No `trxSyncNumber`.** Recovery after a dropped connection comes from the backend, so the till never has to trigger final balances; the daily closing stays automatic. After an `unknown` result the UI checks whether the checkout closed before offering a retry.
7. **One space, two environments.** Staging and prod share the Wallee space and the one terminal; both receive every webhook. The reference's letter (`WALLEE_REFERENCE_PREFIX`) makes each ignore the other's payments.
8. **Nothing un-books automatically.** A double charge (money for a checkout already closed), an amount that differs from the attempt, a reversal after settlement and a sale started on the terminal itself only raise alerts (`terminal_double_charge`, `terminal_amount_mismatch`, `terminal_payment_voided`, `terminal_unmatched_payment`); the checkout and its bill stay as they are and the money is refunded by hand in the Wallee portal. Each alert fires once per transaction and outcome (a marker in `terminalPaymentAlerts`, dropped by TTL after 7 days), although the webhook's retries and three nights of reconcile see the transaction again.
9. **Clients can never claim the method.** The close callable and `acknowledgeBill` refuse a `confirmsPayment` method; the rules refuse a client-written `paymentMethod: wallee_terminal` and the attempt fields; the overnight commit treats an unconfirmed bill naming the terminal as a QR-Rechnung. *(2026-10-18, #757: `acknowledgeBill` and the overnight commit are removed; the close callable is the remaining client path and keeps the refusal.)*

## Amendment (2026-10-19, #812): an approval parks the checkout

The first staging test showed the cost of decision 2: the A35 approved a card payment while it wasn't attached to our Wallee space, so no transaction, webhook or reconcile hit ever came — and the person, told "paid", found their visit still open, with nobody alerted.

- **The kiosk reports the approval** (`reportTerminalApproval`, `billingCall`) the moment the terminal says "approved". It moves the checkout from `open` to a new server-only status **`awaiting_payment`**: no bill, no `paymentMethod`, no `closedAt` — every close still mints its bill in the same transaction, and only `settleTerminalPayment` closes it (from `awaiting_payment` exactly as from `open`, any of its attempts). What changes is that it is no longer the person's open checkout: every `status == "open"` lookup skips it, so the next visit, machine session or purchase opens a new one, reminders skip it, and the rules lock it. Places that must still see it as pending treat it explicitly (membership and badge duplicates, privacy blockers, the account history, admin).
- **Audited, not trusted.** `prepareTerminalPayment` isn't kiosk-only, so the report could hide one's own checkout from "open" (reminders, the next-day badge-in block). It only takes the latest attempt within 10 min of its start, records who reported it, and `alertUnconfirmedTerminalPayments` (hourly, no Wallee call) raises `terminal_payment_unconfirmed` for every checkout still awaiting 30 min after the report, again weekly. It can never make a checkout paid.
- **Best effort.** If the report doesn't get through (the UI waits up to 3 s on "Fertig"; a retry after the kiosk moved to the next person would run as someone else), the checkout stays open as before.
- **Resolution is by hand** until an admin action exists: close it (no money came) or wait for Wallee — never just reopen it, since a newer open checkout may exist by then.
- Machine time uploaded after the report now opens a new checkout (CHK-44) instead of being dropped as `after_verified_payment` — the carry-over decision 4 avoided, but only in the failure case: normally the webhook closes the checkout within a second and the same happens today.

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
- A terminal bill is born paid, and the ADR-0042 correction refuses paid bills: a terminal-paid visit can't be corrected or cancelled in the admin app, not even after a reversal left it "paid". Open question in `docs/spec/billing.md`; until it is decided, such a case is fixed by hand.
- The webhook is a public endpoint (gated by the signature; a delivery only triggers a re-read).

**Tradeoffs:**
- *Cloud Till Interface:* Wallee drives the terminal from the cloud, no LAN socket — but it needs the terminal paired to a cloud till, adds a round trip per step, and still needs the webhook for settlement. LTI worked out of the box on the A35.
- *The kiosk reports the result to a callable:* simpler, but trusts the client — the test terminal's simulated approvals prove that a terminal-side "approved" is not money. *(#812 adopts a weaker form: the report parks the checkout, it never pays it.)*
- *Allocate the bill (number) before paying:* gives the terminal the RE number, but burns a number per abandoned or declined attempt, contradicts "the checkout closes only on approval" and needed an overnight-commit special case for unpaid terminal bills.
- *Disjoint bill-number ranges per environment:* obsolete once the reference names the checkout, not a bill.

Out of scope: refunds and ADR-0042 corrections of terminal-paid bills from the admin app, reversal over LTI, NFC badge reading on the terminal.
