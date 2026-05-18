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

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  COGNITOFORMS_CATALOG_IDS,
  MEMBERSHIP_CATALOG_ID,
} from "./seed-data/catalog-ids";

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
  // family-membership demo: Mike's partner + child (no email for the kid)
  userPartner: "00user0partner000005",
  userKid:     "00user0kid0000000006",

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

  // catalog doc IDs that production code references via pinned constants
  // live in scripts/seed-data/catalog-ids.ts (MEMBERSHIP_CATALOG_ID,
  // COGNITOFORMS_CATALOG_IDS). The remaining catalog entries are loaded
  // from scripts/seed-data/catalog/*.json at seed time; machine refs
  // resolve their template via the code → docId map built in seed().

  // memberships
  membershipSimon: "00membership0simon01",
  membershipMike:  "00membership0mike002",
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
    roles: ["admin"],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    billingAddress: null,
  });
  await db.collection("users").doc(ID.userMike).set({
    created: Timestamp.now(),
    firstName: "Mike",
    lastName: "Schneider",
    email: "mike@werkstattwaedi.ch",
    permissions: [
      db.doc(`permission/${ID.permLaser}`),
      db.doc(`permission/${ID.perm3dprint}`),
      db.doc(`permission/${ID.permHolz}`),
    ],
    roles: ["admin"],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    billingAddress: null,
  });
  await db.collection("users").doc(ID.userMarco).set({
    created: Timestamp.now(),
    firstName: "Marco",
    lastName: "Menzi",
    email: "marco@werkstattwaedi.ch",
    permissions: [db.doc(`permission/${ID.permHolz}`)],
    roles: ["admin"],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    billingAddress: null,
  });
  await db.collection("users").doc(ID.userSimon).set({
    created: Timestamp.now(),
    firstName: "Simon",
    lastName: "Flepp",
    email: "simon@werkstattwaedi.ch",
    permissions: [db.doc(`permission/${ID.permLaser}`)],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    // Will be populated by seedMembership below.
    activeMembership: null,
    billingAddress: null,
  });
  await auth.setCustomUserClaims(ID.userAdmin, { admin: true });
  await auth.setCustomUserClaims(ID.userMike, { admin: true });
  await auth.setCustomUserClaims(ID.userMarco, { admin: true });
  console.log("  Created 4 users (3 admin + 1 regular)");

  // --- Family membership demo: Mike's partner (real account) + child (no email) ---
  await upsertAuthUser({
    uid: ID.userPartner,
    email: "partner@werkstattwaedi.ch",
    password: "partner1",
    displayName: "Anna Schneider",
  });
  await db.collection("users").doc(ID.userPartner).set({
    created: Timestamp.now(),
    firstName: "Anna",
    lastName: "Schneider",
    email: "partner@werkstattwaedi.ch",
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
    billingAddress: null,
  });
  // Child account: real Auth UID, no sign-in credentials. The Firebase
  // `createUser` call below intentionally omits `email` and `password`,
  // and disables sign-in. Promotion later = set an email + enable.
  try {
    await auth.createUser({
      uid: ID.userKid,
      displayName: "Lina Schneider",
      disabled: true,
    });
  } catch (e: any) {
    if (e?.errorInfo?.code === "auth/uid-already-exists") {
      await auth.updateUser(ID.userKid, {
        displayName: "Lina Schneider",
        disabled: true,
      });
    } else {
      throw e;
    }
  }
  await db.collection("users").doc(ID.userKid).set({
    created: Timestamp.now(),
    firstName: "Lina",
    lastName: "Schneider",
    email: null,
    permissions: [],
    roles: [],
    termsAcceptedAt: null,
    userType: "kind",
    activeMembership: null,
    billingAddress: null,
  });
  console.log("  Created 2 family-demo users (partner + kid)");

  // --- Memberships ---
  // Simon: single membership.
  await db.collection("memberships").doc(ID.membershipSimon).set({
    type: "single",
    status: "active",
    lastPaidAt: Timestamp.now(),
    validUntil: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ownerUserId: db.doc(`users/${ID.userSimon}`),
    members: [db.doc(`users/${ID.userSimon}`)],
    paymentCheckouts: [],
    notes: null,
    created: Timestamp.now(),
    createdBy: null,
    modifiedAt: Timestamp.now(),
    modifiedBy: null,
  });
  await db
    .collection("users")
    .doc(ID.userSimon)
    .update({
      activeMembership: db.doc(`memberships/${ID.membershipSimon}`),
    });

  // Mike: family membership (Mike + Anna + Lina).
  await db.collection("memberships").doc(ID.membershipMike).set({
    type: "family",
    status: "active",
    lastPaidAt: Timestamp.now(),
    validUntil: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ownerUserId: db.doc(`users/${ID.userMike}`),
    members: [
      db.doc(`users/${ID.userMike}`),
      db.doc(`users/${ID.userPartner}`),
      db.doc(`users/${ID.userKid}`),
    ],
    paymentCheckouts: [],
    notes: null,
    created: Timestamp.now(),
    createdBy: null,
    modifiedAt: Timestamp.now(),
    modifiedBy: null,
  });
  for (const uid of [ID.userMike, ID.userPartner, ID.userKid]) {
    await db
      .collection("users")
      .doc(uid)
      .update({
        activeMembership: db.doc(`memberships/${ID.membershipMike}`),
      });
  }
  console.log("  Created 2 memberships (1 single + 1 family)");

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

  // --- Catalog (loaded from scripts/seed-data/catalog/*.json) ---
  // Split per workshop so diffs stay reviewable. Order is unspecified;
  // each entry's `id` field is its committed doc ID. We also build a
  // `code → docId` lookup so the machine-template refs below can stay
  // decoupled from specific doc IDs.
  const catalogDir = join(dirname(fileURLToPath(import.meta.url)), "seed-data", "catalog");
  const catalogFiles = readdirSync(catalogDir).filter((f) => f.endsWith(".json")).sort();
  const codeToDocId = new Map<string, string>();
  let totalCatalog = 0;
  for (const file of catalogFiles) {
    const entries = JSON.parse(readFileSync(join(catalogDir, file), "utf-8")) as Array<{
      id: string;
      code?: string;
      [key: string]: unknown;
    }>;
    for (const item of entries) {
      const { id, ...data } = item;
      await db.collection("catalog").doc(id).set(data);
      if (typeof item.code === "string" && item.code.length > 0) {
        codeToDocId.set(item.code, id);
      }
    }
    totalCatalog += entries.length;
  }
  console.log(`  Created ${totalCatalog} catalog entries from ${catalogFiles.length} files`);

  function catalogRef(code: string) {
    const id = codeToDocId.get(code);
    if (!id) {
      throw new Error(
        `seed-emulator: catalog code "${code}" not found in any of scripts/seed-data/catalog/*.json`,
      );
    }
    return db.doc(`catalog/${id}`);
  }

  // Catalog-references config doc. Production code (membership purchase,
  // post-checkout trigger, web membership page) reads this to find
  // catalog items it depends on, instead of importing pinned IDs from
  // source. Lets ops rebind the membership ref without a code deploy.
  await db.doc("config/catalog-references").set({
    membership: db.doc(`catalog/${MEMBERSHIP_CATALOG_ID}`),
  });
  console.log("  Wrote config/catalog-references");

  // --- Machines (with checkoutTemplateId + workshop) ---
  // checkoutTemplateId refs resolve via the code → docId lookup so the
  // seed doesn't hardcode any catalog IDs. Codes are stable across the
  // committed seed JSON files.
  await db.collection("machine").doc(ID.machineLaserVirtual).set({
    name: "Laser Cutter (Virtual)",
    workshop: "makerspace",
    checkoutTemplateId: catalogRef("1012"), // Laser Cutter
    requiredPermission: [db.doc(`permission/${ID.permLaser}`)],
    maco: db.doc(`maco/${ID.macoDevterm}`),
    control: {},
  });
  await db.collection("machine").doc(ID.machineCnc).set({
    name: "CNC Fräse",
    workshop: "holz",
    checkoutTemplateId: catalogRef("1001"), // Stationäre Maschinen
    requiredPermission: [db.doc(`permission/${ID.permCnc}`)],
    maco: db.doc(`maco/${ID.macoDevterm}`),
    control: {},
  });
  await db.collection("machine").doc(ID.machineFraese).set({
    name: "Fräse",
    workshop: "holz",
    checkoutTemplateId: catalogRef("1001"), // Stationäre Maschinen
    requiredPermission: [db.doc(`permission/${ID.permHolz}`)],
    maco: db.doc(`maco/${ID.macoFraese}`),
    control: {},
  });
  await db.collection("machine").doc(ID.machineLasercutter).set({
    name: "Laser Cutter",
    workshop: "makerspace",
    checkoutTemplateId: catalogRef("1012"), // Laser Cutter
    requiredPermission: [db.doc(`permission/${ID.permLaser}`)],
    maco: db.doc(`maco/${ID.macoLasercutter}`),
    control: {},
  });
  console.log("  Created 4 machines");

  // --- Config: Pricing (simplified — no machine configs) ---
  await db.collection("config").doc("pricing").set({
    entryFees: {
      erwachsen: { regular: 5, ermaessigt: 2.5, materialbezug: 0, intern: 0, hangenmoos: 0 },
      kind: { regular: 2.5, ermaessigt: 1.25, materialbezug: 0, intern: 0, hangenmoos: 0 },
      firma: { regular: 5, ermaessigt: 2.5, materialbezug: 0, intern: 0, hangenmoos: 0 },
    },
    // SLA per-layer cost (hardware-wear-driven, constant across resin types).
    slaLayerPrice: { none: 0.00109, member: 0.00109 },
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
      discounts: { none: "Kein Rabatt", member: "Mitglied OWW" },
    },
  });
  console.log("  Created config/pricing");

  // --- Price Lists ---
  // Sample MDF price list pointing at the xlsx-driven Holz entries.
  // Item references resolve via codeToDocId so this doesn't hardcode any
  // doc IDs; Mike can regenerate from the admin price-list editor.
  const mdfCodes = ["3065", "3066", "3067", "3068", "3069", "3070", "3071", "3072", "3073"];
  const mdfItemIds = mdfCodes
    .map((code) => codeToDocId.get(code))
    .filter((id): id is string => id != null);
  if (mdfItemIds.length > 0) {
    await db.collection("price_lists").doc("00pricelist0holz0001").set({
      name: "Holzwerkstatt MDF Platten",
      items: mdfItemIds,
      footer: "Offene Werkstatt Wädenswil – Holzwerkstatt",
      active: true,
      modifiedBy: null,
      modifiedAt: Timestamp.now(),
    });
    console.log("  Created 1 price list");
  }

  // --- Sample open checkout with items for Mike ---
  // Picks any Sperrholz entry available in the new Holz catalog so the
  // sample remains valid across xlsx revisions.
  const sampleSperrholz =
    [...codeToDocId.entries()].find(([code]) => {
      const n = parseInt(code, 10);
      return n >= 3080 && n <= 3093; // Sperrholz-Platten block in holz.json
    })?.[1] ?? null;
  if (sampleSperrholz) {
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
    await checkoutRef.collection("items").add({
      workshop: "holz",
      description: "Sperrholz (Beispiel)",
      origin: "manual",
      catalogId: db.doc(`catalog/${sampleSperrholz}`),
      variantId: "default",
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
  }

  console.log("Done! Emulator seeded successfully.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
