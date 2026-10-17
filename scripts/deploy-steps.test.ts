// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Locks the deploy-step contract (ADR-0049): the header parser that both the
// deploy script and the PR check rely on, and the pending-step selection
// that decides where a deploy stops. A false "nothing pending" lets a
// migration be forgotten; a false "pending" only costs a question. The git
// side (added since the tag) is exercised by hand — see the PR.

import { test } from "node:test";
import assert from "node:assert/strict";

import { agentPrompt, isStepFile, parseStepHeader, stepsOf } from "./deploy-steps.ts";

const FILE = "docs/deploy/2026-10-20-migrate-x.md";

function step(phase: string, extra = ""): string {
  return `---\nphase: ${phase}\n${extra}---\n\n# Migrate x\n\n**What:** run it.\n`;
}

test("a step file is a Markdown file directly in docs/deploy, not the README", () => {
  assert.equal(isStepFile(FILE), true);
  assert.equal(isStepFile("docs/deploy/README.md"), false);
  assert.equal(isStepFile("docs/deploy/readme.md"), false);
  assert.equal(isStepFile("docs/deploy/sub/2026-10-20-x.md"), false);
  assert.equal(isStepFile("docs/deploy/notes.txt"), false);
  assert.equal(isStepFile("docs/deployment-checklist.md"), false);
});

test("the header yields the phase", () => {
  assert.equal(parseStepHeader(step("before-functions"), FILE), "before-functions");
  assert.equal(parseStepHeader(step("after-functions"), FILE), "after-functions");
  assert.equal(parseStepHeader(step("after-deploy"), FILE), "after-deploy");
  // Windows line endings and surrounding spaces are tolerated.
  assert.equal(parseStepHeader("---\r\nphase:   after-deploy  \r\n---\r\nbody", FILE), "after-deploy");
});

test("a missing, empty, misspelt or extra header fails loudly", () => {
  assert.throws(() => parseStepHeader("# No header\n", FILE), /missing header/);
  assert.throws(() => parseStepHeader("---\n---\nbody", FILE), /no phase/);
  assert.throws(() => parseStepHeader(step("pre-functions"), FILE), /unknown phase `pre-functions`/);
  assert.throws(() => parseStepHeader(step("after-deploy", "envs: prod\n"), FILE), /unknown header field `envs`/);
  assert.throws(() => parseStepHeader("---\nphase after-deploy\n---\n", FILE), /cannot read header line/);
  // The front matter must open the file.
  assert.throws(() => parseStepHeader("\n---\nphase: after-deploy\n---\n", FILE), /missing header/);
});

test("stepsOf keeps existing step files in name order with their phase", () => {
  const files = new Map([
    ["docs/deploy/2026-10-22-b.md", step("after-deploy")],
    ["docs/deploy/2026-10-20-a.md", step("before-functions")],
    ["docs/deploy/README.md", "# not a step"],
    ["docs/other.md", step("after-deploy")],
  ]);
  const read = (p: string) => files.get(p);
  const changed = [
    "docs/deploy/2026-10-22-b.md",
    "docs/deploy/README.md",
    "docs/other.md",
    "docs/deploy/2026-10-20-a.md",
    "docs/deploy/2026-10-21-deleted.md", // deleted since the tag: not read, not a step
    "docs/deploy/2026-10-20-a.md", // listed twice (tracked + untracked union): once
  ];
  assert.deepEqual(stepsOf(changed, read), [
    { path: "docs/deploy/2026-10-20-a.md", phase: "before-functions" },
    { path: "docs/deploy/2026-10-22-b.md", phase: "after-deploy" },
  ]);
});

test("one bad header stops the whole selection", () => {
  const read = () => step("later");
  assert.throws(() => stepsOf([FILE], read), /unknown phase `later`/);
});

test("the prompt names the environment, project, release, phase and files", () => {
  const prompt = agentPrompt({
    env: "prod",
    phase: "after-functions",
    project: "oww-maco",
    version: "2026.10.4",
    steps: [
      { path: FILE, phase: "after-functions" },
      { path: "docs/deploy/2026-10-21-y.md", phase: "after-functions" },
    ],
  });
  for (const needle of [
    "prod deploy",
    "oww-maco",
    "2026.10.4",
    'phase "after-functions"',
    "before rules, indexes and hosting",
    `  - ${FILE}\n  - docs/deploy/2026-10-21-y.md`,
    "dry-run first",
    "stopped after it ran",
    "deploy-record.ts event --env prod",
    "do not run or edit scripts/deploy.sh",
  ]) {
    assert.ok(prompt.includes(needle), `prompt lacks: ${needle}`);
  }
});
