// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@modules": path.resolve(__dirname, "../../modules"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.{ts,tsx}", "../../modules/**/*.integration.test.{ts,tsx}"],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
  },
})
