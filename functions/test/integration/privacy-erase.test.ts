// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Integration tests for the erasure engine (ADR-0038) against the
 * Firestore + Auth + Storage emulators. The stats sink is an InMemorySink
 * (flush-before-delete contract); audit triggers don't run under
 * emulators:exec, so audit_log entries are seeded to simulate both the
 * historical entries and the delete-triggered race entries.
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
import { eraseSubject, privacyEraseHandler, type EraseDeps } from "../../src/privacy/erase_subject";
import { subjectKey } from "../../src/privacy/subject_key";
import { InMemorySink } from "../../src/stats/sink";
import type { CallableRequest } from "firebase-functions/v2/https";

const SALT = "test-salt";

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function callable(
  data: Record<string, unknown>,
  isAdmin = true
): CallableRequest<never> {
  return {
    data,
    auth: { uid: "admin-1", token: { admin: isAdmin } },
  } as unknown as CallableRequest<never>;
}

async function expectHttpsError(
  p: Promise<unknown>,
  code: string
): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    expect((err as { code?: string }).code).to.equal(code);
    return err;
  }
  throw new Error(`Expected HttpsError ${code}, got success`);
}

describe("privacy erase (integration)", function () {
  this.timeout(20000);

  let db: admin.firestore.Firestore;

  before(async () => {
    await setupEmulator();
    db = admin.firestore();
    process.env.STATS_SUBJECT_SALT = SALT;
  });

  beforeEach(async () => {
    await clearFirestore();
    await clearStorage();
    try {
      await admin.auth().deleteUser("u1");
    } catch {
      // not present — fine
    }
  });

  after(async () => {
    await teardownEmulator();
  });

  function deps(sink = new InMemorySink()): EraseDeps & { sink: InMemorySink } {
    return {
      db,
      auth: admin.auth(),
      salt: SALT,
      sink,
      actorUid: "admin-1",
    };
  }

  /** Full graph for subject u1 plus bystander u2. */
  async function seedGraph(): Promise<void> {
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
      label: "Badge Erika",
    });
    await db.doc("authentications/auth-1").set({
      tokenId: db.doc("tokens/aabbccdd"),
      keySlot: 0,
      created: ts("2026-07-01T10:00:00Z"),
      inProgressAuth: null,
      ttlAt: null,
    });
    // Owned, closed checkout with an item.
    await db.doc("checkouts/co-own").set({
      userId: u1,
      firebaseUid: "u1",
      status: "closed",
      usageType: "regular",
      created: ts("2026-07-01T10:00:00Z"),
      closedAt: ts("2026-07-01T12:00:00Z"),
      workshopsVisited: ["holz"],
      persons: [{ name: "Erika Muster", email: "u1@example.com", userType: "erwachsen" }],
      modifiedBy: null,
      modifiedAt: ts("2026-07-01T12:00:00Z"),
      summary: { totalPrice: 10, entryFees: 10, machineCost: 0, materialCost: 0, tip: 0 },
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
    // u2's checkout where Erika appears in persons[] (roster pick) and a
    // badge item carries her tag UID.
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
    await db.doc("checkouts/co-other/items/badge").set({
      workshop: "diverses",
      description: "NFC-Badge",
      origin: "qr",
      catalogId: null,
      created: ts("2026-07-02T11:00:00Z"),
      quantity: 1,
      unitPrice: 5,
      totalPrice: 5,
      tokenId: "aabbccdd",
      badgeSdmCounter: 7,
    });
    // Paid bill with a PDF object in Storage.
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
    await getBucket().file("invoices/b1.pdf").save(Buffer.from("%PDF-fake"));
    await db.doc("usage_machine/us1").set({
      userId: u1,
      authenticationId: null,
      machine: db.doc("machine/laser"),
      workshop: "metall",
      startTime: ts("2026-07-01T10:30:00Z"),
      endTime: ts("2026-07-01T11:30:00Z"),
      activeSeconds: 1800,
      billableSeconds: 3600,
      endReason: null,
      checkoutItemRef: null,
    });
    // Membership owned by u2 where Erika is a member, with an invite for
    // her email; plus an expired membership Erika owned.
    await db.doc("memberships/m-u2").set({
      type: "family",
      status: "active",
      lastPaidAt: null,
      validUntil: ts("2027-01-01T00:00:00Z"),
      ownerUserId: u2,
      members: [u2, u1],
      paymentCheckouts: [],
    });
    await db.doc("memberships/m-u2/invites/inv1").set({
      email: "u1@example.com",
      status: "accepted",
      invitedAt: ts("2026-01-01T00:00:00Z"),
      invitedBy: u2,
      resolvedAt: ts("2026-01-02T00:00:00Z"),
      resolvedUserId: u1,
      ttlAt: ts("2026-02-01T00:00:00Z"),
    });
    await db.doc("memberships/m-u1-old").set({
      type: "single",
      status: "expired",
      lastPaidAt: null,
      validUntil: ts("2025-01-01T00:00:00Z"),
      ownerUserId: u1,
      members: [u1],
      paymentCheckouts: [],
    });
    await db.doc("memberships/m-u1-old/invites/inv2").set({
      email: "friend@example.com",
      status: "pending",
      invitedAt: ts("2024-12-01T00:00:00Z"),
      invitedBy: u1,
      resolvedAt: null,
      ttlAt: ts("2025-01-01T00:00:00Z"),
    });
    await db.collection("loginCodes").add({
      email: "u1@example.com",
      codeHash: "x",
      expiresAt: ts("2026-07-19T00:05:00Z"),
      created: ts("2026-07-19T00:00:00Z"),
      attempts: 0,
      consumedAt: null,
    });
    await db.collection("machine_reports").add({
      machine: db.doc("machine/laser"),
      message: "Laser schneidet nicht",
      userId: u1,
      reporterName: null,
      created: ts("2026-07-01T09:00:00Z"),
      status: "open",
      resolvedAt: null,
    });
    // Historical audit entries (normally written by the audit triggers).
    await db.collection("audit_log").add({
      collection: "users",
      docId: "u1",
      operation: "create",
      actorUid: null,
      before: null,
      after: { firstName: "Erika", lastName: "Muster", email: "u1@example.com" },
      timestamp: ts("2024-01-01T00:00:00Z"),
    });
    await db.collection("audit_log").add({
      collection: "checkouts",
      docId: "co-other",
      operation: "update",
      actorUid: null,
      before: { persons: [{ name: "Erika Muster", email: "u1@example.com" }] },
      after: { persons: [{ name: "Erika Muster", email: "u1@example.com" }] },
      timestamp: ts("2026-07-02T12:00:00Z"),
    });
  }

  it("erases the full graph, keeps stats, and is idempotent", async () => {
    await seedGraph();
    const d = deps();
    const outcome = await eraseSubject({ uid: "u1" }, d);

    expect(outcome.kind).to.equal("registered");
    expect(outcome.blockers).to.have.length(0);

    // Flush-before-delete: the unexported checkout/bill/usage reached the
    // sink before deletion.
    expect(d.sink.tableRows("visits").map((r) => r.doc_id)).to.include("co-own");
    expect(d.sink.tableRows("bills").map((r) => r.doc_id)).to.include("b1");
    expect(d.sink.tableRows("machine_usage").map((r) => r.doc_id)).to.include("us1");

    // Identity + owned data gone.
    expect((await db.doc("users/u1").get()).exists).to.equal(false);
    expect((await db.doc("tokens/aabbccdd").get()).exists).to.equal(false);
    expect((await db.doc("checkouts/co-own").get()).exists).to.equal(false);
    expect((await db.doc("checkouts/co-own/items/i1").get()).exists).to.equal(false);
    expect((await db.doc("bills/b1").get()).exists).to.equal(false);
    expect((await db.doc("usage_machine/us1").get()).exists).to.equal(false);
    expect((await db.doc("authentications/auth-1").get()).exists).to.equal(false);
    expect((await db.doc("memberships/m-u1-old").get()).exists).to.equal(false);
    expect((await db.doc("memberships/m-u1-old/invites/inv2").get()).exists).to.equal(false);
    await expectHttpsError(
      admin.auth().getUser("u1") as unknown as Promise<unknown>,
      "auth/user-not-found"
    );

    // PDF moved to the archive bucket, gone from the live bucket.
    expect((await getBucket().file("invoices/b1.pdf").exists())[0]).to.equal(false);
    const archive = admin.storage().bucket("oww-maco-invoice-archive");
    expect((await archive.file("invoices/b1.pdf").exists())[0]).to.equal(true);

    // u2's checkout survives with Erika's persons[] entry redacted and the
    // badge item's tag UID nulled; u2's own entry untouched.
    const other = (await db.doc("checkouts/co-other").get()).data()!;
    expect(other.persons[0].name).to.equal("Other Person");
    expect(other.persons[1].name).to.equal("");
    expect(other.persons[1].email).to.equal("");
    expect(other.persons[1].userRef).to.equal(null);
    const badge = (await db.doc("checkouts/co-other/items/badge").get()).data()!;
    expect(badge.tokenId).to.equal(null);
    expect(badge.badgeSdmCounter).to.equal(null);

    // Membership: removed from members[], doc + owner untouched.
    const m = (await db.doc("memberships/m-u2").get()).data()!;
    expect(m.members.map((r: { id: string }) => r.id)).to.deep.equal(["u2"]);
    expect((await db.doc("memberships/m-u2/invites/inv1").get()).exists).to.equal(false);

    // loginCodes + machine report.
    expect((await db.collection("loginCodes").where("email", "==", "u1@example.com").get()).size).to.equal(0);
    const report = (await db.collection("machine_reports").get()).docs[0].data();
    expect(report.userId).to.equal(null);
    expect(report.message).to.equal("Laser schneidet nicht");

    // Audit purge removed the historical entries (users/u1 + redacted co-other).
    expect((await db.collection("audit_log").get()).size).to.equal(0);

    // Receipt complete and PII-free.
    const receipt = (await db.doc("erasures/u1").get()).data()!;
    expect(receipt.phase).to.equal("done");
    expect(JSON.stringify(receipt)).to.not.include("example.com");
    expect(JSON.stringify(receipt)).to.not.include("Erika");

    // Second run: idempotent, purges nothing new, reports rerunOnly.
    const again = await eraseSubject({ uid: "u1" }, deps());
    expect(again.rerunOnly).to.equal(true);
    expect(again.auditPurged).to.equal(0);
  });

  it("re-run removes late trigger-race audit entries", async () => {
    await seedGraph();
    await eraseSubject({ uid: "u1" }, deps());
    // Simulate the async audit trigger landing AFTER phase B ran.
    await db.collection("audit_log").add({
      collection: "checkouts",
      docId: "co-own",
      operation: "delete",
      actorUid: null,
      before: { persons: [{ name: "Erika Muster", email: "u1@example.com" }] },
      after: null,
      timestamp: Timestamp.now(),
    });
    const rerun = await eraseSubject({ uid: "u1" }, deps());
    expect(rerun.rerunOnly).to.equal(true);
    expect(rerun.auditPurged).to.equal(1);
    expect((await db.collection("audit_log").get()).size).to.equal(0);
  });

  for (const [name, seed] of Object.entries({
    "open checkout": async (db2: admin.firestore.Firestore) => {
      await db2.doc("checkouts/co-open").set({
        userId: db2.doc("users/u1"),
        status: "open",
        usageType: "regular",
        created: Timestamp.now(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: null,
        modifiedAt: Timestamp.now(),
      });
    },
    "unpaid bill": async (db2: admin.firestore.Firestore) => {
      await db2.doc("bills/b-open").set({
        userId: db2.doc("users/u1"),
        referenceNumber: 260101,
        amount: 20,
        currency: "CHF",
        created: Timestamp.now(),
        paidAt: null,
        paidVia: null,
      });
    },
    "active owned membership": async (db2: admin.firestore.Firestore) => {
      await db2.doc("memberships/m-u1").set({
        type: "single",
        status: "active",
        lastPaidAt: null,
        validUntil: ts("2027-01-01T00:00:00Z"),
        ownerUserId: db2.doc("users/u1"),
        members: [db2.doc("users/u1")],
        paymentCheckouts: [],
      });
    },
  })) {
    it(`refuses with failed-precondition and zero writes: ${name}`, async () => {
      await seedGraph();
      await seed(db);
      const err = (await expectHttpsError(
        eraseSubject({ uid: "u1" }, deps()),
        "failed-precondition"
      )) as { details?: { blockers?: unknown[] } };
      expect(err.details?.blockers).to.have.length.greaterThan(0);
      // Zero writes: user + receipt untouched.
      expect((await db.doc("users/u1").get()).exists).to.equal(true);
      expect((await db.doc("erasures/u1").get()).exists).to.equal(false);
      expect((await db.doc("checkouts/co-own").get()).exists).to.equal(true);
    });
  }

  it("erases an anonymous walk-in by email (persons[] redaction only)", async () => {
    await seedGraph();
    await db.doc("checkouts/co-walkin").set({
      userId: db.doc("users/u2"),
      status: "closed",
      usageType: "regular",
      created: ts("2026-07-03T10:00:00Z"),
      closedAt: ts("2026-07-03T12:00:00Z"),
      workshopsVisited: [],
      persons: [
        { name: "Other Person", email: "u2@example.com", userType: "erwachsen" },
        {
          name: "Walk In",
          email: "walkin@example.com",
          userType: "erwachsen",
          billingAddress: { company: "", street: "Weg 1", zip: "8820", city: "Wädenswil" },
        },
      ],
      modifiedBy: null,
      modifiedAt: ts("2026-07-03T12:00:00Z"),
    });

    const outcome = await eraseSubject({ email: "walkin@example.com" }, deps());
    expect(outcome.kind).to.equal("walk-in");
    expect(outcome.subjectId).to.equal(subjectKey(SALT, "walkin@example.com"));

    const doc = (await db.doc("checkouts/co-walkin").get()).data()!;
    expect(doc.persons[0].email).to.equal("u2@example.com"); // untouched
    expect(doc.persons[1].name).to.equal("");
    expect(doc.persons[1].email).to.equal("");
    expect(doc.persons[1].billingAddress).to.equal(undefined);
    // Checkout itself + unrelated subject graph fully intact.
    expect((await db.doc("users/u1").get()).exists).to.equal(true);
    expect((await db.doc("checkouts/co-own").get()).exists).to.equal(true);
    // Receipt keyed by HMAC(email), not the raw address.
    const receipts = await db.collection("erasures").get();
    expect(receipts.size).to.equal(1);
    expect(receipts.docs[0].id).to.equal(subjectKey(SALT, "walkin@example.com"));
    expect(JSON.stringify(receipts.docs[0].data())).to.not.include("walkin@");
  });

  it("dryRun returns the action plan without writing", async () => {
    await seedGraph();
    const outcome = await eraseSubject({ uid: "u1" }, deps(), { dryRun: true });
    expect(outcome.dryRun).to.equal(true);
    expect(outcome.counts.checkouts).to.equal(1);
    expect(outcome.counts.tokens).to.equal(1);
    expect(outcome.counts.users).to.equal(1);
    expect(outcome.actions.length).to.be.greaterThan(5);
    expect((await db.doc("users/u1").get()).exists).to.equal(true);
    expect((await db.doc("erasures/u1").get()).exists).to.equal(false);
    expect((await getBucket().file("invoices/b1.pdf").exists())[0]).to.equal(true);
  });

  it("handler enforces admin claim and confirmEmail", async () => {
    await seedGraph();
    await expectHttpsError(
      privacyEraseHandler(callable({ uid: "u1" }, false)),
      "permission-denied"
    );
    await expectHttpsError(
      privacyEraseHandler(callable({ uid: "u1", confirmEmail: "wrong@example.com" })),
      "invalid-argument"
    );
    // dryRun needs no confirmEmail.
    const dry = (await privacyEraseHandler(
      callable({ uid: "u1", dryRun: true })
    )) as { dryRun: boolean };
    expect(dry.dryRun).to.equal(true);
  });
});
