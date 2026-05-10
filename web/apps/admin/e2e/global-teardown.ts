// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * After every Playwright run, normalize any screenshot baselines back to a
 * deterministic byte stream so updates produced on one machine match
 * updates produced on any other. See scripts/normalize-snapshots.mjs.
 */

import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "../../../..")

export default async function globalTeardown() {
  const res = spawnSync(
    "node",
    [resolve(REPO_ROOT, "scripts/normalize-snapshots.mjs")],
    { stdio: "inherit", cwd: REPO_ROOT },
  )
  if (res.status !== 0) {
    console.warn(
      `[global-teardown] normalize-snapshots exited with status ${res.status}; baselines may not be deterministic.`,
    )
  }
}
