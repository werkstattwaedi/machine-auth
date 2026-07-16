// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Locks the selection bucketing rules: pre-commit suites (issue #368) and CI
// e2e targets (issue #530). If a path is re-bucketed or a rule is loosened,
// these assertions fail.
//
// The e2e cases matter more than the suite ones: a wrongly *narrowed* e2e
// selection means CI silently stops running tests that could catch the change.

import { test } from "node:test";
import assert from "node:assert/strict";

import { selectE2eTargets, selectSuites } from "./precommit-select.ts";

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

// --- e2e target selection (issue #530) ---------------------------------

test("checkout-only paths select the checkout e2e suite, not admin", () => {
  assert.deepEqual(
    sorted(
      selectE2eTargets([
        "web/apps/checkout/src/routes/index.tsx",
        "web/apps/checkout/e2e/checkin.spec.ts",
      ]),
    ),
    ["checkout"],
  );
});

test("admin-only paths select the admin e2e suite, not checkout", () => {
  assert.deepEqual(
    sorted(selectE2eTargets(["web/apps/admin/src/routes/users.tsx"])),
    ["admin"],
  );
});

// The under-selection guardrail: anything shared by both apps must never
// deselect one of them.
test("web/modules/ (shared UI + firestore access) selects both e2e suites", () => {
  assert.deepEqual(
    sorted(selectE2eTargets(["web/modules/lib/firestore-helpers.ts"])),
    ["admin", "checkout"],
  );
});

test("shared/ selects both e2e suites", () => {
  assert.deepEqual(sorted(selectE2eTargets(["shared/src/catalog-import.ts"])), [
    "admin",
    "checkout",
  ]);
});

test("scripts/ (test infra) selects both e2e suites", () => {
  assert.deepEqual(sorted(selectE2eTargets(["scripts/port-block.ts"])), [
    "admin",
    "checkout",
  ]);
});

test("firestore/ (rules) selects both e2e suites", () => {
  assert.deepEqual(sorted(selectE2eTargets(["firestore/firestore.rules"])), [
    "admin",
    "checkout",
  ]);
});

test("emulator config / root lockfile select both e2e suites", () => {
  for (const file of ["firebase.json", "package.json", "package-lock.json"]) {
    assert.deepEqual(
      sorted(selectE2eTargets([file])),
      ["admin", "checkout"],
      `${file} must select both e2e suites`,
    );
  }
});

// The e2e emulator runs the compiled functions and both apps call them, so a
// functions change can't deselect an app — even though it selects only the
// `functions` unit suite.
test("functions/ and proto/ select both e2e suites", () => {
  assert.deepEqual(
    sorted(selectE2eTargets(["functions/src/auth/dispatcher.ts"])),
    ["admin", "checkout"],
  );
  assert.deepEqual(sorted(selectE2eTargets(["proto/messages.proto"])), [
    "admin",
    "checkout",
  ]);
});

// A change to the e2e job/matrix must be validated by running e2e.
test(".github/workflows/ selects both e2e suites but no unit suite", () => {
  assert.deepEqual(sorted(selectE2eTargets([".github/workflows/test.yml"])), [
    "admin",
    "checkout",
  ]);
  assert.deepEqual(sorted(selectSuites([".github/workflows/test.yml"])), []);
});

// The 8% bucket this stage buys: a full ~25 min e2e run -> 0.
test("docs / firmware / gateway / kiosk only -> no e2e suite", () => {
  assert.deepEqual(
    sorted(
      selectE2eTargets([
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

test("empty input -> no e2e suite", () => {
  assert.deepEqual(sorted(selectE2eTargets([])), []);
  assert.deepEqual(sorted(selectE2eTargets(["", "  ", "\t"])), []);
});

test("checkout + admin changes select both e2e suites", () => {
  assert.deepEqual(
    sorted(
      selectE2eTargets([
        "web/apps/checkout/src/x.tsx",
        "web/apps/admin/src/y.tsx",
      ]),
    ),
    ["admin", "checkout"],
  );
});

test("a docs change alongside a checkout change still selects checkout only", () => {
  assert.deepEqual(
    sorted(selectE2eTargets(["docs/README.md", "web/apps/checkout/src/x.tsx"])),
    ["checkout"],
  );
});
