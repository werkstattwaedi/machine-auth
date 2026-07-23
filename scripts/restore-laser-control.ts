// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Restore the gateway_sensing `control` block on the Laser Cutter machine doc.
// A prod reseed (.set() overwrite) wiped it to {}, which made the cloud bill
// wall-clock instead of activeSeconds. Values recovered from the device's live
// Particle ledger via scripts/read-device-ledger.ts.
//
// Uses .update({control}) — merge-safe, touches only the control field.
//
//   FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/restore-laser-control.ts
//
// Add --commit to actually write; without it, dry-run (prints intended change).

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const LASER_MACHINE_ID = "ZWVLzWQi40rRvM30MGnb";
const COMMIT = process.argv.includes("--commit");

// Recovered from the Particle ledger (read-device-ledger.ts). port and
// pollIntervalSec were unset on the working device, so we omit them here.
const CONTROL = {
  type: "gateway_sensing",
  kind: "xtool_laser",
  host: "laser.internal",
  idleTimeoutSec: 900,
  idleWarningSec: 120,
};

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "oww-maco";
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const ref = db.collection("machine").doc(LASER_MACHINE_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`machine/${LASER_MACHINE_ID} not found`);

  const before = (snap.data() as any).control ?? {};
  console.log(`machine/${LASER_MACHINE_ID} (${(snap.data() as any).name})`);
  console.log(`  control BEFORE = ${JSON.stringify(before)}`);
  console.log(`  control AFTER  = ${JSON.stringify(CONTROL)}`);

  if (!COMMIT) {
    console.log("\nDRY RUN — re-run with --commit to write.");
    return;
  }

  await ref.update({ control: CONTROL });
  console.log("\nWritten. Cloud now bills activeSeconds for this machine.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
