#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-off: re-emit `visit_items` rows so rows exported before `variant_id` /
 * `pricing_model` existed gain them (see `functions/src/stats/
 * reemit_visit_items.ts` for why this is not a watermark reset).
 *
 * Run `scripts/setup-bigquery.ts` first — the columns must exist. Safe to
 * re-run: the `visit_items_v` dedup view keeps the latest row per doc_id.
 * Never touches `export_state/*`.
 *
 * The live run fetches the per-project subject salt from Secret Manager
 * itself, byte-exact, so rows keep the daily export's subject_key (see
 * `stats-salt.ts`).
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/backfill-visit-item-variants.ts --prod --dry-run
 *   FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/backfill-visit-item-variants.ts --prod
 */

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { resolveStatsSalt } from "./stats-salt";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PROD_MODE = argv.includes("--prod");
const DRY_RUN = argv.includes("--dry-run");
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
  if (!emulatorHost && !PROD_MODE) {
    throw new Error(
      "Refusing to run against production without --prod flag. " +
        "Either set FIRESTORE_EMULATOR_HOST or pass --prod explicitly."
    );
  }

  const salt = resolveStatsSalt({
    projectId,
    emulator: !!emulatorHost,
    dryRun: DRY_RUN,
  });

  console.log(
    `Project: ${projectId}, Target: ${emulatorHost ?? "PRODUCTION"}, Dry-run: ${DRY_RUN}`
  );

  if (!admin.apps.length) {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!emulatorHost && serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      console.log(`Using service account: ${serviceAccountPath}`);
      admin.initializeApp({
        credential: admin.credential.cert(
          JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"))
        ),
        projectId,
      });
    } else {
      admin.initializeApp({ projectId });
    }
  }

  const { reemitVisitItems } = await import(
    "../functions/src/stats/reemit_visit_items"
  );
  const { CountingSink, makeBigQuerySink } = await import(
    "../functions/src/stats/sink"
  );

  const datasetId = process.env.STATS_DATASET ?? "stats";
  const sink = DRY_RUN
    ? new CountingSink()
    : await makeBigQuerySink(datasetId, projectId);

  const summary = await reemitVisitItems(new Date(), {
    db: admin.firestore(),
    sink,
    salt,
  });
  console.log(
    `${DRY_RUN ? "Would re-emit" : "Re-emitted"} ${summary.items} visit_items rows ` +
      `from ${summary.checkouts} checkouts; ` +
      `${summary.skippedUnexported} not yet exported (left to the daily export).`
  );
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
