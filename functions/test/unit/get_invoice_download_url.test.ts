// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp } from "firebase-admin/firestore";
import { buildDownloadOptions } from "../../src/invoice/get_invoice_download_url";
import type { BillEntity } from "../../src/invoice/types";

if (getApps().length === 0) {
  initializeApp({ projectId: "test-project" });
}

function makeBill(partial: Partial<BillEntity>): BillEntity {
  return {
    // userId/checkouts are unused by buildDownloadOptions; cast via unknown to
    // avoid importing DocumentReference test doubles.
    userId: {} as BillEntity["userId"],
    checkouts: [],
    referenceNumber: 1,
    amount: 0,
    currency: "CHF",
    storagePath: "invoices/bill.pdf",
    created: Timestamp.fromDate(new Date("2025-01-01")),
    paidAt: null,
    paidVia: null,
    pdfGeneratedAt: null,
    emailSentAt: null,
    paymentMethodConfirmationTime: null,
    paymentMethodConfirmationSource: null,
    ...partial,
  };
}

describe("getInvoiceDownloadUrl — buildDownloadOptions", () => {
  it("sets Content-Disposition to attachment with Rechnung_RE-XXXXXX.pdf filename", () => {
    // Regression test for #134: the signed URL must be served with
    // Content-Disposition: attachment so the browser downloads instead of
    // rendering the PDF inline (which, combined with window.open after an
    // await, tripped the popup blocker).
    const opts = buildDownloadOptions(makeBill({ referenceNumber: 5 }));
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Rechnung_RE-000005.pdf"',
    );
  });

  it("pads the reference number to six digits", () => {
    const opts = buildDownloadOptions(makeBill({ referenceNumber: 42 }));
    expect(opts.responseDisposition).to.contain(
      'filename="Rechnung_RE-000042.pdf"',
    );
  });

  it("uses read action and a future expires timestamp", () => {
    const before = Date.now();
    const opts = buildDownloadOptions(makeBill({ referenceNumber: 1 }));
    expect(opts.action).to.equal("read");
    expect(opts.expires).to.be.greaterThan(before);
  });

  it("names a kind: 'beleg' bill Beleg_BL-XXXXXX.pdf (#405)", () => {
    // Regression test for #405: a Sammelrechnung per-visit Beleg was
    // downloaded as "Rechnung_RE-…" even though the PDF inside is a Beleg.
    // The filename must reflect the document type.
    const opts = buildDownloadOptions(
      makeBill({ referenceNumber: 11, kind: "beleg" }),
    );
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Beleg_BL-000011.pdf"',
    );
  });

  it("names a kind: 'invoice' bill Rechnung_RE-XXXXXX.pdf (#405)", () => {
    const opts = buildDownloadOptions(
      makeBill({ referenceNumber: 12, kind: "invoice" }),
    );
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Rechnung_RE-000012.pdf"',
    );
  });
});
