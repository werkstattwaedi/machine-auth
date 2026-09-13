// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression net for issue #421: the kiosk window read "OWW Hardware Bridge"
// instead of the product name. The OS window title comes from two sources that
// must agree — the BrowserWindow title (config.productName, re-asserted at
// runtime in main.ts) and the renderer document's <title> — so we pin both.
// config.productName additionally carries the build's environment label
// ("[staging] OWW Self Checkout"); the renderer title stays the bare name
// because main.ts overrides it at runtime.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { withEnvLabel } from "@oww/shared"

import { BRIDGE_ENV_LABEL } from "./build-config.generated.ts"
import { PRODUCT_NAME, resolveConfig } from "./config.ts"

const here = path.dirname(fileURLToPath(import.meta.url))

test("config.productName is the OWW Self Checkout title plus env label", () => {
  const { productName } = resolveConfig()
  assert.equal(productName, withEnvLabel(BRIDGE_ENV_LABEL, PRODUCT_NAME))
  assert.ok(
    productName.endsWith(PRODUCT_NAME),
    `productName must end with the base name, got ${JSON.stringify(productName)}`
  )
})

test("renderer index.html <title> matches the base product name", () => {
  const html = readFileSync(
    path.join(here, "..", "renderer", "index.html"),
    "utf8"
  )
  const match = html.match(/<title>([^<]*)<\/title>/)
  assert.ok(match, "index.html must declare a <title>")
  assert.equal(match[1], PRODUCT_NAME)
})
