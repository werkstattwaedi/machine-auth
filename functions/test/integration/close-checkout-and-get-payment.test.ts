// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Regression coverage for the closeCheckoutAndGetPayment
 * callable (the single payment path).
 *
 * Companion to issue #157 (Tier 1 launch blocker). The callable lives in
 * `functions/src/invoice/close_checkout_and_get_payment.ts`. The Functions
 * emulator is NOT started in the integration harness (`firebase
 * emulators:exec --only firestore,auth`), so the create_bill safety-net
 * triggers don't fire and we observe the callable's writes in isolation.
 *
 * Scenarios mirror the issue's acceptance criteria: happy paths, server
 * recompute integrity, authorization, validation, idempotency, and
 * sequential bill numbering.
 */

// Prime defineString params before importing the module under test —
// firebase-functions reads from process.env at .value() time when not
// deployed, and the firestore-only emulator harness does not auto-load
// functions/.env.local.
process.env.FUNCTIONS_EMULATOR = "true";
process.env.PAYMENT_IBAN =
  process.env.PAYMENT_IBAN ?? "CH56 0000 0000 0000 0000 0";
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
process.env.RAISENOW_PAYLINK_SOLUTION_ID =
  process.env.RAISENOW_PAYLINK_SOLUTION_ID ?? "test-solution";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { closeCheckoutAndGetPayment } from "../../src/invoice/close_checkout_and_get_payment";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  CheckoutPersonEntity,
  CheckoutSummaryEntity,
  ItemOrigin,
  UsageType,
} from "../../src/types/firestore_entities";
import type { BillEntity } from "../../src/invoice/types";

// --- Helpers -------------------------------------------------------------

interface NewItem {
  workshop?: string;
  description?: string;
  origin?: ItemOrigin;
  catalogId?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

const ADULT: CheckoutPersonEntity = {
  name: "Alice Adult",
  email: "alice@example.com",
  userType: "erwachsen",
};

const CHILD: CheckoutPersonEntity = {
  name: "Charlie Kid",
  email: "charlie@example.com",
  userType: "kind",
};

async function seedPricingConfig(): Promise<void> {
  const db = getFirestore();
  await db.doc("config/pricing").set({
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
      metall: { label: "Metallwerkstatt", order: 2 },
    },
    entryFees: {
      erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
      kind: { regular: 7.5, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
      firma: { regular: 30, materialbezug: 0, intern: 0, hangenmoos: 30 },
    },
  });
}

async function seedUser(
  uid: string,
  userType: "erwachsen" | "kind" | "firma" = "erwachsen",
): Promise<void> {
  const db = getFirestore();
  await db.collection("users").doc(uid).set({
    created: Timestamp.now(),
    firstName: "Alice",
    lastName: "Adult",
    email: "alice@example.com",
    permissions: [],
    roles: [],
    userType,
  });
}

interface SeedOpenCheckoutOpts {
  ownerUid: string;
  items?: NewItem[];
  workshopsVisited?: string[];
  persons?: CheckoutPersonEntity[];
  status?: "open" | "closed";
  billRef?: FirebaseFirestore.DocumentReference;
  closedAt?: Timestamp;
  summary?: CheckoutSummaryEntity;
}

async function seedCheckout(
  checkoutId: string,
  opts: SeedOpenCheckoutOpts,
): Promise<void> {
  const db = getFirestore();
  const now = Timestamp.now();
  const userRef = db.collection("users").doc(opts.ownerUid);

  const checkout: CheckoutEntity = {
    userId: userRef,
    status: opts.status ?? "open",
    usageType: "regular",
    created: now,
    workshopsVisited: opts.workshopsVisited ?? ["holz"],
    persons: opts.persons ?? [ADULT],
    modifiedBy: opts.ownerUid,
    modifiedAt: now,
  };
  if (opts.billRef) {
    checkout.billRef = opts.billRef;
  }
  if (opts.closedAt) {
    checkout.closedAt = opts.closedAt;
  }
  if (opts.summary) {
    checkout.summary = opts.summary;
  }

  await db.collection("checkouts").doc(checkoutId).set(checkout);

  for (const [i, item] of (opts.items ?? []).entries()) {
    const doc: CheckoutItemEntity = {
      workshop: item.workshop ?? "holz",
      description: item.description ?? `Item ${i}`,
      origin: item.origin ?? "manual",
      catalogId: item.catalogId
        ? db.collection("catalog").doc(item.catalogId)
        : null,
      created: now,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    };
    await db
      .collection("checkouts")
      .doc(checkoutId)
      .collection("items")
      .doc(`item${i}`)
      .set(doc);
  }
}

async function seedBill(
  billId: string,
  args: {
    userId: string | null;
    checkoutId: string;
    amount: number;
    referenceNumber: number;
  },
): Promise<void> {
  const db = getFirestore();
  const userRef = args.userId
    ? db.collection("users").doc(args.userId)
    : (null as unknown as FirebaseFirestore.DocumentReference);
  const bill: BillEntity = {
    userId: userRef,
    checkouts: [db.collection("checkouts").doc(args.checkoutId)],
    referenceNumber: args.referenceNumber,
    amount: args.amount,
    currency: "CHF",
    storagePath: null,
    created: Timestamp.now(),
    paidAt: null,
    paidVia: null,
    pdfGeneratedAt: null,
    emailSentAt: null,
  };
  await db.collection("bills").doc(billId).set(bill);
}

async function getCheckout(checkoutId: string): Promise<CheckoutEntity> {
  const db = getFirestore();
  const snap = await db.collection("checkouts").doc(checkoutId).get();
  return snap.data() as CheckoutEntity;
}

async function listBills(): Promise<{ id: string; data: BillEntity }[]> {
  const db = getFirestore();
  const snap = await db.collection("bills").get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as BillEntity }));
}

interface CallOptions {
  uid?: string | null;
  actsAs?: string;
  data: Record<string, unknown>;
}

function buildRequest(opts: CallOptions): CallableRequest<unknown> {
  const auth =
    opts.uid != null
      ? {
          uid: opts.uid,
          token: {
            ...(opts.actsAs ? { actsAs: opts.actsAs } : {}),
          },
        }
      : undefined;
  return {
    data: opts.data,
    auth,
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

async function call(opts: CallOptions): ReturnType<typeof closeCheckoutAndGetPayment.run> {
  return closeCheckoutAndGetPayment.run(
    // The callable's run() is typed against the request schema, but for tests
    // we want to also exercise invalid shapes (missing persons / usageType /
    // both checkoutId+newCheckout). Cast to any to bypass the narrowed type.
    buildRequest(opts) as unknown as Parameters<typeof closeCheckoutAndGetPayment.run>[0],
  );
}

/**
 * Capture writes to stdout AND stderr while `fn` runs, so we can assert that
 * firebase-functions/logger emitted the expected structured log line. The
 * logger's exported `warn` is a non-configurable getter (rolldown ESM
 * interop), so sinon.stub() on it throws — intercepting at the stream layer
 * sidesteps that and tests the observable behaviour instead.
 */
async function captureLogs<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const intercept = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true === Boolean(
      typeof encoding === "function"
        ? encoding(null)
        : cb?.(null) ?? true,
    );
  };
  process.stdout.write = intercept as unknown as typeof process.stdout.write;
  process.stderr.write = intercept as unknown as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, output: chunks.join("") };
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
}

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(
      `expected HttpsError with code=${expectedCode}, got success`,
    );
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code !== expectedCode) {
      throw new Error(
        `expected HttpsError code=${expectedCode}, got ${
          e.code ?? "unknown"
        }: ${e.message ?? err}`,
      );
    }
  }
}

// --- Tests ---------------------------------------------------------------

describe("closeCheckoutAndGetPayment (Integration)", () => {
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

  describe("happy path", () => {
    it("closes an existing open checkout for the owning user", async () => {
      const uid = "user-happy-1";
      const checkoutId = "co-happy-1";
      await seedUser(uid, "erwachsen");
      await seedCheckout(checkoutId, {
        ownerUid: uid,
        items: [
          {
            workshop: "holz",
            description: "Bandsäge",
            origin: "nfc",
            quantity: 1,
            unitPrice: 20,
            totalPrice: 20,
          },
          {
            workshop: "holz",
            description: "Schraubensatz",
            origin: "manual",
            quantity: 1,
            unitPrice: 5,
            totalPrice: 5,
          },
        ],
      });

      const result = await call({
        uid,
        data: {
          checkoutId,
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: {
            totalPrice: 0,
            entryFees: 0,
            machineCost: 0,
            materialCost: 0,
            tip: 0,
          },
        },
      });

      // 15 (entry) + 20 (nfc) + 5 (manual) = 40 CHF
      expect(result.amount).to.equal("40.00");
      expect(result.currency).to.equal("CHF");
      expect(result.payerName).to.equal(ADULT.name);
      expect(result.qrBillPayload).to.contain("SPC");
      expect(result.reference).to.have.length.greaterThan(10);

      const checkout = await getCheckout(checkoutId);
      expect(checkout.status).to.equal("closed");
      expect(checkout.closedAt).to.be.instanceOf(Timestamp);
      expect(checkout.billRef).to.exist;
      expect(checkout.summary?.totalPrice).to.equal(40);
      expect(checkout.summary?.entryFees).to.equal(15);
      expect(checkout.summary?.machineCost).to.equal(20);
      expect(checkout.summary?.materialCost).to.equal(5);

      const bills = await listBills();
      expect(bills, "exactly one bill should be created").to.have.length(1);
      const bill = bills[0];
      expect(bill.data.amount).to.equal(40);
      expect(bill.data.currency).to.equal("CHF");
      expect(bill.data.referenceNumber).to.be.a("number").greaterThan(0);
      expect(bill.data.userId.id).to.equal(uid);
      expect(bill.data.checkouts).to.have.length(1);
      expect(bill.data.checkouts[0].path).to.equal(`checkouts/${checkoutId}`);
      expect(checkout.billRef!.id).to.equal(bill.id);
    });

    it("creates and closes an anonymous checkout from newCheckout payload", async () => {
      const result = await call({
        uid: null,
        data: {
          newCheckout: {
            userId: null,
            workshopsVisited: ["holz"],
            items: [
              {
                workshop: "holz",
                description: "Bandsäge",
                origin: "nfc",
                catalogId: null,
                quantity: 1,
                unitPrice: 25,
                totalPrice: 25,
              },
            ],
          },
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: {
            totalPrice: 0,
            entryFees: 0,
            machineCost: 0,
            materialCost: 0,
            tip: 0,
          },
        },
      });

      // 15 (entry) + 25 (nfc) = 40 CHF
      expect(result.amount).to.equal("40.00");

      const db = getFirestore();
      const checkoutsSnap = await db.collection("checkouts").get();
      expect(checkoutsSnap.size).to.equal(1);
      const checkoutDoc = checkoutsSnap.docs[0];
      const checkout = checkoutDoc.data() as CheckoutEntity;
      expect(checkout.status).to.equal("closed");
      expect(checkout.userId).to.equal(null);
      expect(checkout.summary?.totalPrice).to.equal(40);
      expect(checkout.billRef).to.exist;

      const itemsSnap = await checkoutDoc.ref.collection("items").get();
      expect(itemsSnap.size).to.equal(1);
      expect((itemsSnap.docs[0].data() as CheckoutItemEntity).totalPrice).to.equal(25);

      const bills = await listBills();
      expect(bills).to.have.length(1);
      expect(bills[0].data.amount).to.equal(40);
    });

    it("honours actsAs claim — kiosk session closes on behalf of the real user", async () => {
      const realUid = "real-user-acts-as";
      const tagPrincipal = "tag:abcdef";
      const checkoutId = "co-actsas";
      await seedUser(realUid, "erwachsen");
      await seedCheckout(checkoutId, {
        ownerUid: realUid,
        items: [
          {
            description: "Material",
            origin: "manual",
            quantity: 1,
            unitPrice: 10,
            totalPrice: 10,
          },
        ],
      });

      await call({
        uid: tagPrincipal,
        actsAs: realUid,
        data: {
          checkoutId,
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: {
            totalPrice: 0,
            entryFees: 0,
            machineCost: 0,
            materialCost: 0,
            tip: 0,
          },
        },
      });

      const checkout = await getCheckout(checkoutId);
      expect(checkout.status).to.equal("closed");
      // modifiedBy carries the kiosk principal (effectiveUid()).
      expect(checkout.modifiedBy).to.equal(realUid);

      const bills = await listBills();
      expect(bills).to.have.length(1);
      // Bill is owned by the real user, not the synthetic tag uid.
      expect(bills[0].data.userId.id).to.equal(realUid);
    });
  });

  describe("server recompute integrity", () => {
    it("ignores a discounted client summary on existing checkout — bill uses server total", async () => {
      const uid = "user-discount-mint-existing";
      const checkoutId = "co-discount-mint";
      await seedUser(uid, "erwachsen");
      await seedCheckout(checkoutId, {
        ownerUid: uid,
        items: [
          {
            description: "Pricey thing",
            origin: "manual",
            quantity: 1,
            unitPrice: 50,
            totalPrice: 50,
          },
        ],
      });

      const { output } = await captureLogs(() =>
        call({
          uid,
          data: {
            checkoutId,
            usageType: "regular" as UsageType,
            persons: [ADULT],
            summary: {
              totalPrice: 0.01,
              entryFees: 0,
              machineCost: 0,
              materialCost: 0.01,
              tip: 0,
            },
          },
        }),
      );

      const bills = await listBills();
      expect(bills).to.have.length(1);
      // 15 (entry fee) + 50 (item) = 65, not 0.01.
      expect(bills[0].data.amount).to.equal(65);
      const checkout = await getCheckout(checkoutId);
      expect(checkout.summary?.totalPrice).to.equal(65);

      expect(
        output,
        "client/server divergence should be logged",
      ).to.contain("Client summary diverges");
    });

    it("ignores a discounted client summary on newCheckout — bill uses server total", async () => {
      const { output } = await captureLogs(() =>
        call({
          uid: null,
          data: {
            newCheckout: {
              userId: null,
              workshopsVisited: ["holz"],
              items: [
                {
                  workshop: "holz",
                  description: "Pricey thing",
                  origin: "manual",
                  catalogId: null,
                  quantity: 2,
                  unitPrice: 25,
                  totalPrice: 50,
                },
              ],
            },
            usageType: "regular" as UsageType,
            persons: [ADULT],
            summary: {
              totalPrice: 0.01,
              entryFees: 0,
              machineCost: 0,
              materialCost: 0.01,
              tip: 0,
            },
          },
        }),
      );

      const bills = await listBills();
      expect(bills).to.have.length(1);
      // 15 entry + 50 item = 65
      expect(bills[0].data.amount).to.equal(65);

      expect(output).to.contain("Client summary diverges");
    });

    it("drops invalid items from newCheckout — bill excludes them, only valid items persisted", async () => {
      await call({
        uid: null,
        data: {
          newCheckout: {
            userId: null,
            workshopsVisited: ["holz"],
            items: [
              {
                workshop: "holz",
                description: "Valid thing",
                origin: "manual",
                catalogId: null,
                quantity: 1,
                unitPrice: 50,
                totalPrice: 50,
              },
              {
                workshop: "holz",
                description: "Discount-mint attempt",
                origin: "manual",
                catalogId: null,
                quantity: 1,
                unitPrice: -100,
                totalPrice: -100,
              },
            ],
          },
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: {
            totalPrice: 0,
            entryFees: 0,
            machineCost: 0,
            materialCost: 0,
            tip: 0,
          },
        },
      });

      const bills = await listBills();
      expect(bills).to.have.length(1);
      // 15 entry + 50 valid item; the -100 item must NOT subtract.
      expect(bills[0].data.amount).to.equal(65);

      const db = getFirestore();
      const checkoutsSnap = await db.collection("checkouts").get();
      expect(checkoutsSnap.size).to.equal(1);
      const itemsSnap = await checkoutsSnap.docs[0].ref
        .collection("items")
        .get();
      // Only the valid item should be persisted.
      expect(itemsSnap.size).to.equal(1);
      expect((itemsSnap.docs[0].data() as CheckoutItemEntity).totalPrice).to.equal(50);
    });
  });

  describe("authorization", () => {
    it("rejects unauthenticated caller closing an existing checkout", async () => {
      const uid = "user-authz-1";
      const checkoutId = "co-authz-anon";
      await seedUser(uid);
      await seedCheckout(checkoutId, { ownerUid: uid });

      await expectHttpsError(
        () =>
          call({
            uid: null,
            data: {
              checkoutId,
              usageType: "regular" as UsageType,
              persons: [ADULT],
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "unauthenticated",
      );

      // No bill should have been created and the checkout stays open.
      expect(await listBills()).to.have.length(0);
      const checkout = await getCheckout(checkoutId);
      expect(checkout.status).to.equal("open");
    });

    it("rejects a different user closing someone else's checkout", async () => {
      const ownerUid = "user-owner";
      const attackerUid = "user-attacker";
      const checkoutId = "co-authz-wrong-user";
      await seedUser(ownerUid);
      await seedUser(attackerUid);
      await seedCheckout(checkoutId, { ownerUid });

      await expectHttpsError(
        () =>
          call({
            uid: attackerUid,
            data: {
              checkoutId,
              usageType: "regular" as UsageType,
              persons: [ADULT],
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "permission-denied",
      );

      expect(await listBills()).to.have.length(0);
      const checkout = await getCheckout(checkoutId);
      expect(checkout.status).to.equal("open");
    });

    it("rejects an anonymous caller stamping someone else's userId on newCheckout", async () => {
      await expectHttpsError(
        () =>
          call({
            uid: null,
            data: {
              newCheckout: {
                userId: "victim-user",
                workshopsVisited: ["holz"],
                items: [],
              },
              usageType: "regular" as UsageType,
              persons: [ADULT],
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "permission-denied",
      );

      expect(await listBills()).to.have.length(0);
      const db = getFirestore();
      const checkoutsSnap = await db.collection("checkouts").get();
      expect(checkoutsSnap.size).to.equal(0);
    });

    it("rejects an authenticated caller stamping a different userId on newCheckout", async () => {
      const callerUid = "user-A";
      await seedUser(callerUid);
      await expectHttpsError(
        () =>
          call({
            uid: callerUid,
            data: {
              newCheckout: {
                userId: "user-B",
                workshopsVisited: ["holz"],
                items: [],
              },
              usageType: "regular" as UsageType,
              persons: [ADULT],
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "permission-denied",
      );
    });
  });

  describe("validation", () => {
    it("rejects when persons is missing", async () => {
      await expectHttpsError(
        () =>
          call({
            uid: "user-x",
            data: {
              checkoutId: "anything",
              usageType: "regular" as UsageType,
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "invalid-argument",
      );
    });

    it("rejects when usageType is missing", async () => {
      await expectHttpsError(
        () =>
          call({
            uid: "user-x",
            data: {
              checkoutId: "anything",
              persons: [ADULT],
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "invalid-argument",
      );
    });

    it("rejects when neither checkoutId nor newCheckout is provided", async () => {
      await expectHttpsError(
        () =>
          call({
            uid: "user-x",
            data: {
              usageType: "regular" as UsageType,
              persons: [ADULT],
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "invalid-argument",
      );
    });
  });

  describe("state guards", () => {
    it("rejects closing an already-closed checkout (no existing bill)", async () => {
      const uid = "user-state-closed";
      const checkoutId = "co-already-closed";
      await seedUser(uid);
      await seedCheckout(checkoutId, {
        ownerUid: uid,
        status: "closed",
        closedAt: Timestamp.now(),
        summary: {
          totalPrice: 15,
          entryFees: 15,
          machineCost: 0,
          materialCost: 0,
          tip: 0,
        },
      });

      await expectHttpsError(
        () =>
          call({
            uid,
            data: {
              checkoutId,
              usageType: "regular" as UsageType,
              persons: [ADULT],
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "failed-precondition",
      );

      expect(await listBills()).to.have.length(0);
    });

    it("rejects closing a non-existent checkout (not-found)", async () => {
      const uid = "user-not-found";
      await seedUser(uid);
      await expectHttpsError(
        () =>
          call({
            uid,
            data: {
              checkoutId: "does-not-exist",
              usageType: "regular" as UsageType,
              persons: [ADULT],
              summary: {
                totalPrice: 0,
                entryFees: 0,
                machineCost: 0,
                materialCost: 0,
                tip: 0,
              },
            },
          }),
        "not-found",
      );
    });
  });

  describe("idempotency", () => {
    it("returns the existing bill when checkout already has billRef (safety-net trigger raced)", async () => {
      const uid = "user-idempotent";
      const checkoutId = "co-idempotent";
      const billId = "bill-pre-existing";
      await seedUser(uid);
      const db = getFirestore();
      // Seed an existing bill, link it from the checkout, and leave checkout
      // open — mirrors the "safety-net trigger created the bill in parallel"
      // race that the source code's idempotency branch handles.
      await seedBill(billId, {
        userId: uid,
        checkoutId,
        amount: 42,
        referenceNumber: 7,
      });
      await seedCheckout(checkoutId, {
        ownerUid: uid,
        billRef: db.collection("bills").doc(billId),
      });
      // Pre-allocate a billing config so we can detect any unintended advance.
      await db.doc("config/billing").set({ nextBillNumber: 99 });

      const result = await call({
        uid,
        data: {
          checkoutId,
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: {
            totalPrice: 0,
            entryFees: 0,
            machineCost: 0,
            materialCost: 0,
            tip: 0,
          },
        },
      });

      // Returned payment data reflects the existing bill, not a new one.
      expect(result.amount).to.equal("42.00");

      const bills = await listBills();
      expect(bills, "no second bill should be written").to.have.length(1);
      expect(bills[0].id).to.equal(billId);

      const billingSnap = await db.doc("config/billing").get();
      expect(
        billingSnap.data()?.nextBillNumber,
        "billing counter must not advance",
      ).to.equal(99);
    });
  });

  describe("primary userType cross-check", () => {
    it("silently overrides a client-supplied userType that differs from the stored profile", async () => {
      const uid = "user-type-mismatch";
      const checkoutId = "co-type-mismatch";
      // User is stored as adult.
      await seedUser(uid, "erwachsen");
      await seedCheckout(checkoutId, { ownerUid: uid });

      const { output } = await captureLogs(() =>
        call({
          uid,
          data: {
            checkoutId,
            usageType: "regular" as UsageType,
            // Caller posts kid pricing, attempting to pay child entry fee.
            persons: [{ ...CHILD, name: "Alice Adult", email: "alice@example.com" }],
            summary: {
              totalPrice: 0,
              entryFees: 0,
              machineCost: 0,
              materialCost: 0,
              tip: 0,
            },
          },
        }),
      );

      const checkout = await getCheckout(checkoutId);
      // Persisted person was overridden to the stored userType.
      expect(checkout.persons[0].userType).to.equal("erwachsen");

      const bills = await listBills();
      expect(bills).to.have.length(1);
      // Bill uses adult fee (15), not child fee (7.5).
      expect(bills[0].data.amount).to.equal(15);

      expect(
        output,
        "override should be logged",
      ).to.contain("Overriding client-supplied primary userType");
    });
  });

  describe("sequential bill numbering", () => {
    it("allocates monotonic reference numbers across multiple closes", async () => {
      const uidA = "user-seq-A";
      const uidB = "user-seq-B";
      const coA = "co-seq-A";
      const coB = "co-seq-B";
      await seedUser(uidA);
      await seedUser(uidB);
      await seedCheckout(coA, { ownerUid: uidA });
      await seedCheckout(coB, { ownerUid: uidB });

      await call({
        uid: uidA,
        data: {
          checkoutId: coA,
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: {
            totalPrice: 0,
            entryFees: 0,
            machineCost: 0,
            materialCost: 0,
            tip: 0,
          },
        },
      });
      await call({
        uid: uidB,
        data: {
          checkoutId: coB,
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: {
            totalPrice: 0,
            entryFees: 0,
            machineCost: 0,
            materialCost: 0,
            tip: 0,
          },
        },
      });

      const bills = await listBills();
      expect(bills).to.have.length(2);
      const refs = bills
        .map((b) => b.data.referenceNumber)
        .sort((a, b) => a - b);
      // Two sequential numbers, no gaps.
      expect(refs[1] - refs[0]).to.equal(1);

      const db = getFirestore();
      const cfg = await db.doc("config/billing").get();
      // First call bootstraps to nextBillNumber = 2; second advances to 3.
      expect(cfg.data()?.nextBillNumber).to.equal(refs[1] + 1);
    });
  });

  describe("currency", () => {
    it("stamps CHF on the bill (locks the current contract)", async () => {
      const uid = "user-currency";
      const checkoutId = "co-currency";
      await seedUser(uid);
      await seedCheckout(checkoutId, { ownerUid: uid });

      const result = await call({
        uid,
        data: {
          checkoutId,
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: {
            totalPrice: 0,
            entryFees: 0,
            machineCost: 0,
            materialCost: 0,
            tip: 0,
          },
        },
      });

      expect(result.currency).to.equal("CHF");
      const bills = await listBills();
      expect(bills[0].data.currency).to.equal("CHF");
    });
  });
});
