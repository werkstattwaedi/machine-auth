import { expect } from "chai";
import supertest from "supertest";
import express from "express";
import * as admin from "firebase-admin";
import { testEnv } from "./util/test-utils";
import { generateEncodedStartSessionRequest } from "./testing/test_utils";
import * as crypto from "crypto";
import { diversifyKey } from "./ntag/key_diversification";
import { toKeyBytes } from "./ntag/bytebuffer_util";

describe("API endpoints", () => {
  const testMasterKey = "000102030405060708090a0b0c0d0e0f";
  const testApiKey = "test-api-key";
  let app: express.Express;

  beforeEach(() => {
    process.env.DIVERSIFICATION_MASTER_KEY = testMasterKey;
    process.env.DIVERSIFICATION_SYSTEM_NAME = "OwwMachineAuth";
    process.env.PARTICLE_WEBHOOK_API_KEY = testApiKey;
    // Because defineSecret reads process.env at module load time,
    // we need to dynamically require the app after setting the env vars.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = require("./index").app;
  });

  afterEach(async () => {
    delete process.env.DIVERSIFICATION_MASTER_KEY;
    delete process.env.DIVERSIFICATION_SYSTEM_NAME;
    delete process.env.PARTICLE_WEBHOOK_API_KEY;
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
});
