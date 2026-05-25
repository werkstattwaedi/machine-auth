#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot migration (issue #323): set `autoRenew = true` on every
 * membership doc that doesn't have the field yet.
 *
 * Background: the renewal-invoicer cron only auto-issues renewals for
 * memberships with `autoRenew == true`. New memberships get the field
 * from the activation path, but pre-existing docs predate it. The cron's
 * query (`validUntil` slice) plus the in-code `autoRenew !== false` guard
 * already treats absent as "renew", so this backfill is belt-and-braces:
 * it materializes the field so admin views and the schema stay honest.
 *
 * Idempotent — re-runs find no docs missing the field and exit cleanly.
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/backfill-membership-autorenew.ts
 *
 *   # Production (requires --prod plus credentials)
 *   FIREBASE_PROJECT_ID=oww-maco GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/backfill-membership-autorenew.ts --prod
 *
 *   # Dry-run (count affected docs without writing)
 *   FIREBASE_PROJECT_ID=oww-maco GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/backfill-membership-autorenew.ts --prod --dry-run
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

  console.log("Scanning memberships for a missing autoRenew field...");
  const snap = await db.collection("memberships").get();

  const missing = snap.docs.filter((d) => d.get("autoRenew") === undefined);

  if (missing.length === 0) {
    console.log(
      `Scanned ${snap.size} membership(s); all already have autoRenew. Nothing to do.`
    );
    return;
  }

  console.log(
    `Scanned ${snap.size} membership(s); ${missing.length} missing autoRenew.`
  );
  for (const doc of missing) {
    console.log(`  - ${doc.id} (status=${doc.get("status")})`);
  }

  if (DRY_RUN) {
    console.log("Dry-run: no writes performed.");
    return;
  }

  const CHUNK = 400;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of missing.slice(i, i + CHUNK)) {
      batch.update(doc.ref, { autoRenew: true });
    }
    await batch.commit();
  }

  console.log(`Backfilled autoRenew=true on ${missing.length} membership(s).`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
