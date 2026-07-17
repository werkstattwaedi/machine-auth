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

export type RpcHandler = (
  request: CallableRequest<any>
) => unknown | Promise<unknown>;

interface RpcEnvelope {
  method?: string;
  payload?: unknown;
}

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
  if (method === "ping") {
    return { ok: true };
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
  return handler(subRequest);
}
