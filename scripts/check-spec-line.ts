// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Deterministic half of the product-spec check (ADR-0047): every PR names
// the spec rules it adds, changes or retires — or says why none — in a
// `Spec:` line, and the rules it names must match docs/spec/. Whether the
// line is *honest* is the agent's job (.claude/spec-check.md); this only
// keeps it present and consistent, so it can be a required check.
//
// CLI (CI): PR_BODY, PR_AUTHOR and CHANGED_FILES (newline-separated) in the
// env, run from the repo root with plain `node` (type stripping, no deps).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Change = "added" | "changed" | "retired";

export interface SpecRef {
  id: string;
  change: Change;
}

export type SpecLine =
  | { kind: "none"; reason: string }
  | { kind: "refs"; refs: SpecRef[] };

const RULE_ID = /^[A-Z]{3}-[1-9]\d*$/;
// A rule definition: a list item starting with the bold id.
const RULE_DEF = /^\s*-\s+\*\*([A-Z]{3}-[1-9]\d*)\*\*/;
// PRs that carry no product change by construction.
const EXEMPT_AUTHORS = new Set(["dependabot[bot]", "app/dependabot"]);

export function parseSpecLine(body: string): SpecLine | string {
  // HTML comments are template hints, not part of the description.
  const lines = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .filter((l) => /^\s*Spec:/.test(l));
  if (lines.length === 0) {
    return "PR description has no `Spec:` line (see docs/spec/README.md)";
  }
  if (lines.length > 1) return "PR description has more than one `Spec:` line";

  const value = lines[0].replace(/^\s*Spec:\s*/, "").trim();
  const none = /^none\s*[—–-]+\s*(\S.*)$/i.exec(value);
  if (none) return { kind: "none", reason: none[1].trim() };
  if (/^none\b/i.test(value)) {
    return "`Spec: none` needs a reason: `Spec: none — <why no rule is affected>`";
  }

  const refs: SpecRef[] = [];
  for (const part of value.split(",").map((p) => p.trim())) {
    // `MEM-3 (added)`, or a range `MEM-1..34 (added)` for a new domain file.
    const m = /^([A-Z]{3})-(\d+)(?:\s*\.\.\s*(?:\1-)?(\d+))?\s*\((added|changed|retired)\)$/.exec(part);
    const from = m ? Number(m[2]) : 0;
    const to = m?.[3] ? Number(m[3]) : from;
    if (!m || !RULE_ID.test(`${m[1]}-${m[2]}`) || to < from) {
      return `cannot parse \`${part}\` — expected \`MEM-3 (added|changed|retired)\` or \`MEM-1..34 (added)\``;
    }
    for (let n = from; n <= to; n++) {
      refs.push({ id: `${m[1]}-${n}`, change: m[4] as Change });
    }
  }
  return { kind: "refs", refs };
}

export interface SpecIndex {
  /** Active rule ids → file. */
  rules: Map<string, string>;
  /** Ids listed under a file's `## Retired` heading. */
  retired: Set<string>;
  duplicates: string[];
}

export function indexSpec(files: Map<string, string>): SpecIndex {
  const rules = new Map<string, string>();
  const retired = new Set<string>();
  const duplicates: string[] = [];
  for (const [file, text] of files) {
    let inRetired = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^#{1,6}\s/.test(line)) inRetired = /^#{1,6}\s+Retired\b/i.test(line);
      if (inRetired) {
        for (const m of line.matchAll(/\b[A-Z]{3}-[1-9]\d*\b/g)) retired.add(m[0]);
        continue;
      }
      const def = RULE_DEF.exec(line);
      if (def) {
        if (rules.has(def[1])) duplicates.push(def[1]);
        rules.set(def[1], file);
      }
    }
  }
  return { rules, retired, duplicates };
}

export function checkPr(input: {
  body: string;
  author: string;
  changedFiles: string[];
  spec: SpecIndex;
}): string[] {
  const errors = input.spec.duplicates.map(
    (id) => `${id} is defined more than once in docs/spec/`,
  );
  if (EXEMPT_AUTHORS.has(input.author)) return errors;

  const line = parseSpecLine(input.body);
  if (typeof line === "string") return [...errors, line];
  if (line.kind === "none") return errors;

  if (!input.changedFiles.some((f) => /^docs\/spec\/.+\.md$/.test(f))) {
    errors.push("the `Spec:` line names rules but the PR changes nothing under docs/spec/");
  }
  for (const { id, change } of line.refs) {
    const active = input.spec.rules.has(id);
    if (change !== "retired" && !active) {
      errors.push(`${id} (${change}) is not a rule in docs/spec/`);
    }
    if (change === "retired" && active) {
      errors.push(`${id} (retired) is still defined as a rule — delete it and list it under Retired`);
    }
    if (change === "retired" && !input.spec.retired.has(id)) {
      errors.push(`${id} (retired) must be listed under Retired in its spec file`);
    }
  }
  return errors;
}

function readSpec(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".md") && name !== "README.md") {
      files.set(join(dir, name), readFileSync(join(dir, name), "utf8"));
    }
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = checkPr({
    body: process.env.PR_BODY ?? "",
    author: process.env.PR_AUTHOR ?? "",
    changedFiles: (process.env.CHANGED_FILES ?? "").split("\n").filter(Boolean),
    spec: indexSpec(readSpec("docs/spec")),
  });
  for (const e of errors) console.error(`::error::${e}`);
  if (errors.length === 0) console.log("Spec line ok");
  process.exit(errors.length === 0 ? 0 : 1);
}
