// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  fingerprintFor,
  groupingKeyForMessage,
  summarizeLogEntries,
  type RawLogEntry,
} from "./log-triage"

function entry(overrides: Partial<RawLogEntry> = {}): RawLogEntry {
  return {
    severity: "WARNING",
    service: "authcall",
    timestamp: "2026-07-26T05:00:00.000Z",
    message: "SDM counter replay rejected",
    ...overrides,
  }
}

describe("groupingKeyForMessage", () => {
  it("collapses a stack trace to its first line", () => {
    const key = groupingKeyForMessage(
      "Error: Invalid request, unable to process.\n    at entryFromArgs (/workspace/x.js:1:1)\n    at Object.error (/y.js:2:2)"
    )
    expect(key).toBe("Error: Invalid request, unable to process.")
  })

  it("truncates very long first lines so they still group", () => {
    // Real prose, not one long token — a 300-char unbroken run is an
    // opaque id and is correctly masked by the volatile-id rules instead.
    const long = "failed to reconcile the pending entry ".repeat(10)
    expect(groupingKeyForMessage(long)).toHaveLength(120)
  })

  it("masks a Firestore id so the same bug groups across records", () => {
    // The regression: one undelivered-invoice bug across two bills used to
    // produce two fingerprints, so it never matched its own open issue.
    const a = groupingKeyForMessage(
      "Bill cMaDy1QOoDznuioGJBNS: no recipient email, skipping"
    )
    const b = groupingKeyForMessage(
      "Bill u5uSbkZPSWTNQn83OP1S: no recipient email, skipping"
    )
    expect(a).toBe("Bill <id>: no recipient email, skipping")
    expect(a).toBe(b)
  })

  it("masks token ids, uuids and email addresses", () => {
    expect(groupingKeyForMessage("token 04741a322b1690 rejected")).toBe(
      "token <hex> rejected"
    )
    expect(
      groupingKeyForMessage("job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed")
    ).toBe("job <uuid> failed")
    expect(groupingKeyForMessage("no user for tester@example.com")).toBe(
      "no user for <email>"
    )
  })

  it("leaves short, non-volatile text alone", () => {
    expect(groupingKeyForMessage("SDM counter replay rejected")).toBe(
      "SDM counter replay rejected"
    )
    expect(groupingKeyForMessage("Bill 42 skipped")).toBe("Bill 42 skipped")
  })
})

describe("fingerprintFor", () => {
  it("is stable for the same identity", () => {
    expect(fingerprintFor("ERROR", "boom")).toBe(fingerprintFor("ERROR", "boom"))
  })

  it("differs across severity and message", () => {
    expect(fingerprintFor("ERROR", "boom")).not.toBe(
      fingerprintFor("WARNING", "boom")
    )
    expect(fingerprintFor("ERROR", "boom")).not.toBe(
      fingerprintFor("ERROR", "bang")
    )
  })
})

describe("summarizeLogEntries", () => {
  it("groups repeats and tracks the time span", () => {
    const summary = summarizeLogEntries([
      entry({ timestamp: "2026-07-26T05:00:00.000Z" }),
      entry({ timestamp: "2026-07-26T06:00:00.000Z" }),
      entry({ timestamp: "2026-07-26T04:00:00.000Z" }),
    ])
    expect(summary.groups).toHaveLength(1)
    expect(summary.groups[0].count).toBe(3)
    expect(summary.groups[0].firstTimestamp).toBe("2026-07-26T04:00:00.000Z")
    expect(summary.groups[0].lastTimestamp).toBe("2026-07-26T06:00:00.000Z")
  })

  it("rolls one cross-service event into a single group", () => {
    // The regression this module exists for: the post-deploy sweep hit 40
    // services with the identical message and used to produce 40 groups.
    const services = ["authcall", "billingcall", "membershipcall", "catalogcall"]
    const summary = summarizeLogEntries(
      services.map((service) =>
        entry({ severity: "ERROR", message: "Invalid request", service })
      )
    )
    expect(summary.groups).toHaveLength(1)
    expect(summary.groups[0].count).toBe(4)
    expect(summary.groups[0].services).toEqual([
      "authcall",
      "billingcall",
      "catalogcall",
      "membershipcall",
    ])
  })

  it("drops message-less entries and reports how many", () => {
    const summary = summarizeLogEntries([
      entry(),
      entry({ message: "" }),
      entry({ message: "   " }),
    ])
    expect(summary.groups).toHaveLength(1)
    expect(summary.total).toBe(1)
    expect(summary.dropped).toBe(2)
  })

  it("ranks ERROR above WARNING, then by count", () => {
    const summary = summarizeLogEntries([
      entry({ message: "warn a" }),
      entry({ message: "warn a" }),
      entry({ message: "warn a" }),
      entry({ severity: "ERROR", message: "boom" }),
    ])
    expect(summary.groups.map((g) => g.message)).toEqual(["boom", "warn a"])
  })

  it("caps samples per group at three but keeps counting", () => {
    const summary = summarizeLogEntries(
      Array.from({ length: 10 }, () => entry())
    )
    expect(summary.groups[0].count).toBe(10)
    expect(summary.groups[0].samples).toHaveLength(3)
  })

  it("renders structured detail and service into the sample line", () => {
    const summary = summarizeLogEntries([
      entry({ detail: { tokenId: "04741a322b1690", incomingCounter: 14 } }),
    ])
    expect(summary.groups[0].samples[0]).toContain("[authcall]")
    expect(summary.groups[0].samples[0]).toContain("tokenId=04741a322b1690")
    expect(summary.groups[0].samples[0]).toContain("incomingCounter=14")
  })

  it("gives every group a fingerprint matching its identity", () => {
    const summary = summarizeLogEntries([entry({ severity: "ERROR" })])
    expect(summary.groups[0].fingerprint).toBe(
      fingerprintFor("ERROR", "SDM counter replay rejected")
    )
  })
})
