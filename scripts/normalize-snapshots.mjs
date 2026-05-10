#!/usr/bin/env node
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Normalize Playwright screenshot baselines so they're byte-identical
 * regardless of which machine generated them.
 *
 * Playwright's `toHaveScreenshot()` does a byte-level comparison by
 * default. Even when two encoders produce *visually identical* PNGs (same
 * pixels), small differences in zlib level, scanline filter strategy, or
 * embedded metadata (tIME, gAMA, software signature) cause baselines to
 * "drift" between developers' machines and CI — which surfaces as spurious
 * merge conflicts on every `--update-snapshots` run.
 *
 * This script re-encodes every PNG under the project's snapshot trees with
 * oxipng (`-o max --strip safe`), which is deterministic given identical
 * pixel input. Run it after every baseline regeneration to land on the
 * canonical bytes.
 *
 * Default roots (when invoked without args):
 *   - web/apps/checkout/e2e/      Playwright (checkout app)
 *   - web/apps/admin/e2e/         Playwright (admin app)
 *   - functions/test/unit/        Mocha visual tests (PDF rendering)
 *
 * Usage:
 *   node scripts/normalize-snapshots.mjs                  # all baselines
 *   node scripts/normalize-snapshots.mjs path/to/file.png # specific file(s)
 *
 * Also wired into each suite's teardown so `--update-snapshots` /
 * `UPDATE_SNAPSHOTS=1` runs normalize automatically.
 */

import { oxipngSync } from "oxipng"
import { existsSync, statSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_ROOTS = [
  join(REPO_ROOT, "web/apps/checkout/e2e"),
  join(REPO_ROOT, "web/apps/admin/e2e"),
  join(REPO_ROOT, "functions/test/unit"),
]

async function walkPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkPngs(full)))
    } else if (entry.name.endsWith(".png")) {
      out.push(full)
    }
  }
  return out
}

async function collectTargets(args) {
  if (args.length === 0) {
    const out = []
    for (const root of DEFAULT_ROOTS) {
      if (existsSync(root)) out.push(...(await walkPngs(root)))
    }
    return out
  }
  // Caller supplied explicit paths (e.g. lint-staged hook); accept files or dirs.
  const out = []
  for (const arg of args) {
    const abs = resolve(arg)
    if (!existsSync(abs)) continue
    const stat = statSync(abs)
    if (stat.isDirectory()) {
      out.push(...(await walkPngs(abs)))
    } else if (abs.endsWith(".png")) {
      out.push(abs)
    }
  }
  return out
}

const targets = await collectTargets(process.argv.slice(2))
if (targets.length === 0) {
  console.log("normalize-snapshots: nothing to do")
  process.exit(0)
}

// `-o max` runs every trial filter/strategy combination, then keeps the
// smallest. Since oxipng's encoder is deterministic, identical pixel
// inputs produce identical bytes regardless of host platform.
//
// `--strip safe` removes tIME, tEXt, zTXt, iTXt, oFFs etc. — anything
// that's not required to render the image. Keeps cHRM/gAMA/sRGB so colour
// rendering stays stable.
//
// stdio: 'pipe' so the per-file output doesn't drown the terminal; we
// surface a single summary line instead.
oxipngSync(["-o", "max", "--strip", "safe", "--quiet", ...targets], {
  stdio: "inherit",
})

console.log(`normalize-snapshots: re-encoded ${targets.length} PNG${targets.length === 1 ? "" : "s"}`)
