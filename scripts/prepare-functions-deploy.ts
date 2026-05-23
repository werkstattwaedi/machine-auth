// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Bundle `@oww/shared` into `functions/` ahead of Firebase deploy.
 *
 * Cloud Build's `npm install` can't resolve the workspace symlink, and
 * `npm install --no-save` from a workspace member re-creates the symlink
 * instead of installing the tarball (see ADR-0027). So we:
 *   1. Pack `shared/` into `functions/oww-shared-X.Y.Z.tgz`
 *   2. Rewrite `functions/package.json` so `@oww/shared` points at the
 *      tarball via `file:` — this is what Cloud Build will see and install
 *
 * This mutation persists until `npm run deploy:functions:cleanup` runs (or
 * the wrapper script in `deploy-functions.ts` runs it on exit). The
 * pre-commit hook refuses to commit while the mutation is in effect.
 *
 * Invoked from `firebase.json` `functions[].predeploy`, so it runs whether
 * deploy is triggered by the wrapper or by `firebase deploy --only functions`
 * directly.
 */

import { readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FUNCTIONS = join(ROOT, "functions");
const SHARED = join(ROOT, "shared");
const PKG_JSON_PATH = join(FUNCTIONS, "package.json");

for (const entry of readdirSync(FUNCTIONS)) {
  if (entry.startsWith("oww-shared-") && entry.endsWith(".tgz")) {
    rmSync(join(FUNCTIONS, entry));
  }
}

const packResult = spawnSync(
  "npm",
  ["pack", "--pack-destination", FUNCTIONS, SHARED],
  { cwd: ROOT, stdio: "inherit" },
);
if (packResult.status !== 0) {
  throw new Error(`npm pack failed (exit ${packResult.status})`);
}

const tarball = readdirSync(FUNCTIONS).find(
  (f) => f.startsWith("oww-shared-") && f.endsWith(".tgz"),
);
if (!tarball) {
  throw new Error("npm pack did not produce a tarball");
}

const pkg = JSON.parse(readFileSync(PKG_JSON_PATH, "utf-8")) as {
  dependencies: Record<string, string>;
};
pkg.dependencies["@oww/shared"] = `file:./${tarball}`;
writeFileSync(PKG_JSON_PATH, JSON.stringify(pkg, null, 2) + "\n");

console.log(
  `[prepare-functions-deploy] Rewrote functions/package.json @oww/shared -> file:./${tarball}`,
);
console.log(
  `[prepare-functions-deploy] Run 'npm run deploy:functions:cleanup' after deploy to restore.`,
);
