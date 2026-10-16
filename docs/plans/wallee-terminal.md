# Wallee A35 terminal payment at the kiosk — LTI (technical draft)

Status: **draft**, 2026-10-15. Technical side only; the checkout UI design follows separately. Account-specific identifiers (space, terminal, merchant) live in the operations config, not here.

## Context

ADR-0044 prepared the method table and reserved the id `wallee_terminal`. RaiseNow is only *stated by the customer*, and nothing in the checkout sets `paidAt`. The terminal is the first integration that **confirms** a payment, so the backend must get the result from Wallee and not take the kiosk's word for it.

### Spike findings (2026-10-15, real A35, our Wallee space)

| Question | Answer |
|---|---|
| A35 exposes LTI on the LAN? | **Yes.** TCP port 50000, LTI 2.54. No auth or TLS; any `posId` is accepted. |
| Does our reference reach the Wallee backend? | **Yes.** `trxData.merchantReference` → `Transaction.merchantReference`. It can be searched with `GET /payment/transactions/search?query=merchantReference:"…"`. |
| When does the backend transaction appear? | Only **at card tap**, and it is final about 1.5 s later. A till-side abort before the tap leaves **no** backend transaction. |
| Webhooks | **Work** (feature enabled in the portal on 2026-10-15). A Transaction listener fired PROCESSING, CONFIRMED and FAILED within **0.33 s** of the state change, about when the kiosk got its LTI response. Payloads are signed (`SHA256withECDSA`) and verified with the SDK's `isContentValid`; a tampered payload fails. **Deliveries arrive out of order**: PROCESSING before CONFIRMED, and event ids aren't ordered either. Payloads carry no entity data. |
| TWINT via the terminal | **Same flow.** A `qrCodeScanNotification` event, then a backend transaction with our `merchantReference`. |
| Daily closing | Automatic (submission 02:08, transmission 02:17). No till-triggered final balance is needed, as long as we don't use `trxSyncNumber`. |
| Abort from the till | `abortCardEntryNotification` → `trxAbortNotification` + `errorNotification TRM.PT.0002` (echoes `merchantReference`) within 0.3 s. |
| Live events | `trxInfo=AAA/` gives start/cardEntry/cardRemoval/end/abort plus CARDHOLDER/ATTENDANT `displayNotification` text (German). |
| Timeouts | `toCardIn` 30 s, `toPosTrxRq` 45 s. Card tap → final response took about 13 s on a decline. |
| Test outcomes | The test acquirer **simulates the result from the amount** (Wallee, 2026-10-16): CHF 3.00–9.00 approve; 1.00, 2.00, 9.97 and ≥ 20.17 decline; 1.01/1.02/1.03/1.09 give card or system errors; 6.66/9.98/9.99 decline with auto-reversal; 1.28/11.30/20.16 need a PIN or cardholder ID; 20.15 asks to confirm the amount. Our early CHF 1.00 tests were declined on purpose. |
| Approved payment | CHF 3.00: `trxResult 0`, `ep2AuthResponseCode 00`, `amountAuth 300`, `merchantReference` echoed. About 15 s from request to response, mostly waiting for the tap. Merchant and cardholder receipts arrive as `printerNotification` text (not needed: the Quittung is our own PDF). |
| Backend state on approval | Webhooks PROCESSING → CONFIRMED → **AUTHORIZED** within about 1 s, out of order again. The transaction stays **`AUTHORIZED`** (`completedOn` empty). Completion presumably comes with the daily closing or after the connector's completion delay (5 days); being checked with a payment left un-reversed. |
| Reversal | `reversalRequest` with `origTrxSeqCnt` works, but the terminal first sends a `confirmationRequest` ("Storno CHF 3.00 OK?") that the till must answer with `confirmationResponse result=1`. Then a **VOIDED** webhook, and the backend transaction is `VOIDED`. |
| `reprintReceiptRequest` | Works once a transaction exists (`VCS.ERR.0017` just meant there wasn't one). `lastTrx` does **not** include our `merchantReference`. |

**The key design consequence:** the Wallee backend is the source of truth, it can be found by our reference, and it tells us about changes by webhook. That makes LTI's weak points (no auth, an abort ignored after the card is read, a dropped connection mid-payment) recoverable on the server side, without `trxSyncNumber`.

## Architecture

```
 checkout webview ──bridge IPC──▶ kiosk main (Node) ──TCP/LTI──▶ A35 ──▶ Wallee backend
                                                                              │
                         walleeWebhook (onRequest) ◀──signed webhook──────────┘
                                │ re-read tx via SDK
                                ▼
                     settleTerminalPayment ──▶ bill paidAt + ack ──▶ onBillUpdate (Quittung)
                                ▲
       nightly reconcileTerminalPayments (safety net: SDK search) ──┘
```

1. The checkout closes the checkout and gets `PaymentData` (bill id, reference, amount), as it does today.
2. The webview asks the kiosk bridge `terminal.pay({ amount, reference })`. Kiosk main opens the LTI socket and sends `financialTrxRequest` (`merchantReference = bill reference`). It streams status events back and resolves with the final result.
3. **The UI trusts the terminal for display only.** On `approved` it shows success and resets, with no backend round trip and no "checking payment" phase. Someone who fakes an approval in their own UI only fools themselves: the bill stays unpaid and keeps its normal reminder path.
4. **The webhook settles the bill.** Wallee posts the Transaction state change, about 0.3 s after the tap. `walleeWebhook` verifies the signature, **re-reads the transaction** (payloads carry no data and arrive out of order), maps `merchantReference` to the bill, checks amount, currency and terminal, and marks the bill paid in one Firestore transaction. The ack and `paidAt` are written together, so `onBillUpdate` renders the Quittung with "Bezahlt" once.
5. **Safety net:** a nightly job searches the last few days' successful terminal transactions and settles anything a lost webhook missed. Wallee retries deliveries, but deactivates a listener that keeps failing.

The client never tells the backend that a bill is paid; only Wallee does.

## Components

### 1. Shared (`shared/src/payment-methods.ts`)
- Add `wallee_terminal` to `PAYMENT_METHODS` with label "Karte / TWINT" (final wording comes with the UI), `paidDuringCheckout: true`, `isAggregated: false` and `requiresMembership: false`.
- Add a new property **`confirmsPayment`**: `true` for `wallee_terminal`, `false` for the rest. This is the property ADR-0044 anticipated. It separates "Quittung, verified paid" from RaiseNow's "Quittung, customer-stated".
- Add `wallee_terminal` to `PAID_VIA`. It stays out of `ADMIN_PAID_VIA`, because only the integration sets it.
- Add `"terminal"` to `paymentMethodConfirmationSource` (`"user" | "auto" | "terminal"`).
- Add an LTI-agnostic `TerminalPaymentEvent` / `TerminalPaymentResult` type, shared by the kiosk and the web. See the kiosk section.

### 2. Kiosk — LTI client (`checkout-kiosk/src/bridge/`)
- **`lti-codec.ts`**: framing (4-byte BE length + UTF-8 XML) with a streaming decoder that copes with split or merged TCP chunks. It builds the messages we send (`financialTrxRequest`, `abortCardEntryNotification`, `pingRequest`, `pinpadInformationRequest`) and parses what comes back into typed events. Use a small XML parser (`fast-xml-parser`); no XSD validation.
- **`wallee-terminal.ts`**: the session state machine. It allows **one use case at a time** and refuses a second `pay` while one is active.
  - `pay({ amountRappen, currency: 756, reference })`: connects, sends the request with `trxInfo=AAA/`, `noDCC=true`, `partialApprovalCap=0` and `showTrxResultScreens=true`, and emits events:
    - `started`, `cardEntered`, `cardRemoved`, `display { target, lines }`, `aborted`;
    - a final `result { outcome: "approved" | "declined" | "aborted" | "error", errorCode?, amountAuth?, brand?, entryMethod?, reference }`.
  - `abort()`: sends `abortCardEntryNotification silentAbort=true`. If the card has already been read, the abort does nothing; we keep waiting for the final response.
  - Timeouts: no final response within ~120 s, or the socket drops, ends with `result { outcome: "unknown" }`. The kiosk doesn't guess. Before offering a retry, the UI checks whether the bill has become paid: the webhook will have settled it within a second if the payment went through. It reads the bill through the existing Firestore listener or a read; no new callable is needed.
  - **Partial approvals** (`amountAuth < amount`) are disabled by `partialApprovalCap=0`. If one still arrives, it is treated as `approved` and the backend amount check catches it.
  - **No `trxSyncNumber`**: recovery comes from the backend lookup, and sync numbers would force till-triggered final balances.
  - `health()`: `pingRequest` with a short timeout, for the status report.
- **Bridge wiring** (`main.ts`, `preload.ts`, `types.ts`):
  - Add the feature `"payment-terminal"` to `bridgeBootstrap.features`, only when a terminal host is configured.
  - `ipcMain.handle("bridge:terminal-pay")` resolves with the final result. Events are broadcast on `bridge:terminal-event` to the requesting webContents.
  - `bridge:terminal-abort`.
  - `Bridge` gets `terminalPay(req) → Promise<TerminalPaymentResult>`, `onTerminalEvent(cb) → unsubscribe`, and `terminalAbort()`.
  - `web/modules/lib/use-bridge.ts` mirrors them as optional methods, so older kiosk builds degrade gracefully.
- **Session reset** (`reset-session.ts`): "Neuer Checkout" or a window close during an active payment calls `abort()` first. If the card was already read, the result still arrives and is reconciled server-side.
- **Config**: add `TERMINAL_HOST`, `TERMINAL_PORT` (default 50000) and `TERMINAL_POS_ID` (e.g. `KIOSK-01`) to `inject-build-config.mjs`, read from the ops config `kiosk.terminal.{host,port,posId}`. Leave the host empty to switch the feature off.
- **Status**: add the terminal's reachability and `terminalId` to `reportKioskStatus`, so `/versions` and the liveness view show it. This stays inside the existing "write on change or hourly" rule.
- **Simulator** (`checkout-kiosk/scripts/lti-sim.ts`): a fake terminal speaking the same framing. It runs scripted scenarios (approve, decline, abort, hang, drop mid-transaction) for local development and the tests. It also writes a matching fake transaction to the functions' Wallee test double (see Testing).

### 3. Functions — Wallee provider (`functions/src/payments/wallee.ts`)
- **The official `wallee` SDK** (npm, pinned; 5.5.0 at the time of the spike). We follow Wallee's own client, JWT auth and webhook signature check (`WebhookEncryptionKeysService.isContentValid`, ECDSA via `starkbank-ecdsa`) instead of maintaining our own.
  - **Not tree-shaken**: functions are built with plain `tsc` and deployed with `node_modules`. The package is about 15 MB (CJS+ESM), and `require("wallee")` loads every service and model (about 106 ms locally). Import it **lazily inside the Wallee handlers** with a dynamic `import()`, so other functions' cold starts don't pay for it.
  - It sits behind a small `WalleeApi` interface (`getTransaction`, `searchTransactions`, `isSignatureValid`) that tests replace with a fake.
- `settleTerminalPayment(transactionId, source: "webhook" | "reconcile")` is **the only way a bill gets paid by the terminal**:
  1. Re-read the transaction through the SDK. **Never use the webhook payload's `state`**: deliveries arrive out of order and carry no entity data.
  2. It must be in a **successful** state (**`AUTHORIZED`**, which is where an approved terminal payment lands, or a later `COMPLETED`/`FULFILL`), with `userInterfaceType == TERMINAL` and `terminal.id == WALLEE_TERMINAL_ID`. Anything else (FAILED, PROCESSING, …) → no-op.
  3. Map `merchantReference` to the bill. A reference outside our bill number range belongs to the other environment and is ignored (see Config). A reference inside our range with no matching bill → log `terminal_unmatched_payment`.
  4. Check `currency == CHF` and `|authorizationAmount − bill.amount| < 0.005`. A mismatch → error event; don't settle.
  5. In one Firestore transaction:
     - bill already paid by *this* transaction → no-op (idempotent);
     - paid by a *different* Wallee transaction → **double charge**, log `terminal_double_charge` for manual refund;
     - cancelled → log an alert, since money was taken on a cancelled bill;
     - otherwise set `paidAt` (the Wallee `authorizedOn`/`completedOn` time), `paidVia: "wallee_terminal"`, `walleeTransactionId`, `paymentMethodConfirmationTime` and `paymentMethodConfirmationSource: "terminal"`, and set `paymentMethod` on the checkout. This mirrors `acknowledgeBillHandler`, with `paidAt` added.
- **Params**:
  - `defineString`: `WALLEE_SPACE_ID`, `WALLEE_USER_ID`, `WALLEE_TERMINAL_ID` (the Wallee backend terminal id, *not* the EP2 terminal id the terminal reports over LTI).
  - `defineSecret`: `WALLEE_AUTH_KEY`.
  - Wire them through `scripts/generate-env.ts` (`FUNCTIONS_PAYMENT`, `FUNCTIONS_SECRETS`, test fixtures) and add the secret to `FUNCTION_SECRET_NAMES` in `scripts/port-block-secrets.ts` (CLAUDE.md gotcha: otherwise the emulator hangs).

### 4. Functions — entry points
- **`walleeWebhook`** (`onRequest`, `europe-west6`, public, `secrets: [WALLEE_AUTH_KEY]`):
  - It verifies `x-signature` over the **raw body** with the SDK. Invalid → 401, logged.
  - It ignores payloads for other spaces or entities (200).
  - It calls `settleTerminalPayment(entityId, "webhook")` and returns 200 once settled or once the transaction is a no-op. On a transient error (Wallee API or Firestore) it returns 5xx, so Wallee retries.
  - It is cheap: most deliveries (PROCESSING, CONFIRMED, FAILED) are one API read and no Firestore write.
- **`reconcileTerminalPayments`** (`onSchedule`, nightly, e.g. 04:30 before the 05:00 stats export):
  - It searches Wallee for terminal transactions from the last 3 days in a successful state and runs `settleTerminalPayment(…, "reconcile")` on each. Settled ones are no-ops.
  - It logs `terminal_unmatched_payment` for successful transactions whose reference matches no bill, e.g. a payment made from the terminal's standalone menu.
  - It also checks that the webhook listener is still `ACTIVE`, because Wallee deactivates failing listeners. If not, it logs `wallee_webhook_inactive` for an alert.
- **Overnight commit (`autoAcknowledgeBills`, BIL-7):** a bill whose last selected method is the terminal but which Wallee never confirmed is committed as `rechnung`, so it gets a Rechnung with a QR slip instead of a Quittung for money never received.
- **No callable.** The kiosk drives the terminal directly and never reports results to the backend. Consequence: the UI does not call `acknowledgeBill` for this method either; the webhook writes the ack.

### 5. Data model, rules, PDF
- `BillEntity` (`functions/src/invoice/types.ts`), `firestore/schema.jsonc` and the web mirror get `walleeTransactionId: number | null`.
- **Data protection**: store no masked PAN or card expiry, only the Wallee id. Add the field to the subject-data map (`functions/src/privacy/subject_data_map.ts`): it is a pseudonymous processor reference, kept with the bill.
- `firestore/firestore.rules`: add `wallee_terminal` to both closed-checkout `paymentMethod` lists (~343/349), plus a `cross-user-rules` test case.
- `build_invoice_pdf.ts`: add a `PAID_VIA_LABELS` entry "Karte/TWINT (Terminal)". With `paidAt` set, the Quittung prints "Bezahlt … am …" through the existing branch.
- BigQuery: `stats.paid_via` gains the value `wallee_terminal`. No schema change.
- Mail: no template work (ADR-0046). `billDocument()` already routes `paidDuringCheckout` to the receipt.

### 6. Config / ops
- Ops config:
  - `web.paymentMethodsKiosk` += `wallee_terminal`, staging first;
  - `wallee.{spaceId,userId,terminalId}`;
  - `kiosk.terminal.{host,port,posId}`.
- Set the secret `WALLEE_AUTH_KEY` per project.
- **One space, two environments.** Staging and prod share one Wallee space (and the one A35). Both projects register a webhook URL, and **both receive every event**. They are kept apart by **disjoint bill number ranges**: bill numbers come from the per-project counter `config/billing.nextBillNumber` (`create_bill.ts`), so staging's counter is moved to a range prod will never reach (e.g. `9000000` as the base). A reference from the other environment matches no bill and is ignored, logged at debug level rather than as `terminal_unmatched_payment`, which is reserved for references inside our own range. No prefix and no code path differ between environments. Document the range in `docs/config.md`, and add a check that refuses a staging counter overlapping prod's.
- **Webhook registration** per environment: one URL plus one Transaction listener for the states `AUTHORIZED`, `COMPLETED`, `FULFILL` and `FAILED`. Transaction entity id `1472041829003`. Signing is on by default (`enablePayloadSignatureAndState`). Add a script `scripts/wallee-webhook-setup.ts` (idempotent, `--dry-run`), so a restore or a new environment doesn't depend on portal clicks, and add it to `docs/deployment-checklist.md`.
- The application user needs to read transactions and webhook encryption keys, and to manage webhooks for the setup script. The shop-system application user used in the spike could do all three.
- Deploy record: `deploy-kiosk.ts` already records itself. Secret and config changes get a `deploy-record.ts event`.

### 7. Docs
- **ADR-0048** "Wallee terminal via Local Till Interface, settled by webhook". It records:
  - why LTI over CTI, using the spike findings above;
  - why the webhook (not the kiosk) settles bills, why the UI trusts the terminal for display only, and why there is no `trxSyncNumber`;
  - out of scope: refunds and ADR-0042 corrections of terminal-paid bills (done manually in the Wallee portal for now), and NFC on the terminal.
- Update the CLAUDE.md payment paragraph (`confirmsPayment`, `settleTerminalPayment` as the only paid-path), `docs/config.md` (new keys) and `docs/deployment-checklist.md`.
- Backlog: a refund flow, terminal NFC.

## Spec (`docs/spec/billing.md`)

**As is:** payment methods, documents and booking are already covered (BIL-1…11, BIL-26, BIL-29…34), so no as-is commit is needed. Final wording goes through the `spec-expert` agent with the implementation; these are the rules the terminal touches:

| Rule | Today | Change with the terminal |
|---|---|---|
| BIL-1 + table | QR-Rechnung, Sammelrechnung or TWINT | Add the terminal method (kiosk only, paid during checkout, Quittung). |
| BIL-6 | Confirming TWINT is the person's own statement | Unchanged for RaiseNow; new rule: a terminal payment counts as paid only once Wallee reports it, never on the kiosk's word. |
| BIL-7 | Overnight commit with the last selected method | **Gap:** a declined or abandoned terminal attempt must not be committed as the terminal method (that would mail a Quittung for an unpaid bill). Commit it as QR-Rechnung instead. The `autoAcknowledgeBills` job needs the matching change. |
| BIL-11 | A Quittung never states that the payment was received | A Quittung for a terminal payment states it was paid, with method and date. |
| BIL-29 | Only an admin books payments | Wallee's confirmation books a terminal payment automatically. |
| BIL-31 | Booking sends no mail and changes no document | A terminal payment is booked together with the commit, so its single Quittung already says "paid". Later bookings keep sending nothing. |
| BIL-34 | Nothing waits for payment | Unchanged: the UI doesn't wait for the backend either. |

## Testing
- **Kiosk** (`tsx --test`):
  - codec framing, with split, merged and oversized frames;
  - XML parsing against the captured spike transcripts (decline, abort, ping, pinpad info) as fixtures;
  - the state machine against `lti-sim` (approve, decline, abort before the card, abort after the card, socket drop → `unknown`, and a second `pay` refused while busy).
- **Functions unit**: `settleTerminalPayment` with a fake `WalleeApi`:
  - success, decline/FAILED no-op, amount mismatch, wrong terminal, reference from the other environment's range;
  - double charge, cancelled bill;
  - idempotent re-entry, and out-of-order deliveries (PROCESSING after AUTHORIZED).
  - `autoAcknowledgeBills`: an unconfirmed bill with the terminal selected is committed as `rechnung`.
- **Functions integration** (emulator):
  - `walleeWebhook` with captured spike payloads plus signature headers (fake verifier). An invalid signature → 401; a valid one → the bill is paid, and `onBillUpdate` produces the Quittung with "Bezahlt";
  - concurrent duplicate deliveries racing each other without double effects;
  - the reconcile job settling a payment whose webhook was "lost".
- **E2E**: bridge stub with a scripted terminal (the web already stubs `window.bridge` for NFC). The kiosk flow shows success and resets; the backend side is covered by the integration tests. The screenshots come with the UI work.
- **Staging, on the real A35**, once the acquirer approves:
  - card and TWINT for small amounts: the webhook settles, and the Quittung mail says "Bezahlt";
  - abort before the card;
  - kill the kiosk after the tap: the webhook still settles;
  - then add a runbook scenario to `/smoke-staging`.

## Rollout (one PR per step, several commits each)
1. **Backend**: shared types, the provider module (SDK), `walleeWebhook`, the reconcile job, the webhook setup script, the rules, the PDF label, and tests. Ships dark: the webhook only acts on references in this environment's bill number range and on bills that exist, and the checkout offers `wallee_terminal` nowhere.
2. **Kiosk**: codec, session, bridge feature, simulator and tests. Bump the kiosk version. Ships dark without `kiosk.terminal.host`.
3. **Checkout UI**: the terminal panel, the flow, error states and screenshots. To be designed next.
4. **Enablement**: ops config and secret on staging, then the staging test, ADR-0048 and the docs, then prod.

## Risks
- **The kiosk dies after the tap** (crash, reset, customer walks off): irrelevant to settlement. The webhook settles the bill, and the Quittung mail still goes out.
- **A webhook is lost, or the listener gets deactivated**: the nightly reconcile settles it, and alerts on `wallee_webhook_inactive`.
- **The customer pays twice** (retries after an `unknown`): the double-charge alert fires and the refund is manual. Lower the risk in the UI: after `unknown`, check whether the bill is already paid before offering a retry.
- **Webhook endpoint abuse**: it is public, but it does nothing without a valid ECDSA signature, and even with one it only re-reads Wallee. Keep the payload size limit small.
- **Charged on a cancelled or corrected bill**: alert plus manual refund. Rare at the kiosk.
- **Terminal or LAN down**: the bridge feature reports unavailable, and the UI falls back to the other methods.
- **LTI is unauthenticated on the LAN**: anyone on the workshop LAN could start payments on the terminal. That doesn't take money from anyone, but it means the kiosk never trusts the terminal's word, which is already the design. Consider a VLAN or a firewall rule so only the kiosk can reach port 50000.
- **Amount format**: bills are CHF floats. Send `Math.round(amount * 100)` Rappen and compare with a tolerance of 0.005.

## Open questions
1. **When does a terminal transaction move from `AUTHORIZED` to `COMPLETED`?** Expected at the daily closing (about 02:08) or after the 5-day completion delay; being checked. Either way the bill is settled on `AUTHORIZED`, with `paidAt` = `authorizedOn`.
2. **A `VOIDED` after settlement** (reversal at the terminal or in the portal) must not leave the bill "paid": un-settle it, or at least alert. To be decided with the implementation.
3. **Double charges:** reverse automatically over LTI (the kiosk answers the confirmation prompt), or handle them by hand in the portal? An LTI reversal only reaches the terminal's recent transactions.
4. *(resolved: staging uses a disjoint bill number range in the shared space)*
5. Should a retry after a decline reuse the bill reference? (Proposal: yes. Settlement only looks at successful transactions, so earlier declines don't matter.)
6. Do webhooks cost extra on our Wallee plan, now that the feature is switched on?

Resolved by the spike: TWINT goes through the terminal with the same reference flow, and webhooks are available, delivered fast and signed.
