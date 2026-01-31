// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import * as crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
  getFirestore,
} from "../emulator-helper";
import { handleTerminalCheckin } from "../../src/auth/handle_terminal_checkin";
import { handleAuthenticateTag } from "../../src/auth/handle_authenticate_tag";
import { handleCompleteTagAuth } from "../../src/auth/handle_complete_tag_auth";
import { Key } from "../../src/proto/common.js";
import { diversifyKey } from "../../src/ntag/key_diversification";
import { toKeyBytes } from "../../src/ntag/bytebuffer_util";

describe("Auth Handlers (Integration)", () => {
  const TEST_TOKEN_UID = "04c339aa1e1890"; // 7-byte UID as hex
  const TEST_USER_ID = "testUser123";
  const TEST_MASTER_KEY = "000102030405060708090a0b0c0d0e0f";
  const TEST_SYSTEM_NAME = "OwwMachineAuth";

  const config = {
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

  describe("handleTerminalCheckin", () => {
    it("should reject missing token ID", async () => {
      const res = await handleTerminalCheckin({ tokenId: undefined }, config);

      expect(res.result?.$case).to.equal("rejected");
      if (res.result?.$case === "rejected") {
        expect(res.result.rejected.message).to.equal("Missing token ID");
      }
    });

    it("should reject unregistered token", async () => {
      const tokenIdBytes = new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex"));

      const res = await handleTerminalCheckin(
        { tokenId: { value: tokenIdBytes } },
        config
      );

      expect(res.result?.$case).to.equal("rejected");
      if (res.result?.$case === "rejected") {
        expect(res.result.rejected.message).to.equal("Token not registered");
      }
    });

    it("should reject deactivated token", async () => {
      await seedTestData({
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
            name: "Test User",
            permissions: [],
            roles: [],
          },
        },
        tokens: {
          [TEST_TOKEN_UID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
            deactivated: Timestamp.now(),
          },
        },
      });

      const tokenIdBytes = new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex"));
      const res = await handleTerminalCheckin(
        { tokenId: { value: tokenIdBytes } },
        config
      );

      expect(res.result?.$case).to.equal("rejected");
      if (res.result?.$case === "rejected") {
        expect(res.result.rejected.message).to.equal("Token deactivated");
      }
    });

    it("should return authorized for valid token without existing auth", async () => {
      await seedTestData({
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
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
      });

      const tokenIdBytes = new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex"));
      const res = await handleTerminalCheckin(
        { tokenId: { value: tokenIdBytes } },
        config
      );

      expect(res.result?.$case).to.equal("authorized");
      if (res.result?.$case === "authorized") {
        expect(res.result.authorized.userId?.value).to.equal(TEST_USER_ID);
        expect(res.result.authorized.userLabel).to.equal("Test User");
        expect(res.result.authorized.authenticationId).to.be.undefined;
      }
    });

    it("should return existing auth when recent completed auth exists", async () => {
      const db = getFirestore();

      await seedTestData({
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
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
      });

      // Create a completed auth record manually
      const authId = "existing-auth-123";
      await db.collection("authentications").doc(authId).set({
        tokenId: db.collection("tokens").doc(TEST_TOKEN_UID),
        keySlot: Key.KEY_APPLICATION,
        created: Timestamp.now(),
        inProgressAuth: null, // Completed
      });

      const tokenIdBytes = new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex"));
      const res = await handleTerminalCheckin(
        { tokenId: { value: tokenIdBytes } },
        config
      );

      expect(res.result?.$case).to.equal("authorized");
      if (res.result?.$case === "authorized") {
        expect(res.result.authorized.authenticationId?.value).to.equal(authId);
      }
    });
  });

  describe("handleAuthenticateTag", () => {
    it("should throw for missing tag ID", async () => {
      try {
        await handleAuthenticateTag(
          {
            tagId: undefined,
            keySlot: Key.KEY_APPLICATION,
            ntagChallenge: new Uint8Array(16),
          },
          config
        );
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as Error).message).to.equal("Missing tag ID");
      }
    });

    it("should throw for invalid challenge length", async () => {
      const tagIdBytes = new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex"));

      try {
        await handleAuthenticateTag(
          {
            tagId: { value: tagIdBytes },
            keySlot: Key.KEY_APPLICATION,
            ntagChallenge: new Uint8Array(8), // Wrong length
          },
          config
        );
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as Error).message).to.equal("ntag challenge must be 16 bytes");
      }
    });

    it("should throw for unregistered token", async () => {
      const tagIdBytes = new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex"));

      try {
        await handleAuthenticateTag(
          {
            tagId: { value: tagIdBytes },
            keySlot: Key.KEY_APPLICATION,
            ntagChallenge: new Uint8Array(16),
          },
          config
        );
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as Error).message).to.include("not registered");
      }
    });

    it("should create auth record and return challenge for valid request", async () => {
      await seedTestData({
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
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
      });

      const tagIdBytes = new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex"));
      const ntagChallenge = new Uint8Array(16).fill(0xaa);

      const res = await handleAuthenticateTag(
        {
          tagId: { value: tagIdBytes },
          keySlot: Key.KEY_APPLICATION,
          ntagChallenge,
        },
        config
      );

      expect(res.authId?.value).to.be.a("string").and.not.be.empty;
      expect(res.cloudChallenge).to.have.length(32);

      // Verify auth record was created in Firestore
      const db = getFirestore();
      const authDoc = await db
        .collection("authentications")
        .doc(res.authId!.value)
        .get();
      expect(authDoc.exists).to.be.true;

      const authData = authDoc.data();
      expect(authData?.inProgressAuth).to.not.be.null;
      expect(authData?.inProgressAuth?.rndA).to.have.length(16);
      expect(authData?.inProgressAuth?.rndB).to.have.length(16);
    });
  });

  describe("handleCompleteTagAuth", () => {
    it("should reject missing auth ID", async () => {
      const res = await handleCompleteTagAuth(
        {
          authId: undefined,
          encryptedTagResponse: new Uint8Array(32),
        },
        config
      );

      expect(res.result?.$case).to.equal("rejected");
      if (res.result?.$case === "rejected") {
        expect(res.result.rejected.message).to.equal("Missing auth ID");
      }
    });

    it("should reject auth not found", async () => {
      const res = await handleCompleteTagAuth(
        {
          authId: { value: "nonexistent-auth-id" },
          encryptedTagResponse: new Uint8Array(32),
        },
        config
      );

      expect(res.result?.$case).to.equal("rejected");
      if (res.result?.$case === "rejected") {
        expect(res.result.rejected.message).to.equal("Authentication not found");
      }
    });

    it("should reject already completed auth", async () => {
      const db = getFirestore();

      await seedTestData({
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
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
      });

      // Create a completed auth record
      const authId = "completed-auth-123";
      await db.collection("authentications").doc(authId).set({
        tokenId: db.collection("tokens").doc(TEST_TOKEN_UID),
        keySlot: Key.KEY_APPLICATION,
        created: Timestamp.now(),
        inProgressAuth: null, // Already completed
      });

      const res = await handleCompleteTagAuth(
        {
          authId: { value: authId },
          encryptedTagResponse: new Uint8Array(32),
        },
        config
      );

      expect(res.result?.$case).to.equal("rejected");
      if (res.result?.$case === "rejected") {
        expect(res.result.rejected.message).to.equal(
          "Authentication already completed or expired"
        );
      }
    });

    it("should return session keys for valid auth completion", async () => {
      const db = getFirestore();

      await seedTestData({
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
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
      });

      // Create in-progress auth with known randoms
      const rndA = crypto.randomBytes(16);
      const rndB = crypto.randomBytes(16);
      const authId = "in-progress-auth-123";

      await db.collection("authentications").doc(authId).set({
        tokenId: db.collection("tokens").doc(TEST_TOKEN_UID),
        keySlot: Key.KEY_APPLICATION,
        created: Timestamp.now(),
        inProgressAuth: { rndA, rndB },
      });

      // Create valid encrypted response
      const uid = Buffer.from(TEST_TOKEN_UID, "hex");
      const authKey = diversifyKey(TEST_MASTER_KEY, TEST_SYSTEM_NAME, uid, "application");
      const authKeyBytes = toKeyBytes(authKey);

      const ti = crypto.randomBytes(4);
      const rndARotated = Buffer.concat([rndA.subarray(1, 16), Buffer.of(rndA[0])]);
      const pdCap2 = Buffer.alloc(6, 0x01);
      const pcdCap2 = Buffer.alloc(6, 0x02);
      const plainResponse = Buffer.concat([ti, rndARotated, pdCap2, pcdCap2]);

      const cipher = crypto
        .createCipheriv("aes-128-cbc", authKeyBytes, Buffer.alloc(16, 0))
        .setAutoPadding(false);
      const encryptedResponse = Buffer.concat([
        cipher.update(plainResponse),
        cipher.final(),
      ]);

      const res = await handleCompleteTagAuth(
        {
          authId: { value: authId },
          encryptedTagResponse: new Uint8Array(encryptedResponse),
        },
        config
      );

      expect(res.result?.$case).to.equal("sessionKeys");
      if (res.result?.$case === "sessionKeys") {
        const { sessionKeys } = res.result;
        expect(sessionKeys.sesAuthEncKey).to.have.length(16);
        expect(sessionKeys.sesAuthMacKey).to.have.length(16);
        expect(sessionKeys.transactionIdentifier).to.have.length(4);
        expect(sessionKeys.piccCapabilities).to.have.length(6);
      }

      // Verify inProgressAuth was cleared
      const authDoc = await db.collection("authentications").doc(authId).get();
      expect(authDoc.data()?.inProgressAuth).to.be.null;
    });
  });

  describe("Full auth flow", () => {
    it("should complete full 3-pass auth flow", async () => {
      await seedTestData({
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
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
      });

      const tagIdBytes = new Uint8Array(Buffer.from(TEST_TOKEN_UID, "hex"));
      const uid = Buffer.from(TEST_TOKEN_UID, "hex");

      // Step 1: Simulate tag generating encrypted RndB (like AuthenticateEV2First)
      const authKey = diversifyKey(TEST_MASTER_KEY, TEST_SYSTEM_NAME, uid, "application");
      const authKeyBytes = toKeyBytes(authKey);
      const realRndB = crypto.randomBytes(16);

      const tagCipher = crypto
        .createCipheriv("aes-128-cbc", authKeyBytes, Buffer.alloc(16, 0))
        .setAutoPadding(false);
      const ntagChallenge = Buffer.concat([
        tagCipher.update(realRndB),
        tagCipher.final(),
      ]);

      // Step 2: Terminal calls handleAuthenticateTag
      const authRes = await handleAuthenticateTag(
        {
          tagId: { value: tagIdBytes },
          keySlot: Key.KEY_APPLICATION,
          ntagChallenge: new Uint8Array(ntagChallenge),
        },
        config
      );

      expect(authRes.authId?.value).to.be.a("string");
      expect(authRes.cloudChallenge).to.have.length(32);

      // Step 3: Decrypt cloud challenge to get RndA and verify RndB'
      const decipher = crypto
        .createDecipheriv("aes-128-cbc", authKeyBytes, Buffer.alloc(16, 0))
        .setAutoPadding(false);
      const decryptedChallenge = Buffer.concat([
        decipher.update(Buffer.from(authRes.cloudChallenge!)),
        decipher.final(),
      ]);

      const rndA = decryptedChallenge.subarray(0, 16);
      const rndBRotated = decryptedChallenge.subarray(16, 32);

      // Verify RndB' matches rotated RndB
      const expectedRndBRotated = Buffer.concat([
        realRndB.subarray(1, 16),
        Buffer.of(realRndB[0]),
      ]);
      expect(rndBRotated.toString("hex")).to.equal(
        expectedRndBRotated.toString("hex")
      );

      // Step 4: Create tag response (TI + RndA' + pdCap2 + pcdCap2)
      const ti = crypto.randomBytes(4);
      const rndARotated = Buffer.concat([rndA.subarray(1, 16), Buffer.of(rndA[0])]);
      const pdCap2 = Buffer.alloc(6, 0x00);
      const pcdCap2 = Buffer.alloc(6, 0x00);
      const plainResponse = Buffer.concat([ti, rndARotated, pdCap2, pcdCap2]);

      const responseCipher = crypto
        .createCipheriv("aes-128-cbc", authKeyBytes, Buffer.alloc(16, 0))
        .setAutoPadding(false);
      const encryptedResponse = Buffer.concat([
        responseCipher.update(plainResponse),
        responseCipher.final(),
      ]);

      // Step 5: Terminal calls handleCompleteTagAuth
      const completeRes = await handleCompleteTagAuth(
        {
          authId: { value: authRes.authId!.value },
          encryptedTagResponse: new Uint8Array(encryptedResponse),
        },
        config
      );

      expect(completeRes.result?.$case).to.equal("sessionKeys");
      if (completeRes.result?.$case === "sessionKeys") {
        const { sessionKeys } = completeRes.result;
        expect(sessionKeys.sesAuthEncKey).to.have.length(16);
        expect(sessionKeys.sesAuthMacKey).to.have.length(16);
      }
    });
  });
});
