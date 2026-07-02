// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Covers probeTag — the kiosk's read-only tag classifier. The load-bearing
// invariant: probing must NOT advance the SDM counter (issue #420 —
// verify-exactly-once), so a registered badge probed mid-session can still
// sign in with the same tap URL afterwards.

import { expect } from "chai";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
  getFirestore,
} from "../emulator-helper";
import { probeTagHandler } from "../../src/checkout/probe_tag";
import { verifyTagCheckoutHandler } from "../../src/checkout/verify_tag";
import { verifyBadgeVoucher } from "../../src/badge/voucher";
import { generateValidPICCAndCMAC } from "../test-sdm-helper";

const TEST_TOKEN_UID = "04c339aa1e1890";
const TEST_USER_ID = "testUser123";
const TEST_TERMINAL_KEY = "00112233445566778899aabbccddeeff";
const TEST_MASTER_KEY = "fedcba9876543210fedcba9876543210";
const TEST_SYSTEM_NAME = "test-system";
const TEST_BEARER = "test-kiosk-bearer";

function makeRequest(data: {
  picc?: string;
  cmac?: string;
  bearer?: string;
}): CallableRequest<{ picc: string; cmac: string; bearer?: string }> {
  return { data } as CallableRequest<{
    picc: string;
    cmac: string;
    bearer?: string;
  }>;
}

function tapData(counter: number) {
  return generateValidPICCAndCMAC(
    TEST_TOKEN_UID,
    counter,
    TEST_TERMINAL_KEY,
    TEST_MASTER_KEY,
    TEST_SYSTEM_NAME
  );
}

describe("probeTag (Integration)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
    for (const k of [
      "TERMINAL_KEY",
      "DIVERSIFICATION_MASTER_KEY",
      "DIVERSIFICATION_SYSTEM_NAME",
      "KIOSK_BEARER_KEY",
      "FUNCTIONS_EMULATOR",
    ]) {
      savedEnv[k] = process.env[k];
    }
    process.env.TERMINAL_KEY = TEST_TERMINAL_KEY;
    process.env.DIVERSIFICATION_MASTER_KEY = TEST_MASTER_KEY;
    process.env.DIVERSIFICATION_SYSTEM_NAME = TEST_SYSTEM_NAME;
    process.env.KIOSK_BEARER_KEY = TEST_BEARER;
  });

  after(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await teardownEmulator();
  });

  beforeEach(async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    await clearFirestore();
  });

  async function seedRegisteredToken() {
    await seedTestData({
      tokens: {
        [TEST_TOKEN_UID]: {
          userId: `/users/${TEST_USER_ID}`,
          label: "Test Token",
        },
      },
      users: {
        [TEST_USER_ID]: {
          firstName: "Test",
          lastName: "User",
          permissions: [],
          roles: [],
        },
      },
    });
  }

  it("classifies a registered badge without advancing the counter", async () => {
    await seedRegisteredToken();
    const { picc, cmac } = tapData(7);

    const probe = await probeTagHandler(makeRequest({ picc, cmac }));
    expect(probe.registered).to.equal(true);
    expect(probe.deactivated).to.equal(false);
    expect(probe.tokenId).to.equal(TEST_TOKEN_UID);
    expect(probe.badgeVoucher).to.equal(undefined);

    // Counter untouched by the probe...
    const tokenDoc = await getFirestore()
      .collection("tokens")
      .doc(TEST_TOKEN_UID)
      .get();
    expect(tokenDoc.get("lastSdmCounter")).to.equal(undefined);

    // ...so the SAME tap URL still signs in afterwards (verify-once).
    const verify = await verifyTagCheckoutHandler(makeRequest({ picc, cmac }));
    expect(verify.registered).to.equal(true);
  });

  it("flags a deactivated badge", async () => {
    await seedTestData({
      tokens: {
        [TEST_TOKEN_UID]: {
          userId: `/users/${TEST_USER_ID}`,
          label: "Off",
          deactivated: new Date(),
        },
      },
      users: { [TEST_USER_ID]: { firstName: "T", lastName: "U" } },
    });
    const { picc, cmac } = tapData(1);

    const probe = await probeTagHandler(makeRequest({ picc, cmac }));
    expect(probe.registered).to.equal(true);
    expect(probe.deactivated).to.equal(true);
  });

  it("returns a valid purchase voucher for an unregistered badge", async () => {
    const { picc, cmac } = tapData(9);

    const probe = await probeTagHandler(makeRequest({ picc, cmac }));
    expect(probe.registered).to.equal(false);
    expect(probe.tokenId).to.equal(TEST_TOKEN_UID);
    expect(
      verifyBadgeVoucher(probe.badgeVoucher!, TEST_MASTER_KEY)
    ).to.deep.equal({ tokenId: TEST_TOKEN_UID, sdmCounter: 9 });
  });

  it("rejects bad crypto with invalid-argument", async () => {
    const { picc } = tapData(1);
    try {
      await probeTagHandler(
        makeRequest({ picc, cmac: "0000000000000000" })
      );
      expect.fail("expected HttpsError");
    } catch (err: any) {
      expect(err.code).to.equal("invalid-argument");
    }
  });

  it("enforces the kiosk bearer outside the emulator", async () => {
    process.env.FUNCTIONS_EMULATOR = "";
    const { picc, cmac } = tapData(1);
    try {
      await probeTagHandler(makeRequest({ picc, cmac }));
      expect.fail("expected HttpsError");
    } catch (err: any) {
      expect(err.code).to.equal("permission-denied");
    }

    await seedRegisteredToken();
    const ok = await probeTagHandler(
      makeRequest({ picc, cmac, bearer: TEST_BEARER })
    );
    expect(ok.registered).to.equal(true);
  });
});
