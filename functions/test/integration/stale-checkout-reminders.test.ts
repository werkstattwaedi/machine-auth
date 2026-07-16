// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Regression coverage for the scheduled
 * `staleCheckoutReminders` cron (issue #531).
 *
 * The Functions emulator is NOT started here — we invoke
 * `runStaleCheckoutReminders(now)` directly against the Firestore emulator
 * with a frozen clock, so the test is independent of the scheduler runtime
 * (mirrors cleanup-abandoned-checkouts.test.ts). `FUNCTIONS_EMULATOR` is
 * forced on before imports so `sendTemplate` never actually mails — the send
 * branch logs instead, and we assert on the persisted `remindersSent` stamps.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { runStaleCheckoutReminders } from "../../src/checkout/stale_checkout_reminders";
import type {
  CheckoutEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

// Fixed clock: 2026-06-10 11:00 Zurich. Business day boundary is
// 2026-06-10 03:00 Zurich (= 01:00 UTC), so anything created before that is
// stale by >=1 business day.
const NOW = new Date("2026-06-10T09:00:00Z");

/** A UTC instant at 18:00 Zurich on 2026-06-(day). */
function openedOn(day: number): Timestamp {
  return Timestamp.fromDate(new Date(`2026-06-${String(day).padStart(2, "0")}T16:00:00Z`));
}

async function seedUser(id: string, email: string | null): Promise<void> {
  const db = getFirestore();
  const user: Partial<UserEntity> = {
    created: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
    firstName: "Test",
    lastName: id,
    email,
    permissions: [],
    roles: [],
  };
  await db.collection("users").doc(id).set(user);
}

interface SeedCheckoutOpts {
  status?: "open" | "closed";
  created: Timestamp;
  userId: string | null;
  remindersSent?: Timestamp[];
}

async function seedCheckout(id: string, opts: SeedCheckoutOpts): Promise<void> {
  const db = getFirestore();
  const userRef = opts.userId ? db.doc(`users/${opts.userId}`) : null;
  const checkout: CheckoutEntity & { remindersSent?: Timestamp[] } = {
    userId: userRef as CheckoutEntity["userId"],
    status: opts.status ?? "open",
    usageType: "regular",
    created: opts.created,
    workshopsVisited: ["holz"],
    persons: [{ name: "Test Person", email: "person@test.localhost", userType: "erwachsen" }],
    modifiedBy: null,
    modifiedAt: opts.created,
    firebaseUid: opts.userId ?? null,
  };
  if (opts.remindersSent) checkout.remindersSent = opts.remindersSent;
  await db.collection("checkouts").doc(id).set(checkout);
}

async function getRemindersSent(id: string): Promise<Timestamp[]> {
  const snap = await getFirestore().collection("checkouts").doc(id).get();
  return (snap.data()?.remindersSent as Timestamp[] | undefined) ?? [];
}

describe("runStaleCheckoutReminders (#531)", () => {
  before(async function () {
    this.timeout(20000);
    await setupEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await seedUser("u-member", "member@test.localhost");
    await seedUser("u-child", null); // child account: no email
  });

  after(async () => {
    await teardownEmulator();
  });

  it("does not remind an open checkout created the same business day", async () => {
    // 09:00 Zurich today — after the 03:00 boundary, so staleDays == 0. The
    // indexed `created < businessDayStart` prefilter excludes it entirely.
    await seedCheckout("co-today", {
      created: Timestamp.fromDate(new Date("2026-06-10T07:00:00Z")),
      userId: "u-member",
    });

    const summary = await runStaleCheckoutReminders(NOW);

    expect(summary.remindersSent).to.equal(0);
    expect(await getRemindersSent("co-today")).to.have.length(0);
  });

  it("reminds an open checkout stale by the first offset (day 1)", async () => {
    await seedCheckout("co-stale1", {
      created: openedOn(9), // one business day before NOW
      userId: "u-member",
    });

    const summary = await runStaleCheckoutReminders(NOW);

    expect(summary.remindersSent).to.equal(1);
    expect(await getRemindersSent("co-stale1")).to.have.length(1);
  });

  it("is idempotent: a same-day re-run sends nothing more", async () => {
    await seedCheckout("co-stale1", {
      created: openedOn(9),
      userId: "u-member",
    });

    await runStaleCheckoutReminders(NOW);
    const summary2 = await runStaleCheckoutReminders(NOW);

    expect(summary2.remindersSent).to.equal(0);
    expect(await getRemindersSent("co-stale1")).to.have.length(1);
  });

  it("fires the second offset (day 7) once its threshold is reached", async () => {
    await seedCheckout("co-stale7", {
      created: openedOn(3), // seven business days before NOW
      userId: "u-member",
      remindersSent: [openedOn(4)], // day-1 reminder already sent earlier
    });

    const summary = await runStaleCheckoutReminders(NOW);

    expect(summary.remindersSent).to.equal(1);
    expect(await getRemindersSent("co-stale7")).to.have.length(2);
  });

  it("does not remind a closed checkout, however old", async () => {
    await seedCheckout("co-closed", {
      status: "closed",
      created: openedOn(1),
      userId: "u-member",
    });

    const summary = await runStaleCheckoutReminders(NOW);

    expect(summary.remindersSent).to.equal(0);
    expect(await getRemindersSent("co-closed")).to.have.length(0);
  });

  it("skips an anonymous (userId == null) checkout without stamping", async () => {
    await seedCheckout("co-anon", {
      created: openedOn(9),
      userId: null,
    });

    const summary = await runStaleCheckoutReminders(NOW);

    expect(summary.remindersSent).to.equal(0);
    expect(summary.skippedNoEmail).to.equal(1);
    expect(await getRemindersSent("co-anon")).to.have.length(0);
  });

  it("skips an account holder with no email without stamping", async () => {
    await seedCheckout("co-childless", {
      created: openedOn(9),
      userId: "u-child", // email: null
    });

    const summary = await runStaleCheckoutReminders(NOW);

    expect(summary.remindersSent).to.equal(0);
    expect(summary.skippedNoEmail).to.equal(1);
    // No stamp: a later email addition still lets the next run reach them.
    expect(await getRemindersSent("co-childless")).to.have.length(0);
  });
});
