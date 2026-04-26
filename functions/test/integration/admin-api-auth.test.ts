// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import express from "express";
import request from "supertest";
import { getAuth } from "firebase-admin/auth";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
} from "../emulator-helper";
import { adminApp, adminAuthMiddleware } from "../../src/admin-api";

/**
 * Integration tests for the admin API authentication middleware.
 *
 * Verifies the middleware accepts Firebase Auth ID tokens carrying the
 * `admin: true` custom claim and rejects everything else. The middleware
 * deliberately does not consult Firestore — confirmed by the success-path
 * test, which leaves `users/{uid}` empty.
 */
describe("Admin API auth middleware (Integration)", () => {
  // Auth emulator host is set by `firebase emulators:exec`; fall back to the
  // default firebase.e2e.json port for local invocations.
  const AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9199";
  // The Auth emulator accepts any non-empty string as the Web API key.
  const FAKE_WEB_API_KEY = "fake-api-key";

  /**
   * Mint an ID token (the kind a browser SDK sends as a Bearer header) for
   * `uid` via the Auth emulator's REST endpoint. Includes whatever custom
   * claims have already been set on the user via `setCustomUserClaims`.
   */
  async function mintIdToken(uid: string): Promise<string> {
    const customToken = await getAuth().createCustomToken(uid);
    const url = `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FAKE_WEB_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Auth emulator signInWithCustomToken failed (${res.status}): ${body}`
      );
    }
    const json = (await res.json()) as { idToken: string };
    return json.idToken;
  }

  /**
   * Build a minimal express app that uses the same auth middleware as the
   * real adminApp, with a single `/protected` route that records who passed
   * through. We don't reuse `adminApp` itself because its routes call out
   * to the Particle Cloud and require secrets that aren't available here.
   */
  function buildTestApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.use(adminAuthMiddleware);
    app.get("/protected", (req, res) => {
      const user = (req as express.Request & { user?: { uid?: string } }).user;
      res.status(200).json({ ok: true, uid: user?.uid });
    });
    return app;
  }

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    // Wipe Auth users between tests so UID reuse is safe.
    const list = await getAuth().listUsers(1000);
    if (list.users.length > 0) {
      await getAuth().deleteUsers(list.users.map((u) => u.uid));
    }
  });

  describe("Authorization header validation", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const res = await request(buildTestApp()).get("/protected");
      expect(res.status).to.equal(401);
      expect(res.body).to.deep.equal({ error: "Unauthorized" });
    });

    it("returns 401 when Authorization header is malformed", async () => {
      const res = await request(buildTestApp())
        .get("/protected")
        .set("Authorization", "NotBearer something");
      expect(res.status).to.equal(401);
      expect(res.body).to.deep.equal({ error: "Unauthorized" });
    });

    it("returns 401 when bearer token is not a valid ID token", async () => {
      const res = await request(buildTestApp())
        .get("/protected")
        .set("Authorization", "Bearer not-a-real-token");
      expect(res.status).to.equal(401);
      expect(res.body).to.deep.equal({ error: "Invalid token" });
    });
  });

  describe("Admin claim enforcement", () => {
    it("returns 403 when the verified token has no admin claim", async () => {
      const uid = "user-without-admin";
      await getAuth().createUser({ uid, email: "user@example.com" });
      // No custom claims set => `admin` is undefined on the decoded token.
      const idToken = await mintIdToken(uid);

      const res = await request(buildTestApp())
        .get("/protected")
        .set("Authorization", `Bearer ${idToken}`);

      expect(res.status).to.equal(403);
      expect(res.body).to.deep.equal({ error: "Admin access required" });
    });

    it("returns 403 when the admin claim is present but not strictly true", async () => {
      const uid = "user-truthy-admin";
      await getAuth().createUser({ uid, email: "truthy@example.com" });
      // Strict equality `=== true` should reject other truthy values.
      await getAuth().setCustomUserClaims(uid, { admin: "yes" });
      const idToken = await mintIdToken(uid);

      const res = await request(buildTestApp())
        .get("/protected")
        .set("Authorization", `Bearer ${idToken}`);

      expect(res.status).to.equal(403);
      expect(res.body).to.deep.equal({ error: "Admin access required" });
    });

    it("admits a user whose token carries admin: true without reading Firestore", async () => {
      const uid = "real-admin-user";
      await getAuth().createUser({ uid, email: "admin@example.com" });
      await getAuth().setCustomUserClaims(uid, { admin: true });
      // Deliberately do NOT seed `users/{uid}` in Firestore. The middleware
      // must accept this token solely on the strength of the custom claim.
      const idToken = await mintIdToken(uid);

      const res = await request(buildTestApp())
        .get("/protected")
        .set("Authorization", `Bearer ${idToken}`);

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ ok: true, uid });
    });
  });

  describe("Rate limiting", () => {
    // The limiter on `adminApp` reads its budget from `ADMIN_RATE_LIMIT` per
    // request, so we shrink the window to a handful of requests for the test
    // and restore the production default afterwards.
    const ADMIN_RATE_LIMIT_FOR_TEST = 5;
    let originalLimit: string | undefined;

    before(() => {
      originalLimit = process.env.ADMIN_RATE_LIMIT;
      process.env.ADMIN_RATE_LIMIT = String(ADMIN_RATE_LIMIT_FOR_TEST);
    });

    after(() => {
      if (originalLimit === undefined) {
        delete process.env.ADMIN_RATE_LIMIT;
      } else {
        process.env.ADMIN_RATE_LIMIT = originalLimit;
      }
    });

    it("returns 429 once the per-IP request budget is exhausted", async () => {
      // Fire `limit` requests that each fail auth (401) — the limiter still
      // counts them because it sits before the auth middleware. The next
      // request must be rejected with 429 by the limiter itself.
      const within = await Promise.all(
        Array.from({ length: ADMIN_RATE_LIMIT_FOR_TEST }, () =>
          request(adminApp).get("/particle/devices")
        )
      );
      for (const res of within) {
        expect(res.status).to.equal(401);
      }

      const overflow = await request(adminApp).get("/particle/devices");
      expect(overflow.status).to.equal(429);
    });
  });
});
