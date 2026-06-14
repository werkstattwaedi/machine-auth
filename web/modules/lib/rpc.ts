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
 */

import {
  httpsCallable,
  type Functions,
  type HttpsCallableResult,
} from "firebase/functions"

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
    "requestLoginCode",
    "verifyLoginCode",
    "verifyMagicLink",
    "resolveTag",
    "verifyTagCheckout",
  ],
  membershipCall: [
    "purchaseMembership",
    "inviteFamilyMember",
    "acceptFamilyInvite",
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
  ],
  catalogCall: [
    "getPriceListPdfUrl",
    "upsertCatalogItem",
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
