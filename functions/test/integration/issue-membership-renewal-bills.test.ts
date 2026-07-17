// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for the `runRenewalInvoicer` cron in
 * `functions/src/membership/renewal_invoicer.ts` (issue #323).
 *
 * Pattern mirrors `monthly-bill-run.test.ts`: invoke the exported helper
 * directly against the Firestore emulator (no scheduler runtime). The
 * "once paid extends validUntil" case drives the same downstream ack path
 * the real pipeline uses — `processMembershipForAckedBill` →
 * `applyMembershipPayment` — rather than the Functions trigger wrapper,
 * which isn't started in this harness.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import {
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  runRenewalInvoicer,
  RENEWAL_WINDOW_DAYS,
} from "../../src/membership/renewal_invoicer";
import { processMembershipForAckedBill } from "../../src/membership/process_membership_payment";
import type { BillEntity } from "../../src/invoice/types";
import type {
  CatalogEntity,
  MembershipEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

const MEMBERSHIP_CATALOG_ID = "test-membership-catalog";
const DAY_MS = 24 * 60 * 60 * 1000;

async function seedCatalog() {
  const db = getFirestore();
  const membership: CatalogEntity = {
    code: "MEMBERSHIP",
    name: "Mitgliedschaft",
    workshops: ["diverses"],
    category: ["Mitgliedschaft"],
    active: true,
    userCanAdd: false,
    description: "Jahresmitgliedschaft.",
    variants: [
      {
        id: "single",
        label: "Einzel (Jahr)",
        pricingModel: "direct",
        // member tier is what renewals pay; default differs to prove we
        // pick the member price.
        unitPrice: { default: 50, member: 40 },
      },
      {
        id: "family",
        label: "Familie (Jahr)",
        pricingModel: "direct",
        unitPrice: { default: 70, member: 60 },
      },
    ],
  };
  await db.collection("catalog").doc(MEMBERSHIP_CATALOG_ID).set(membership);
  await db
    .doc("config/catalog-references")
    .set({ membership: db.collection("catalog").doc(MEMBERSHIP_CATALOG_ID) });
}

async function seedUser(uid: string): Promise<DocumentReference> {
  const db = getFirestore();
  const user: UserEntity = {
    created: Timestamp.now(),
    email: `${uid}@example.com`,
    firstName: "Test",
    lastName: uid,
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
  };
  const ref = db.collection("users").doc(uid);
  await ref.set(user);
  return ref;
}

interface SeedMembershipOpts {
  id: string;
  ownerUid: string;
  type?: "single" | "family";
  validUntil: Date;
  status?: "active" | "expired" | "cancelled";
  autoRenew?: boolean;
  pendingRenewalBill?: DocumentReference | null;
}

async function seedMembership(opts: SeedMembershipOpts): Promise<DocumentReference> {
  const db = getFirestore();
  const ownerRef = await seedUser(opts.ownerUid);
  const memRef = db.collection("memberships").doc(opts.id);
  const doc: MembershipEntity = {
    type: opts.type ?? "single",
    status: opts.status ?? "active",
    lastPaidAt: Timestamp.fromMillis(opts.validUntil.getTime() - 365 * DAY_MS),
    validUntil: Timestamp.fromDate(opts.validUntil),
    ownerUserId: ownerRef,
    members: [ownerRef],
    paymentCheckouts: [],
    notes: null,
    created: Timestamp.now(),
    modifiedAt: Timestamp.now(),
    modifiedBy: null,
  };
  if (opts.autoRenew !== undefined) doc.autoRenew = opts.autoRenew;
  if (opts.pendingRenewalBill !== undefined) {
    doc.pendingRenewalBill = opts.pendingRenewalBill;
  }
  await memRef.set(doc);
  // Denormalize the activeMembership pointer like the real activation path.
  await ownerRef.update({ activeMembership: memRef });
  return memRef;
}

async function readMembership(id: string): Promise<MembershipEntity> {
  const snap = await getFirestore().collection("memberships").doc(id).get();
  return snap.data() as MembershipEntity;
}

async function listRenewalBills(): Promise<BillEntity[]> {
  const snap = await getFirestore()
    .collection("bills")
    .where("source", "==", "membership-renewal")
    .get();
  return snap.docs.map((d) => d.data() as BillEntity);
}

describe("runRenewalInvoicer (Integration, #323)", () => {
  // Fire the cron "now"; a membership whose validUntil sits 30 days out is
  // in the renewal slice [now+28d, now+30d).
  //
  // Anchor to the real clock rather than a hardcoded date: the cron window
  // uses this injected `now`, but the downstream `processMembershipForAckedBill`
  // activation uses the real `Timestamp.now()` and applies
  // `max(now, validUntil) + 1y`. With an absolute date, once wall-clock time
  // passes `inWindow` the activation restarts from now instead of extending
  // from validUntil, breaking the `before + 365d` assertion (time-bomb).
  const now = new Date();
  const inWindow = new Date(now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS - DAY_MS / 2);
  const tooFarOut = new Date(now.getTime() + (RENEWAL_WINDOW_DAYS + 10) * DAY_MS);

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await seedCatalog();
    const db = getFirestore();
    await db.doc("config/billing").set({ nextBillNumber: 500 });
  });

  it("issues a renewal bill once per in-window membership (member-tier price)", async () => {
    await seedMembership({ id: "m1", ownerUid: "alice", validUntil: inWindow });

    const summary = await runRenewalInvoicer(now);

    expect(summary.scannedMemberships).to.equal(1);
    expect(summary.billIds).to.have.length(1);

    const bills = await listRenewalBills();
    expect(bills).to.have.length(1);
    expect(bills[0].source).to.equal("membership-renewal");
    expect(bills[0].amount).to.equal(40); // member tier, not default 50
    expect(bills[0].kind ?? "invoice").to.equal("invoice");
    // Un-acked at creation — the membership extends only once the ack path
    // (auto-ack cron / payment) flips paymentMethodConfirmationTime.
    expect(bills[0].paymentMethodConfirmationTime ?? null).to.be.null;
    expect(bills[0].checkouts).to.have.length(1);

    // pendingRenewalBill set on the membership.
    const mem = await readMembership("m1");
    expect(mem.pendingRenewalBill?.id).to.equal(summary.billIds[0]);

    // The synthetic checkout carries the membership SKU + recipient.
    const co = await bills[0].checkouts[0].get();
    expect(co.exists).to.be.true;
    const items = await bills[0].checkouts[0].collection("items").get();
    expect(items.size).to.equal(1);
    expect(items.docs[0].get("catalogId")?.id).to.equal(MEMBERSHIP_CATALOG_ID);
  });

  it("skips a membership with autoRenew == false", async () => {
    await seedMembership({
      id: "m-off",
      ownerUid: "bob",
      validUntil: inWindow,
      autoRenew: false,
    });

    const summary = await runRenewalInvoicer(now);
    expect(summary.scannedMemberships).to.equal(1);
    expect(summary.skippedAutoRenewOff).to.equal(1);
    expect(summary.billIds).to.have.length(0);
    expect(await listRenewalBills()).to.have.length(0);
  });

  it("skips a membership that already has a pendingRenewalBill", async () => {
    const db = getFirestore();
    const stubBill = db.collection("bills").doc("stub-open");
    await seedMembership({
      id: "m-pending",
      ownerUid: "carol",
      validUntil: inWindow,
      pendingRenewalBill: stubBill,
    });

    const summary = await runRenewalInvoicer(now);
    expect(summary.scannedMemberships).to.equal(1);
    expect(summary.skippedPending).to.equal(1);
    expect(summary.billIds).to.have.length(0);
    expect(await listRenewalBills()).to.have.length(0);
  });

  it("does not invoice memberships outside the 30-day window", async () => {
    await seedMembership({ id: "m-far", ownerUid: "dave", validUntil: tooFarOut });

    const summary = await runRenewalInvoicer(now);
    expect(summary.scannedMemberships).to.equal(0);
    expect(summary.billIds).to.have.length(0);
  });

  it("picks up the trailing day of the 2-day slice (missed-tick self-heal)", async () => {
    // validUntil at now+28.5d: outside the old 1-day slice, inside the
    // widened [now+28d, now+30d) — a tick that fired late still covers it.
    const trailing = new Date(
      now.getTime() + (RENEWAL_WINDOW_DAYS - 1.5) * DAY_MS,
    );
    await seedMembership({ id: "m-trail", ownerUid: "gina", validUntil: trailing });
    // Just below the lower bound stays untouched.
    const below = new Date(
      now.getTime() + (RENEWAL_WINDOW_DAYS - 2.5) * DAY_MS,
    );
    await seedMembership({ id: "m-below", ownerUid: "hugo", validUntil: below });

    const summary = await runRenewalInvoicer(now);
    expect(summary.scannedMemberships).to.equal(1);
    expect(summary.billIds).to.have.length(1);
    expect((await readMembership("m-trail")).pendingRenewalBill).to.not.be.null;
    expect((await readMembership("m-below")).pendingRenewalBill ?? null).to.be.null;
  });

  it("two consecutive ticks produce exactly one bill (idempotency)", async () => {
    await seedMembership({ id: "m-idem", ownerUid: "erin", validUntil: inWindow });

    const first = await runRenewalInvoicer(now);
    expect(first.billIds).to.have.length(1);

    // Second tick on the same day: the membership now has pendingRenewalBill,
    // so it's skipped.
    const second = await runRenewalInvoicer(now);
    expect(second.skippedPending).to.equal(1);
    expect(second.billIds).to.have.length(0);

    expect(await listRenewalBills()).to.have.length(1);
  });

  it("renewal bill, once paid, extends validUntil by one year via the ack path", async () => {
    const memRef = await seedMembership({
      id: "m-pay",
      ownerUid: "frank",
      validUntil: inWindow,
    });
    const before = (await readMembership("m-pay")).validUntil.toMillis();

    const summary = await runRenewalInvoicer(now);
    expect(summary.billIds).to.have.length(1);
    const billId = summary.billIds[0];

    // Simulate the gated-ack path landing the payment-method confirmation
    // (the auto-ack cron / explicit payment), then run the membership
    // activation the onBillUpdate trigger would run.
    await getFirestore()
      .collection("bills")
      .doc(billId)
      .update({
        paymentMethodConfirmationTime: Timestamp.now(),
        paymentMethodConfirmationSource: "auto",
      });
    await processMembershipForAckedBill(billId);

    const mem = await readMembership("m-pay");
    // Extended ~1 year from the prior validUntil (paid early extends).
    const expected = before + 365 * DAY_MS;
    expect(mem.validUntil.toMillis()).to.equal(expected);
    expect(mem.status).to.equal("active");
    // The pending renewal bill is cleared.
    expect(mem.pendingRenewalBill ?? null).to.be.null;
    // The synthetic checkout is recorded for idempotency.
    expect(mem.paymentCheckouts).to.have.length(1);

    // Membership now out of window (validUntil ~1y out) — a fresh tick is a
    // no-op, and the cleared pendingRenewalBill doesn't re-trigger.
    void memRef;
    const followUp = await runRenewalInvoicer(now);
    expect(followUp.scannedMemberships).to.equal(0);
  });

  it("does nothing when no memberships are in the window", async () => {
    const summary = await runRenewalInvoicer(now);
    expect(summary).to.deep.equal({
      scannedMemberships: 0,
      skippedAutoRenewOff: 0,
      skippedPending: 0,
      skippedIncomplete: 0,
      billIds: [],
    });
  });
});
