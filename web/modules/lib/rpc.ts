// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Client wrapper for the grouped callable dispatchers (#277).
 *
 * The backend collapsed ~20 individual `onCall` functions into four domain
 * dispatchers (authCall / membershipCall / billingCall / catalogCall) so a
 * session reuses one warm instance per domain instead of cold-starting each
 * function. On the wire each dispatcher takes a `{ method, payload }` envelope.
 *
 * `rpcCallable` mirrors `httpsCallable`: it returns a function you call with
 * the payload and `await` for an `HttpsCallableResult<Res>` (i.e. `.data`),
 * so call sites swap `httpsCallable(functions, "purchaseMembership")` for
 * `rpcCallable(functions, "membershipCall", "purchaseMembership")` and leave
 * the rest of the call unchanged.
 *
 * `RpcMethod` is the central registry of which method lives in which group —
 * the one place to look when adding or moving a callable.
 *
 * `reportRpcError` is the telemetry hook for background RPCs whose failures
 * are otherwise swallowed (fetch-and-degrade UI); see ADR-0025 for the
 * client-error telemetry contract.
 */

import {
  httpsCallable,
  type Functions,
  type HttpsCallableResult,
} from "firebase/functions"
import { getClientSessionId } from "./client-session"

export type RpcGroup =
  | "authCall"
  | "membershipCall"
  | "billingCall"
  | "catalogCall"

/** Method names per group (mirrors the server-side dispatcher handler maps). */
export const RpcMethod = {
  authCall: [
    "createUser",
    "checkAccountExists",
    "checkPhoneAccountExists",
    "requestLoginCode",
    "verifyLoginCode",
    "verifyLoginCodeKiosk",
    "exchangeKioskSession",
    "verifyMagicLink",
    "resolveTag",
    "verifyTagCheckout",
    "probeTag",
  ],
  membershipCall: [
    "purchaseMembership",
    "inviteFamilyMember",
    "getFamilyInviteInfo",
    "listMyFamilyInvites",
    "acceptFamilyInvite",
    "acceptFamilyInviteNewAccount",
    "rejectFamilyInvite",
    "revokeFamilyInvite",
    "removeFamilyMember",
    "createManagedMember",
    "cancelMembership",
    "cancelMembershipAutoRenew",
    "adminCreateMembership",
    "adminExtendMembership",
  ],
  billingCall: [
    "getInvoiceDownloadUrl",
    "getPaymentQrData",
    "closeCheckoutAndGetPayment",
    "acknowledgeBill",
    "adminMarkBillsPaid",
  ],
  catalogCall: [
    "getPriceListPdfUrl",
    "upsertCatalogItem",
    "previewCatalogImport",
    "applyCatalogImport",
  ],
} as const

export function rpcCallable<Req = unknown, Res = unknown>(
  functions: Functions,
  group: RpcGroup,
  method: string
): (payload: Req) => Promise<HttpsCallableResult<Res>> {
  const fn = httpsCallable<{ method: string; payload: Req }, Res>(
    functions,
    group
  )
  return (payload: Req) => fn({ method, payload })
}

/**
 * Fire-and-forget telemetry for a failed RPC whose error is otherwise
 * swallowed by the caller (background fetches that degrade to an empty UI,
 * like the pending-invites banner). Mirrors `reportQueryError` in
 * `firestore.ts`: logs to console and to Cloud Logging via `logClientError`.
 * Never throws. `context` must not contain user-specific values.
 */
export function reportRpcError(
  functions: Functions,
  context: string,
  group: RpcGroup,
  method: string,
  err: unknown
): void {
  const sessionId = getClientSessionId()
  const e = (err ?? {}) as { code?: unknown; name?: unknown; message?: unknown }
  const code = String(e.code ?? e.name ?? "unknown")
  // Same 200-char cap as useAsyncMutation (ADR-0025): app-level errors could
  // theoretically contain user data; the server caps again as second line of
  // defence.
  const message = (
    typeof e.message === "string" ? e.message : String(err)
  ).slice(0, 200)
  const path = `${group}.${method}`
  // eslint-disable-next-line no-console
  console.error("[rpc] error", { path, context, code, message, sessionId })

  try {
    httpsCallable(functions, "logClientError")({
      sessionId,
      context,
      code,
      message,
      path,
      userAgent:
        typeof navigator !== "undefined" ? (navigator.userAgent ?? "") : "",
    }).catch(() => {
      // Swallow: telemetry failure must never surface to the UI.
    })
  } catch {
    // Swallow synchronous init errors for the same reason.
  }
}

// Keep-warm pings (ADR-0037). A dispatcher's first call of the day pays the
// container cold start; UI surfaces that know a call is imminent (login page
// → authCall, checkout wizard → billingCall, …) fire a no-op ping on mount
// so the instance is warm before the user submits. The server answers
// `ping` centrally in dispatchRpc.
const warmedAt = new Map<RpcGroup, number>()
// Instances idle out after ~15 min; the TTL only prevents rapid remounts
// from spamming pings, so a few minutes is plenty.
const PREWARM_TTL_MS = 4 * 60_000

/**
 * Fire-and-forget keep-warm ping for a dispatcher group, deduped per group
 * for PREWARM_TTL_MS. Never throws and never surfaces errors — a failed
 * prewarm must not affect the UI.
 */
export function prewarm(functions: Functions, group: RpcGroup): void {
  const last = warmedAt.get(group)
  if (last !== undefined && Date.now() - last < PREWARM_TTL_MS) return
  warmedAt.set(group, Date.now())
  httpsCallable(functions, group)({ method: "ping", payload: {} }).catch(
    () => {
      // Allow a retry on the next mount after a failed warm.
      warmedAt.delete(group)
    }
  )
}

/** Test hook: clear the prewarm dedupe state. */
export function resetPrewarmForTest(): void {
  warmedAt.clear()
}
