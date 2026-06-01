// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Acknowledgement of payment-method choice on a bill (issues #251, #302).
 *
 * The invoice email and membership activation used to fire the moment a
 * checkout closed, before the user picked a payment method on the
 * Bezahlen step. Now both side-effects are gated on
 * `paymentMethodConfirmationTime` being written on the bill. This module
 * owns the two ways that field can land:
 *
 *  - `acknowledgeBill` callable: the user clicked the commit button on
 *    Step 4. Source `"user"`.
 *  - `autoAcknowledgeBills` cron: 03:00 Europe/Zurich daily, picks up
 *    bills older than `AUTO_ACK_MIN_AGE_HOURS` that nobody acked.
 *    Source `"auto"`.
 *
 * The `onBillUpdate` trigger in `bill_triggers.ts` watches for the
 * transition `null → set` and runs `trySendEmail` + membership
 * activation.
 */

import * as logger from "firebase-functions/logger";
import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString } from "firebase-functions/params";
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentReference,
} from "firebase-admin/firestore";
import type { BillEntity } from "./types";
import type {
  CheckoutEntity,
  PaymentMethod,
} from "../types/firestore_entities";

const autoAckMinAgeHours = defineString("AUTO_ACK_MIN_AGE_HOURS", {
  default: "1",
});

/** Cap how many docs the cron touches per run so a runaway backlog can't OOM. */
const BATCH_LIMIT = 500;

const VALID_PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set([
  "rechnung",
  "monthly",
  "twint",
]);

interface AcknowledgeBillRequest {
  billId: string;
  paymentMethod: PaymentMethod;
}

/**
 * The user the caller is authorized to act as.
 *
 * Mirrors the helper in `close_checkout_and_get_payment.ts` — real
 * logins return `request.auth.uid`; kiosk tag-tap sessions return the
 * `actsAs` claim.
 */
function effectiveUid(
  request: CallableRequest<unknown>,
): string | null {
  const claims = request.auth?.token as { actsAs?: unknown } | undefined;
  if (typeof claims?.actsAs === "string" && claims.actsAs.length > 0) {
    return claims.actsAs;
  }
  return request.auth?.uid ?? null;
}

function isAnonymousCaller(
  request: CallableRequest<unknown>,
): boolean {
  const provider = (request.auth?.token as
    | { firebase?: { sign_in_provider?: string } }
    | undefined)?.firebase?.sign_in_provider;
  return provider === "anonymous";
}

export const acknowledgeBillHandler = async (
  request: CallableRequest<AcknowledgeBillRequest>
) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { billId, paymentMethod } = request.data ?? ({} as AcknowledgeBillRequest);
  if (!billId || typeof billId !== "string") {
    throw new HttpsError("invalid-argument", "billId is required");
  }
  if (!VALID_PAYMENT_METHODS.has(paymentMethod)) {
    throw new HttpsError("invalid-argument", "invalid paymentMethod");
  }

  const db = getFirestore();
  const billRef = db.doc(`bills/${billId}`);
  const billSnap = await billRef.get();
  if (!billSnap.exists) {
    throw new HttpsError("not-found", "Bill not found");
  }

  const bill = billSnap.data() as BillEntity;
  const isAdmin = request.auth.token.admin === true;
  const callerUid = effectiveUid(request);

  // Authorisation: real/tag-tap principal owns the bill, OR an anonymous
  // session matches an anonymous (null-userId) checkout, OR admin claim.
  const isOwner =
    callerUid !== null &&
    bill.userId !== null &&
    bill.userId.id === callerUid;

  let isAnonOwner = false;
  if (!isOwner && !isAdmin && bill.userId === null && isAnonymousCaller(request)) {
    // null-userId bills come from the truly-anonymous flow; any anon
    // session can ack them, mirroring the existing firestore.rules
    // carve-out for null-userId closed checkouts. The previous write-
    // once protection is gone (the checkout's paymentMethod is multi-
    // write now), so an attacker who learns a bill ID could in theory
    // fix the email template to "rechnung" before the legitimate user
    // commits. Threat model: bill IDs are random 20-char Firebase doc
    // IDs, the email only reveals what method was selected, and the
    // 03:00 cron is a backstop. Acceptable, but flagged here so the
    // next reviewer doesn't have to re-derive it.
    isAnonOwner = true;
  }

  if (!isAdmin && !isOwner && !isAnonOwner) {
    throw new HttpsError("permission-denied", "Access denied");
  }

  // Idempotent: a second click after the first one landed returns OK
  // without rewriting. The frontend may double-fire under double-tap.
  // For monthly: the bill has already been flipped to kind "beleg" — same
  // short-circuit, since the kind transition is the commit-of-record.
  if (bill.paymentMethodConfirmationTime || (bill.kind ?? "invoice") === "beleg") {
    return { ok: true };
  }

  const linkedCheckoutRef =
    bill.checkouts.length > 0 ? bill.checkouts[0] : null;

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(billRef);
    if (!fresh.exists) {
      throw new HttpsError("not-found", "Bill not found");
    }
    const freshBill = fresh.data() as BillEntity;
    if (freshBill.paymentMethodConfirmationTime) {
      return;
    }
    if ((freshBill.kind ?? "invoice") === "beleg") {
      return;
    }

    const now = Timestamp.now();
    if (paymentMethod === "monthly") {
      // Sammelrechnung path (issue #245): the per-visit bill becomes a
      // "Beleg" — a non-payable record of what was used this visit. The
      // monthlyBillRun cron aggregates Belege into a real Sammelrechnung
      // QR-bill on the 1st of the following month. We deliberately do
      // NOT stamp paymentMethodConfirmationTime — keeping it null means
      // the email/membership triggers in `onBillUpdate` stay no-ops, and
      // the auto-ack cron doesn't pick this back up (it skips Belege).
      //
      // We don't write `aggregatedIntoBillRef: null` here because the
      // field is initialized by `allocateBill` at bill-creation time.
      // For pre-deploy bills the field is absent, but Firestore's
      // `== null` predicate on the cron query matches both absent and
      // explicit null — so no backfill is needed.
      tx.update(billRef, { kind: "beleg" });
    } else {
      tx.update(billRef, {
        paymentMethodConfirmationTime: now,
        paymentMethodConfirmationSource: "user",
      });
    }

    if (linkedCheckoutRef) {
      tx.update(linkedCheckoutRef, {
        paymentMethod,
        modifiedBy: callerUid,
        modifiedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  logger.info("acknowledgeBill: user-acked bill", {
    billId,
    paymentMethod,
    callerUid,
    flipped: paymentMethod === "monthly" ? "beleg" : "ack",
  });

  return { ok: true };
};

interface AutoAckSummary {
  /** Bills where the auto-ack stamp landed (will email + activate membership). */
  ackedIds: string[];
  /** Bills flipped to Beleg because the linked checkout had paymentMethod "monthly". */
  belegFlippedIds: string[];
}

/**
 * Core loop, exported so the integration test can invoke it directly
 * against the Firestore emulator (no scheduler runtime needed). Returns
 * the bills that landed an auto-ack stamp and (separately) the bills
 * that were flipped to Beleg for the monthly aggregation cron — they
 * share the same loop but mean different things downstream.
 */
export async function runAutoAcknowledgeBills(
  now: Date = new Date(),
): Promise<AutoAckSummary> {
  const db = getFirestore();
  const minAgeHours = Number(autoAckMinAgeHours.value()) || 1;
  const cutoff = Timestamp.fromMillis(
    now.getTime() - minAgeHours * 60 * 60 * 1000,
  );

  const snap = await db
    .collection("bills")
    .where("paymentMethodConfirmationTime", "==", null)
    .where("created", "<", cutoff)
    .limit(BATCH_LIMIT)
    .get();

  if (snap.empty) {
    return { ackedIds: [], belegFlippedIds: [] };
  }

  const ackedIds: string[] = [];
  const belegFlippedIds: string[] = [];
  const ackTime = Timestamp.fromDate(now);

  for (const doc of snap.docs) {
    const bill = doc.data() as BillEntity;

    // Free bills are pre-acked at creation, but defensive belt-and-suspenders.
    if (bill.paidVia === "free") continue;
    // Belege are never acked — they wait for monthlyBillRun.
    if ((bill.kind ?? "invoice") === "beleg") continue;

    const linkedCheckoutRef: DocumentReference | null =
      bill.checkouts.length > 0 ? bill.checkouts[0] : null;

    type Outcome = "acked" | "beleg" | "skipped";
    const outcome = await db.runTransaction<Outcome>(async (tx) => {
      // Read both docs INSIDE the transaction so a tab-click that lands
      // between the outer query and the transaction commit isn't
      // overwritten by the auto-rechnung backfill below.
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return "skipped";
      const freshBill = fresh.data() as BillEntity;
      if (freshBill.paymentMethodConfirmationTime) return "skipped";
      if ((freshBill.kind ?? "invoice") === "beleg") return "skipped";

      let checkoutPaymentMethod: PaymentMethod | null = null;
      if (linkedCheckoutRef) {
        const coSnap = await tx.get(linkedCheckoutRef);
        if (coSnap.exists) {
          const co = coSnap.data() as CheckoutEntity;
          checkoutPaymentMethod = co.paymentMethod ?? null;
        }
      }

      // Sammelrechnung path (issue #245): a member who picked the
      // monthly tab on Step 4 but never tapped commit. Mirror the
      // user-ack-for-monthly transition — flip to Beleg instead of
      // emailing a per-visit invoice. The monthlyBillRun cron sweeps
      // up these Belege on the 1st.
      if (checkoutPaymentMethod === "monthly") {
        tx.update(doc.ref, { kind: "beleg" });
        return "beleg";
      }

      tx.update(doc.ref, {
        paymentMethodConfirmationTime: ackTime,
        paymentMethodConfirmationSource: "auto",
      });

      // Backfill the checkout's paymentMethod to "rechnung" only if the
      // user never picked anything. Don't overwrite a real selection.
      if (linkedCheckoutRef && !checkoutPaymentMethod) {
        tx.update(linkedCheckoutRef, {
          paymentMethod: "rechnung",
          modifiedAt: FieldValue.serverTimestamp(),
        });
      }
      return "acked";
    });

    if (outcome === "acked") ackedIds.push(doc.id);
    else if (outcome === "beleg") belegFlippedIds.push(doc.id);
  }

  logger.info("autoAcknowledgeBills: processed unconfirmed bills", {
    ackedCount: ackedIds.length,
    belegFlippedCount: belegFlippedIds.length,
    cutoffIso: cutoff.toDate().toISOString(),
    minAgeHours,
    sampleAckedIds: ackedIds.slice(0, 10),
    sampleBelegFlippedIds: belegFlippedIds.slice(0, 10),
  });

  return { ackedIds, belegFlippedIds };
}

/**
 * Scheduled trigger. 03:00 Europe/Zurich daily — picks up un-acked bills
 * from the previous day so the email + membership activation can flow
 * for users who walked out without committing.
 */
export const autoAcknowledgeBills = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "Europe/Zurich",
    timeoutSeconds: 540,
  },
  async () => {
    await runAutoAcknowledgeBills();
  },
);
