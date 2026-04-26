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
const env = loadEnv("development", __dirname, "")

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
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.integration.test.{ts,tsx}", "src/**/*.browser.test.{ts,tsx}"],
  },
})
