// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Seed Firestore emulator with test data from JSON fixtures.
 *
 * Fixture resolution:
 *   - If OPERATIONS_CONFIG_DIR points at the machine-auth-operations
 *     repo, load from $OPERATIONS_CONFIG_DIR/scripts/seed-data/ — the
 *     real user/token/maco/machine values.
 *   - Otherwise, fall back to scripts/seed-data/seed-public/ —
 *     placeholder values safe to check into the public repo.
 *
 * Catalog (~150 items) always loads from scripts/seed-data/catalog/*.json
 * regardless of fixture set; the catalog is public-safe and shared
 * between both repos.
 *
 * Modes:
 *   --mode=full        (default) seeds everything including auth users.
 *   --mode=structural  skips auth users + users/tokens (matches what
 *                      the live `oww-maco` reseed writes).
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/seed-emulator.ts
 *   or: npm run seed   (emulators must be running)
 *
 * Refuses to run against production — that's `seed:prod` from the
 * machine-auth-operations repo.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const publicSeedDir = join(__dirname, "seed-data", "seed-public");
const catalogDir = join(__dirname, "seed-data", "catalog");

const opsDir =
  process.env.OPERATIONS_CONFIG_DIR ||
  resolve(projectRoot, "..", "machine-auth-operations");
const opsSeedDir = join(opsDir, "scripts", "seed-data");
const fixturesDir = existsSync(join(opsSeedDir, "permissions.json"))
  ? opsSeedDir
  : publicSeedDir;
const usingOpsFixtures = fixturesDir === opsSeedDir;

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

if (!process.env.FIRESTORE_EMULATOR_HOST.match(/^(127\.0\.0\.1|localhost):\d+$/)) {
  console.error(
    `Refusing to seed against non-emulator FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}.\n` +
      "For live reseed use the ops repo: cd ../machine-auth-operations && npm run seed:prod",
  );
  process.exit(1);
}

initializeApp({ projectId: "oww-maco" });
const db = getFirestore();
const auth = getAuth();

// ---------------------------------------------------------------------------
// JSON fixture resolution: "$ref:collection/docId" → DocumentReference,
//                         "$now"                  → Timestamp.now().
// ---------------------------------------------------------------------------

function resolveValue(value: unknown): unknown {
  if (value === "$now") return Timestamp.now();
  if (typeof value === "string" && value.startsWith("$ref:")) {
    return db.doc(value.slice(5));
  }
  if (Array.isArray(value)) return value.map(resolveValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveValue(v)]),
    );
  }
  return value;
}

function loadFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, filename), "utf-8")) as T;
}

async function seedCollection(
  collectionName: string,
  data: Record<string, Record<string, unknown>>,
) {
  for (const [id, fields] of Object.entries(data)) {
    await db.collection(collectionName).doc(id).set(resolveValue(fields) as Record<string, unknown>);
  }
  console.log(`  ${collectionName}: ${Object.keys(data).length} docs`);
}

async function seedCatalog() {
  const files = readdirSync(catalogDir).filter((f) => f.endsWith(".json")).sort();
  let total = 0;
  for (const file of files) {
    const items = JSON.parse(readFileSync(join(catalogDir, file), "utf-8")) as Array<{
      id: string;
      [k: string]: unknown;
    }>;
    for (const { id, ...fields } of items) {
      await db.collection("catalog").doc(id).set(resolveValue(fields) as Record<string, unknown>);
    }
    total += items.length;
  }
  console.log(`  catalog: ${total} docs from ${files.length} files`);
}

async function seedAuthUsers() {
  const users = loadFixture<
    Array<{
      uid: string;
      email?: string;
      password?: string;
      displayName: string;
      disabled?: boolean;
      customClaims?: Record<string, unknown>;
    }>
  >("auth-users.json");

  for (const { customClaims, ...props } of users) {
    await upsertAuthUser(props);
    if (customClaims && Object.keys(customClaims).length > 0) {
      await auth.setCustomUserClaims(props.uid, customClaims);
    }
  }
  console.log(`  auth users: ${users.length}`);
}

async function upsertAuthUser(props: {
  uid: string;
  email?: string;
  password?: string;
  displayName: string;
  disabled?: boolean;
}): Promise<void> {
  try {
    await auth.createUser(props);
    return;
  } catch (e: any) {
    const code = e?.errorInfo?.code;
    if (code === "auth/uid-already-exists") {
      const { uid, password, ...updateProps } = props;
      await auth.updateUser(uid, updateProps);
      return;
    }
    if (code === "auth/email-already-exists" && props.email) {
      // Different UID holds this email (e.g. switching between fixture
      // sets). Delete that account, then create the new one.
      const existing = await auth.getUserByEmail(props.email);
      await auth.deleteUser(existing.uid);
      await auth.createUser(props);
      return;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seed() {
  const mode: "full" | "structural" = process.argv.includes("--mode=structural")
    ? "structural"
    : "full";

  console.log(
    `Seeding emulator (mode=${mode}, fixtures=${usingOpsFixtures ? "operations repo" : "public placeholders"})...`,
  );

  // Structural — always written.
  await seedCollection("permission", loadFixture("permissions.json"));
  await seedCatalog();
  await seedCollection("maco", loadFixture("maco.json"));
  await seedCollection("machine", loadFixture("machines.json"));
  await seedCollection("price_lists", loadFixture("price-lists.json"));

  await db
    .collection("config")
    .doc("pricing")
    .set(resolveValue(loadFixture<Record<string, unknown>>("config-pricing.json")) as Record<string, unknown>);
  console.log("  config/pricing: 1 doc");

  await db
    .collection("config")
    .doc("catalog-references")
    .set(resolveValue(loadFixture<Record<string, unknown>>("config-catalog-references.json")) as Record<string, unknown>);
  console.log("  config/catalog-references: 1 doc");

  await db.collection("config").doc("billing").set({ nextBillNumber: 4_200_000 });
  console.log("  config/billing: nextBillNumber=4200000");

  if (mode === "full") {
    await seedAuthUsers();
    await seedCollection("users", loadFixture("users.json"));
    await seedCollection("tokens", loadFixture("tokens.json"));
  }

  console.log("\nDone! Emulator seeded successfully.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
