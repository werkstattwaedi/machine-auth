// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// mintTestTap forges badge taps with the production-shared tag keys. These
// tests pin the three guards that make that safe: staging only, the staging
// kiosk bearer, and virtual (never-a-real-badge) UIDs only.

import { expect } from "chai";
import { diversifyKey } from "../ntag/key_diversification";
import { decryptPICCData, verifyCMAC } from "../ntag/sdm_crypto";
import {
  handleMintTestTap,
  isStagingProject,
  STAGING_PROJECT_ID,
  VIRTUAL_UID_PREFIX,
  type MintTestTapEnv,
} from "./mint_test_tap";

const ENV: MintTestTapEnv = {
  projectId: STAGING_PROJECT_ID,
  bearerKey: "staging-kiosk-bearer",
  terminalKey: "00112233445566778899aabbccddeeff",
  masterKey: "ffeeddccbbaa99887766554433221100",
  systemName: "oww-test",
};
const VIRTUAL_UID = `${VIRTUAL_UID_PREFIX}a1b2c3d4e5f6`;
const OK_INPUT = { uid: VIRTUAL_UID, counter: 7, bearer: ENV.bearerKey };

describe("mintTestTap", () => {
  it("mints a tap the real verification path accepts", () => {
    const result = handleMintTestTap(OK_INPUT, ENV);

    expect(result.status).to.equal(200);
    const { picc, cmac } = result.body as { picc: string; cmac: string };
    const piccData = decryptPICCData(picc, ENV.terminalKey);
    expect(piccData.uid.toString("hex")).to.equal(VIRTUAL_UID);
    expect(piccData.counter.readUIntLE(0, 3)).to.equal(7);
    const sdmMacKey = diversifyKey(
      ENV.masterKey,
      ENV.systemName,
      piccData.uid,
      "sdm_mac"
    );
    expect(verifyCMAC(cmac, piccData, picc, sdmMacKey)).to.equal(true);
  });

  describe("guard 1 — staging only", () => {
    for (const projectId of ["oww-maco", "oww-maco-staging-2", "", undefined]) {
      it(`answers 404 in project ${JSON.stringify(projectId)} even for a valid request`, () => {
        const result = handleMintTestTap(OK_INPUT, { ...ENV, projectId });
        expect(result.status).to.equal(404);
        expect(result.body).to.not.have.property("picc");
      });
    }

    it("isStagingProject matches the exact staging id only", () => {
      expect(isStagingProject(STAGING_PROJECT_ID)).to.equal(true);
      expect(isStagingProject("oww-maco")).to.equal(false);
      expect(isStagingProject(undefined)).to.equal(false);
    });
  });

  describe("guard 2 — staging kiosk bearer", () => {
    for (const bearer of [undefined, "", "wrong", ENV.bearerKey + "x", 42]) {
      it(`refuses bearer ${JSON.stringify(bearer)}`, () => {
        const result = handleMintTestTap({ ...OK_INPUT, bearer }, ENV);
        expect(result.status).to.equal(403);
      });
    }

    it("refuses everything when no bearer key is configured", () => {
      const result = handleMintTestTap(
        { ...OK_INPUT, bearer: "" },
        { ...ENV, bearerKey: "" }
      );
      expect(result.status).to.equal(403);
    });
  });

  describe("guard 3 — virtual UIDs only", () => {
    it("never mints for a real badge UID (NXP manufacturer byte 0x04)", () => {
      const result = handleMintTestTap(
        { ...OK_INPUT, uid: "04c339aa1e1890" },
        ENV
      );
      expect(result.status).to.equal(400);
      expect(result.body).to.not.have.property("picc");
    });

    it("the reserved prefix can never collide with NXP's 0x04", () => {
      expect(VIRTUAL_UID_PREFIX).to.not.equal("04");
      expect(VIRTUAL_UID_PREFIX).to.match(/^[0-9a-f]{2}$/);
    });

    for (const uid of [
      undefined,
      "",
      "f0",
      `${VIRTUAL_UID_PREFIX}a1b2c3d4e5`, // 6 bytes
      `${VIRTUAL_UID_PREFIX}a1b2c3d4e5f6aa`, // 8 bytes
      `${VIRTUAL_UID_PREFIX}zzzzzzzzzzzz`,
      ` ${VIRTUAL_UID}`,
      12345,
    ]) {
      it(`refuses uid ${JSON.stringify(uid)}`, () => {
        const result = handleMintTestTap({ ...OK_INPUT, uid }, ENV);
        expect(result.status).to.equal(400);
      });
    }

    it("accepts the virtual UID in upper case (normalised)", () => {
      const result = handleMintTestTap(
        { ...OK_INPUT, uid: VIRTUAL_UID.toUpperCase() },
        ENV
      );
      expect(result.status).to.equal(200);
    });
  });

  for (const counter of [undefined, -1, 1.5, 16777216, "7"]) {
    it(`refuses counter ${JSON.stringify(counter)}`, () => {
      const result = handleMintTestTap({ ...OK_INPUT, counter }, ENV);
      expect(result.status).to.equal(400);
    });
  }

  it("checks the project before anything else (no oracle outside staging)", () => {
    const result = handleMintTestTap(
      { uid: "garbage", counter: -1, bearer: "wrong" },
      { ...ENV, projectId: "oww-maco" }
    );
    expect(result.status).to.equal(404);
  });
});
