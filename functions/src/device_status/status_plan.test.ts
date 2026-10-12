// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The write budget and the alerts both hang on planStatusUpdate (ADR-0045,
// phase 2c): a report every 5 minutes must not become a write every 5
// minutes, and a terminal dropping out must be written (and logged) at once.

import { expect } from "chai";

import {
  type DeviceState,
  GATEWAY_SETTLE_MS,
  InvalidReport,
  parseGatewayReport,
  planStatusUpdate,
  REFRESH_MS,
  resetReasonName,
  type StoredStatus,
  terminalHeardAt,
  terminalState,
} from "./status_plan";

const T0 = Date.parse("2026-10-12T08:00:00Z");
const MIN = 60 * 1000;

const state: DeviceState = {
  version: "2026.10.3",
  online: true,
  bootedAt: T0 - 60 * MIN,
  resetReason: "power_cycle",
  bootCount: 1,
};

function stored(overrides: Partial<StoredStatus> = {}): StoredStatus {
  return { ...state, firstSeen: T0, lastSeen: T0, since: T0, rebootWrittenAt: null, ...overrides };
}

describe("planStatusUpdate", () => {
  it("writes a device the first time it is seen", () => {
    const plan = planStatusUpdate(undefined, state, T0);
    expect(plan.write).to.equal(true);
    expect(plan.events).to.deep.equal(["first_seen"]);
    expect(plan.doc).to.include({ firstSeen: T0, lastSeen: T0, since: T0 });
  });

  it("does not write an unchanged report within the hour", () => {
    for (let m = 5; m < 60; m += 5) {
      const plan = planStatusUpdate(stored(), state, T0 + m * MIN);
      expect(plan.write, `after ${m} min`).to.equal(false);
      expect(plan.events).to.deep.equal([]);
    }
  });

  it("refreshes lastSeen once the hour is up", () => {
    const plan = planStatusUpdate(stored(), state, T0 + REFRESH_MS);
    expect(plan.write).to.equal(true);
    expect(plan.events).to.deep.equal([]);
    expect(plan.doc.lastSeen).to.equal(T0 + REFRESH_MS);
  });

  it("writes going offline and coming back at once, and remembers since when", () => {
    const off = planStatusUpdate(stored(), { ...state, online: false }, T0 + 5 * MIN);
    expect(off.write).to.equal(true);
    expect(off.events).to.deep.equal(["offline"]);
    expect(off.doc.since).to.equal(T0 + 5 * MIN);

    const on = planStatusUpdate(off.doc, state, T0 + 7 * MIN);
    expect(on.write).to.equal(true);
    expect(on.events).to.deep.equal(["online"]);
    expect(on.doc.since).to.equal(T0 + 7 * MIN);
  });

  it("writes a new version at once", () => {
    const plan = planStatusUpdate(stored(), { ...state, version: "2026.10.4" }, T0 + 5 * MIN);
    expect(plan.write).to.equal(true);
    expect(plan.events).to.deep.equal(["version"]);
  });

  it("writes a reboot at once, but at most one per hour (crash loop)", () => {
    const first = planStatusUpdate(
      stored(),
      { ...state, bootedAt: T0 + 4 * MIN, resetReason: "watchdog" },
      T0 + 5 * MIN
    );
    expect(first.write).to.equal(true);
    expect(first.events).to.deep.equal(["reboot"]);
    expect(first.doc.rebootWrittenAt).to.equal(T0 + 5 * MIN);

    // Rebooting again ten minutes later: coalesced — no write, no event.
    const second = planStatusUpdate(
      first.doc,
      { ...state, bootedAt: T0 + 14 * MIN, bootCount: 2 },
      T0 + 15 * MIN
    );
    expect(second.write).to.equal(false);
    expect(second.events).to.deep.equal([]);

    // The hourly refresh then writes the latest boot, once.
    const later = planStatusUpdate(
      first.doc,
      { ...state, bootedAt: T0 + 60 * MIN, bootCount: 7 },
      T0 + 5 * MIN + REFRESH_MS
    );
    expect(later.write).to.equal(true);
    expect(later.events).to.deep.equal(["reboot"]);
    expect(later.doc.bootCount).to.equal(7);
  });

  it("treats small boot-time differences as the same boot", () => {
    const plan = planStatusUpdate(stored(), { ...state, bootedAt: state.bootedAt! + MIN }, T0 + 5 * MIN);
    expect(plan.write).to.equal(false);
  });

  it("stores when the device was last heard, not when it was reported", () => {
    const plan = planStatusUpdate(undefined, state, T0, T0 - 10_000);
    expect(plan.doc.lastSeen).to.equal(T0 - 10_000);
  });

  it("does not refresh an offline device: a dead terminal must not look alive", () => {
    const off = planStatusUpdate(stored(), { ...state, online: false }, T0 + MIN, T0);
    expect(off.write).to.equal(true);
    expect(off.doc.lastSeen).to.equal(T0); // its last ping
    for (const hours of [1, 2, 10]) {
      const later = planStatusUpdate(off.doc, { ...state, online: false }, T0 + hours * REFRESH_MS, T0);
      expect(later.write, `after ${hours} h`).to.equal(false);
    }
  });

  it("keeps lastSeen when nobody heard the device (restarted gateway)", () => {
    const plan = planStatusUpdate(stored({ lastSeen: T0 }), { ...state, online: false }, T0 + 5 * MIN, null);
    expect(plan.write).to.equal(true);
    expect(plan.doc.lastSeen).to.equal(T0);
  });

  it("keeps fields an older sender doesn't report", () => {
    const plan = planStatusUpdate(
      stored(),
      { version: null, online: true, bootedAt: null, resetReason: null, bootCount: null },
      T0 + REFRESH_MS
    );
    expect(plan.events).to.deep.equal([]);
    expect(plan.doc).to.include({ version: "2026.10.3", resetReason: "power_cycle", bootCount: 1 });
  });
});

describe("parseGatewayReport", () => {
  const terminal = {
    deviceId: "0a10aced202194944a042f04",
    version: "2026.10.3",
    online: true,
    uptimeMs: 3_600_000,
    lastPingAgoMs: 10_000,
    resetReason: 3,
    bootCount: 1,
  };
  const report = { gateway: { id: "workshop", version: "2026.10.3", uptimeMs: 600_000 }, terminals: [terminal] };

  it("accepts a well-formed report", () => {
    const parsed = parseGatewayReport(report);
    expect(parsed.gatewayId).to.equal("workshop");
    expect(parsed.terminals[0]).to.deep.equal(terminal);
    expect(parsed.problems).to.deep.equal([]);
  });

  it("accepts terminals on old firmware that report no status", () => {
    const parsed = parseGatewayReport({
      ...report,
      terminals: [{ deviceId: terminal.deviceId, online: true, version: "" }],
    });
    expect(parsed.terminals[0]).to.include({ version: null, uptimeMs: null, bootCount: null });
  });

  for (const [name, body] of [
    ["a path-like gateway id", { ...report, gateway: { ...report.gateway, id: "../users" } }],
    ["a missing gateway uptime", { ...report, gateway: { id: "workshop" } }],
    ["an absurd gateway uptime", { ...report, gateway: { ...report.gateway, uptimeMs: 1e300 } }],
    ["no terminals array", { gateway: report.gateway }],
  ] as const) {
    it(`rejects ${name}`, () => {
      expect(() => parseGatewayReport(body)).to.throw(InvalidReport);
    });
  }

  it("drops a terminal's bad fields instead of the whole report", () => {
    // One odd firmware build must not silence every device's heartbeat.
    const other = { ...terminal, deviceId: "0a10aced202194944a042f05" };
    const parsed = parseGatewayReport({
      ...report,
      terminals: [{ ...terminal, version: "custom build/1", bootCount: -1, uptimeMs: 1e300 }, other],
    });
    expect(parsed.terminals).to.have.length(2);
    expect(parsed.terminals[0]).to.include({ version: null, bootCount: null, uptimeMs: null, online: true });
    expect(parsed.terminals[1]).to.deep.equal(other);
    expect(parsed.problems).to.have.length(3);
  });

  it("skips terminals without a usable id, duplicates and missing online flags", () => {
    const parsed = parseGatewayReport({
      ...report,
      terminals: [
        { ...terminal, deviceId: "users/abc" },
        terminal,
        terminal,
        { ...terminal, deviceId: "0a10aced202194944a042f05", online: "yes" },
      ],
    });
    expect(parsed.terminals.map((t) => t.deviceId)).to.deep.equal([terminal.deviceId]);
    expect(parsed.problems).to.have.length(3);
    // The one with the bad online flag was still mentioned — alive.
    expect(parsed.skippedIds).to.deep.equal(["0a10aced202194944a042f05"]);
  });

  it("counts terminals beyond the limit as mentioned, not as gone", () => {
    const many = Array.from({ length: 52 }, (_, i) => ({
      ...terminal,
      deviceId: (BigInt("0x0a10aced202194944a040000") + BigInt(i)).toString(16).padStart(24, "0"),
    }));
    const parsed = parseGatewayReport({ ...report, terminals: many });
    expect(parsed.terminals).to.have.length(50);
    expect(parsed.skippedIds).to.have.length(2);
  });

  it("dates a terminal's last ping from its age, or now while it is online", () => {
    const base = parseGatewayReport(report).terminals[0];
    expect(terminalHeardAt(base, T0)).to.equal(T0 - 10_000);
    expect(terminalHeardAt({ ...base, lastPingAgoMs: null }, T0)).to.equal(T0);
    expect(terminalHeardAt({ ...base, lastPingAgoMs: null, online: false }, T0)).to.equal(null);
  });
});

describe("terminalState", () => {
  it("dates the boot from ages, not from the gateway's clock", () => {
    const s = terminalState(
      {
        deviceId: "0a10aced202194944a042f04",
        version: "2026.10.3",
        online: true,
        uptimeMs: 60 * MIN,
        lastPingAgoMs: 10_000,
        resetReason: 1,
        bootCount: 2,
      },
      T0
    );
    expect(s.bootedAt).to.equal(T0 - 10_000 - 60 * MIN);
    expect(s.resetReason).to.equal("watchdog");
  });

  it("names reset reasons and maps unknown values to unknown", () => {
    expect(resetReasonName(2)).to.equal("panic");
    expect(resetReasonName(99)).to.equal("unknown");
    expect(resetReasonName(null)).to.equal(null);
  });

  it("gives the gateway time to hear from every live terminal", () => {
    // Terminals ping every 15 s; the settle window covers several pings.
    expect(GATEWAY_SETTLE_MS).to.be.greaterThan(4 * 15_000);
  });
});
