// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Seed Firebase emulator with test data.
 *
 * Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/seed-emulator.ts
 *    or: npm run seed  (from root, emulators must be running)
 */

import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  FieldValue,
} from "firebase-admin/firestore";

// Connect to emulator
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

initializeApp({ projectId: "oww-maschinenfreigabe" });
const db = getFirestore();

async function seed() {
  console.log("Seeding Firestore emulator...");

  // --- Permissions ---
  const permissions: Record<string, { name: string }> = {
    laser: { name: "Laserschneiden" },
    cnc: { name: "CNC Fräsen" },
    lathe: { name: "Drehbank" },
    "3dprint": { name: "3D Drucker" },
  };

  for (const [id, data] of Object.entries(permissions)) {
    await db.collection("permission").doc(id).set(data);
  }
  console.log(`  Created ${Object.keys(permissions).length} permissions`);

  // --- Users ---
  const adminUser = {
    created: Timestamp.now(),
    firebaseUid: "admin-uid-001",
    displayName: "Admin",
    name: "Test Admin",
    email: "admin@example.com",
    permissions: [
      db.doc("permission/laser"),
      db.doc("permission/cnc"),
      db.doc("permission/lathe"),
      db.doc("permission/3dprint"),
    ],
    roles: ["admin", "vereinsmitglied"],
  };

  const regularUser = {
    created: Timestamp.now(),
    firebaseUid: "user-uid-002",
    displayName: "MikeS",
    name: "Mike Schneider",
    email: "mike@example.com",
    permissions: [db.doc("permission/laser"), db.doc("permission/3dprint")],
    roles: ["vereinsmitglied"],
  };

  await db.collection("users").doc("test-admin").set(adminUser);
  await db.collection("users").doc("test-user").set(regularUser);
  console.log("  Created 2 users (admin + regular)");

  // --- Tokens ---
  const tokens: Record<string, any> = {
    "04c339aa1e1890": {
      userId: db.doc("users/test-admin"),
      registered: Timestamp.now(),
      label: "Admin Schlüssel",
    },
    "04d449bb2f2901": {
      userId: db.doc("users/test-user"),
      registered: Timestamp.now(),
      label: "Mike Tag",
    },
  };

  for (const [id, data] of Object.entries(tokens)) {
    await db.collection("tokens").doc(id).set(data);
  }
  console.log(`  Created ${Object.keys(tokens).length} tokens`);

  // --- MaCo (terminal device) ---
  await db.collection("maco").doc("test-device-001").set({
    name: "Dev Terminal 01",
  });
  console.log("  Created 1 MaCo device");

  // --- Machine ---
  await db.collection("machine").doc("laser-01").set({
    name: "Laser Cutter",
    requiredPermission: [db.doc("permission/laser")],
    maco: db.doc("maco/test-device-001"),
    control: {},
  });
  await db.collection("machine").doc("cnc-01").set({
    name: "CNC Fräse",
    requiredPermission: [db.doc("permission/cnc")],
    maco: db.doc("maco/test-device-001"),
    control: {},
  });
  console.log("  Created 2 machines");

  console.log("Done! Emulator seeded successfully.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
