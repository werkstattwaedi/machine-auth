// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Selects which test suites to run based on a changed-file list, so we only
// run the suite(s) whose inputs actually changed.
//
// Two consumers, one rule chain (`classify`):
//
//  - The Husky pre-commit hook (issue #368) asks for *suites* (`web` /
//    `functions`) from the staged files, so a docs-only commit runs nothing.
//  - CI (issue #530) asks for *e2e targets* (`checkout` / `admin`) from the
//    PR's changed files, so a docs/firmware-only PR skips the ~18 min e2e
//    matrix entirely and a checkout-only PR skips admin's leg. Selection
//    gates `pull_request` only — `push: main` always runs the full matrix.
//
// As a CLI (`tsx scripts/precommit-select.ts`) it reads the staged file list
// from `git diff --cached --name-only` and prints the suites to run (one per
// line), or nothing when no suite applies (docs/meta-only commits).
//
//   --e2e     print e2e targets (checkout/admin) instead of suites
//   --stdin   read the file list from stdin instead of `git diff --cached`
//             (CI passes `git diff --name-only <base>...HEAD`)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type Suite = "web" | "functions";
export type E2eTarget = "checkout" | "admin";

export interface Selection {
  suites: Set<Suite>;
  e2e: Set<E2eTarget>;
}

// What one changed file selects. `[]` for either axis means "this path does
// not affect that axis".
interface Bucket {
  suites: Suite[];
  e2e: E2eTarget[];
}

const BOTH_APPS: E2eTarget[] = ["checkout", "admin"];

// Bucketing rules. First match wins, so the shared/infra rule is checked
// before the narrower `web/apps/*` ones.
//
// | path                                   | suites          | e2e      |
// |----------------------------------------|-----------------|----------|
// | shared/, scripts/, firestore/,         | web + functions | both     |
// | firebase.json, root package(-lock).json|                 |          |
// | web/modules/                           | web             | both     |
// | web/apps/checkout/                     | web             | checkout |
// | web/apps/admin/                        | web             | admin    |
// | web/ (anything else: workspace config) | web             | both     |
// | functions/, proto/                     | functions       | both     |
// | .github/workflows/                     | —               | both     |
// | anything else (docs, *.md,             | —               | —        |
// | maco_gateway/, maco_firmware/,         |                 |          |
// | checkout-kiosk/, …)                    |                 |          |
//
// Rationale for the e2e column, where it isn't obvious:
//
//  - Shared code, emulator config and security rules are compiled into (or
//    enforced against) *both* apps, so they can never deselect one. This is
//    the guardrail against under-selection: the 55% of changes that touch
//    shared surfaces run everything, exactly as before.
//  - `functions/` selects both e2e apps even though it only selects the
//    `functions` unit suite: the e2e emulator runs the compiled functions,
//    and both apps call them (login codes, checkout APIs).
//  - `.github/workflows/` selects both because a change to the e2e job or
//    matrix must be validated by actually running e2e.
function classify(file: string): Bucket | undefined {
  if (
    file.startsWith("shared/") ||
    file.startsWith("scripts/") ||
    file.startsWith("firestore/") ||
    file === "firebase.json" ||
    file === "package.json" ||
    file === "package-lock.json"
  ) {
    return { suites: ["web", "functions"], e2e: BOTH_APPS };
  }

  if (file.startsWith("web/modules/")) {
    return { suites: ["web"], e2e: BOTH_APPS };
  }

  if (file.startsWith("web/apps/checkout/")) {
    return { suites: ["web"], e2e: ["checkout"] };
  }

  if (file.startsWith("web/apps/admin/")) {
    return { suites: ["web"], e2e: ["admin"] };
  }

  // Any other `web/` path is workspace-level (root config, lockfile, tsconfig)
  // and therefore affects both apps.
  if (file.startsWith("web/")) {
    return { suites: ["web"], e2e: BOTH_APPS };
  }

  if (file.startsWith("functions/") || file.startsWith("proto/")) {
    return { suites: ["functions"], e2e: BOTH_APPS };
  }

  if (file.startsWith(".github/workflows/")) {
    return { suites: [], e2e: BOTH_APPS };
  }

  return undefined;
}

export function select(files: string[]): Selection {
  const suites = new Set<Suite>();
  const e2e = new Set<E2eTarget>();

  for (const raw of files) {
    const file = raw.trim();
    if (!file) continue;

    const bucket = classify(file);
    if (!bucket) continue;

    for (const suite of bucket.suites) suites.add(suite);
    for (const target of bucket.e2e) e2e.add(target);
  }

  return { suites, e2e };
}

export function selectSuites(files: string[]): Set<Suite> {
  return select(files).suites;
}

export function selectE2eTargets(files: string[]): Set<E2eTarget> {
  return select(files).e2e;
}

function stagedFiles(): string[] {
  const out = execFileSync(
    "git",
    ["diff", "--cached", "--name-only"],
    { encoding: "utf8" },
  );
  return out.split("\n");
}

// Run as CLI: print the selection, one entry per line, in stable order.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const files = args.includes("--stdin")
    ? readFileSync(0, "utf8").split("\n")
    : stagedFiles();

  const selection = select(files);

  if (args.includes("--e2e")) {
    for (const target of ["checkout", "admin"] as const) {
      if (selection.e2e.has(target)) console.log(target);
    }
  } else {
    for (const suite of ["web", "functions"] as const) {
      if (selection.suites.has(suite)) console.log(suite);
    }
  }
}
