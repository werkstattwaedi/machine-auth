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
  total: number
  /** Entries dropped for carrying no message at all (see below). */
  dropped: number
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
 * Group entries by (severity, first message line) and rank them.
 *
 * Entries with no message are dropped, not grouped: Cloud Run emits
 * httpRequest-only rows alongside the real log line for the same request,
 * so keeping them produced empty-message groups that duplicated the
 * neighbouring real group and said nothing. The count is reported as
 * `dropped` rather than silently swallowed.
 */
export function summarizeLogEntries(
  entries: RawLogEntry[],
  truncated = false
): LogSummary {
  const groups = new Map<string, LogGroup>()
  let dropped = 0
  let kept = 0

  for (const entry of entries) {
    const message = groupingKeyForMessage(entry.message)
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

  return { groups: ranked, total: kept, dropped, truncated }
}
