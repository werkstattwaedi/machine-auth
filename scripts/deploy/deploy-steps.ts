// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Deploy steps (ADR-0049): the one-off actions a deploy needs around it,
 * written as prose in docs/deploy/ and carried out by an agent while
 * scripts/deploy/deploy.sh waits at the phase boundary.
 *
 * A step is pending for an environment when its file was *added* since that
 * environment's last `deploy/<env>/firebase/*` tag (ADR-0045). Every added
 * step file is in its PR's `Deploy:` line, so that is the set of steps the
 * changes deployed since the last run declared. Editing a file triggers
 * nothing; an environment without a tag is a fresh installation, built from
 * the checklist, with nothing pending. There is no other state: a
 * successful deploy moves the tag, an aborted one doesn't.
 *
 * Usage (scripts/deploy/deploy.sh, or by hand to preview the next deploy):
 *   npx tsx scripts/deploy/deploy-steps.ts list   --env prod [--phase before-functions] [--no-fetch]
 *   npx tsx scripts/deploy/deploy-steps.ts prompt --env prod --phase before-functions \
 *       --project oww-maco --version 2026.10.4 [--no-fetch]
 *
 * `list` prints the pending files, one per line (nothing when there are
 * none); `prompt` prints the message the deploy script hands the agent.
 * Both exit 2 on a step file with a bad header — a typo in `phase:` stops
 * the deploy rather than silently skipping the step.
 *
 * check-deploy-line.ts (CI) imports the header parser, so a bad header is
 * also caught in the PR that adds the file. Plain node must be able to load
 * this module (type stripping): no enums, no decorators, no path aliases.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const STEPS_DIR = "docs/deploy";

export const PHASES = ["before-functions", "after-functions", "after-deploy"] as const;
export type Phase = (typeof PHASES)[number];

/** Where the deploy script is when it stops for the phase — for the agent. */
export const PHASE_WHEN: Record<Phase, string> = {
  "before-functions": "before the functions deploy",
  "after-functions": "after the functions deploy, before rules, indexes and hosting",
  "after-deploy": "after functions, rules and hosting are deployed, before the deploy is recorded",
};

export interface Step {
  /** Repo-relative path, e.g. `docs/deploy/2026-10-20-migrate-x.md`. */
  path: string;
  phase: Phase;
}

/** A step file: a Markdown file directly in docs/deploy/, other than the README. */
export function isStepFile(path: string): boolean {
  return new RegExp(`^${STEPS_DIR}/[^/]+\\.md$`).test(path) && !/\/README\.md$/i.test(path);
}

/**
 * The header is a front matter with exactly one field. It is this strict on
 * purpose: the only structure a step has is where the deploy stops for it;
 * everything else is prose for the agent.
 */
export function parseStepHeader(text: string, path: string): Phase {
  // Zero or more full lines between the fences; an empty header is allowed
  // here so the error says "no phase" rather than "missing header".
  const m = /^---\r?\n((?:.*\r?\n)*?)---(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error(`${path}: missing header — the file must start with "---\\nphase: <phase>\\n---"`);
  let phase: string | undefined;
  for (const line of m[1].split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const kv = /^([a-z-]+):\s*(.*?)\s*$/.exec(line);
    if (!kv) throw new Error(`${path}: cannot read header line \`${line}\``);
    if (kv[1] !== "phase") throw new Error(`${path}: unknown header field \`${kv[1]}\` — the header has only \`phase\``);
    phase = kv[2];
  }
  if (!phase) throw new Error(`${path}: header has no phase (one of ${PHASES.join(", ")})`);
  if (!(PHASES as readonly string[]).includes(phase)) {
    throw new Error(`${path}: unknown phase \`${phase}\` (one of ${PHASES.join(", ")})`);
  }
  return phase as Phase;
}

/**
 * The steps among `changed` (repo-relative paths): step files that still
 * exist, with their phase, in name order — i.e. the order they were
 * written. Throws on the first bad header.
 */
export function stepsOf(changed: string[], read: (path: string) => string | undefined): Step[] {
  const steps: Step[] = [];
  for (const path of [...new Set(changed)].filter(isStepFile).sort()) {
    const text = read(path);
    if (text === undefined) continue; // deleted since — nothing to carry out
    steps.push({ path, phase: parseStepHeader(text, path) });
  }
  return steps;
}

/** The message the deploy script hands the agent (ADR-0049, decision 3). */
export function agentPrompt(opts: {
  env: string;
  phase: Phase;
  project: string;
  version: string;
  steps: Step[];
}): string {
  const files = opts.steps.map((s) => `  - ${s.path}`).join("\n");
  return [
    `Deploy steps for the ${opts.env} deploy of machine-auth — Firebase project ${opts.project}, release ${opts.version} (ADR-0049, docs/deploy/README.md).`,
    "",
    `scripts/deploy/deploy.sh is paused ${PHASE_WHEN[opts.phase]} (phase "${opts.phase}") and continues when this session ends. Carry out these steps, in this order, as their files say:`,
    "",
    files,
    "",
    "Rules:",
    "- Read docs/deploy/README.md first, then each file. A file says what to run, how to check it worked and what breaks without it; it may say there is nothing to do for this environment.",
    "- Check before you act. A step is presented again when an earlier deploy stopped after it ran (the deploy tag only moves when the whole deploy went through) — so it may already be done. If the file's check says so, say so and move on.",
    `- Run every command against ${opts.project} (${opts.env}); where a file says <project-id>, that is ${opts.project}.`,
    "- Anything that changes production data: dry-run first, show me the output, and wait for my go before the live run.",
    `- Record each step you carried out: npx tsx scripts/deploy/deploy-record.ts event --env ${opts.env} --note "deploy step <file>: <what you did>"`,
    "- Do not deploy anything yourself and do not run or edit scripts/deploy/deploy.sh; the deploy continues after you.",
    "- When every step is done, or one cannot be done, say which and why, then stop and let me end the session — the deploy script then asks me to confirm.",
  ].join("\n");
}

// --- git side ---

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function tryGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      env: GIT_ENV,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function lines(out: string | null): string[] {
  return out ? out.split("\n").filter(Boolean) : [];
}

/** The environment's last firebase deploy tag (ADR-0045); none for a fresh installation. */
export function lastDeployTag(env: string): string | undefined {
  // Timestamps are zero-padded, so name order is time order.
  return lines(tryGit(["tag", "--list", `deploy/${env}/firebase/*`])).sort().at(-1);
}

/**
 * Step files added since the tag, compared with the working tree — so a
 * step that is not committed yet shows up in a preview (the deploy itself
 * runs on a clean tree). Only additions: an edit means nothing, a rename
 * counts as an addition (the safe direction). No tag — a fresh installation
 * — means nothing is pending.
 */
export function addedSince(tag: string | undefined): string[] {
  if (!tag) return [];
  const added = tryGit(["diff", "--name-only", "--no-renames", "--diff-filter=A", tag, "--", STEPS_DIR]);
  if (added === null) throw new Error(`git diff against ${tag} failed — is the tag reachable?`);
  const untracked = lines(tryGit(["ls-files", "--others", "--exclude-standard", "--", STEPS_DIR]));
  return [...lines(added), ...untracked];
}

export function pendingSteps(env: string, phase?: Phase): Step[] {
  const read = (path: string) => {
    const abs = resolve(projectRoot, path);
    return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  };
  const steps = stepsOf(addedSince(lastDeployTag(env)), read);
  return phase ? steps.filter((s) => s.phase === phase) : steps;
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: "string" },
      phase: { type: "string" },
      project: { type: "string" },
      version: { type: "string" },
      "no-fetch": { type: "boolean", default: false },
    },
    strict: true,
  });
  const command = positionals[0];
  if (command !== "list" && command !== "prompt") {
    throw new Error("usage: deploy-steps.ts list|prompt --env staging|prod [--phase …] [--project …] [--version …] [--no-fetch]");
  }
  const env = values.env;
  if (!env) throw new Error("--env is required");
  const phase = values.phase as Phase | undefined;
  if (phase !== undefined && !PHASES.includes(phase)) {
    throw new Error(`--phase must be one of: ${PHASES.join(", ")}`);
  }

  // Origin holds the deploy tags of every machine that deployed. Best
  // effort: offline, the local tags decide (deploy.sh fetched them already).
  if (!values["no-fetch"] && tryGit(["fetch", "--quiet", "--tags", "origin"]) === null) {
    console.warn("\x1b[1;33m[deploy-steps]\x1b[0m could not fetch tags from origin — using local tags");
  }

  const steps = pendingSteps(env, phase);
  if (command === "list") {
    for (const s of steps) console.log(phase ? s.path : `${s.phase}\t${s.path}`);
    return;
  }
  if (!phase || !values.project || !values.version) {
    throw new Error("prompt needs --phase, --project and --version");
  }
  if (steps.length === 0) return;
  console.log(agentPrompt({ env, phase, project: values.project, version: values.version, steps }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`\x1b[0;31m[deploy-steps]\x1b[0m ${(e as Error).message}`);
    process.exit(2);
  }
}
