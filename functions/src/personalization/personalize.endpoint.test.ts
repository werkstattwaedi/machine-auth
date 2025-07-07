import { expect } from "chai";
import supertest from "supertest";
import express from "express";
import * as admin from "firebase-admin";
import * as sinon from "sinon";
import * as flatbuffers from "flatbuffers";
import { KeyDiversificationRequestT } from "../fbs/oww/personalization/key-diversification-request";
import { TagUidT } from "../fbs/oww/ntag/tag-uid";
import { KeyDiversificationResponse } from "../fbs/oww/personalization/key-diversification-response";
import { diversifyKeys } from "../ntag/key_diversification";

describe("/personalize endpoint", () => {
  const testMasterKey = "000102030405060708090a0b0c0d0e0f";
  const testApiKey = "test-api-key";
  let app: express.Express;
  let firestoreStub: sinon.SinonStub;

  beforeEach(() => {
    process.env.DIVERSIFICATION_MASTER_KEY = testMasterKey;
    process.env.DIVERSIFICATION_SYSTEM_NAME = "OwwMachineAuth";
    process.env.PARTICLE_WEBHOOK_API_KEY = testApiKey;

    firestoreStub = sinon.stub(admin, "firestore").get(() => {
      return () => ({});
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = require("../index").app;
  });

  afterEach(() => {
    firestoreStub.restore();
    delete process.env.DIVERSIFICATION_MASTER_KEY;
    delete process.env.DIVERSIFICATION_SYSTEM_NAME;
    delete process.env.PARTICLE_WEBHOOK_API_KEY;
    delete require.cache[require.resolve("../index")];
    Promise.all(admin.apps.map((app) => app?.delete()));
  });

  it("should return diversified keys for a valid request", async () => {
    const requestId = "test-personalize-1";
    const tokenId = [1, 2, 3, 4, 5, 6, 7];
    const builder = new flatbuffers.Builder(128);
    const tagUid = new TagUidT(tokenId);
    const reqT = new KeyDiversificationRequestT(tagUid);
    const reqOffset = reqT.pack(builder);
    builder.finish(reqOffset);
    const encodedRequest = Buffer.from(builder.asUint8Array()).toString("base64");

    const response = await supertest(app)
      .post("/personalize")
      .set("Authorization", `Bearer ${testApiKey}`)
      .send({ id: requestId, data: encodedRequest });

    expect(response.status).to.equal(200);
    expect(response.type).to.equal("application/json");
    expect(response.body).to.have.property("id", requestId);
    expect(response.body).to.have.property("data").that.is.a("string").and.not.be.empty;

    // Decode and check the response
    const responseBytes = Buffer.from(response.body.data, "base64");
    const fbResp = KeyDiversificationResponse.getRootAsKeyDiversificationResponse(new flatbuffers.ByteBuffer(responseBytes));
    const keys = diversifyKeys(testMasterKey, "OwwMachineAuth", Buffer.from(tokenId).toString("hex"));
    expect(Array.from(fbResp.applicationKey()!.unpack().uid)).to.deep.equal(Array.from(Buffer.from(keys.application, "hex")));
    expect(Array.from(fbResp.authorizationKey()!.unpack().uid)).to.deep.equal(Array.from(Buffer.from(keys.authorization, "hex")));
    expect(Array.from(fbResp.reserved1Key()!.unpack().uid)).to.deep.equal(Array.from(Buffer.from(keys.reserved1, "hex")));
    expect(Array.from(fbResp.reserved2Key()!.unpack().uid)).to.deep.equal(Array.from(Buffer.from(keys.reserved2, "hex")));
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