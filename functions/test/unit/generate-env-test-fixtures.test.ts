// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression for issue #296: `scripts/generate-env.ts --emit-test-files`
 * must produce the three checked-in `.env.test` fixtures that CI uses to
 * boot the emulator suite + Playwright, and they must never contain a
 * production secret. The mode must also be idempotent (re-emitting
 * doesn't change committed bytes) and side-effect-free with respect to
 * the other `.env*` files emitted by the default mode.
 */

import { expect } from "chai";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Mocha runs the compiled file from `functions/lib/test/unit/*.js` — four
// levels up from that is the repo root. Source path here is
// `functions/test/unit/*.ts`; the extra `..` accounts for `lib`.
const REPO_ROOT = resolve(__dirname, "../../../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/generate-env.ts");

const FIXTURE_PATHS = [
  "functions/.env.test",
  "web/apps/checkout/.env.test",
  "web/apps/admin/.env.test",
];

/**
 * Canary substrings copied verbatim from the production operations
 * config. If any of these appears in a checked-in `.env.test`, the
 * fixture has been contaminated with a real secret.
 */
const PRODUCTION_CANARIES = [
  "AIzaSyAGK43KjUImH8LBZVi4T9bOJvcr4rW-hkA", // real Firebase web API key
  "hxnqv", // real RaiseNow PayLink solution ID
  "34698447170", // real Firebase messaging sender ID
  "maschinenfreigabe-33764", // real Particle product slug
  "CH56 0681 4580 1260 0509 7", // real OWW IBAN
  "1:34698447170:web:6169f8366d670e983d20db", // real Firebase appId
];

/** Dummy/public values that MUST appear in the fixtures. */
const REQUIRED_LITERALS: Record<string, string[]> = {
  "functions/.env.test": [
    // Test-fixture crypto keys (also baked into e2e global-setup.ts).
    "DIVERSIFICATION_MASTER_KEY=c025f541727ecd8b6eb92055c88a2a70",
    "TERMINAL_KEY=f5e4b999d5aa629f193a874529c4aa2f",
    "DIVERSIFICATION_SYSTEM_NAME=Oww8820Maco",
    // TEST_FIXTURE_OVERRIDES — dummy placeholders only.
    "RESEND_API_KEY=re_test_fake_ci_key",
    "PARTICLE_TOKEN=ci-test-particle-token",
    "GATEWAY_API_KEY=ci-test-gateway-key",
  ],
  "web/apps/checkout/.env.test": [
    "VITE_FIREBASE_PROJECT_ID=oww-maco",
    "VITE_FIREBASE_API_KEY=fake-api-key",
  ],
  "web/apps/admin/.env.test": [
    "VITE_FIREBASE_PROJECT_ID=oww-maco",
    "VITE_FIREBASE_API_KEY=fake-api-key",
  ],
};

function runEmit(): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("npx", ["tsx", SCRIPT, "--emit-test-files"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

describe("generate-env --emit-test-files (issue #296)", () => {
  it("emits the three .env.test fixtures and exits cleanly", function () {
    this.timeout(20_000); // tsx cold-start + write
    const r = runEmit();
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).to.equal(0);
    for (const rel of FIXTURE_PATHS) {
      const p = resolve(REPO_ROOT, rel);
      expect(existsSync(p), `${rel} not generated`).to.equal(true);
      expect(statSync(p).size, `${rel} is empty`).to.be.greaterThan(0);
    }
  });

  it("contains required dummy-secret literals (TEST_FIXTURE_OVERRIDES + fixture config)", () => {
    for (const [rel, literals] of Object.entries(REQUIRED_LITERALS)) {
      const content = readFileSync(resolve(REPO_ROOT, rel), "utf-8");
      for (const literal of literals) {
        expect(
          content,
          `Expected ${rel} to contain ${literal}`
        ).to.include(literal);
      }
    }
  });

  it("contains NO production secret canaries", () => {
    for (const rel of FIXTURE_PATHS) {
      const content = readFileSync(resolve(REPO_ROOT, rel), "utf-8");
      for (const canary of PRODUCTION_CANARIES) {
        expect(
          content.includes(canary),
          `Production canary "${canary}" leaked into ${rel}!`
        ).to.equal(false);
      }
    }
  });

  it("does not touch local-dev env files (default mode untouched)", function () {
    this.timeout(20_000);
    // Snapshot the bytes of any local-dev env files that exist BEFORE the
    // emit, then re-emit, and verify the dev files weren't disturbed.
    // (The default-mode env files are gitignored; we just verify
    // --emit-test-files is side-effect-free on them.)
    const devPaths = [
      "functions/.env.local",
      "web/apps/checkout/.env.development",
      "web/apps/admin/.env.development",
    ].map((p) => resolve(REPO_ROOT, p));
    const before = new Map<string, string | null>();
    for (const p of devPaths) {
      before.set(p, existsSync(p) ? readFileSync(p, "utf-8") : null);
    }

    const r = runEmit();
    expect(r.status).to.equal(0);

    for (const p of devPaths) {
      const after = existsSync(p) ? readFileSync(p, "utf-8") : null;
      expect(
        after,
        `--emit-test-files modified ${p}`
      ).to.equal(before.get(p) ?? null);
    }
  });

  it("is idempotent (re-emitting yields identical bytes)", function () {
    this.timeout(20_000);
    const first = FIXTURE_PATHS.map((rel) =>
      readFileSync(resolve(REPO_ROOT, rel), "utf-8")
    );
    const r = runEmit();
    expect(r.status).to.equal(0);
    const second = FIXTURE_PATHS.map((rel) =>
      readFileSync(resolve(REPO_ROOT, rel), "utf-8")
    );
    for (let i = 0; i < FIXTURE_PATHS.length; i++) {
      expect(
        second[i],
        `${FIXTURE_PATHS[i]} changed on re-emit`
      ).to.equal(first[i]);
    }
  });
});
