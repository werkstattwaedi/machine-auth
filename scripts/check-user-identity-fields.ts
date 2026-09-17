#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot audit of the identity fields on `users` docs — the pre-deploy
 * gate for issue #633 (ADR-0043), which makes login resolve by
 * `users.email` and Auth `phoneNumber` follow `users.phone`:
 *
 *   - `phone` must be null or strict E.164. Auth always stores E.164, so
 *     the plain string comparison is only safe when the doc side is too.
 *   - `email` must be null or already normalised (trim + lowercase) —
 *     anything else is invisible to the `where("email", "==", …)` lookup.
 *   - no two docs may share a normalised e-mail: after the change that is
 *     a hard login failure for both.
 *
 * Verifying the data up front is what lets the runtime code skip
 * normalising / tie-breaking. Never prints a phone number or an e-mail:
 * offenders are reported as uid (+ a shape mask for phones: every digit
 * → 9, every letter → a).
 *
 * Idempotent — read-only. Exit code 1 when anything needs fixing.
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/check-user-identity-fields.ts
 *
 *   # Production
 *   npx tsx scripts/check-user-identity-fields.ts --prod
 */

import { config as loadEnv } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PROD_MODE = argv.includes("--prod");
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

/** Same shape `checkPhoneAccountExists` accepts — what Auth stores. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

type FieldClass = "absent" | "ok" | "empty-string" | "non-string" | "malformed";

function classify(value: unknown, isOk: (s: string) => boolean): FieldClass {
  if (value === null || value === undefined) return "absent";
  if (typeof value !== "string") return "non-string";
  if (value === "") return "empty-string";
  return isOk(value) ? "ok" : "malformed";
}

function shapeMask(value: string): string {
  return value.replace(/[0-9]/g, "9").replace(/\p{L}/gu, "a");
}

function emptyCounts(): Record<FieldClass, number> {
  return { absent: 0, ok: 0, "empty-string": 0, "non-string": 0, malformed: 0 };
}

function printCounts(label: string, counts: Record<FieldClass, number>) {
  console.log(`  ${label}`);
  for (const [cls, n] of Object.entries(counts)) {
    console.log(`    ${cls.padEnd(13)} ${n}`);
  }
}

async function main() {
  const admin = await import("firebase-admin");

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID not set");
  }

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const targetingProd = !emulatorHost;
  if (PROD_MODE && !targetingProd) {
    throw new Error("--prod set but FIRESTORE_EMULATOR_HOST is also set");
  }
  if (!PROD_MODE && targetingProd) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST not set — refusing to run against production without --prod"
    );
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  // `select` keeps every other profile field out of this process.
  const snap = await db.collection("users").select("phone", "email").get();

  const phoneCounts = emptyCounts();
  const emailCounts = emptyCounts();
  const phoneOffenders = new Map<string, string[]>();
  const emailOffenders: string[] = [];
  const uidsByEmail = new Map<string, string[]>();

  for (const doc of snap.docs) {
    const phone: unknown = doc.get("phone");
    const phoneClass = classify(phone, (s) => E164.test(s));
    phoneCounts[phoneClass] += 1;
    if (phoneClass !== "absent" && phoneClass !== "ok") {
      const shape =
        phoneClass === "malformed" ? shapeMask(phone as string) : `<${phoneClass}>`;
      phoneOffenders.set(shape, [...(phoneOffenders.get(shape) ?? []), doc.id]);
    }

    const email: unknown = doc.get("email");
    const emailClass = classify(email, (s) => s === s.trim().toLowerCase());
    emailCounts[emailClass] += 1;
    if (emailClass !== "absent" && emailClass !== "ok") {
      emailOffenders.push(doc.id);
    }
    if (typeof email === "string" && email !== "") {
      const key = email.trim().toLowerCase();
      uidsByEmail.set(key, [...(uidsByEmail.get(key) ?? []), doc.id]);
    }
  }
  const duplicateGroups = [...uidsByEmail.values()].filter((u) => u.length > 1);

  console.log(`${projectId}: ${snap.size} users docs scanned`);
  printCounts("phone (ok = E.164)", phoneCounts);
  printCounts("email (ok = trimmed + lowercase)", emailCounts);
  console.log(`  e-mails shared by more than one doc: ${duplicateGroups.length}`);

  if (
    phoneOffenders.size === 0 &&
    emailOffenders.length === 0 &&
    duplicateGroups.length === 0
  ) {
    console.log("OK — phones are null/E.164, e-mails are null/normalised and unique.");
    return;
  }

  if (phoneOffenders.size > 0) {
    console.log("\nPhones to normalise:");
    for (const [shape, uids] of phoneOffenders) {
      console.log(`  "${shape}" × ${uids.length}`);
      for (const uid of uids) console.log(`    - ${uid}`);
    }
  }
  if (emailOffenders.length > 0) {
    console.log("\nE-mails to normalise:");
    for (const uid of emailOffenders) console.log(`    - ${uid}`);
  }
  if (duplicateGroups.length > 0) {
    console.log("\nDocs sharing one e-mail (merge or clear before deploying):");
    for (const uids of duplicateGroups) console.log(`    - ${uids.join("  ")}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
