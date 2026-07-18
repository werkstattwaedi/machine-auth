// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Integration tests for the stats export pipeline (ADR-0039) against the
 * Firestore emulator, with an InMemorySink standing in for BigQuery (there
 * is no BQ emulator — the StatsSink seam is the tested contract).
 */

import { expect } from "chai";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
} from "../emulator-helper";
import {
  runStatsExport,
  type StatsExportDeps,
} from "../../src/stats/export_job";
import { InMemorySink } from "../../src/stats/sink";
import { subjectKey } from "../../src/privacy/subject_key";

const SALT = "test-salt";
const NOW = new Date("2026-07-19T03:00:00.000Z"); // 05:00 Zurich

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

describe("stats export (integration)", function () {
  this.timeout(10000);

  let db: admin.firestore.Firestore;

  before(async () => {
    await setupEmulator();
    db = admin.firestore();
  });

  beforeEach(async () => {
    await clearFirestore();
  });

  after(async () => {
    await teardownEmulator();
  });

  function deps(sink: InMemorySink, batchSize?: number): StatsExportDeps {
    return { db, sink, salt: SALT, batchSize };
  }

  async function seedUserWithMembership(uid: string): Promise<void> {
    await db.collection("users").doc(uid).set({
      created: ts("2024-01-01T00:00:00Z"),
      firstName: "Test",
      lastName: "User",
      email: `${uid}@example.com`,
      permissions: [],
      roles: [],
    });
    await db.collection("memberships").doc(`m-${uid}`).set({
      type: "single",
      status: "active",
      lastPaidAt: null,
      validUntil: ts("2027-01-01T00:00:00Z"),
      ownerUserId: db.doc(`users/${uid}`),
      members: [db.doc(`users/${uid}`)],
      paymentCheckouts: [],
    });
  }

  async function seedClosedCheckout(
    id: string,
    opts: {
      uid?: string;
      firebaseUid?: string;
      closedAt: Timestamp;
      items?: number;
    }
  ): Promise<void> {
    const ref = db.collection("checkouts").doc(id);
    await ref.set({
      userId: opts.uid ? db.doc(`users/${opts.uid}`) : null,
      firebaseUid: opts.firebaseUid ?? null,
      status: "closed",
      usageType: "regular",
      created: ts("2026-07-18T10:00:00Z"),
      closedAt: opts.closedAt,
      workshopsVisited: ["holz"],
      persons: [
        { name: "Visible Name", email: "person@example.com", userType: "erwachsen" },
      ],
      modifiedBy: null,
      modifiedAt: opts.closedAt,
      summary: {
        totalPrice: 30,
        entryFees: 10,
        machineCost: 0,
        materialCost: 20,
        tip: 0,
        discountAmount: 0,
      },
    });
    for (let i = 0; i < (opts.items ?? 0); i++) {
      await ref.collection("items").doc(`item-${i}`).set({
        workshop: "holz",
        description: "Material",
        origin: "manual",
        catalogId: db.doc("catalog/cat-1"),
        created: ts("2026-07-18T11:00:00Z"),
        quantity: 1,
        unitPrice: 20,
        totalPrice: 20,
      });
    }
  }

  it("exports the seeded graph once and is idempotent on re-run", async () => {
    await seedUserWithMembership("u1");
    await seedClosedCheckout("co-1", {
      uid: "u1",
      closedAt: ts("2026-07-18T15:30:00Z"),
      items: 2,
    });
    // Open checkout must not export.
    await db.collection("checkouts").doc("co-open").set({
      userId: db.doc("users/u1"),
      status: "open",
      usageType: "regular",
      created: ts("2026-07-18T16:00:00Z"),
      workshopsVisited: [],
      persons: [],
      modifiedBy: null,
      modifiedAt: ts("2026-07-18T16:00:00Z"),
    });
    await db.collection("usage_machine").doc("us-1").set({
      userId: db.doc("users/u1"),
      authenticationId: null,
      machine: db.doc("machine/laser"),
      workshop: "metall",
      startTime: ts("2026-07-18T14:00:00Z"),
      endTime: ts("2026-07-18T15:00:00Z"),
      activeSeconds: 3000,
      billableSeconds: 3600,
      endReason: null,
      checkoutItemRef: null,
    });
    await db.collection("bills").doc("b-paid").set({
      userId: db.doc("users/u1"),
      referenceNumber: 260001,
      amount: 30,
      currency: "CHF",
      storagePath: "invoices/b-paid.pdf",
      created: ts("2026-07-18T15:31:00Z"),
      paidAt: ts("2026-07-18T18:00:00Z"),
      paidVia: "twint",
    });
    await db.collection("bills").doc("b-unpaid").set({
      userId: db.doc("users/u1"),
      referenceNumber: 260002,
      amount: 99,
      currency: "CHF",
      created: ts("2026-07-18T15:32:00Z"),
      paidAt: null,
      paidVia: null,
    });

    const sink = new InMemorySink();
    const summary = await runStatsExport(NOW, deps(sink));

    expect(summary.visits.exported).to.equal(1);
    expect(summary.machine_usage.exported).to.equal(1);
    expect(summary.bills.exported).to.equal(1);
    expect(summary.membership_snapshots.exported).to.equal(1);
    expect(Object.values(summary).every((s) => s.drained)).to.equal(true);

    const visit = sink.tableRows("visits")[0];
    expect(visit.doc_id).to.equal("co-1");
    expect(visit.subject_key).to.equal(subjectKey(SALT, "u1"));
    expect(visit.is_registered).to.equal(true);
    expect(visit.is_member).to.equal(true);
    expect(visit.visit_date).to.equal("2026-07-18");
    expect(visit.closed_at).to.equal("2026-07-18T15:00:00.000Z");
    expect(sink.tableRows("visit_items")).to.have.length(2);
    expect(sink.tableRows("bills")).to.have.length(1);
    expect(sink.tableRows("bills")[0].doc_id).to.equal("b-paid");
    expect(Object.keys(sink.tableRows("bills")[0])).to.not.include(
      "referenceNumber"
    );
    const usage = sink.tableRows("machine_usage")[0];
    expect(usage.machine).to.equal("laser");
    expect(usage.billable_seconds).to.equal(3600);
    const snapshot = sink.tableRows("membership_snapshots")[0];
    expect(snapshot.doc_id).to.equal("m-u1/2026-07");
    expect(snapshot.owner_subject_key).to.equal(subjectKey(SALT, "u1"));

    // No PII anywhere in any exported row.
    const allRows = JSON.stringify([...sink.rows.values()]);
    expect(allRows).to.not.include("example.com");
    expect(allRows).to.not.include("Visible Name");

    // Second run: watermarks advanced, nothing new.
    const sink2 = new InMemorySink();
    const summary2 = await runStatsExport(NOW, deps(sink2));
    expect(Object.values(summary2).every((s) => s.exported === 0)).to.equal(
      true
    );
  });

  it("exports anonymous checkouts keyed by firebaseUid", async () => {
    await seedClosedCheckout("co-anon", {
      firebaseUid: "anon-principal",
      closedAt: ts("2026-07-18T12:00:00Z"),
    });
    const sink = new InMemorySink();
    await runStatsExport(NOW, deps(sink));
    const visit = sink.tableRows("visits")[0];
    expect(visit.subject_key).to.equal(subjectKey(SALT, "anon-principal"));
    expect(visit.is_registered).to.equal(false);
    expect(visit.is_member).to.equal(false);
  });

  it("does not skip equal-timestamp docs at a page boundary", async () => {
    const sameInstant = ts("2026-07-18T14:00:00Z");
    await seedClosedCheckout("co-a", { closedAt: sameInstant });
    await seedClosedCheckout("co-b", { closedAt: sameInstant });
    await seedClosedCheckout("co-c", { closedAt: sameInstant });

    const sink = new InMemorySink();
    const d = deps(sink, 2);
    let rounds = 0;
    for (;;) {
      const summary = await runStatsExport(NOW, d);
      rounds++;
      if (Object.values(summary).every((s) => s.drained)) break;
      expect(rounds).to.be.lessThan(10);
    }
    const ids = sink.tableRows("visits").map((r) => r.doc_id).sort();
    expect(ids).to.deep.equal(["co-a", "co-b", "co-c"]);
  });

  it("re-exports duplicates (same doc_id) after a crash before watermark advance", async () => {
    await seedClosedCheckout("co-1", { closedAt: ts("2026-07-18T15:30:00Z") });
    const sink = new InMemorySink();
    await runStatsExport(NOW, deps(sink));
    // Simulate "insert succeeded, watermark advance lost".
    await db.collection("export_state").doc("visits").delete();
    await runStatsExport(NOW, deps(sink));
    const rows = sink.tableRows("visits");
    expect(rows).to.have.length(2);
    expect(rows[0].doc_id).to.equal(rows[1].doc_id);
  });

  it("snapshots memberships once per month, then again next month", async () => {
    await seedUserWithMembership("u1");
    const sink = new InMemorySink();
    await runStatsExport(NOW, deps(sink));
    await runStatsExport(NOW, deps(sink));
    expect(sink.tableRows("membership_snapshots")).to.have.length(1);

    const nextMonth = new Date("2026-08-02T03:00:00.000Z");
    await runStatsExport(nextMonth, deps(sink));
    const ids = sink.tableRows("membership_snapshots").map((r) => r.doc_id);
    expect(ids).to.deep.equal(["m-u1/2026-07", "m-u1/2026-08"]);
  });
});
