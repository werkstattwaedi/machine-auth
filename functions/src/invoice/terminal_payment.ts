// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Paying at the kiosk's Wallee terminal (ADR-0051).
 *
 * The checkout stays open while the terminal waits, so "Abbrechen" and
 * "Zurück" can still return to an editable step 3 — which means no bill
 * (and no bill number) exists to send to the terminal. Instead:
 *
 *  1. `prepareTerminalPayment` validates and prices the close exactly like
 *     `closeCheckoutAndGetPayment`, creates no bill, and stores the priced
 *     input as an *attempt* on the open checkout. Its reference
 *     (`{P|S}-{checkoutId}-{attempt}`) goes to the terminal as
 *     `merchantReference`.
 *  2. Wallee confirms the payment by webhook (or the nightly reconcile
 *     finds it). `settleTerminalPayment` re-reads the transaction and, in
 *     one transaction, closes the checkout from the attempt and mints the
 *     bill already paid and committed. `onBillCreate` then renders and
 *     mails the Quittung (`isCommittedAtClose`).
 *
 * The client never tells the backend that something is paid; only Wallee
 * does. A faked approval in the kiosk UI leaves the checkout open.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";
import {
  chfToRappen,
  formatTerminalReference,
  parseTerminalReference,
} from "@oww/shared";
import type {
  CheckoutEntity,
  CheckoutSummaryEntity,
  TerminalAttemptEntity,
} from "../types/firestore_entities";
import {
  assertCheckoutPrincipal,
  effectiveUid,
  itemsFingerprint,
  isAnonymousCaller,
  payerFromPersons,
  priceOpenCheckout,
  resolveExistingClose,
  type ClosePersonInput,
} from "./close_checkout_and_get_payment";
import { allocateBill } from "./create_bill";
import { assertPaymentMethodAllowed } from "./commit_payment_method";
import {
  WALLEE_PAID_STATES,
  walleeApi,
  walleeConfig,
  type WalleeConfig,
  type WalleeTransaction,
} from "../payments/wallee";

/** Below this the amounts are the same CHF value (float noise). */
const AMOUNT_TOLERANCE = 0.005;

/**
 * Attempts per checkout. Each stores a copy of the priced close; a person
 * retrying this often needs the team, not another try.
 */
export const MAX_TERMINAL_ATTEMPTS = 10;

/**
 * `details.reason` of the refusal when the checkout already closed — most
 * often because Wallee settled a payment the screen lost track of. The
 * kiosk then shows the payment as done instead of an error.
 */
export const CHECKOUT_CLOSED_REASON = "checkout-closed";

export interface PrepareTerminalPaymentRequest {
  checkoutId?: string;
  persons?: ClosePersonInput[];
  summary?: CheckoutSummaryEntity;
}

export interface PrepareTerminalPaymentResponse {
  checkoutId: string;
  attempt: number;
  /** Sent to the terminal as `merchantReference`. */
  reference: string;
  /** CHF, what the person pays. */
  amount: number;
  amountRappen: number;
  /** Where the Quittung goes, for the confirmation on screen. */
  payerEmail: string;
}

/**
 * Callable (`billingCall`): price a terminal attempt on an open checkout.
 * Takes the close's input; the donation and round-up exist only in the
 * client until then, so the attempt is the first place they are stored.
 *
 * Unlike the close it has no `newCheckout` branch: the kiosk creates the
 * checkout when the visit starts, so an open one always exists by step 3.
 */
export const prepareTerminalPaymentHandler = async (
  request: CallableRequest<PrepareTerminalPaymentRequest>,
): Promise<PrepareTerminalPaymentResponse> => {
  const data = request.data ?? {};
  const { checkoutId, persons } = data;
  if (typeof checkoutId !== "string" || !checkoutId) {
    throw new HttpsError("invalid-argument", "checkoutId is required");
  }
  if (!Array.isArray(persons) || persons.length === 0) {
    throw new HttpsError("invalid-argument", "persons is required");
  }
  const callerUid = effectiveUid(request);
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Sign-in required");
  }
  const config = walleeConfig();
  if (!config) {
    throw new HttpsError("failed-precondition", "Das Terminal ist nicht eingerichtet.");
  }
  const isAnonymous = isAnonymousCaller(request);

  const resolved = await resolveExistingClose(callerUid, isAnonymous, {
    checkoutId,
    persons,
    context: `prepareTerminalPayment ${checkoutId}`,
  });
  const db = getFirestore();
  // Also refuses the method while the ops config offers it nowhere.
  await assertPaymentMethodAllowed(
    "wallee_terminal",
    resolved.ownerId ? db.collection("users").doc(resolved.ownerId) : null,
  );

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(resolved.checkoutRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Checkout ${checkoutId} not found`);
    }
    const checkout = snap.data() as CheckoutEntity;
    assertCheckoutPrincipal(checkout, callerUid, isAnonymous);
    if (checkout.status !== "open") {
      throw new HttpsError("failed-precondition", "Dieser Besuch ist bereits abgeschlossen.", {
        reason: CHECKOUT_CLOSED_REASON,
        paidAtTerminal: checkout.paymentMethod === "wallee_terminal",
      });
    }
    if ((checkout.terminalAttemptCount ?? 0) >= MAX_TERMINAL_ATTEMPTS) {
      throw new HttpsError(
        "failed-precondition",
        "Zu viele Zahlungsversuche. Bitte melde dich beim Team.",
      );
    }

    const { summary, itemsKey } = await priceOpenCheckout(tx, resolved, checkout, data.summary);
    // A free visit has nothing to charge: it closes with "Abschliessen".
    if (summary.totalPrice <= 0) {
      throw new HttpsError("failed-precondition", "Für diesen Besuch ist nichts zu bezahlen.");
    }

    const attempt = (checkout.terminalAttemptCount ?? 0) + 1;
    const reference = formatTerminalReference({
      env: config.referenceEnv,
      checkoutId,
      attempt,
    });
    const entry: TerminalAttemptEntity = {
      reference,
      amount: summary.totalPrice,
      usageType: resolved.visitUsageType,
      persons: resolved.persons,
      summary,
      itemsKey,
      preparedBy: callerUid,
      createdAt: Timestamp.now(),
    };
    tx.update(resolved.checkoutRef, {
      [`terminalAttempts.${attempt}`]: entry,
      terminalAttemptCount: attempt,
    });
    logger.info("terminal_payment_prepared", {
      event: "terminal_payment_prepared",
      checkoutId,
      attempt,
      amount: summary.totalPrice,
    });
    return {
      checkoutId,
      attempt,
      reference,
      amount: summary.totalPrice,
      amountRappen: chfToRappen(summary.totalPrice),
      payerEmail: payerFromPersons(resolved.persons)?.email ?? "",
    };
  });
};

/** What a settlement did, for logs and tests. */
export type SettleOutcome =
  /** Closed the checkout with a paid bill. */
  | "settled"
  /** Already closed by this transaction (a repeated delivery). */
  | "already-settled"
  /** Not a paid terminal payment of ours (state, terminal, interface). */
  | "ignored"
  /** A reference of the environment sharing the Wallee space. */
  | "other-environment"
  /** Paid, but no checkout or attempt of ours matches it. */
  | "unmatched"
  /** The authorized amount differs from the attempt. */
  | "amount-mismatch"
  /** The visit's items changed after the attempt was priced. */
  | "items-changed"
  /** The checkout was already closed by something else: money twice. */
  | "double-charge";

/**
 * Decides what a Wallee transaction means for us without touching
 * Firestore; null when it should go on to the checkout. Exported for unit
 * tests.
 */
export function classifyTransaction(
  transaction: WalleeTransaction,
  config: WalleeConfig,
): SettleOutcome | null {
  if (!WALLEE_PAID_STATES.has(transaction.state)) return "ignored";
  if (transaction.userInterfaceType !== "TERMINAL") return "ignored";
  if (transaction.terminalId !== config.terminalId) return "ignored";
  const ref = parseTerminalReference(transaction.merchantReference);
  if (!ref) return "unmatched";
  if (ref.env !== config.referenceEnv) return "other-environment";
  if ((transaction.currency ?? "").toUpperCase() !== "CHF") return "amount-mismatch";
  return null;
}

/**
 * The only way a terminal payment closes a checkout. Re-reads the
 * transaction from Wallee — a webhook body carries ids only and deliveries
 * arrive out of order — and settles it idempotently. Throws on transient
 * errors (Wallee API, Firestore) so the webhook answers 5xx and Wallee
 * retries.
 */
export async function settleTerminalPayment(
  transactionId: number,
  source: "webhook" | "reconcile",
): Promise<SettleOutcome> {
  const config = walleeConfig();
  if (!config) return "ignored";
  const api = await walleeApi();
  const transaction = await api.getTransaction(transactionId);
  return settleTransaction(transaction, source, config);
}

/** `settleTerminalPayment` after the read; the reconcile hands in search results. */
export async function settleTransaction(
  transaction: WalleeTransaction,
  source: "webhook" | "reconcile",
  config: WalleeConfig,
): Promise<SettleOutcome> {
  const fields = {
    transactionId: transaction.id,
    reference: transaction.merchantReference,
    state: transaction.state,
    amount: transaction.authorizationAmount,
    source,
  };

  if (transaction.state === "VOIDED") {
    await alertIfSettledPaymentVoided(transaction, config, fields);
    return "ignored";
  }

  const early = classifyTransaction(transaction, config);
  if (early === "ignored") return early;
  if (early === "other-environment") {
    logger.debug("terminal payment of the other environment", fields);
    return early;
  }
  if (early === "unmatched") {
    // A sale started on the terminal itself (its own id as reference), or
    // a payment whose reference we can't read: money with no checkout.
    await alertOnce(early, transaction.id, fields);
    return early;
  }
  if (early === "amount-mismatch") {
    await alertOnce(early, transaction.id, { currency: transaction.currency, ...fields });
    return early;
  }

  const ref = parseTerminalReference(transaction.merchantReference)!;
  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc(ref.checkoutId);
  const logFields = { ...fields, checkoutId: ref.checkoutId, attempt: ref.attempt };

  // The reconcile hands in every paid payment of the last days, nearly all
  // settled long ago: decide those from a plain read, without the receipt
  // call and the transaction. Only what may settle goes on.
  const settled = judgeCheckout(
    (await checkoutRef.get()).data() as CheckoutEntity | undefined,
    transaction,
    ref.attempt,
  );
  if (typeof settled === "string") {
    await reportOutcome(settled, transaction.id, logFields);
    return settled;
  }

  // Fetched before the transaction: a network call has no place inside
  // one. Wallee requires the cardholder receipt on the customer's document;
  // without it we still settle (the money is real) and log for a reprint.
  let receiptText: string | null = null;
  try {
    receiptText = await (await walleeApi()).getCustomerReceiptText(transaction.id);
  } catch (err) {
    logger.error("terminal_receipt_missing", {
      event: "terminal_receipt_missing",
      error: err instanceof Error ? err.message : String(err),
      ...fields,
    });
  }

  const outcome = await db.runTransaction(async (tx): Promise<SettleOutcome> => {
    const snap = await tx.get(checkoutRef);
    const judged = judgeCheckout(
      snap.data() as CheckoutEntity | undefined,
      transaction,
      ref.attempt,
    );
    if (typeof judged === "string") return judged;
    const { checkout, attempt } = judged;
    // The bill and summary come from the attempt, the Quittung's lines from
    // the items: they must still be the ones that were priced.
    const itemsSnap = await tx.get(checkoutRef.collection("items"));
    if (attempt.itemsKey !== undefined && itemsFingerprint(itemsSnap.docs) !== attempt.itemsKey) {
      return "items-changed";
    }

    const billRef = db.collection("bills").doc();
    const paidAt = transaction.authorizedOn
      ? Timestamp.fromDate(transaction.authorizedOn)
      : Timestamp.now();
    await allocateBill(tx, db, {
      userId: checkout.userId ?? null,
      checkoutRefs: [checkoutRef],
      amount: attempt.amount,
      billRef,
      preAck: { source: "terminal" },
      paid: {
        paidAt,
        paidVia: "wallee_terminal",
        walleeTransactionId: transaction.id,
        walleeReceiptText: receiptText,
      },
    });
    tx.update(checkoutRef, {
      paymentMethod: "wallee_terminal",
      status: "closed",
      usageType: attempt.usageType,
      persons: attempt.persons,
      closedAt: FieldValue.serverTimestamp(),
      notes: null,
      summary: attempt.summary,
      modifiedBy: attempt.preparedBy,
      modifiedAt: FieldValue.serverTimestamp(),
      billRef,
      walleeTransactionId: transaction.id,
      terminalAttempts: FieldValue.delete(),
    });
    return "settled";
  });

  await reportOutcome(outcome, transaction.id, logFields);
  return outcome;
}

/**
 * What the checkout says about a paid transaction for it: an outcome when
 * it can't settle, otherwise the attempt it settles. The items are checked
 * inside the settling transaction only.
 */
function judgeCheckout(
  checkout: CheckoutEntity | undefined,
  transaction: WalleeTransaction,
  attemptNumber: number,
): SettleOutcome | { checkout: CheckoutEntity; attempt: TerminalAttemptEntity } {
  if (!checkout) return "unmatched";
  if (checkout.status !== "open") {
    return checkout.walleeTransactionId === transaction.id ? "already-settled" : "double-charge";
  }
  const attempt = checkout.terminalAttempts?.[String(attemptNumber)];
  if (!attempt || attempt.reference !== transaction.merchantReference) return "unmatched";
  if (
    transaction.authorizationAmount === null ||
    Math.abs(transaction.authorizationAmount - attempt.amount) >= AMOUNT_TOLERANCE
  ) {
    return "amount-mismatch";
  }
  return { checkout, attempt };
}

async function reportOutcome(
  outcome: SettleOutcome,
  transactionId: number,
  logFields: Record<string, unknown>,
): Promise<void> {
  switch (outcome) {
    case "settled":
      logger.info("terminal_payment_settled", { event: "terminal_payment_settled", ...logFields });
      break;
    case "unmatched":
    case "amount-mismatch":
    // Paid for a version of the visit that no longer exists; the checkout
    // stays open for the current one. Refunded by hand.
    case "items-changed":
    // Money arrived for a checkout that is already closed — by another
    // attempt, another method or a cancellation. Refunded by hand in the
    // Wallee portal for now (ADR-0051).
    case "double-charge":
      await alertOnce(outcome, transactionId, logFields);
      break;
    default:
      break;
  }
}

/** Log event and level of each outcome a person has to look at. */
const ALERTS: Record<AlertOutcome, { event: string; level: "warn" | "error" }> = {
  "unmatched": { event: "terminal_unmatched_payment", level: "warn" },
  "amount-mismatch": { event: "terminal_amount_mismatch", level: "error" },
  "items-changed": { event: "terminal_items_changed", level: "error" },
  "double-charge": { event: "terminal_double_charge", level: "error" },
  "voided": { event: "terminal_payment_voided", level: "error" },
};
type AlertOutcome = "unmatched" | "amount-mismatch" | "items-changed" | "double-charge" | "voided";

/** Markers outlive the reconcile's window, then Firestore TTL drops them. */
const ALERT_MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Raises an alert once per transaction and outcome. The webhook's retries
 * and the reconcile see the same transaction again for days; a marker in
 * `terminalPaymentAlerts` turns the repeats into an info line. Failing to
 * write the marker alerts anyway: a repeat beats a missed alert.
 */
async function alertOnce(
  outcome: AlertOutcome,
  transactionId: number,
  fields: Record<string, unknown>,
): Promise<void> {
  const { event, level } = ALERTS[outcome];
  const now = Date.now();
  try {
    await getFirestore()
      .collection("terminalPaymentAlerts")
      .doc(`${transactionId}_${outcome}`)
      .create({
        transactionId,
        outcome,
        reference: typeof fields.reference === "string" ? fields.reference : null,
        createdAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + ALERT_MARKER_TTL_MS),
      });
  } catch (err) {
    if ((err as { code?: number }).code === ALREADY_EXISTS) {
      logger.info(`${event} (already reported)`, { ...fields, outcome });
      return;
    }
  }
  logger[level](event, { event, ...fields });
}

/** gRPC status of a `create()` on an existing document. */
const ALREADY_EXISTS = 6;

/**
 * A reversal at the terminal or in the portal after we closed the checkout
 * leaves a bill marked paid for money that went back. Un-settling a closed
 * visit (and its mailed Quittung) is a correction, so for now it is an
 * alert for the Kasse to handle by hand (ADR-0051).
 */
async function alertIfSettledPaymentVoided(
  transaction: WalleeTransaction,
  config: WalleeConfig,
  fields: Record<string, unknown>,
): Promise<void> {
  const ref = parseTerminalReference(transaction.merchantReference);
  if (!ref || ref.env !== config.referenceEnv) return;
  const snap = await getFirestore().collection("checkouts").doc(ref.checkoutId).get();
  const checkout = snap.data() as CheckoutEntity | undefined;
  if (checkout?.walleeTransactionId !== transaction.id) return;
  await alertOnce("voided", transaction.id, {
    checkoutId: ref.checkoutId,
    billId: checkout.billRef?.id ?? null,
    ...fields,
  });
}
