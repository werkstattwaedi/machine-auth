// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// READ-ONLY diagnostic for the "bereit time got billed" laser bug.
// Reads the live laser machine doc (control.type) and its most recent
// usage_machine records (activeSeconds vs wall-clock vs billableSeconds).
// Does NOT write anything.
//
// Run against prod:
//   FIREBASE_PROJECT_ID=oww-maco \
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   npx tsx scripts/diagnose-laser-billing.ts
//
// Optional: pass a machineId as argv[2] (defaults to the seeded Laser Cutter).

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const LASER_MACHINE_ID = process.argv[2] ?? "ZWVLzWQi40rRvM30MGnb";

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "oww-maco";
  // applicationDefault() resolves GOOGLE_APPLICATION_CREDENTIALS if set,
  // otherwise falls back to gcloud ADC (`gcloud auth application-default login`).
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const machineRef = db.collection("machine").doc(LASER_MACHINE_ID);
  const machineSnap = await machineRef.get();
  if (!machineSnap.exists) {
    console.log(`machine/${LASER_MACHINE_ID} does NOT exist. Check the id.`);
    return;
  }
  const machine = machineSnap.data() as Record<string, unknown>;
  const control = (machine.control ?? {}) as Record<string, unknown>;
  const controlType = control.type ?? "(unset)";
  const billsOnActiveTime = controlType === "gateway_sensing";

  console.log("=".repeat(70));
  console.log(`machine/${LASER_MACHINE_ID}  name=${JSON.stringify(machine.name)}`);
  console.log(`  control            = ${JSON.stringify(control)}`);
  console.log(`  control.type       = ${controlType}`);
  console.log(
    `  billing basis      = ${billsOnActiveTime ? "activeSeconds (correct)" : "WALL-CLOCK (bereit time IS billed)  <-- BUG"}`,
  );
  console.log("=".repeat(70));

  // No orderBy: avoids needing a (machine, endTime) composite index in prod.
  // Sort in memory instead.
  const usageSnap = await db
    .collection("usage_machine")
    .where("machine", "==", machineRef)
    .get();

  const docs = usageSnap.docs
    .sort((a, b) => {
      const ae = (a.data() as any).endTime?.toMillis?.() ?? 0;
      const be = (b.data() as any).endTime?.toMillis?.() ?? 0;
      return be - ae;
    })
    .slice(0, 10);

  console.log(`\nLast ${docs.length} of ${usageSnap.size} usage_machine records for this machine:\n`);
  for (const doc of docs) {
    const d = doc.data() as Record<string, any>;
    const start = d.startTime?.toDate?.();
    const end = d.endTime?.toDate?.();
    const wallSec =
      start && end ? Math.round((end.getTime() - start.getTime()) / 1000) : null;
    console.log(`  ${doc.id}`);
    console.log(`    start=${start?.toISOString?.() ?? "?"}  end=${end?.toISOString?.() ?? "?"}`);
    console.log(
      `    wallClockSec=${wallSec}  activeSeconds=${d.activeSeconds ?? "(missing)"}  billableSeconds=${d.billableSeconds ?? "(missing)"}`,
    );
    console.log(
      `    endReason=${d.endReason ?? "?"}  billedInto=${d.checkoutItemRef?.path ?? "(none)"}`,
    );
    console.log("");
  }

  if (!billsOnActiveTime) {
    console.log(
      "DIAGNOSIS: control.type is not 'gateway_sensing', so the cloud bills\n" +
        "wall-clock (checkOut - checkIn). A 'bereit'-only session with\n" +
        "activeSeconds=0 is billed for the full session length. This is the bug.",
    );
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
