// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Deterministic prep step for `/log-triage`: pull WARNING-and-above Cloud
 * Logging entries, drop the known-benign classes, group them, and print a
 * compact JSON summary.
 *
 * Why a script and not "let the agent run gcloud": the agent should spend
 * its judgment on *what a group means*, not on paging through raw log JSON.
 * Pre-grouping keeps the input small and — more importantly — makes the
 * fingerprints stable, which is what lets triage match a finding against an
 * issue it already opened.
 *
 * Uses the `gcloud` CLI rather than @google-cloud/logging so it runs on the
 * operator's existing login with no service account or ADC setup.
 *
 * Usage:
 *   npx tsx scripts/log-triage-fetch.ts [--hours 24] [--project <id>]...
 *                                       [--include-benign] [--max 2000]
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  summarizeLogEntries,
  type LogGroup,
  type RawLogEntry,
} from "../shared/src/log-triage"

const HERE = dirname(fileURLToPath(import.meta.url))
const BENIGN_PATH = resolve(HERE, "log-triage/known-benign.json")

const DEFAULT_PROJECTS = ["oww-maco", "oww-maco-staging"]

interface BenignRule {
  /** Substring matched against the group's first message line. */
  pattern: string
  /** Why this is noise. Shown when --include-benign is passed. */
  reason: string
  /** When it was added, so stale suppressions can be spotted. */
  addedOn: string
}

interface ProjectReport {
  project: string
  /** Actionable groups: everything not matched by a known-benign rule. */
  groups: LogGroup[]
  /** Suppressed groups, with the rule that matched. Counts only, by default. */
  suppressed: Array<{ message: string; count: number; rule: string }>
  total: number
  dropped: number
  truncated: boolean
  error?: string
}

function parseArgs(argv: string[]): {
  hours: number
  projects: string[]
  includeBenign: boolean
  max: number
} {
  let hours = 24
  let max = 2000
  let includeBenign = false
  const projects: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--hours") hours = Number(argv[(i += 1)])
    else if (arg === "--max") max = Number(argv[(i += 1)])
    else if (arg === "--project") projects.push(argv[(i += 1)])
    else if (arg === "--include-benign") includeBenign = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("--hours must be a positive number")
  }
  return {
    hours,
    max,
    includeBenign,
    projects: projects.length > 0 ? projects : DEFAULT_PROJECTS,
  }
}

function loadBenignRules(): BenignRule[] {
  try {
    return JSON.parse(readFileSync(BENIGN_PATH, "utf8")).rules as BenignRule[]
  } catch (err) {
    throw new Error(
      `Could not read ${BENIGN_PATH}: ${err instanceof Error ? err.message : err}`,
    )
  }
}

/**
 * A GET against a function's URL is never a legitimate call — every
 * function we deploy is a callable (POST) or an event trigger. Excluding
 * them at query time removes Google's post-deploy URL sweep, which is
 * otherwise ~100% of a quiet day's warnings, before it ever reaches the
 * grouping stage.
 */
function buildFilter(since: Date): string {
  return [
    'resource.type="cloud_run_revision"',
    "severity>=WARNING",
    `timestamp>="${since.toISOString()}"`,
    'NOT httpRequest.requestMethod="GET"',
  ].join(" AND ")
}

interface GcloudEntry {
  severity?: string
  timestamp?: string
  textPayload?: string
  jsonPayload?: Record<string, unknown>
  resource?: { labels?: { service_name?: string } }
}

function fetchProject(
  project: string,
  since: Date,
  max: number,
): { entries: RawLogEntry[]; truncated: boolean } {
  const stdout = execFileSync(
    "gcloud",
    [
      "logging",
      "read",
      buildFilter(since),
      `--project=${project}`,
      `--limit=${max}`,
      "--format=json",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  )

  const raw = JSON.parse(stdout) as GcloudEntry[]
  const entries: RawLogEntry[] = raw.map((entry) => {
    let message = ""
    let detail: Record<string, unknown> | undefined
    if (entry.jsonPayload) {
      const { message: payloadMessage, ...rest } = entry.jsonPayload
      message =
        typeof payloadMessage === "string"
          ? payloadMessage
          : JSON.stringify(entry.jsonPayload)
      if (Object.keys(rest).length > 0) detail = rest
    } else if (typeof entry.textPayload === "string") {
      message = entry.textPayload
    }
    return {
      severity: entry.severity ?? "DEFAULT",
      service: entry.resource?.labels?.service_name ?? "unknown",
      timestamp: entry.timestamp ?? "",
      message,
      detail,
    }
  })

  return { entries, truncated: entries.length >= max }
}

function matchingRule(
  group: LogGroup,
  rules: BenignRule[],
): BenignRule | undefined {
  return rules.find((rule) => group.message.includes(rule.pattern))
}

function main(): void {
  const { hours, projects, includeBenign, max } = parseArgs(
    process.argv.slice(2),
  )
  const rules = loadBenignRules()
  const until = new Date()
  const since = new Date(until.getTime() - hours * 3600_000)

  const reports: ProjectReport[] = projects.map((project) => {
    try {
      const { entries, truncated } = fetchProject(project, since, max)
      const summary = summarizeLogEntries(entries, truncated)
      const groups: LogGroup[] = []
      const suppressed: ProjectReport["suppressed"] = []
      for (const group of summary.groups) {
        const rule = includeBenign ? undefined : matchingRule(group, rules)
        if (rule) {
          suppressed.push({
            message: group.message,
            count: group.count,
            rule: rule.reason,
          })
        } else {
          groups.push(group)
        }
      }
      return {
        project,
        groups,
        suppressed,
        total: summary.total,
        dropped: summary.dropped,
        truncated: summary.truncated,
      }
    } catch (err) {
      // One unreachable project must not sink the whole run — the other
      // project's findings are still worth triaging.
      return {
        project,
        groups: [],
        suppressed: [],
        total: 0,
        dropped: 0,
        truncated: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  process.stdout.write(
    `${JSON.stringify(
      {
        window: { since: since.toISOString(), until: until.toISOString(), hours },
        benignRuleCount: rules.length,
        reports,
      },
      null,
      2,
    )}\n`,
  )
}

main()
