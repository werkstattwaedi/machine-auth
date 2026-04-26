/**
 * @fileoverview Regression coverage for the SDM read-counter replay defense.
 *
 * Companion to issue #161 (B1 launch-readiness review). The defense itself
 * lives in `functions/src/checkout/verify_tag.ts` (`lastSdmCounter` stored on
 * `tokens/{tokenId}`, monotonic enforcement inside a transaction). These tests
 * exist so that a future refactor cannot silently loosen or remove the check.
 *
 * The 7 scenarios mirror the acceptance criteria in the issue verbatim.
 */

import { expect } from "chai";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
  getFirestore,
} from "../emulator-helper";
import { handleVerifyTagCheckout } from "../../src/checkout/verify_tag";
import type { VerifyTagRequest } from "../../src/checkout/verify_tag";
import { generateValidPICCAndCMAC } from "../test-sdm-helper";

describe("SDM counter replay defense (Integration)", () => {
  const TEST_TOKEN_UID = "04c339aa1e1890"; // 7-byte UID
  const TEST_USER_ID = "testUserSdmReplay";

  // 16-byte AES-128 keys (32 hex chars)
  const TEST_TERMINAL_KEY = "00112233445566778899aabbccddeeff";
  const TEST_MASTER_KEY = "fedcba9876543210fedcba9876543210";
  const TEST_SYSTEM_NAME = "test-system";

  const mockConfig = {
    terminalKey: TEST_TERMINAL_KEY,
    masterKey: TEST_MASTER_KEY,
    systemName: TEST_SYSTEM_NAME,
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
  });

  function generateTestData(uid: string, counter: number) {
    return generateValidPICCAndCMAC(
      uid,
      counter,
      TEST_TERMINAL_KEY,
      TEST_MASTER_KEY,
      TEST_SYSTEM_NAME,
    );
  }

  /**
   * Seed a token with no `lastSdmCounter` field — i.e. a fresh, never-tapped
   * tag (sentinel `-1` initial state).
   */
  async function seedFreshToken(): Promise<void> {
    await seedTestData({
      tokens: {
        [TEST_TOKEN_UID]: {
          userId: `/users/${TEST_USER_ID}`,
          label: "Test Token",
        },
      },
      users: {
        [TEST_USER_ID]: {
          displayName: "Test User",
          permissions: [],
          roles: [],
        },
      },
    });
  }

  /**
   * Seed a token with a specific `lastSdmCounter` already persisted.
   */
  async function seedTokenWithCounter(lastSdmCounter: number): Promise<void> {
    await seedFreshToken();
    await getFirestore()
      .collection("tokens")
      .doc(TEST_TOKEN_UID)
      .update({ lastSdmCounter });
  }

  async function readPersistedCounter(): Promise<number | undefined> {
    const snap = await getFirestore()
      .collection("tokens")
      .doc(TEST_TOKEN_UID)
      .get();
    return snap.data()?.lastSdmCounter;
  }

  // ---------------------------------------------------------------------------
  // Scenario 1: First tap accepted (counter = 0 against fresh token)
  // ---------------------------------------------------------------------------
  it("accepts first tap with counter=0 on a never-tapped token and persists 0", async () => {
    await seedFreshToken();

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 0);
    const request: VerifyTagRequest = { picc, cmac };

    const response = await handleVerifyTagCheckout(request, mockConfig);
    expect(response.tokenId).to.equal(TEST_TOKEN_UID);

    expect(await readPersistedCounter()).to.equal(0);
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Replayed tap rejected (same counter twice)
  // ---------------------------------------------------------------------------
  it("rejects an exact replay of the same counter value", async () => {
    await seedFreshToken();

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 7);
    const request: VerifyTagRequest = { picc, cmac };

    // First call succeeds and persists counter=7.
    await handleVerifyTagCheckout(request, mockConfig);
    expect(await readPersistedCounter()).to.equal(7);

    // Second call with identical (still cryptographically valid) payload
    // must be rejected by the replay defense.
    try {
      await handleVerifyTagCheckout(request, mockConfig);
      expect.fail("Should have rejected replayed counter");
    } catch (error: any) {
      expect(error.message).to.include("replay");
    }

    // Persisted counter unchanged.
    expect(await readPersistedCounter()).to.equal(7);
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Lower counter rejected (lastSdmCounter=10, incoming=5)
  // ---------------------------------------------------------------------------
  it("rejects an incoming counter strictly lower than the persisted one", async () => {
    await seedTokenWithCounter(10);

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 5);

    try {
      await handleVerifyTagCheckout({ picc, cmac }, mockConfig);
      expect.fail("Should have rejected lower counter");
    } catch (error: any) {
      expect(error.message).to.include("replay");
    }

    expect(await readPersistedCounter()).to.equal(10);
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Equal counter rejected (lastSdmCounter=10, incoming=10) —
  // strict `>` semantics
  // ---------------------------------------------------------------------------
  it("rejects an incoming counter equal to the persisted one (strict >)", async () => {
    await seedTokenWithCounter(10);

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 10);

    try {
      await handleVerifyTagCheckout({ picc, cmac }, mockConfig);
      expect.fail("Should have rejected equal counter");
    } catch (error: any) {
      expect(error.message).to.include("replay");
    }

    expect(await readPersistedCounter()).to.equal(10);
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Higher counter accepted (lastSdmCounter=10, incoming=11)
  // ---------------------------------------------------------------------------
  it("accepts an incoming counter strictly higher than the persisted one", async () => {
    await seedTokenWithCounter(10);

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 11);

    const response = await handleVerifyTagCheckout({ picc, cmac }, mockConfig);
    expect(response.tokenId).to.equal(TEST_TOKEN_UID);

    expect(await readPersistedCounter()).to.equal(11);
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Concurrent calls with the same counter — exactly one wins
  //
  // This guards the transaction (`db.runTransaction`) inside verify_tag.ts:
  // a non-transactional read+write would let two simultaneous taps both see
  // the old `lastSdmCounter` and both succeed. The Firestore transaction
  // contract guarantees that under a write conflict at most one commits.
  // ---------------------------------------------------------------------------
  it("allows only one of two concurrent calls with the same counter to succeed", async function () {
    // Firestore transactions retry on contention; the emulator can take a few
    // seconds to surface the losing transaction's failure. The default 2s
    // mocha timeout is not enough.
    this.timeout(15000);
    await seedFreshToken();

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 42);
    const request: VerifyTagRequest = { picc, cmac };

    const results = await Promise.allSettled([
      handleVerifyTagCheckout(request, mockConfig),
      handleVerifyTagCheckout(request, mockConfig),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).to.equal(
      1,
      `expected exactly one success, got ${fulfilled.length}`,
    );
    expect(rejected.length).to.equal(
      1,
      `expected exactly one rejection, got ${rejected.length}`,
    );

    // The rejection must be the replay error (not some other transient
    // emulator hiccup) — otherwise the test would hide a regression where
    // the transaction was removed and one call simply happened to fail for
    // unrelated reasons.
    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectionReason.message).to.include("replay");

    // And the surviving counter on disk is exactly the one the survivor wrote.
    expect(await readPersistedCounter()).to.equal(42);
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: First-tap edge case — token doc with NO lastSdmCounter field
  // accepts counter=0 (the sentinel `-1` initial value works correctly).
  //
  // This is partially redundant with scenario 1 by construction, but the
  // issue calls it out separately to lock in the semantics: a missing field
  // is treated as `-1`, not as `0`. If someone "simplifies" the code to
  // `?? 0`, scenario 1 still passes (counter 0 > 0 is false, so it would
  // FAIL — actually catching the bug). We assert both the success and the
  // shape of the underlying data here to make the intent explicit.
  // ---------------------------------------------------------------------------
  it("treats a missing lastSdmCounter field as the -1 sentinel (counter=0 accepted)", async () => {
    await seedFreshToken();

    // Confirm precondition: the seeded token genuinely has no lastSdmCounter.
    const before = await getFirestore()
      .collection("tokens")
      .doc(TEST_TOKEN_UID)
      .get();
    expect(before.data()).to.not.have.property("lastSdmCounter");

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 0);
    const response = await handleVerifyTagCheckout({ picc, cmac }, mockConfig);
    expect(response.tokenId).to.equal(TEST_TOKEN_UID);

    expect(await readPersistedCounter()).to.equal(0);
  });
});
