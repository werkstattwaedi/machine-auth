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

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// Connect to emulator
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

initializeApp({ projectId: "oww-maco" });
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
  tokenMike2:   "042d1f322b1690",
  tokenSimon:   "049a3aaa1e1890",
  tokenSimon2:  "044a1f322b1690",
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

  // catalog
  catStationaer:   "00catalog0station001",
  catDrechselbank: "00catalog0drechs002",
  catSchweissen:   "00catalog0schweis03",
  catPlasma:       "00catalog0plasma004",
  catSandblastK:   "00catalog0sandblk05",
  catSandblastG:   "00catalog0sandblg06",
  cat3dPLA:        "00catalog03dpla0007",
  cat3dPETG:       "00catalog03dpetg008",
  catSperrholz:    "00catalog0sperrh009",
  catKantholz:     "00catalog0kanth0010",
  catLaser:        "00catalog0laser0012",
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
  // Uses upsert pattern so seed can be re-run on existing emulator data.
  async function upsertAuthUser(props: { uid: string; email: string; password: string; displayName: string }) {
    try {
      await auth.createUser(props);
    } catch (e: any) {
      if (e?.errorInfo?.code === "auth/uid-already-exists") {
        await auth.updateUser(props.uid, { email: props.email, displayName: props.displayName });
      } else {
        throw e;
      }
    }
  }
  await upsertAuthUser({ uid: ID.userAdmin, email: "admin@example.com", password: "admin123", displayName: "Test Admin" });
  await upsertAuthUser({ uid: ID.userMike, email: "mike@werkstattwaedi.ch", password: "mike1234", displayName: "Mike Schneider" });
  await upsertAuthUser({ uid: ID.userMarco, email: "marco@werkstattwaedi.ch", password: "marco1234", displayName: "Marco" });
  await upsertAuthUser({ uid: ID.userSimon, email: "simon@werkstattwaedi.ch", password: "simon1234", displayName: "Simon" });
  console.log("  Created/updated 4 Auth users");

  // --- Users ---
  await db.collection("users").doc(ID.userAdmin).set({
    created: Timestamp.now(),
    displayName: "Admin",
    firstName: "Test",
    lastName: "Admin",
    email: "admin@example.com",
    permissions: [
      db.doc(`permission/${ID.permLaser}`),
      db.doc(`permission/${ID.permCnc}`),
      db.doc(`permission/${ID.permLathe}`),
      db.doc(`permission/${ID.perm3dprint}`),
      db.doc(`permission/${ID.permHolz}`),
    ],
    roles: ["admin", "vereinsmitglied"],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    billingAddress: null,
  });
  await db.collection("users").doc(ID.userMike).set({
    created: Timestamp.now(),
    displayName: "MikeS",
    firstName: "Mike",
    lastName: "Schneider",
    email: "mike@werkstattwaedi.ch",
    permissions: [
      db.doc(`permission/${ID.permLaser}`),
      db.doc(`permission/${ID.perm3dprint}`),
      db.doc(`permission/${ID.permHolz}`),
    ],
    roles: ["admin", "vereinsmitglied"],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    billingAddress: null,
  });
  await db.collection("users").doc(ID.userMarco).set({
    created: Timestamp.now(),
    displayName: null,
    firstName: "Marco",
    lastName: "Menzi",
    email: "marco@werkstattwaedi.ch",
    permissions: [db.doc(`permission/${ID.permHolz}`)],
    roles: ["admin", "vereinsmitglied"],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    billingAddress: null,
  });
  await db.collection("users").doc(ID.userSimon).set({
    created: Timestamp.now(),
    displayName: null,
    firstName: "Simon",
    lastName: "Flepp",
    email: "simon@werkstattwaedi.ch",
    permissions: [db.doc(`permission/${ID.permLaser}`)],
    roles: ["vereinsmitglied"],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    billingAddress: null,
  });
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
    [ID.tokenSimon2]: {
      userId: db.doc(`users/${ID.userSimon}`),
      registered: Timestamp.now(),
      label: "Simon Tag Plexi",
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
  await db.collection("maco").doc(ID.macoDevterm).set({ name: "Dev Terminal 01" });
  await db.collection("maco").doc(ID.macoFraese).set({ name: "Fräse Holzwerkstatt" });
  await db.collection("maco").doc(ID.macoLasercutter).set({ name: "Laser Cutter" });
  console.log("  Created 3 MaCo devices");

  // --- Catalog (loaded from JSON) ---
  const catalogJson = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "seed-data", "catalog.json"), "utf-8")
  ) as Array<{ id: string; [key: string]: any }>;

  for (const item of catalogJson) {
    const { id, ...data } = item;
    await db.collection("catalog").doc(id).set(data);
  }
  console.log(`  Created ${catalogJson.length} catalog entries`);

  // --- Machines (with checkoutTemplateId + workshop) ---
  await db.collection("machine").doc(ID.machineLaserVirtual).set({
    name: "Laser Cutter (Virtual)",
    workshop: "makerspace",
    checkoutTemplateId: db.doc(`catalog/${ID.catLaser}`),
    requiredPermission: [db.doc(`permission/${ID.permLaser}`)],
    maco: db.doc(`maco/${ID.macoDevterm}`),
    control: {},
  });
  await db.collection("machine").doc(ID.machineCnc).set({
    name: "CNC Fräse",
    workshop: "holz",
    checkoutTemplateId: db.doc(`catalog/${ID.catStationaer}`),
    requiredPermission: [db.doc(`permission/${ID.permCnc}`)],
    maco: db.doc(`maco/${ID.macoDevterm}`),
    control: {},
  });
  await db.collection("machine").doc(ID.machineFraese).set({
    name: "Fräse",
    workshop: "holz",
    checkoutTemplateId: db.doc(`catalog/${ID.catStationaer}`),
    requiredPermission: [db.doc(`permission/${ID.permHolz}`)],
    maco: db.doc(`maco/${ID.macoFraese}`),
    control: {},
  });
  await db.collection("machine").doc(ID.machineLasercutter).set({
    name: "Laser Cutter",
    workshop: "makerspace",
    checkoutTemplateId: db.doc(`catalog/${ID.catLaser}`),
    requiredPermission: [db.doc(`permission/${ID.permLaser}`)],
    maco: db.doc(`maco/${ID.macoLasercutter}`),
    control: {},
  });
  console.log("  Created 4 machines");

  // --- Config: Pricing (simplified — no machine configs) ---
  await db.collection("config").doc("pricing").set({
    entryFees: {
      erwachsen: { regular: 5, materialbezug: 0, intern: 0, hangenmoos: 0 },
      kind: { regular: 2.5, materialbezug: 0, intern: 0, hangenmoos: 0 },
      firma: { regular: 5, materialbezug: 0, intern: 0, hangenmoos: 0 },
    },
    // SLA per-layer cost (hardware-wear-driven, constant across resin types).
    slaLayerPrice: { none: 0.01, member: 0.008, intern: 0.006 },
    workshops: {
      holz:      { label: "Holzwerkstatt",     order: 1 },
      metall:    { label: "Metallwerkstatt",    order: 2 },
      textil:    { label: "Textil Atelier",     order: 3 },
      keramik:   { label: "Keramik Atelier",    order: 4 },
      schmuck:   { label: "Schmuck Atelier",    order: 5 },
      glas:      { label: "Glas Atelier",       order: 6 },
      stein:     { label: "Stein Atelier",      order: 7 },
      malen:     { label: "Malen und Basteln",  order: 8 },
      makerspace:{ label: "Maker Space",        order: 9 },
      diverses:  { label: "Diverses",           order: 10 },
    },
    labels: {
      units: { m2: "m²", m: "m", stk: "Stk.", chf: "CHF", h: "Std.", kg: "kg", g: "g", l: "l" },
      discounts: { none: "Kein Rabatt", member: "Mitglied OWW", intern: "Intern" },
    },
  });
  console.log("  Created config/pricing");

  // --- Price Lists ---
  await db.collection("price_lists").doc("00pricelist0holz0001").set({
    name: "Holzwerkstatt MDF Platten",
    items: [
      "00catmat000000003110", // MDF 3mm
      "00catmat000000003111", // MDF 4mm
      "00catmat000000003112", // MDF 6mm
      "00catmat000000003113", // MDF 8mm
      "00catmat000000003114", // MDF 10mm
      "00catmat000000003115", // MDF 12mm
      "00catmat000000003116", // MDF 16mm
      "00catmat000000003117", // MDF 19mm
      "00catmat000000003118", // MDF 22mm
    ],
    footer: "Offene Werkstatt Wädenswil – Holzwerkstatt",
    active: true,
    modifiedBy: null,
    modifiedAt: Timestamp.now(),
  });
  console.log("  Created 1 price list");

  // --- Sample open checkout with items for Mike ---
  const mikeRef = db.doc(`users/${ID.userMike}`);
  const checkoutRef = db.collection("checkouts").doc("00checkout0mike00001");
  await checkoutRef.set({
    userId: mikeRef,
    status: "open",
    usageType: "regular",
    created: Timestamp.now(),
    workshopsVisited: ["holz"],
    persons: [],
    modifiedBy: null,
    modifiedAt: Timestamp.now(),
  });

  // Add a material item to the checkout
  await checkoutRef.collection("items").add({
    workshop: "holz",
    description: "Sperrholz Birke 4mm",
    origin: "manual",
    catalogId: db.doc(`catalog/${ID.catSperrholz}`),
    created: Timestamp.now(),
    quantity: 0.24,
    unitPrice: 45,
    totalPrice: 10.8,
    formInputs: [
      { quantity: 60, unit: "cm" },
      { quantity: 40, unit: "cm" },
    ],
  });
  console.log("  Created open checkout with 1 item for Mike");

  console.log("Done! Emulator seeded successfully.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
