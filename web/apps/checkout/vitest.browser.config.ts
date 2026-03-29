// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import path from "path"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { playwright } from "@vitest/browser-playwright"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@modules": path.resolve(__dirname, "../../modules"),
    },
  },
  optimizeDeps: {
    include: ["@testing-library/jest-dom/vitest"],
  },
  test: {
    include: ["src/**/*.browser.test.{ts,tsx}", "../../modules/**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
    setupFiles: ["../../modules/test/setup-browser.ts"],
  },
})
