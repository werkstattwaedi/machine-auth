// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Regression coverage for the create_bill Firestore triggers.
 *
 * Companion to issue #158 (Tier 1 launch blocker). The trigger logic lives
 * in `functions/src/invoice/create_bill.ts`. The Functions emulator is NOT
 * started in the integration harness (`firebase emulators:exec --only
 * firestore,auth`), so we invoke the inner `createBillForCheckout` helper
 * directly. This still exercises the real Firestore transaction (sequential
 * numbering, idempotency guard) against the emulator.
 *
 * Scenarios mirror issue #158 acceptance criteria 1–5: trigger fires on
 * checkout close, bill content correctness, sequential numbering with no
 * gaps, idempotency, anonymous flow.
 */

// Prime defineString params before importing the module under test —
// firebase-functions reads from process.env at .value() time when not
// deployed, and the firestore-only emulator harness does not auto-load
// functions/.env.local.
process.env.FUNCTIONS_EMULATOR = "true";
process.env.PAYMENT_IBAN = process.env.PAYMENT_IBAN ?? "CH56 0000 0000 0000 0000 0";
process.env.PAYMENT_RECIPIENT_NAME = process.env.PAYMENT_RECIPIENT_NAME ?? "Test Recipient";
process.env.PAYMENT_RECIPIENT_STREET = process.env.PAYMENT_RECIPIENT_STREET ?? "Teststrasse 1";
process.env.PAYMENT_RECIPIENT_POSTAL_CODE = process.env.PAYMENT_RECIPIENT_POSTAL_CODE ?? "8820";
process.env.PAYMENT_RECIPIENT_CITY = process.env.PAYMENT_RECIPIENT_CITY ?? "Wädenswil";
process.env.PAYMENT_RECIPIENT_COUNTRY = process.env.PAYMENT_RECIPIENT_COUNTRY ?? "CH";
process.env.PAYMENT_CURRENCY = process.env.PAYMENT_CURRENCY ?? "CHF";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { createBillForCheckout } from "../../src/invoice/create_bill";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  CheckoutPersonEntity,
  CheckoutSummaryEntity,
  UsageType,
} from "../../src/types/firestore_entities";
import type { BillEntity } from "../../src/invoice/types";

const TEST_USER_ID = "user-create-bill";

interface SeedCheckoutOptions {
  status?: "open" | "closed";
  usageType?: UsageType;
  persons?: CheckoutPersonEntity[];
  items?: Array<Omit<CheckoutItemEntity, "created"> & { created?: Timestamp }>;
  summary?: CheckoutSummaryEntity | null;
  workshopsVisited?: string[];
  closedAt?: Timestamp | null;
  userId?: string;
}

async function seedCheckout(
  checkoutId: string,
  opts: SeedCheckoutOptions = {},
): Promise<CheckoutEntity> {
  const db = getFirestore();
  const userId = opts.userId ?? TEST_USER_ID;
  const userRef = db.doc(`users/${userId}`);
  const now = Timestamp.now();

  const checkout: CheckoutEntity = {
    userId: userRef,
    status: opts.status ?? "open",
    usageType: opts.usageType ?? "regular",
    created: now,
    workshopsVisited: opts.workshopsVisited ?? ["holz"],
    persons: opts.persons ?? [
      {
        name: "Alice Adult",
        email: "alice@example.com",
        userType: "erwachsen",
      },
    ],
    modifiedBy: null,
    modifiedAt: now,
  };
  if (opts.summary !== null && opts.summary !== undefined) {
    checkout.summary = opts.summary;
  }
  if (opts.status === "closed") {
    checkout.closedAt = opts.closedAt ?? now;
  }

  await db.collection("checkouts").doc(checkoutId).set(checkout);

  for (const [i, item] of (opts.items ?? []).entries()) {
    await db
      .collection("checkouts")
      .doc(checkoutId)
      .collection("items")
      .doc(`item${i}`)
      .set({
        created: item.created ?? now,
        ...item,
      });
  }

  return checkout;
}

async function seedPricingConfig(
  entryFees?: Record<string, Record<string, number>>,
): Promise<void> {
  const db = getFirestore();
  await db.doc("config/pricing").set({
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
      metall: { label: "Metallwerkstatt", order: 2 },
    },
    entryFees: entryFees ?? {
      erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
      kind: { regular: 7.5, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
      firma: { regular: 30, materialbezug: 0, intern: 0, hangenmoos: 30 },
    },
  });
}

async function seedBillingConfig(nextBillNumber: number): Promise<void> {
  const db = getFirestore();
  await db.doc("config/billing").set({ nextBillNumber });
}

async function getCheckout(checkoutId: string): Promise<CheckoutEntity> {
  const db = getFirestore();
  const snap = await db.collection("checkouts").doc(checkoutId).get();
  return snap.data() as CheckoutEntity;
}

async function getBillForCheckout(checkoutId: string): Promise<{
  id: string;
  data: BillEntity;
} | null> {
  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc(checkoutId);
  const snap = await db
    .collection("bills")
    .where("checkouts", "array-contains", checkoutRef)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() as BillEntity };
}

async function getBillingConfigNext(): Promise<number | null> {
  const db = getFirestore();
  const snap = await db.doc("config/billing").get();
  if (!snap.exists) return null;
  return (snap.data()?.nextBillNumber as number) ?? null;
}

describe("create_bill trigger (Integration)", () => {
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
  });

  describe("createBillForCheckout (shared trigger logic)", () => {
    it("creates a bill from a closed checkout with summary", async () => {
      const checkoutId = "co-with-summary";
      const summary: CheckoutSummaryEntity = {
        totalPrice: 42.5,
        entryFees: 15,
        machineCost: 20,
        materialCost: 7.5,
        tip: 0,
      };
      await seedCheckout(checkoutId, {
        status: "closed",
        summary,
        items: [
          {
            workshop: "holz",
            description: "Bandsäge",
            origin: "nfc",
            catalogId: null,
            quantity: 1,
            unitPrice: 20,
            totalPrice: 20,
          },
          {
            workshop: "holz",
            description: "Schraubensatz",
            origin: "manual",
            catalogId: null,
            quantity: 1,
            unitPrice: 7.5,
            totalPrice: 7.5,
          },
        ],
      });

      const db = getFirestore();
      const checkoutRef = db.collection("checkouts").doc(checkoutId);
      const checkout = await getCheckout(checkoutId);

      await createBillForCheckout(checkoutRef, checkout);

      const result = await getBillForCheckout(checkoutId);
      expect(result, "bill should be created").to.not.be.null;
      const bill = result!.data;

      expect(bill.amount).to.equal(42.5);
      expect(bill.currency).to.equal("CHF");
      expect(bill.referenceNumber).to.be.a("number").greaterThan(0);
      expect(bill.storagePath).to.be.null;
      expect(bill.paidAt).to.be.null;
      expect(bill.paidVia).to.be.null;
      expect(bill.pdfGeneratedAt).to.be.null;
      expect(bill.emailSentAt).to.be.null;
      expect(bill.created).to.be.instanceOf(Timestamp);
      expect(bill.checkouts).to.have.length(1);
      expect(bill.checkouts[0].path).to.equal(`checkouts/${checkoutId}`);

      // Checkout should be linked to the bill
      const updated = await getCheckout(checkoutId);
      expect(updated.billRef).to.not.be.null;
      expect(updated.billRef!.id).to.equal(result!.id);
    });

    it("computes total from items + entry fees when summary is absent", async () => {
      const checkoutId = "co-no-summary";
      // Two adults at 15 CHF entry, plus 25 CHF nfc machine + 10 CHF material
      await seedCheckout(checkoutId, {
        status: "closed",
        summary: null,
        persons: [
          { name: "Alice", email: "a@x.ch", userType: "erwachsen" },
          { name: "Bob", email: "b@x.ch", userType: "erwachsen" },
        ],
        items: [
          {
            workshop: "holz",
            description: "Tischfräse",
            origin: "nfc",
            catalogId: null,
            quantity: 1,
            unitPrice: 25,
            totalPrice: 25,
          },
          {
            workshop: "holz",
            description: "Material",
            origin: "manual",
            catalogId: null,
            quantity: 1,
            unitPrice: 10,
            totalPrice: 10,
          },
        ],
      });

      const db = getFirestore();
      const checkoutRef = db.collection("checkouts").doc(checkoutId);
      const checkout = await getCheckout(checkoutId);
      await createBillForCheckout(checkoutRef, checkout);

      const result = await getBillForCheckout(checkoutId);
      expect(result, "bill should be created").to.not.be.null;
      // 15 + 15 entry + 25 nfc + 10 material = 65
      expect(result!.data.amount).to.equal(65);
    });

    it("uses configured entry fees from config/pricing when present", async () => {
      // Override default entry fees so we know the config path is taken
      await seedPricingConfig({
        erwachsen: { regular: 99, materialbezug: 0, intern: 0, hangenmoos: 99 },
        kind: { regular: 0, materialbezug: 0, intern: 0, hangenmoos: 0 },
        firma: { regular: 0, materialbezug: 0, intern: 0, hangenmoos: 0 },
      });

      const checkoutId = "co-config-fees";
      await seedCheckout(checkoutId, {
        status: "closed",
        summary: null,
        persons: [{ name: "Alice", email: "a@x.ch", userType: "erwachsen" }],
        items: [],
      });

      const db = getFirestore();
      const checkoutRef = db.collection("checkouts").doc(checkoutId);
      const checkout = await getCheckout(checkoutId);
      await createBillForCheckout(checkoutRef, checkout);

      const result = await getBillForCheckout(checkoutId);
      expect(result!.data.amount).to.equal(99);
    });

    it("propagates checkout userId reference onto the bill", async () => {
      const checkoutId = "co-user-ref";
      await seedCheckout(checkoutId, {
        status: "closed",
        userId: "alice-user",
        summary: { totalPrice: 10, entryFees: 10, machineCost: 0, materialCost: 0, tip: 0 },
      });

      const db = getFirestore();
      const checkoutRef = db.collection("checkouts").doc(checkoutId);
      const checkout = await getCheckout(checkoutId);
      await createBillForCheckout(checkoutRef, checkout);

      const result = await getBillForCheckout(checkoutId);
      expect(result!.data.userId.path).to.equal("users/alice-user");
    });

    it("handles firma billing address checkout (multi-person, mixed userType)", async () => {
      const checkoutId = "co-firma";
      await seedCheckout(checkoutId, {
        status: "closed",
        usageType: "regular",
        summary: null,
        persons: [
          {
            name: "Carol Firma",
            email: "carol@firma.ch",
            userType: "firma",
            billingAddress: {
              company: "Firma AG",
              street: "Hauptstrasse 1",
              zip: "8000",
              city: "Zürich",
            },
          },
          { name: "Dora Adult", email: "dora@x.ch", userType: "erwachsen" },
        ],
        items: [],
      });

      const db = getFirestore();
      const checkoutRef = db.collection("checkouts").doc(checkoutId);
      const checkout = await getCheckout(checkoutId);
      await createBillForCheckout(checkoutRef, checkout);

      const result = await getBillForCheckout(checkoutId);
      // 30 (firma) + 15 (erwachsen) = 45
      expect(result!.data.amount).to.equal(45);
    });
  });

  describe("Sequential invoice numbering", () => {
    it("allocates sequential numbers from config/billing.nextBillNumber with no gaps", async () => {
      await seedBillingConfig(42);

      const db = getFirestore();
      const summary: CheckoutSummaryEntity = {
        totalPrice: 10, entryFees: 10, machineCost: 0, materialCost: 0, tip: 0,
      };
      const allocated: number[] = [];

      for (const id of ["co-a", "co-b", "co-c"]) {
        await seedCheckout(id, { status: "closed", summary });
        const ref = db.collection("checkouts").doc(id);
        const data = await getCheckout(id);
        await createBillForCheckout(ref, data);
        const result = await getBillForCheckout(id);
        allocated.push(result!.data.referenceNumber);
      }

      expect(allocated).to.deep.equal([42, 43, 44]);
      expect(await getBillingConfigNext()).to.equal(45);
    });

    it("bootstraps numbering at 1 when config/billing does not exist", async () => {
      // Sanity: ensure config/billing absent
      const db = getFirestore();
      const before = await db.doc("config/billing").get();
      expect(before.exists).to.be.false;

      const summary: CheckoutSummaryEntity = {
        totalPrice: 10, entryFees: 10, machineCost: 0, materialCost: 0, tip: 0,
      };
      await seedCheckout("co-first", { status: "closed", summary });
      const ref = db.collection("checkouts").doc("co-first");
      const data = await getCheckout("co-first");
      await createBillForCheckout(ref, data);

      const result = await getBillForCheckout("co-first");
      expect(result!.data.referenceNumber).to.equal(1);
      expect(await getBillingConfigNext()).to.equal(2);
    });
  });

  describe("Idempotency", () => {
    it("does not create a second bill when invoked twice for the same checkout", async () => {
      await seedBillingConfig(100);
      const checkoutId = "co-idempotent";
      const summary: CheckoutSummaryEntity = {
        totalPrice: 25, entryFees: 15, machineCost: 10, materialCost: 0, tip: 0,
      };
      await seedCheckout(checkoutId, { status: "closed", summary });

      const db = getFirestore();
      const ref = db.collection("checkouts").doc(checkoutId);
      const data = await getCheckout(checkoutId);

      await createBillForCheckout(ref, data);
      // Re-read after the first run picks up the billRef set by the
      // transaction. Pass the stale snapshot to mimic a duplicate trigger
      // delivery — the in-transaction re-read should still detect billRef.
      await createBillForCheckout(ref, data);

      const billsSnap = await db
        .collection("bills")
        .where("checkouts", "array-contains", ref)
        .get();
      expect(billsSnap.size, "exactly one bill exists").to.equal(1);
      // Reference number was allocated only once.
      expect(await getBillingConfigNext()).to.equal(101);
    });
  });

  describe("Anonymous checkout flow (status: closed at create)", () => {
    it("creates a bill for an anonymous closed checkout", async () => {
      const checkoutId = "co-anon";
      const summary: CheckoutSummaryEntity = {
        totalPrice: 7.5, entryFees: 7.5, machineCost: 0, materialCost: 0, tip: 0,
      };
      await seedCheckout(checkoutId, {
        status: "closed",
        userId: "anonymous-placeholder",
        persons: [{ name: "Anon Kid", email: "anon@x.ch", userType: "kind" }],
        summary,
      });

      const db = getFirestore();
      const ref = db.collection("checkouts").doc(checkoutId);
      const data = await getCheckout(checkoutId);
      await createBillForCheckout(ref, data);

      const result = await getBillForCheckout(checkoutId);
      expect(result, "bill should be created for anonymous checkout").to.not.be.null;
      expect(result!.data.amount).to.equal(7.5);
      // The current contract: userId is the DocumentReference written on the
      // checkout (anonymous flow stores a placeholder reference, never null).
      expect(result!.data.userId.path).to.equal("users/anonymous-placeholder");

      // Checkout is linked back
      const updated = await getCheckout(checkoutId);
      expect(updated.billRef).to.not.be.null;
    });
  });
});
