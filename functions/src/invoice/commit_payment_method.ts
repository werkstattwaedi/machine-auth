// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Committing a bill's payment method on the person's behalf (issues #251,
 * #750) — done by `closeCheckoutAndGetPayment`: the close and the
 * confirmation are one action, so the bill is minted already committed. A
 * repeated close of a legacy bill minted unconfirmed (before #750) commits
 * it with `billCommitFields`, leaving it in the same shape, so the
 * triggers in `bill_triggers.ts` treat both alike.
 */

import { HttpsError } from "firebase-functions/v2/https";
import {
  Timestamp,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import {
  PAYMENT_METHOD_INFO,
  documentFor,
  isCollectedBeleg,
} from "@oww/shared";
import { isPaymentMethodEnabled } from "../payments/config";
import { resolveVerifiedMembership } from "../membership/verified_membership";
import type { BillEntity } from "./types";
import type { PaymentMethod, UserEntity } from "../types/firestore_entities";

/**
 * Refuses a method no client offers, and a members-only method for anyone
 * without an active membership. The client hides such methods already;
 * the server has to refuse them too, because a Sammelrechnung Beleg of a
 * non-member (or of an anonymous checkout) is never collected — and a
 * membership bought on that Beleg would never activate. "Active
 * membership" means one that lists the account holder, not the bare
 * `activeMembership` pointer (issue #745).
 */
export async function assertPaymentMethodAllowed(
  method: PaymentMethod,
  accountHolder: DocumentReference | null,
): Promise<void> {
  if (!isPaymentMethodEnabled(method)) {
    throw new HttpsError(
      "failed-precondition",
      `paymentMethod ${method} is not enabled`,
    );
  }
  if (!PAYMENT_METHOD_INFO[method].requiresMembership) return;
  if (!(await hasVerifiedMembership(accountHolder))) {
    throw new HttpsError(
      "failed-precondition",
      `paymentMethod ${method} requires an active membership`,
    );
  }
}

/**
 * True when `accountHolder` belongs to an active membership that lists them
 * (see `resolveVerifiedMembership`). An anonymous account holder (null) never
 * does. Pass `tx` to read inside a transaction, before its writes.
 */
export async function hasVerifiedMembership(
  accountHolder: DocumentReference | null,
  tx?: Transaction,
): Promise<boolean> {
  if (!accountHolder) return false;
  const userSnap = tx ? await tx.get(accountHolder) : await accountHolder.get();
  const user = userSnap.data() as UserEntity | undefined;
  return (await resolveVerifiedMembership(accountHolder, user, tx)) !== null;
}

/**
 * The bill fields that commit `method` — the one place a bill learns its
 * method and its final document (ADR-0052). A Sammelrechnung method makes
 * it a Beleg for the Sammelrechnung and deliberately carries no ack stamp
 * (the monthly run commits the aggregated invoice); every other method
 * stamps the ack. `kind` is the legacy queue marker, kept in step until the
 * monthly run reads `paymentMethod` (ADR-0052).
 */
export function billCommitFields(
  method: PaymentMethod,
  now: Timestamp,
  source: "user" | "auto" = "user",
): Partial<BillEntity> {
  const fields: Partial<BillEntity> = {
    paymentMethod: method,
    document: documentFor(method),
  };
  if (PAYMENT_METHOD_INFO[method].isAggregated) {
    return { ...fields, kind: "beleg" };
  }
  return {
    ...fields,
    kind: "invoice",
    paymentMethodConfirmationTime: now,
    paymentMethodConfirmationSource: source,
  };
}

/** True once a bill's method is final: acked, or a Beleg for the Sammelrechnung. */
export function isBillCommitted(bill: BillEntity): boolean {
  return !!bill.paymentMethodConfirmationTime || isCollectedBeleg(bill);
}
