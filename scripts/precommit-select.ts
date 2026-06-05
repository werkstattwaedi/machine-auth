// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Selects which pre-commit test suites to run based on staged files, so the
// Husky pre-commit hook only runs the suite(s) whose inputs actually changed
// (instead of the full test:precommit on every commit). See issue #368.
//
// As a CLI (`tsx scripts/precommit-select.ts`) it reads the staged file list
// from `git diff --cached --name-only` and prints the suites to run (one per
// line), or nothing when no suite applies (docs/meta-only commits).

import { execFileSync } from "node:child_process";

export type Suite = "web" | "functions";

// Bucketing rules (issue #368). Order matters only in that the "both" bucket
// is keyed on shared inputs that affect web and functions alike.
//
// - web/                         -> web
// - functions/, proto/           -> functions
// - shared/, scripts/, firestore/, firebase.json, root package.json/-lock.json
//                                -> both (shared code + test infra + emulator
//                                   config + rules touch both)
// - anything else (docs, *.md, maco_gateway/, maco_firmware/, checkout-kiosk/,
//   …)                           -> ignored (no suite)
export function selectSuites(files: string[]): Set<Suite> {
  const suites = new Set<Suite>();

  for (const raw of files) {
    const file = raw.trim();
    if (!file) continue;

    // Shared / infra inputs -> both suites.
    if (
      file.startsWith("shared/") ||
      file.startsWith("scripts/") ||
      file.startsWith("firestore/") ||
      file === "firebase.json" ||
      file === "package.json" ||
      file === "package-lock.json"
    ) {
      suites.add("web");
      suites.add("functions");
      continue;
    }

    if (file.startsWith("web/")) {
      suites.add("web");
      continue;
    }

    if (file.startsWith("functions/") || file.startsWith("proto/")) {
      suites.add("functions");
      continue;
    }

    // Everything else (docs, *.md, firmware, gateway, kiosk, …) is ignored.
  }

  return suites;
}

function stagedFiles(): string[] {
  const out = execFileSync(
    "git",
    ["diff", "--cached", "--name-only"],
    { encoding: "utf8" },
  );
  return out.split("\n");
}

// Run as CLI: print selected suites, one per line, in stable order.
if (import.meta.url === `file://${process.argv[1]}`) {
  const suites = selectSuites(stagedFiles());
  for (const suite of ["web", "functions"] as const) {
    if (suites.has(suite)) {
      console.log(suite);
    }
  }
}
