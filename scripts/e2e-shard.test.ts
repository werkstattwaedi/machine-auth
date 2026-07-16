// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Locks the PLAYWRIGHT_SHARD parsing contract (issue #530). The failure mode
// this guards against is silent: a shard that parses to the wrong window (or
// to "no shard") skips tests while CI still reports green. Every malformed
// input must throw instead.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseShard } from "./e2e-shard.ts";

test("unset or empty means no shard — run the whole suite", () => {
  assert.equal(parseShard(undefined), undefined);
  assert.equal(parseShard(""), undefined);
  assert.equal(parseShard("   "), undefined);
});

test("parses current/total", () => {
  assert.deepEqual(parseShard("1/4"), { current: 1, total: 4 });
  assert.deepEqual(parseShard("4/4"), { current: 4, total: 4 });
  assert.deepEqual(parseShard("1/1"), { current: 1, total: 1 });
});

test("tolerates surrounding whitespace", () => {
  assert.deepEqual(parseShard(" 2/4 "), { current: 2, total: 4 });
});

test("the 4 CI shards tile 1..4 exactly once", () => {
  const covered = ["1/4", "2/4", "3/4", "4/4"].map(
    (value) => parseShard(value)!.current,
  );
  assert.deepEqual(covered.sort(), [1, 2, 3, 4]);
});

test("rejects malformed values rather than silently running everything", () => {
  for (const bad of ["4", "1/", "/4", "a/b", "1-4", "1/4/4", "1.5/4"]) {
    assert.throws(() => parseShard(bad), /PLAYWRIGHT_SHARD/, `expected "${bad}" to throw`);
  }
});

test("rejects an out-of-range shard index", () => {
  assert.throws(() => parseShard("0/4"), /within 1\.\.4/);
  assert.throws(() => parseShard("5/4"), /within 1\.\.4/);
  assert.throws(() => parseShard("1/0"), /total must be >= 1/);
});
