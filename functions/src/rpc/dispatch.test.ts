// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import type { CallableRequest } from "firebase-functions/v2/https";
import { dispatchRpc, type RpcHandler } from "./dispatch";

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
    expect(result).to.deep.equal({ ok: true });
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
});
