// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import path from "path"
import { defineConfig } from "vitest/config"
import { loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import { playwright } from "@vitest/browser-playwright"

// Mirrors the env-loading dance in vitest.config.ts so modules that
// fail loud on missing VITE_LOCALE / VITE_CURRENCY (issue #149) don't
// throw at import time when the operations repo isn't checked out.
const TEST_ENV_DEFAULTS: Record<string, string> = {
  VITE_LOCALE: "de-CH",
  VITE_CURRENCY: "CHF",
  VITE_CHECKOUT_DOMAIN: "localhost:5173",
  VITE_FUNCTIONS_REGION: "europe-west6",
  VITE_FIREBASE_API_KEY: "fake-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "test.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "oww-maco",
  VITE_FIREBASE_STORAGE_BUCKET: "oww-maco.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:000000000000",
}
const env = { ...TEST_ENV_DEFAULTS, ...loadEnv("development", __dirname, "") }

export default defineConfig({
  plugins: [react()],
  define: Object.fromEntries(
    Object.entries(env)
      .filter(([k]) => k.startsWith("VITE_"))
      .map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  ),
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
