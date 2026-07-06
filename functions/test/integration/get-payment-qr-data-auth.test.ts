// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Authorisation coverage for the `getPaymentQrData` callable
 * (`functions/src/invoice/get_payment_qr_data.ts`, S-1).
 *
 * The endpoint returns payer name, email, amount and SCOR reference. It
 * previously had zero access control — any caller who learned a billId
 * could read the payer's PII (IDOR). These tests assert the same
 * owner-or-admin-or-anon-owner matrix every sibling bill endpoint enforces.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { getPaymentQrDataHandler } from "../../src/invoice/get_payment_qr_data";
import type { BillEntity } from "../../src/invoice/types";
import type { CheckoutEntity } from "../../src/types/firestore_entities";

async function seedBillAndCheckout(
  billId: string,
  ownerUid: string | null,
  checkoutId = "co1",
  // For anonymous (null-userId) walk-in bills, the linked checkout carries the
  // creating anon session's uid; access is scoped to it.
  firebaseUid: string | null = null,
): Promise<void> {
  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc(checkoutId);
  const userRef = ownerUid ? db.collection("users").doc(ownerUid) : null;
  const now = Timestamp.now();

  const checkout: CheckoutEntity = {
    userId: userRef as unknown as FirebaseFirestore.DocumentReference,
    status: "closed",
    usageType: "regular",
    created: now,
    workshopsVisited: ["holz"],
    persons: [
      { name: "Alice Payer", email: "alice@example.com", userType: "erwachsen" },
    ],
    modifiedBy: ownerUid,
    modifiedAt: now,
    closedAt: now,
    firebaseUid,
  };
  await checkoutRef.set(checkout);

  const bill: BillEntity = {
    userId: userRef as unknown as FirebaseFirestore.DocumentReference,
    checkouts: [checkoutRef],
    referenceNumber: 1,
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
  };
  await db.collection("bills").doc(billId).set(bill);
}

function buildRequest(
  uid: string | null,
  data: Record<string, unknown>,
  opts: { actsAs?: string; anonymous?: boolean; admin?: boolean } = {},
): CallableRequest<unknown> {
  const auth =
    uid != null
      ? {
          uid,
          token: {
            ...(opts.actsAs ? { actsAs: opts.actsAs } : {}),
            ...(opts.admin ? { admin: true } : {}),
            ...(opts.anonymous
              ? { firebase: { sign_in_provider: "anonymous" } }
              : {}),
          },
        }
      : undefined;
  return {
    data,
    auth,
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

function call(
  uid: string | null,
  data: Record<string, unknown>,
  opts: { actsAs?: string; anonymous?: boolean; admin?: boolean } = {},
): ReturnType<typeof getPaymentQrDataHandler> {
  return getPaymentQrDataHandler(
    buildRequest(uid, data, opts) as unknown as Parameters<
      typeof getPaymentQrDataHandler
    >[0],
  );
}

async function expectRejects(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { code?: string }).code).to.equal(code);
    return;
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`);
}

describe("getPaymentQrData authorisation (Integration, S-1)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
  });

  it("rejects an unauthenticated caller", async () => {
    await seedBillAndCheckout("b1", "alice");
    await expectRejects(call(null, { billId: "b1" }), "unauthenticated");
  });

  it("rejects a signed-in non-owner (the IDOR)", async () => {
    await seedBillAndCheckout("b1", "alice");
    await expectRejects(call("mallory", { billId: "b1" }), "permission-denied");
  });

  it("allows the owner", async () => {
    await seedBillAndCheckout("b1", "alice");
    const data = await call("alice", { billId: "b1" });
    expect(data.payerName).to.equal("Alice Payer");
    expect(data.payerEmail).to.equal("alice@example.com");
  });

  it("allows the kiosk tag-tap principal (actsAs)", async () => {
    await seedBillAndCheckout("b1", "alice");
    const data = await call("tag:alice:s1", { billId: "b1" }, { actsAs: "alice" });
    expect(data.payerName).to.equal("Alice Payer");
  });

  it("allows an admin", async () => {
    await seedBillAndCheckout("b1", "alice");
    const data = await call("admin-1", { billId: "b1" }, { admin: true });
    expect(data.billId).to.equal("b1");
  });

  it("allows the creating anonymous session for a null-userId (walk-in) bill", async () => {
    await seedBillAndCheckout("b1", null, "co1", "anon-1");
    const data = await call("anon-1", { billId: "b1" }, { anonymous: true });
    expect(data.payerName).to.equal("Alice Payer");
  });

  it("rejects a DIFFERENT anonymous session for another walk-in's bill (PII scoping)", async () => {
    await seedBillAndCheckout("b1", null, "co1", "anon-1");
    await expectRejects(
      call("anon-2", { billId: "b1" }, { anonymous: true }),
      "permission-denied",
    );
  });

  it("rejects an anonymous session for a real-userId bill", async () => {
    await seedBillAndCheckout("b1", "alice");
    await expectRejects(
      call("anon-1", { billId: "b1" }, { anonymous: true }),
      "permission-denied",
    );
  });

  it("rejects a signed-in non-anon caller for a null-userId bill", async () => {
    await seedBillAndCheckout("b1", null);
    await expectRejects(call("mallory", { billId: "b1" }), "permission-denied");
  });
});
