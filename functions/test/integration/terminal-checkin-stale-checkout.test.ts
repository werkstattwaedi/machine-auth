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
import { RejectionReason } from "../../src/proto/firebase_rpc/auth";

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
  const RESTRICTED_MACHINE_ID = "restrictedMachine123";
  const REQUIRED_PERMISSION_ID = "laserSchein";

  const config = {
    masterKey: "000102030405060708090a0b0c0d0e0f",
    systemName: "OwwMachineAuth",
  };

  const checkinRequest = () => ({
    tokenId: { value: new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex")) },
    machineId: { value: TEST_MACHINE_ID },
  });

  const restrictedCheckinRequest = () => ({
    tokenId: { value: new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex")) },
    machineId: { value: RESTRICTED_MACHINE_ID },
  });

  // Seed a token + user + unrestricted machine. The permission gate is not
  // under test here, so the machine has no requiredPermission. A second,
  // restricted machine covers the missing-permission case (which must NOT be
  // conflated with the stale-checkout case — that conflation is issue #535).
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
        [RESTRICTED_MACHINE_ID]: {
          name: "Restricted Machine",
          requiredPermission: [`/permission/${REQUIRED_PERMISSION_ID}`],
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
      const rejected = res.result.rejected;
      // Machine-readable cause so the terminal shows the actionable screen —
      // this must be STALE_CHECKOUT, distinct from MISSING_PERMISSION below.
      expect(rejected.reason).to.equal(
        RejectionReason.REJECTION_REASON_STALE_CHECKOUT
      );
      // The human message points at closing the open visit.
      expect(rejected.message).to.contain("Schliesse deinen letzten Besuch");
      // Deep link to the /denied landing page on the configured (emulator)
      // domain, encoding the user + the offending checkout id.
      expect(rejected.actionUrl).to.contain("/denied");
      expect(rejected.actionUrl).to.contain("cause=stale_checkout");
      expect(rejected.actionUrl).to.contain(`uid=${TEST_USER_ID}`);
      expect(rejected.actionUrl).to.contain("checkout=stale-open");
    }
  });

  it("DENIES a restricted machine with MISSING_PERMISSION, not STALE_CHECKOUT", async () => {
    // Core regression lock for #535: a permission denial and a stale-checkout
    // denial must carry different reasons. Here the user has no open checkout
    // at all, so the ONLY reason to reject is the missing permission.
    const res = await handleTerminalCheckin(restrictedCheckinRequest(), config);

    expect(res.result?.$case).to.equal("rejected");
    if (res.result?.$case === "rejected") {
      const rejected = res.result.rejected;
      expect(rejected.reason).to.equal(
        RejectionReason.REJECTION_REASON_MISSING_PERMISSION
      );
      expect(rejected.reason).to.not.equal(
        RejectionReason.REJECTION_REASON_STALE_CHECKOUT
      );
      expect(rejected.message).to.equal("Keine Berechtigung für diese Maschine");
      expect(rejected.actionUrl).to.contain("cause=missing_permission");
      expect(rejected.actionUrl).to.contain(`uid=${TEST_USER_ID}`);
      // No checkout is involved in a permission denial.
      expect(rejected.actionUrl).to.not.contain("checkout=");
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
