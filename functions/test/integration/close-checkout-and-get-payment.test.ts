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
import { isSameBusinessDay } from "@oww/shared";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  closeCheckoutAndGetPaymentHandler,
  type ClosePersonInput,
} from "../../src/invoice/close_checkout_and_get_payment";
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
  type?: "machine" | "material";
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

/**
 * The shape the web client actually sends (`personsPayload` in
 * wizard-context): identity as a plain `userId`, never a `userRef`, and no
 * server-derived fields (issue #741). Tests must call with this shape — the
 * dedup / userType tests once passed by sending refs the client never sends.
 */
function wire(p: CheckoutPersonEntity): ClosePersonInput {
  return {
    name: p.name,
    email: p.email,
    userType: p.userType,
    ...(p.billingAddress ? { billingAddress: p.billingAddress } : {}),
    userId: p.userRef?.id ?? null,
  };
}

async function seedPricingConfig(): Promise<void> {
  const db = getFirestore();
  await db.doc("config/pricing").set({
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
      metall: { label: "Metallwerkstatt", order: 2 },
    },
    entryFees: {
      erwachsen: { regular: 15, ermaessigt: 7.5, materialbezug: 0, intern: 0, hangenmoos: 15 },
      kind: { regular: 7.5, ermaessigt: 3.75, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
      firma: { regular: 30, ermaessigt: 15, materialbezug: 0, intern: 0, hangenmoos: 30 },
    },
  });
}

async function seedUser(
  uid: string,
  userType: "erwachsen" | "kind" | "firma" = "erwachsen",
  // `null` seeds a login-less user (a legacy family-roster member).
  email: string | null = "alice@example.com",
): Promise<void> {
  const db = getFirestore();
  await db.collection("users").doc(uid).set({
    created: Timestamp.now(),
    firstName: "Alice",
    lastName: "Adult",
    email,
    permissions: [],
    roles: [],
    userType,
  });
}

interface SeedOpenCheckoutOpts {
  /**
   * UID stamped into `modifiedBy`. Also used as the user-doc reference
   * for `userId` unless `userIdNull` is set.
   */
  ownerUid: string;
  /**
   * When true, persists `userId: null` on the checkout (the eager-anon
   * shape from issue #151). `modifiedBy` still uses `ownerUid`, which is
   * the anon sign-in UID for that flow.
   */
  userIdNull?: boolean;
  items?: NewItem[];
  workshopsVisited?: string[];
  persons?: CheckoutPersonEntity[];
  status?: "open" | "closed";
  billRef?: FirebaseFirestore.DocumentReference;
  /** When the visit was opened; defaults to now. */
  created?: Timestamp;
  closedAt?: Timestamp;
  summary?: CheckoutSummaryEntity;
}

async function seedCheckout(
  checkoutId: string,
  opts: SeedOpenCheckoutOpts,
): Promise<void> {
  const db = getFirestore();
  const now = Timestamp.now();
  const userRef = opts.userIdNull
    ? null
    : db.collection("users").doc(opts.ownerUid);

  // Cast: CheckoutEntity types userId as DocumentReference (non-null) but
  // the eager-anon flow writes null. The source code handles
  // `!checkout.userId` defensively, so we exercise the same shape here.
  const checkout: CheckoutEntity = {
    userId: userRef as unknown as FirebaseFirestore.DocumentReference,
    status: opts.status ?? "open",
    usageType: "regular",
    created: opts.created ?? now,
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
      ...(item.type ? { type: item.type } : {}),
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
    paymentMethodConfirmationTime: null,
    paymentMethodConfirmationSource: null,
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
  /**
   * When true, attach a `firebase.sign_in_provider: "anonymous"` claim to
   * the auth token so the callable's `isAnonymousCaller` check resolves
   * true. Mirrors the token shape Firebase Auth issues for anon sessions.
   */
  anonymous?: boolean;
  data: Record<string, unknown>;
}

/**
 * Test shorthand: most cases write the visit's type once as `data.usageType`.
 * The callable takes a type per person only (ADR-0050), so it is stamped onto
 * every person that has none and dropped from the request — what the wizard
 * sends when everyone shares one type.
 */
function perPersonUsageType(data: Record<string, unknown>): Record<string, unknown> {
  const { usageType, ...rest } = data;
  if (usageType == null || !Array.isArray(rest.persons)) return data;
  return {
    ...rest,
    persons: (rest.persons as Array<Record<string, unknown>>).map((p) =>
      p.usageType != null ? p : { ...p, usageType },
    ),
  };
}

function buildRequest(opts: CallOptions): CallableRequest<unknown> {
  const auth =
    opts.uid != null
      ? {
          uid: opts.uid,
          token: {
            ...(opts.actsAs ? { actsAs: opts.actsAs } : {}),
            ...(opts.anonymous
              ? { firebase: { sign_in_provider: "anonymous" } }
              : {}),
          },
        }
      : undefined;
  return {
    data: perPersonUsageType(opts.data),
    auth,
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

async function call(
  opts: CallOptions
): ReturnType<typeof closeCheckoutAndGetPaymentHandler> {
  return closeCheckoutAndGetPaymentHandler(
    // The handler is typed against the request schema, but for tests we want
    // to also exercise invalid shapes (missing persons / per-person usageType / both
    // checkoutId+newCheckout). Cast to any to bypass the narrowed type.
    buildRequest(opts) as unknown as Parameters<
      typeof closeCheckoutAndGetPaymentHandler
    >[0],
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
            type: "machine",
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
                type: "machine",
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

    it("rejects a person without a usage type", async () => {
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
      await db.doc("config/billing").set({
        nextBillNumber: 99,
        referenceNumberFormat: "shifted-v1",
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

  describe("account-holder userType cross-check (issue #466)", () => {
    // A person line carrying the caller's own userRef. The override only
    // targets the person matched by identity, never by array position.
    function holderPerson(
      uid: string,
      userType: "erwachsen" | "kind" | "firma",
    ): CheckoutPersonEntity {
      const db = getFirestore();
      return {
        name: "Alice Adult",
        email: "alice@example.com",
        userType,
        userRef: db.collection("users").doc(uid),
      };
    }

    it("overrides the account-holder's own spoofed userType (matched by userRef)", async () => {
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
            // Account holder posts kid pricing for their OWN line, attempting
            // to pay the child entry fee. They carry their own userRef, so the
            // override fires.
            persons: [wire(holderPerson(uid, "kind"))],
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
      ).to.contain("Overriding client-supplied account-holder userType");
    });

    it("does NOT mis-bill the first child as adult after the payer removes themselves", async () => {
      // Reproduces issue #466: a family payer (stored adult) bills only their
      // two kids — neither child carries the payer's userRef. The position-based
      // code force-stamped persons[0] (a child) with the adult userType, billing
      // 15 (adult) + 7.5 (kid) = 22.5 instead of 7.5 + 7.5 = 15.
      const uid = "family-payer-self-removed";
      const checkoutId = "co-self-removed";
      await seedUser(uid, "erwachsen");
      await seedCheckout(checkoutId, { ownerUid: uid });

      await call({
        uid,
        data: {
          checkoutId,
          usageType: "regular" as UsageType,
          // Two children, neither matching the caller's userRef.
          persons: [
            { ...CHILD, name: "Kid A", email: "kida@example.com" },
            { ...CHILD, name: "Kid B", email: "kidb@example.com" },
          ],
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
      // Both persons keep their child userType — no position-based override.
      expect(checkout.persons[0].userType).to.equal("kind");
      expect(checkout.persons[1].userType).to.equal("kind");

      const bills = await listBills();
      expect(bills).to.have.length(1);
      // 2 × child fee (7.5) = 15, NOT 15 (adult) + 7.5 (kid) = 22.5.
      expect(bills[0].data.amount).to.equal(15);
    });

    it("overrides only the account holder, leaving co-billed children untouched", async () => {
      // Holder present (matched by userRef) AND spoofing kid pricing, alongside
      // a real child. Only the holder's line is corrected; the child stays kid.
      const uid = "family-payer-present";
      const checkoutId = "co-payer-present";
      await seedUser(uid, "erwachsen");
      await seedCheckout(checkoutId, { ownerUid: uid });

      await call({
        uid,
        data: {
          checkoutId,
          usageType: "regular" as UsageType,
          persons: [
            wire(holderPerson(uid, "kind")), // spoofed to kid; will be corrected
            { ...CHILD, name: "Kid A", email: "kida@example.com" },
          ],
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
      expect(checkout.persons[0].userType).to.equal("erwachsen");
      expect(checkout.persons[1].userType).to.equal("kind");

      const bills = await listBills();
      expect(bills).to.have.length(1);
      // adult (15) + child (7.5) = 22.5.
      expect(bills[0].data.amount).to.equal(22.5);
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
      // Two sequential counter values, no gaps — stored as counter × 10
      // (revision digit 0, ADR-0042).
      expect(refs[1] - refs[0]).to.equal(10);

      const db = getFirestore();
      const cfg = await db.doc("config/billing").get();
      // First call bootstraps to nextBillNumber = 2; second advances to 3.
      expect(cfg.data()?.nextBillNumber).to.equal(refs[1] / 10 + 1);

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

  /**
   * Issue #180 regression: the eager-anon flow (issue #151) creates a
   * checkout doc with `userId: null` and `modifiedBy: <anonUid>` when
   * the visitor adds the first item. The previous ownership check
   * required `checkout.userId.id === callerUid`, which failed the
   * "Senden & zur Kasse" submit for every anon user with items. The
   * branch below covers all four cases the approved plan called out.
   */
  describe("anonymous existing-checkout submit", () => {
    const ANON_UID = "anon-uid-1";
    const OTHER_ANON_UID = "anon-uid-2";

    function seedAnonOpenCheckout(checkoutId: string): Promise<void> {
      return seedCheckout(checkoutId, {
        ownerUid: ANON_UID,
        userIdNull: true,
        items: [
          {
            workshop: "holz",
            description: "Bandsäge",
            origin: "nfc",
            type: "machine",
            quantity: 1,
            unitPrice: 20,
            totalPrice: 20,
          },
        ],
      });
    }

    it("happy path: anon caller closes their own null-userId checkout", async () => {
      const checkoutId = "co-anon-happy";
      await seedAnonOpenCheckout(checkoutId);

      const result = await call({
        uid: ANON_UID,
        anonymous: true,
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

      // 15 (entry) + 20 (nfc) = 35 CHF
      expect(result.amount).to.equal("35.00");
      expect(result.currency).to.equal("CHF");
      expect(result.payerName).to.equal(ADULT.name);

      const checkout = await getCheckout(checkoutId);
      expect(checkout.status).to.equal("closed");
      expect(checkout.billRef).to.exist;
      // userId stays null — the close path doesn't backfill it.
      expect(checkout.userId).to.equal(null);
      expect(checkout.summary?.totalPrice).to.equal(35);

      const bills = await listBills();
      expect(bills, "exactly one bill should be created").to.have.length(1);
      expect(bills[0].data.amount).to.equal(35);
      // Bill's userId is null on the anon flow.
      expect(bills[0].data.userId).to.equal(null);
    });

    it("rejects a different anon session closing the cart (cross-session)", async () => {
      const checkoutId = "co-anon-cross-session";
      await seedAnonOpenCheckout(checkoutId);

      await expectHttpsError(
        () =>
          call({
            uid: OTHER_ANON_UID,
            anonymous: true,
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

      // Cart stays open, no bill.
      expect(await listBills()).to.have.length(0);
      const checkout = await getCheckout(checkoutId);
      expect(checkout.status).to.equal("open");
    });

    it("rejects truly-unauthenticated caller (no auth context)", async () => {
      const checkoutId = "co-anon-unauth";
      await seedAnonOpenCheckout(checkoutId);

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

      expect(await listBills()).to.have.length(0);
      const checkout = await getCheckout(checkoutId);
      expect(checkout.status).to.equal("open");
    });

    it("rejects non-anonymous caller spoofing the anon session's UID", async () => {
      // Simulates a real (registered/email-signed-in) user calling with
      // the same UID as `modifiedBy` but without the anonymous sign-in
      // claim. The provider gate must keep them out — only an anon-auth
      // session may close a null-userId checkout.
      const checkoutId = "co-anon-spoof";
      await seedAnonOpenCheckout(checkoutId);

      await expectHttpsError(
        () =>
          call({
            uid: ANON_UID,
            // No `anonymous: true` — token has no firebase.sign_in_provider.
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
  });

  // Issue #237: a zero-amount visit ("Interne Nutzung", or any
  // intern-flagged checkout) used to write a bill with `paidAt: null`
  // and `paidVia: null`. Server-side it sat as "unpaid" forever,
  // waiting for a QR-bill scan that would never come. The new contract
  // is: amount === 0 → auto-mark as paid via "free" so the bill is a
  // record-only entry rather than an open receivable.
  describe("issue #237: zero-amount bills auto-close as paidVia=free", () => {
    it("marks the bill paid (paidVia=free, paidAt set) when amount is 0", async () => {
      const uid = "user-free-1";
      const checkoutId = "co-free-1";
      await seedUser(uid, "erwachsen");
      // Intern checkout with NFC items the recompute will zero out.
      await seedCheckout(checkoutId, {
        ownerUid: uid,
        items: [
          {
            workshop: "holz",
            description: "Bandsäge",
            origin: "nfc",
            type: "machine",
            quantity: 1,
            unitPrice: 20,
            totalPrice: 20,
          },
        ],
      });

      await call({
        uid,
        data: {
          checkoutId,
          usageType: "intern" as UsageType,
          // Interne Nutzung is the owner's alone (CHK-32, issue #605): the
          // owner line carries their id, as the client sends it (#741).
          persons: [{ ...wire(ADULT), userId: uid }],
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
      const bill = bills[0].data;
      // Intern usageType zeros entry+machine+material (see issue #199),
      // so the recomputed total is 0.
      expect(bill.amount).to.equal(0);
      expect(bill.paidVia).to.equal("free");
      expect(bill.paidAt, "paidAt should be set, not null").to.exist;
      expect(bill.paidAt).to.be.instanceOf(Timestamp);
    });

    it("leaves paidAt=null and paidVia=null for non-zero bills (regression)", async () => {
      // Sanity check that the new branch is amount-gated and doesn't
      // accidentally pre-mark every bill as paid.
      const uid = "user-free-control";
      const checkoutId = "co-free-control";
      await seedUser(uid, "erwachsen");
      await seedCheckout(checkoutId, { ownerUid: uid });

      await call({
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

      const bills = await listBills();
      expect(bills).to.have.length(1);
      const bill = bills[0].data;
      expect(bill.amount).to.equal(15);
      expect(bill.paidVia).to.equal(null);
      expect(bill.paidAt).to.equal(null);
    });
  });

  // -----------------------------------------------------------------------
  // Issue #268 / ADR-0050: the usage fee is billed at most once per Zurich
  // business day (boundary 03:00) per person of an account — the owner by
  // account, everyone else by name + person type — keyed on the day each
  // visit was OPENED. These tests exercise the full server close path
  // (markEntryFeeWaivedToday + recomputeSummary) against prior closed
  // checkouts seeded with controlled open/close instants.
  // -----------------------------------------------------------------------
  describe("issue #268: same-day usage-fee waiver", () => {
    // The owner's own line carries a userRef (ADR-0048).
    function namedPerson(
      uid: string,
      base: CheckoutPersonEntity,
    ): CheckoutPersonEntity {
      const db = getFirestore();
      return { ...base, userRef: db.collection("users").doc(uid) };
    }

    /**
     * Seed a CLOSED checkout listing `persons`, opened at `created`
     * (default: `closedAt`) and closed at `closedAt`. Used as the "prior
     * visit" the waiver checks against.
     */
    async function seedPriorClosedCheckout(args: {
      checkoutId: string;
      ownerUid: string;
      persons: CheckoutPersonEntity[];
      closedAt: Date;
      created?: Date;
      status?: "closed" | "cancelled";
      usageType?: UsageType;
      entryFees?: number;
    }): Promise<void> {
      const db = getFirestore();
      const ts = Timestamp.fromDate(args.closedAt);
      const checkout: CheckoutEntity = {
        userId: db.collection("users").doc(args.ownerUid),
        status: args.status ?? "closed",
        usageType: args.usageType ?? "regular",
        created: Timestamp.fromDate(args.created ?? args.closedAt),
        workshopsVisited: ["holz"],
        persons: args.persons,
        modifiedBy: args.ownerUid,
        modifiedAt: ts,
        closedAt: ts,
        summary: {
          totalPrice: args.entryFees ?? 15,
          entryFees: args.entryFees ?? 15,
          machineCost: 0,
          materialCost: 0,
          tip: 0,
          discountAmount: 0,
        },
      };
      await db.collection("checkouts").doc(args.checkoutId).set(checkout);
    }

    /**
     * A close instant `hours` ago, clamped to remain within the CURRENT
     * business day (03:00 Europe/Zurich rollover). A plain `now - 4h`
     * fixture straddles the boundary when the suite runs between 03:00
     * and 07:00 local time, turning the waived-fee assertions red.
     */
    function hoursAgoSameBusinessDay(hours: number): Date {
      const now = new Date();
      const candidate = new Date(now.getTime() - hours * 3600 * 1000);
      if (isSameBusinessDay(candidate, now)) return candidate;
      const oneMinuteAgo = new Date(now.getTime() - 60_000);
      return isSameBusinessDay(oneMinuteAgo, now) ? oneMinuteAgo : now;
    }

    it("(a) waives the fee on a second same-day checkout for the same user", async () => {
      const uid = "dedup-same-day";
      await seedUser(uid, "erwachsen");
      const person = namedPerson(uid, ADULT);

      // Prior visit closed a few hours ago today.
      await seedPriorClosedCheckout({
        checkoutId: "co-prior-sameday",
        ownerUid: uid,
        persons: [person],
        closedAt: hoursAgoSameBusinessDay(4),
      });

      // New open checkout, no items — just the entry fee in play.
      await seedCheckout("co-second-sameday", {
        ownerUid: uid,
        persons: [person],
      });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-second-sameday",
          usageType: "regular" as UsageType,
          persons: [wire(person)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      // Entry fee already paid today -> 0, not 15.
      expect(result.amount).to.equal("0.00");
      const checkout = await getCheckout("co-second-sameday");
      expect(checkout.summary?.entryFees).to.equal(0);
      expect(checkout.summary?.totalPrice).to.equal(0);
      expect(checkout.persons[0].entryFeeWaivedToday).to.equal(true);
    });

    it("(b) charges the fee again the next business day (after 03:00)", async () => {
      const uid = "dedup-next-day";
      await seedUser(uid, "erwachsen");
      const person = namedPerson(uid, ADULT);

      // Prior visit closed ~28h ago — clearly a previous business day.
      await seedPriorClosedCheckout({
        checkoutId: "co-prior-yesterday",
        ownerUid: uid,
        persons: [person],
        closedAt: new Date(Date.now() - 28 * 3600 * 1000),
      });

      await seedCheckout("co-today", { ownerUid: uid, persons: [person] });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-today",
          usageType: "regular" as UsageType,
          persons: [wire(person)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      // Different business day -> fee charged again.
      expect(result.amount).to.equal("15.00");
      const checkout = await getCheckout("co-today");
      expect(checkout.summary?.entryFees).to.equal(15);
      expect(checkout.persons[0].entryFeeWaivedToday).to.not.equal(true);
    });

    it("(c) respects the 03:00 boundary: a 02:00 prior close is the previous day", async () => {
      const uid = "dedup-boundary";
      await seedUser(uid, "erwachsen");
      const person = namedPerson(uid, ADULT);

      // Pick a prior close at 02:00 Zurich. The current close (now) is the
      // same calendar date but a different *business* day, so the fee must
      // be charged again. To make this deterministic regardless of when the
      // suite runs, place the prior close at 02:00 Zurich on *today's*
      // calendar date and assert: if now is also before 03:00 Zurich they'd
      // share a business day — so we instead anchor both via fixed instants
      // by checking the helper's contract through a prior close that is
      // unambiguously the prior business night (02:00 Zurich, ~today) only
      // when "now" is past 03:00.
      //
      // Construct 02:00 Zurich for the current calendar day. CET/CEST aside,
      // 00:00..01:00 UTC maps to 01:00..03:00 Zurich; 00:30 UTC is reliably
      // before the 03:00 boundary. We seed the prior close at "today 00:30
      // UTC" which is 02:30 Zurich (winter) / 02:30 Zurich is < 03:00, so it
      // belongs to the previous business day relative to a daytime "now".
      const now = new Date();
      const priorClose = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          0,
          30,
          0,
        ),
      );

      await seedPriorClosedCheckout({
        checkoutId: "co-prior-0200",
        ownerUid: uid,
        persons: [person],
        closedAt: priorClose,
      });

      await seedCheckout("co-after-boundary", {
        ownerUid: uid,
        persons: [person],
      });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-after-boundary",
          usageType: "regular" as UsageType,
          persons: [wire(person)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      // The fee is waived iff the prior visit's opening shares a business
      // day with the current one's (seeded "now"). Compute the expectation from the same
      // `@oww/shared` helper the production code uses so the assertion is
      // deterministic in every wall-clock window. The previous hand-rolled
      // `nowZurichHour >= 3` heuristic was wrong whenever "now"'s Zurich
      // calendar date differs from its UTC date (late-evening UTC =
      // early-morning Zurich): the prior close, anchored to now's *UTC* date
      // at 00:30 UTC, then lands on a different business day than the hour
      // check predicted, making the test flaky overnight (issue #393 follow-up).
      if (isSameBusinessDay(priorClose, now)) {
        expect(result.amount).to.equal("0.00");
      } else {
        expect(result.amount).to.equal("15.00");
      }
    });

    it("(d) waives a companion by name and person type, not by link", async () => {
      const uid = "dedup-by-name";
      await seedUser(uid, "erwachsen");
      // A companion typed in by name (no userRef, never saved) was on an
      // earlier visit of the same account today.
      await seedPriorClosedCheckout({
        checkoutId: "co-prior-by-name",
        ownerUid: uid,
        persons: [ADULT, CHILD],
        closedAt: hoursAgoSameBusinessDay(4),
      });

      await seedCheckout("co-by-name", { ownerUid: uid, persons: [ADULT, CHILD] });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-by-name",
          usageType: "regular" as UsageType,
          persons: [
            // Same person, words swapped and re-cased.
            { ...wire(ADULT), name: "  adult  ALICE " },
            // Same name, other person type: someone else.
            { ...wire(CHILD), userType: "erwachsen" },
          ],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      expect(result.amount).to.equal("15.00");
      const checkout = await getCheckout("co-by-name");
      expect(checkout.persons[0].entryFeeWaivedToday).to.equal(true);
      expect(checkout.persons[1].entryFeeWaivedToday).to.not.equal(true);
    });

    it("(e) mixed group: waives the already-charged member, charges the new one", async () => {
      const adultUid = "dedup-mixed-adult";
      await seedUser(adultUid, "erwachsen");
      const adult = namedPerson(adultUid, ADULT);
      // A guest by name (ADR-0048): only the owner's line carries a userRef.
      const kid = CHILD;

      // Earlier today the adult visited alone and paid.
      await seedPriorClosedCheckout({
        checkoutId: "co-prior-adult-only",
        ownerUid: adultUid,
        persons: [adult],
        closedAt: hoursAgoSameBusinessDay(4),
      });

      // Now the adult returns WITH the kid (kid's first visit today).
      await seedCheckout("co-mixed", {
        ownerUid: adultUid,
        persons: [adult, kid],
      });

      const result = await call({
        uid: adultUid,
        data: {
          checkoutId: "co-mixed",
          usageType: "regular" as UsageType,
          persons: [wire(adult), wire(kid)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      // Adult waived (already paid 15 today), kid charged 7.5.
      expect(result.amount).to.equal("7.50");
      const checkout = await getCheckout("co-mixed");
      expect(checkout.summary?.entryFees).to.equal(7.5);
      expect(checkout.persons[0].entryFeeWaivedToday).to.equal(true); // adult
      expect(checkout.persons[1].entryFeeWaivedToday).to.not.equal(true); // kid
    });

    it("waives whatever the earlier line paid (Hangenmoos in the morning)", async () => {
      const uid = "dedup-any-fee";
      await seedUser(uid, "erwachsen");
      const person = namedPerson(uid, ADULT);

      // The morning visit charged no usage fee at all.
      await seedPriorClosedCheckout({
        checkoutId: "co-prior-hangenmoos",
        ownerUid: uid,
        persons: [{ ...person, usageType: "hangenmoos" }],
        usageType: "hangenmoos",
        closedAt: hoursAgoSameBusinessDay(4),
        entryFees: 0,
      });

      await seedCheckout("co-after-hangenmoos", { ownerUid: uid, persons: [person] });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-after-hangenmoos",
          usageType: "regular" as UsageType,
          persons: [wire(person)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      expect(result.amount).to.equal("0.00");
      const checkout = await getCheckout("co-after-hangenmoos");
      expect(checkout.persons[0].entryFeeWaivedToday).to.equal(true);
    });

    it("ignores a cancelled visit", async () => {
      const uid = "dedup-cancelled";
      await seedUser(uid, "erwachsen");
      const person = namedPerson(uid, ADULT);

      await seedPriorClosedCheckout({
        checkoutId: "co-prior-cancelled",
        ownerUid: uid,
        persons: [person],
        closedAt: hoursAgoSameBusinessDay(4),
        status: "cancelled",
      });

      await seedCheckout("co-after-cancelled", { ownerUid: uid, persons: [person] });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-after-cancelled",
          usageType: "regular" as UsageType,
          persons: [wire(person)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      expect(result.amount).to.equal("15.00");
    });

    it("compares opening days: a visit opened yesterday doesn't cover today's", async () => {
      const uid = "dedup-opened-yesterday";
      await seedUser(uid, "erwachsen");
      const person = namedPerson(uid, ADULT);

      // Opened ~28h ago (a previous business day), closed only just now.
      await seedPriorClosedCheckout({
        checkoutId: "co-prior-overnight",
        ownerUid: uid,
        persons: [person],
        created: new Date(Date.now() - 28 * 3600 * 1000),
        closedAt: hoursAgoSameBusinessDay(0),
      });

      await seedCheckout("co-today-fresh", { ownerUid: uid, persons: [person] });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-today-fresh",
          usageType: "regular" as UsageType,
          persons: [wire(person)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      expect(result.amount).to.equal("15.00");
    });

    it("compares opening days: a visit opened yesterday and closed today isn't covered by today's", async () => {
      const uid = "dedup-current-yesterday";
      await seedUser(uid, "erwachsen");
      const person = namedPerson(uid, ADULT);

      await seedPriorClosedCheckout({
        checkoutId: "co-prior-today",
        ownerUid: uid,
        persons: [person],
        closedAt: hoursAgoSameBusinessDay(0),
      });

      // The visit being closed now was opened the previous business day.
      await seedCheckout("co-left-open", {
        ownerUid: uid,
        persons: [person],
        created: Timestamp.fromDate(new Date(Date.now() - 28 * 3600 * 1000)),
      });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-left-open",
          usageType: "regular" as UsageType,
          persons: [wire(person)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      expect(result.amount).to.equal("15.00");
    });
  });

  describe("roster identity (ADR-0048): only the owner's line carries a userRef", () => {
    it("drops a crafted wire userId on the create-and-close path", async () => {
      const memberUid = "roster-wire-acct";
      await seedUser(memberUid, "erwachsen");

      // An ownerless checkout vouches for no one, so a claimed identity is
      // discarded (issue #741) — the person is billed as a guest and nothing
      // links the visit to the claimed account.
      const result = await call({
        uid: "anon-roster-1",
        anonymous: true,
        data: {
          newCheckout: { userId: null, workshopsVisited: ["holz"], items: [] },
          usageType: "regular" as UsageType,
          persons: [{ ...wire(ADULT), name: "Bea Buddy", userId: memberUid }],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      const checkout = await getCheckout(result.checkoutId!);
      expect(checkout.persons[0].userRef).to.not.exist;
    });

    it("keeps only the caller's own identity on the create-and-close path", async () => {
      const callerUid = "roster-wire-caller";
      const memberUid = "roster-wire-acct-2";
      await seedUser(callerUid, "erwachsen");
      await seedUser(memberUid, "erwachsen");

      const result = await call({
        uid: callerUid,
        data: {
          newCheckout: {
            userId: callerUid,
            workshopsVisited: ["holz"],
            items: [],
          },
          usageType: "regular" as UsageType,
          persons: [
            { ...wire(ADULT), userId: callerUid },
            { ...wire(ADULT), name: "Bea Buddy", userId: memberUid },
          ],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      const checkout = await getCheckout(result.checkoutId!);
      expect(checkout.persons[0].userRef?.id).to.equal(callerUid);
      expect(checkout.persons[1].userRef).to.not.exist;
    });
  });

  // Issue #741: the close overwrites the stored roster with the wire
  // persons, which carried no identity — every closed checkout lost its
  // person ↔ account links (and with them #268 and #466).
  describe("person identity survives the close (issue #741)", () => {
    it("persists the owner's userRef; a legacy family-roster line closes as a guest", async () => {
      const uid = "identity-owner";
      const kidUid = "identity-kid";
      const db = getFirestore();
      await seedUser(uid, "erwachsen");
      await seedUser(kidUid, "kind", null);
      const owner = { ...ADULT, userRef: db.collection("users").doc(uid) };
      // An open checkout from before ADR-0048 may still roster a login-less
      // family member — the stored roster no longer vouches for it.
      const kid = { ...CHILD, userRef: db.collection("users").doc(kidUid) };
      await seedCheckout("co-identity", { ownerUid: uid, persons: [owner, kid] });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-identity",
          usageType: "regular" as UsageType,
          persons: [wire(owner), wire(kid)],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      expect(result.amount).to.equal("22.50");
      const checkout = await getCheckout("co-identity");
      expect(checkout.status).to.equal("closed");
      expect(checkout.persons[0].userRef?.id).to.equal(uid);
      expect(checkout.persons[1].userRef).to.not.exist;
    });

    it("drops a non-owner userId", async () => {
      const uid = "identity-owner-2";
      const strangerUid = "identity-stranger";
      await seedUser(uid, "erwachsen");
      await seedUser(strangerUid, "kind", null);
      await seedCheckout("co-identity-2", { ownerUid: uid, persons: [ADULT] });

      await call({
        uid,
        data: {
          checkoutId: "co-identity-2",
          usageType: "regular" as UsageType,
          persons: [wire(ADULT), { ...wire(CHILD), userId: strangerUid }],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      const checkout = await getCheckout("co-identity-2");
      expect(checkout.persons[1].userRef).to.not.exist;
    });

    it("keeps a repeated userId on its first line only — no waiver piggyback", async () => {
      const uid = "identity-repeat";
      const db = getFirestore();
      await seedUser(uid, "erwachsen");
      const owner = { ...ADULT, userRef: db.collection("users").doc(uid) };
      // The owner already paid today, so their own line is waived.
      // Clamped so a run straddling the 03:00 rollover stays same-day.
      const minuteAgo = new Date(Date.now() - 60_000);
      const priorAt = Timestamp.fromDate(
        isSameBusinessDay(minuteAgo, new Date()) ? minuteAgo : new Date(),
      );
      await db.collection("checkouts").doc("co-repeat-prior").set({
        userId: db.collection("users").doc(uid),
        status: "closed",
        usageType: "regular",
        created: priorAt,
        closedAt: priorAt,
        workshopsVisited: ["holz"],
        persons: [owner],
        modifiedBy: uid,
        modifiedAt: priorAt,
        summary: { totalPrice: 15, entryFees: 15, machineCost: 0, materialCost: 0, tip: 0, discountAmount: 0 },
      });
      await seedCheckout("co-repeat", { ownerUid: uid, persons: [owner] });

      // Two extra guests posted under the owner's id.
      const result = await call({
        uid,
        data: {
          checkoutId: "co-repeat",
          usageType: "regular" as UsageType,
          persons: [wire(owner), { ...wire(owner), name: "Guest A" }, { ...wire(owner), name: "Guest B" }],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      // Owner waived; both guests charged as guests.
      expect(result.amount).to.equal("30.00");
      const checkout = await getCheckout("co-repeat");
      expect(checkout.persons[0].userRef?.id).to.equal(uid);
      expect(checkout.persons[1].userRef).to.not.exist;
      expect(checkout.persons[2].userRef).to.not.exist;
    });

    it("never takes entryFeeWaivedToday from the client", async () => {
      const uid = "identity-waiver-spoof";
      await seedUser(uid, "erwachsen");
      await seedCheckout("co-waiver-spoof", { ownerUid: uid });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-waiver-spoof",
          usageType: "regular" as UsageType,
          persons: [{ ...wire(ADULT), entryFeeWaivedToday: true }],
          summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
        },
      });

      expect(result.amount).to.equal("15.00");
      const checkout = await getCheckout("co-waiver-spoof");
      expect(checkout.persons[0].entryFeeWaivedToday).to.not.equal(true);
    });

    it("rejects a malformed person userId", async () => {
      const uid = "identity-malformed";
      await seedUser(uid, "erwachsen");
      await seedCheckout("co-identity-malformed", { ownerUid: uid });

      await expectHttpsError(
        () =>
          call({
            uid,
            data: {
              checkoutId: "co-identity-malformed",
              usageType: "regular" as UsageType,
              persons: [{ ...wire(ADULT), userId: { id: uid } }],
              summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
            },
          }),
        "invalid-argument",
      );
    });
  });

  // Issue #750: the method is confirmed on the same screen as the close, so
  // the close commits it and mints the bill already committed.
  describe("paymentMethod committed with the close (issue #750)", () => {
    const UID = "user-commit";
    const CHECKOUT_ID = "co-commit";
    const ZERO_SUMMARY = {
      totalPrice: 0,
      entryFees: 0,
      machineCost: 0,
      materialCost: 0,
      tip: 0,
    };

    async function seedMember(uid: string): Promise<void> {
      await seedUser(uid);
      await getFirestore()
        .collection("users")
        .doc(uid)
        .update({ activeMembership: getFirestore().collection("memberships").doc(`m-${uid}`) });
    }

    function seedOpen(checkoutId = CHECKOUT_ID, ownerUid = UID): Promise<void> {
      return seedCheckout(checkoutId, {
        ownerUid,
        items: [
          { workshop: "holz", description: "Schraubensatz", origin: "manual", quantity: 1, unitPrice: 5, totalPrice: 5 },
        ],
      });
    }

    function closeWith(
      paymentMethod: string | undefined,
      opts: { uid?: string; actsAs?: string; checkoutId?: string; usageType?: UsageType } = {},
    ) {
      return call({
        uid: opts.uid ?? UID,
        ...(opts.actsAs ? { actsAs: opts.actsAs } : {}),
        data: {
          checkoutId: opts.checkoutId ?? CHECKOUT_ID,
          usageType: opts.usageType ?? ("regular" as UsageType),
          // An owner-only type needs the owner's line (CHK-32, ADR-0050).
          persons: [opts.usageType === "intern" ? { ...wire(ADULT), userId: UID } : ADULT],
          summary: ZERO_SUMMARY,
          ...(paymentMethod !== undefined ? { paymentMethod } : {}),
        },
      });
    }

    it("rechnung: the bill is minted acked by the user and the checkout carries the method", async () => {
      await seedUser(UID);
      await seedOpen();

      const result = await closeWith("rechnung");
      expect(result.paymentMethod).to.equal("rechnung");
      expect(result.payerEmail).to.equal(ADULT.email);
      expect(result.qrBillPayload).to.contain("SPC");

      const [bill] = await listBills();
      expect(bill.data.kind).to.equal("invoice");
      expect(bill.data.paymentMethodConfirmationTime).to.be.instanceOf(Timestamp);
      expect(bill.data.paymentMethodConfirmationSource).to.equal("user");
      const checkout = await getCheckout(CHECKOUT_ID);
      expect(checkout.status).to.equal("closed");
      expect(checkout.paymentMethod).to.equal("rechnung");
    });

    it("monthly: a member's bill is minted as a Beleg without an ack stamp", async () => {
      await seedMember(UID);
      await seedOpen();

      await closeWith("monthly");

      const [bill] = await listBills();
      expect(bill.data.kind).to.equal("beleg");
      expect(bill.data.paymentMethodConfirmationTime).to.equal(null);
      expect(bill.data.aggregatedIntoBillRef).to.equal(null);
      expect((await getCheckout(CHECKOUT_ID)).paymentMethod).to.equal("monthly");
    });

    it("monthly: refused for a non-member — the checkout stays open and no bill is minted", async () => {
      await seedUser(UID);
      await seedOpen();

      await expectHttpsError(() => closeWith("monthly"), "failed-precondition");

      expect(await listBills()).to.have.length(0);
      const checkout = await getCheckout(CHECKOUT_ID);
      expect(checkout.status).to.equal("open");
      expect(checkout.paymentMethod ?? null).to.equal(null);
    });

    it("monthly: refused on a guest's create-and-close", async () => {
      await expectHttpsError(
        () =>
          call({
            uid: "anon-commit",
            anonymous: true,
            data: {
              newCheckout: {
                userId: null,
                workshopsVisited: ["holz"],
                items: [
                  { workshop: "holz", description: "Schraubensatz", origin: "manual", catalogId: null, quantity: 1, unitPrice: 5, totalPrice: 5 },
                ],
              },
              usageType: "regular" as UsageType,
              persons: [ADULT],
              summary: ZERO_SUMMARY,
              paymentMethod: "monthly",
            },
          }),
        "failed-precondition",
      );
      expect(await listBills()).to.have.length(0);
    });

    it("rechnung on a guest's create-and-close: the new checkout and its bill are committed", async () => {
      await call({
        uid: "anon-commit",
        anonymous: true,
        data: {
          newCheckout: {
            userId: null,
            workshopsVisited: ["holz"],
            items: [
              { workshop: "holz", description: "Schraubensatz", origin: "manual", catalogId: null, quantity: 1, unitPrice: 5, totalPrice: 5 },
            ],
          },
          usageType: "regular" as UsageType,
          persons: [ADULT],
          summary: ZERO_SUMMARY,
          paymentMethod: "rechnung",
        },
      });

      const [bill] = await listBills();
      expect(bill.data.paymentMethodConfirmationSource).to.equal("user");
      const checkout = (await bill.data.checkouts[0].get()).data() as CheckoutEntity;
      expect(checkout.paymentMethod).to.equal("rechnung");
    });

    it("raisenow: the intent to pay by TWINT closes and commits; the paylink comes back", async () => {
      await seedUser(UID);
      await seedOpen();

      const result = await closeWith("raisenow");
      expect(result.paylinkUrl).to.contain("reference.creditor");

      const [bill] = await listBills();
      expect(bill.data.kind).to.equal("invoice");
      expect(bill.data.paymentMethodConfirmationSource).to.equal("user");
      const checkout = await getCheckout(CHECKOUT_ID);
      expect(checkout.status).to.equal("closed");
      expect(checkout.paymentMethod).to.equal("raisenow");
    });

    it("rejects an unknown paymentMethod", async () => {
      await seedUser(UID);
      await seedOpen();
      await expectHttpsError(() => closeWith("bitcoin"), "invalid-argument");
    });

    it("without a method the bill stays unconfirmed, as before", async () => {
      await seedUser(UID);
      await seedOpen();

      await closeWith(undefined);

      const [bill] = await listBills();
      expect(bill.data.paymentMethodConfirmationTime).to.equal(null);
      expect(bill.data.kind).to.equal("invoice");
      expect((await getCheckout(CHECKOUT_ID)).paymentMethod ?? null).to.equal(null);
    });

    it("a CHF 0 checkout ignores the method and closes as free (BIL-8)", async () => {
      await seedUser(UID);
      await seedCheckout(CHECKOUT_ID, { ownerUid: UID, items: [] });

      const result = await closeWith("rechnung", { usageType: "intern" as UsageType });
      expect(result.paymentMethod).to.equal(null);

      const [bill] = await listBills();
      expect(bill.data.amount).to.equal(0);
      expect(bill.data.paidVia).to.equal("free");
      expect(bill.data.paymentMethodConfirmationSource).to.equal("auto");
      expect((await getCheckout(CHECKOUT_ID)).paymentMethod ?? null).to.equal(null);
    });

    it("a repeated close commits the method on the existing bill once, without a second bill", async () => {
      await seedUser(UID);
      await seedOpen();

      await closeWith(undefined);
      const [unconfirmed] = await listBills();
      expect(unconfirmed.data.paymentMethodConfirmationTime).to.equal(null);

      // The checkout is closed now; only the idempotency branch can answer.
      await closeWith("rechnung");
      let bills = await listBills();
      expect(bills).to.have.length(1);
      const firstAck = bills[0].data.paymentMethodConfirmationTime;
      expect(firstAck).to.be.instanceOf(Timestamp);
      expect((await getCheckout(CHECKOUT_ID)).paymentMethod).to.equal("rechnung");

      // A third call (double tap) changes nothing.
      await closeWith("rechnung");
      bills = await listBills();
      expect(bills).to.have.length(1);
      expect(bills[0].data.paymentMethodConfirmationTime!.isEqual(firstAck!)).to.equal(true);
    });

    it("a repeated close with monthly turns the existing bill into a Beleg", async () => {
      await seedMember(UID);
      await seedOpen();

      await closeWith(undefined);
      const retry = await closeWith("monthly");
      expect(retry.paymentMethod).to.equal("monthly");

      const bills = await listBills();
      expect(bills).to.have.length(1);
      expect(bills[0].data.kind).to.equal("beleg");
      expect(bills[0].data.paymentMethodConfirmationTime).to.equal(null);
      expect((await getCheckout(CHECKOUT_ID)).paymentMethod).to.equal("monthly");
    });

    // The first commit wins: a retry carrying another method (after a lost
    // response) answers with the bill as it is, so the client must render
    // what the server returns, not what it sent.
    it("a repeated close after the bill was committed keeps the first method", async () => {
      await seedMember(UID);
      await seedOpen();

      await closeWith("rechnung");
      const retry = await closeWith("monthly");
      expect(retry.paymentMethod).to.equal("rechnung");

      const bills = await listBills();
      expect(bills).to.have.length(1);
      expect(bills[0].data.kind).to.equal("invoice");
      expect(bills[0].data.paymentMethodConfirmationSource).to.equal("user");
      expect((await getCheckout(CHECKOUT_ID)).paymentMethod).to.equal("rechnung");
    });

    it("a repeated close never commits a cancelled bill (ADR-0042)", async () => {
      await seedUser(UID);
      await seedOpen();

      await closeWith(undefined);
      const [bill] = await listBills();
      await getFirestore().collection("bills").doc(bill.id).update({ cancelledAt: Timestamp.now() });

      await closeWith("rechnung");

      const [after] = await listBills();
      expect(after.data.paymentMethodConfirmationTime).to.equal(null);
      expect((await getCheckout(CHECKOUT_ID)).paymentMethod ?? null).to.equal(null);
    });

    it("a repeated close by someone else is refused and leaves the bill unconfirmed", async () => {
      await seedUser(UID);
      await seedUser("user-intruder");
      await seedOpen();

      await closeWith(undefined);
      await expectHttpsError(
        () => closeWith("rechnung", { uid: "user-intruder" }),
        "permission-denied",
      );

      const [bill] = await listBills();
      expect(bill.data.paymentMethodConfirmationTime).to.equal(null);
      expect((await getCheckout(CHECKOUT_ID)).paymentMethod ?? null).to.equal(null);
    });

    it("two closes at once mint one bill, committed once", async () => {
      await seedUser(UID);
      await seedOpen();

      await Promise.all([closeWith("rechnung"), closeWith("rechnung")]);

      const bills = await listBills();
      expect(bills).to.have.length(1);
      expect(bills[0].data.paymentMethodConfirmationSource).to.equal("user");
    });

    describe("kiosk badge session (actsAs)", () => {
      const TAG = "tag:kiosk-commit";

      it("monthly: a member's badge session mints a Beleg", async () => {
        await seedMember(UID);
        await seedOpen();

        await closeWith("monthly", { uid: TAG, actsAs: UID });

        const [bill] = await listBills();
        expect(bill.data.kind).to.equal("beleg");
        expect(bill.data.userId.id).to.equal(UID);
      });

      it("monthly: refused for a non-member's badge session", async () => {
        await seedUser(UID);
        await seedOpen();

        await expectHttpsError(
          () => closeWith("monthly", { uid: TAG, actsAs: UID }),
          "failed-precondition",
        );
        expect(await listBills()).to.have.length(0);
        expect((await getCheckout(CHECKOUT_ID)).status).to.equal("open");
      });
    });
  });

  // Issue #605 (ADR-0050): each person carries their own usage type; the
  // server derives the visit's and validates the owner-only types.
  describe("per-person usage types (issue #605)", () => {
    const EMPTY_SUMMARY = { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 };

    function sameDayInstant(): Date {
      const minuteAgo = new Date(Date.now() - 60_000);
      return isSameBusinessDay(minuteAgo, new Date()) ? minuteAgo : new Date();
    }

    async function seedSavedPerson(ownerUid: string, id: string): Promise<void> {
      await getFirestore()
        .collection("users").doc(ownerUid)
        .collection("savedPersons").doc(id)
        .set({
          firstName: "Kim",
          lastName: "Kind",
          userType: "kind",
          createdAt: Timestamp.now(),
          modifiedBy: ownerUid,
          modifiedAt: Timestamp.now(),
        });
    }

    it("bills each person by their own type and persists it", async () => {
      const uid = "ppu-mixed";
      const db = getFirestore();
      await seedUser(uid, "erwachsen");
      const owner = { ...ADULT, userRef: db.collection("users").doc(uid) };
      await seedCheckout("co-ppu-mixed", { ownerUid: uid, persons: [owner, CHILD] });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-ppu-mixed",
          persons: [
            { ...wire(owner), usageType: "materialbezug" },
            { ...wire(CHILD), usageType: "regular" },
          ],
          summary: EMPTY_SUMMARY,
        },
      });

      // Accompanying adult free, child pays the regular child fee.
      expect(result.amount).to.equal("7.50");
      const checkout = await getCheckout("co-ppu-mixed");
      expect(checkout.usageType).to.equal("regular");
      expect(checkout.persons.map((p) => p.usageType)).to.deep.equal(["materialbezug", "regular"]);
      expect(checkout.summary?.entryFees).to.equal(22.5);
      expect(checkout.summary?.totalPrice).to.equal(7.5);
    });

    it("refuses machine time when every person is Begleitung", async () => {
      const uid = "ppu-machine";
      await seedUser(uid, "erwachsen");
      await seedCheckout("co-ppu-machine", {
        ownerUid: uid,
        items: [{ origin: "nfc", type: "machine", quantity: 1, unitPrice: 25, totalPrice: 25 }],
      });

      await expectHttpsError(
        () =>
          call({
            uid,
            data: {
              checkoutId: "co-ppu-machine",
              persons: [
                { ...wire(ADULT), userId: uid, usageType: "materialbezug" },
                { ...wire(CHILD), usageType: "materialbezug" },
              ],
              summary: EMPTY_SUMMARY,
            },
          }),
        "failed-precondition",
      );
    });

    it("refuses an owner-only type while others are on the visit", async () => {
      const uid = "ppu-intern-group";
      await seedUser(uid, "erwachsen");
      await seedCheckout("co-ppu-intern-group", { ownerUid: uid });

      await expectHttpsError(
        () =>
          call({
            uid,
            data: {
              checkoutId: "co-ppu-intern-group",
              persons: [
                { ...wire(ADULT), userId: uid, usageType: "intern" },
                { ...wire(CHILD), usageType: "regular" },
              ],
              summary: EMPTY_SUMMARY,
            },
          }),
        "invalid-argument",
      );
    });

    it("refuses an owner-only type on a guest check-in", async () => {
      await expectHttpsError(
        () =>
          call({
            uid: null,
            data: {
              newCheckout: { userId: null, workshopsVisited: ["holz"], items: [] },
              persons: [{ ...wire(ADULT), usageType: "volunteering" }],
              summary: EMPTY_SUMMARY,
            },
          }),
        "invalid-argument",
      );
    });

    it("rejects an unknown per-person usage type", async () => {
      const uid = "ppu-unknown";
      await seedUser(uid, "erwachsen");
      await seedCheckout("co-ppu-unknown", { ownerUid: uid });

      await expectHttpsError(
        () =>
          call({
            uid,
            data: {
              checkoutId: "co-ppu-unknown",
              persons: [{ ...wire(ADULT), userId: uid, usageType: "gratis" }],
              summary: EMPTY_SUMMARY,
            },
          }),
        "invalid-argument",
      );
    });

    it("keeps a savedPersonId only when the owner's saved person exists", async () => {
      const uid = "ppu-saved";
      await seedUser(uid, "erwachsen");
      await seedSavedPerson(uid, "kim");
      await seedSavedPerson("someone-else", "theirs");
      await seedCheckout("co-ppu-saved", { ownerUid: uid });

      await call({
        uid,
        data: {
          checkoutId: "co-ppu-saved",
          persons: [
            { ...wire(ADULT), userId: uid, usageType: "regular", savedPersonId: "kim" },
            { ...wire(CHILD), usageType: "regular", savedPersonId: "kim" },
            { ...wire(CHILD), name: "Repeat", usageType: "regular", savedPersonId: "kim" },
            { ...wire(CHILD), name: "Forged", usageType: "regular", savedPersonId: "theirs" },
          ],
          summary: EMPTY_SUMMARY,
        },
      });

      const checkout = await getCheckout("co-ppu-saved");
      // The owner's own line never carries one; repeats and other owners'
      // ids are dropped.
      expect(checkout.persons.map((p) => p.savedPersonId ?? null)).to.deep.equal([
        null,
        "kim",
        null,
        null,
      ]);
    });

    it("waives everyone already on a visit opened the same day, saved or not", async () => {
      const uid = "ppu-same-day-names";
      const db = getFirestore();
      await seedUser(uid, "erwachsen");
      await seedSavedPerson(uid, "kim");
      const at = Timestamp.fromDate(sameDayInstant());
      await db.collection("checkouts").doc("co-ppu-names-prior").set({
        userId: db.collection("users").doc(uid),
        status: "closed",
        usageType: "regular",
        created: at,
        closedAt: at,
        workshopsVisited: ["holz"],
        persons: [
          // Owner only accompanied — no fee charged, still covered (ADR-0050).
          { ...ADULT, userRef: db.collection("users").doc(uid), usageType: "materialbezug" },
          { ...CHILD, savedPersonId: "kim", usageType: "regular" },
        ],
        modifiedBy: uid,
        modifiedAt: at,
        summary: { totalPrice: 7.5, entryFees: 22.5, machineCost: 0, materialCost: 0, tip: 0, discountAmount: 15 },
      });
      await seedCheckout("co-ppu-names-second", { ownerUid: uid });

      const result = await call({
        uid,
        data: {
          checkoutId: "co-ppu-names-second",
          persons: [
            { ...wire(ADULT), userId: uid, usageType: "regular" },
            // Typed in again, not picked from the saved persons.
            { ...wire(CHILD), name: "Kid Charlie", usageType: "regular" },
          ],
          summary: EMPTY_SUMMARY,
        },
      });

      expect(result.amount).to.equal("0.00");
      const checkout = await getCheckout("co-ppu-names-second");
      expect(checkout.persons[0].entryFeeWaivedToday).to.equal(true);
      expect(checkout.persons[1].entryFeeWaivedToday).to.equal(true);
    });
  });
});
