// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
  getFirestore,
} from "../emulator-helper";
import { handleTerminalCheckin } from "../../src/auth/handle_terminal_checkin";

/**
 * Prior-business-day open-checkout gate (issue #393).
 *
 * Badge-in must be DENIED when the user has an open checkout left over from a
 * previous business day, and ALLOWED when the only open checkout is same-day
 * (or there is none). These tests fail on pre-fix code, which had no such gate.
 */
describe("handleTerminalCheckin — stale open checkout gate (Integration)", () => {
  const TEST_TOKEN_UID = "04c339aa1e1890"; // 7-byte UID as hex
  const TEST_USER_ID = "testUser123";
  const TEST_MACHINE_ID = "testMachine123";

  const config = {
    masterKey: "000102030405060708090a0b0c0d0e0f",
    systemName: "OwwMachineAuth",
  };

  const STALE_MESSAGE = "Bitte schliesse zuerst deinen offenen Besuch ab.";

  const checkinRequest = () => ({
    tokenId: { value: new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex")) },
    machineId: { value: TEST_MACHINE_ID },
  });

  // Seed a token + user + unrestricted machine. The permission gate is not
  // under test here, so the machine has no requiredPermission.
  const seedBaseline = () =>
    seedTestData({
      users: {
        [TEST_USER_ID]: {
          firstName: "Test",
          lastName: "User",
          name: "Test User",
          permissions: [],
          roles: [],
        },
      },
      tokens: {
        [TEST_TOKEN_UID]: {
          userId: `/users/${TEST_USER_ID}`,
          label: "Test Token",
        },
      },
      machines: {
        [TEST_MACHINE_ID]: {
          name: "Unrestricted Machine",
          requiredPermission: [],
        },
      },
    });

  // Write a checkout doc with userId -> /users/TEST_USER_ID and the given
  // status/created. `created` accepts a JS Date.
  const seedCheckout = async (
    id: string,
    status: "open" | "closed",
    created: Date
  ) => {
    const db = getFirestore();
    await db
      .collection("checkouts")
      .doc(id)
      .set({
        userId: db.collection("users").doc(TEST_USER_ID),
        status,
        created: Timestamp.fromDate(created),
      });
  };

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await seedBaseline();
  });

  it("DENIES badge-in when an open checkout is from a prior business day", async () => {
    // ~26h ago crosses the 03:00 Europe/Zurich business-day boundary
    // regardless of the current wall-clock time within the day.
    const priorDay = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await seedCheckout("stale-open", "open", priorDay);

    const res = await handleTerminalCheckin(checkinRequest(), config);

    expect(res.result?.$case).to.equal("rejected");
    if (res.result?.$case === "rejected") {
      expect(res.result.rejected.message).to.equal(STALE_MESSAGE);
    }
  });

  it("ALLOWS badge-in when the open checkout is same business day", async () => {
    await seedCheckout("fresh-open", "open", new Date());

    const res = await handleTerminalCheckin(checkinRequest(), config);

    expect(res.result?.$case).to.equal("authorized");
    if (res.result?.$case === "authorized") {
      expect(res.result.authorized.userId?.value).to.equal(TEST_USER_ID);
    }
  });

  it("ALLOWS badge-in when the user has no open checkout", async () => {
    const res = await handleTerminalCheckin(checkinRequest(), config);

    expect(res.result?.$case).to.equal("authorized");
    if (res.result?.$case === "authorized") {
      expect(res.result.authorized.userId?.value).to.equal(TEST_USER_ID);
    }
  });

  it("ALLOWS badge-in when only a prior-day CLOSED checkout exists", async () => {
    // The status filter must exclude closed checkouts: a prior-day visit the
    // user already closed should not block a fresh badge-in.
    const priorDay = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await seedCheckout("stale-closed", "closed", priorDay);

    const res = await handleTerminalCheckin(checkinRequest(), config);

    expect(res.result?.$case).to.equal("authorized");
    if (res.result?.$case === "authorized") {
      expect(res.result.authorized.userId?.value).to.equal(TEST_USER_ID);
    }
  });
});
