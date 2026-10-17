// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Committing a bill's payment method (issues #251, #750), shared by the two
 * places that do it on the person's behalf:
 *
 *  - `acknowledgeBill`: the bill was minted earlier, at close, and the
 *    person confirms a method afterwards (the checkout before #750).
 *  - `closeCheckoutAndGetPayment` with a `paymentMethod`: the close and the
 *    confirmation are one action, so the bill is minted already committed.
 *
 * Both must refuse the same methods and leave the bill in the same shape,
 * or the triggers in `bill_triggers.ts` would treat the two paths
 * differently.
 */

import { HttpsError } from "firebase-functions/v2/https";
import {
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import { PAYMENT_METHOD_INFO } from "@oww/shared";
import { isPaymentMethodEnabled } from "../payments/config";
import type { BillEntity } from "./types";
import type { PaymentMethod, UserEntity } from "../types/firestore_entities";

/**
 * Refuses a method no client offers, and a members-only method for anyone
 * without an active membership. The client hides such methods already;
 * the server has to refuse them too, because a Sammelrechnung Beleg of a
 * non-member (or of an anonymous checkout) is never collected — and a
 * membership bought on that Beleg would never activate.
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
  const user = accountHolder
    ? ((await accountHolder.get()).data() as UserEntity | undefined)
    : undefined;
  if (!user?.activeMembership) {
    throw new HttpsError(
      "failed-precondition",
      `paymentMethod ${method} requires an active membership`,
    );
  }
}

/**
 * The bill fields that commit `method`. A Sammelrechnung turns the bill
 * into a Beleg and deliberately carries no ack stamp (the monthly run
 * commits the aggregated invoice); every other method stamps the ack.
 */
export function billCommitFields(
  method: PaymentMethod,
  now: Timestamp,
): Partial<BillEntity> {
  if (PAYMENT_METHOD_INFO[method].isAggregated) {
    return { kind: "beleg" };
  }
  return {
    paymentMethodConfirmationTime: now,
    paymentMethodConfirmationSource: "user",
  };
}

/** True once a bill's method is final: acked, or turned into a Beleg. */
export function isBillCommitted(bill: BillEntity): boolean {
  return (
    !!bill.paymentMethodConfirmationTime ||
    (bill.kind ?? "invoice") === "beleg"
  );
}
