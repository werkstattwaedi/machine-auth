// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Locks the `Deploy:` line contract (ADR-0049). Meant to become a required
// status: a false failure blocks every PR, a false pass lets a step file
// land unnamed — or a `Deploy: none` hide one — so both directions are
// covered.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPr, parseDeployLine } from "./check-deploy-line.ts";

const STEP = "docs/deploy/2026-10-20-migrate-x.md";
const GOOD = "---\nphase: after-functions\n---\n\n# Migrate x\n";

function check(body: string, changedFiles: string[] = [], files: Record<string, string> = {}) {
  return checkPr({
    body,
    author: "someone",
    changedFiles,
    read: (p) => files[p],
  });
}

test("none with a reason passes when the PR touches no step file", () => {
  assert.deepEqual(check("## Summary\n\nDeploy: none — standard order\n"), []);
  assert.deepEqual(check("Deploy: none - tooling only."), []);
  assert.deepEqual(check("Deploy: none — docs only", ["docs/deploy/README.md"], { "docs/deploy/README.md": "x" }), []);
});

test("none without a reason, or with the template placeholder, fails", () => {
  assert.equal(check("Deploy: none").length, 1);
  assert.equal(check("Deploy: none —").length, 1);
  assert.match(check("Deploy: none — <why>")[0], /placeholder/);
  assert.match(check("Deploy: <fill in>")[0], /placeholder/);
});

test("a missing or doubled line fails", () => {
  assert.match(check("## Summary\n\nSpec: none — x\n")[0], /no `Deploy:` line/);
  assert.match(check("Deploy: none — a\nDeploy: none — b")[0], /more than one/);
});

test("lines inside comments and code fences do not count", () => {
  const body = [
    "Deploy: none — nothing to run",
    "<!-- Deploy: none — hint -->",
    "```",
    "Deploy: docs/deploy/2026-01-01-example.md",
    "```",
  ].join("\n");
  assert.deepEqual(check(body), []);
  // The template's commented-out hint alone is not a line.
  assert.match(check("<!-- Deploy: none — <why> -->")[0], /no `Deploy:` line/);
});

test("a named step file must be added or changed in the PR, with a good header", () => {
  const files = { [STEP]: GOOD };
  assert.deepEqual(check(`Deploy: ${STEP}`, [STEP, "functions/src/x.ts"], files), []);
  // File name only, and backticks, are fine.
  assert.deepEqual(check("Deploy: `2026-10-20-migrate-x.md`", [STEP], files), []);
  assert.match(check(`Deploy: ${STEP}`, [], files)[0], /not changed in this PR/);
  assert.match(check(`Deploy: ${STEP}`, [STEP], {})[0], /does not exist/);
  assert.match(
    check(`Deploy: ${STEP}`, [STEP], { [STEP]: "---\nphase: later\n---\n" })[0],
    /unknown phase `later`/,
  );
  assert.match(check(`Deploy: ${STEP}`, [STEP], { [STEP]: "# no header" })[0], /missing header/);
});

test("every step file the PR adds or changes must be named", () => {
  const other = "docs/deploy/2026-10-21-backfill-y.md";
  const files = { [STEP]: GOOD, [other]: GOOD };
  assert.match(check("Deploy: none — nothing", [STEP], files)[0], /says `Deploy: none` — name it/);
  const errors = check(`Deploy: ${STEP}`, [STEP, other], files);
  assert.equal(errors.length, 1);
  assert.match(errors[0], new RegExp(`${other} is added or changed .* not named`));
  assert.deepEqual(check(`Deploy: ${STEP}, ${other}`, [STEP, other], files), []);
});

test("a deleted step file needs no mention", () => {
  assert.deepEqual(check("Deploy: none — cleanup", [STEP], {}), []);
});

test("something that is neither none nor a step file cannot be parsed", () => {
  assert.match(check("Deploy: functions first, then hosting")[0], /cannot read/);
  assert.match(check("Deploy: docs/deploy/README.md")[0], /cannot read/);
  assert.match(check("Deploy: docs/deploy/sub/x.md")[0], /cannot read/);
});

test("dependabot is exempt", () => {
  assert.deepEqual(checkPr({ body: "", author: "dependabot[bot]", changedFiles: [], read: () => undefined }), []);
});

test("parseDeployLine returns the parsed line", () => {
  assert.deepEqual(parseDeployLine("Deploy: none — x"), { kind: "none", reason: "x" });
  assert.deepEqual(parseDeployLine(`Deploy: ${STEP}.`), { kind: "steps", files: [STEP] });
});
