// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Refuse to deploy anything but the latest main (ADR-0045).
 *
 * A deploy is built from two checkouts: machine-auth (the code) and the
 * operations repo (config.jsonc, the staging overlay — read straight from
 * its working tree by generate-env, the gateway deploy and the kiosk
 * build). Both must be on `main`, equal to `origin/main` and free of
 * uncommitted changes to tracked files. Otherwise the deploy ships
 * something no one can reconstruct later, and the deploy record would
 * describe the wrong thing.
 *
 * Submodules count for the gateway (it vendors pigweed's Python sources)
 * and the firmware (built from them); for the Firebase deploy and the kiosk
 * a locally moved third_party/pigweed is irrelevant and ignored.
 *
 * Override — deliberately explicit, and recorded in the deploy log:
 *   --allow-off-main            (deploy.sh, deploy-gateway.ts, this script)
 *   DEPLOY_ALLOW_OFF_MAIN=1     (any path, e.g. `./pw prod-flash`, the kiosk build)
 *
 * Usage:
 *   npx tsx scripts/deploy-preflight.ts --component firebase [--allow-off-main]
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import { COMPONENTS, type DeployComponent } from "./deploy-log.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const opsDir =
  process.env.OPERATIONS_CONFIG_DIR || resolve(projectRoot, "..", "machine-auth-operations");

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

/** Components whose build includes submodule sources. */
const USES_SUBMODULES: readonly DeployComponent[] = ["gateway", "firmware"];

export const OVERRIDE_ENV = "DEPLOY_ALLOW_OFF_MAIN";

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: GIT_ENV,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function checkRepo(
  name: string,
  dir: string,
  opts: { submodules: boolean; fetch: boolean }
): string[] {
  if (!existsSync(resolve(dir, ".git"))) return [`${name}: no git checkout at ${dir}`];
  const problems: string[] = [];

  if (opts.fetch && tryGit(dir, ["fetch", "--quiet", "origin", "main"]) === null) {
    problems.push(`${name}: could not fetch origin/main — cannot tell whether it is the latest`);
  }

  const branch = tryGit(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch !== "main") problems.push(`${name}: on ${branch ? `branch ${branch}` : "a detached HEAD"}, not main`);

  const behind = tryGit(dir, ["rev-list", "--count", "HEAD..origin/main"]);
  const ahead = tryGit(dir, ["rev-list", "--count", "origin/main..HEAD"]);
  if (behind === null || ahead === null) {
    problems.push(`${name}: no origin/main to compare against`);
  } else {
    if (Number(behind) > 0) problems.push(`${name}: ${behind} commit(s) behind origin/main — pull`);
    if (Number(ahead) > 0) problems.push(`${name}: ${ahead} commit(s) not on origin/main`);
  }

  const status = tryGit(dir, ["status", "--porcelain", "--untracked-files=no", "--ignore-submodules"]);
  if (status) {
    // tryGit trims the output, so the first line may have lost its leading
    // status column — strip "XY " by pattern, not by offset.
    const files = status.split("\n").map((l) => l.trim().replace(/^\S+\s+/, ""));
    const shown = files.slice(0, 5).join(", ") + (files.length > 5 ? ", …" : "");
    problems.push(`${name}: uncommitted changes (${shown})`);
  }

  if (opts.submodules) {
    // "+" = checked out at another commit than HEAD records, "-" = missing.
    for (const line of (tryGit(dir, ["submodule", "status"]) ?? "").split("\n")) {
      const m = line.match(/^([+-])\S+ (\S+)/);
      if (!m) continue;
      problems.push(
        m[1] === "+"
          ? `${name}: ${m[2]} is not at the commit main records — git submodule update`
          : `${name}: ${m[2]} is not checked out — git submodule update --init`
      );
    }
  }
  return problems;
}

/**
 * Why this checkout is not "latest main", empty when it is. `fetch: false`
 * reuses the tracking refs of an earlier check (the record step).
 */
export function preflightProblems(
  component: DeployComponent,
  opts: { fetch?: boolean } = {}
): string[] {
  const fetch = opts.fetch ?? true;
  return [
    ...checkRepo("machine-auth", projectRoot, {
      submodules: USES_SUBMODULES.includes(component),
      fetch,
    }),
    ...checkRepo("operations repo", opsDir, { submodules: false, fetch }),
  ];
}

export function overrideRequested(): boolean {
  return process.env[OVERRIDE_ENV] === "1";
}

/**
 * Exit the process unless the checkouts are latest main or the override is
 * set. With the override the problems are printed and the deploy proceeds;
 * deploy-record.ts writes them into the log entry.
 */
export function enforcePreflight(component: DeployComponent, allowOffMain: boolean): boolean {
  const problems = preflightProblems(component);
  if (problems.length === 0) return true;
  const list = problems.map((p) => `  - ${p}`).join("\n");
  if (allowOffMain || overrideRequested()) {
    console.warn(`\x1b[1;33m[preflight]\x1b[0m deploying OFF latest main (override; recorded):\n${list}`);
    process.env[OVERRIDE_ENV] = "1"; // the record step sees it
    return false;
  }
  console.error(
    `\x1b[0;31m[preflight]\x1b[0m refusing to deploy ${component} — not the latest main:\n${list}\n\n` +
      "Update both checkouts (git switch main && git pull), or override explicitly with\n" +
      `--allow-off-main / ${OVERRIDE_ENV}=1 — the deploy log will say so.`
  );
  process.exit(1);
}

function main(): void {
  const { values } = parseArgs({
    options: {
      component: { type: "string" },
      "allow-off-main": { type: "boolean", default: false },
    },
    strict: true,
  });
  const component = values.component as DeployComponent | undefined;
  if (!component || !COMPONENTS.includes(component) || component === "ops") {
    console.error(`--component must be one of: ${COMPONENTS.filter((c) => c !== "ops").join(", ")}`);
    process.exit(2);
  }
  if (!enforcePreflight(component, values["allow-off-main"])) return;
  console.log("\x1b[0;32m[preflight]\x1b[0m machine-auth and the operations repo are on the latest main");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
