#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot migration (ADR-0042): shift every stored `bills.referenceNumber`
 * to the `base × 10 + revisionDigit` layout and stamp
 * `config/billing.referenceNumberFormat = "shifted-v1"`.
 *
 * After this, `RE-4200001` is stored as 42000010 and its first corrected
 * re-issue as 42000011. Existing PDFs keep their printed number and their
 * legacy QR payload (4200001) — the bank-import decoder tries the ×10
 * reading as a fallback. `config/billing.nextBillNumber` is NOT touched:
 * `allocateBill` multiplies at mint time.
 *
 * Crash safety — every run is idempotent per document:
 *   1. A fresh run asserts `max < min × 10` (legacy payloads can never
 *      collide with migrated numbers) and records the pre-migration
 *      minimum as `config/billing.migrationOriginalMin` BEFORE shifting.
 *   2. Because of that assertion, a value `>= originalMin × 10` can only be
 *      an already-shifted one, so an interrupted run resumes by skipping
 *      those and shifting the rest exactly once. Legacy numbers that
 *      happen to be multiples of 10 (4200010 …) are handled correctly —
 *      a `% 10` test would not be.
 *   3. The bills are written first, the marker last; the new
 *      `allocateBill` refuses to mint until the marker exists, and this
 *      script refuses to run once it does.
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/migrate-bill-numbers.ts
 *
 *   # Staging / production (dry-run first)
 *   FIREBASE_PROJECT_ID=oww-maco-staging GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/migrate-bill-numbers.ts --prod --dry-run
 *   FIREBASE_PROJECT_ID=oww-maco-staging GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/migrate-bill-numbers.ts --prod
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

const RADIX = 10;
const FORMAT_MARKER = "shifted-v1";
const CHUNK = 400; // Firestore batch limit is 500

async function main() {
  const admin = await import("firebase-admin");
  const { FieldValue } = await import("firebase-admin/firestore");

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
  const configRef = db.doc("config/billing");
  const configSnap = await configRef.get();
  const config = configSnap.data() ?? {};
  if (config.referenceNumberFormat === FORMAT_MARKER) {
    console.log(`config/billing.referenceNumberFormat is already "${FORMAT_MARKER}". Nothing to do.`);
    return;
  }
  if (config.referenceNumberFormat !== undefined) {
    throw new Error(
      `Unexpected config/billing.referenceNumberFormat ${JSON.stringify(config.referenceNumberFormat)} — inspect by hand.`,
    );
  }

  const snap = await db.collection("bills").get();
  const values = snap.docs.map((d) => d.get("referenceNumber") as unknown);
  const bad = snap.docs.filter((d, i) => !Number.isInteger(values[i]) || (values[i] as number) < 0);
  if (bad.length > 0) {
    throw new Error(
      `${bad.length} bill(s) without a non-negative integer referenceNumber: ${bad.map((d) => d.id).join(", ")}`,
    );
  }
  const ints = values as number[];
  console.log(`Found ${snap.size} bill(s); counter nextBillNumber=${config.nextBillNumber ?? "(unset)"}.`);

  if (snap.size === 0) {
    if (!DRY_RUN) {
      await configRef.set({ referenceNumberFormat: FORMAT_MARKER }, { merge: true });
    }
    console.log(`No bills to shift; ${DRY_RUN ? "would write" : "wrote"} marker "${FORMAT_MARKER}".`);
    return;
  }

  // Resume point: an interrupted run already recorded the original minimum.
  let originalMin = config.migrationOriginalMin as number | undefined;
  if (originalMin === undefined) {
    const min = Math.min(...ints);
    const max = Math.max(...ints);
    console.log(`referenceNumber range: ${min} … ${max}`);
    if (!(max < min * RADIX)) {
      throw new Error(
        `Range check failed: max ${max} >= min ${min} × ${RADIX}. Legacy payloads could collide with ` +
          "migrated numbers — inspect by hand.",
      );
    }
    originalMin = min;
    if (!DRY_RUN) {
      await configRef.set({ migrationOriginalMin: originalMin }, { merge: true });
    }
  } else {
    console.log(`Resuming an interrupted run (original minimum ${originalMin}).`);
  }
  const threshold = originalMin * RADIX;
  const pending = snap.docs.filter((d) => (d.get("referenceNumber") as number) < threshold);
  const alreadyShifted = snap.docs.filter((d) => (d.get("referenceNumber") as number) >= threshold);
  const suspicious = alreadyShifted.filter((d) => (d.get("referenceNumber") as number) % RADIX !== 0);
  if (suspicious.length > 0) {
    throw new Error(
      `${suspicious.length} bill(s) at or above ${threshold} are not multiples of ${RADIX} — not a resumable ` +
        `state: ${suspicious.map((d) => d.id).join(", ")}`,
    );
  }
  console.log(`${pending.length} to shift, ${alreadyShifted.length} already shifted.`);
  for (const doc of pending.slice(0, 5)) {
    const n = doc.get("referenceNumber") as number;
    console.log(`  ${doc.id}: ${n} → ${n * RADIX}`);
  }
  if (pending.length > 5) console.log(`  … ${pending.length - 5} more`);

  if (DRY_RUN) {
    console.log("Dry-run: no writes performed.");
    return;
  }

  for (let i = 0; i < pending.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of pending.slice(i, i + CHUNK)) {
      const n = doc.get("referenceNumber") as number;
      batch.update(doc.ref, { referenceNumber: n * RADIX });
    }
    await batch.commit();
    console.log(`Shifted ${Math.min(i + CHUNK, pending.length)} / ${pending.length}`);
  }

  await configRef.set(
    { referenceNumberFormat: FORMAT_MARKER, migrationOriginalMin: FieldValue.delete() },
    { merge: true },
  );
  console.log(`Done. ${pending.length} bill(s) shifted ×${RADIX}; marker "${FORMAT_MARKER}" written.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
