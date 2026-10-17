// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Every component reports this string (ADR-0045, phase 2a). These lock the
// two ways it could mislead: a build that isn't the release claiming to be
// it, and a release number that is handed out twice or in the wrong month.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareReleaseTags,
  nextReleaseTag,
  parseReleaseTag,
  versionFromDescribe,
} from "./build-version.ts";

const SHA = "1a2b3c4d";

test("only a clean build exactly at a release tag is that release", () => {
  assert.equal(versionFromDescribe(`v2026.10.2-0-g${SHA}`, SHA, false), "2026.10.2");
  assert.equal(
    versionFromDescribe(`v2026.10.2-0-g${SHA}`, SHA, true),
    `2026.10.2-dev.0+g${SHA}.dirty`
  );
  assert.equal(
    versionFromDescribe(`v2026.10.2-7-g${SHA}`, SHA, false),
    `2026.10.2-dev.7+g${SHA}`
  );
  assert.equal(
    versionFromDescribe(`v2026.10.2-7-g${SHA}`, SHA, true),
    `2026.10.2-dev.7+g${SHA}.dirty`
  );
});

test("without any release tag the version still names the commit", () => {
  assert.equal(versionFromDescribe(null, SHA, false), `0.0.0-dev+g${SHA}`);
  assert.equal(versionFromDescribe(null, SHA, true), `0.0.0-dev+g${SHA}.dirty`);
  // A tag that merely starts like a release isn't one.
  assert.equal(versionFromDescribe(`v2026.10-3-g${SHA}`, SHA, false), `0.0.0-dev+g${SHA}`);
});

test("the next release counts up within the month and restarts in a new one", () => {
  const tags = ["v2026.9.4", "v2026.10.1", "v2026.10.2", "deploy/prod/firebase/20261012-080000", "v1.0.14"];
  const oct = new Date("2026-10-12T10:00:00Z");
  assert.equal(nextReleaseTag(tags, oct), "v2026.10.3");
  assert.equal(nextReleaseTag(tags, new Date("2026-11-02T10:00:00Z")), "v2026.11.1");
  assert.equal(nextReleaseTag([], oct), "v2026.10.1");
  // Numbers, not strings: v2026.10.10 follows v2026.10.9.
  assert.equal(nextReleaseTag(["v2026.10.9", "v2026.10.10"], oct), "v2026.10.11");
});

test("the month is the Zurich month, not UTC", () => {
  // 23:30 UTC on Oct 31 is already November 1st in Zurich (CET, UTC+1).
  assert.equal(nextReleaseTag([], new Date("2026-10-31T23:30:00Z")), "v2026.11.1");
});

test("release tags sort newest first by number", () => {
  const sorted = ["v2026.10.2", "v2026.10.10", "v2026.9.30"].sort(compareReleaseTags);
  assert.deepEqual(sorted, ["v2026.10.10", "v2026.10.2", "v2026.9.30"]);
  assert.equal(parseReleaseTag("v2026.10"), null);
  assert.deepEqual(parseReleaseTag("v2026.10.2"), { year: 2026, month: 10, n: 2 });
});
