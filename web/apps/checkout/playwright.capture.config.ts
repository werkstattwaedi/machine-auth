// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Runs only the workqueue's throwaway `*.capture.ts` specs (gitignored) for
// review screenshots — see scripts/wq-capture.sh. Same emulators, web server
// and global setup as the e2e suite; no sharding, retries or baselines.

import { defineConfig } from "@playwright/test"

import base from "./playwright.config"

export default defineConfig({
  ...base,
  testMatch: /\.capture\.ts$/,
  testIgnore: [],
  shard: null,
  retries: 0,
  updateSnapshots: "none",
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
