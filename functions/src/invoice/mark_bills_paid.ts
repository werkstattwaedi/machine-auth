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
import {
  ADMIN_PAID_VIA,
  MAX_BILLS_PER_CALL,
  PAID_AT_MAX_MS,
  PAID_AT_MIN_MS,
  type MarkBillPaidInput,
  type MarkBillsPaidRequest,
  type MarkBillsPaidResult,
} from "@oww/shared";
import type { BillEntity } from "./types";

export type { MarkBillPaidInput, MarkBillsPaidRequest, MarkBillsPaidResult };

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
    if (!ADMIN_PAID_VIA.includes(b.paidVia)) {
      throw new HttpsError(
        "invalid-argument",
        `paidVia must be one of ${ADMIN_PAID_VIA.join(", ")}`
      );
    }
    if (b.paidAtMs != null) {
      // Value dates land on financial PDFs — reject garbage (NaN, epoch 0,
      // far-future timestamps from unit-confused callers) outright.
      if (
        !Number.isFinite(b.paidAtMs) ||
        b.paidAtMs < PAID_AT_MIN_MS ||
        b.paidAtMs > PAID_AT_MAX_MS
      ) {
        throw new HttpsError(
          "invalid-argument",
          "paidAtMs must be an epoch-ms timestamp between 2000 and 2100"
        );
      }
    }
    return { billId: b.billId, paidVia: b.paidVia, paidAtMs: b.paidAtMs };
  });
}

type BookOutcome = "paid" | "alreadyPaid" | "rejected";

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
  // one bad id reject without failing the whole batch. The outcome is
  // aggregated OUTSIDE the transaction callback — Firestore retries the
  // callback on contention, so mutating `result` inside it would count a
  // retried bill twice.
  for (const input of inputs) {
    const ref = db.doc(`bills/${input.billId}`);
    const outcome = await db.runTransaction<BookOutcome>(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return "rejected";
      const bill = snap.data() as BillEntity;
      if ((bill.kind ?? "invoice") === "beleg") {
        // Belege are folded into the monthly Sammelrechnung; the payment
        // books against that aggregate invoice, never the Beleg itself.
        return "rejected";
      }
      if (bill.paidAt) return "alreadyPaid";
      tx.update(ref, {
        paidAt: input.paidAtMs
          ? Timestamp.fromMillis(input.paidAtMs)
          : Timestamp.now(),
        paidVia: input.paidVia,
        modifiedAt: Timestamp.now(),
        modifiedBy: request.auth?.uid ?? null,
      });
      return "paid";
    });
    if (outcome === "paid") result.paid += 1;
    else if (outcome === "alreadyPaid") result.alreadyPaid.push(input.billId);
    else result.rejected.push(input.billId);
  }

  logger.info("adminMarkBillsPaid", {
    adminUid: request.auth?.uid,
    requested: inputs.length,
    ...result,
  });
  return result;
};
