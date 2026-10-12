// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Name the release a deploy ships, cutting a new one if needed
 * (ADR-0045, phase 2a).
 *
 * Every deploy path calls this after its preflight and before it builds:
 *
 *   - The commit already carries a release tag → that release is reused
 *     ("v2026.10.3 (already released)"), no question asked.
 *   - Otherwise the next `vYYYY.M.N` is proposed together with the commits
 *     since the previous release (and the operations config commits, if the
 *     config changed), and cut only after a yes. The commit list becomes
 *     the tag annotation — `git show v2026.10.3` is the release notes.
 *   - `--yes` answers the question. Without a terminal and without `--yes`
 *     it refuses: a release is never cut silently.
 *   - A deploy that overrides the preflight (`--allow-off-main`) or has
 *     uncommitted changes never cuts a release; it ships a `-dev` version.
 *   - `--new-release` cuts the next number even on an already released
 *     commit — for a change that lives only in the operations repo.
 *
 * The tag is pushed before anything is built, so two machines can't hand
 * out the same name: the loser of a push race fetches the tags and reuses
 * the winner's tag (same commit) or takes the next number.
 *
 * Usage (scripts/deploy.sh, ./pw prod-flash):
 *   npx tsx scripts/release.ts [--yes] [--new-release] \
 *     [--question "deploy to PRODUCTION"] [--out <file>]
 * `--out` writes `BUILD_VERSION=…` and `RELEASE_CONFIRMED=0|1` (whether a
 * yes covered the deploy) for the shell to source. Exit code 1 = aborted.
 */

import { execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import {
  buildVersion,
  compareReleaseTags,
  nextReleaseTag,
  parseReleaseTag,
  RELEASE_TAG_GLOB,
} from "./build-version.ts";
import { opsConfigCommitsBetween, opsRevision, overrideRequested } from "./deploy-preflight.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const PUSH_ATTEMPTS = 3;
const MAX_LISTED_COMMITS = 30;
const OPS_TRAILER = "Ops-Revision";

export class ReleaseAborted extends Error {}

export interface ReleaseOptions {
  /** Answer the question with yes (deploy.sh --yes). */
  yes?: boolean;
  /** Cut the next number even if the commit is already released. */
  newRelease?: boolean;
  /** Completes "Cut v… and <question>?"; defaults to "deploy". */
  question?: string;
}

export interface ReleaseResult {
  version: string;
  tag?: string;
  /** A yes (typed or --yes) covered this deploy. */
  confirmed: boolean;
}

function say(message: string): void {
  console.log(`\x1b[0;32m[release]\x1b[0m ${message}`);
}

function warn(message: string): void {
  console.warn(`\x1b[1;33m[release]\x1b[0m ${message}`);
}

function git(args: string[], input?: string): string {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: GIT_ENV,
    timeout: 30_000,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  }).trim();
}

function tryGit(args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function lines(out: string | null): string[] {
  return out ? out.split("\n").filter(Boolean) : [];
}

function releaseTagsAt(commit: string): string[] {
  return lines(tryGit(["tag", "--points-at", commit, "--list", RELEASE_TAG_GLOB]))
    .filter((t) => parseReleaseTag(t))
    .sort(compareReleaseTags);
}

function fetchTags(): void {
  if (tryGit(["fetch", "--quiet", "--tags", "origin"]) === null) {
    throw new Error("could not fetch tags from origin — cannot name a release");
  }
}

/** Release notes: the commits since the previous release, plus config changes. */
function releaseNotes(commit: string, ops: string | undefined): { previous?: string; body: string[] } {
  const previous =
    tryGit(["describe", "--tags", "--abbrev=0", "--match", RELEASE_TAG_GLOB, commit]) ?? undefined;
  const range = previous ? `${previous}..${commit}` : commit;
  const commits = lines(tryGit(["log", "--oneline", "--no-decorate", "--no-merges", range]));
  const body = commits.slice(0, MAX_LISTED_COMMITS).map((c) => `  ${c}`);
  if (commits.length > MAX_LISTED_COMMITS) {
    body.push(`  … and ${commits.length - MAX_LISTED_COMMITS} more`);
  }

  // The operations config the previous release was cut with is in its
  // annotation; list what changed there since.
  if (previous && ops) {
    const message = tryGit(["tag", "--list", "--format=%(contents)", previous]) ?? "";
    const before = message.match(new RegExp(`^${OPS_TRAILER}: ([0-9a-f]{40})$`, "m"))?.[1];
    if (before && before !== ops) {
      const config = opsConfigCommitsBetween(before, ops);
      if (config && config.length > 0) {
        body.push("", `Operations config changed since ${previous}:`);
        body.push(...config.map((c) => `  ${c}`));
      }
    }
  }
  return { previous, body };
}

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\x1b[1;33m${question} [y/N] \x1b[0m`);
    return /^y/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function ensureRelease(opts: ReleaseOptions = {}): Promise<ReleaseResult> {
  const commit = process.env.DEPLOY_RECORD_COMMIT || git(["rev-parse", "HEAD"]);
  const dirty =
    process.env.DEPLOY_RECORD_DIRTY === "1" ||
    git(["status", "--porcelain", "--untracked-files=no", "--ignore-submodules"]).length > 0;

  if (overrideRequested() || dirty) {
    const version = buildVersion();
    warn(`${dirty ? "uncommitted changes" : "not the latest main"} — no release, shipping ${version}`);
    return { version, confirmed: false };
  }

  fetchTags();
  const existing = releaseTagsAt(commit);
  if (existing.length > 0 && !opts.newRelease) {
    say(`${existing[0]} (already released)`);
    return { version: existing[0].slice(1), tag: existing[0], confirmed: false };
  }

  const ops = opsRevision();
  const { previous, body } = releaseNotes(commit, ops);
  let tag = nextReleaseTag(lines(tryGit(["tag", "--list", RELEASE_TAG_GLOB])), new Date());

  const short = commit.slice(0, 8);
  const since = previous ? ` since ${previous}` : "";
  console.log(`\nNew release ${tag} from ${short}${since}:`);
  console.log(body.length > 0 ? body.join("\n") : "  (no new commits — same code, new name)");
  console.log();

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      throw new ReleaseAborted(`cutting ${tag} needs a yes — run in a terminal or pass --yes`);
    }
    if (!(await ask(`Cut ${tag} and ${opts.question ?? "deploy"}?`))) {
      throw new ReleaseAborted("aborted — nothing tagged, nothing deployed");
    }
  }

  const annotation = (name: string) =>
    [`Release ${name}`, "", ...body.map((l) => l.replace(/^ {2}/, "")), "", ...(ops ? [`${OPS_TRAILER}: ${ops}`] : [])]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n") + "\n";

  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    git(["tag", "--annotate", "--file=-", tag, commit], annotation(tag));
    if (tryGit(["push", "--quiet", "origin", `refs/tags/${tag}`]) !== null) {
      say(`cut ${tag} at ${short}`);
      return { version: tag.slice(1), tag, confirmed: true };
    }
    // Someone else took the name (or the push failed): drop ours, look again.
    git(["tag", "--delete", tag]);
    fetchTags();
    const taken = releaseTagsAt(commit);
    if (taken.length > 0 && !opts.newRelease) {
      say(`${taken[0]} was just cut for this commit elsewhere — using it`);
      return { version: taken[0].slice(1), tag: taken[0], confirmed: true };
    }
    const next = nextReleaseTag(lines(tryGit(["tag", "--list", RELEASE_TAG_GLOB])), new Date());
    if (next === tag) break; // not a race — the push itself fails
    warn(`${tag} is taken — cutting ${next} instead`);
    tag = next;
  }
  throw new Error(`could not push release tag ${tag} to origin`);
}

/** Run from a deploy script: exit 1 on abort, with the reason. */
export async function ensureReleaseOrExit(opts: ReleaseOptions = {}): Promise<ReleaseResult> {
  try {
    return await ensureRelease(opts);
  } catch (e) {
    console.error(`\x1b[0;31m[release]\x1b[0m ${(e as Error).message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      yes: { type: "boolean", default: false },
      "new-release": { type: "boolean", default: false },
      question: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  const result = await ensureReleaseOrExit({
    yes: values.yes,
    newRelease: values["new-release"],
    question: values.question,
  });
  if (values.out) {
    writeFileSync(
      values.out,
      `BUILD_VERSION=${result.version}\nRELEASE_CONFIRMED=${result.confirmed ? 1 : 0}\n`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
