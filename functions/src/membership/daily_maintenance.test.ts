// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { runDailyMembershipMaintenance } from "./daily_maintenance";

describe("runDailyMembershipMaintenance", () => {
  it("runs both steps in order", async () => {
    const calls: string[] = [];
    await runDailyMembershipMaintenance({
      expiryCheck: async () => {
        calls.push("expiry");
      },
      renewalInvoicer: async () => {
        calls.push("renewal");
      },
    });
    expect(calls).to.deep.equal(["expiry", "renewal"]);
  });

  it("still runs the renewal invoicer when the expiry check throws, then rethrows", async () => {
    const calls: string[] = [];
    const boom = new Error("expiry boom");
    let thrown: unknown;
    try {
      await runDailyMembershipMaintenance({
        expiryCheck: async () => {
          throw boom;
        },
        renewalInvoicer: async () => {
          calls.push("renewal");
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(calls).to.deep.equal(["renewal"]);
    expect(thrown).to.equal(boom);
  });

  it("surfaces a renewal failure to the scheduler after a clean expiry step", async () => {
    const boom = new Error("renewal boom");
    let thrown: unknown;
    try {
      await runDailyMembershipMaintenance({
        expiryCheck: async () => {},
        renewalInvoicer: async () => {
          throw boom;
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.equal(boom);
  });

  it("rethrows the first failure when both steps throw", async () => {
    const first = new Error("first");
    let thrown: unknown;
    try {
      await runDailyMembershipMaintenance({
        expiryCheck: async () => {
          throw first;
        },
        renewalInvoicer: async () => {
          throw new Error("second");
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.equal(first);
  });
});
