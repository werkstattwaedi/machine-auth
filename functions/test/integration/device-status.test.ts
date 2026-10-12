// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Gateway status reports against Firestore (ADR-0045, phase 2c): status
 * documents land in the `status` subcollections, unchanged reports cost no
 * writes, and a terminal the gateway stops mentioning is marked offline
 * once the gateway has settled.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { applyGatewayReport, statusRef } from "../../src/device_status/handle_device_status";
import type { GatewayReport, TerminalReport } from "../../src/device_status/status_plan";

const T0 = Date.parse("2026-10-12T08:00:00Z");
const MIN = 60 * 1000;
const A = "0a10aced202194944a042f04";
const B = "0a10aced202194944a042f05";

function terminal(deviceId: string, overrides: Partial<TerminalReport> = {}): TerminalReport {
  return {
    deviceId,
    version: "2026.10.3",
    online: true,
    uptimeMs: 60 * MIN,
    lastPingAgoMs: 5_000,
    resetReason: 3,
    bootCount: 1,
    ...overrides,
  };
}

function report(terminals: TerminalReport[], uptimeMs = 30 * MIN): GatewayReport {
  return { gatewayId: "workshop", version: "2026.10.3", uptimeMs, terminals, problems: [], skippedIds: [] };
}

describe("device status reports (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
  });

  it("writes terminal and gateway status into their status subcollections", async () => {
    const db = getFirestore();
    const { writes } = await applyGatewayReport(report([terminal(A)]), T0, db);
    expect(writes).to.equal(2);

    const t = (await statusRef(db, "maco", A).get()).data()!;
    expect(t).to.include({
      kind: "maco",
      deviceId: A,
      version: "2026.10.3",
      online: true,
      resetReason: "power_cycle",
      gatewayId: "workshop",
    });
    expect(t.bootedAt.toMillis()).to.equal(T0 - 5_000 - 60 * MIN);
    expect(t.lastSeen.toMillis()).to.equal(T0 - 5_000); // its last ping

    const g = (await statusRef(db, "gateways", "workshop").get()).data()!;
    expect(g.terminals).to.deep.equal([A]);
    // The terminal's registration doc is untouched (and stays unaudited).
    expect((await db.collection("maco").doc(A).get()).exists).to.equal(false);
  });

  it("costs no writes for an unchanged report within the hour", async () => {
    const db = getFirestore();
    await applyGatewayReport(report([terminal(A)]), T0, db);
    // Same boot: uptime grew by the 5 minutes that passed.
    const again = await applyGatewayReport(
      report([terminal(A, { uptimeMs: 65 * MIN })], 35 * MIN),
      T0 + 5 * MIN,
      db
    );
    expect(again.writes).to.equal(0);
  });

  it("writes a terminal going offline at once", async () => {
    const db = getFirestore();
    await applyGatewayReport(report([terminal(A)]), T0, db);
    const { writes } = await applyGatewayReport(
      report([terminal(A, { online: false, lastPingAgoMs: 65_000, uptimeMs: 60 * MIN })], 31 * MIN),
      T0 + MIN,
      db
    );
    expect(writes).to.equal(2); // terminal + the gateway's online list
    const t = (await statusRef(db, "maco", A).get()).data()!;
    expect(t.online).to.equal(false);
    expect(t.since.toMillis()).to.equal(T0 + MIN);
    const g = (await statusRef(db, "gateways", "workshop").get()).data()!;
    expect(g.terminals).to.deep.equal([]);

    // Still offline hours later: nothing to write, lastSeen stays at the
    // last ping.
    const later = await applyGatewayReport(
      report([terminal(A, { online: false, lastPingAgoMs: 3 * 60 * MIN + 65_000 })], 3 * 60 * MIN),
      T0 + 3 * 60 * MIN + MIN,
      db
    );
    expect(later.writes).to.equal(1); // the gateway's own hourly refresh
    expect((await statusRef(db, "maco", A).get()).data()!.lastSeen.toMillis()).to.equal(T0 - 5_000);
  });

  it("marks a terminal offline that a restarted gateway never hears from again", async () => {
    const db = getFirestore();
    await applyGatewayReport(report([terminal(A), terminal(B)]), T0, db);

    // Gateway restarted 30 s ago and has only heard from A so far: B may
    // still be reconnecting — keep it.
    await applyGatewayReport(report([terminal(A, { uptimeMs: 61 * MIN })], 30_000), T0 + MIN, db);
    expect((await statusRef(db, "maco", B).get()).data()!.online).to.equal(true);
    expect((await statusRef(db, "gateways", "workshop").get()).data()!.terminals).to.deep.equal([A, B]);

    // B mentioned but unreadable (e.g. a bad online flag): alive, kept.
    await applyGatewayReport(
      { ...report([terminal(A, { uptimeMs: 63 * MIN })], 3 * MIN), skippedIds: [B] },
      T0 + 3 * MIN,
      db
    );
    expect((await statusRef(db, "maco", B).get()).data()!.online).to.equal(true);
    expect((await statusRef(db, "gateways", "workshop").get()).data()!.terminals).to.deep.equal([A, B]);

    // Five minutes in, B is still silent: offline.
    await applyGatewayReport(report([terminal(A, { uptimeMs: 65 * MIN })], 5 * MIN), T0 + 5 * MIN, db);
    expect((await statusRef(db, "maco", B).get()).data()!.online).to.equal(false);
    expect((await statusRef(db, "gateways", "workshop").get()).data()!.terminals).to.deep.equal([A]);
  });
});
