// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Deterministic half of the deploy-step check (ADR-0049): every PR says
// which deploy steps it adds — or that it needs none — in a `Deploy:` line,
// and the step files it names are exactly the ones it adds, with a header
// the deploy script can read. Only additions matter: a step runs when its
// file is added (deploy-steps.ts), so a PR that edits or deletes one names
// nothing. Whether `none` is honest — and whether the checklist got its
// fresh-install half — is the reviewer's job (the code-reviewer agent
// asks); this only keeps the line present and consistent, so it can be a
// required check — the same split as the `Spec:` line
// (scripts/check-spec-line.ts).
//
// CLI (CI): PR_BODY, PR_AUTHOR and PR_FILES (one JSON object per line,
// {"path", "status"} as the GitHub pulls/files API reports them) in the
// env, run from the repo root with plain `node` (type stripping, no deps).

import { existsSync, readFileSync } from "node:fs";

import { isStepFile, parseStepHeader, STEPS_DIR } from "./deploy/deploy-steps.ts";

export type DeployLine =
  | { kind: "none"; reason: string }
  | { kind: "steps"; files: string[] };

export interface PrFile {
  path: string;
  /** As the GitHub API reports it: added, modified, removed, renamed, copied, changed. */
  status: string;
}

// A renamed or copied file is new at its path: the deploy script sees an
// addition (git diff --no-renames) and will run it.
const ADDED = new Set(["added", "renamed", "copied"]);

// PRs that carry no deploy step by construction.
const EXEMPT_AUTHORS = new Set(["dependabot[bot]", "app/dependabot"]);

// HTML comments are the template's hints and fenced code blocks quote
// examples; neither is part of the description.
function stripQuoted(body: string): string {
  let text = body.replace(/```[\s\S]*?```/g, "");
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
  }
  return text;
}

export function parseDeployLine(body: string): DeployLine | string {
  const lines = stripQuoted(body)
    .split(/\r?\n/)
    .filter((l) => /^\s*deploy:/i.test(l));
  if (lines.length === 0) {
    return `PR description has no \`Deploy:\` line (see ${STEPS_DIR}/README.md)`;
  }
  if (lines.length > 1) return "PR description has more than one `Deploy:` line";

  // The line is prose to its author: a sentence-ending period is fine.
  const value = lines[0]
    .replace(/^\s*deploy:\s*/i, "")
    .replace(/\s*\.\s*$/, "")
    .trim();
  if (/^<[^>]*>$/.test(value)) {
    return `\`Deploy: ${value}\` is the template's placeholder — say \`none — <why>\` or name the step file`;
  }
  const none = /^none\s*[—–-]+\s*(\S.*)$/i.exec(value);
  if (none) {
    const reason = none[1].trim();
    if (/<[^>]*>/.test(reason)) {
      return `\`Deploy: none\` reason \`${reason}\` is the template's placeholder — say why nothing has to be run around the deploy`;
    }
    return { kind: "none", reason };
  }
  if (/^none\b/i.test(value)) {
    return "`Deploy: none` needs a reason: `Deploy: none — <why nothing has to be run around the deploy>`";
  }

  const files: string[] = [];
  for (const part of value.split(",").map((p) => p.trim().replace(/^`|`$/g, ""))) {
    // The full path, or just the file name.
    const path = part.includes("/") ? part : `${STEPS_DIR}/${part}`;
    if (!isStepFile(path)) {
      return `cannot read \`${part}\` — expected \`none — <reason>\` or \`${STEPS_DIR}/<YYYY-MM-DD-slug>.md\``;
    }
    files.push(path);
  }
  return { kind: "steps", files };
}

export function checkPr(input: {
  body: string;
  author: string;
  files: PrFile[];
  /** The file's content at the PR head, undefined when it does not exist there. */
  read: (path: string) => string | undefined;
}): string[] {
  if (EXEMPT_AUTHORS.has(input.author)) return [];

  const line = parseDeployLine(input.body);
  if (typeof line === "string") return [line];

  const steps = input.files.filter((f) => isStepFile(f.path));
  const added = steps.filter((f) => ADDED.has(f.status)).map((f) => f.path);
  const errors: string[] = [];

  if (line.kind === "none") {
    for (const f of added) {
      errors.push(`${f} is added in this PR but the description says \`Deploy: none\` — name it`);
    }
    return errors;
  }

  const named = new Set(line.files);
  for (const f of added) {
    if (!named.has(f)) errors.push(`${f} is added in this PR but not named in the \`Deploy:\` line`);
  }
  for (const f of line.files) {
    const status = steps.find((s) => s.path === f)?.status;
    if (status === undefined) {
      errors.push(`${f} is named in the \`Deploy:\` line but not part of this PR`);
      continue;
    }
    if (!ADDED.has(status)) {
      errors.push(
        status === "removed"
          ? `${f} is deleted in this PR — a deleted step names nothing`
          : `${f} is edited in this PR, not added — a step runs only when its file is added; to run it again, add a new file`,
      );
      continue;
    }
    const text = input.read(f);
    if (text === undefined) {
      errors.push(`${f} is named in the \`Deploy:\` line but does not exist in this PR`);
      continue;
    }
    try {
      parseStepHeader(text, f);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return errors;
}

/** One JSON object per line, as `gh api … --paginate --jq '.[] | {…}'` prints them. */
export function parsePrFiles(ndjson: string): PrFile[] {
  return ndjson
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const o = JSON.parse(l) as Partial<PrFile>;
      if (typeof o.path !== "string" || typeof o.status !== "string") {
        throw new Error(`PR_FILES line is not {path, status}: ${l}`);
      }
      return { path: o.path, status: o.status };
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = checkPr({
    body: process.env.PR_BODY ?? "",
    author: process.env.PR_AUTHOR ?? "",
    files: parsePrFiles(process.env.PR_FILES ?? ""),
    read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  });
  for (const e of errors) console.error(`::error::${e}`);
  if (errors.length === 0) console.log("Deploy line ok");
  process.exit(errors.length === 0 ? 0 : 1);
}
