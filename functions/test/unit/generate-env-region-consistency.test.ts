// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression for issue #371: the Functions region must not split-brain
 * between the deployed region (firebase.ts / options.ts pin europe-west6,
 * #211/#369) and the generated web env files.
 *
 * `scripts/generate-env.ts` maps `VITE_FUNCTIONS_REGION ← firebase.region`
 * from the operations `config.jsonc`. When that single source of truth
 * drifted to `us-central1` after the functions moved to europe-west6, the
 * generated `.env.development` / `.env.production` pointed the raw
 * verify-tag fetch (`web/modules/lib/token-auth.ts`) at the wrong region —
 * breaking NFC self-checkout in production and the local e2e baseline,
 * while CI stayed green because the port-block broker substitutes the
 * (correct) committed `.env.test` fixtures when the operations repo is
 * absent.
 *
 * This test runs the real generation pipeline against the operations
 * config and asserts the generated dev/prod region for both web apps
 * matches the deployed region declared in the committed `.env.test`
 * fixtures (which CI's freshness guard already locks to europe-west6).
 * No region literal is hard-coded here — the invariant is "generated
 * dev/prod region == the deployed/test region", so it survives a future
 * region move as long as the move is made in one place (the config).
 *
 * Gated on the operations repo being present: on CI runners that don't
 * clone it, generation can't run, so the test skips (the e2e job already
 * exercises the committed fixtures there).
 */

import { expect } from "chai";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Mocha runs the compiled file from `functions/lib/test/unit/*.js` — four
// levels up from that is the repo root. The extra `..` accounts for `lib`.
const REPO_ROOT = resolve(__dirname, "../../../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/generate-env.ts");

const OPERATIONS_CONFIG_DIR =
  process.env.OPERATIONS_CONFIG_DIR ||
  resolve(REPO_ROOT, "..", "machine-auth-operations");
const OPERATIONS_CONFIG = resolve(OPERATIONS_CONFIG_DIR, "config.jsonc");

// The deployed/test region is the source of comparison — kept correct by
// the `.env.test` freshness guard (issue #296) + TEST_FIXTURE_CONFIG.
const TEST_FIXTURE_ENV = resolve(REPO_ROOT, "web/apps/checkout/.env.test");

// Generated dev/prod env files (gitignored) that must agree with it.
const GENERATED_ENV_FILES = [
  "web/apps/checkout/.env.development",
  "web/apps/checkout/.env.production",
  "web/apps/admin/.env.development",
  "web/apps/admin/.env.production",
];

function regionOf(envFileAbsPath: string): string | undefined {
  const content = readFileSync(envFileAbsPath, "utf-8");
  const match = content.match(/^VITE_FUNCTIONS_REGION=(.+)$/m);
  return match?.[1]?.trim();
}

describe("generate-env region consistency (issue #371)", function () {
  before(function () {
    if (!existsSync(OPERATIONS_CONFIG)) {
      // CI / fresh checkout without the operations repo — generation
      // can't run; the e2e job covers the committed fixtures instead.
      this.skip();
    }
  });

  it("generated dev/prod region matches the deployed (.env.test) region for both web apps", function () {
    this.timeout(20_000); // tsx cold-start + write

    const expectedRegion = regionOf(TEST_FIXTURE_ENV);
    expect(expectedRegion, "VITE_FUNCTIONS_REGION missing from .env.test").to
      .be.a("string")
      .and.not.equal("");

    const gen = spawnSync("npx", ["tsx", SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
    expect(
      gen.status,
      `generate-env failed:\nstdout:\n${gen.stdout}\nstderr:\n${gen.stderr}`
    ).to.equal(0);

    for (const rel of GENERATED_ENV_FILES) {
      const p = resolve(REPO_ROOT, rel);
      expect(existsSync(p), `${rel} not generated`).to.equal(true);
      expect(
        regionOf(p),
        `${rel} VITE_FUNCTIONS_REGION must match the deployed region ` +
          `(${expectedRegion}) — a split-brain here breaks NFC self-checkout ` +
          `in production (issue #371)`
      ).to.equal(expectedRegion);
    }
  });
});
