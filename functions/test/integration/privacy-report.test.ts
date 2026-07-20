// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Integration tests for the DSAR report (ADR-0038): guard, completeness
 * over a seeded graph, and the other-subjects exclusion contract.
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
  buildPrivacyReport,
  privacyReportHandler,
} from "../../src/privacy/privacy_report";
import type { CallableRequest } from "firebase-functions/v2/https";

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

describe("privacy report (integration)", function () {
  this.timeout(20000);

  let db: admin.firestore.Firestore;

  before(async () => {
    await setupEmulator();
    db = admin.firestore();
  });

  beforeEach(async () => {
    await clearFirestore();
    try {
      await admin.auth().deleteUser("u1");
    } catch {
      // absent — fine
    }
  });

  after(async () => {
    await teardownEmulator();
  });

  async function seed(): Promise<void> {
    await admin.auth().createUser({ uid: "u1", email: "u1@example.com" });
    const u1 = db.doc("users/u1");
    const u2 = db.doc("users/u2");
    await u1.set({
      created: ts("2024-01-01T00:00:00Z"),
      firstName: "Erika",
      lastName: "Muster",
      email: "u1@example.com",
      permissions: [],
      roles: [],
    });
    await u2.set({
      created: ts("2024-01-01T00:00:00Z"),
      firstName: "Other",
      lastName: "Person",
      email: "u2@example.com",
      permissions: [],
      roles: [],
    });
    await db.doc("tokens/aabbccdd").set({
      userId: u1,
      registered: ts("2024-02-01T00:00:00Z"),
      label: "Badge",
    });
    await db.doc("checkouts/co-own").set({
      userId: u1,
      status: "closed",
      usageType: "regular",
      created: ts("2026-07-01T10:00:00Z"),
      closedAt: ts("2026-07-01T12:00:00Z"),
      workshopsVisited: ["holz"],
      persons: [
        { name: "Erika Muster", email: "u1@example.com", userType: "erwachsen" },
        // A guest Erika brought along — their identity must NOT surface in
        // Erika's DSAR export (guests are their own data subjects).
        {
          name: "Guest Person",
          email: "guest@example.com",
          userType: "kind",
          billingAddress: { company: "", street: "Gasse 2", zip: "8820", city: "Wädenswil" },
        },
      ],
      modifiedBy: null,
      modifiedAt: ts("2026-07-01T12:00:00Z"),
    });
    await db.doc("checkouts/co-own/items/i1").set({
      workshop: "holz",
      description: "Material",
      origin: "manual",
      catalogId: null,
      created: ts("2026-07-01T11:00:00Z"),
      quantity: 1,
      unitPrice: 10,
      totalPrice: 10,
    });
    await db.doc("checkouts/co-other").set({
      userId: u2,
      status: "closed",
      usageType: "regular",
      created: ts("2026-07-02T10:00:00Z"),
      closedAt: ts("2026-07-02T12:00:00Z"),
      workshopsVisited: [],
      persons: [
        { name: "Other Person", email: "u2@example.com", userType: "erwachsen" },
        { name: "Erika Muster", email: "u1@example.com", userType: "erwachsen", userRef: u1 },
      ],
      modifiedBy: null,
      modifiedAt: ts("2026-07-02T12:00:00Z"),
    });
    await db.doc("bills/b1").set({
      userId: u1,
      referenceNumber: 260100,
      amount: 10,
      currency: "CHF",
      storagePath: "invoices/b1.pdf",
      created: ts("2026-07-01T12:01:00Z"),
      paidAt: ts("2026-07-01T13:00:00Z"),
      paidVia: "twint",
    });
    await db.doc("usage_machine/us1").set({
      userId: u1,
      authenticationId: null,
      machine: db.doc("machine/laser"),
      workshop: "metall",
      startTime: ts("2026-07-01T10:30:00Z"),
      endTime: ts("2026-07-01T11:30:00Z"),
      endReason: null,
    });
    await db.doc("memberships/m1").set({
      type: "family",
      status: "active",
      lastPaidAt: null,
      validUntil: ts("2027-01-01T00:00:00Z"),
      ownerUserId: u2,
      members: [u2, u1],
      paymentCheckouts: [],
    });
    await db.doc("memberships/m1/invites/inv1").set({
      email: "u1@example.com",
      status: "accepted",
      invitedAt: ts("2026-01-01T00:00:00Z"),
      invitedBy: u2,
      resolvedAt: null,
      ttlAt: ts("2026-02-01T00:00:00Z"),
    });
    await db.collection("machine_reports").add({
      machine: db.doc("machine/laser"),
      message: "Defekt",
      userId: u1,
      reporterName: null,
      created: ts("2026-07-01T09:00:00Z"),
      status: "open",
      resolvedAt: null,
    });
    await db.collection("audit_log").add({
      collection: "users",
      docId: "u1",
      operation: "create",
      actorUid: null,
      before: null,
      after: { firstName: "Erika" },
      timestamp: ts("2024-01-01T00:00:00Z"),
    });
  }

  it("rejects non-admin callers", async () => {
    const request = {
      data: { uid: "u1" },
      auth: { uid: "someone", token: {} },
    } as unknown as CallableRequest<never>;
    try {
      await privacyReportHandler(request);
      throw new Error("expected permission-denied");
    } catch (err) {
      expect((err as { code?: string }).code).to.equal(
        "permission-denied"
      );
    }
  });

  it("covers the full seeded graph and excludes other subjects' data", async () => {
    await seed();
    const report = await buildPrivacyReport(
      { uid: "u1" },
      { db, auth: admin.auth() }
    );

    expect((report.subject as { uid: string }).uid).to.equal("u1");
    expect((report.authAccount as { email: string }).email).to.equal("u1@example.com");
    expect((report.user as { firstName: string }).firstName).to.equal("Erika");
    expect(report.tokens).to.have.length(1);
    const checkouts = report.checkouts as Array<{
      id: string;
      items: unknown[];
      persons: Array<Record<string, unknown>>;
    }>;
    expect(checkouts.map((c) => c.id)).to.deep.equal(["co-own"]);
    expect(checkouts[0].items).to.have.length(1);

    // Owned checkouts keep the subject's own entry but reduce co-visitors
    // to their userType — no guest names/emails/addresses in the export.
    expect(checkouts[0].persons).to.deep.equal([
      { name: "Erika Muster", email: "u1@example.com", userType: "erwachsen" },
      { userType: "kind", redacted: true },
    ]);
    const checkoutsJson = JSON.stringify(checkouts);
    expect(checkoutsJson).to.not.include("guest@example.com");
    expect(checkoutsJson).to.not.include("Guest Person");
    expect(checkoutsJson).to.not.include("Gasse 2");

    // Appearance in u2's checkout: only Erika's entry, never u2's data.
    const appearances = report.personsAppearances as Array<{
      checkoutId: string;
      entry: { name: string };
    }>;
    expect(appearances).to.have.length(1);
    expect(appearances[0].checkoutId).to.equal("co-other");
    expect(appearances[0].entry.name).to.equal("Erika Muster");
    const appearanceJson = JSON.stringify(appearances);
    expect(appearanceJson).to.not.include("Other Person");
    expect(appearanceJson).to.not.include("u2@example.com");

    expect(report.bills).to.have.length(1);
    expect((report.invoicePdfs as { paths: string[] }).paths).to.deep.equal([
      "invoices/b1.pdf",
    ]);
    expect(report.usageMachine).to.have.length(1);
    expect(report.memberships).to.have.length(1);
    expect(report.membershipInvites).to.have.length(1);
    expect(report.machineReports).to.have.length(1);
    const auditCounts = (report.auditLog as {
      countsByCollection: Record<string, number>;
    }).countsByCollection;
    expect(auditCounts.users).to.equal(1);

    // Disclosure blocks + register present.
    expect(report.statistics).to.be.a("string");
    expect(report.processors).to.have.length.greaterThan(1);
    expect(report.processingRegister).to.have.length.greaterThan(10);

    // Serialization convention: refs are paths, Timestamps ISO strings.
    const bill = (report.bills as Array<Record<string, unknown>>)[0];
    expect(bill.userId).to.equal("users/u1");
    expect(bill.paidAt).to.equal("2026-07-01T13:00:00.000Z");

    // Fits the callable response comfortably.
    expect(JSON.stringify(report).length).to.be.lessThan(1024 * 1024);
  });

  it("reports a walk-in subject by email", async () => {
    await seed();
    await db.doc("checkouts/co-walkin").set({
      userId: db.doc("users/u2"),
      status: "closed",
      usageType: "regular",
      created: ts("2026-07-03T10:00:00Z"),
      closedAt: ts("2026-07-03T12:00:00Z"),
      workshopsVisited: [],
      persons: [
        { name: "Walk In", email: "walkin@example.com", userType: "erwachsen" },
      ],
      modifiedBy: null,
      modifiedAt: ts("2026-07-03T12:00:00Z"),
    });
    const report = await buildPrivacyReport(
      { email: "walkin@example.com" },
      { db, auth: admin.auth() }
    );
    expect((report.subject as { kind: string }).kind).to.equal("walk-in");
    expect(report.user).to.equal(null);
    const appearances = report.personsAppearances as Array<{ checkoutId: string }>;
    expect(appearances.map((a) => a.checkoutId)).to.deep.equal(["co-walkin"]);
    expect(report.checkouts).to.have.length(0);
  });
});
