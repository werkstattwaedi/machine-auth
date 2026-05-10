// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression for issue #207: legacy `displayName` on a user doc must NOT
 * take priority in `resolveInviterName`. Even when stale data still
 * carries `displayName: "MikeS"`, the resolved label must be the full
 * `firstName lastName`.
 */

import { expect } from "chai";
import type { DocumentReference } from "firebase-admin/firestore";
import { resolveInviterName } from "../../src/membership/invite";

function fakeRef(data: Record<string, unknown> | null): DocumentReference {
  return {
    get: async () => ({
      exists: data !== null,
      data: () => data ?? undefined,
    }),
  } as unknown as DocumentReference;
}

describe("resolveInviterName — issue #207 regression", () => {
  it("uses firstName+lastName even when legacy displayName is set", async () => {
    const ref = fakeRef({
      displayName: "MikeS", // legacy nickname — must be ignored
      firstName: "Michael",
      lastName: "Schneider",
      email: "michael@example.com",
    });

    const name = await resolveInviterName(ref);
    expect(name).to.equal("Michael Schneider");
    expect(name).to.not.equal("MikeS");
  });

  it("falls back to email local-part when firstName+lastName are blank", async () => {
    const ref = fakeRef({
      firstName: "",
      lastName: "",
      email: "anna@example.com",
    });
    expect(await resolveInviterName(ref)).to.equal("anna");
  });

  it("falls back to 'Jemand' when nothing usable is set", async () => {
    const ref = fakeRef({
      firstName: "",
      lastName: "",
      email: null,
    });
    expect(await resolveInviterName(ref)).to.equal("Jemand");
  });

  it("returns 'Jemand' when the user doc does not exist", async () => {
    const ref = fakeRef(null);
    expect(await resolveInviterName(ref)).to.equal("Jemand");
  });
});
