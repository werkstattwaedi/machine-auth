import { expect } from "chai";
import supertest from "supertest";
import express from "express";
import * as admin from "firebase-admin";
import { testEnv } from "./util/test-utils";
import { generateEncodedStartSessionRequest } from "./testing/test_utils";
import * as crypto from "crypto";
import { diversifyKey } from "./ntag/key_diversification";
import { toKeyBytes } from "./ntag/bytebuffer_util";
import { KeyDiversificationRequestT } from "./fbs/oww/personalization/key-diversification-request";
import { TagUidT } from "./fbs/oww/ntag/tag-uid";
import { KeyDiversificationResponse } from "./fbs/oww/personalization/key-diversification-response";
import { diversifyKeys } from "./ntag/key_diversification";

describe("API endpoints", () => {
  const testMasterKey = "000102030405060708090a0b0c0d0e0f";
  const testApiKey = "test-api-key";
  let app: express.Express;

  beforeEach(() => {
    process.env.DIVERSIFICATION_MASTER_KEY = testMasterKey;
    process.env.DIVERSIFICATION_SYSTEM_NAME = "OwwMachineAuth";
    process.env["particle-webhook-api-key"] = testApiKey;
    // Because defineSecret reads process.env at module load time,
    // we need to dynamically require the app after setting the env vars.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = require("./index").app;
  });

  afterEach(async () => {
    delete process.env.DIVERSIFICATION_MASTER_KEY;
    delete process.env.DIVERSIFICATION_SYSTEM_NAME;
    delete process.env["particle-webhook-api-key"];
    // Unload the module so it can be re-imported with different env vars in other tests
    delete require.cache[require.resolve("./index")];
    // Clean up the Firebase app to avoid "already exists" errors
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  after(() => {
    testEnv.cleanup();
  });

  describe("/startSession", () => {
    it("should handle a valid start session request", async () => {
      const requestId = "test-req-123";
      const machineId = "test-machine-123";
      const tokenId = [1, 2, 3, 4, 5, 6, 7];
      const testSystemName = "OwwMachineAuth";
      const tagChallenge = [
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      ];

      const authKey = diversifyKey(
        testMasterKey,
        testSystemName,
        Buffer.from(tokenId),
        "authorization"
      );

      const cipher = crypto.createCipheriv(
        "aes-128-cbc",
        toKeyBytes(authKey),
        Buffer.alloc(16, 0)
      );
      cipher.setAutoPadding(false);

      const encryptedTagChallenge = Buffer.concat([
        cipher.update(Buffer.from(tagChallenge)),
        cipher.final(),
      ]);

      const encodedRequest = generateEncodedStartSessionRequest(
        machineId,
        tokenId,
        Array.from(encryptedTagChallenge)
      );

      const response = await supertest(app)
        .post("/startSession")
        .set("Authorization", `Bearer ${testApiKey}`)
        .send({ id: requestId, data: encodedRequest });

      expect(response.status).to.equal(200);
      expect(response.type).to.equal("application/json");
      expect(response.body).to.have.property("id", requestId);
      expect(response.body).to.have.property("data").that.is.a("string").and.not
        .be.empty;
    });

    it("should return 403 for an invalid API key", async () => {
      const response = await supertest(app)
        .post("/startSession")
        .set("Authorization", "Bearer invalid-key")
        .send({ id: "123", data: "some-data" });

      expect(response.status).to.equal(403);
      expect(response.body.message).to.equal("Forbidden");
    });

    it("should return 401 for a missing Authorization header", async () => {
      const response = await supertest(app)
        .post("/startSession")
        .send({ id: "123", data: "some-data" });

      expect(response.status).to.equal(401);
      expect(response.body.message).to.equal("Unauthorized");
    });
  });

  describe("/personalize", () => {
    it("should return diversified keys for a valid request", async () => {
      const requestId = "test-personalize-1";
      const tokenId = [1, 2, 3, 4, 5, 6, 7];
      const builder = new (require("flatbuffers").Builder)(128);
      const tagUid = new TagUidT(tokenId);
      const reqT = new KeyDiversificationRequestT(tagUid);
      const reqOffset = reqT.pack(builder);
      builder.finish(reqOffset);
      const encodedRequest = Buffer.from(builder.asUint8Array()).toString(
        "base64"
      );

      const response = await supertest(app)
        .post("/personalize")
        .set("Authorization", `Bearer ${testApiKey}`)
        .send({ id: requestId, data: encodedRequest });

      expect(response.status).to.equal(200);
      expect(response.type).to.equal("application/json");
      expect(response.body).to.have.property("id", requestId);
      expect(response.body).to.have.property("data").that.is.a("string").and.not
        .be.empty;

      // Decode and check the response
      const responseBytes = Buffer.from(response.body.data, "base64");
      const fbResp =
        KeyDiversificationResponse.getRootAsKeyDiversificationResponse(
          new (require("flatbuffers").ByteBuffer)(responseBytes)
        );
      const keys = diversifyKeys(
        testMasterKey,
        "OwwMachineAuth",
        Buffer.from(tokenId).toString("hex")
      );
      expect(Array.from(fbResp.applicationKey()!.unpack().uid)).to.deep.equal(
        Array.from(Buffer.from(keys.application, "hex"))
      );
      expect(Array.from(fbResp.authorizationKey()!.unpack().uid)).to.deep.equal(
        Array.from(Buffer.from(keys.authorization, "hex"))
      );
      expect(Array.from(fbResp.reserved1Key()!.unpack().uid)).to.deep.equal(
        Array.from(Buffer.from(keys.reserved1, "hex"))
      );
      expect(Array.from(fbResp.reserved2Key()!.unpack().uid)).to.deep.equal(
        Array.from(Buffer.from(keys.reserved2, "hex"))
      );
    });

    it("should return 403 for an invalid API key", async () => {
      const response = await supertest(app)
        .post("/personalize")
        .set("Authorization", "Bearer invalid-key")
        .send({ id: "123", data: "some-data" });
      expect(response.status).to.equal(403);
      expect(response.body.message).to.equal("Forbidden");
    });

    it("should return 401 for a missing Authorization header", async () => {
      const response = await supertest(app)
        .post("/personalize")
        .send({ id: "123", data: "some-data" });
      expect(response.status).to.equal(401);
      expect(response.body.message).to.equal("Unauthorized");
    });
  });
});
