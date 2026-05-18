#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Write the singleton Mitgliedschaft catalog SKU.
 *
 * The two membership types (single + family) live as variants on one
 * catalog doc at the pinned `MEMBERSHIP_CATALOG_ID` (see
 * `scripts/seed-data/catalog-ids.ts`). The post-checkout
 * `processMembershipPayment` trigger keys off the chosen
 * `CheckoutItem.variantId` (`"single"` or `"family"`) rather than a
 * catalog-level discriminator.
 *
 * Targets the project named by FIREBASE_PROJECT_ID. Honours
 * FIRESTORE_EMULATOR_HOST when set; otherwise uses
 * GOOGLE_APPLICATION_CREDENTIALS or ADC (same pattern as sync-device-config.ts).
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/seed-membership-skus.ts
 *
 *   # Production (requires --prod plus credentials)
 *   FIREBASE_PROJECT_ID=oww-maco GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/seed-membership-skus.ts --prod
 */

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { MEMBERSHIP_CATALOG_ID } from "./seed-data/catalog-ids";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD_MODE = process.argv.slice(2).includes("--prod");
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

const membershipSku = {
  code: "MEMBERSHIP",
  name: "Mitgliedschaft",
  workshops: ["diverses"],
  category: ["Mitgliedschaft"],
  active: true,
  userCanAdd: false,
  description: "Jahresmitgliedschaft Verein Offene Werkstatt Wädenswil.",
  variants: [
    {
      id: "single",
      label: "Einzel (Jahr)",
      pricingModel: "direct" as const,
      unitPrice: { default: 50 },
    },
    {
      id: "family",
      label: "Familie (Jahr)",
      pricingModel: "direct" as const,
      unitPrice: { default: 70 },
    },
  ],
};

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
    `Project: ${projectId}, Target: ${emulatorHost ?? "PRODUCTION"}`
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

  console.log(
    `Writing catalog/${MEMBERSHIP_CATALOG_ID} (Mitgliedschaft, ${membershipSku.variants.length} variants)...`
  );
  await db
    .collection("catalog")
    .doc(MEMBERSHIP_CATALOG_ID)
    .set(membershipSku, { merge: true });

  // Production code reads the membership ID via config/catalog-references
  // — no pinned-ID import in functions/web. Write that pointer too so a
  // fresh project bootstrap is self-contained.
  console.log("Writing config/catalog-references.membership ...");
  await db.doc("config/catalog-references").set(
    {
      membership: db.collection("catalog").doc(MEMBERSHIP_CATALOG_ID),
    },
    { merge: true },
  );

  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
