// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Covers `scripts/generate-env.ts --env <name>` (ADR-0034): the
 * environment-overlay mode used to stand up staging. It must
 *   1. deep-merge `config.<name>.jsonc` over the base `config.jsonc`,
 *   2. emit only the three env-suffixed deploy files
 *      (functions/.env.<projectId>, web checkout+admin .env.<name>), and
 *   3. leave the prod `.env.production` / `.firebaserc` untouched.
 *
 * A throwaway env name + temp OPERATIONS_CONFIG_DIR keep the test
 * self-contained (no operations repo needed) and collision-free.
 */

import { expect } from "chai";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Mocha runs the compiled file from `functions/lib/test/unit/*.js` — four
// levels up from that is the repo root (the extra `..` accounts for `lib`).
const REPO_ROOT = resolve(__dirname, "../../../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/generate-env.ts");

const ENV_NAME = "overlaytest";
const PROJECT_ID = "oww-overlaytest";

const GENERATED = [
  `functions/.env.${PROJECT_ID}`,
  `web/apps/checkout/.env.${ENV_NAME}`,
  `web/apps/admin/.env.${ENV_NAME}`,
];

// Prod artifacts the overlay must never rewrite.
const PROD_ARTIFACTS = [
  ".firebaserc",
  "web/apps/checkout/.env.production",
  "functions/.env.oww-maco",
];

const BASE_CONFIG = JSON.stringify({
  firebase: {
    projectId: "oww-maco",
    region: "europe-west6",
    apiKey: "BASE_KEY",
    authDomain: "checkout.example.test",
    storageBucket: "oww-maco.firebasestorage.app",
    messagingSenderId: "111",
    appId: "1:111:web:base",
  },
  functions: {
    diversificationSystemName: "Oww8820Maco",
    particleProductId: "base-product",
    loginAllowedOrigins: "https://checkout.example.test",
  },
  web: {
    checkoutDomain: "checkout.example.test",
    locale: "de-CH",
    currency: "CHF",
    organizationName: "OWW",
    smsLoginEnabled: "true",
  },
  nfc: { sdmBaseUrl: "id.example.test/" },
});

const OVERLAY_CONFIG = JSON.stringify({
  firebase: {
    projectId: PROJECT_ID,
    apiKey: "OVERLAY_KEY",
    appId: "1:222:web:overlay",
  },
  web: { checkoutDomain: "oww-overlaytest.web.app", smsLoginEnabled: "false" },
});

let opsDir: string;

function run(): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("npx", ["tsx", SCRIPT, "--env", ENV_NAME], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env, OPERATIONS_CONFIG_DIR: opsDir },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

describe("generate-env --env <name> overlay (ADR-0034)", () => {
  let prodBefore: Map<string, string | null>;

  before(function () {
    this.timeout(20_000);
    opsDir = mkdtempSync(resolve(tmpdir(), "oww-ops-"));
    writeFileSync(resolve(opsDir, "config.jsonc"), BASE_CONFIG);
    writeFileSync(resolve(opsDir, `config.${ENV_NAME}.jsonc`), OVERLAY_CONFIG);

    prodBefore = new Map();
    for (const rel of PROD_ARTIFACTS) {
      const p = resolve(REPO_ROOT, rel);
      prodBefore.set(rel, existsSync(p) ? readFileSync(p, "utf-8") : null);
    }
  });

  after(() => {
    for (const rel of GENERATED) rmSync(resolve(REPO_ROOT, rel), { force: true });
    if (opsDir) rmSync(opsDir, { recursive: true, force: true });
  });

  it("emits the three env-suffixed files and exits cleanly", function () {
    this.timeout(20_000);
    const r = run();
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).to.equal(0);
    for (const rel of GENERATED) {
      expect(existsSync(resolve(REPO_ROOT, rel)), `${rel} not generated`).to.equal(
        true
      );
    }
  });

  it("applies overlay overrides on top of inherited base values", () => {
    const web = readFileSync(
      resolve(REPO_ROOT, `web/apps/checkout/.env.${ENV_NAME}`),
      "utf-8"
    );
    // Overridden by the overlay:
    expect(web).to.include("VITE_FIREBASE_PROJECT_ID=oww-overlaytest");
    expect(web).to.include("VITE_FIREBASE_API_KEY=OVERLAY_KEY");
    expect(web).to.include("VITE_CHECKOUT_DOMAIN=oww-overlaytest.web.app");
    expect(web).to.include("VITE_SMS_LOGIN_ENABLED=false");
    // Inherited from the base config (deep-merge, not replaced):
    expect(web).to.include("VITE_FUNCTIONS_REGION=europe-west6");
    expect(web).to.include("VITE_CURRENCY=CHF");

    const fns = readFileSync(
      resolve(REPO_ROOT, `functions/.env.${PROJECT_ID}`),
      "utf-8"
    );
    expect(fns).to.include("DIVERSIFICATION_SYSTEM_NAME=Oww8820Maco"); // inherited
    expect(fns).to.include("CHECKOUT_DOMAIN=oww-overlaytest.web.app"); // overridden
  });

  it("does NOT rewrite the prod .env.production / .firebaserc", () => {
    for (const rel of PROD_ARTIFACTS) {
      const p = resolve(REPO_ROOT, rel);
      const after = existsSync(p) ? readFileSync(p, "utf-8") : null;
      expect(after, `overlay modified ${rel}`).to.equal(prodBefore.get(rel) ?? null);
    }
  });

  it("fails clearly when config.<name>.jsonc is absent", function () {
    this.timeout(20_000);
    const r = spawnSync("npx", ["tsx", SCRIPT, "--env", "nonexistent"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: { ...process.env, OPERATIONS_CONFIG_DIR: opsDir },
    });
    expect(r.status).to.not.equal(0);
    expect(`${r.stderr}${r.stdout}`).to.include("config.nonexistent.jsonc");
  });
});
