// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for the Workspace group sync
 * (functions/src/usage_groups/sync_usage_groups.ts, ADR-0053): Workspace
 * membership lands on `users.usageGroups`, by e-mail, and only changes are
 * written.
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
import { runUsageGroupSync } from "../../src/usage_groups/sync_usage_groups";
import type { GroupDirectory } from "../../src/usage_groups/directory";

const VOL = "freiwillige@example.org";
const INTERN = "intern@example.org";

function directory(groups: Record<string, string[]>): GroupDirectory {
  return { memberEmails: async (g) => groups[g] ?? [] };
}

async function seedUser(
  id: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await getFirestore()
    .collection("users")
    .doc(id)
    .set({
      firstName: id,
      lastName: "Test",
      email: `${id}@example.org`,
      roles: [],
      permissions: [],
      ...data,
    });
}

async function groupsOf(id: string): Promise<unknown> {
  const snap = await getFirestore().collection("users").doc(id).get();
  return snap.data()?.usageGroups;
}

describe("runUsageGroupSync (integration)", function () {
  this.timeout(20000);

  before(async () => {
    await setupEmulator();
  });
  beforeEach(async () => {
    await clearFirestore();
  });
  after(async () => {
    await teardownEmulator();
  });

  it("puts accounts in their groups by e-mail and lists unmatched addresses", async () => {
    await seedUser("anna");
    await seedUser("ben");
    await seedUser("cleo");
    const report = await runUsageGroupSync({
      db: getFirestore(),
      directory: directory({
        [VOL]: ["anna@example.org", "ben@example.org", "nobody@gmail.com"],
        [INTERN]: ["ben@example.org"],
      }),
      groupEmails: { volunteering: VOL, intern: INTERN },
    });

    expect(await groupsOf("anna")).to.deep.equal(["volunteering"]);
    expect(await groupsOf("ben")).to.deep.equal(["volunteering", "intern"]);
    expect(await groupsOf("cleo")).to.equal(undefined);
    expect(report.changed).to.equal(2);
    expect(report.groups.find((g) => g.group === "volunteering")).to.deep.include({
      members: 3,
      unmatched: ["nobody@gmail.com"],
    });
  });

  it("matches addresses case-insensitively", async () => {
    await seedUser("anna");
    await runUsageGroupSync({
      db: getFirestore(),
      directory: directory({ [VOL]: [" Anna@Example.org "] }),
      groupEmails: { volunteering: VOL, intern: INTERN },
    });
    expect(await groupsOf("anna")).to.deep.equal(["volunteering"]);
  });

  it("takes a group away from an account no longer in it", async () => {
    await seedUser("anna", { usageGroups: ["volunteering", "intern"] });
    await seedUser("ben", { usageGroups: ["intern"] });
    const report = await runUsageGroupSync({
      db: getFirestore(),
      directory: directory({ [VOL]: ["anna@example.org"], [INTERN]: [] }),
      groupEmails: { volunteering: VOL, intern: INTERN },
    });
    expect(await groupsOf("anna")).to.deep.equal(["volunteering"]);
    expect(await groupsOf("ben")).to.equal(undefined);
    expect(report.changed).to.equal(2);
  });

  it("leaves a group whose address isn't configured as it is", async () => {
    await seedUser("anna", { usageGroups: ["intern"] });
    const report = await runUsageGroupSync({
      db: getFirestore(),
      directory: directory({ [VOL]: [] }),
      groupEmails: { volunteering: VOL, intern: "" },
    });
    expect(await groupsOf("anna")).to.deep.equal(["intern"]);
    expect(report.changed).to.equal(0);
    expect(report.groups.find((g) => g.group === "intern")?.groupEmail).to.equal(null);
  });

  it("writes nothing when nothing changed", async () => {
    await seedUser("anna", { usageGroups: ["volunteering"] });
    const report = await runUsageGroupSync({
      db: getFirestore(),
      directory: directory({ [VOL]: ["anna@example.org"] }),
      groupEmails: { volunteering: VOL, intern: INTERN },
    });
    expect(report.changed).to.equal(0);
  });

  it("reports whether each volunteer holds an active membership (ADM-14)", async () => {
    const db = getFirestore();
    const memRef = db.collection("memberships").doc("m1");
    await memRef.set({
      status: "active",
      members: [db.collection("users").doc("anna")],
      validUntil: Timestamp.fromMillis(Date.now() + 86_400_000),
    });
    await seedUser("anna", { activeMembership: memRef });
    await seedUser("ben");
    const report = await runUsageGroupSync({
      db,
      directory: directory({ [VOL]: ["anna@example.org", "ben@example.org"] }),
      groupEmails: { volunteering: VOL, intern: INTERN },
    });
    const member = Object.fromEntries(report.accounts.map((a) => [a.userId, a.member]));
    expect(member).to.deep.equal({ anna: true, ben: false });
  });
});
