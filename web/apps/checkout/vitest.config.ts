// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import path from "path"
import { defineConfig } from "vitest/config"
import { loadEnv } from "vite"
import react from "@vitejs/plugin-react"

// Load .env.development at config-resolve time so VITE_* vars are exposed
// to import.meta.env in the vitest runner. Without this, modules that now
// fail loud on missing VITE_LOCALE / VITE_CURRENCY (issue #149) would
// throw at import time.
//
// CI doesn't have .env.development (it's gitignored, generated from the
// operations repo via `npm run generate-env`). Fall back to checked-in
// test defaults so unit tests work without the operations-repo checkout.
// The fail-loud check in format.ts still applies to real Vite builds.
const TEST_ENV_DEFAULTS: Record<string, string> = {
  VITE_LOCALE: "de-CH",
  VITE_CURRENCY: "CHF",
  VITE_CHECKOUT_DOMAIN: "localhost:5173",
  VITE_FUNCTIONS_REGION: "us-central1",
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
  test: {
    environment: "jsdom",
    setupFiles: ["../../modules/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "../../modules/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.integration.test.{ts,tsx}", "src/**/*.browser.test.{ts,tsx}",
              "../../modules/**/*.integration.test.{ts,tsx}", "../../modules/**/*.browser.test.{ts,tsx}"],
  },
})
