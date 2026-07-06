// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { Functions } from "firebase/functions"
import { rpcCallable } from "@modules/lib/rpc"
import {
  MAX_BILLS_PER_CALL,
  type MarkBillPaidInput,
  type MarkBillsPaidRequest,
  type MarkBillsPaidResult,
} from "@oww/shared"

export type { MarkBillPaidInput, MarkBillsPaidResult }

/**
 * Book payments via the admin-gated `adminMarkBillsPaid` callable,
 * transparently chunking past the server's per-call cap — a bank
 * statement covering a Sammelrechnung cycle can match more than
 * {@link MAX_BILLS_PER_CALL} invoices. Results are aggregated; a chunk
 * failure throws after earlier chunks were booked (safe: booking is
 * idempotent, a retry skips them as alreadyPaid).
 */
export async function bookBillsPaid(
  functions: Functions,
  bills: MarkBillPaidInput[],
): Promise<MarkBillsPaidResult> {
  const fn = rpcCallable<MarkBillsPaidRequest, MarkBillsPaidResult>(
    functions,
    "billingCall",
    "adminMarkBillsPaid",
  )
  const total: MarkBillsPaidResult = { paid: 0, alreadyPaid: [], rejected: [] }
  for (let i = 0; i < bills.length; i += MAX_BILLS_PER_CALL) {
    const res = await fn({ bills: bills.slice(i, i + MAX_BILLS_PER_CALL) })
    total.paid += res.data.paid
    total.alreadyPaid.push(...res.data.alreadyPaid)
    total.rejected.push(...res.data.rejected)
  }
  return total
}
