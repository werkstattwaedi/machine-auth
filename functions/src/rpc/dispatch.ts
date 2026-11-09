// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared dispatcher for the grouped callable functions (#277).
 *
 * Many low-traffic `onCall` functions each paid a cold start because no
 * single one saw enough traffic to stay warm. Grouping a domain's callables
 * behind one function (authCall, membershipCall, billingCall, catalogCall)
 * pools their traffic onto one warm instance, so a session that touches
 * several of them reuses the same container instead of cold-starting each.
 *
 * The wire contract is a `{ method, payload }` envelope. Each former callable
 * body is now an `RpcHandler` invoked with a synthetic request that carries
 * the real `auth` / `rawRequest` but swaps `data` for the method payload —
 * so the extracted handler bodies are unchanged.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { isBelowMinVersion, parseBuildVersion } from "@oww/shared";
import { BUILD_VERSION } from "../util/build_info";
import { getMinClientVersion } from "./min_client_version";

export type RpcHandler = (
  request: CallableRequest<any>
) => unknown | Promise<unknown>;

interface RpcEnvelope {
  method?: string;
  payload?: unknown;
  /** Release version of the calling web app (#845); absent for scripts. */
  clientVersion?: string;
}

/**
 * `details.reason` of the `failed-precondition` a client older than
 * `config/clients.minVersion` gets; the web client shows its reload screen
 * on it (`web/modules/lib/client-version.tsx`).
 */
export const CLIENT_OUTDATED_REASON = "client-outdated";

export function dispatchRpc(
  group: string,
  handlers: Record<string, RpcHandler>,
  request: CallableRequest<RpcEnvelope>
): unknown | Promise<unknown> {
  const method = request.data?.method;
  if (typeof method !== "string" || method.length === 0) {
    throw new HttpsError("invalid-argument", "Missing RPC 'method'");
  }
  // Keep-warm ping (ADR-0037): handled centrally so every dispatcher group
  // supports it. Answered before the handler lookup and per-handler auth by
  // design — an unauthenticated ping still boots the container, which is
  // the whole point. Placed before the request log to keep pings out of it.
  // Reports the deployed release version (ADR-0045) — public anyway.
  if (method === "ping") {
    return { ok: true, version: BUILD_VERSION };
  }
  const handler = handlers[method];
  if (!handler) {
    throw new HttpsError("not-found", `Unknown method ${group}/${method}`);
  }
  logger.info("rpc", { group, method });
  const subRequest = {
    ...request,
    data: request.data?.payload,
  } as CallableRequest<any>;
  // Only a call that reports a release version is checked: scripts (privacy
  // CLI) and web apps from before #845 send none, and "dev" builds are never
  // blocked. The Firestore lookup is skipped for them too.
  const clientVersion = request.data?.clientVersion;
  if (typeof clientVersion === "string" && parseBuildVersion(clientVersion)) {
    return refuseOutdated(group, method, clientVersion).then(() =>
      handler(subRequest)
    );
  }
  return handler(subRequest);
}

async function refuseOutdated(
  group: string,
  method: string,
  clientVersion: string
): Promise<void> {
  const min = await getMinClientVersion();
  if (!isBelowMinVersion(clientVersion, min)) return;
  // Expected after every forced update — not an error (log policy).
  logger.info("rpc refused: client outdated", { group, method, clientVersion, min });
  throw new HttpsError(
    "failed-precondition",
    "Diese Version der App ist veraltet. Bitte lade die Seite neu.",
    { reason: CLIENT_OUTDATED_REASON, minVersion: min }
  );
}
