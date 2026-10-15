// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Locks the `Spec:` line contract (ADR-0047). The check is meant to become a
// required status, so a false failure blocks every PR and a false pass lets a
// rule change land without its spec edit — both directions are covered.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPr, indexSpec, parseSpecLine } from "./check-spec-line.ts";

const SPEC = indexSpec(
  new Map([
    [
      "docs/spec/membership.md",
      [
        "# Membership",
        "- **MEM-1** A rule. — #1",
        "- **MEM-2** Another rule. — #2",
        "  - not a definition: MEM-9 mentioned in a sub-bullet",
        "## Retired",
        "- MEM-3 — #700",
      ].join("\n"),
    ],
  ]),
);

function check(body: string, changedFiles = ["docs/spec/membership.md"]) {
  return checkPr({ body, author: "someone", changedFiles, spec: SPEC });
}

test("none with a reason passes without touching the spec", () => {
  assert.deepEqual(check("## Summary\n\nSpec: none — refactor only\n", []), []);
  assert.deepEqual(check("Spec: none - tooling", []), []);
});

test("none without a reason fails", () => {
  assert.equal(check("Spec: none", []).length, 1);
  assert.equal(check("Spec: none —", []).length, 1);
});

test("the template's placeholder reason fails", () => {
  assert.match(check("Spec: none — <why no rule in docs/spec/ is affected>", [])[0], /placeholder/);
});

test("missing or duplicate Spec line fails", () => {
  assert.match(check("## Summary\nno line here")[0], /no `Spec:` line/);
  assert.match(check("Spec: none — a\nSpec: none — b")[0], /more than one/);
});

test("the unedited PR template fails; its comment hints don't count", () => {
  const template = "Spec: <fill in>\n<!-- One of:\n  Spec: none — x\n  Spec: MEM-1 (added) -->";
  assert.match(check(template)[0], /cannot parse `<fill in>`/);
  assert.match(check("<!-- Spec: none — hidden -->")[0], /no `Spec:` line/);
});

test("fenced code blocks quoting an example line don't count", () => {
  assert.deepEqual(check("Spec: none — tooling\n\n```\nSpec: MEM-1 (added)\n```\n", []), []);
});

test("a sentence-ending period and a lowercase prefix are tolerated", () => {
  assert.deepEqual(check("Spec: MEM-1 (changed)."), []);
  assert.deepEqual(check("spec: none — refactor.", []), []);
});

test("a named rule's own spec file must change — not just any", () => {
  assert.deepEqual(check("Spec: MEM-1 (changed), MEM-2 (added)"), []);
  assert.match(check("Spec: MEM-1 (changed)", ["web/x.tsx"])[0], /membership\.md is not changed/);
  assert.match(check("Spec: MEM-1 (changed)", ["docs/spec/billing.md"])[0], /membership\.md is not changed/);
  assert.match(check("Spec: MEM-1 (changed)", ["docs/spec/README.md"])[0], /membership\.md is not changed/);
});

test("added or changed rules must exist", () => {
  assert.match(check("Spec: MEM-9 (added)")[0], /MEM-9 \(added\) is not a rule/);
});

test("retired rules must be gone and listed under Retired, in a changed file", () => {
  assert.deepEqual(check("Spec: MEM-3 (retired)"), []);
  assert.match(check("Spec: MEM-1 (retired)").join(), /still defined/);
  assert.match(check("Spec: MEM-8 (retired)").join(), /listed under Retired/);
  assert.match(check("Spec: MEM-3 (retired)", ["docs/spec/billing.md"])[0], /membership\.md is not changed/);
});

test("a rule written down and then changed in the same PR is listed under both", () => {
  // The spec-first flow (docs/spec/README.md "How a change flows"): the
  // as-is commit adds the area's rules, a later commit changes one of them.
  assert.deepEqual(check("Spec: MEM-1..2 (added), MEM-2 (changed)"), []);
});

test("a range names every rule in it", () => {
  assert.deepEqual(check("Spec: MEM-1..2 (added)"), []);
  assert.deepEqual(check("Spec: MEM-1..MEM-2 (changed)"), []);
  assert.match(check("Spec: MEM-1..4 (added)").join(), /MEM-4 \(added\) is not a rule/);
  assert.match(check("Spec: MEM-2..1 (added)")[0], /cannot parse/);
});

test("malformed entries fail with the offending part", () => {
  assert.match(check("Spec: MEM-1 added")[0], /cannot parse `MEM-1 added`/);
  assert.match(check("Spec: MEM-01 (added)")[0], /cannot parse/);
  assert.equal(typeof parseSpecLine("Spec: mem-1 (added)"), "string");
});

test("duplicate rule ids fail every PR, exempt authors included", () => {
  const spec = indexSpec(
    new Map([
      ["docs/spec/a.md", "- **BIL-1** One.\n"],
      ["docs/spec/b.md", "- **BIL-1** Two.\n"],
    ]),
  );
  const errors = checkPr({ body: "", author: "dependabot[bot]", changedFiles: [], spec });
  assert.deepEqual(errors, ["BIL-1 is defined more than once in docs/spec/"]);
});

test("dependabot needs no Spec line", () => {
  assert.deepEqual(
    checkPr({ body: "Bumps x", author: "dependabot[bot]", changedFiles: [], spec: SPEC }),
    [],
  );
});
