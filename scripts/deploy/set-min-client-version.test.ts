// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { sitesBelow, validMinVersion } from "./set-min-client-version.ts";

test("only a clean release can be the minimum", () => {
  assert.equal(validMinVersion("2026.11.4"), true);
  assert.equal(validMinVersion("2026.11.4-dev.1+g1a2b3c4d"), false);
  assert.equal(validMinVersion("2026.11.4+g1a2b3c4d.dirty"), false);
  assert.equal(validMinVersion("dev"), false);
});

test("names every site that doesn't serve the minimum yet", () => {
  assert.deepEqual(
    sitesBelow(
      [
        { site: "checkout", version: "2026.11.4" },
        { site: "admin", version: "2026.11.3" },
        { site: "other", version: null },
      ],
      "2026.11.4"
    ),
    ["admin serves 2026.11.3", "other serves (unreadable)"]
  );
  assert.deepEqual(sitesBelow([{ site: "checkout", version: "2026.12.1" }], "2026.11.4"), []);
});
