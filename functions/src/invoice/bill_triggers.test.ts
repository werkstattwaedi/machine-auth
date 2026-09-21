// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the pure retry gate of the hourly email sweep (#651).
 *
 * The gate decides whether `retryBillProcessing` calls `trySendEmail` for a
 * bill. Before #651 nothing recorded a "nobody to mail" outcome, so the
 * sweep re-tried — and re-logged — every guest bill 24 times.
 */

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import { isEmailRetryDue } from "./bill_triggers";
import type { BillEntity } from "./types";

function bill(overrides: Partial<BillEntity> = {}): BillEntity {
  return {
    storagePath: "invoices/x.pdf",
    emailSentAt: null,
    paymentMethodConfirmationTime: null,
    kind: "invoice",
    ...overrides,
  } as BillEntity;
}

describe("isEmailRetryDue", () => {
  it("is due for an acked invoice that has not been sent", () => {
    expect(
      isEmailRetryDue(bill({ paymentMethodConfirmationTime: Timestamp.now() })),
    ).to.be.true;
  });

  it("is due for a Beleg without an ack (committed by its kind transition, #405)", () => {
    expect(isEmailRetryDue(bill({ kind: "beleg" }))).to.be.true;
  });

  it("treats a missing kind as an invoice (legacy docs)", () => {
    expect(isEmailRetryDue(bill({ kind: undefined }))).to.be.false;
    expect(
      isEmailRetryDue(
        bill({ kind: undefined, paymentMethodConfirmationTime: Timestamp.now() }),
      ),
    ).to.be.true;
  });

  it("is not due for an un-acked invoice (#251)", () => {
    expect(isEmailRetryDue(bill())).to.be.false;
  });

  it("is not due once the mail was sent", () => {
    expect(
      isEmailRetryDue(
        bill({
          paymentMethodConfirmationTime: Timestamp.now(),
          emailSentAt: Timestamp.now(),
        }),
      ),
    ).to.be.false;
  });

  it("is not due once the bill is marked as having nobody to mail (#651)", () => {
    expect(
      isEmailRetryDue(
        bill({
          paymentMethodConfirmationTime: Timestamp.now(),
          emailSkippedReason: "no-recipient",
        }),
      ),
    ).to.be.false;
    expect(
      isEmailRetryDue(bill({ kind: "beleg", emailSkippedReason: "no-recipient" })),
    ).to.be.false;
  });

  it("treats an explicit null skip reason as not skipped (re-armed)", () => {
    expect(
      isEmailRetryDue(
        bill({
          paymentMethodConfirmationTime: Timestamp.now(),
          emailSkippedReason: null,
        }),
      ),
    ).to.be.true;
  });
});
