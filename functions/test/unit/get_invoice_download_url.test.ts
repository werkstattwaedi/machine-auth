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
    referenceNumber: 10,
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
    const opts = buildDownloadOptions(makeBill({ referenceNumber: 50 }));
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Rechnung_RE-000005.pdf"',
    );
  });

  it("pads the reference number to six digits", () => {
    const opts = buildDownloadOptions(makeBill({ referenceNumber: 420 }));
    expect(opts.responseDisposition).to.contain(
      'filename="Rechnung_RE-000042.pdf"',
    );
  });

  it("uses read action and a future expires timestamp", () => {
    const before = Date.now();
    const opts = buildDownloadOptions(makeBill({ referenceNumber: 10 }));
    expect(opts.action).to.equal("read");
    expect(opts.expires).to.be.greaterThan(before);
  });

  it("names a kind: 'beleg' bill Beleg_BL-XXXXXX.pdf (#405)", () => {
    // Regression test for #405: a Sammelrechnung per-visit Beleg was
    // downloaded as "Rechnung_RE-…" even though the PDF inside is a Beleg.
    // The filename must reflect the document type.
    const opts = buildDownloadOptions(
      makeBill({ referenceNumber: 110, kind: "beleg" }),
    );
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Beleg_BL-000011.pdf"',
    );
  });

  it("names a kind: 'invoice' bill Rechnung_RE-XXXXXX.pdf (#405)", () => {
    const opts = buildDownloadOptions(
      makeBill({ referenceNumber: 120, kind: "invoice" }),
    );
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Rechnung_RE-000012.pdf"',
    );
  });

  it("names a TWINT bill issued before #763 Quittung_RE-XXXXXX.pdf (BIL-46)", () => {
    // A legacy bill carries no `document`; its checkout's method decides.
    const opts = buildDownloadOptions(
      makeBill({ referenceNumber: 130, kind: "invoice" }),
      "raisenow",
    );
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Quittung_RE-000013.pdf"',
    );
  });

  it("names a TWINT Beleg Beleg_BL-XXXXXX.pdf (#763)", () => {
    const opts = buildDownloadOptions(
      makeBill({
        referenceNumber: 135,
        kind: "invoice",
        paymentMethod: "raisenow",
        document: "beleg",
      }),
      "raisenow",
    );
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Beleg_BL-000013-5.pdf"',
    );
  });

  it("names a CHF 0 Beleg Beleg_BL-XXXXXX.pdf (#780)", () => {
    const opts = buildDownloadOptions(
      makeBill({ referenceNumber: 160, paymentMethod: null, document: "beleg", paidVia: "free" }),
    );
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Beleg_BL-000016.pdf"',
    );
  });

  it("names the Sammelrechnung Sammelrechnung_RE-XXXXXX.pdf", () => {
    // Stored document, and a legacy one whose checkouts name the
    // Sammelrechnung method.
    expect(
      buildDownloadOptions(
        makeBill({ referenceNumber: 140, paymentMethod: "rechnung", document: "sammelrechnung" }),
      ).responseDisposition,
    ).to.equal('attachment; filename="Sammelrechnung_RE-000014.pdf"');
    const twoVisits = [{}, {}] as unknown as BillEntity["checkouts"];
    expect(
      buildDownloadOptions(
        makeBill({ referenceNumber: 140, kind: "invoice", checkouts: twoVisits }),
        "monthly",
      ).responseDisposition,
    ).to.equal('attachment; filename="Sammelrechnung_RE-000014.pdf"');
    // A one-visit one issued before ADR-0052 was printed as a Rechnung.
    expect(
      buildDownloadOptions(makeBill({ referenceNumber: 140, kind: "invoice" }), "monthly")
        .responseDisposition,
    ).to.equal('attachment; filename="Rechnung_RE-000014.pdf"');
  });

  it("Beleg kind wins over any payment method", () => {
    const opts = buildDownloadOptions(
      makeBill({ referenceNumber: 150, kind: "beleg" }),
      "raisenow",
    );
    expect(opts.responseDisposition).to.equal(
      'attachment; filename="Beleg_BL-000015.pdf"',
    );
  });
});
