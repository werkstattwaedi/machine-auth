// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Deploy Firebase Cloud Functions with auto-cleanup.
 *
 * The heavy lifting (packing `@oww/shared` and rewriting
 * `functions/package.json`) happens in `prepare-functions-deploy.ts`, which
 * runs as a Firebase predeploy hook. That mutation persists across the
 * upload step. This wrapper exists to:
 *
 *   1. Snapshot `functions/package.json` before deploy so we can restore the
 *      exact pre-deploy bytes (not whatever happens to be in `HEAD`).
 *   2. Run `firebase deploy --only functions [args...]`
 *   3. Restore the snapshot and delete the tarball — even on failure or
 *      Ctrl+C.
 *
 * If you run `firebase deploy --only functions` directly (skipping this
 * wrapper), the predeploy still does its job, but you'll need to run
 * `npm run deploy:functions:cleanup` afterwards — and the pre-commit hook
 * will refuse commits until you do.
 */

import { spawnSync } from "child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FUNCTIONS = join(ROOT, "functions");
const PKG_JSON_PATH = join(FUNCTIONS, "package.json");
const LOCK_PATH = join(ROOT, "package-lock.json");

const originalPkgJson = readFileSync(PKG_JSON_PATH, "utf-8");
// Snapshot the lockfile too: any `npm install` while package.json points
// @oww/shared at the `file:` tarball rewrites the lock to pin
// functions/node_modules/@oww/shared at that tarball. Restoring only
// package.json leaves that pin, so later installs keep re-extracting the
// stale copy (the deploy-state bug). Restore both.
const originalLock = readFileSync(LOCK_PATH, "utf-8");

function cleanup(): void {
  writeFileSync(PKG_JSON_PATH, originalPkgJson);
  writeFileSync(LOCK_PATH, originalLock);
  for (const entry of readdirSync(FUNCTIONS)) {
    if (entry.startsWith("oww-shared-") && entry.endsWith(".tgz")) {
      try {
        rmSync(join(FUNCTIONS, entry));
      } catch {
        // ignore — pre-commit hook will catch leftovers
      }
    }
  }
  // The `file:` install extracts a real `functions/node_modules/@oww/shared`
  // that shadows the hoisted workspace symlink. Restoring package.json isn't
  // enough — a later build/install resolves this stale copy and fails on
  // exports added since (the deploy-state bug). Remove it so the workspace
  // symlink takes over again.
  try {
    rmSync(join(FUNCTIONS, "node_modules", "@oww", "shared"), {
      recursive: true,
      force: true,
    });
  } catch {
    // ignore — pre-commit hook + predeploy guard also clear it
  }
}

function cleanupAndExit(signal: NodeJS.Signals): void {
  cleanup();
  process.exit(signal === "SIGINT" ? 130 : 143);
}
process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);

const args = ["deploy", "--only", "functions", ...process.argv.slice(2)];
const result = spawnSync("firebase", args, { cwd: ROOT, stdio: "inherit" });
cleanup();
process.exit(result.status ?? 1);
