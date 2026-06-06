// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest"

// Captured onSnapshot callbacks so the test can drive status transitions.
let nextCbs: Array<(snap: { data: () => unknown }) => void> = []
let errCbs: Array<(err: unknown) => void> = []
let unsubscribed = 0

vi.mock("@modules/lib/firestore-helpers", () => ({
  printJobsCollection: () => ({ __collection: "printJobs" }),
}))

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(async () => ({ id: "job1" })),
  onSnapshot: vi.fn(
    (
      _ref: unknown,
      next: (snap: { data: () => unknown }) => void,
      err: (e: unknown) => void,
    ) => {
      nextCbs.push(next)
      errCbs.push(err)
      return () => {
        unsubscribed++
      }
    },
  ),
  serverTimestamp: () => "SERVER_TIMESTAMP",
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}))

import { addDoc } from "firebase/firestore"
import { enqueuePrintJob } from "./enqueue-print-job"

const fakeDb = {} as never
const args = { bytes: new Uint8Array([1, 2, 3, 4]), tape: "18mm", uid: "u1" }

function emit(data: unknown) {
  nextCbs[nextCbs.length - 1]({ data: () => data })
}

beforeEach(() => {
  nextCbs = []
  errCbs = []
  unsubscribed = 0
})

describe("enqueuePrintJob", () => {
  it("resolves once the job reaches status 'done' and unsubscribes", async () => {
    const p = enqueuePrintJob(fakeDb, args)
    await vi.waitFor(() => expect(nextCbs).toHaveLength(1))
    emit({ status: "printing" }) // intermediate — must not settle
    emit({ status: "done" })
    await expect(p).resolves.toBeUndefined()
    expect(unsubscribed).toBe(1)
  })

  it("rejects with the gateway's German error on status 'error'", async () => {
    const p = enqueuePrintJob(fakeDb, args)
    await vi.waitFor(() => expect(nextCbs).toHaveLength(1))
    emit({ status: "error", error: "Deckel offen" })
    await expect(p).rejects.toThrow("Deckel offen")
    expect(unsubscribed).toBe(1)
  })

  it("propagates a listener error", async () => {
    const p = enqueuePrintJob(fakeDb, args)
    await vi.waitFor(() => expect(errCbs).toHaveLength(1))
    errCbs[0](new Error("permission-denied"))
    await expect(p).rejects.toThrow("permission-denied")
  })

  it("rejects when the job doc cannot be written (no listener leaked)", async () => {
    vi.mocked(addDoc).mockRejectedValueOnce(new Error("permission-denied"))
    await expect(enqueuePrintJob(fakeDb, args)).rejects.toThrow(
      "permission-denied",
    )
    expect(nextCbs).toHaveLength(0)
  })
})
