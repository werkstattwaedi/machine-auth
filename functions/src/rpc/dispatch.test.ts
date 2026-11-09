// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { CLIENT_OUTDATED_REASON, dispatchRpc, type RpcHandler } from "./dispatch";
import { setMinClientVersionLoaderForTest } from "./min_client_version";

function makeRequest(
  data: unknown,
  auth?: CallableRequest["auth"]
): CallableRequest<any> {
  return { data, auth, rawRequest: {} } as unknown as CallableRequest<any>;
}

describe("dispatchRpc", () => {
  it("routes a known method and hands the payload to the handler as data", async () => {
    let seen: unknown;
    const handlers: Record<string, RpcHandler> = {
      doThing: (req) => {
        seen = req.data;
        return { ok: true };
      },
    };

    const result = await dispatchRpc(
      "test",
      handlers,
      makeRequest({ method: "doThing", payload: { a: 1 } })
    );

    expect(seen).to.deep.equal({ a: 1 });
    expect(result).to.deep.equal({ ok: true });
  });

  it("preserves auth on the synthetic request passed to the handler", async () => {
    let seenUid: string | undefined;
    const handlers: Record<string, RpcHandler> = {
      whoAmI: (req) => {
        seenUid = req.auth?.uid;
        return null;
      },
    };

    await dispatchRpc(
      "test",
      handlers,
      makeRequest({ method: "whoAmI", payload: {} }, {
        uid: "user-1",
        token: {},
      } as unknown as CallableRequest["auth"])
    );

    expect(seenUid).to.equal("user-1");
  });

  it("answers ping centrally without consulting handlers or auth", () => {
    // Empty handler map + no auth: the keep-warm ping (ADR-0037) must still
    // succeed — it exists to boot the container before a real call.
    const result = dispatchRpc(
      "test",
      {},
      makeRequest({ method: "ping", payload: {} })
    );
    // Outside a deploy there is no lib/build-info.json (ADR-0045).
    expect(result).to.deep.equal({ ok: true, version: "dev" });
  });

  it("throws not-found for an unknown method", () => {
    expect(() =>
      dispatchRpc("test", {}, makeRequest({ method: "nope", payload: {} }))
    )
      .to.throw()
      .with.property("code", "not-found");
  });

  it("throws invalid-argument when method is missing", () => {
    expect(() =>
      dispatchRpc("test", {}, makeRequest({ payload: {} }))
    )
      .to.throw()
      .with.property("code", "invalid-argument");
  });

  describe("minimum client version (#845)", () => {
    let loads = 0;
    const handlers: Record<string, RpcHandler> = { doThing: () => "done" };
    const call = (clientVersion?: string) =>
      dispatchRpc(
        "test",
        handlers,
        makeRequest({ method: "doThing", payload: {}, clientVersion })
      );

    beforeEach(() => {
      loads = 0;
      setMinClientVersionLoaderForTest(async () => {
        loads++;
        return "2026.11.4";
      });
    });
    afterEach(() => setMinClientVersionLoaderForTest(undefined));

    it("refuses a client older than the minimum", async () => {
      try {
        await call("2026.11.3");
        expect.fail("expected a refusal");
      } catch (err) {
        expect(err).to.be.instanceOf(HttpsError);
        expect((err as HttpsError).code).to.equal("failed-precondition");
        expect((err as HttpsError).details).to.deep.equal({
          reason: CLIENT_OUTDATED_REASON,
          minVersion: "2026.11.4",
        });
      }
    });

    it("lets the minimum and newer through", async () => {
      expect(await call("2026.11.4")).to.equal("done");
      expect(await call("2026.12.1")).to.equal("done");
    });

    it("never checks calls without a release version", async () => {
      expect(await call(undefined)).to.equal("done");
      expect(await call("dev")).to.equal("done");
      expect(loads).to.equal(0);
    });

    it("reads the minimum once a minute, not per call", async () => {
      await call("2026.11.4");
      await call("2026.11.5");
      expect(loads).to.equal(1);
    });

    it("lets calls through while the config is unreadable", async () => {
      setMinClientVersionLoaderForTest(async () => {
        throw new Error("unavailable");
      });
      expect(await call("2026.1.1")).to.equal("done");
    });

    it("waits a minute before reading again after a failed read", async () => {
      let attempts = 0;
      setMinClientVersionLoaderForTest(async () => {
        attempts++;
        throw new Error("unavailable");
      });
      await call("2026.1.1");
      await call("2026.1.1");
      expect(attempts).to.equal(1);
    });
  });
});
