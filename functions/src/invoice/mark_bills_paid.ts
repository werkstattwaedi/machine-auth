// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `adminMarkBillsPaid` — bulk payment booking from the admin Rechnungen
 * workspace (manual mark-paid and the bank-statement import).
 *
 * Bills stay client-write-denied in firestore.rules; this callable is the
 * single write path so the invariants hold: only unpaid `kind: "invoice"`
 * bills can be booked, already-paid bills are skipped (idempotent re-import
 * of an overlapping bank statement), and `paidAt` may carry the statement's
 * booking date instead of "now".
 *
 * No side-effects fire on `paidAt` (membership activation is ack-driven;
 * the daily auto-ack cron covers bills the user never acknowledged).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { BillEntity } from "./types";

const PAID_VIA = ["twint", "ebanking", "cash"] as const;
type PaidVia = (typeof PAID_VIA)[number];

export interface MarkBillPaidInput {
  billId: string;
  paidVia: PaidVia;
  /** Value date of the payment (e.g. from the bank statement). Defaults to now. */
  paidAtMs?: number;
}

export interface MarkBillsPaidRequest {
  bills: MarkBillPaidInput[];
}

export interface MarkBillsPaidResult {
  paid: number;
  /** Bill ids skipped because they were already paid. */
  alreadyPaid: string[];
  /** Bill ids that don't exist or are Belege (never payable on their own). */
  rejected: string[];
}

const MAX_BILLS_PER_CALL = 200;

/** Validate the wire payload; throws HttpsError on malformed input. */
export function parseMarkBillsPaidRequest(data: unknown): MarkBillPaidInput[] {
  const bills = (data as MarkBillsPaidRequest | undefined)?.bills;
  if (!Array.isArray(bills) || bills.length === 0) {
    throw new HttpsError("invalid-argument", "bills[] is required");
  }
  if (bills.length > MAX_BILLS_PER_CALL) {
    throw new HttpsError(
      "invalid-argument",
      `Too many bills (max ${MAX_BILLS_PER_CALL} per call)`
    );
  }
  return bills.map((b) => {
    if (!b || typeof b.billId !== "string" || !b.billId) {
      throw new HttpsError("invalid-argument", "billId is required");
    }
    if (!PAID_VIA.includes(b.paidVia)) {
      throw new HttpsError(
        "invalid-argument",
        `paidVia must be one of ${PAID_VIA.join(", ")}`
      );
    }
    if (b.paidAtMs != null && typeof b.paidAtMs !== "number") {
      throw new HttpsError("invalid-argument", "paidAtMs must be a number");
    }
    return { billId: b.billId, paidVia: b.paidVia, paidAtMs: b.paidAtMs };
  });
}

export const adminMarkBillsPaidHandler = async (
  request: CallableRequest<unknown>
): Promise<MarkBillsPaidResult> => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const inputs = parseMarkBillsPaidRequest(request.data);

  const db = getFirestore();
  const result: MarkBillsPaidResult = {
    paid: 0,
    alreadyPaid: [],
    rejected: [],
  };

  // Per-bill transactions keep the check-then-set race-free while letting
  // one bad id reject without failing the whole batch.
  for (const input of inputs) {
    const ref = db.doc(`bills/${input.billId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        result.rejected.push(input.billId);
        return;
      }
      const bill = snap.data() as BillEntity;
      if ((bill.kind ?? "invoice") === "beleg") {
        // Belege are folded into the monthly Sammelrechnung; the payment
        // books against that aggregate invoice, never the Beleg itself.
        result.rejected.push(input.billId);
        return;
      }
      if (bill.paidAt) {
        result.alreadyPaid.push(input.billId);
        return;
      }
      tx.update(ref, {
        paidAt: input.paidAtMs
          ? Timestamp.fromMillis(input.paidAtMs)
          : Timestamp.now(),
        paidVia: input.paidVia,
        modifiedAt: Timestamp.now(),
        modifiedBy: request.auth?.uid ?? null,
      });
      result.paid += 1;
    });
  }

  logger.info("adminMarkBillsPaid", {
    adminUid: request.auth?.uid,
    requested: inputs.length,
    ...result,
  });
  return result;
};
