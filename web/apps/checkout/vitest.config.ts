// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import path from "path"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
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
