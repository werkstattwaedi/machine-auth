import { expect } from "chai";
import supertest from "supertest";
import express from "express";
import { testEnv } from "./util/test-utils";
import { generateEncodedStartSessionRequest } from "./testing/test_utils";
import * as crypto from "crypto";
import { diversifyKey } from "./ntag/key_diversification";
import { toKeyBytes } from "./ntag/bytebuffer_util";

describe("startSession endpoint", () => {
  const testMasterKey = "000102030405060708090a0b0c0d0e0f";
  let app: express.Express;

  beforeEach(() => {
    process.env.DIVERSIFICATION_MASTER_KEY = testMasterKey;
    process.env.DIVERSIFICATION_SYSTEM_NAME = "OwwMachineAuth";
    // Because defineSecret reads process.env at module load time,
    // we need to dynamically require the app after setting the env vars.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = require("./index").app;
  });

  afterEach(() => {
    delete process.env.DIVERSIFICATION_MASTER_KEY;
    delete process.env.DIVERSIFICATION_SYSTEM_NAME;
    // Unload the module so it can be re-imported with different env vars in other tests
    delete require.cache[require.resolve("./index")];
  });

  after(() => {
    testEnv.cleanup();
  });

  it("should handle a valid start session request", async () => {
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
      .set("Content-Type", "text/plain")
      .send(encodedRequest);

    expect(response.status).to.equal(200);
    expect(response.type).to.equal("text/plain");
    expect(response.text).to.be.a("string").and.not.be.empty;
  });
});
