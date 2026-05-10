// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * After every Playwright run, normalize any screenshot baselines back to a
 * deterministic byte stream so updates produced on one machine match
 * updates produced on any other. See scripts/normalize-snapshots.mjs.
 *
 * Runs even when no snapshots were touched — re-encoding an already-
 * normalized PNG is idempotent (deterministic input → identical output)
 * and takes ~1 s for the full e2e tree, which is negligible next to the
 * Playwright run itself.
 */

import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

// Playwright loads this file as ESM, where `__dirname` is undefined.
const REPO_ROOT = resolve(import.meta.dirname, "../../../..")

export default async function globalTeardown() {
  const res = spawnSync(
    "node",
    [resolve(REPO_ROOT, "scripts/normalize-snapshots.mjs")],
    { stdio: "inherit", cwd: REPO_ROOT },
  )
  if (res.status !== 0) {
    // Don't fail the test run over a normalization hiccup — log and move on.
    // CI surfaces this via the diff against the committed baselines.
    console.warn(
      `[global-teardown] normalize-snapshots exited with status ${res.status}; baselines may not be deterministic.`,
    )
  }
}
