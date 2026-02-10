// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Seed Firebase emulator with test data.
 *
 * Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/seed-emulator.ts
 *    or: npm run seed  (from root, emulators must be running)
 *
 * Document IDs are hardcoded 20-char Firebase-style IDs for reproducibility.
 */

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// Connect to emulator
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

initializeApp({ projectId: "oww-maschinenfreigabe" });
const db = getFirestore();
const auth = getAuth();

// -- Hardcoded 20-char document IDs (readable but Firebase-shaped) ----------

const ID = {
  // permissions
  permLaser:   "00perm0laser00000001",
  permCnc:     "00perm000cnc00000002",
  permLathe:   "00perm0lathe00000003",
  perm3dprint: "00perm3dprint0000004",

  // users (doc ID = Firebase Auth UID)
  userAdmin:   "00user00admin0000001",
  userMike:    "00user00mikes0000002",

  // tokens (NFC tag UIDs — 7-byte hex, not Firebase IDs)
  tokenAdmin:  "04c339aa1e1890",
  tokenMike:   "04d449bb2f2901",

  // maco terminals
  macoDevterm: "00maco00devterm00001",

  // machines
  machineLaser: "00machine0laser00001",
  machineCnc:   "00machine000cnc00002",
} as const;

async function seed() {
  console.log("Seeding Firestore emulator...");

  // --- Permissions ---
  const permissions: Record<string, { name: string }> = {
    [ID.permLaser]:   { name: "Laserschneiden" },
    [ID.permCnc]:     { name: "CNC Fräsen" },
    [ID.permLathe]:   { name: "Drehbank" },
    [ID.perm3dprint]: { name: "3D Drucker" },
  };

  for (const [id, data] of Object.entries(permissions)) {
    await db.collection("permission").doc(id).set(data);
  }
  console.log(`  Created ${Object.keys(permissions).length} permissions`);

  // --- Auth users (UID = Firestore doc ID) ---
  await auth.createUser({
    uid: ID.userAdmin,
    email: "admin@example.com",
    password: "admin123",
    displayName: "Test Admin",
  });
  await auth.createUser({
    uid: ID.userMike,
    email: "mike@example.com",
    password: "mike1234",
    displayName: "Mike Schneider",
  });
  console.log("  Created 2 Auth users (admin@example.com / admin123, mike@example.com / mike1234)");

  // --- Users ---
  const adminUser = {
    created: Timestamp.now(),
    displayName: "Admin",
    name: "Test Admin",
    email: "admin@example.com",
    permissions: [
      db.doc(`permission/${ID.permLaser}`),
      db.doc(`permission/${ID.permCnc}`),
      db.doc(`permission/${ID.permLathe}`),
      db.doc(`permission/${ID.perm3dprint}`),
    ],
    roles: ["admin", "vereinsmitglied"],
  };

  const regularUser = {
    created: Timestamp.now(),
    displayName: "MikeS",
    name: "Mike Schneider",
    email: "mike@example.com",
    permissions: [
      db.doc(`permission/${ID.permLaser}`),
      db.doc(`permission/${ID.perm3dprint}`),
    ],
    roles: ["vereinsmitglied"],
  };

  await db.collection("users").doc(ID.userAdmin).set(adminUser);
  await db.collection("users").doc(ID.userMike).set(regularUser);
  console.log("  Created 2 users (admin + regular)");

  // --- Tokens (NFC tag UIDs as doc IDs) ---
  const tokens: Record<string, any> = {
    [ID.tokenAdmin]: {
      userId: db.doc(`users/${ID.userAdmin}`),
      registered: Timestamp.now(),
      label: "Admin Schlüssel",
    },
    [ID.tokenMike]: {
      userId: db.doc(`users/${ID.userMike}`),
      registered: Timestamp.now(),
      label: "Mike Tag",
    },
  };

  for (const [id, data] of Object.entries(tokens)) {
    await db.collection("tokens").doc(id).set(data);
  }
  console.log(`  Created ${Object.keys(tokens).length} tokens`);

  // --- MaCo (terminal device) ---
  await db.collection("maco").doc(ID.macoDevterm).set({
    name: "Dev Terminal 01",
  });
  console.log("  Created 1 MaCo device");

  // --- Machines ---
  await db.collection("machine").doc(ID.machineLaser).set({
    name: "Laser Cutter",
    requiredPermission: [db.doc(`permission/${ID.permLaser}`)],
    maco: db.doc(`maco/${ID.macoDevterm}`),
    control: {},
  });
  await db.collection("machine").doc(ID.machineCnc).set({
    name: "CNC Fräse",
    requiredPermission: [db.doc(`permission/${ID.permCnc}`)],
    maco: db.doc(`maco/${ID.macoDevterm}`),
    control: {},
  });
  console.log("  Created 2 machines");

  console.log("Done! Emulator seeded successfully.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
