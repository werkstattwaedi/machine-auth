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
  catalogSnapshotDate,
  runStatsExport,
  type StatsExportDeps,
} from "../../src/stats/export_job";
import { InMemorySink } from "../../src/stats/sink";
import { reemitVisitItems } from "../../src/stats/reemit_visit_items";
import { memoryStateStore } from "../../src/stats/watermark";
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

  it("dry-run state store never advances the Firestore watermark", async () => {
    await seedClosedCheckout("co-1", { closedAt: ts("2026-07-18T15:30:00Z") });
    const sink = new InMemorySink();
    const store = memoryStateStore(db);

    const first = await runStatsExport(NOW, { ...deps(sink), stateStore: store });
    expect(first.visits.exported).to.equal(1);
    // Cursor advanced only in memory — export_state stays empty …
    expect((await db.doc("export_state/visits").get()).exists).to.equal(false);
    // … the same store doesn't re-export …
    const second = await runStatsExport(NOW, { ...deps(sink), stateStore: store });
    expect(second.visits.exported).to.equal(0);
    // … and a subsequent REAL run still sees the data as unexported.
    const real = await runStatsExport(NOW, deps(new InMemorySink()));
    expect(real.visits.exported).to.equal(1);
    expect((await db.doc("export_state/visits").get()).exists).to.equal(true);
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

  describe("catalog snapshots", () => {
    async function seedCatalogItem(id: string, price: number): Promise<void> {
      await db.collection("catalog").doc(id).set({
        code: "1042",
        name: "Sperrholz",
        workshops: ["holz"],
        category: ["Holz"],
        active: true,
        userCanAdd: true,
        variants: [
          { id: "default", pricingModel: "area", unitPrice: { default: price } },
        ],
      });
    }

    it("snapshots the catalog once per week and keeps each week's prices", async () => {
      await seedCatalogItem("cat-1", 20);
      const sink = new InMemorySink();
      // NOW is Sunday 2026-07-19, 05:00 Zurich.
      const first = await runStatsExport(NOW, deps(sink));
      expect(first.catalog_snapshots.exported).to.equal(1);
      await runStatsExport(new Date("2026-07-22T03:00:00.000Z"), deps(sink));
      expect(sink.tableRows("catalog_snapshots")).to.have.length(1);

      await seedCatalogItem("cat-1", 22);
      await runStatsExport(new Date("2026-07-26T03:00:00.000Z"), deps(sink));
      const variants = sink.tableRows("catalog_variant_snapshots");
      expect(variants.map((r) => [r.snapshot_date, r.price_default])).to.deep.equal([
        ["2026-07-19", 20],
        ["2026-07-26", 22],
      ]);
    });

    it("catches up a missed Sunday on the next run under that Sunday's date", async () => {
      await seedCatalogItem("cat-1", 20);
      const sink = new InMemorySink();
      await runStatsExport(new Date("2026-07-20T03:00:00.000Z"), deps(sink));
      expect(sink.tableRows("catalog_snapshots").map((r) => r.doc_id)).to.deep.equal([
        "cat-1/2026-07-19",
      ]);
    });
  });

  describe("reemitVisitItems", () => {
    it("re-emits only exported checkouts' items, without touching visits or the watermark", async () => {
      await seedClosedCheckout("co-old", {
        closedAt: ts("2026-07-18T15:30:00Z"),
        items: 1,
      });
      await runStatsExport(NOW, deps(new InMemorySink()));
      const watermarkBefore = (await db.doc("export_state/visits").get()).data();
      // Past the watermark: the daily export owns it.
      await seedClosedCheckout("co-new", {
        closedAt: ts("2026-07-19T01:00:00Z"),
        items: 1,
      });
      await db.doc("checkouts/co-old/items/item-0").update({
        variantId: "default",
        pricingModel: "count",
      });

      const sink = new InMemorySink();
      const summary = await reemitVisitItems(NOW, { db, sink, salt: SALT });

      expect(summary).to.deep.equal({ checkouts: 1, items: 1, skippedUnexported: 1 });
      expect(sink.tableRows("visit_items")).to.have.length(1);
      expect(sink.tableRows("visit_items")[0]).to.include({
        doc_id: "co-old/item-0",
        variant_id: "default",
        pricing_model: "count",
      });
      expect(sink.tableRows("visits")).to.have.length(0);
      expect((await db.doc("export_state/visits").get()).data()).to.deep.equal(
        watermarkBefore
      );
    });
  });

  describe("correction flush (ADR-0042)", () => {
    function lastRow(sink: InMemorySink, table: string, docId: string) {
      const rows = sink.tableRows(table).filter((r) => r.doc_id === docId);
      return rows[rows.length - 1];
    }

    it("flushes cancelled + replacement checkouts sitting behind the watermark and stamps them", async () => {
      await seedUserWithMembership("u1");
      await seedClosedCheckout("co-old", { uid: "u1", closedAt: ts("2026-07-10T15:30:00Z"), items: 1 });
      const sink = new InMemorySink();
      const first = await runStatsExport(NOW, deps(sink));
      expect(first.visits.exported).to.equal(1);
      expect(first.pending_flush.exported).to.equal(0);

      // An admin voids co-old and issues a replacement with the SAME closedAt
      // (behind the watermark now); both carry the explicit null sentinel.
      await db.doc("checkouts/co-old").update({
        status: "cancelled",
        cancelledAt: ts("2026-07-18T09:17:00Z"),
        statsFlushedAt: null,
      });
      await seedClosedCheckout("co-new", { uid: "u1", closedAt: ts("2026-07-10T15:30:00Z"), items: 1 });
      await db.doc("checkouts/co-new").update({
        statsFlushedAt: null,
        supersedesCheckoutRef: db.doc("checkouts/co-old"),
      });

      const second = await runStatsExport(NOW, deps(sink));
      expect(second.visits.exported).to.equal(0);
      expect(second.pending_flush).to.deep.equal({ exported: 2, drained: true });
      expect(lastRow(sink, "visits", "co-old").cancelled_at).to.equal("2026-07-18T09:00:00.000Z");
      expect(lastRow(sink, "visits", "co-new").cancelled_at).to.equal(null);
      expect(lastRow(sink, "visits", "co-new").visit_date).to.equal("2026-07-10");
      expect(sink.tableRows("visit_items").filter((r) => (r.doc_id as string).startsWith("co-new/"))).to.have.length(1);
      expect((await db.doc("checkouts/co-old").get()).get("statsFlushedAt")).to.be.instanceOf(Timestamp);
      expect((await db.doc("checkouts/co-new").get()).get("statsFlushedAt")).to.be.instanceOf(Timestamp);

      const third = await runStatsExport(NOW, deps(sink));
      expect(third.pending_flush.exported).to.equal(0);
    });

    it("does not double-export a same-day replacement still ahead of the watermark", async () => {
      await seedUserWithMembership("u1")
      // A replacement whose closedAt the watermark has NOT passed yet, carrying the sentinel.
      await seedClosedCheckout("co-new", { uid: "u1", closedAt: ts("2026-07-18T15:30:00Z"), items: 1 })
      await db.doc("checkouts/co-new").update({ statsFlushedAt: null })
      const sink = new InMemorySink()
      const summary = await runStatsExport(NOW, deps(sink))
      expect(summary.visits.exported).to.equal(0)
      expect(summary.pending_flush.exported).to.equal(1)
      expect(sink.tableRows("visits").filter((r) => r.doc_id === "co-new")).to.have.length(1)
      expect(
        sink.tableRows("visit_items").filter((r) => (r.doc_id as string).startsWith("co-new/")),
      ).to.have.length(1)
      // The watermark advanced over it regardless.
      expect((await runStatsExport(NOW, deps(sink))).visits.exported).to.equal(0)
    })

    it("dry run emits the rows but never stamps statsFlushedAt", async () => {
      await seedUserWithMembership("u1");
      await seedClosedCheckout("co-x", { uid: "u1", closedAt: ts("2026-07-10T15:30:00Z") });
      await db.doc("checkouts/co-x").update({
        status: "cancelled",
        cancelledAt: ts("2026-07-18T09:17:00Z"),
        statsFlushedAt: null,
      });
      const sink = new InMemorySink();
      const summary = await runStatsExport(NOW, {
        ...deps(sink),
        dryRun: true,
        stateStore: memoryStateStore(db),
      });
      expect(summary.pending_flush).to.deep.equal({ exported: 1, drained: true });
      expect(lastRow(sink, "visits", "co-x").cancelled_at).to.equal("2026-07-18T09:00:00.000Z");
      expect((await db.doc("checkouts/co-x").get()).get("statsFlushedAt")).to.equal(null);
    });
  });

});

describe("catalogSnapshotDate", () => {
  it("is the Zurich Sunday on or before the run", () => {
    // Sunday 05:00 Zurich → itself.
    expect(catalogSnapshotDate(new Date("2026-07-19T03:00:00Z"))).to.equal("2026-07-19");
    // Saturday 23:30 Zurich → the previous Sunday.
    expect(catalogSnapshotDate(new Date("2026-07-25T21:30:00Z"))).to.equal("2026-07-19");
    // Saturday 22:30 UTC is already Sunday 00:30 in Zurich.
    expect(catalogSnapshotDate(new Date("2026-07-25T22:30:00Z"))).to.equal("2026-07-26");
    // Across a month boundary in winter time (CET).
    expect(catalogSnapshotDate(new Date("2026-12-02T04:00:00Z"))).to.equal("2026-11-29");
  });
});
