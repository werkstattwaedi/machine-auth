// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Detect drift between the committed `firestore/firestore.indexes.json` and the
 * composite indexes actually deployed to a Firestore project.
 *
 * Why this exists: the Firestore emulator does NOT enforce composite indexes,
 * so a query needing an index that was hand-created in the console (but never
 * committed) passes every local/CI test and only fails in prod with
 * FAILED_PRECONDITION. Worse, a repo-driven `firebase deploy --only firestore`
 * makes the project match the repo file — silently DELETING any deployed index
 * that isn't committed. This script surfaces both directions:
 *   - in the project but NOT in the repo  → would be DELETED on next deploy
 *   - in the repo but NOT in the project  → not yet created (deploy pending)
 *
 * Usage:
 *   npx tsx scripts/check-index-drift.ts [--project <id>]   (default: oww-maco)
 *
 * Exit codes: 0 = in sync · 1 = drift found · 2 = tool/exec error.
 *
 * Requires firebase CLI auth for the project. The only command run is the
 * read-only `firebase firestore:indexes`. To make this an always-on CI gate,
 * give CI a read-only service account (Cloud Datastore Viewer) and run this
 * against staging — see docs/disaster-recovery.md / deployment-checklist.md.
 *
 * Scope: compares composite `indexes` only. `fieldOverrides` (single-field /
 * TTL / collection-group overrides) are not diffed here.
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEXES_FILE = join(REPO_ROOT, "firestore", "firestore.indexes.json");

interface IndexField {
  fieldPath: string;
  order?: string;
  arrayConfig?: string;
}
interface CompositeIndex {
  collectionGroup: string;
  queryScope?: string;
  fields?: IndexField[];
}

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const project = argValue("--project", "oww-maco");

/** Canonical key for a composite index, order-sensitive on fields. */
function indexKey(idx: CompositeIndex): string {
  // Deployed indexes carry a trailing `__name__` field that the repo file
  // omits by convention — strip it so the two representations compare equal.
  const fields = (idx.fields ?? [])
    .filter((f) => f.fieldPath !== "__name__")
    .map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig ?? "?"}`)
    .join(",");
  return `${idx.collectionGroup}[${idx.queryScope ?? "COLLECTION"}] ${fields}`;
}

function loadRepoIndexes(): CompositeIndex[] {
  const doc = JSON.parse(readFileSync(INDEXES_FILE, "utf-8"));
  return (doc.indexes ?? []) as CompositeIndex[];
}

function loadDeployedIndexes(): CompositeIndex[] {
  let raw: string;
  try {
    raw = execFileSync(
      "firebase",
      ["firestore:indexes", "--project", project],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] },
    );
  } catch (e) {
    console.error(
      `\n✖ Failed to read deployed indexes for '${project}'.\n` +
        `  Ensure the firebase CLI is authenticated for this project.\n`,
    );
    process.exit(2);
  }
  const doc = JSON.parse(raw);
  return (doc.indexes ?? []) as CompositeIndex[];
}

function main(): void {
  const repo = new Map(loadRepoIndexes().map((i) => [indexKey(i), i]));
  const prod = new Map(loadDeployedIndexes().map((i) => [indexKey(i), i]));

  const inProdNotRepo = [...prod.keys()].filter((k) => !repo.has(k));
  const inRepoNotProd = [...repo.keys()].filter((k) => !prod.has(k));

  console.log(
    `Firestore composite indexes — project '${project}': ` +
      `${prod.size} deployed, ${repo.size} in repo.\n`,
  );

  if (inProdNotRepo.length === 0 && inRepoNotProd.length === 0) {
    console.log("✓ In sync — no drift.");
    process.exit(0);
  }

  if (inProdNotRepo.length > 0) {
    console.log(
      "⚠ Deployed but NOT in repo (a `firebase deploy --only firestore` " +
        "would DELETE these):",
    );
    inProdNotRepo.forEach((k) => console.log(`   - ${k}`));
    console.log("");
  }
  if (inRepoNotProd.length > 0) {
    console.log(
      "ℹ In repo but NOT yet deployed — expected between committing an index " +
        "and deploying it (run `firebase deploy --only firestore:indexes`):",
    );
    inRepoNotProd.forEach((k) => console.log(`   + ${k}`));
    console.log("");
  }

  // Only the dangerous direction fails the check: an index live in the project
  // but absent from the repo would be silently DELETED by the next deploy.
  // "In repo, not yet deployed" is the normal commit→deploy gap and must not
  // red a gate. A genuinely missing index (needed by a query, in neither) is
  // not detectable by a diff — that needs the real-Firestore integration path.
  if (inProdNotRepo.length > 0) {
    console.log("✖ Drift: uncommitted deployed indexes. Fix the repo file.");
    process.exit(1);
  }
  console.log("✓ No dangerous drift (deployed set ⊆ repo set).");
  process.exit(0);
}

main();
