// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Grouping for Cloud Logging entries, shared by the `dailyLogDigest`
 * function and the local `/log-triage` tooling so both see identical
 * groups (and identical fingerprints, which is what lets triage match a
 * finding against an already-open issue).
 *
 * Design note learned the hard way: the first cut keyed groups on
 * (severity, service, message), which turned ONE event — Google's
 * post-deploy sweep GETting every function's root URL — into 42 groups
 * across 40 services. Service is now a *property* of a group, not part of
 * its identity, so a cross-service event reads as one line.
 */

/** Minimal entry shape. Deliberately free of any logging-SDK types. */
export interface RawLogEntry {
  severity: string
  /** Cloud Run service (== function name for our deploys). */
  service: string
  timestamp: string
  message: string
  /** Structured payload minus `message`, rendered into the sample line. */
  detail?: Record<string, unknown>
  /**
   * The request a Cloud Run request-log row belongs to. Absent on
   * application log lines. This is what tells a credential-less GET sweep
   * apart from a real caller — see `isProbeEntry`.
   */
  httpRequest?: LogHttpRequest
}

export interface LogHttpRequest {
  method?: string
  status?: number
  url?: string
}

/** What `summarizeLogEntries` left out of the groups, and why. */
export interface ExcludedLogEntries {
  count: number
  /** Timestamp of the earliest / latest excluded entry. */
  from: string
  to: string
  /** Number of separate bursts the excluded entries fell into. */
  bursts: number
  reason: "probe"
}

export interface LogGroup {
  /** Stable id for (severity, message). Used to dedup against issues. */
  fingerprint: string
  severity: string
  message: string
  /** Every service this group was seen on, ascending. */
  services: string[]
  count: number
  firstTimestamp: string
  lastTimestamp: string
  samples: string[]
}

export interface LogSummary {
  groups: LogGroup[]
  /** Entries listed in `groups` — excluded and dropped ones don't count. */
  total: number
  /** Entries dropped for carrying no message and no request (see below). */
  dropped: number
  /** Probe entries folded out of `groups`; absent when nothing was. */
  excluded?: ExcludedLogEntries
  /** True when the query hit its cap and older entries were cut. */
  truncated: boolean
}

/** Samples kept per group — enough to spot a pattern, not a log dump. */
const SAMPLES_PER_GROUP = 3

/** Message is truncated to this before being used as a grouping key. */
const MESSAGE_KEY_MAX = 120

const SEVERITY_RANK: Record<string, number> = {
  EMERGENCY: 0,
  ALERT: 1,
  CRITICAL: 2,
  ERROR: 3,
  WARNING: 4,
}

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 99
}

/**
 * Volatile identifiers that must not become part of a group's identity.
 *
 * Without this, `Bill <firestoreId>: no recipient email` produces a fresh
 * fingerprint per bill: the same bug reads as many one-off groups, never
 * accumulates a count, and — worst — can never match the issue triage
 * already opened for it. Order matters; emails first, then the narrower
 * hex rule, then the general id rule.
 *
 * The real ids stay visible in each group's `samples`, which is where you
 * actually need them.
 */
const VOLATILE_PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>"],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<uuid>",
  ],
  [/\b[0-9a-f]{12,}\b/gi, "<hex>"],
  [/\b[A-Za-z0-9_-]{20,}\b/g, "<id>"],
]

/**
 * Collapse a message to a stable grouping key. Only the first line is used:
 * Node stack traces put the useful part there and the frames below differ
 * per instance, which would otherwise scatter one recurring fault across
 * dozens of single-count groups. Volatile ids are masked for the same
 * reason — see VOLATILE_PATTERNS.
 */
export function groupingKeyForMessage(message: string): string {
  let firstLine = message.split("\n", 1)[0].trim()
  for (const [pattern, replacement] of VOLATILE_PATTERNS) {
    firstLine = firstLine.replace(pattern, replacement)
  }
  return firstLine.length > MESSAGE_KEY_MAX
    ? firstLine.slice(0, MESSAGE_KEY_MAX)
    : firstLine
}

/**
 * Short, stable, dependency-free hash of the group identity. Used as an
 * issue marker so a recurring problem updates its existing issue instead
 * of opening a new one every day. FNV-1a: not cryptographic, and doesn't
 * need to be — collisions cost a merged issue, nothing more.
 */
export function fingerprintFor(severity: string, message: string): string {
  const input = `${severity}|${message}`
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/** One-line rendering of a structured payload, for the sample list. */
function formatDetail(entry: RawLogEntry): string {
  const detail = entry.detail
  const prefix = `${entry.timestamp} [${entry.service}]`
  if (!detail) return prefix
  const fields = Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
  return fields.length > 0 ? `${prefix} ${fields.join(" ")}` : prefix
}

/**
 * First lines logged when a function URL is requested without credentials.
 * Right after every `firebase deploy --only functions` each URL is GETted
 * once or twice that way, and every such request logs at WARNING or ERROR:
 * ~60 of the 82 entries in the staging digest of 2026-09-21 were this, in
 * ~20 groups, burying the two findings that mattered.
 *
 * These are library texts (Cloud Run, firebase-functions, our `api`
 * middleware). A reworded release makes the probe visible again — noise,
 * never a lost signal.
 */
const PROBE_SIGNATURES: Array<{ text: string; anywhere?: boolean }> = [
  {
    text: "The request was not authenticated. Either allow unauthenticated invocations",
  },
  // Callables only accept POST, and the message names the method that was
  // refused: any other method is somebody's misbehaving client, not the GET
  // sweep.
  { text: "Request has invalid method. GET" },
  { text: "Error: Invalid request, unable to process." },
  // `anywhere`: the admin API logs it as "Admin API: Missing or invalid …".
  { text: "Missing or invalid Authorization header.", anywhere: true },
]

/** Probe entries this close together belong to the same burst. */
export const PROBE_BURST_GAP_MS = 5 * 60_000

/** A burst larger than this is a flood, not a deploy sweep. */
export const PROBE_MAX_PER_BURST = 200

/** More bursts than this in one window is a recurring scanner. */
export const PROBE_MAX_BURSTS_PER_DAY = 8

export interface SummarizeOptions {
  probeBurstGapMs?: number
  probeMaxPerBurst?: number
  probeMaxBurstsPerDay?: number
}

function isRequestOnly(entry: RawLogEntry, key: string): boolean {
  return key.length === 0 && entry.httpRequest !== undefined
}

/**
 * True for an entry produced by a credential-less GET of a function URL.
 *
 * Two conditions, both required:
 *  - it looks like the probe: a known first line, or a request-log row
 *    with no payload of its own that merely records the 4xx (5xx is left
 *    out on purpose — a server fault is never folded away);
 *  - nothing points at a real caller: no request attached, or a GET. Our
 *    clients POST, so a POST carrying the very same message (a gateway
 *    with a broken token, say) is never a probe and stays listed.
 */
export function isProbeEntry(entry: RawLogEntry): boolean {
  const key = groupingKeyForMessage(entry.message)
  const request = entry.httpRequest
  if (request && request.method !== "GET") return false
  // A server fault is never folded away, whatever message it carries.
  if (request?.status !== undefined && request.status >= 500) return false

  if (isRequestOnly(entry, key)) {
    const status = request?.status
    return status !== undefined && status >= 400 && status < 500
  }
  return PROBE_SIGNATURES.some(({ text, anywhere }) =>
    anywhere ? key.includes(text) : key.startsWith(text)
  )
}

/**
 * Stand-in message for a request-log row without a payload, so a 4xx that
 * nothing else explains still shows up as a group: `POST 401 /ping`. Path
 * only — hosts and query strings differ per request and would scatter it.
 */
function requestLine(request: LogHttpRequest): string {
  const withoutOrigin = (request.url ?? "").replace(
    /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i,
    ""
  )
  const path = withoutOrigin.split(/[?#]/, 1)[0] || "/"
  return `${request.method ?? "?"} ${request.status ?? "?"} ${path}`
}

/** Grouping key of an entry; empty when there is nothing to group on. */
function listedMessage(entry: RawLogEntry): string {
  const key = groupingKeyForMessage(entry.message)
  if (key.length > 0 || !entry.httpRequest) return key
  return groupingKeyForMessage(requestLine(entry.httpRequest))
}

/**
 * Decide whether the window's probe entries may be folded away.
 *
 * Clustered by gap rather than measured against one day-wide window on
 * purpose: two deploys three hours apart must both fold, while a stream
 * that keeps coming for twenty minutes must not. Returns undefined when
 * the probes don't look like deploy sweeps (one burst too large, or too
 * many bursts) — the caller then lists every one of them, so a real
 * unauthenticated flood reads exactly as it did before this existed.
 */
function foldProbeBursts(
  probes: Array<{ entry: RawLogEntry; at: number }>,
  opts: SummarizeOptions
): ExcludedLogEntries | undefined {
  if (probes.length === 0) return undefined
  const gapMs = opts.probeBurstGapMs ?? PROBE_BURST_GAP_MS
  const maxPerBurst = opts.probeMaxPerBurst ?? PROBE_MAX_PER_BURST
  const maxBursts = opts.probeMaxBurstsPerDay ?? PROBE_MAX_BURSTS_PER_DAY

  const sorted = [...probes].sort((a, b) => a.at - b.at)
  let bursts = 1
  let size = 0
  let previous = sorted[0].at
  for (const { at } of sorted) {
    if (at - previous > gapMs) {
      bursts += 1
      size = 0
    }
    size += 1
    if (size > maxPerBurst || bursts > maxBursts) return undefined
    previous = at
  }

  return {
    count: sorted.length,
    from: sorted[0].entry.timestamp,
    to: sorted[sorted.length - 1].entry.timestamp,
    bursts,
    reason: "probe",
  }
}

/**
 * Group entries by (severity, first message line) and rank them.
 *
 * Post-deploy probe entries (`isProbeEntry`) are kept out of the groups and
 * reported as `excluded` — unless they exceed the burst thresholds, in
 * which case they are listed like everything else.
 *
 * A request-log row without a payload groups under a synthetic request
 * line. Entries with neither message nor request are dropped, not grouped:
 * they say nothing. The count is reported as `dropped` rather than
 * silently swallowed.
 */
export function summarizeLogEntries(
  entries: RawLogEntry[],
  truncated = false,
  opts: SummarizeOptions = {}
): LogSummary {
  const groups = new Map<string, LogGroup>()
  let dropped = 0
  let kept = 0

  const probes: Array<{ entry: RawLogEntry; at: number }> = []
  const others: RawLogEntry[] = []
  for (const entry of entries) {
    // An entry without a usable timestamp can't be placed in a burst, so
    // it is listed rather than guessed at.
    const at = Date.parse(entry.timestamp)
    if (Number.isFinite(at) && isProbeEntry(entry)) probes.push({ entry, at })
    else others.push(entry)
  }
  const excluded = foldProbeBursts(probes, opts)

  for (const entry of excluded ? others : entries) {
    const message = listedMessage(entry)
    if (message.length === 0) {
      dropped += 1
      continue
    }
    kept += 1
    const key = `${entry.severity}|${message}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      if (entry.timestamp > existing.lastTimestamp) {
        existing.lastTimestamp = entry.timestamp
      }
      if (entry.timestamp < existing.firstTimestamp) {
        existing.firstTimestamp = entry.timestamp
      }
      if (!existing.services.includes(entry.service)) {
        existing.services.push(entry.service)
      }
      if (existing.samples.length < SAMPLES_PER_GROUP) {
        existing.samples.push(formatDetail(entry))
      }
      continue
    }
    groups.set(key, {
      fingerprint: fingerprintFor(entry.severity, message),
      severity: entry.severity,
      message,
      services: [entry.service],
      count: 1,
      firstTimestamp: entry.timestamp,
      lastTimestamp: entry.timestamp,
      samples: [formatDetail(entry)],
    })
  }

  const ranked = [...groups.values()]
    .map((group) => ({ ...group, services: [...group.services].sort() }))
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        b.count - a.count ||
        a.message.localeCompare(b.message)
    )

  return {
    groups: ranked,
    total: kept,
    dropped,
    truncated,
    ...(excluded ? { excluded } : {}),
  }
}
