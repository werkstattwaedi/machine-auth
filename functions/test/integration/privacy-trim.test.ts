// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Integration tests for the yearly retention trim (ADR-0038) — cutoff
 * boundary, export-watermark guard, pendingRenewalBill guard, PDF escrow
 * move (incl. crashed-move idempotency), and dry-run exactness.
 */

import { expect } from "chai";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  clearStorage,
  teardownEmulator,
  getBucket,
} from "../emulator-helper";
import { trimBefore, privacyTrimHandler } from "../../src/privacy/trim";
import type { CallableRequest } from "firebase-functions/v2/https";

const CUTOFF = new Date("2023-01-01T00:00:00.000Z");

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

describe("privacy trim (integration)", function () {
  this.timeout(20000);

  let db: admin.firestore.Firestore;

  before(async () => {
    await setupEmulator();
    db = admin.firestore();
  });

  beforeEach(async () => {
    await clearFirestore();
    await clearStorage();
  });

  after(async () => {
    await teardownEmulator();
  });

  /** Watermarks at `now` — everything old counts as exported. */
  async function seedFreshWatermarks(): Promise<void> {
    for (const stream of ["visits", "machine_usage", "bills"]) {
      await db.doc(`export_state/${stream}`).set({
        watermark: Timestamp.now(),
        lastDocId: "",
        updatedAt: Timestamp.now(),
      });
    }
  }

  async function seedGraph(): Promise<void> {
    // Old (pre-cutoff) vs new (post-cutoff) closed checkouts.
    for (const [id, closedAt] of [
      ["co-old", "2022-06-01T12:00:00Z"],
      ["co-boundary-in", "2022-12-31T23:59:59Z"], // 1s before cutoff → trimmed
      ["co-boundary-out", "2023-01-01T00:00:00Z"], // exactly cutoff → kept (<)
      ["co-new", "2026-06-01T12:00:00Z"],
    ] as const) {
      const ref = db.doc(`checkouts/${id}`);
      await ref.set({
        userId: null,
        status: "closed",
        usageType: "regular",
        created: ts(closedAt),
        closedAt: ts(closedAt),
        workshopsVisited: [],
        persons: [{ name: "Gast", email: "gast@example.com", userType: "erwachsen" }],
        modifiedBy: null,
        modifiedAt: ts(closedAt),
      });
      await ref.collection("items").doc("i1").set({
        workshop: "holz",
        description: "Material",
        origin: "manual",
        catalogId: null,
        created: ts(closedAt),
        quantity: 1,
        unitPrice: 5,
        totalPrice: 5,
      });
    }
    // Bills: old paid w/ PDF; old unpaid (created basis); old but pending
    // renewal (guard); new paid.
    await db.doc("bills/b-old").set({
      userId: null,
      referenceNumber: 1,
      amount: 5,
      currency: "CHF",
      storagePath: "invoices/b-old.pdf",
      created: ts("2022-06-01T12:00:00Z"),
      paidAt: ts("2022-06-02T12:00:00Z"),
      paidVia: "cash",
    });
    await getBucket().file("invoices/b-old.pdf").save(Buffer.from("%PDF-old"));
    await db.doc("bills/b-unpaid-old").set({
      userId: null,
      referenceNumber: 2,
      amount: 7,
      currency: "CHF",
      storagePath: null,
      created: ts("2022-05-01T12:00:00Z"),
      paidAt: null,
      paidVia: null,
    });
    await db.doc("bills/b-pending").set({
      userId: null,
      referenceNumber: 3,
      amount: 9,
      currency: "CHF",
      storagePath: null,
      created: ts("2022-04-01T12:00:00Z"),
      paidAt: ts("2022-04-02T12:00:00Z"),
      paidVia: "twint",
    });
    await db.doc("memberships/m-pending").set({
      type: "single",
      status: "active",
      lastPaidAt: null,
      validUntil: ts("2027-01-01T00:00:00Z"),
      ownerUserId: db.doc("users/u2"),
      members: [db.doc("users/u2")],
      paymentCheckouts: [],
      pendingRenewalBill: db.doc("bills/b-pending"),
    });
    await db.doc("bills/b-new").set({
      userId: null,
      referenceNumber: 4,
      amount: 11,
      currency: "CHF",
      storagePath: null,
      created: ts("2026-06-01T12:00:00Z"),
      paidAt: ts("2026-06-02T12:00:00Z"),
      paidVia: "twint",
    });
    // Usage, authentications, logs — one old, one new each.
    await db.doc("usage_machine/us-old").set({
      userId: null,
      authenticationId: null,
      machine: db.doc("machine/laser"),
      startTime: ts("2022-06-01T10:00:00Z"),
      endTime: ts("2022-06-01T11:00:00Z"),
      endReason: null,
    });
    await db.doc("usage_machine/us-new").set({
      userId: null,
      authenticationId: null,
      machine: db.doc("machine/laser"),
      startTime: ts("2026-06-01T10:00:00Z"),
      endTime: ts("2026-06-01T11:00:00Z"),
      endReason: null,
    });
    await db.doc("authentications/a-old").set({
      tokenId: db.doc("tokens/x"),
      keySlot: 0,
      created: ts("2022-06-01T10:00:00Z"),
      inProgressAuth: null,
      ttlAt: null,
    });
    await db.doc("authentications/a-new").set({
      tokenId: db.doc("tokens/x"),
      keySlot: 0,
      created: ts("2026-06-01T10:00:00Z"),
      inProgressAuth: null,
      ttlAt: null,
    });
    for (const [collection, field] of [
      ["audit_log", "timestamp"],
      ["operations_log", "timestamp"],
    ] as const) {
      await db.collection(collection).doc(`${collection}-old`).set({
        collection: "bills",
        docId: "b-old",
        operation: "x",
        [field]: ts("2022-06-01T10:00:00Z"),
      });
      await db.collection(collection).doc(`${collection}-new`).set({
        collection: "bills",
        docId: "b-new",
        operation: "x",
        [field]: ts("2026-06-01T10:00:00Z"),
      });
    }
  }

  it("dry-run counts exactly, without writing", async () => {
    await seedGraph();
    await seedFreshWatermarks();
    const outcome = await trimBefore(CUTOFF, { db }, { dryRun: true });
    expect(outcome.counts).to.deep.equal({
      checkouts: 2, // co-old + co-boundary-in
      usage_machine: 1,
      bills: 2, // b-old (paid basis) + b-unpaid-old (created basis)
      authentications: 1,
      audit_log: 1,
      operations_log: 1,
    });
    expect(outcome.skippedPendingRenewal).to.equal(1);
    expect(outcome.archivedPdfs).to.equal(1);
    // Nothing actually deleted or moved.
    expect((await db.doc("checkouts/co-old").get()).exists).to.equal(true);
    expect((await getBucket().file("invoices/b-old.pdf").exists())[0]).to.equal(true);
  });

  it("trims pre-cutoff docs, respects the boundary, moves PDFs to the archive", async () => {
    await seedGraph();
    await seedFreshWatermarks();
    const outcome = await trimBefore(CUTOFF, { db });

    expect(outcome.counts.checkouts).to.equal(2);
    expect((await db.doc("checkouts/co-old").get()).exists).to.equal(false);
    expect((await db.doc("checkouts/co-old/items/i1").get()).exists).to.equal(false);
    expect((await db.doc("checkouts/co-boundary-in").get()).exists).to.equal(false);
    expect((await db.doc("checkouts/co-boundary-out").get()).exists).to.equal(true);
    expect((await db.doc("checkouts/co-new").get()).exists).to.equal(true);

    expect((await db.doc("bills/b-old").get()).exists).to.equal(false);
    expect((await db.doc("bills/b-unpaid-old").get()).exists).to.equal(false);
    expect((await db.doc("bills/b-pending").get()).exists).to.equal(true); // guard
    expect((await db.doc("bills/b-new").get()).exists).to.equal(true);
    expect(outcome.skippedPendingRenewal).to.equal(1);

    // PDF escrow: moved, not deleted.
    expect((await getBucket().file("invoices/b-old.pdf").exists())[0]).to.equal(false);
    const archive = admin.storage().bucket("oww-maco-invoice-archive");
    expect((await archive.file("invoices/b-old.pdf").exists())[0]).to.equal(true);
    expect(outcome.archivedPdfs).to.equal(1);

    expect((await db.doc("usage_machine/us-old").get()).exists).to.equal(false);
    expect((await db.doc("usage_machine/us-new").get()).exists).to.equal(true);
    expect((await db.doc("authentications/a-old").get()).exists).to.equal(false);
    expect((await db.doc("authentications/a-new").get()).exists).to.equal(true);
    expect((await db.doc("audit_log/audit_log-old").get()).exists).to.equal(false);
    expect((await db.doc("audit_log/audit_log-new").get()).exists).to.equal(true);
    expect((await db.doc("operations_log/operations_log-old").get()).exists).to.equal(false);
    expect((await db.doc("operations_log/operations_log-new").get()).exists).to.equal(true);

    // Idempotent re-run: nothing left to trim.
    const again = await trimBefore(CUTOFF, { db });
    expect(Object.values(again.counts).every((n) => n === 0)).to.equal(true);
  });

  it("never deletes docs the export has not covered (watermark guard)", async () => {
    await seedGraph();
    // No export_state docs → epoch watermarks → everything is unexported.
    const outcome = await trimBefore(CUTOFF, { db });
    expect(outcome.counts.checkouts).to.equal(0);
    expect(outcome.counts.usage_machine).to.equal(0);
    // The unpaid bill IS trimmed — it never exports (only paid bills reach
    // BigQuery), so there is nothing to lose. The paid one is guarded.
    expect(outcome.counts.bills).to.equal(1);
    expect(outcome.skippedUnexported).to.be.greaterThan(0);
    expect((await db.doc("checkouts/co-old").get()).exists).to.equal(true);
    expect((await db.doc("bills/b-old").get()).exists).to.equal(true);
    expect((await db.doc("bills/b-unpaid-old").get()).exists).to.equal(false);
    // Un-exported collections still trim (they never reach BigQuery).
    expect(outcome.counts.authentications).to.equal(1);
    expect(outcome.counts.audit_log).to.equal(1);
  });

  it("finishes a crashed PDF move (archive object already present)", async () => {
    await seedGraph();
    await seedFreshWatermarks();
    // Simulate: previous run copied to the archive, crashed before source
    // delete. The retry must treat "already archived" as success.
    await admin
      .storage()
      .bucket("oww-maco-invoice-archive")
      .file("invoices/b-old.pdf")
      .save(Buffer.from("%PDF-old"));
    const outcome = await trimBefore(CUTOFF, { db });
    expect(outcome.counts.bills).to.equal(2);
    expect((await getBucket().file("invoices/b-old.pdf").exists())[0]).to.equal(false);
    expect((await db.doc("bills/b-old").get()).exists).to.equal(false);
  });

  it("handler guards admin and defaults the cutoff", async () => {
    const nonAdmin = {
      data: { dryRun: true },
      auth: { uid: "someone", token: {} },
    } as unknown as CallableRequest<never>;
    try {
      await privacyTrimHandler(nonAdmin);
      throw new Error("expected permission-denied");
    } catch (err) {
      expect((err as { code?: string }).code).to.equal("permission-denied");
    }
    const asAdmin = {
      data: { cutoffYear: 2023, dryRun: true },
      auth: { uid: "admin-1", token: { admin: true } },
    } as unknown as CallableRequest<never>;
    const outcome = (await privacyTrimHandler(asAdmin)) as { cutoff: string };
    // 2023-01-01 Zurich == 2022-12-31T23:00Z
    expect(outcome.cutoff).to.equal("2022-12-31T23:00:00.000Z");
  });
});
