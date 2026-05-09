#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot migration: flip checkouts with the legacy `usageType: "membership"`
 * to `usageType: "materialbezug"`.
 *
 * Background: `purchaseMembership` no longer creates checkouts with the
 * dedicated `"membership"` usageType — the membership-detection trigger
 * keys off the catalog `kind` discriminator, so a parallel usageType
 * column carried no behaviour and was easy to leave out of sync with the
 * `config/pricing.entryFees` map. Existing in-flight checkouts (e.g. the
 * stuck `4s2a03wy` session that prompted this migration) need to be
 * reconciled before the new code is deployed, since the narrowed
 * `UsageType` union no longer accepts `"membership"`.
 *
 * Idempotent — re-runs find no docs and exit cleanly. Safe to run multiple
 * times.
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/migrate-membership-checkouts.ts
 *
 *   # Production (requires --prod plus credentials)
 *   FIREBASE_PROJECT_ID=oww-maco GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/migrate-membership-checkouts.ts --prod
 *
 *   # Dry-run (count affected docs without writing)
 *   FIREBASE_PROJECT_ID=oww-maco GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/migrate-membership-checkouts.ts --prod --dry-run
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
      "Refusing to write to production without --prod flag. " +
        "Either set FIRESTORE_EMULATOR_HOST or pass --prod explicitly."
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

  const db = admin.firestore();

  console.log("Querying checkouts where usageType == 'membership'...");
  const snap = await db
    .collection("checkouts")
    .where("usageType", "==", "membership")
    .get();

  if (snap.empty) {
    console.log("No legacy membership checkouts found. Nothing to do.");
    return;
  }

  console.log(`Found ${snap.size} legacy membership checkout(s).`);
  for (const doc of snap.docs) {
    const status = doc.get("status");
    if (status !== "open") {
      // Closed/billed checkouts have already been processed by the bill
      // pipeline; rewriting their usageType is harmless (billing is
      // append-only and stamped on the bill, not recomputed from the
      // checkout) but it does silently edit historical data. Surface so
      // the operator can decide.
      console.warn(
        `  WARNING: ${doc.id} has status=${status} — migrating anyway`,
      );
    } else {
      console.log(`  - ${doc.id} (status=${status})`);
    }
  }

  if (DRY_RUN) {
    console.log("Dry-run: no writes performed.");
    return;
  }

  // Firestore batch limit is 500; 50 here is plenty for any realistic count
  // (the prod stuck-checkout count is in the single digits) and keeps the
  // script trivial — a single batched commit per chunk.
  const CHUNK = 50;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + CHUNK)) {
      batch.update(doc.ref, { usageType: "materialbezug" });
    }
    await batch.commit();
  }

  console.log(`Migrated ${snap.size} checkout(s) → usageType: "materialbezug".`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
