// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// uploadTestUsage bills machine time without a terminal. These tests pin the
// guards that keep that on staging and on smoke-test accounts, and the shape
// of the request it hands to the real usage-upload path.

import { expect } from "chai";
import type { UploadUsageRequest } from "../proto/firebase_rpc/usage.js";
import { STAGING_PROJECT_ID } from "./staging_guard";
import {
  handleUploadTestUsage,
  SMOKE_EMAIL_PREFIX,
  type UploadTestUsageDeps,
} from "./upload_test_usage";

const ENV = { projectId: STAGING_PROJECT_ID, bearerKey: "staging-kiosk-bearer" };
const NOW = 1_800_000_000;
const OK_INPUT = {
  uid: "smoke-uid",
  machineId: "laser-1",
  activeSeconds: 600,
  bearer: ENV.bearerKey,
};

function fakeDeps(overrides: Partial<UploadTestUsageDeps> = {}) {
  const uploads: UploadUsageRequest[] = [];
  const lookups: string[] = [];
  const deps: UploadTestUsageDeps = {
    userEmail: async (uid) => {
      lookups.push(uid);
      return `${SMOKE_EMAIL_PREFIX}run1-member@werkstatt-waedi.ch`;
    },
    machineExists: async () => true,
    upload: async (request) => {
      uploads.push(request);
    },
    nowSeconds: () => NOW,
    ...overrides,
  };
  return { deps, uploads, lookups };
}

describe("uploadTestUsage", () => {
  it("reports one finished session to the real upload path", async () => {
    const { deps, uploads } = fakeDeps();

    const result = await handleUploadTestUsage(OK_INPUT, ENV, deps);

    expect(result.status).to.equal(200);
    expect(uploads).to.have.length(1);
    const history = uploads[0].history!;
    expect(history.machineId).to.deep.equal({ value: "laser-1" });
    expect(history.records).to.have.length(1);
    const record = history.records[0];
    expect(record.userId).to.deep.equal({ value: "smoke-uid" });
    expect(record.activeSeconds).to.equal(600);
    // Unix SECONDS, as a terminal reports them; idle time on top by default.
    expect(record.checkOut).to.equal(BigInt(NOW));
    expect(record.checkIn).to.equal(BigInt(NOW - 660));
    expect(record.reason?.reason?.$case).to.equal("ui");
    expect(record.authenticationId?.value).to.match(/^smoke-[0-9a-f]{16}$/);
    expect(result.body).to.deep.equal({
      authenticationId: record.authenticationId!.value,
      checkIn: NOW - 660,
      checkOut: NOW,
    });
  });

  it("gives each call its own authentication id, so repeats add up", async () => {
    const { deps, uploads } = fakeDeps();

    await handleUploadTestUsage(OK_INPUT, ENV, deps);
    await handleUploadTestUsage(OK_INPUT, ENV, deps);

    const ids = uploads.map((u) => u.history!.records[0].authenticationId!.value);
    expect(ids[0]).to.not.equal(ids[1]);
  });

  it("takes an explicit wall-clock length", async () => {
    const { deps, uploads } = fakeDeps();

    await handleUploadTestUsage({ ...OK_INPUT, wallClockSeconds: 3600 }, ENV, deps);

    expect(uploads[0].history!.records[0].checkIn).to.equal(BigInt(NOW - 3600));
  });

  describe("guard 1 — staging only", () => {
    for (const projectId of ["oww-maco", "oww-maco-staging-2", "", undefined]) {
      it(`answers 404 in project ${JSON.stringify(projectId)} without touching data`, async () => {
        const { deps, uploads, lookups } = fakeDeps();

        const result = await handleUploadTestUsage(
          OK_INPUT,
          { ...ENV, projectId },
          deps
        );

        expect(result.status).to.equal(404);
        expect(lookups).to.deep.equal([]);
        expect(uploads).to.deep.equal([]);
      });
    }
  });

  describe("guard 2 — the staging kiosk bearer", () => {
    for (const bearer of [undefined, "", "wrong", 42, `${ENV.bearerKey} `]) {
      it(`answers 403 for bearer ${JSON.stringify(bearer)}`, async () => {
        const { deps, uploads, lookups } = fakeDeps();

        const result = await handleUploadTestUsage(
          { ...OK_INPUT, bearer },
          ENV,
          deps
        );

        expect(result.status).to.equal(403);
        expect(lookups).to.deep.equal([]);
        expect(uploads).to.deep.equal([]);
      });
    }

    it("refuses everything while the secret is blank", async () => {
      const { deps, uploads } = fakeDeps();

      const result = await handleUploadTestUsage(
        { ...OK_INPUT, bearer: "" },
        { ...ENV, bearerKey: "" },
        deps
      );

      expect(result.status).to.equal(403);
      expect(uploads).to.deep.equal([]);
    });
  });

  describe("guard 3 — smoke-test accounts only", () => {
    const others: Array<[string, string | null]> = [
      ["a real member", "mia.member@example.com"],
      ["the mailbox without a plus tag", "smoke.testing@werkstatt-waedi.ch"],
      ["a look-alike", "xsmoke.testing+a@werkstatt-waedi.ch"],
      ["an account without e-mail", null],
    ];
    for (const [label, email] of others) {
      it(`never bills ${label}`, async () => {
        const { deps, uploads } = fakeDeps({ userEmail: async () => email });

        const result = await handleUploadTestUsage(OK_INPUT, ENV, deps);

        expect(result.status).to.equal(403);
        expect(uploads).to.deep.equal([]);
      });
    }

    it("answers 404 for a machine that does not exist", async () => {
      const { deps, uploads } = fakeDeps({ machineExists: async () => false });

      const result = await handleUploadTestUsage(OK_INPUT, ENV, deps);

      expect(result.status).to.equal(404);
      expect(uploads).to.deep.equal([]);
    });
  });

  describe("input", () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ["a uid with a path in it", { uid: "a/b" }],
      ["a missing uid", { uid: undefined }],
      ["a machine id with a path in it", { machineId: "../users/x" }],
      ["negative active time", { activeSeconds: -1 }],
      ["fractional active time", { activeSeconds: 1.5 }],
      ["more than a day", { activeSeconds: 86401 }],
      ["a session shorter than its active time", { wallClockSeconds: 599 }],
      ["a non-numeric session length", { wallClockSeconds: "3600" }],
    ];
    for (const [label, patch] of bad) {
      it(`answers 400 for ${label}`, async () => {
        const { deps, uploads } = fakeDeps();

        const result = await handleUploadTestUsage(
          { ...OK_INPUT, ...patch },
          ENV,
          deps
        );

        expect(result.status).to.equal(400);
        expect(uploads).to.deep.equal([]);
      });
    }
  });
});
