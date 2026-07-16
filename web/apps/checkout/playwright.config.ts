// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { defineConfig } from "@playwright/test"

import { parseShard } from "../../../scripts/e2e-shard.ts"

// E2E emulator ports (offset from dev ports to avoid conflicts).
// `scripts/port-block.ts` exports EMULATOR_*_PORT when running under the
// broker; default to the firebase.e2e.json values otherwise.
export const E2E_PORTS = {
  vite: 5188,
  auth: Number(process.env.EMULATOR_AUTH_PORT ?? 9199),
  firestore: Number(process.env.EMULATOR_FIRESTORE_PORT ?? 8180),
  functions: Number(process.env.EMULATOR_FUNCTIONS_PORT ?? 5101),
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // sequential — tests share emulator state
  workers: 1,
  // Sharding happens across CI runners, not workers (issue #530): each shard
  // is a separate job with its own emulator, so `workers: 1` still holds
  // within a shard. Unset locally = run the whole suite.
  shard: parseShard(process.env.PLAYWRIGHT_SHARD) ?? null,
  // One retry on CI only. Sharding doesn't cause flake, but 5 parallel jobs
  // give an existing flake 5 chances to surface and redden an unrelated PR.
  // Locally a flake should stay visible.
  retries: process.env.CI ? 1 : 0,
  // Threaded from the `update_snapshots` workflow_dispatch input, which can't
  // pass `--update-snapshots` through the nested npm run chain.
  updateSnapshots:
    process.env.PLAYWRIGHT_UPDATE_SNAPSHOTS === "true" ? "all" : undefined,
  timeout: 30_000,
  // Tolerate sub-percent font/subpixel rendering drift between dev hosts
  // and CI (issue #317). Observed drift is ~50–160 pixels (ratio < 0.001);
  // 1% gives generous headroom while still catching layout regressions.
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  use: {
    baseURL: `https://localhost:${E2E_PORTS.vite}`,
    ignoreHTTPSErrors: true, // Vite self-signed cert
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "mobile-chrome",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  webServer: {
    command: `npx vite --port ${E2E_PORTS.vite}`,
    url: `https://localhost:${E2E_PORTS.vite}`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_EMULATOR_AUTH_PORT: String(E2E_PORTS.auth),
      VITE_EMULATOR_FIRESTORE_PORT: String(E2E_PORTS.firestore),
      VITE_EMULATOR_FUNCTIONS_PORT: String(E2E_PORTS.functions),
      // SMS login codes (ADR-0031): E2E always exercises the flag-on flow
      // against the Auth emulator, regardless of the local .env.development.
      VITE_SMS_LOGIN_ENABLED: "true",
    },
  },
})
