// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { defineConfig } from "@playwright/test"

// E2E emulator ports — must match firebase.e2e.json. The Vite port is offset
// from the checkout app (5188) so both apps can run side-by-side under the
// same emulator session if a future runner ever parallelizes them.
export const E2E_PORTS = {
  vite: 5189,
  auth: 9199,
  firestore: 8180,
  functions: 5101,
}

// Admin is desktop-first — we deliberately skip the mobile Chromium project
// that the checkout config carries. (See issue #160 acceptance criteria:
// "Admin viewport set to desktop (1280×720)".)
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // sequential — tests share emulator state
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `https://localhost:${E2E_PORTS.vite}`,
    ignoreHTTPSErrors: true, // Vite self-signed cert
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 720 },
  },

  projects: [{ name: "chromium", use: { browserName: "chromium" } }],

  globalSetup: "./e2e/global-setup.ts",

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
    },
  },
})
