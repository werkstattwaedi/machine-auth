#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Historical stats backfill (ADR-0039, Phase 1).
 *
 * Loops the production `runStatsExport` core with its epoch-seeded
 * watermarks until every stream reports drained — the backfill exercises
 * the exact code path the daily job runs, just repeatedly. Re-runnable:
 * duplicates are absorbed by the `*_v` dedup views, and an interrupted
 * backfill resumes from the persisted watermarks.
 *
 * `--dry-run` counts would-be rows without touching BigQuery (still
 * advances the Firestore watermarks — reset `export_state/*` if you want a
 * dry-run followed by a real run to re-export; against prod prefer running
 * dry-run first on staging instead).
 *
 * The live run needs the per-project subject salt:
 *   STATS_SUBJECT_SALT="$(gcloud secrets versions access latest \
 *     --secret=STATS_SUBJECT_SALT --project=<project>)"
 *
 * Usage:
 *   # Emulator smoke run (counting sink)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/backfill-stats.ts --dry-run
 *
 *   # Production
 *   FIREBASE_PROJECT_ID=oww-maco STATS_SUBJECT_SALT=... \
 *     npx tsx scripts/backfill-stats.ts --prod
 */

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

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
  const targetingProd = !emulatorHost;

  if (targetingProd && !PROD_MODE) {
    throw new Error(
      "Refusing to run against production without --prod flag. " +
        "Either set FIRESTORE_EMULATOR_HOST or pass --prod explicitly."
    );
  }

  const salt = process.env.STATS_SUBJECT_SALT ?? (DRY_RUN ? "dry-run-salt" : "");
  if (!salt) {
    throw new Error(
      "STATS_SUBJECT_SALT not set (required for a live backfill; " +
        "fetch it via `gcloud secrets versions access`)."
    );
  }

  console.log(
    `Project: ${projectId}, Target: ${emulatorHost ?? "PRODUCTION"}, Dry-run: ${DRY_RUN}`
  );

  if (!admin.apps.length) {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (emulatorHost) {
      admin.initializeApp({ projectId });
    } else if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      console.log(`Using service account: ${serviceAccountPath}`);
      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });
    } else {
      console.log("Using Application Default Credentials");
      admin.initializeApp({ projectId });
    }
  }

  const { runStatsExport } = await import("../functions/src/stats/export_job");
  const { CountingSink, makeBigQuerySink } = await import(
    "../functions/src/stats/sink"
  );

  const datasetId = process.env.STATS_DATASET ?? "stats";
  const countingSink = DRY_RUN ? new CountingSink() : null;
  const sink = countingSink ?? (await makeBigQuerySink(datasetId, projectId));
  const db = admin.firestore();

  const totals: Record<string, number> = {};
  for (let round = 1; ; round++) {
    const summary = await runStatsExport(new Date(), { db, sink, salt });
    for (const [stream, res] of Object.entries(summary)) {
      totals[stream] = (totals[stream] ?? 0) + res.exported;
    }
    const drained = Object.values(summary).every((s) => s.drained);
    console.log(
      `Round ${round}: ` +
        Object.entries(summary)
          .map(([s, r]) => `${s}=${r.exported}`)
          .join(" ") +
        (drained ? " (drained)" : "")
    );
    if (drained) break;
  }

  console.log("\nBackfill complete. Docs exported per stream:");
  for (const [stream, count] of Object.entries(totals)) {
    console.log(`  ${stream}: ${count}`);
  }
  if (countingSink) {
    console.log("\nDry-run rows per table (nothing sent to BigQuery):");
    for (const [table, count] of Object.entries(countingSink.counts)) {
      console.log(`  ${table}: ${count}`);
    }
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
