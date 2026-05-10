#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Write the two membership-fee catalog SKUs (single + family).
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD_MODE = process.argv.slice(2).includes("--prod");
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

const ID_SINGLE = "00catalog0memb0sng01";
const ID_FAMILY = "00catalog0memb0fam02";

const singleSku = {
  code: "MEMBER-SINGLE",
  name: "Mitgliedschaft Einzel (Jahr)",
  workshops: ["diverses"],
  pricingModel: "direct",
  unitPrice: { none: 50, member: 50 },
  active: true,
  userCanAdd: false,
  description: "Jahres-Einzelmitgliedschaft Verein Offene Werkstatt Wädenswil.",
  kind: "membership-single",
};

const familySku = {
  code: "MEMBER-FAMILY",
  name: "Mitgliedschaft Familie (Jahr)",
  workshops: ["diverses"],
  pricingModel: "direct",
  unitPrice: { none: 70, member: 70 },
  active: true,
  userCanAdd: false,
  description:
    "Jahres-Familienmitgliedschaft. Inhaber:in plus weitere Familienmitglieder (inkl. Kindkonten).",
  kind: "membership-family",
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

  console.log(`Writing catalog/${ID_SINGLE} (Mitgliedschaft Einzel, CHF 50)...`);
  await db.collection("catalog").doc(ID_SINGLE).set(singleSku, { merge: true });

  console.log(`Writing catalog/${ID_FAMILY} (Mitgliedschaft Familie, CHF 70)...`);
  await db.collection("catalog").doc(ID_FAMILY).set(familySku, { merge: true });

  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
