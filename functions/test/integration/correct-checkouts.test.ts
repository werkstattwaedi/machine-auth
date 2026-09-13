// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `correctCheckouts` (ADR-0041) against the Firestore emulator: guards,
 * pure cancellation, corrected re-issue, and the synchronous
 * Sammelrechnung revision. The PDF / mail follow-through is stubbed on the
 * bill_triggers module so the tests assert the *sequence* (replacement
 * Belege before the revision, one mail per top-level bill, notices only
 * for pure cancellations) without rendering PDFs.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import * as sinon from "sinon";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { CorrectCheckoutReplacement } from "@oww/shared";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import * as billTriggers from "../../src/invoice/bill_triggers";
import {
  correctCheckoutsHandler,
  parseCorrectCheckoutsRequest,
} from "../../src/invoice/correct_checkouts";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  CheckoutPersonEntity,
} from "../../src/types/firestore_entities";
import type { BillEntity } from "../../src/invoice/types";

const ADMIN_UID = "admin-1";
const ALICE: CheckoutPersonEntity = {
  name: "Alice Adult",
  email: "alice@example.com",
  userType: "erwachsen",
};

function request(data: unknown, opts: { admin?: boolean; uid?: string } = {}): CallableRequest<unknown> {
  return {
    auth: { uid: opts.uid ?? ADMIN_UID, token: { admin: opts.admin ?? true } },
    data,
    rawRequest: {},
  } as unknown as CallableRequest<unknown>;
}

async function seedConfig(): Promise<void> {
  const db = getFirestore();
  await db.doc("config/pricing").set({
    workshops: { holz: { label: "Holzwerkstatt", order: 1 } },
    entryFees: {
      erwachsen: { regular: 15 },
      kind: { regular: 7.5 },
      firma: { regular: 30 },
    },
  });
  await db.doc("config/billing").set({ nextBillNumber: 100, referenceNumberFormat: "shifted-v1" });
}

async function seedUser(uid: string): Promise<void> {
  await getFirestore().doc(`users/${uid}`).set({
    created: Timestamp.now(),
    firstName: uid,
    lastName: "Test",
    email: `${uid}@example.com`,
    permissions: [],
    roles: [],
  });
}

interface CheckoutSeed {
  ownerUid: string | null;
  billId: string;
  status?: "open" | "closed" | "cancelled";
  items?: Array<Partial<CheckoutItemEntity> & { totalPrice: number }>;
  paymentMethod?: "rechnung" | "monthly" | "twint" | null;
  created?: Timestamp;
  firebaseUid?: string | null;
}

async function seedCheckout(id: string, seed: CheckoutSeed): Promise<DocumentReference> {
  const db = getFirestore();
  const ref = db.collection("checkouts").doc(id);
  const created = seed.created ?? Timestamp.fromDate(new Date("2026-08-12T10:00:00Z"));
  const items = seed.items ?? [{ totalPrice: 10 }];
  const materialCost = items.reduce((s, i) => s + i.totalPrice, 0);
  const checkout: CheckoutEntity = {
    userId: (seed.ownerUid ? db.doc(`users/${seed.ownerUid}`) : null) as DocumentReference,
    status: seed.status ?? "closed",
    usageType: "regular",
    created,
    closedAt: created,
    workshopsVisited: ["holz"],
    persons: [ALICE],
    modifiedBy: seed.ownerUid,
    modifiedAt: created,
    firebaseUid: seed.firebaseUid ?? "fb-uid-1",
    billRef: db.collection("bills").doc(seed.billId),
    summary: { totalPrice: 15 + materialCost, entryFees: 15, machineCost: 0, materialCost, tip: 0, discountAmount: 0 },
    paymentMethod: seed.paymentMethod ?? "rechnung",
  };
  await ref.set(checkout);
  for (const [i, item] of items.entries()) {
    await ref.collection("items").doc(`item${i}`).set({
      workshop: "holz",
      description: `Item ${i}`,
      origin: "manual",
      catalogId: null,
      created,
      quantity: 1,
      unitPrice: item.totalPrice,
      ...item,
    });
  }
  return ref;
}

interface BillSeed {
  ownerUid: string | null;
  checkoutIds: string[];
  referenceNumber: number;
  amount: number;
  kind?: "invoice" | "beleg";
  aggregatedIntoBillId?: string | null;
  paidAt?: Timestamp | null;
  source?: "checkout" | "membership-renewal";
  acked?: boolean;
  cancelledAt?: Timestamp | null;
}

async function seedBill(id: string, seed: BillSeed): Promise<DocumentReference> {
  const db = getFirestore();
  const ref = db.collection("bills").doc(id);
  const bill: BillEntity = {
    userId: (seed.ownerUid ? db.doc(`users/${seed.ownerUid}`) : null) as DocumentReference,
    checkouts: seed.checkoutIds.map((c) => db.collection("checkouts").doc(c)),
    referenceNumber: seed.referenceNumber,
    amount: seed.amount,
    currency: "CHF",
    storagePath: `invoices/${id}.pdf`,
    created: Timestamp.fromDate(new Date("2026-08-12T10:05:00Z")),
    paidAt: seed.paidAt ?? null,
    paidVia: seed.paidAt ? "ebanking" : null,
    pdfGeneratedAt: Timestamp.now(),
    emailSentAt: Timestamp.now(),
    paymentMethodConfirmationTime: seed.acked ? Timestamp.now() : null,
    paymentMethodConfirmationSource: seed.acked ? "user" : null,
    kind: seed.kind ?? "invoice",
    aggregatedIntoBillRef: seed.aggregatedIntoBillId ? db.collection("bills").doc(seed.aggregatedIntoBillId) : null,
    source: seed.source ?? "checkout",
    cancelledAt: seed.cancelledAt ?? null,
  };
  await ref.set(bill);
  return ref;
}

/** A plain closed visit with an unpaid, acked Rechnung. */
async function seedVisit(checkoutId = "co-1", billId = "bill-1", referenceNumber = 42000010): Promise<void> {
  await seedUser("u-alice");
  await seedCheckout(checkoutId, { ownerUid: "u-alice", billId });
  await seedBill(billId, { ownerUid: "u-alice", checkoutIds: [checkoutId], referenceNumber, amount: 25, acked: true });
}

/** A member with two Belege folded into a sent Sammelrechnung. */
async function seedSammelrechnung(): Promise<void> {
  await seedUser("u-member");
  await seedCheckout("co-a", { ownerUid: "u-member", billId: "beleg-a", paymentMethod: "monthly", items: [{ totalPrice: 10 }] });
  await seedCheckout("co-b", { ownerUid: "u-member", billId: "beleg-b", paymentMethod: "monthly", items: [{ totalPrice: 20 }] });
  await seedBill("beleg-a", { ownerUid: "u-member", checkoutIds: ["co-a"], referenceNumber: 6100, amount: 25, kind: "beleg", aggregatedIntoBillId: "sammel" });
  await seedBill("beleg-b", { ownerUid: "u-member", checkoutIds: ["co-b"], referenceNumber: 6200, amount: 35, kind: "beleg", aggregatedIntoBillId: "sammel" });
  await seedBill("sammel", { ownerUid: "u-member", checkoutIds: ["co-a", "co-b"], referenceNumber: 5000, amount: 60, acked: true });
}

function replacement(overrides: Partial<CorrectCheckoutReplacement> = {}): CorrectCheckoutReplacement {
  return {
    usageType: "regular",
    persons: [{ name: "Alice Adult", email: "alice@example.com", userType: "erwachsen", userId: null, entryFeeWaivedToday: false }],
    items: [{ workshop: "holz", description: "Sperrholz", type: "material", catalogId: null, quantity: 2, unitPrice: 5, totalPrice: 10 }],
    tip: 0,
    ...overrides,
  };
}

async function bill(id: string): Promise<BillEntity> {
  return (await getFirestore().doc(`bills/${id}`).get()).data() as BillEntity;
}
async function checkout(id: string): Promise<CheckoutEntity> {
  return (await getFirestore().doc(`checkouts/${id}`).get()).data() as CheckoutEntity;
}
async function billsWhere(field: string, value: unknown): Promise<Array<{ id: string; data: BillEntity }>> {
  const snap = await getFirestore().collection("bills").where(field, "==", value).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as BillEntity }));
}

async function expectFailedPrecondition(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await p;
  } catch (err) {
    expect(err).to.be.instanceOf(HttpsError);
    expect((err as HttpsError).code).to.equal("failed-precondition");
    expect((err as HttpsError).message).to.match(pattern);
    return;
  }
  expect.fail("expected failed-precondition");
}

describe("correctCheckouts (Integration, ADR-0041)", () => {
  let pdfStub: sinon.SinonStub;
  let mailStub: sinon.SinonStub;
  let noticeStub: sinon.SinonStub;

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });
  after(async () => {
    await teardownEmulator();
  });
  beforeEach(async () => {
    await clearFirestore();
    await seedConfig();
    pdfStub = sinon.stub(billTriggers, "tryGeneratePdf").resolves(true);
    mailStub = sinon.stub(billTriggers, "trySendEmail").resolves(true);
    noticeStub = sinon.stub(billTriggers, "trySendCancellationNotice").resolves(true);
  });
  afterEach(() => sinon.restore());

  describe("payload validation", () => {
    it("rejects a short reason, an empty list and duplicate ids", () => {
      expect(() => parseCorrectCheckoutsRequest({ reason: "ab", corrections: [{ checkoutId: "x" }] })).to.throw(HttpsError, /reason/);
      expect(() => parseCorrectCheckoutsRequest({ reason: "Falsch", corrections: [] })).to.throw(HttpsError, /corrections/);
      expect(() =>
        parseCorrectCheckoutsRequest({ reason: "Falsch", corrections: [{ checkoutId: "x" }, { checkoutId: "x" }] }),
      ).to.throw(HttpsError, /twice/);
    });

    it("rejects malformed replacement items and persons", () => {
      const bad = (r: Partial<CorrectCheckoutReplacement>) =>
        parseCorrectCheckoutsRequest({ reason: "Falsch", corrections: [{ checkoutId: "x", replacement: replacement(r) }] });
      expect(() => bad({ items: [{ ...replacement().items[0], quantity: -1 }] })).to.throw(HttpsError, /items/);
      expect(() => bad({ items: [{ ...replacement().items[0], unitPrice: 2_000_000 }] })).to.throw(HttpsError, /items/);
      expect(() => bad({ persons: [] })).to.throw(HttpsError, /persons/);
      expect(() => bad({ usageType: "gratis" as never })).to.throw(HttpsError, /usageType/);
    });
  });

  describe("guards", () => {
    it("denies non-admins", async () => {
      await seedVisit();
      try {
        await correctCheckoutsHandler(request({ reason: "Falsch", corrections: [{ checkoutId: "co-1" }] }, { admin: false }));
        expect.fail("expected permission-denied");
      } catch (err) {
        expect((err as HttpsError).code).to.equal("permission-denied");
      }
    });

    it("rejects a paid bill, a renewal bill, an open visit, an already cancelled one and a badge item", async () => {
      await seedUser("u-alice");
      await seedCheckout("co-paid", { ownerUid: "u-alice", billId: "bill-paid" });
      await seedBill("bill-paid", { ownerUid: "u-alice", checkoutIds: ["co-paid"], referenceNumber: 10, amount: 25, paidAt: Timestamp.now() });
      await expectFailedPrecondition(
        correctCheckoutsHandler(request({ reason: "Falsch", corrections: [{ checkoutId: "co-paid" }] })),
        /bereits bezahlt/,
      );

      await seedCheckout("co-renewal", { ownerUid: "u-alice", billId: "bill-renewal" });
      await seedBill("bill-renewal", { ownerUid: "u-alice", checkoutIds: ["co-renewal"], referenceNumber: 20, amount: 80, source: "membership-renewal" });
      await expectFailedPrecondition(
        correctCheckoutsHandler(request({ reason: "Falsch", corrections: [{ checkoutId: "co-renewal" }] })),
        /Mitgliederbeitrag/,
      );

      await seedCheckout("co-open", { ownerUid: "u-alice", billId: "bill-open", status: "open" });
      await seedBill("bill-open", { ownerUid: "u-alice", checkoutIds: ["co-open"], referenceNumber: 30, amount: 25 });
      await expectFailedPrecondition(
        correctCheckoutsHandler(request({ reason: "Falsch", corrections: [{ checkoutId: "co-open" }] })),
        /nicht abgeschlossen/,
      );

      await seedCheckout("co-cancelled", { ownerUid: "u-alice", billId: "bill-cancelled", status: "cancelled" });
      await seedBill("bill-cancelled", { ownerUid: "u-alice", checkoutIds: ["co-cancelled"], referenceNumber: 40, amount: 25, cancelledAt: Timestamp.now() });
      await expectFailedPrecondition(
        correctCheckoutsHandler(request({ reason: "Falsch", corrections: [{ checkoutId: "co-cancelled" }] })),
        /bereits storniert/,
      );

      await seedCheckout("co-badge", { ownerUid: "u-alice", billId: "bill-badge", items: [{ totalPrice: 15, tokenId: "04AABBCCDD" } as never] });
      await seedBill("bill-badge", { ownerUid: "u-alice", checkoutIds: ["co-badge"], referenceNumber: 50, amount: 30 });
      await expectFailedPrecondition(
        correctCheckoutsHandler(request({ reason: "Falsch", corrections: [{ checkoutId: "co-badge" }] })),
        /Badge/,
      );
      expect(pdfStub.called).to.be.false;
      expect(mailStub.called).to.be.false;
    });

    it("rejects a tenth correction of the same bill", async () => {
      await seedVisit("co-9", "bill-9", 42000019);
      await expectFailedPrecondition(
        correctCheckoutsHandler(request({ reason: "Nochmal", corrections: [{ checkoutId: "co-9", replacement: replacement() }] })),
        /maximale Anzahl/,
      );
    });

    it("rejects Belege of two different Sammelrechnungen in one commit", async () => {
      await seedSammelrechnung();
      await seedCheckout("co-c", { ownerUid: "u-member", billId: "beleg-c", paymentMethod: "monthly" });
      await seedBill("beleg-c", { ownerUid: "u-member", checkoutIds: ["co-c"], referenceNumber: 6300, amount: 25, kind: "beleg", aggregatedIntoBillId: "sammel-2" });
      await seedBill("sammel-2", { ownerUid: "u-member", checkoutIds: ["co-c"], referenceNumber: 5100, amount: 25, acked: true });
      await expectFailedPrecondition(
        correctCheckoutsHandler(request({ reason: "Falsch", corrections: [{ checkoutId: "co-a" }, { checkoutId: "co-c" }] })),
        /verschiedener Sammelrechnungen/,
      );
    });

    it("rejects a Beleg whose Sammelrechnung is already paid", async () => {
      await seedSammelrechnung();
      await getFirestore().doc("bills/sammel").update({ paidAt: Timestamp.now(), paidVia: "ebanking" });
      await expectFailedPrecondition(
        correctCheckoutsHandler(request({ reason: "Falsch", corrections: [{ checkoutId: "co-a" }] })),
        /Sammelrechnung .* bereits bezahlt/,
      );
    });
  });

  describe("pure cancellation", () => {
    it("voids the checkout and bill in place, leaves the counter alone and sends the notice", async () => {
      await seedVisit();
      const result = await correctCheckoutsHandler(
        request({ reason: "Doppelt erfasst", corrections: [{ checkoutId: "co-1" }] }),
      );
      expect(result.cancelledBillIds).to.deep.equal(["bill-1"]);
      expect(result.replacementBillIds).to.be.empty;
      expect(result.revisionBillId).to.be.null;

      const co = await checkout("co-1");
      expect(co.status).to.equal("cancelled");
      expect(co.cancelledAt).to.be.instanceOf(Timestamp);
      expect(co.cancelledBy).to.equal(ADMIN_UID);
      expect(co.cancellationReason).to.equal("Doppelt erfasst");
      expect(co.supersededByCheckoutRef).to.be.null;
      expect(co.statsFlushedAt).to.be.null;
      expect(co.modifiedBy).to.equal(ADMIN_UID);

      const b = await bill("bill-1");
      expect(b.cancelledAt).to.be.instanceOf(Timestamp);
      expect(b.supersededByBillRef).to.be.null;
      expect(b.referenceNumber).to.equal(42000010);

      const cfg = await getFirestore().doc("config/billing").get();
      expect(cfg.data()?.nextBillNumber).to.equal(100);
      expect((await getFirestore().collection("bills").get()).size).to.equal(1);

      expect(pdfStub.called).to.be.false;
      expect(mailStub.called).to.be.false;
      expect(noticeStub.calledOnceWith("bill-1")).to.be.true;
    });
  });

  describe("corrected re-issue", () => {
    it("mints the replacement with the next revision digit, copies the visit identity and re-prices server-side", async () => {
      await seedVisit();
      const original = await checkout("co-1");
      const result = await correctCheckoutsHandler(
        request({
          reason: "Menge korrigiert",
          corrections: [{ checkoutId: "co-1", replacement: replacement({ tip: 2 }) }],
        }),
      );
      expect(result.replacementBillIds).to.have.length(1);
      expect(result.references).to.deep.equal(["RE-4200001-2"]);
      const newBillId = result.replacementBillIds[0];
      const newCheckoutId = result.replacementCheckoutIds[0];

      const nb = await bill(newBillId);
      expect(nb.referenceNumber).to.equal(42000011);
      expect(nb.kind).to.equal("invoice");
      // 15 entry fee + 10 material + 2 tip, priced by the server
      expect(nb.amount).to.equal(27);
      expect(nb.supersedesBillRef?.id).to.equal("bill-1");
      expect(nb.correctionReason).to.equal("Menge korrigiert");
      expect(nb.paymentMethodConfirmationTime).to.be.instanceOf(Timestamp);
      expect(nb.paymentMethodConfirmationSource).to.equal("user");
      expect(nb.checkouts.map((c) => c.id)).to.deep.equal([newCheckoutId]);
      expect(nb.modifiedBy).to.equal(ADMIN_UID);

      const nc = await checkout(newCheckoutId);
      expect(nc.status).to.equal("closed");
      expect(nc.created.isEqual(original.created)).to.be.true;
      expect(nc.closedAt!.isEqual(original.closedAt!)).to.be.true;
      expect(nc.firebaseUid).to.equal("fb-uid-1");
      expect(nc.paymentMethod).to.equal("rechnung");
      expect(nc.userId.id).to.equal("u-alice");
      expect(nc.billRef?.id).to.equal(newBillId);
      expect(nc.supersedesCheckoutRef?.id).to.equal("co-1");
      expect(nc.summary?.totalPrice).to.equal(27);
      expect(nc.summary?.tip).to.equal(2);
      expect(nc.statsFlushedAt).to.be.null;
      const items = await getFirestore().collection(`checkouts/${newCheckoutId}/items`).get();
      expect(items.size).to.equal(1);
      expect(items.docs[0].data().description).to.equal("Sperrholz");

      const oc = await checkout("co-1");
      expect(oc.status).to.equal("cancelled");
      expect(oc.supersededByCheckoutRef?.id).to.equal(newCheckoutId);
      const ob = await bill("bill-1");
      expect(ob.supersededByBillRef?.id).to.equal(newBillId);

      // One PDF, one mail, no notice.
      expect(pdfStub.calledOnceWith(newBillId)).to.be.true;
      expect(mailStub.calledOnceWith(newBillId)).to.be.true;
      expect(noticeStub.called).to.be.false;
    });

    it("recomputes line totals to cents like the checkout wizard, ignoring the client's total", async () => {
      await seedVisit();
      const result = await correctCheckoutsHandler(
        request({
          reason: "Menge",
          corrections: [{
            checkoutId: "co-1",
            replacement: replacement({
              items: [{ workshop: "holz", description: "MDF 18 mm", type: "material", catalogId: null, quantity: 0.5, unitPrice: 18.15, totalPrice: 9.1 }],
            }),
          }],
        }),
      );
      const items = await getFirestore().collection(`checkouts/${result.replacementCheckoutIds[0]}/items`).get();
      // 0.5 × 18.15 = 9.075 → 9.07 with the wizard's rounding (not 9.10).
      expect(items.docs[0].data().totalPrice).to.equal(9.07);
      expect((await bill(result.replacementBillIds[0])).amount).to.equal(24.07);
    });

    it("correcting a revision yields the next digit", async () => {
      await seedVisit("co-2", "bill-2", 42000011);
      const result = await correctCheckoutsHandler(
        request({ reason: "Nochmals", corrections: [{ checkoutId: "co-2", replacement: replacement() }] }),
      );
      expect((await bill(result.replacementBillIds[0])).referenceNumber).to.equal(42000012);
      expect(result.references).to.deep.equal(["RE-4200001-3"]);
    });

    it("keeps an admin-set entry-fee waiver and applies it to the price", async () => {
      await seedVisit();
      const result = await correctCheckoutsHandler(
        request({
          reason: "Bereits bezahlt heute",
          corrections: [{
            checkoutId: "co-1",
            replacement: replacement({
              persons: [{ ...replacement().persons[0], entryFeeWaivedToday: true }],
            }),
          }],
        }),
      );
      const nb = await bill(result.replacementBillIds[0]);
      expect(nb.amount).to.equal(10);
      const nc = await checkout(result.replacementCheckoutIds[0]);
      expect(nc.persons[0].entryFeeWaivedToday).to.be.true;
    });
  });

  describe("Sammelrechnung revision (same transaction)", () => {
    it("one corrected Beleg → revision with the survivor + the replacement, old aggregate cancelled", async () => {
      await seedSammelrechnung();
      const result = await correctCheckoutsHandler(
        request({ reason: "Menge", corrections: [{ checkoutId: "co-a", replacement: replacement() }] }),
      );
      expect(result.revisionBillId).to.not.be.null;
      expect(result.references).to.deep.equal(["BL-000610-2", "RE-000500-2"]);
      const newBelegId = result.replacementBillIds[0];
      const revisionId = result.revisionBillId!;

      const rev = await bill(revisionId);
      expect(rev.kind).to.equal("invoice");
      expect(rev.referenceNumber).to.equal(5001);
      // survivor beleg-b (35) + replacement (15 + 10)
      expect(rev.amount).to.equal(60);
      expect(rev.checkouts.map((c) => c.id).sort()).to.deep.equal(["co-b", result.replacementCheckoutIds[0]].sort());
      expect(rev.supersedesBillRef?.id).to.equal("sammel");
      expect(rev.correctedBillRefs?.map((r) => r.id)).to.deep.equal([newBelegId]);
      expect(rev.paymentMethodConfirmationSource).to.equal("auto");
      expect(rev.correctionReason).to.equal("Menge");

      const nb = await bill(newBelegId);
      expect(nb.kind).to.equal("beleg");
      expect(nb.referenceNumber).to.equal(6101);
      expect(nb.aggregatedIntoBillRef?.id).to.equal(revisionId);
      expect(nb.paymentMethodConfirmationTime).to.be.null;

      expect((await bill("beleg-b")).aggregatedIntoBillRef?.id).to.equal(revisionId);
      const oldBeleg = await bill("beleg-a");
      expect(oldBeleg.cancelledAt).to.be.instanceOf(Timestamp);
      expect(oldBeleg.supersededByBillRef?.id).to.equal(newBelegId);
      expect(oldBeleg.aggregatedIntoBillRef?.id).to.equal("sammel");
      const oldAgg = await bill("sammel");
      expect(oldAgg.cancelledAt).to.be.instanceOf(Timestamp);
      expect(oldAgg.supersededByBillRef?.id).to.equal(revisionId);

      // Replacement Beleg PDF first, then the revision; one mail; no notice.
      expect(pdfStub.args.map((a) => a[0])).to.deep.equal([newBelegId, revisionId]);
      expect(mailStub.calledOnceWith(revisionId)).to.be.true;
      expect(noticeStub.called).to.be.false;
    });

    it("two Belege in one commit → exactly one revision", async () => {
      await seedSammelrechnung();
      const result = await correctCheckoutsHandler(
        request({
          reason: "Beide",
          corrections: [
            { checkoutId: "co-a", replacement: replacement() },
            { checkoutId: "co-b", replacement: replacement({ items: [{ workshop: "holz", description: "Leim", type: "material", catalogId: null, quantity: 1, unitPrice: 4, totalPrice: 4 }] }) },
          ],
        }),
      );
      const revisions = await billsWhere("supersedesBillRef", getFirestore().doc("bills/sammel"));
      expect(revisions).to.have.length(1);
      const rev = revisions[0].data;
      expect(rev.amount).to.equal(25 + 19);
      expect(rev.correctedBillRefs).to.have.length(2);
      expect(result.references).to.deep.equal(["BL-000610-2", "BL-000620-2", "RE-000500-2"]);
      expect(mailStub.calledOnce).to.be.true;
    });

    it("pure cancellation of one Beleg → revision without it, no notice for the Beleg", async () => {
      await seedSammelrechnung();
      const result = await correctCheckoutsHandler(
        request({ reason: "Irrtum", corrections: [{ checkoutId: "co-a" }] }),
      );
      const rev = await bill(result.revisionBillId!);
      expect(rev.amount).to.equal(35);
      expect(rev.checkouts.map((c) => c.id)).to.deep.equal(["co-b"]);
      expect(rev.correctedBillRefs).to.deep.equal([]);
      expect((await bill("beleg-a")).supersededByBillRef).to.be.null;
      expect(mailStub.calledOnceWith(result.revisionBillId!)).to.be.true;
      expect(noticeStub.called).to.be.false;
    });

    it("all Belege cancelled → aggregate cancelled without a revision, notice on the aggregate", async () => {
      await seedSammelrechnung();
      const result = await correctCheckoutsHandler(
        request({ reason: "Alles falsch", corrections: [{ checkoutId: "co-a" }, { checkoutId: "co-b" }] }),
      );
      expect(result.revisionBillId).to.be.null;
      expect(result.references).to.be.empty;
      const agg = await bill("sammel");
      expect(agg.cancelledAt).to.be.instanceOf(Timestamp);
      expect(agg.supersededByBillRef).to.be.null;
      expect((await getFirestore().collection("bills").get()).size).to.equal(3);
      expect(mailStub.called).to.be.false;
      expect(noticeStub.calledOnceWith("sammel")).to.be.true;
    });

    it("a standalone Beleg in the same batch stays standalone (per-bill revision membership)", async () => {
      await seedSammelrechnung();
      await seedCheckout("co-solo", { ownerUid: "u-member", billId: "beleg-solo", paymentMethod: "monthly" });
      await seedBill("beleg-solo", { ownerUid: "u-member", checkoutIds: ["co-solo"], referenceNumber: 7000, amount: 25, kind: "beleg" });
      const result = await correctCheckoutsHandler(
        request({
          reason: "Gemischt",
          corrections: [
            { checkoutId: "co-a", replacement: replacement() },
            { checkoutId: "co-solo", replacement: replacement() },
          ],
        }),
      );
      const revision = await bill(result.revisionBillId!);
      // Survivor beleg-b (35) + replacement of co-a (25); co-solo is not part of it.
      expect(revision.amount).to.equal(60);
      expect(revision.correctedBillRefs).to.have.length(1);
      const soloReplacement = (await billsWhere("supersedesBillRef", getFirestore().doc("bills/beleg-solo")))[0];
      expect(soloReplacement.data.aggregatedIntoBillRef).to.be.null;
      expect(soloReplacement.data.referenceNumber).to.equal(7001);
      // The standalone replacement mails itself; the revision mails once.
      expect(mailStub.args.map((a) => a[0]).sort()).to.deep.equal(
        [soloReplacement.id, result.revisionBillId!].sort(),
      );
      expect(noticeStub.called).to.be.false;
    });

    it("an un-aggregated Beleg is corrected on its own and mails itself", async () => {
      await seedUser("u-member");
      await seedCheckout("co-solo", { ownerUid: "u-member", billId: "beleg-solo", paymentMethod: "monthly" });
      await seedBill("beleg-solo", { ownerUid: "u-member", checkoutIds: ["co-solo"], referenceNumber: 7000, amount: 25, kind: "beleg" });
      const result = await correctCheckoutsHandler(
        request({ reason: "Menge", corrections: [{ checkoutId: "co-solo", replacement: replacement() }] }),
      );
      expect(result.revisionBillId).to.be.null;
      const nb = await bill(result.replacementBillIds[0]);
      expect(nb.kind).to.equal("beleg");
      expect(nb.aggregatedIntoBillRef).to.be.null;
      expect(mailStub.calledOnceWith(result.replacementBillIds[0])).to.be.true;
    });
  });
});
