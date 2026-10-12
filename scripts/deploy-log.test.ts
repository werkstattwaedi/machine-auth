// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// STATE.md is the answer to "what runs where" (ADR-0045). These lock the
// two ways it could lie: picking the wrong entry as current, and a tag
// scheme that stops sorting chronologically.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type DeployEntry,
  currentState,
  deployTagName,
  formatTime,
  parseLog,
  renderState,
  serializeEntry,
} from "./deploy-log.ts";

const entries: DeployEntry[] = [
  { at: "2026-10-01T08:00:00.000Z", env: "prod", component: "firebase", commit: "a".repeat(40), by: "Mike" },
  { at: "2026-10-05T08:00:00.000Z", env: "staging", component: "firebase", commit: "b".repeat(40), by: "Mike" },
  { at: "2026-10-03T08:00:00.000Z", env: "prod", component: "firebase", commit: "c".repeat(40), by: "Mike" },
  { at: "2026-10-04T08:00:00.000Z", env: "prod", component: "firmware", target: "dev1", commit: "d".repeat(40), by: "Mike" },
  { at: "2026-10-02T08:00:00.000Z", env: "prod", component: "firmware", target: "dev2", commit: "e".repeat(40), by: "Mike" },
  { at: "2026-10-06T08:00:00.000Z", env: "prod", component: "ops", note: "rotated a secret", by: "Mike" },
];

test("current state keeps the newest entry per component/env/target, regardless of file order", () => {
  const state = currentState(entries);
  const prodFirebase = state.find((e) => e.component === "firebase" && e.env === "prod");
  assert.equal(prodFirebase?.commit, "c".repeat(40));
  assert.deepEqual(
    state.filter((e) => e.component === "firmware").map((e) => e.target),
    ["dev1", "dev2"]
  );
});

test("ops events appear in history but never as current state", () => {
  assert.ok(!currentState(entries).some((e) => e.component === "ops"));
  assert.match(renderState(entries), /rotated a secret/);
});

test("unreadable lines are reported and skipped, not fatal", () => {
  const bad: string[] = [];
  const text = serializeEntry(entries[0]) + "<<<<<<< HEAD\n{\"at\":\"trunc\n" + serializeEntry(entries[1]);
  assert.deepEqual(parseLog(text, (l) => bad.push(l)), [entries[0], entries[1]]);
  assert.equal(bad.length, 2);
});

test("a flash without a device id is history, never a current row", () => {
  const anon: DeployEntry = { at: "2026-10-07T08:00:00Z", env: "prod", component: "firmware", commit: "9".repeat(40), by: "Mike" };
  assert.ok(!currentState([...entries, anon]).some((e) => e.commit === anon.commit));
  assert.match(renderState([anon]), /_unknown_/);
});

test("log round-trips through JSONL, ignoring blank lines", () => {
  const text = entries.map(serializeEntry).join("") + "\n\n";
  assert.deepEqual(parseLog(text), entries);
});

test("tag names sort chronologically and omit the target", () => {
  const tag = deployTagName("prod", "firmware", new Date("2026-10-12T13:05:09.123Z"));
  assert.equal(tag, "deploy/prod/firmware/20261012-130509");
  const later = deployTagName("prod", "firmware", new Date("2026-10-12T13:05:10Z"));
  assert.ok(tag < later);
});

test("times render in Zurich wall-clock time", () => {
  assert.equal(formatTime("2026-10-12T13:05:00Z"), "2026-10-12 15:05"); // CEST
  assert.equal(formatTime("2026-12-01T13:05:00Z"), "2026-12-01 14:05"); // CET
});

test("dirty deploys are flagged and pipes in notes cannot break the table", () => {
  const md = renderState([
    { at: "2026-10-01T08:00:00Z", env: "staging", component: "firebase", commit: "f".repeat(40), dirty: true, by: "Mike", note: "a | b" },
  ]);
  assert.match(md, /⚠️ dirty/);
  assert.match(md, /a \\\| b/);
});

test("backslashes in notes are escaped before pipes", () => {
  const md = renderState([
    { at: "2026-10-01T08:00:00Z", env: "staging", component: "firebase", commit: "f".repeat(40), by: "Mike", note: "C:\\path\\| x" },
  ]);
  assert.ok(md.includes("C:\\\\path\\\\\\| x"), md);
});

test("an overridden preflight is flagged with its reasons", () => {
  const md = renderState([
    { at: "2026-10-01T08:00:00Z", env: "staging", component: "firebase", commit: "f".repeat(40), by: "Mike", offMain: ["machine-auth: on branch feat/x, not main"] },
  ]);
  assert.match(md, /⚠️ off main/);
  assert.match(md, /off main: machine-auth: on branch feat\/x, not main/);
});

test("drift lines render only when facts are known", () => {
  assert.doesNotMatch(renderState(entries), /## Drift/);
  const md = renderState(entries, { mainAheadOfProd: 7, stagingAheadOfProd: 3 });
  assert.match(md, /Staging is \*\*3\*\* commit/);
  assert.match(md, /`main` is \*\*7\*\* commit/);
});
