// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Regression coverage for the bill processing triggers
 * (`onBillCreate` post-bill PDF generation + email send) in
 * `functions/src/invoice/bill_triggers.ts`.
 *
 * Companion to issue #158 (Tier 1 launch blocker), scenarios 6–7. Storage
 * (`getStorage().bucket().file(...)`) and Resend are stubbed via sinon —
 * the Storage emulator and Resend HTTPS endpoint are NOT exercised. Tests
 * invoke `tryGeneratePdf` and `trySendEmail` directly to bypass the
 * Firestore trigger wrapper (the Functions emulator is not started).
 */

// Prime defineString/defineSecret params before importing the module under
// test. firebase-functions reads these from process.env at .value() time.
process.env.FUNCTIONS_EMULATOR = "true";
// Real Swiss IBAN required — swissqrbill validates the mod-97 checksum.
// (Mirrors the value seeded in functions/.env.local for local dev.)
process.env.PAYMENT_IBAN = "CH56 0681 4580 1260 0509 7";
process.env.PAYMENT_RECIPIENT_NAME = "Test Recipient";
process.env.PAYMENT_RECIPIENT_STREET = "Teststrasse 1";
process.env.PAYMENT_RECIPIENT_POSTAL_CODE = "8820";
process.env.PAYMENT_RECIPIENT_CITY = "Wädenswil";
process.env.PAYMENT_RECIPIENT_COUNTRY = "CH";
process.env.PAYMENT_CURRENCY = "CHF";
process.env.RESEND_API_KEY = "re_test_fake";
process.env.RESEND_FROM_EMAIL = "OWW Test <test@localhost>";
process.env.RESEND_QRBILL_TEMPLATE_ID = "test-qrbill-template";

import { expect } from "chai";
import * as sinon from "sinon";
import { Timestamp } from "firebase-admin/firestore";
import * as storageModule from "firebase-admin/storage";
import { Resend } from "resend";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { tryGeneratePdf, trySendEmail } from "../../src/invoice/bill_triggers";
import type {
  BillEntity,
} from "../../src/invoice/types";
import type {
  CheckoutEntity,
  CheckoutPersonEntity,
  CheckoutSummaryEntity,
} from "../../src/types/firestore_entities";

interface FakeFile {
  save: sinon.SinonStub;
  getSignedUrl: sinon.SinonStub;
}

interface FakeBucket {
  file: sinon.SinonStub;
  __files: Map<string, FakeFile>;
}

function makeFakeFile(): FakeFile {
  return {
    save: sinon.stub().resolves(),
    getSignedUrl: sinon.stub().resolves(["https://signed.example/test"]),
  };
}

function makeFakeBucket(): FakeBucket {
  const files = new Map<string, FakeFile>();
  const bucket: FakeBucket = {
    __files: files,
    file: sinon.stub().callsFake((path: string) => {
      let f = files.get(path);
      if (!f) {
        f = makeFakeFile();
        files.set(path, f);
      }
      return f;
    }),
  };
  return bucket;
}

interface SeedBillOptions {
  amount?: number;
  referenceNumber?: number;
  storagePath?: string | null;
  pdfGeneratedAt?: Timestamp | null;
  emailSentAt?: Timestamp | null;
  checkoutIds?: string[];
}

interface SeedCheckoutOptions {
  status?: "open" | "closed";
  persons?: CheckoutPersonEntity[];
  summary?: CheckoutSummaryEntity | null;
  workshopsVisited?: string[];
  userId?: string;
}

async function seedCheckout(
  checkoutId: string,
  opts: SeedCheckoutOptions = {},
): Promise<void> {
  const db = getFirestore();
  const userRef = db.doc(`users/${opts.userId ?? "u-bill-proc"}`);
  const now = Timestamp.now();

  const checkout: CheckoutEntity = {
    userId: userRef,
    status: opts.status ?? "closed",
    usageType: "regular",
    created: now,
    workshopsVisited: opts.workshopsVisited ?? ["holz"],
    persons: opts.persons ?? [
      { name: "Alice", email: "alice@example.com", userType: "erwachsen" },
    ],
    modifiedBy: null,
    modifiedAt: now,
    closedAt: now,
  };
  if (opts.summary) checkout.summary = opts.summary;

  await db.collection("checkouts").doc(checkoutId).set(checkout);
}

async function seedBill(
  billId: string,
  opts: SeedBillOptions = {},
): Promise<BillEntity> {
  const db = getFirestore();
  const checkoutIds = opts.checkoutIds ?? ["co-default"];
  const checkoutRefs = checkoutIds.map((id) =>
    db.collection("checkouts").doc(id),
  );
  const userRef = db.doc("users/u-bill-proc");

  const bill: BillEntity = {
    userId: userRef,
    checkouts: checkoutRefs,
    referenceNumber: opts.referenceNumber ?? 1234,
    amount: opts.amount ?? 25.5,
    currency: "CHF",
    storagePath: opts.storagePath ?? null,
    created: Timestamp.now(),
    paidAt: null,
    paidVia: null,
    pdfGeneratedAt: opts.pdfGeneratedAt ?? null,
    emailSentAt: opts.emailSentAt ?? null,
  };

  await db.collection("bills").doc(billId).set(bill);
  return bill;
}

async function seedPricingConfig(): Promise<void> {
  const db = getFirestore();
  await db.doc("config/pricing").set({
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
    },
    entryFees: {
      erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
      kind: { regular: 7.5, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
      firma: { regular: 30, materialbezug: 0, intern: 0, hangenmoos: 30 },
    },
  });
}

async function getBill(billId: string): Promise<BillEntity> {
  const db = getFirestore();
  const snap = await db.collection("bills").doc(billId).get();
  return snap.data() as BillEntity;
}

async function getOperationsLog(): Promise<
  Array<{ collection: string; docId: string; operation: string; severity: string; message: string }>
> {
  const db = getFirestore();
  const snap = await db.collection("operations_log").get();
  return snap.docs.map((d) => d.data() as never);
}

describe("bill processing triggers (Integration)", () => {
  let getStorageStub: sinon.SinonStub;
  let resendSendStub: sinon.SinonStub;
  let fakeBucket: FakeBucket;

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await seedPricingConfig();

    fakeBucket = makeFakeBucket();
    getStorageStub = sinon
      .stub(storageModule, "getStorage")
      .returns({ bucket: () => fakeBucket } as never);

    // Resend's `emails` field is per-instance, not on the prototype.
    // Stub the underlying `post` method on Resend.prototype so any
    // instance constructed inside the SUT is intercepted.
    resendSendStub = sinon
      .stub(Resend.prototype, "post")
      .resolves({ data: { id: "email-123" }, error: null } as never);
  });

  afterEach(() => {
    getStorageStub.restore();
    resendSendStub.restore();
    sinon.restore();
  });

  describe("tryGeneratePdf (PDF generation hook)", () => {
    it("generates PDF, uploads to storage, sets storagePath + pdfGeneratedAt", async function () {
      this.timeout(15000);
      const billId = "bill-pdf-ok";
      await seedCheckout("co-default", {
        summary: { totalPrice: 25.5, entryFees: 15, machineCost: 10.5, materialCost: 0, tip: 0 },
      });
      await seedBill(billId);

      const ok = await tryGeneratePdf(billId);
      expect(ok).to.be.true;

      // Storage was called with the right path & content type.
      const fileStub = fakeBucket.file as sinon.SinonStub;
      expect(fileStub.calledWith(`invoices/${billId}.pdf`)).to.be.true;
      const file = fakeBucket.__files.get(`invoices/${billId}.pdf`)!;
      expect(file.save.calledOnce).to.be.true;
      const [buffer, options] = file.save.firstCall.args as [Buffer, { contentType: string }];
      expect(Buffer.isBuffer(buffer)).to.be.true;
      expect(buffer.length).to.be.greaterThan(0);
      expect(options.contentType).to.equal("application/pdf");

      // PDF byte signature (regression: catches accidental empty buffer).
      expect(buffer.subarray(0, 4).toString("utf8")).to.equal("%PDF");

      // Bill was updated with storagePath + pdfGeneratedAt.
      const updated = await getBill(billId);
      expect(updated.storagePath).to.equal(`invoices/${billId}.pdf`);
      expect(updated.pdfGeneratedAt).to.not.be.null;
      expect(updated.pdfGeneratedAt).to.be.instanceOf(Timestamp);
    });

    it("is a no-op if storagePath is already set (PDF already generated)", async () => {
      const billId = "bill-pdf-exists";
      await seedCheckout("co-default", {});
      await seedBill(billId, { storagePath: "invoices/already-there.pdf" });

      const ok = await tryGeneratePdf(billId);
      expect(ok).to.be.true;

      const file = fakeBucket.__files.get("invoices/already-there.pdf");
      expect(file?.save.called ?? false, "save not called for existing PDF").to.be.false;
    });

    it("respects the optimistic lock (fresh pdfGeneratedAt) — does not regenerate", async () => {
      const billId = "bill-pdf-locked";
      await seedCheckout("co-default", {});
      // Fresh lock (4 minutes old, < STALE_LOCK_MS = 5 min)
      await seedBill(billId, {
        pdfGeneratedAt: Timestamp.fromMillis(Date.now() - 4 * 60 * 1000),
      });

      const ok = await tryGeneratePdf(billId);
      expect(ok).to.be.false;

      // Bill must not be modified, no upload performed.
      const updated = await getBill(billId);
      expect(updated.storagePath).to.be.null;
      expect(fakeBucket.__files.size, "no file upload attempted").to.equal(0);
    });

    it("clears stale lock (> 5 min old) and re-runs PDF generation", async function () {
      this.timeout(15000);
      const billId = "bill-pdf-stale";
      await seedCheckout("co-default", {
        summary: { totalPrice: 10, entryFees: 10, machineCost: 0, materialCost: 0, tip: 0 },
      });
      await seedBill(billId, {
        pdfGeneratedAt: Timestamp.fromMillis(Date.now() - 6 * 60 * 1000),
      });

      const ok = await tryGeneratePdf(billId);
      expect(ok).to.be.true;

      const updated = await getBill(billId);
      expect(updated.storagePath).to.equal(`invoices/${billId}.pdf`);
    });

    it("releases the lock on PDF save failure and writes operations_log", async function () {
      this.timeout(15000);
      const billId = "bill-pdf-fail";
      await seedCheckout("co-default", {
        summary: { totalPrice: 10, entryFees: 10, machineCost: 0, materialCost: 0, tip: 0 },
      });
      await seedBill(billId);

      // Make the file.save() throw on first access
      (fakeBucket.file as sinon.SinonStub).callsFake((path: string) => {
        const f = makeFakeFile();
        f.save = sinon.stub().rejects(new Error("storage offline"));
        fakeBucket.__files.set(path, f);
        return f;
      });

      const ok = await tryGeneratePdf(billId);
      expect(ok).to.be.false;

      const updated = await getBill(billId);
      // Lock released so retries can pick it up.
      expect(updated.pdfGeneratedAt).to.be.null;
      expect(updated.storagePath).to.be.null;

      const log = await getOperationsLog();
      const pdfErrors = log.filter((e) => e.operation === "pdf_generate");
      expect(pdfErrors).to.have.length(1);
      expect(pdfErrors[0].docId).to.equal(billId);
      expect(pdfErrors[0].severity).to.equal("error");
      expect(pdfErrors[0].message).to.contain("storage offline");
    });
  });

  describe("trySendEmail (email delivery hook)", () => {
    it("skips sending when FUNCTIONS_EMULATOR=true (safety net)", async () => {
      const billId = "bill-skip-emul";
      await seedCheckout("co-default", {});
      await seedBill(billId, { storagePath: "invoices/foo.pdf" });

      const ok = await trySendEmail(billId);
      expect(ok).to.be.true;
      expect(resendSendStub.called, "Resend.send NOT invoked in emulator").to.be
        .false;

      const updated = await getBill(billId);
      expect(updated.emailSentAt).to.be.null;
    });

    describe("non-emulator path", () => {
      let savedEmulatorEnv: string | undefined;

      beforeEach(() => {
        savedEmulatorEnv = process.env.FUNCTIONS_EMULATOR;
        delete process.env.FUNCTIONS_EMULATOR;
      });

      afterEach(() => {
        if (savedEmulatorEnv === undefined) {
          delete process.env.FUNCTIONS_EMULATOR;
        } else {
          process.env.FUNCTIONS_EMULATOR = savedEmulatorEnv;
        }
      });

      it("sends email via Resend with correct payload shape", async () => {
        const billId = "bill-email-ok";
        await seedCheckout("co-default", {
          persons: [
            { name: "Alice Adult", email: "alice@example.com", userType: "erwachsen" },
          ],
        });
        await seedBill(billId, {
          storagePath: "invoices/bill-email-ok.pdf",
          referenceNumber: 7,
          amount: 42.5,
        });

        const ok = await trySendEmail(billId);
        expect(ok).to.be.true;
        expect(resendSendStub.calledOnce).to.be.true;

        // Resend SDK pipes send() through post("/emails", parsedPayload, options).
        const [path, entity] = resendSendStub.firstCall.args as [
          string,
          {
            from: string;
            to: string;
            template: { id: string; variables: Record<string, string> };
            attachments: Array<{ path: string; filename: string }>;
          },
        ];
        expect(path).to.equal("/emails");
        expect(entity.from).to.equal("OWW Test <test@localhost>");
        expect(entity.to).to.equal("alice@example.com");
        expect(entity.template.id).to.equal("test-qrbill-template");
        expect(entity.template.variables.RECIPIENT_NAME).to.equal("Alice Adult");
        expect(entity.template.variables.INVOICE_NUMBER).to.equal("RE-000007");
        expect(entity.template.variables.AMOUNT).to.equal("42.50");
        expect(entity.template.variables.CURRENCY).to.equal("CHF");
        expect(entity.template.variables.CHECKOUT_DATE).to.be.a("string").and.not.be.empty;

        expect(entity.attachments).to.have.length(1);
        expect(entity.attachments[0].path).to.equal("https://signed.example/test");
        expect(entity.attachments[0].filename).to.equal("Rechnung-RE-000007.pdf");

        const updated = await getBill(billId);
        expect(updated.emailSentAt).to.be.instanceOf(Timestamp);
      });

      it("does NOT send and returns true when recipient email is missing", async () => {
        const billId = "bill-no-email";
        await seedCheckout("co-default", {
          // Person with no email
          persons: [{ name: "Anon", email: "", userType: "kind" }],
        });
        await seedBill(billId, { storagePath: "invoices/bill-no-email.pdf" });

        const ok = await trySendEmail(billId);
        expect(ok).to.be.true; // Nothing to retry
        expect(resendSendStub.called, "Resend not called").to.be.false;

        const updated = await getBill(billId);
        expect(updated.emailSentAt).to.be.null;
      });

      it("releases lock and writes operations_log on Resend failure", async () => {
        const billId = "bill-email-fail";
        await seedCheckout("co-default", {});
        await seedBill(billId, { storagePath: "invoices/bill-email-fail.pdf" });

        // Override stub to return error
        resendSendStub.resolves({
          data: null,
          error: { name: "validation_error", message: "bad recipient" },
        } as never);

        const ok = await trySendEmail(billId);
        expect(ok).to.be.false;

        const updated = await getBill(billId);
        expect(updated.emailSentAt).to.be.null; // lock released for retry

        const log = await getOperationsLog();
        const emailErrors = log.filter((e) => e.operation === "email_send");
        expect(emailErrors).to.have.length(1);
        expect(emailErrors[0].docId).to.equal(billId);
        expect(emailErrors[0].severity).to.equal("error");
      });

      it("is idempotent: does not re-send when emailSentAt is already set", async () => {
        const billId = "bill-email-already";
        await seedCheckout("co-default", {});
        await seedBill(billId, {
          storagePath: "invoices/bill-email-already.pdf",
          emailSentAt: Timestamp.now(),
        });

        const ok = await trySendEmail(billId);
        expect(ok).to.be.false; // not re-sent
        expect(resendSendStub.called, "Resend not called for already-sent").to.be.false;
      });

      it("does nothing if PDF storagePath is missing (cannot attach)", async () => {
        const billId = "bill-no-pdf";
        await seedCheckout("co-default", {});
        await seedBill(billId, { storagePath: null });

        const ok = await trySendEmail(billId);
        expect(ok).to.be.false;
        expect(resendSendStub.called).to.be.false;
      });
    });
  });
});
