// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The kiosk bearer gate. Regression for 2026-09-18: the staging bearer was
// rotated with `openssl rand -hex 32 | firebase functions:secrets:set …
// --data-file=-`, which stores openssl's trailing newline; the server
// compared untrimmed, every client sends the value trimmed, and the kiosk
// got "Forbidden" on every tap.

import { expect } from "chai";
import { assertKioskBearer } from "./kiosk_session";

const BEARER = "0123456789abcdef0123456789abcdef";

describe("assertKioskBearer", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["FUNCTIONS_EMULATOR", "KIOSK_BEARER_KEY"]) {
      saved[k] = process.env[k];
    }
    delete process.env.FUNCTIONS_EMULATOR;
    process.env.KIOSK_BEARER_KEY = BEARER;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const refused = (bearer: string | undefined) => {
    try {
      assertKioskBearer(bearer, "test");
    } catch (err: any) {
      return err.code === "permission-denied";
    }
    return false;
  };

  it("accepts the configured bearer", () => {
    expect(refused(BEARER)).to.equal(false);
  });

  it("accepts it when the SECRET was stored with a trailing newline", () => {
    process.env.KIOSK_BEARER_KEY = `${BEARER}\n`;
    expect(refused(BEARER)).to.equal(false);
  });

  for (const bearer of [undefined, "", "wrong", `${BEARER}x`, `${BEARER}\n`]) {
    it(`refuses ${JSON.stringify(bearer)}`, () => {
      expect(refused(bearer)).to.equal(true);
    });
  }

  it("refuses everyone — including an empty bearer — when the secret is blank", () => {
    for (const blank of ["", "\n", "   "]) {
      process.env.KIOSK_BEARER_KEY = blank;
      expect(refused(""), JSON.stringify(blank)).to.equal(true);
      expect(refused(undefined), JSON.stringify(blank)).to.equal(true);
    }
  });

  it("is skipped in the emulator", () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    expect(refused(undefined)).to.equal(false);
  });
});
