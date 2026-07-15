// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Locks the port-block broker's test-secret pinning (baseline hermeticity).
// The functions emulator resolves any defineSecret missing from
// .secret.local against Cloud Secret Manager — on an authenticated dev
// machine that silently swaps in production keys and breaks the tag-crypto
// e2e suites while CI stays green. These assertions fail if a secret is
// dropped from the pin list or values stop coming from .env.test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

import {
  FUNCTION_SECRET_NAMES,
  buildTestSecretFileContent,
} from "./port-block-secrets.ts";

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

function parse(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

test("pin list covers every defineSecret in functions/src", () => {
  // Source of truth: the actual defineSecret() calls. If a new secret is
  // added without extending FUNCTION_SECRET_NAMES, the emulator would
  // fall back to Cloud Secret Manager for it during local test runs.
  const srcDir = resolve(projectRoot, "functions/src");
  const declared = new Set<string>();
  for (const entry of readdirSync(srcDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const content = readFileSync(join(entry.parentPath, entry.name), "utf-8");
    for (const m of content.matchAll(/defineSecret\("([A-Z0-9_]+)"\)/g)) {
      declared.add(m[1]);
    }
  }
  assert.ok(declared.size > 0, "expected at least one defineSecret");
  for (const name of declared) {
    assert.ok(
      FUNCTION_SECRET_NAMES.includes(name),
      `defineSecret("${name}") is not pinned in FUNCTION_SECRET_NAMES — ` +
        "add it so local test runs never read it from Cloud Secret Manager"
    );
  }
});

test("secret values come from .env.test where present", () => {
  const envTest = readFileSync(
    resolve(projectRoot, "functions/.env.test"),
    "utf-8"
  );
  const envValues = parse(envTest);
  const pinned = parse(buildTestSecretFileContent(envTest));

  for (const name of FUNCTION_SECRET_NAMES) {
    assert.ok(pinned.has(name), `${name} missing from generated .secret.local`);
    if (envValues.has(name)) {
      assert.equal(
        pinned.get(name),
        envValues.get(name),
        `${name} must match the committed .env.test fixture`
      );
    } else {
      assert.equal(
        pinned.get(name),
        `ci-test-dummy-${name.toLowerCase()}`,
        `${name} has no .env.test value and must get a deterministic dummy`
      );
    }
  }
});

test("TERMINAL_KEY and DIVERSIFICATION_MASTER_KEY are always pinned", () => {
  // The tag-crypto pair whose Secret Manager fallback caused the original
  // baseline break — never allow these to escape the pin list.
  const pinned = parse(buildTestSecretFileContent(""));
  assert.ok(pinned.has("TERMINAL_KEY"));
  assert.ok(pinned.has("DIVERSIFICATION_MASTER_KEY"));
});
