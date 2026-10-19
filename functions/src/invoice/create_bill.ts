// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Bill minting: reference-number allocation and the bill doc itself.
 *
 * Every path that closes a checkout mints its bill in the same transaction
 * (the close callable, the Wallee settlement, the renewal invoicer, a
 * correction), so no trigger creates bills after the fact (#757).
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type {
  DocumentReference,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import type { PaidVia, PaymentMethod } from "../types/firestore_entities";
import { HttpsError } from "firebase-functions/v2/https";
import {
  BILL_REVISION_RADIX,
  MAX_BILL_REVISION_DIGIT,
  formatBillReference,
  type BillEntity,
  type BillAckSource,
  type BillSource,
} from "./types";
import { documentFor, isCollectedBeleg, type BillDocumentType } from "@oww/shared";

/**
 * Marker written by `scripts/migrate-bill-numbers.ts` once every stored
 * `referenceNumber` has been shifted to the `base × 10 + revision` layout
 * (ADR-0042). `allocateBill` refuses to mint against a `config/billing`
 * doc that exists without it, so this code can never run on un-migrated
 * data. A *missing* config doc is a fresh install (emulator, tests) with
 * nothing to migrate and bootstraps with the marker set.
 */
export const REFERENCE_NUMBER_FORMAT = "shifted-v1";

interface BillingConfig {
  nextBillNumber?: number;
  referenceNumberFormat?: string;
}

/** Payment-method ack stamp applied at mint time. */
export interface BillAck {
  time: Timestamp;
  source: BillAckSource;
}

/**
 * A payment the provider confirmed before the bill exists (the Wallee
 * terminal, ADR-0051): the bill is born paid.
 */
export interface BillPaid {
  paidAt: Timestamp;
  paidVia: PaidVia;
  walleeTransactionId: number | null;
  walleeReceiptText: string | null;
  walleePaymentBrand: string | null;
}

interface BuildBillArgs {
  userId: DocumentReference | null;
  checkoutRefs: DocumentReference[];
  referenceNumber: number;
  amount: number;
  /** The committed method (ADR-0052); null/omitted: unconfirmed, or CHF 0. */
  paymentMethod?: PaymentMethod | null;
  /** The monthly aggregate of Belege (monthlyBillRun). */
  isSammelrechnung?: boolean;
  /** Overrides the derived document — a correction keeps its original's. */
  document?: BillDocumentType;
  ack?: BillAck | null;
  source?: BillSource;
  aggregatedIntoBillRef?: DocumentReference | null;
  supersedesBillRef?: DocumentReference | null;
  correctionReason?: string | null;
  correctedBillRefs?: DocumentReference[] | null;
  modifiedBy?: string | null;
  paid?: BillPaid | null;
}

/**
 * Field assembly shared by every minted bill — originals (`allocateBill`)
 * and corrected re-issues (`allocateBillRevision`) — so the zero-amount
 * auto-close and the doc shape live in one place.
 */
export function buildBillEntity(args: BuildBillArgs): BillEntity {
  // Issue #237: zero-amount bills (e.g. "Interne Nutzung") are auto-closed
  // as `paidVia: "free"` so they don't sit "unpaid forever" waiting for a
  // bank QR scan that will never come. The PDF generator gates its
  // QR-bill section on `paidAt` already, so the same flag also keeps the
  // payment slip out of the generated invoice.
  const isFree = args.amount === 0;
  const now = Timestamp.now();
  const ack: BillAck | null =
    args.ack ?? (isFree ? { time: now, source: "auto" } : null);
  const paymentMethod = args.paymentMethod ?? null;
  const document =
    args.document ??
    documentFor(isFree ? "free" : paymentMethod, { isSammelrechnung: args.isSammelrechnung });
  return {
    userId: args.userId as DocumentReference,
    checkouts: args.checkoutRefs,
    referenceNumber: args.referenceNumber,
    amount: args.amount,
    currency: "CHF",
    storagePath: null,
    created: now,
    paidAt: isFree ? now : (args.paid?.paidAt ?? null),
    paidVia: isFree ? "free" : (args.paid?.paidVia ?? null),
    walleeTransactionId: args.paid?.walleeTransactionId ?? null,
    walleeReceiptText: args.paid?.walleeReceiptText ?? null,
    walleePaymentBrand: args.paid?.walleePaymentBrand ?? null,
    pdfGeneratedAt: null,
    emailSentAt: null,
    paymentMethodConfirmationTime: ack?.time ?? null,
    paymentMethodConfirmationSource: ack?.source ?? null,
    paymentMethod,
    document,
    kind: isCollectedBeleg({ paymentMethod }) ? "beleg" : "invoice",
    aggregatedIntoBillRef: args.aggregatedIntoBillRef ?? null,
    source: args.source ?? "checkout",
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    supersededByBillRef: null,
    supersedesBillRef: args.supersedesBillRef ?? null,
    correctionReason: args.correctionReason ?? null,
    correctedBillRefs: args.correctedBillRefs ?? null,
    cancellationNoticeSentAt: null,
    modifiedBy: args.modifiedBy ?? null,
    modifiedAt: now,
  };
}

/**
 * Allocate a sequential reference number from `config/billing` and write a
 * bill doc inside the supplied transaction. Shared by every code path that
 * mints an *original* bill — the `closeCheckoutAndGetPayment` callable, the
 * Wallee settlement, the renewal invoicer and the monthlyBillRun cron —
 * so the counter increment lives in one place. The stored number is
 * `counter × 10` (revision digit 0, ADR-0042); the counter itself keeps
 * advancing by 1.
 *
 * Returns the constructed bill entity so callers can build PaymentData /
 * trigger downstream PDF generation without re-reading from Firestore.
 */
export async function allocateBill(
  tx: Transaction,
  db: Firestore,
  args: {
    userId: DocumentReference | null;
    checkoutRefs: DocumentReference[];
    amount: number;
    billRef: DocumentReference;
    /**
     * The method the bill is committed with (issue #750, ADR-0052); null
     * only for a CHF 0 bill. An aggregated method makes it a Beleg for the
     * Sammelrechnung, which carries no ack stamp — pass `preAck` for the
     * others.
     */
    paymentMethod?: PaymentMethod | null;
    /** The monthly aggregate of Belege (monthlyBillRun). */
    isSammelrechnung?: boolean;
    /**
     * Commit the bill at creation: the close with the person's method
     * ("user"), the Wallee settlement ("terminal"), the monthly
     * Sammelrechnung and the renewal invoice ("auto"). Omitted only for a
     * Beleg for the Sammelrechnung (committed by its method) and a CHF 0
     * bill (born free).
     */
    preAck?: { source: BillAckSource };
    /**
     * Origin discriminator (issue #323). Defaults to "checkout". The
     * renewalInvoicer cron passes "membership-renewal" to mark bills it
     * auto-issued for an expiring membership.
     */
    source?: BillSource;
    /** A payment confirmed before the bill exists (Wallee terminal). */
    paid?: BillPaid;
  },
): Promise<BillEntity> {
  const configRef = db.doc("config/billing");
  const configDoc = await tx.get(configRef);
  const config = (configDoc.data() ?? {}) as BillingConfig;
  if (configDoc.exists && config.referenceNumberFormat !== REFERENCE_NUMBER_FORMAT) {
    throw new HttpsError(
      "failed-precondition",
      `config/billing.referenceNumberFormat is ${JSON.stringify(config.referenceNumberFormat ?? null)}, ` +
        `expected "${REFERENCE_NUMBER_FORMAT}" — run scripts/migrate-bill-numbers.ts before this version mints bills`,
    );
  }
  const nextBillNumber = configDoc.exists ? config.nextBillNumber ?? 1 : 1;

  if (configDoc.exists) {
    tx.update(configRef, { nextBillNumber: FieldValue.increment(1) });
  } else {
    tx.set(configRef, {
      nextBillNumber: nextBillNumber + 1,
      referenceNumberFormat: REFERENCE_NUMBER_FORMAT,
    });
  }

  const bill = buildBillEntity({
    userId: args.userId,
    checkoutRefs: args.checkoutRefs,
    referenceNumber: nextBillNumber * BILL_REVISION_RADIX,
    amount: args.amount,
    paymentMethod: args.paymentMethod,
    isSammelrechnung: args.isSammelrechnung,
    ack: args.preAck ? { time: Timestamp.now(), source: args.preAck.source } : null,
    source: args.source,
    paid: args.paid ?? null,
  });
  tx.set(args.billRef, bill);
  return bill;
}

/**
 * Mint a corrected re-issue of `previous` (ADR-0042): same base number,
 * next revision digit, no counter read. Rejects once the previous bill
 * already carries the highest digit. The caller cancels the previous bill
 * and links `supersededByBillRef` in the same transaction.
 */
export async function allocateBillRevision(
  tx: Transaction,
  args: {
    previous: { ref: DocumentReference; bill: BillEntity };
    userId: DocumentReference | null;
    checkoutRefs: DocumentReference[];
    amount: number;
    billRef: DocumentReference;
    /**
     * The replacement's committed method and document (ADR-0052). Passed,
     * not copied: the caller resolves them from the previous bill — which
     * may predate the fields — and its checkout.
     */
    paymentMethod: PaymentMethod | null;
    document: BillDocumentType;
    aggregatedIntoBillRef?: DocumentReference | null;
    /** Replacements are pre-acked, except Belege for the Sammelrechnung (null). */
    ack?: BillAck | null;
    correctionReason: string;
    /** Sammelrechnung revision only: replacement Belege attached to its mail. */
    correctedBillRefs?: DocumentReference[] | null;
    modifiedBy: string | null;
  },
): Promise<BillEntity> {
  const previousNumber = args.previous.bill.referenceNumber;
  if (previousNumber % BILL_REVISION_RADIX >= MAX_BILL_REVISION_DIGIT) {
    throw new HttpsError(
      "failed-precondition",
      `${formatBillReference(args.previous.bill)} hat die maximale Anzahl ` +
        `Korrekturen (${MAX_BILL_REVISION_DIGIT}) erreicht — keine weitere Korrektur möglich.`,
    );
  }
  const bill = buildBillEntity({
    userId: args.userId,
    checkoutRefs: args.checkoutRefs,
    referenceNumber: previousNumber + 1,
    amount: args.amount,
    paymentMethod: args.paymentMethod,
    document: args.document,
    ack: args.ack ?? null,
    source: args.previous.bill.source,
    aggregatedIntoBillRef: args.aggregatedIntoBillRef ?? null,
    supersedesBillRef: args.previous.ref,
    correctionReason: args.correctionReason,
    correctedBillRefs: args.correctedBillRefs ?? null,
    modifiedBy: args.modifiedBy,
  });
  tx.set(args.billRef, bill);
  return bill;
}
