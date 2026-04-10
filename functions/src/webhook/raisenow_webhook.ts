// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * RaiseNow webhook receiver for TWINT payment notifications.
 *
 * When a TWINT payment succeeds, RaiseNow sends a POST with the payment
 * details. We match the SCOR reference to a bill and mark it as paid.
 *
 * NOTE: The exact header name for the HMAC signature and the field paths
 * in the webhook payload need to be confirmed from RaiseNow Hub docs.
 * Current assumptions are marked with "// TODO: confirm with RaiseNow".
 */

import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { verifyHmacSignature } from "./verify_hmac";
import { validateScorReference } from "../invoice/scor_reference";
import type { BillEntity } from "../invoice/types";

const raisenowWebhookSecret = defineSecret("RAISENOW_WEBHOOK_SECRET");

const raisenowApp = express();
raisenowApp.use(express.json());

// TODO: confirm with RaiseNow — the exact header name for the HMAC signature
const SIGNATURE_HEADER = "x-signature";

// TODO: confirm with RaiseNow — the event name for successful payments
const PAYMENT_SUCCEEDED_EVENT = "rnw.event.payment_gateway.payment.succeeded";

/**
 * Parse a SCOR reference and extract the numeric reference number.
 * SCOR format: "RF" + 2 check digits + zero-padded number
 */
function parseReferenceNumber(scorReference: string): number {
  if (!validateScorReference(scorReference)) {
    throw new Error(`Invalid SCOR reference: ${scorReference}`);
  }
  // Strip "RF" + 2 check digits
  const payload = scorReference.slice(4);
  const num = parseInt(payload, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Could not parse reference number from: ${scorReference}`);
  }
  return num;
}

raisenowApp.post("/", async (req: express.Request, res: express.Response) => {
  // 1. Verify HMAC signature
  const signature = req.headers[SIGNATURE_HEADER] as string | undefined;
  // Firebase Functions v2 provides rawBody on the request object
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (!signature || !rawBody) {
    logger.warn("RaiseNow webhook: missing signature or raw body");
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  if (!verifyHmacSignature(rawBody, signature, raisenowWebhookSecret.value())) {
    logger.warn("RaiseNow webhook: invalid HMAC signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // 2. Check event type
  // TODO: confirm with RaiseNow — the envelope field for the event type
  const eventType = req.body?.event ?? req.body?.event_name;

  if (eventType !== PAYMENT_SUCCEEDED_EVENT) {
    logger.info(`RaiseNow webhook: ignoring event type: ${eventType}`);
    res.status(200).json({ status: "ignored" });
    return;
  }

  // 3. Extract payment data
  // TODO: confirm with RaiseNow — the exact field paths
  const paymentData = req.body?.data ?? req.body;
  const scorReference = paymentData?.reference ?? paymentData?.structured_reference;
  const paidAmount = paymentData?.amount;

  if (!scorReference || paidAmount == null) {
    logger.error("RaiseNow webhook: missing reference or amount", {
      hasReference: !!scorReference,
      hasAmount: paidAmount != null,
    });
    res.status(400).json({ error: "Missing reference or amount" });
    return;
  }

  // 4. Parse reference number from SCOR
  let referenceNumber: number;
  try {
    referenceNumber = parseReferenceNumber(scorReference);
  } catch (err: any) {
    logger.error("RaiseNow webhook: invalid SCOR reference", {
      scorReference,
      error: err.message,
    });
    res.status(400).json({ error: "Invalid SCOR reference" });
    return;
  }

  // 5. Look up bill
  const db = getFirestore();
  const billQuery = await db
    .collection("bills")
    .where("referenceNumber", "==", referenceNumber)
    .limit(1)
    .get();

  if (billQuery.empty) {
    logger.error("RaiseNow webhook: no bill found", { referenceNumber });
    // 404 triggers RaiseNow retry — handles race conditions where
    // webhook arrives before bill is committed
    res.status(404).json({ error: "Bill not found" });
    return;
  }

  const billDoc = billQuery.docs[0];
  const bill = billDoc.data() as BillEntity;

  // 6. Idempotency: if already paid, return 200
  if (bill.paidAt !== null) {
    logger.info("RaiseNow webhook: bill already paid", {
      billId: billDoc.id,
      referenceNumber,
    });
    res.status(200).json({ status: "already_paid" });
    return;
  }

  // 7. Verify amount matches
  // TODO: confirm with RaiseNow — is amount in CHF decimal or cents?
  const expectedAmount = bill.amount;
  if (Math.abs(expectedAmount - paidAmount) > 0.01) {
    logger.error("RaiseNow webhook: amount mismatch", {
      billId: billDoc.id,
      expected: expectedAmount,
      received: paidAmount,
    });
    // Return 200 so RaiseNow doesn't retry — mismatch won't self-resolve
    res.status(200).json({ status: "amount_mismatch", billId: billDoc.id });
    return;
  }

  // 8. Mark bill as paid
  await billDoc.ref.update({
    paidAt: Timestamp.now(),
    paidVia: "twint",
  });

  logger.info("RaiseNow webhook: bill marked as paid", {
    billId: billDoc.id,
    referenceNumber,
    amount: paidAmount,
  });

  res.status(200).json({ status: "ok", billId: billDoc.id });
});

export const raisenowWebhook = onRequest(
  { secrets: [raisenowWebhookSecret] },
  raisenowApp,
);
