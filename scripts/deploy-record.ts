// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Record a deploy (or a manual ops event) so nobody has to guess what runs
 * where (ADR-0045).
 *
 * Per call:
 *   1. for clean code deploys, tag the machine-auth commit locally
 *      (`deploy/<env>/<component>/<YYYYMMDD-HHMMSS>`)
 *   2. append the entry to the operations repo's `deploys/log.jsonl` on
 *      `main`, regenerate its STATE.md, commit and push
 *   3. push the tag — only once the entry is safe, and only if the commit
 *      is already on an origin branch
 *
 * The operations checkout itself is never touched: it may sit on a smoke
 * branch with uncommitted runbook edits. Step 2 runs in a throwaway
 * worktree of `origin/main`, and a rejected push is retried on a freshly
 * fetched `main` — the entry is re-applied, so there is no rebase that
 * could stop half-way. When GitHub is unreachable the entry waits in
 * `.git/deploy-record-pending.jsonl` and the next recording run sends it.
 *
 * The deploy scripts call this after they succeed (scripts/deploy.sh,
 * scripts/deploy-gateway.ts, the kiosk build, `./pw prod-flash`). It is
 * best effort by design: a deploy that went out must never be reported as
 * failed because the bookkeeping could not reach GitHub. Callers treat a
 * non-zero exit as a warning.
 *
 * Usage:
 *   npx tsx scripts/deploy-record.ts deploy --env prod --component firebase
 *   npx tsx scripts/deploy-record.ts deploy --env prod --component gateway --target maker1@maco-gateway.internal
 *   npx tsx scripts/deploy-record.ts deploy --env prod --component firmware --target <device id>
 *   npx tsx scripts/deploy-record.ts event  --env prod --note "rotated KIOSK_BEARER_KEY"
 *   npx tsx scripts/deploy-record.ts render       # send pending entries, re-render STATE.md
 *   npx tsx scripts/deploy-record.ts usb-device   # print the single USB Particle device id
 *
 * Options: --note, --target, --version (default: BUILD_VERSION, else
 * scripts/build-version.ts), --no-push (keep the entry pending and the tag
 * local, e.g. offline).
 *
 * Deploy paths run deploy-preflight.ts BEFORE deploying (latest main in both
 * repos, or an explicit override that ends up in the entry's `offMain`).
 *
 * deploy.sh snapshots the commit before it starts and passes it in via
 * DEPLOY_RECORD_COMMIT / DEPLOY_RECORD_DIRTY, so the record describes the
 * tree that was deployed rather than whatever is checked out afterwards.
 */

import { execFileSync } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import {
  COMPONENTS,
  type DeployComponent,
  type DeployEntry,
  type DeployEnv,
  ENVS,
  deployTagName,
  parseLog,
  renderState,
  type RepoFacts,
  serializeEntry,
} from "./deploy-log.ts";
import { buildVersion } from "./build-version.ts";
import { opsRevision, overrideRequested, preflightProblems } from "./deploy-preflight.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const opsDir =
  process.env.OPERATIONS_CONFIG_DIR || resolve(projectRoot, "..", "machine-auth-operations");
const LOG_REL = "deploys/log.jsonl";
const STATE_REL = "STATE.md";
const ATTRIBUTES_LINE = "deploys/log.jsonl merge=union";
const PUSH_ATTEMPTS = 3;

// Never prompt for credentials and never hang a deploy that already went
// out: an unreachable remote is a warning, not a stall.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const GIT_TIMEOUT_MS = 30_000;

function warn(message: string): void {
  console.warn(`\x1b[1;33m[deploy-record]\x1b[0m ${message}`);
}

function info(message: string): void {
  console.log(`\x1b[0;32m[deploy-record]\x1b[0m ${message}`);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function whoAmI(): string {
  return (
    tryGit(projectRoot, ["config", "user.name"]) ||
    process.env.USER ||
    process.env.USERNAME ||
    "unknown"
  );
}

function deployedCommit(): { commit: string; dirty: boolean } {
  if (process.env.DEPLOY_RECORD_COMMIT) {
    return {
      commit: process.env.DEPLOY_RECORD_COMMIT,
      dirty: process.env.DEPLOY_RECORD_DIRTY === "1",
    };
  }
  const commit = git(projectRoot, ["rev-parse", "HEAD"]);
  // Submodules are ignored: third_party/pigweed routinely shows as modified
  // locally without affecting what gets built.
  const status = git(projectRoot, [
    "status",
    "--porcelain",
    "--ignore-submodules",
    "--untracked-files=no",
  ]);
  return { commit, dirty: status.length > 0 };
}

/** Device id of the single USB-connected Particle device, if exactly one. */
function usbDeviceId(): string | undefined {
  try {
    const out = execFileSync("particle", ["usb", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
    });
    const ids = [...new Set(out.match(/\b[0-9a-f]{24}\b/gi) ?? [])];
    if (ids.length === 1) return ids[0].toLowerCase();
    warn(`particle usb list shows ${ids.length} devices — no device id`);
  } catch {
    warn("particle CLI unavailable — no device id");
  }
  return undefined;
}

function createTag(entry: DeployEntry, at: Date): string | undefined {
  if (!entry.commit) return undefined;
  if (entry.dirty) {
    // A tag would name a commit that is not what went out.
    warn("deployed from a dirty working tree — recorded as dirty, no tag");
    return undefined;
  }
  const tag = deployTagName(entry.env, entry.component, at);
  const message = [
    `${entry.component} → ${entry.env}${entry.target ? ` (${entry.target})` : ""}`,
    entry.version ? `version ${entry.version}` : "",
    `by ${entry.by}`,
    entry.note ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    git(projectRoot, ["tag", "-a", tag, entry.commit, "-m", message]);
    return tag;
  } catch (e) {
    warn(`could not create tag ${tag}: ${(e as Error).message}`);
    return undefined;
  }
}

function pushTag(tag: string, commit: string): void {
  // Pushing a tag publishes its commit. A deploy from a commit that is on
  // no origin branch stays local rather than leaking unreviewed code to the
  // public repo. (Tracking refs were refreshed by the fetch in recordDeploy.)
  const onOrigin = tryGit(projectRoot, ["branch", "-r", "--contains", commit, "--list", "origin/*"]);
  if (!onOrigin) {
    warn(`${commit.slice(0, 8)} is on no origin branch — tag ${tag} stays local`);
    return;
  }
  if (tryGit(projectRoot, ["push", "--quiet", "origin", tag]) === null) {
    warn(`could not push tag ${tag} — push it later with: git push origin ${tag}`);
  }
}

// --- Operations repo ---

function pendingPath(): string {
  return resolve(opsDir, ".git", "deploy-record-pending.jsonl");
}

function readPending(): DeployEntry[] {
  const path = pendingPath();
  if (!existsSync(path)) return [];
  return parseLog(readFileSync(path, "utf8"), (line) =>
    warn(`skipping unreadable pending entry: ${line}`)
  );
}

function keepPending(entries: DeployEntry[]): void {
  if (entries.length === 0) return;
  appendFileSync(pendingPath(), entries.map(serializeEntry).join(""));
  warn(
    `${entries.length} entr${entries.length === 1 ? "y" : "ies"} kept in ${pendingPath()} — ` +
      "sent by the next recording run (or: npx tsx scripts/deploy-record.ts render)"
  );
}

function latestCommit(entries: DeployEntry[], env: DeployEnv): string | undefined {
  return entries
    .filter((e) => e.component === "firebase" && e.env === env && e.commit)
    .sort((a, b) => a.at.localeCompare(b.at))
    .at(-1)?.commit;
}

function countBetween(from: string, to: string): number | undefined {
  const out = tryGit(projectRoot, ["rev-list", "--count", `${from}..${to}`]);
  return out === null ? undefined : Number(out);
}

function repoFacts(entries: DeployEntry[]): RepoFacts {
  const prod = latestCommit(entries, "prod");
  const staging = latestCommit(entries, "staging");
  const facts: RepoFacts = {};
  if (prod) {
    facts.mainAheadOfProd = countBetween(prod, "origin/main");
    if (staging) facts.stagingAheadOfProd = countBetween(prod, staging);
  }
  return facts;
}

/** Apply entries onto the worktree's log, re-render STATE.md, commit. */
function writeAndCommit(wt: string, entries: DeployEntry[], subject: string): boolean {
  const logPath = join(wt, LOG_REL);
  mkdirSync(dirname(logPath), { recursive: true });
  if (entries.length > 0) appendFileSync(logPath, entries.map(serializeEntry).join(""));

  // Pushes never race now (each retry starts from a fresh main), but people
  // also merge branches of this repo: union keeps both sides' log lines.
  const attrPath = join(wt, ".gitattributes");
  const attrs = existsSync(attrPath) ? readFileSync(attrPath, "utf8") : "";
  if (!attrs.split("\n").includes(ATTRIBUTES_LINE)) {
    const sep = attrs === "" || attrs.endsWith("\n") ? "" : "\n";
    appendFileSync(attrPath, `${sep}${ATTRIBUTES_LINE}\n`);
  }

  const all = parseLog(readFileSync(logPath, "utf8"), (line) =>
    warn(`deploys/log.jsonl has an unreadable line, left out of STATE.md: ${line}`)
  );
  writeFileSync(join(wt, STATE_REL), renderState(all, repoFacts(all)));

  git(wt, ["add", LOG_REL, STATE_REL, ".gitattributes"]);
  if (tryGit(wt, ["diff", "--cached", "--quiet"]) !== null) return false; // nothing changed
  git(wt, ["commit", "--quiet", "-m", subject]);
  return true;
}

/**
 * Persist entries (plus any pending ones) to the operations repo's main.
 * Returns true when they are on GitHub; otherwise they wait in the pending
 * file. Never throws for remote trouble.
 */
function persist(entries: DeployEntry[], subject: string, push: boolean): boolean {
  if (!push) {
    keepPending(entries);
    return false;
  }
  const all = [...readPending(), ...entries];
  if (tryGit(opsDir, ["fetch", "--quiet", "origin", "main"]) === null) {
    warn("could not fetch the operations repo");
    keepPending(entries);
    return false;
  }

  const wt = mkdtempSync(join(tmpdir(), "deploy-record-"));
  try {
    git(opsDir, ["worktree", "add", "--quiet", "--detach", wt, "origin/main"]);
    for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
      const changed = writeAndCommit(wt, all, subject);
      if (!changed || tryGit(wt, ["push", "--quiet", "origin", "HEAD:main"]) !== null) {
        rmSync(pendingPath(), { force: true });
        return true;
      }
      // Someone pushed in between: start over from their main.
      if (tryGit(opsDir, ["fetch", "--quiet", "origin", "main"]) === null) break;
      git(wt, ["reset", "--quiet", "--hard", "origin/main"]);
    }
    warn("could not push to the operations repo");
  } catch (e) {
    warn(`could not record in the operations repo: ${(e as Error).message}`);
  } finally {
    tryGit(opsDir, ["worktree", "remove", "--force", wt]);
    rmSync(wt, { recursive: true, force: true });
    tryGit(opsDir, ["worktree", "prune"]);
  }
  keepPending(entries);
  return false;
}

function requireOpsRepo(): void {
  if (!existsSync(resolve(opsDir, ".git"))) {
    throw new Error(
      `operations repo not found at ${opsDir} (set OPERATIONS_CONFIG_DIR) — nothing recorded`
    );
  }
}

export interface RecordOptions {
  kind: "deploy" | "event";
  env: DeployEnv;
  component: DeployComponent;
  target?: string;
  version?: string;
  note?: string;
  push?: boolean;
}

export function recordDeploy(opts: RecordOptions): void {
  if (!ENVS.includes(opts.env)) throw new Error(`unknown env "${opts.env}" — not recorded`);
  requireOpsRepo();
  const push = opts.push ?? true;
  // Fresh tracking refs for the tag-push guard and the drift counts.
  if (push) tryGit(projectRoot, ["fetch", "--quiet", "origin"]);

  const at = new Date();
  const entry: DeployEntry = {
    at: at.toISOString(),
    env: opts.env,
    component: opts.component,
    by: whoAmI(),
  };
  if (opts.kind === "deploy") {
    Object.assign(entry, deployedCommit());
    // The deploy scripts export BUILD_VERSION (scripts/release.ts), so this
    // is the version that was built, not a re-derivation afterwards.
    entry.version = opts.version ?? buildVersion();
    const ops = opsRevision();
    if (ops) entry.opsRevision = ops;
    // The deploy path ran deploy-preflight.ts first; with its override set,
    // the log has to say what was not latest main.
    if (overrideRequested()) {
      const problems = preflightProblems(opts.component, { fetch: false });
      if (problems.length > 0) entry.offMain = problems;
    }
  }
  if (opts.target) entry.target = opts.target;
  if (opts.note) entry.note = opts.note;

  const tag = opts.kind === "deploy" ? createTag(entry, at) : undefined;
  if (tag) entry.tag = tag;

  const subject =
    opts.kind === "deploy"
      ? `deploy: ${entry.component} → ${entry.env}${entry.target ? ` (${entry.target})` : ""} @ ${entry.commit?.slice(0, 8)}`
      : `ops: ${entry.env} — ${entry.note ?? "event"}`;
  const sent = persist([entry], subject, push);

  // The entry is safe now (on GitHub or pending), so a published tag can
  // never exist without its record.
  if (tag && push && entry.commit) pushTag(tag, entry.commit);
  info(`${sent ? "recorded" : "recorded locally"}: ${subject}${tag ? ` [${tag}]` : ""}`);
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: "string" },
      component: { type: "string" },
      target: { type: "string" },
      version: { type: "string" },
      note: { type: "string" },
      "no-push": { type: "boolean", default: false },
    },
    strict: true,
  });
  const command = positionals[0];
  const push = !values["no-push"];

  if (command === "usb-device") {
    const id = usbDeviceId();
    if (id) console.log(id);
    return;
  }
  if (command === "render") {
    requireOpsRepo();
    tryGit(projectRoot, ["fetch", "--quiet", "origin"]);
    const pending = readPending().length;
    if (persist([], `deploy state: re-render${pending ? ` (+${pending} pending)` : ""}`, true)) {
      info("STATE.md is up to date on the operations repo's main");
    }
    return;
  }
  if (command !== "deploy" && command !== "event") {
    throw new Error(
      "usage: deploy-record.ts deploy|event|render|usb-device [--env staging|prod] [--component …] [--note …]"
    );
  }

  const env = values.env as DeployEnv | undefined;
  if (!env || !ENVS.includes(env)) throw new Error(`--env must be one of: ${ENVS.join(", ")}`);
  const component = (values.component ?? (command === "event" ? "ops" : undefined)) as
    | DeployComponent
    | undefined;
  if (!component || !COMPONENTS.includes(component)) {
    throw new Error(`--component must be one of: ${COMPONENTS.join(", ")}`);
  }
  if (command === "event" && !values.note) throw new Error("an event needs --note");

  recordDeploy({
    kind: command,
    env,
    component,
    target: values.target,
    version: values.version,
    note: values.note,
    push,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    warn((e as Error).message);
    process.exit(1);
  }
}
