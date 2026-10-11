#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot migration: rename the stored payment-method / payment-channel id
 * "twint" to "raisenow" (shared/src/payment-methods.ts).
 *
 * Method ids name the integration, not the payment brand — the Wallee
 * terminal accepts TWINT too, so "twint" stopped saying which path a
 * customer took. Rewrites:
 *   - checkouts.paymentMethod  "twint" → "raisenow"
 *   - bills.paidVia            "twint" → "raisenow"
 * and only reports bills with the retired paidVia "cash" (no current
 * equivalent; they keep their legacy label).
 *
 * Every reader normalizes the legacy id, so the order against the deploy
 * does not matter and the script is idempotent — a re-run finds nothing.
 * BigQuery is deliberately not touched: already-exported `stats` rows keep
 * paid_via "twint" (documented in functions/src/stats/schema.ts).
 * `modifiedAt` / `statsFlushedAt` stay untouched so this does not count as
 * a user edit nor re-queue a stats export.
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/migrate-payment-method-ids.ts
 *
 *   # Staging / production (dry-run first)
 *   FIREBASE_PROJECT_ID=oww-maco-staging GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/migrate-payment-method-ids.ts --prod --dry-run
 *   FIREBASE_PROJECT_ID=oww-maco-staging GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/migrate-payment-method-ids.ts --prod
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

const LEGACY_ID = "twint";
const CURRENT_ID = "raisenow";
const CHUNK = 400; // Firestore batch limit is 500

const RENAMES = [
  { collection: "checkouts", field: "paymentMethod" },
  { collection: "bills", field: "paidVia" },
] as const;

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
      "Refusing to write to production without --prod flag. " +
        "Either set FIRESTORE_EMULATOR_HOST or pass --prod explicitly.",
    );
  }

  console.log(
    `Project: ${projectId}, Target: ${emulatorHost ?? "PRODUCTION"}, Dry-run: ${DRY_RUN}`,
  );

  if (!admin.apps.length) {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (emulatorHost) {
      admin.initializeApp({ projectId });
    } else if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      console.log(`Using service account: ${serviceAccountPath}`);
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });
    } else {
      console.log("Using Application Default Credentials");
      admin.initializeApp({ projectId });
    }
  }

  const db = admin.firestore();

  const cashSnap = await db.collection("bills").where("paidVia", "==", "cash").get();
  console.log(
    `bills.paidVia == "cash": ${cashSnap.size} (report only — kept as legacy, no rewrite)`,
  );

  for (const { collection, field } of RENAMES) {
    const snap = await db.collection(collection).where(field, "==", LEGACY_ID).get();
    console.log(`${collection}.${field} == "${LEGACY_ID}": ${snap.size} to rename`);
    if (DRY_RUN || snap.empty) continue;

    for (let i = 0; i < snap.docs.length; i += CHUNK) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + CHUNK)) {
        batch.update(doc.ref, { [field]: CURRENT_ID });
      }
      await batch.commit();
      console.log(`  renamed ${Math.min(i + CHUNK, snap.size)} / ${snap.size}`);
    }
  }

  console.log(DRY_RUN ? "Dry-run: no writes performed." : "Done.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
