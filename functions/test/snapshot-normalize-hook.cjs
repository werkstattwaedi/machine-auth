// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Mocha root hook that re-encodes any PNG snapshots produced by visual
 * unit tests (e.g. build_invoice_pdf.visual.test.ts) into deterministic
 * bytes so they don't drift across developer machines / CI.
 *
 * Loaded via mocha --require so it runs once after the full test suite
 * finishes, regardless of whether UPDATE_SNAPSHOTS=1 was set — re-encoding
 * already-normalized PNGs is idempotent.
 *
 * See scripts/normalize-snapshots.mjs for the encoder details.
 */

const { spawnSync } = require("node:child_process")
const { resolve } = require("node:path")

const REPO_ROOT = resolve(__dirname, "..", "..")

exports.mochaHooks = {
  afterAll() {
    // Default Mocha hook timeout is 2 s, but oxipng `-o max` on the full
    // snapshot tree (~200 PNGs) takes 45-60 s on a CI runner, and the tree
    // only grows. Give it room.
    this.timeout(180_000)
    const res = spawnSync(
      "node",
      [resolve(REPO_ROOT, "scripts/normalize-snapshots.mjs")],
      { stdio: "inherit", cwd: REPO_ROOT },
    )
    if (res.status !== 0) {
      console.warn(
        `[snapshot-normalize-hook] normalize-snapshots exited with status ${res.status}; baselines may not be deterministic.`,
      )
    }
  },
}
