// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression net for issue #421: the kiosk window read "OWW Hardware Bridge"
// instead of the product name. The OS window title comes from two sources that
// must agree — the BrowserWindow title (config.productName, re-asserted at
// runtime in main.ts) and the renderer document's <title> — so we pin both.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { resolveConfig } from "./config.ts"

const EXPECTED_TITLE = "OWW Self Checkout"

const here = path.dirname(fileURLToPath(import.meta.url))

test("config.productName is the OWW Self Checkout title", () => {
  assert.equal(resolveConfig().productName, EXPECTED_TITLE)
})

test("renderer index.html <title> matches the product name", () => {
  const html = readFileSync(
    path.join(here, "..", "renderer", "index.html"),
    "utf8"
  )
  const match = html.match(/<title>([^<]*)<\/title>/)
  assert.ok(match, "index.html must declare a <title>")
  assert.equal(match[1], EXPECTED_TITLE)
})
