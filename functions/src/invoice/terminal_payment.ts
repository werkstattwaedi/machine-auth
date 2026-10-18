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
 *     one transaction, closes the checkout with exactly what the attempt
 *     priced and mints the bill already paid and committed. `onBillCreate`
 *     then renders and mails the Quittung (`isCommittedAtClose`). What
 *     changed on the visit since the attempt was priced is put back to the
 *     priced state and reported for a person to follow up.
 *
 * The client never tells the backend that something is paid; only Wallee
 * does. A faked approval in the kiosk UI leaves the checkout open.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  getFirestore,
  DocumentReference,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";
import {
  chfToRappen,
  formatTerminalReference,
  isMachineItem,
  parseTerminalReference,
} from "@oww/shared";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  CheckoutSummaryEntity,
  TerminalAttemptEntity,
} from "../types/firestore_entities";
import {
  assertCheckoutPrincipal,
  effectiveUid,
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
      const paidAtTerminal = checkout.paymentMethod === "wallee_terminal";
      throw new HttpsError("failed-precondition", "Dieser Besuch ist bereits abgeschlossen.", {
        reason: CHECKOUT_CLOSED_REASON,
        paidAtTerminal,
        // For the paid screen, which may not have priced an attempt yet.
        ...(paidAtTerminal
          ? {
            amount: checkout.summary?.totalPrice ?? null,
            payerEmail: payerFromPersons(checkout.persons ?? [])?.email ?? null,
          }
          : {}),
      });
    }
    if ((checkout.terminalAttemptCount ?? 0) >= MAX_TERMINAL_ATTEMPTS) {
      throw new HttpsError(
        "failed-precondition",
        "Zu viele Zahlungsversuche. Bitte melde dich beim Team.",
      );
    }

    const { summary, itemDocs } = await priceOpenCheckout(tx, resolved, checkout, data.summary);
    // A free visit has nothing to charge: it closes with "Abschliessen".
    if (summary.totalPrice <= 0) {
      throw new HttpsError("failed-precondition", "Für diesen Besuch ist nichts zu bezahlen.");
    }

    // Which machine sessions the machine rows hold now: a session uploaded
    // later lands on the same row, and only the priced ones are paid.
    const items: Record<string, CheckoutItemEntity> = {};
    const machineUsageIds: Record<string, string[]> = {};
    for (const doc of itemDocs) {
      const item = doc.data() as CheckoutItemEntity;
      items[doc.id] = item;
      if (isMachineItem(item)) {
        const usage = await tx.get(linkedUsageQuery(doc.ref));
        machineUsageIds[doc.id] = usage.docs.map((d) => d.id);
      }
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
      items,
      machineUsageIds,
      checkoutPersonsKey: stableKey(checkout.persons ?? []),
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

  let changes: CheckoutChanges | null = null;
  const outcome = await db.runTransaction(async (tx): Promise<SettleOutcome> => {
    changes = null;
    const snap = await tx.get(checkoutRef);
    const judged = judgeCheckout(
      snap.data() as CheckoutEntity | undefined,
      transaction,
      ref.attempt,
    );
    if (typeof judged === "string") return judged;
    const { checkout, attempt } = judged;
    // The person paid for what was priced: the Quittung's lines (read from
    // the items) must add up to that, so the items go back to the snapshot.
    // Reads first — a transaction can't read after writing.
    const itemsSnap = await tx.get(checkoutRef.collection("items"));
    const current = new Map(itemsSnap.docs.map((d) => [d.id, d.data() as CheckoutItemEntity]));
    const machineRowIds = new Set<string>();
    for (const [id, item] of [...current, ...Object.entries(attempt.items)]) {
      if (isMachineItem(item)) machineRowIds.add(id);
    }
    const lostUsage: string[] = [];
    for (const id of machineRowIds) {
      const priced = new Set(attempt.machineUsageIds[id] ?? []);
      const usage = await tx.get(linkedUsageQuery(checkoutRef.collection("items").doc(id)));
      for (const doc of usage.docs) if (!priced.has(doc.id)) lostUsage.push(doc.id);
    }
    changes = diffAgainstAttempt(attempt, current, checkout, lostUsage);

    const billRef = db.collection("bills").doc();
    const paidAt = transaction.authorizedOn
      ? Timestamp.fromDate(transaction.authorizedOn)
      : Timestamp.now();
    await allocateBill(tx, db, {
      userId: checkout.userId ?? null,
      checkoutRefs: [checkoutRef],
      amount: attempt.amount,
      billRef,
      paymentMethod: "wallee_terminal",
      preAck: { source: "terminal" },
      paid: {
        paidAt,
        paidVia: "wallee_terminal",
        walleeTransactionId: transaction.id,
        walleeReceiptText: receiptText,
      },
    });
    if (changes) {
      const itemsCol = checkoutRef.collection("items");
      for (const id of current.keys()) {
        if (!(id in attempt.items)) tx.delete(itemsCol.doc(id));
      }
      for (const [id, item] of Object.entries(attempt.items)) {
        const now = current.get(id);
        if (!now || stableKey(now) !== stableKey(item)) tx.set(itemsCol.doc(id), item);
      }
      // Sessions that arrived after pricing stay linked (so no later upload
      // bills them on another visit) but go unbilled: the person paid for
      // what was priced. The marker says so wherever the link is read, and
      // the alert lists them for a person to follow up.
      const usageCol = db.collection("usage_machine");
      for (const id of lostUsage) {
        tx.update(usageCol.doc(id), { notBilledReason: NOT_BILLED_AFTER_VERIFIED_PAYMENT });
      }
    }
    tx.update(checkoutRef, {
      paymentMethod: "wallee_terminal",
      status: "closed",
      // As priced — also undoing a CHK-40 switch to Reguläre Nutzung that
      // machine time arriving during the payment caused (that time goes
      // unbilled, see above).
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
  if (outcome === "settled" && changes) {
    await alertOnce("checkout-changed", transaction.id, { ...logFields, changes });
  }
  return outcome;
}

/**
 * `usage_machine.notBilledReason` of a session that reached a checkout after
 * a verified payment priced it: linked, but in no row's minutes or price.
 */
export const NOT_BILLED_AFTER_VERIFIED_PAYMENT = "after_verified_payment";

/** `usage_machine` records accumulated into a checkout's machine row. */
function linkedUsageQuery(itemRef: DocumentReference) {
  return getFirestore().collection("usage_machine").where("checkoutItemRef", "==", itemRef);
}

/**
 * What changed on the visit since the attempt was priced, ids and
 * quantities only (it goes to the logs). Null when nothing did.
 */
interface CheckoutChanges {
  added: { id: string; description: string; quantity: number }[];
  removed: { id: string; description: string; quantity: number }[];
  changed: { id: string; description: string; quantityDelta: number }[];
  /** Machine sessions that arrived after pricing: linked, never billed. */
  lostUsageIds: string[];
  personsChanged: boolean;
}

function diffAgainstAttempt(
  attempt: TerminalAttemptEntity,
  current: Map<string, CheckoutItemEntity>,
  checkout: CheckoutEntity,
  lostUsageIds: string[],
): CheckoutChanges | null {
  const changes: CheckoutChanges = {
    added: [],
    removed: [],
    changed: [],
    lostUsageIds,
    personsChanged: stableKey(checkout.persons ?? []) !== attempt.checkoutPersonsKey,
  };
  for (const [id, item] of current) {
    if (!(id in attempt.items)) {
      changes.added.push({ id, description: item.description, quantity: item.quantity });
    }
  }
  for (const [id, item] of Object.entries(attempt.items)) {
    const now = current.get(id);
    if (!now) {
      changes.removed.push({ id, description: item.description, quantity: item.quantity });
    } else if (stableKey(now) !== stableKey(item)) {
      changes.changed.push({
        id,
        description: item.description,
        quantityDelta: Math.round(((now.quantity ?? 0) - (item.quantity ?? 0)) * 1000) / 1000,
      });
    }
  }
  const any =
    changes.added.length > 0 ||
    changes.removed.length > 0 ||
    changes.changed.length > 0 ||
    lostUsageIds.length > 0 ||
    changes.personsChanged;
  return any ? changes : null;
}

/**
 * A comparable string of Firestore data: keys sorted, references by path,
 * timestamps by millis (JSON would expand a reference's whole client).
 */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
    const raw = this[key];
    if (raw instanceof DocumentReference) return `ref:${raw.path}`;
    if (raw instanceof Timestamp) return `ts:${raw.toMillis()}`;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return v;
  });
}

/**
 * What the checkout says about a paid transaction for it: an outcome when
 * it can't settle, otherwise the attempt it settles.
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
    // A double charge is money for a checkout already closed — by another
    // attempt, another method or a cancellation. All of these are refunded
    // by hand in the Wallee portal for now (ADR-0051).
    case "unmatched":
    case "amount-mismatch":
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
  // Settled with what was paid; what changed on the visit since (items,
  // late machine sessions, persons) is followed up by hand.
  "checkout-changed": { event: "terminal_checkout_changed", level: "warn" },
  "double-charge": { event: "terminal_double_charge", level: "error" },
  "voided": { event: "terminal_payment_voided", level: "error" },
};
type AlertOutcome =
  | "unmatched"
  | "amount-mismatch"
  | "checkout-changed"
  | "double-charge"
  | "voided";

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
