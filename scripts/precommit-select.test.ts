// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Locks the pre-commit suite-selection bucketing rules (issue #368). If a path
// is re-bucketed or a rule is loosened, these assertions fail.

import { test } from "node:test";
import assert from "node:assert/strict";

import { selectSuites } from "./precommit-select.ts";

function sorted(set: Set<string>): string[] {
  return [...set].sort();
}

test("web/ paths select only web", () => {
  assert.deepEqual(sorted(selectSuites(["web/apps/checkout/src/x.tsx"])), [
    "web",
  ]);
});

test("functions/ paths select only functions", () => {
  assert.deepEqual(sorted(selectSuites(["functions/src/auth/x.ts"])), [
    "functions",
  ]);
});

test("proto/ paths select only functions", () => {
  assert.deepEqual(sorted(selectSuites(["proto/messages.proto"])), [
    "functions",
  ]);
});

test("shared/ paths select both suites", () => {
  assert.deepEqual(sorted(selectSuites(["shared/src/index.ts"])), [
    "functions",
    "web",
  ]);
});

test("scripts/ (test infra) selects both suites", () => {
  assert.deepEqual(sorted(selectSuites(["scripts/port-block.ts"])), [
    "functions",
    "web",
  ]);
});

test("firestore/ (rules) selects both suites", () => {
  assert.deepEqual(sorted(selectSuites(["firestore/firestore.rules"])), [
    "functions",
    "web",
  ]);
});

test("firebase.json selects both suites", () => {
  assert.deepEqual(sorted(selectSuites(["firebase.json"])), [
    "functions",
    "web",
  ]);
});

test("root package.json / lockfile select both suites", () => {
  assert.deepEqual(sorted(selectSuites(["package.json"])), [
    "functions",
    "web",
  ]);
  assert.deepEqual(sorted(selectSuites(["package-lock.json"])), [
    "functions",
    "web",
  ]);
});

test("docs / firmware / gateway / kiosk only -> no suite", () => {
  assert.deepEqual(
    sorted(
      selectSuites([
        "README.md",
        "docs/adr/0001-x.md",
        "maco_firmware/src/main.cc",
        "maco_gateway/gateway.py",
        "checkout-kiosk/src/main.ts",
      ]),
    ),
    [],
  );
});

test("mixed web + functions selects both", () => {
  assert.deepEqual(
    sorted(selectSuites(["web/x.ts", "functions/y.ts"])),
    ["functions", "web"],
  );
});

test("empty input -> no suite", () => {
  assert.deepEqual(sorted(selectSuites([])), []);
});

test("blank / whitespace lines are ignored", () => {
  assert.deepEqual(sorted(selectSuites(["", "  ", "\t"])), []);
});

test("a docs change alongside a web change still selects web", () => {
  assert.deepEqual(
    sorted(selectSuites(["README.md", "web/apps/admin/src/page.tsx"])),
    ["web"],
  );
});
