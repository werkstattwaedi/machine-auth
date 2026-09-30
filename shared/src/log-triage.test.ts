// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  PROBE_BURST_GAP_MS,
  PROBE_MAX_BURSTS_PER_DAY,
  PROBE_MAX_PER_BURST,
  fingerprintFor,
  groupingKeyForMessage,
  isProbeEntry,
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

const NOT_AUTHENTICATED =
  "The request was not authenticated. Either allow unauthenticated " +
  "invocations or set the proper Authorization header. Empty " +
  "Authorization header value."
const INVALID_METHOD = "Request has invalid method. GET"
const INVALID_REQUEST =
  "Error: Invalid request, unable to process.\n    at entryFromArgs (/workspace/x.js:1:1)"
const MISSING_HEADER = "Missing or invalid Authorization header."

/**
 * The shape of the staging burst of 2026-09-20 20:25:52–20:26:21 UTC
 * (issue #671): every function URL GETted without credentials right after
 * a deploy. Entries are spread evenly over the 29 seconds, first and last
 * on the bounds.
 */
function deployProbeBurst(startIso: string): RawLogEntry[] {
  const get = (status: number) => ({ method: "GET", status, url: "/" })
  const triggerServices = [
    "onbillcreate",
    "onbillupdate",
    "monthlybillrun",
    "synccustomclaims",
    "dailylogdigest",
    "auditcatalog",
    "oncheckoutwrite",
    "syncauthidentity",
    "membershipmaintenance",
    "autoacknowledge",
  ]
  const shapes: Array<Partial<RawLogEntry>> = [
    ...triggerServices.flatMap((service) =>
      Array.from({ length: 4 }, () => ({
        service,
        message: NOT_AUTHENTICATED,
        httpRequest: get(403),
      }))
    ),
    // Application log lines: no request attached.
    { service: "authcall", message: INVALID_METHOD },
    { service: "membershipcall", message: INVALID_METHOD },
    { service: "authcall", severity: "ERROR", message: INVALID_REQUEST },
    { service: "membershipcall", severity: "ERROR", message: INVALID_REQUEST },
    { service: "api", message: MISSING_HEADER },
    { service: "api", message: MISSING_HEADER },
    // The 4xx request rows themselves, without any payload.
    { service: "api", message: "", httpRequest: get(401) },
    { service: "api", message: "", httpRequest: get(401) },
    { service: "authcall", message: "", httpRequest: get(405) },
    { service: "membershipcall", message: "", httpRequest: get(405) },
  ]
  const start = Date.parse(startIso)
  const spanMs = 29_000
  return shapes.map((shape, i) =>
    entry({
      ...shape,
      timestamp: new Date(
        start + Math.round((i * spanMs) / (shapes.length - 1))
      ).toISOString(),
    })
  )
}

const BURST_START = "2026-09-20T20:25:52.000Z"
const BURST_END = "2026-09-20T20:26:21.000Z"

const REAL_WARNINGS: RawLogEntry[] = [
  entry({
    service: "onbillcreate",
    timestamp: "2026-09-20T20:31:00.000Z",
    message: "Bill cMaDy1QOoDznuioGJBNS: no recipient email, skipping",
  }),
  entry({
    service: "logclienterror",
    timestamp: "2026-09-20T20:40:00.000Z",
    message: "clientError: permission-denied",
  }),
]

describe("isProbeEntry", () => {
  const signatures: Array<[string, string]> = [
    ["Cloud Run not authenticated", NOT_AUTHENTICATED],
    ["callable invalid method", INVALID_METHOD],
    ["callable invalid request", INVALID_REQUEST],
    ["api missing header", MISSING_HEADER],
    ["admin api missing header", `Admin API: ${MISSING_HEADER}`],
  ]

  for (const [name, message] of signatures) {
    it(`${name}: probe without a request or on a GET, never on a POST`, () => {
      expect(isProbeEntry(entry({ message }))).toBe(true)
      expect(
        isProbeEntry(
          entry({ message, httpRequest: { method: "GET", status: 403 } })
        )
      ).toBe(true)
      expect(
        isProbeEntry(
          entry({ message, httpRequest: { method: "POST", status: 403 } })
        )
      ).toBe(false)
    })
  }

  it("a request-only 4xx is a probe on GET only", () => {
    const requestOnly = (method: string, status: number) =>
      entry({ message: "", httpRequest: { method, status, url: "/" } })
    expect(isProbeEntry(requestOnly("GET", 401))).toBe(true)
    expect(isProbeEntry(requestOnly("GET", 405))).toBe(true)
    expect(isProbeEntry(requestOnly("POST", 401))).toBe(false)
    expect(isProbeEntry(requestOnly("GET", 200))).toBe(false)
    // A server fault is never folded away, whoever asked.
    expect(isProbeEntry(requestOnly("GET", 500))).toBe(false)
  })

  it("does not take an invalid method other than GET for the sweep", () => {
    expect(
      isProbeEntry(entry({ message: "Request has invalid method. PUT" }))
    ).toBe(false)
  })

  it("leaves ordinary messages alone", () => {
    expect(isProbeEntry(entry())).toBe(false)
    expect(isProbeEntry(entry({ message: "" }))).toBe(false)
    expect(
      isProbeEntry(
        entry({ httpRequest: { method: "GET", status: 400, url: "/" } })
      )
    ).toBe(false)
  })
})

describe("summarizeLogEntries — post-deploy probe", () => {
  it("folds the deploy burst and keeps the two real warnings", () => {
    // The regression of issue #671: this day used to read as ~20 groups
    // with the two real ones somewhere in the middle.
    const burst = deployProbeBurst(BURST_START)
    const summary = summarizeLogEntries([...burst, ...REAL_WARNINGS])

    expect(summary.groups.map((g) => g.message).sort()).toEqual([
      "Bill <id>: no recipient email, skipping",
      "clientError: permission-denied",
    ])
    expect(summary.groups.map((g) => g.fingerprint).sort()).toEqual(
      [
        fingerprintFor("WARNING", "Bill <id>: no recipient email, skipping"),
        fingerprintFor("WARNING", "clientError: permission-denied"),
      ].sort()
    )
    expect(summary.total).toBe(2)
    expect(summary.dropped).toBe(0)
    expect(summary.excluded).toEqual({
      count: burst.length,
      from: BURST_START,
      to: BURST_END,
      bursts: 1,
      reason: "probe",
    })
  })

  it("reports nothing excluded on a day without probes", () => {
    expect(summarizeLogEntries(REAL_WARNINGS).excluded).toBeUndefined()
  })

  it("folds two deploys three hours apart as two bursts", () => {
    const first = deployProbeBurst(BURST_START)
    const second = deployProbeBurst("2026-09-20T23:25:52.000Z")
    const summary = summarizeLogEntries([
      ...second,
      ...REAL_WARNINGS,
      ...first,
    ])
    expect(summary.groups).toHaveLength(2)
    expect(summary.excluded).toMatchObject({
      count: first.length + second.length,
      from: BURST_START,
      to: "2026-09-20T23:26:21.000Z",
      bursts: 2,
    })
  })

  it("lists the probes once one burst exceeds the per-burst limit", () => {
    const burst = deployProbeBurst(BURST_START)
    const folded = summarizeLogEntries(burst, false, {
      probeMaxPerBurst: burst.length,
    })
    expect(folded.excluded?.count).toBe(burst.length)
    expect(folded.total).toBe(0)

    const listed = summarizeLogEntries(burst, false, {
      probeMaxPerBurst: burst.length - 1,
    })
    expect(listed.excluded).toBeUndefined()
    expect(listed.total).toBe(burst.length)
    expect(listed.dropped).toBe(0)
    const messages = listed.groups.map((g) => g.message)
    expect(messages).toContain("Request has invalid method. GET")
    expect(messages).toContain("Error: Invalid request, unable to process.")
    expect(messages).toContain("Missing or invalid Authorization header.")
    // Listed request-only rows read as a request line, not as nothing.
    expect(messages).toContain("GET 401 /")
    expect(messages).toContain("GET 405 /")
  })

  it("lists the probes once there are more bursts than allowed", () => {
    const hourly = (count: number) =>
      Array.from({ length: count }, (_, hour) =>
        entry({
          message: NOT_AUTHENTICATED,
          httpRequest: { method: "GET", status: 403, url: "/" },
          timestamp: new Date(
            Date.parse("2026-09-20T00:00:00.000Z") + hour * 3600_000
          ).toISOString(),
        })
      )

    const atLimit = summarizeLogEntries(hourly(PROBE_MAX_BURSTS_PER_DAY))
    expect(atLimit.excluded?.bursts).toBe(PROBE_MAX_BURSTS_PER_DAY)
    expect(atLimit.groups).toHaveLength(0)

    // A scanner that comes back every hour.
    const over = summarizeLogEntries(hourly(PROBE_MAX_BURSTS_PER_DAY + 1))
    expect(over.excluded).toBeUndefined()
    expect(over.groups).toHaveLength(1)
    expect(over.groups[0].count).toBe(PROBE_MAX_BURSTS_PER_DAY + 1)
  })

  it("does not fold a stream that keeps coming past the burst limit", () => {
    // One entry a minute never opens a gap, so it is a single burst that
    // outgrows the default limit.
    const stream = Array.from({ length: PROBE_MAX_PER_BURST + 1 }, (_, i) =>
      entry({
        message: INVALID_METHOD,
        timestamp: new Date(
          Date.parse("2026-09-20T00:00:00.000Z") + i * 60_000
        ).toISOString(),
      })
    )
    expect(60_000).toBeLessThan(PROBE_BURST_GAP_MS)
    const summary = summarizeLogEntries(stream)
    expect(summary.excluded).toBeUndefined()
    expect(summary.groups[0].count).toBe(PROBE_MAX_PER_BURST + 1)
  })

  it("never treats a POST carrying a probe message as a probe", () => {
    const summary = summarizeLogEntries([
      ...deployProbeBurst(BURST_START),
      entry({
        service: "api",
        timestamp: "2026-09-20T20:26:00.000Z",
        message: MISSING_HEADER,
        httpRequest: { method: "POST", status: 401, url: "/api/usage" },
      }),
    ])
    expect(summary.groups).toHaveLength(1)
    expect(summary.groups[0].message).toBe(MISSING_HEADER)
    expect(summary.groups[0].count).toBe(1)
    expect(summary.total).toBe(1)
  })

  it("groups a non-GET request-only 4xx under its request line", () => {
    const post = (url: string) =>
      entry({
        service: "api",
        message: "",
        httpRequest: { method: "POST", status: 401, url },
      })
    const summary = summarizeLogEntries([
      post("https://api-abc123-oa.a.run.app/ping?key=1"),
      post("/ping"),
    ])
    expect(summary.groups).toHaveLength(1)
    expect(summary.groups[0].message).toBe("POST 401 /ping")
    expect(summary.groups[0].count).toBe(2)
    expect(summary.dropped).toBe(0)
    expect(summary.excluded).toBeUndefined()
  })

  it("lists a probe whose timestamp cannot be placed in a burst", () => {
    const summary = summarizeLogEntries([
      entry({ message: INVALID_METHOD, timestamp: "" }),
    ])
    expect(summary.excluded).toBeUndefined()
    expect(summary.total).toBe(1)
  })
})
