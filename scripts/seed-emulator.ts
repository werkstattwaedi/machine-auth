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
  permHolz:    "00perm00holz00000005",

  // users (doc ID = Firebase Auth UID)
  userAdmin:   "00user00admin0000001",
  userMike:    "00user00mikes0000002",
  userMarco:   "00user0marco00000003",
  userSimon:   "00user0simon00000004",

  // tokens (NFC tag UIDs — 7-byte hex, not Firebase IDs)
  tokenAdmin:   "04c339aa1e1890",
  tokenMike:    "04d449bb2f2901",
  tokenMike1:   "04c439aa1e1890",
  tokenMike2:   "042d15322b1690",
  tokenSimon:   "049a3aaa1e1890",
  tokenMarco:   "04231f322b1690",

  // maco terminals
  macoDevterm:    "00maco00devterm00001",
  macoFraese:     "0a10aced202194944a042f04",
  macoLasercutter:"0a10aced202194944a042eb0",

  // machines
  machineLaserVirtual: "00machine0laser00001",
  machineCnc:          "00machine000cnc00002",
  machineFraese:       "00machine0fraese0003",
  machineLasercutter:  "00machine0laser00004",
} as const;

async function seed() {
  console.log("Seeding Firestore emulator...");

  // --- Permissions ---
  const permissions: Record<string, { name: string }> = {
    [ID.permLaser]:   { name: "Laserschneiden" },
    [ID.permCnc]:     { name: "CNC Fräsen" },
    [ID.permLathe]:   { name: "Drehbank" },
    [ID.perm3dprint]: { name: "3D Drucker" },
    [ID.permHolz]:    { name: "Holzwerkstatt" },
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
    email: "mike@werkstattwaedi.ch",
    password: "mike1234",
    displayName: "Mike Schneider",
  });
  await auth.createUser({
    uid: ID.userMarco,
    email: "marco@werkstattwaedi.ch",
    password: "marco1234",
    displayName: "Marco",
  });
  await auth.createUser({
    uid: ID.userSimon,
    email: "simon@werkstattwaedi.ch",
    password: "simon1234",
    displayName: "Simon",
  });
  console.log("  Created 4 Auth users");

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
      db.doc(`permission/${ID.permHolz}`),
    ],
    roles: ["admin", "vereinsmitglied"],
  };

  const mikeUser = {
    created: Timestamp.now(),
    displayName: "MikeS",
    name: "Mike Schneider",
    email: "mike@werkstattwaedi.ch",
    permissions: [
      db.doc(`permission/${ID.permLaser}`),
      db.doc(`permission/${ID.perm3dprint}`),
      db.doc(`permission/${ID.permHolz}`),
    ],
    roles: ["admin", "vereinsmitglied"],
  };

  const marcoUser = {
    created: Timestamp.now(),
    displayName: "Marco",
    name: "Marco",
    email: "marco@werkstattwaedi.ch",
    permissions: [
      db.doc(`permission/${ID.permHolz}`),
    ],
    roles: ["admin", "vereinsmitglied"],
  };

  const simonUser = {
    created: Timestamp.now(),
    displayName: "Simon",
    name: "Simon",
    email: "simon@werkstattwaedi.ch",
    permissions: [
      db.doc(`permission/${ID.permLaser}`),
    ],
    roles: ["vereinsmitglied"],
  };

  await db.collection("users").doc(ID.userAdmin).set(adminUser);
  await db.collection("users").doc(ID.userMike).set(mikeUser);
  await db.collection("users").doc(ID.userMarco).set(marcoUser);
  await db.collection("users").doc(ID.userSimon).set(simonUser);
  // Set custom claims directly (don't rely on trigger timing)
  await auth.setCustomUserClaims(ID.userAdmin, { admin: true });
  await auth.setCustomUserClaims(ID.userMike, { admin: true });
  await auth.setCustomUserClaims(ID.userMarco, { admin: true });
  console.log("  Created 4 users (3 admin + 1 regular)");

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
      label: "Mike Tag (old)",
    },
    [ID.tokenMike1]: {
      userId: db.doc(`users/${ID.userMike}`),
      registered: Timestamp.now(),
      label: "Mike Tag 1",
    },
    [ID.tokenMike2]: {
      userId: db.doc(`users/${ID.userMike}`),
      registered: Timestamp.now(),
      label: "Mike Tag 2",
    },
    [ID.tokenSimon]: {
      userId: db.doc(`users/${ID.userSimon}`),
      registered: Timestamp.now(),
      label: "Simon Tag",
    },
    [ID.tokenMarco]: {
      userId: db.doc(`users/${ID.userMarco}`),
      registered: Timestamp.now(),
      label: "Marco Tag",
    },
  };

  for (const [id, data] of Object.entries(tokens)) {
    await db.collection("tokens").doc(id).set(data);
  }
  console.log(`  Created ${Object.keys(tokens).length} tokens`);

  // --- MaCo (terminal devices) ---
  await db.collection("maco").doc(ID.macoDevterm).set({
    name: "Dev Terminal 01",
  });
  await db.collection("maco").doc(ID.macoFraese).set({
    name: "Fräse Holzwerkstatt",
  });
  await db.collection("maco").doc(ID.macoLasercutter).set({
    name: "Laser Cutter",
  });
  console.log("  Created 3 MaCo devices");

  // --- Machines ---
  await db.collection("machine").doc(ID.machineLaserVirtual).set({
    name: "Laser Cutter (Virtual)",
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
  await db.collection("machine").doc(ID.machineFraese).set({
    name: "Fräse",
    requiredPermission: [db.doc(`permission/${ID.permHolz}`)],
    maco: db.doc(`maco/${ID.macoFraese}`),
    control: {},
  });
  await db.collection("machine").doc(ID.machineLasercutter).set({
    name: "Laser Cutter",
    requiredPermission: [db.doc(`permission/${ID.permLaser}`)],
    maco: db.doc(`maco/${ID.macoLasercutter}`),
    control: {},
  });
  console.log("  Created 4 machines");

  // --- Config: Pricing ---
  await db.collection("config").doc("pricing").set({
    entryFees: {
      erwachsen: { regular: 15, ermaessigt: 7.5, materialbezug: 0, intern: 0, hangenmoos: 15 },
      kind: { regular: 7.5, ermaessigt: 3.75, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
      firma: { regular: 30, ermaessigt: 15, materialbezug: 0, intern: 0, hangenmoos: 30 },
    },
    workshops: {
      holz: {
        label: "Holzwerkstatt", order: 1,
        machines: [
          { id: "holz_stationaer", label: "Stationäre Maschinen", unit: "h",
            prices: { none: 10, member: 5, intern: 0 } },
          { id: "holz_drechselbank", label: "Drechselbank", unit: "h",
            prices: { none: 10, member: 5, intern: 0 } },
        ],
        materialCategories: ["m2", "m", "stk", "chf"],
      },
      metall: {
        label: "Metallwerkstatt", order: 2,
        machines: [
          { id: "metall_schweissen", label: "Maschinen / Schweissanlage", unit: "h",
            prices: { none: 15, member: 7, intern: 0 } },
          { id: "metall_plasma", label: "Plasmaschneider / Brenner", unit: "h",
            prices: { none: 20, member: 10, intern: 0 } },
          { id: "metall_sandstrahlen", label: "Sandstrahlen Metall", unit: "obj",
            pricingType: "objectSize",
            objectSizePrices: { klein: 5, mittel: 10, gross: 20 } },
        ],
        materialCategories: ["m2", "m", "stk", "chf"],
      },
      textil: {
        label: "Textil Atelier", order: 3,
        machines: [],
        materialCategories: ["m", "kg", "stk"],
      },
      keramik: {
        label: "Keramik Atelier", order: 4,
        machines: [],
        materialCategories: ["kg", "stk"],
      },
      schmuck: {
        label: "Schmuck Atelier", order: 5,
        machines: [
          { id: "schmuck_loeten", label: "Lötstation", unit: "h",
            prices: { none: 10, member: 5, intern: 0 } },
        ],
        materialCategories: ["g", "stk"],
      },
      glas: {
        label: "Glas Atelier", order: 6,
        machines: [
          { id: "glas_perlen", label: "Glasperlenstation", unit: "h",
            prices: { none: 10, member: 5, intern: 0 } },
          { id: "glas_sandstrahlen", label: "Sandstrahlen", unit: "obj",
            pricingType: "objectSize",
            objectSizePrices: { klein: 5, mittel: 10, gross: 20 } },
        ],
        materialCategories: ["m2", "stk"],
      },
      stein: {
        label: "Stein Atelier", order: 7,
        machines: [
          { id: "stein_schleifen", label: "Schleifmaschinen", unit: "h",
            prices: { none: 10, member: 5, intern: 0 } },
        ],
        materialCategories: ["stk"],
      },
      malen: {
        label: "Malen und Basteln", order: 8,
        machines: [],
        materialCategories: ["m2", "m", "kg", "l"],
      },
      makerspace: {
        label: "Maker Space", order: 9,
        machines: [
          { id: "makerspace_fdm", label: "FDM 3D-Drucker", unit: "g",
            pricingType: "3dprint",
            materialPrices: { PLA: 0.05, PETG: 0.07, ABS: 0.06 } },
        ],
        materialCategories: [],
        hasServiceItems: true,
      },
      diverses: {
        label: "Diverses", order: 10,
        machines: [],
        materialCategories: [],
        hasServiceItems: true,
      },
    },
    unitLabels: { m2: "m²", m: "m", stk: "Stk.", chf: "CHF", h: "Std.", kg: "kg", g: "g", l: "l", obj: "Objekt" },
    discountLabels: { none: "Kein Rabatt", member: "Mitglied OWW", intern: "Intern" },
    objectSizeLabels: { klein: "Klein", mittel: "Mittel", gross: "Gross" },
  });
  console.log("  Created config/pricing");

  // --- Sample usage_material items for Mike ---
  const mikeRef = db.doc(`users/${ID.userMike}`);
  await db.collection("usage_material").add({
    userId: mikeRef,
    workshop: "holz",
    description: "Stationäre Maschinen",
    type: "machine_hours",
    details: {
      category: "h",
      quantity: 2,
      unitPrice: 5,
      totalPrice: 10,
      discountLevel: "member",
    },
    created: Timestamp.now(),
    checkout: null,
    modifiedBy: ID.userMike,
    modifiedAt: Timestamp.now(),
  });
  await db.collection("usage_material").add({
    userId: mikeRef,
    workshop: "holz",
    description: "Sperrholz Birke",
    type: "material",
    details: {
      category: "m2",
      quantity: 0.24,
      lengthCm: 60,
      widthCm: 40,
      unitPrice: 45,
      totalPrice: 10.8,
    },
    created: Timestamp.now(),
    checkout: null,
    modifiedBy: ID.userMike,
    modifiedAt: Timestamp.now(),
  });
  console.log("  Created 2 sample usage_material items for Mike");

  console.log("Done! Emulator seeded successfully.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
