// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Real-storage counterpart to bill-processing-trigger.test.ts: that suite
 * stubs `getStorage` with sinon and asserts call shapes; this one runs
 * `tryGeneratePdf` and `getInvoiceDownloadUrl` against the actual Storage
 * emulator, so the upload, the stored bytes, and the download URL are
 * exercised for real (the hole every stubbed PDF test shared).
 */

process.env.FUNCTIONS_EMULATOR = "true";
// swissqrbill validates the creditor at render time; the PAYMENT_* params
// are not populated in the mocha process. (Mirrors create-bill-trigger.)
process.env.PAYMENT_IBAN =
  process.env.PAYMENT_IBAN ?? "CH56 0681 4580 1260 0509 7";
process.env.PAYMENT_RECIPIENT_NAME =
  process.env.PAYMENT_RECIPIENT_NAME ?? "Test Recipient";
process.env.PAYMENT_RECIPIENT_STREET =
  process.env.PAYMENT_RECIPIENT_STREET ?? "Teststrasse 1";
process.env.PAYMENT_RECIPIENT_POSTAL_CODE =
  process.env.PAYMENT_RECIPIENT_POSTAL_CODE ?? "8820";
process.env.PAYMENT_RECIPIENT_CITY =
  process.env.PAYMENT_RECIPIENT_CITY ?? "Wädenswil";
process.env.PAYMENT_RECIPIENT_COUNTRY =
  process.env.PAYMENT_RECIPIENT_COUNTRY ?? "CH";
process.env.PAYMENT_CURRENCY = process.env.PAYMENT_CURRENCY ?? "CHF";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  clearStorage,
  teardownEmulator,
  getFirestore,
  getBucket,
} from "../emulator-helper";
import { tryGeneratePdf } from "../../src/invoice/bill_triggers";
import { getInvoiceDownloadUrlHandler } from "../../src/invoice/get_invoice_download_url";
import type { BillEntity } from "../../src/invoice/types";

const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
) => Promise<{ text: string; numpages: number }>;

const USER_ID = "u-pdf-storage";

async function seedPricingConfig(): Promise<void> {
  const db = getFirestore();
  await db.doc("config/pricing").set({
    workshops: { holz: { label: "Holzwerkstatt", order: 1 } },
    entryFees: {
      erwachsen: { regular: 15 },
      kind: { regular: 7.5 },
      firma: { regular: 30 },
    },
  });
}

async function seedBillWithCheckout(billId: string): Promise<void> {
  const db = getFirestore();
  const userRef = db.doc(`users/${USER_ID}`);
  const now = Timestamp.now();

  await userRef.set({
    created: now,
    firstName: "Alice",
    lastName: "Test",
    email: "alice@example.com",
    permissions: [],
    roles: [],
  });

  const checkoutRef = db.collection("checkouts").doc(`co-${billId}`);
  await checkoutRef.set({
    userId: userRef,
    status: "closed",
    usageType: "regular",
    created: now,
    workshopsVisited: ["holz"],
    persons: [
      { name: "Alice", email: "alice@example.com", userType: "erwachsen" },
    ],
    summary: {
      totalPrice: 25.5,
      entryFees: 15,
      machineCost: 10.5,
      materialCost: 0,
      tip: 0,
    },
    modifiedBy: null,
    modifiedAt: now,
    closedAt: now,
  });

  const bill: BillEntity = {
    userId: userRef,
    checkouts: [checkoutRef],
    referenceNumber: 4321,
    amount: 25.5,
    currency: "CHF",
    storagePath: null,
    created: now,
    paidAt: null,
    paidVia: null,
    pdfGeneratedAt: null,
    emailSentAt: null,
    paymentMethodConfirmationTime: null,
    paymentMethodConfirmationSource: null,
    kind: "invoice",
    aggregatedIntoBillRef: null,
  };
  await db.collection("bills").doc(billId).set(bill);
}

function buildRequest(
  uid: string | null,
  data: Record<string, unknown>,
): CallableRequest<unknown> {
  const auth = uid != null ? { uid, token: {} } : undefined;
  return { data, auth } as unknown as CallableRequest<unknown>;
}

describe("invoice PDF storage (Integration, real Storage)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await clearStorage();
    await seedPricingConfig();
  });

  it("tryGeneratePdf uploads a parseable invoice PDF and stamps storagePath", async function () {
    this.timeout(15000);
    const billId = "bill-real-storage";
    await seedBillWithCheckout(billId);

    const ok = await tryGeneratePdf(billId);
    expect(ok).to.equal(true);

    const db = getFirestore();
    const bill = (await db.doc(`bills/${billId}`).get()).data() as BillEntity;
    expect(bill.storagePath).to.equal(`invoices/${billId}.pdf`);

    const file = getBucket().file(bill.storagePath!);
    const [exists] = await file.exists();
    expect(exists, "PDF object exists in the emulator bucket").to.equal(true);

    const [stored] = await file.download();
    expect(stored.subarray(0, 4).toString("utf8")).to.equal("%PDF");
    const { text } = await pdfParse(stored);
    // Reference number appears in the rendered invoice.
    expect(text).to.include("4321");
  });

  it("getInvoiceDownloadUrl returns a URL that serves the stored bytes", async function () {
    this.timeout(15000);
    const billId = "bill-download-url";
    await seedBillWithCheckout(billId);
    await tryGeneratePdf(billId);

    const { url } = await getInvoiceDownloadUrlHandler(
      buildRequest(USER_ID, { billId }),
    );
    expect(url).to.be.a("string").and.not.be.empty;

    const response = await fetch(url);
    expect(response.status).to.equal(200);
    const served = Buffer.from(await response.arrayBuffer());
    const [stored] = await getBucket()
      .file(`invoices/${billId}.pdf`)
      .download();
    expect(served.equals(stored)).to.equal(true);
  });

  it("getInvoiceDownloadUrl still rejects foreign users", async () => {
    const billId = "bill-foreign";
    await seedBillWithCheckout(billId);
    await tryGeneratePdf(billId);

    try {
      await getInvoiceDownloadUrlHandler(
        buildRequest("someone-else", { billId }),
      );
      throw new Error("expected permission-denied");
    } catch (err) {
      expect(err).to.be.instanceOf(HttpsError);
      expect((err as HttpsError).code).to.equal("permission-denied");
    }
  });
});
