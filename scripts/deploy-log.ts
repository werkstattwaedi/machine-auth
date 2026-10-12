// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Deploy log model and STATE.md rendering (ADR-0045).
 *
 * The log is an append-only JSONL file in the operations repo
 * (`deploys/log.jsonl`) — one entry per deploy, flash, kiosk build or
 * manual ops event. STATE.md is always regenerated from it, never edited
 * by hand, so the overview cannot drift from the record.
 *
 * Pure functions only; the git/file side effects live in deploy-record.ts.
 */

export const ENVS = ["staging", "prod"] as const;
export type DeployEnv = (typeof ENVS)[number];

export const COMPONENTS = [
  "firebase", // functions + rules/indexes + hosting (scripts/deploy.sh)
  "gateway",
  "kiosk",
  "firmware",
  "ops", // manual events: secret rotation, migrations, config, restores
] as const;
export type DeployComponent = (typeof COMPONENTS)[number];

export interface DeployEntry {
  /** ISO timestamp (UTC). */
  at: string;
  env: DeployEnv;
  component: DeployComponent;
  /** Gateway host, device id — where a component has several instances. */
  target?: string;
  /** machine-auth commit; absent for manual ops events. */
  commit?: string;
  /** Working tree had uncommitted changes (submodules ignored). */
  dirty?: boolean;
  /** Component version where one exists (kiosk package.json). */
  version?: string;
  by: string;
  note?: string;
  /** machine-auth git tag created for this deploy. */
  tag?: string;
  /**
   * Set when the deploy overrode the latest-main preflight
   * (deploy-preflight.ts): why the checkouts were not latest main.
   */
  offMain?: string[];
}

const REPO_URL = "https://github.com/werkstattwaedi/machine-auth";

/**
 * Lenient on purpose: one truncated line or leftover merge marker must not
 * stop every later deploy from being recorded. Bad lines go to `onBad`.
 */
export function parseLog(
  text: string,
  onBad: (line: string) => void = () => {}
): DeployEntry[] {
  const entries: DeployEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      const entry = JSON.parse(line) as DeployEntry;
      if (typeof entry?.at === "string" && typeof entry.env === "string") {
        entries.push(entry);
        continue;
      }
    } catch {
      // fall through
    }
    onBad(line);
  }
  return entries;
}

export function serializeEntry(entry: DeployEntry): string {
  return JSON.stringify(entry) + "\n";
}

/**
 * Tag name for a deploy. The target is deliberately not part of it (it is
 * in the annotation): a firmware rollout would otherwise mint one tag per
 * device in a public repo.
 */
export function deployTagName(
  env: DeployEnv,
  component: DeployComponent,
  at: Date
): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15); // YYYYMMDD-HHMMSS
  return `deploy/${env}/${component}/${stamp}`;
}

function stateKey(e: DeployEntry): string {
  return `${e.component}|${e.env}|${e.target ?? ""}`;
}

/** Components with several instances; an entry without a target says nothing about any one of them. */
const MULTI_INSTANCE: readonly DeployComponent[] = ["gateway", "firmware"];

/**
 * Latest entry per (component, env, target). Ops events and multi-instance
 * entries without a target (e.g. a flash whose device id was unknown) stay
 * in the history only — as a "current" row they would claim to describe
 * every unidentified device at once.
 */
export function currentState(entries: DeployEntry[]): DeployEntry[] {
  const latest = new Map<string, DeployEntry>();
  for (const e of entries) {
    if (e.component === "ops") continue;
    if (MULTI_INSTANCE.includes(e.component) && !e.target) continue;
    const prev = latest.get(stateKey(e));
    if (!prev || prev.at <= e.at) latest.set(stateKey(e), e);
  }
  const order = (c: DeployComponent) => COMPONENTS.indexOf(c);
  return [...latest.values()].sort(
    (a, b) =>
      order(a.component) - order(b.component) ||
      ENVS.indexOf(a.env) - ENVS.indexOf(b.env) ||
      (a.target ?? "").localeCompare(b.target ?? "")
  );
}

export function formatTime(iso: string): string {
  // Zurich wall-clock time: what the person who deployed saw on their clock.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function commitCell(e: DeployEntry): string {
  if (!e.commit) return "–";
  const link = `[\`${e.commit.slice(0, 8)}\`](${REPO_URL}/commit/${e.commit})`;
  const flags = [e.offMain?.length ? "⚠️ off main" : "", e.dirty ? "⚠️ dirty" : ""];
  return [link, ...flags].filter(Boolean).join(" ");
}

function noteText(e: DeployEntry, withVersion: boolean): string {
  return [
    withVersion && e.version ? `v${e.version}` : "",
    e.note ?? "",
    e.offMain?.length ? `off main: ${e.offMain.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
}

function cell(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Facts computed from the machine-auth checkout at render time. Optional:
 * a render without the code repo (or without network) still produces a
 * valid STATE.md, just without the drift lines.
 */
export interface RepoFacts {
  /** Commits on origin/main not yet in the latest prod firebase deploy. */
  mainAheadOfProd?: number;
  /** Commits in the latest staging firebase deploy not yet in prod. */
  stagingAheadOfProd?: number;
}

export function renderState(
  entries: DeployEntry[],
  facts: RepoFacts = {},
  now: Date = new Date()
): string {
  const lines: string[] = [];
  lines.push("# Deploy state");
  lines.push("");
  lines.push(
    "_Generated by `machine-auth/scripts/deploy-record.ts` from " +
      "[`deploys/log.jsonl`](deploys/log.jsonl) — do not edit by hand. " +
      "Log a manual step with `npx tsx scripts/deploy-record.ts event " +
      '--env prod --note "…"`._'
  );
  lines.push("");
  lines.push(`Rendered ${formatTime(now.toISOString())} (Europe/Zurich).`);
  lines.push("");

  lines.push("## Current");
  lines.push("");
  const state = currentState(entries);
  if (state.length === 0) {
    lines.push("Nothing recorded yet.");
  } else {
    lines.push("| Component | Env | Target | Commit | Version | Deployed | By | Note |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const e of state) {
      lines.push(
        `| ${e.component} | ${e.env} | ${cell(e.target)} | ${commitCell(e)} | ` +
          `${cell(e.version)} | ${formatTime(e.at)} | ${cell(e.by)} | ${cell(noteText(e, false))} |`
      );
    }
  }
  lines.push("");

  const drift: string[] = [];
  if (facts.stagingAheadOfProd !== undefined) {
    drift.push(
      `- Staging is **${facts.stagingAheadOfProd}** commit(s) ahead of prod (firebase).`
    );
  }
  if (facts.mainAheadOfProd !== undefined) {
    drift.push(
      `- \`main\` is **${facts.mainAheadOfProd}** commit(s) ahead of prod (firebase).`
    );
  }
  if (drift.length > 0) {
    lines.push("## Drift");
    lines.push("");
    lines.push(...drift);
    lines.push("");
  }

  lines.push("## History");
  lines.push("");
  if (entries.length === 0) {
    lines.push("Nothing recorded yet.");
  } else {
    lines.push("| When | Env | Component | Target | Commit | By | Note |");
    lines.push("|---|---|---|---|---|---|---|");
    const newestFirst = [...entries].sort((a, b) => b.at.localeCompare(a.at));
    for (const e of newestFirst) {
      const note = noteText(e, true);
      lines.push(
        `| ${formatTime(e.at)} | ${e.env} | ${e.component} | ` +
          `${MULTI_INSTANCE.includes(e.component) && !e.target ? "_unknown_" : cell(e.target)} | ` +
          `${commitCell(e)} | ${cell(e.by)} | ${cell(note)} |`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
