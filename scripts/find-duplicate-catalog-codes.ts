#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot audit: report catalog entries that share a `code` value.
 *
 * Background: issue #213 enforces `code` uniqueness in the new
 * `upsertCatalogItem` callable (the only catalog write path going
 * forward — direct client writes are denied by rules). Pre-existing
 * duplicates can stay readable but will block edits, so this script
 * surfaces them so an admin can disambiguate before they're touched.
 *
 * Idempotent — read-only.
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/find-duplicate-catalog-codes.ts
 *
 *   # Production
 *   FIREBASE_PROJECT_ID=oww-maco GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/find-duplicate-catalog-codes.ts --prod
 */

import { config as loadEnv } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PROD_MODE = argv.includes("--prod");
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

async function main() {
  const admin = await import("firebase-admin");

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID not set");
  }

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const targetingProd = !emulatorHost;
  if (PROD_MODE && !targetingProd) {
    throw new Error("--prod set but FIRESTORE_EMULATOR_HOST is also set");
  }
  if (!PROD_MODE && targetingProd) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST not set — refusing to run against production without --prod"
    );
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const snap = await db.collection("catalog").get();
  const byCode = new Map<string, Array<{ id: string; name: string }>>();
  for (const doc of snap.docs) {
    const code = (doc.get("code") as string | undefined) ?? "";
    const name = (doc.get("name") as string | undefined) ?? "";
    const entry = byCode.get(code) ?? [];
    entry.push({ id: doc.id, name });
    byCode.set(code, entry);
  }

  const dupes = [...byCode.entries()].filter(([, v]) => v.length > 1);
  if (dupes.length === 0) {
    console.log(
      `OK — ${snap.size} catalog entries scanned, no duplicate codes.`
    );
    return;
  }

  console.log(
    `Found ${dupes.length} duplicate code(s) across ${snap.size} entries:`
  );
  for (const [code, entries] of dupes) {
    console.log(`  code="${code}":`);
    for (const e of entries) {
      console.log(`    - ${e.id}: ${e.name}`);
    }
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
