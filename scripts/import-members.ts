#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-off import of existing club members from a sanitized ClubDesk export.
 *
 * Input: tab-delimited text file with the header row
 *   Nachname  Vorname  Adresse  PLZ  Ort  Telefon Privat  Telefon Mobil  Anrede  E-Mail  Status
 * (columns are matched by header text, not position; `Anrede` is read but
 * NOT imported — the users schema has no salutation field).
 *
 * For each valid row this creates:
 *   1. a Firebase Auth user (email only, no password) so the users doc ID
 *      is a real UID — the member later claims the account by signing in
 *      with a login code (email match), per the standard claiming flow
 *   2. a `users/{uid}` doc with termsAcceptedAt: null (unclaimed sentinel)
 *   3. a `memberships` doc (Einzelmitglied → "single", Familienmitglied →
 *      "family"), owner = the member, members = [member], paid 2026-02-01,
 *      validUntil = start + 365 days (production `plusOneYear` semantics)
 *   4. the `activeMembership` pointer on the users doc (eager, same as the
 *      purchase path; onMembershipWritten would reconcile it anyway)
 *
 * `autoRenew` is left absent (= true): the renewal cron will auto-invoice
 * these memberships ~30 days before validUntil, which is the desired
 * behavior for real members (issue #323).
 *
 * Row handling rules:
 *   - no / invalid e-mail                → row skipped (reported)
 *   - status not Einzel-/Familienmitglied → row skipped (reported)
 *   - duplicate e-mail within the file   → ALL involved rows skipped
 *     (e-mail is the account-claiming key; duplicates need manual review)
 *   - e-mail already in Auth/Firestore   → row skipped (already has an
 *     account; attach memberships manually via admin UI)
 *   - duplicate phone within the file    → warning only, rows still import
 *   - unparseable phone                  → warning, user imported w/o phone
 *   - Familienmitglied rows sharing an address → warning (possibly one
 *     family that should share ONE membership instead of getting two)
 *
 * Usage:
 *   # Dry run against the emulator (default mode is dry run)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/import-members.ts mitglieder.txt
 *
 *   # Dry run against production (read-only lookups, no writes)
 *   FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/import-members.ts mitglieder.txt --prod
 *
 *   # Actually import
 *   FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/import-members.ts mitglieder.txt --prod --apply
 */

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { firestore } from "firebase-admin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PROD_MODE = argv.includes("--prod");
const APPLY = argv.includes("--apply");
const inputFile = argv.find((a) => !a.startsWith("--"));
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

// Membership period: all imported memberships start 2026-02-01 (Europe/Zurich)
// and run start + 365 days, matching functions/src/membership/shared.ts
// plusOneYear(). Last fully covered day is therefore 2027-01-31.
const MEMBERSHIP_START = new Date("2026-02-01T00:00:00+01:00");
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MEMBERSHIP_VALID_UNTIL = new Date(MEMBERSHIP_START.getTime() + ONE_YEAR_MS);

const STATUS_TO_TYPE: Record<string, "single" | "family"> = {
  einzelmitglied: "single",
  familienmitglied: "family",
};

const REQUIRED_HEADERS = [
  "Nachname",
  "Vorname",
  "Adresse",
  "PLZ",
  "Ort",
  "Telefon Privat",
  "Telefon Mobil",
  "Anrede",
  "E-Mail",
  "Status",
] as const;
type Header = (typeof REQUIRED_HEADERS)[number];

interface ParsedRow {
  line: number; // 1-based line number in the file, for the report
  raw: Record<Header, string>;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  type: "single" | "family";
  billingAddress: { company: string; street: string; zip: string; city: string } | null;
  warnings: string[];
}

interface SkippedRow {
  line: number;
  who: string;
  reason: string;
}

/**
 * Excel's "Text (Tab delimited)" export is usually Windows-1252, its
 * "Unicode Text" export UTF-16LE — assuming UTF-8 would silently mangle
 * every umlaut in the member names. Detect via BOM, then strict-UTF-8
 * attempt, then fall back to Windows-1252.
 */
function decodeFile(filePath: string): { text: string; encoding: string } {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString("utf16le"), encoding: "UTF-16LE (BOM)" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return {
      text: new TextDecoder("utf-16be").decode(buf.subarray(2)),
      encoding: "UTF-16BE (BOM)",
    };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString("utf8"), encoding: "UTF-8 (BOM)" };
  }
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buf),
      encoding: "UTF-8",
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(buf),
      encoding: "Windows-1252",
    };
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function parseRows(text: string): Promise<{
  rows: ParsedRow[];
  skipped: SkippedRow[];
  totalDataLines: number;
}> {
  const { parsePhoneNumberFromString } = await import("libphonenumber-js/min");
  const parsePhone = (input: string): string | null => {
    const parsed = parsePhoneNumberFromString(input.trim(), "CH");
    return parsed && parsed.isValid() ? parsed.number : null;
  };

  const lines = text.split(/\r\n|\r|\n/);
  const headerCells = (lines[0] ?? "").split("\t").map((h) => h.trim());
  const colIndex = new Map<Header, number>();
  for (const h of REQUIRED_HEADERS) {
    const idx = headerCells.findIndex((c) => c.toLowerCase() === h.toLowerCase());
    if (idx === -1) {
      throw new Error(
        `Header column "${h}" not found. Got: ${headerCells.join(" | ")}`
      );
    }
    colIndex.set(h, idx);
  }

  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];
  let totalDataLines = 0;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    totalDataLines++;
    const cells = lines[i].split("\t");
    const raw = Object.fromEntries(
      REQUIRED_HEADERS.map((h) => [h, (cells[colIndex.get(h)!] ?? "").trim()])
    ) as Record<Header, string>;
    const line = i + 1;
    const who = `${raw.Vorname} ${raw.Nachname}`.trim() || "(no name)";

    const email = raw["E-Mail"].toLowerCase();
    if (email === "") {
      skipped.push({ line, who, reason: "no e-mail" });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      skipped.push({ line, who, reason: `invalid e-mail "${raw["E-Mail"]}"` });
      continue;
    }
    if (raw.Vorname === "" || raw.Nachname === "") {
      skipped.push({ line, who, reason: "missing first or last name" });
      continue;
    }
    const type = STATUS_TO_TYPE[raw.Status.toLowerCase()];
    if (!type) {
      skipped.push({ line, who, reason: `unknown Status "${raw.Status}"` });
      continue;
    }

    const warnings: string[] = [];

    // Prefer the mobile number; fall back to the landline if the mobile is
    // absent or unparseable. Normalized to E.164 like the web forms (#298).
    let phone: string | null = null;
    const candidates = [
      { label: "Telefon Mobil", value: raw["Telefon Mobil"] },
      { label: "Telefon Privat", value: raw["Telefon Privat"] },
    ].filter((c) => c.value !== "");
    for (const c of candidates) {
      const parsed = parsePhone(c.value);
      if (parsed) {
        phone = parsed;
        break;
      }
      warnings.push(`${c.label} "${c.value}" is not a valid phone number`);
    }
    if (candidates.length > 0 && phone === null) {
      warnings.push("no usable phone number — imported without phone");
    }

    const { Adresse: street, PLZ: zip, Ort: city } = raw;
    const billingAddress =
      street === "" && zip === "" && city === ""
        ? null
        : { company: "", street, zip, city };
    if (billingAddress === null) {
      warnings.push("no address");
    } else if (street === "" || zip === "" || city === "") {
      warnings.push(`incomplete address ("${street}", "${zip}", "${city}")`);
    }

    rows.push({
      line,
      raw,
      email,
      firstName: raw.Vorname,
      lastName: raw.Nachname,
      phone,
      type,
      billingAddress,
      warnings,
    });
  }

  return { rows, skipped, totalDataLines };
}

/** Duplicate e-mails are fatal for the involved rows; duplicate phones warn. */
function checkDuplicates(rows: ParsedRow[], skipped: SkippedRow[]): ParsedRow[] {
  const byEmail = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
  }
  const kept: ParsedRow[] = [];
  for (const [email, group] of byEmail) {
    if (group.length === 1) {
      kept.push(group[0]);
    } else {
      for (const r of group) {
        skipped.push({
          line: r.line,
          who: `${r.firstName} ${r.lastName}`,
          reason: `duplicate e-mail ${email} (${group.length} rows: ${group
            .map((g) => `line ${g.line}`)
            .join(", ")}) — resolve manually`,
        });
      }
    }
  }
  kept.sort((a, b) => a.line - b.line);

  const byPhone = new Map<string, ParsedRow[]>();
  for (const r of kept) {
    if (r.phone) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), r]);
  }
  for (const [phone, group] of byPhone) {
    if (group.length > 1) {
      for (const r of group) {
        r.warnings.push(
          `phone ${phone} shared with ${group
            .filter((g) => g !== r)
            .map((g) => `${g.firstName} ${g.lastName} (line ${g.line})`)
            .join(", ")}`
        );
      }
    }
  }

  // Familienmitglied rows at the same address are likely ONE family — as
  // imported, each row gets its own family membership (and later its own
  // renewal invoice). Flag for manual review.
  const familiesByAddress = new Map<string, ParsedRow[]>();
  for (const r of kept) {
    if (r.type !== "family" || !r.billingAddress) continue;
    const key = `${r.billingAddress.zip}|${r.billingAddress.street}`
      .toLowerCase()
      .replace(/\s+/g, " ");
    familiesByAddress.set(key, [...(familiesByAddress.get(key) ?? []), r]);
  }
  for (const group of familiesByAddress.values()) {
    if (group.length > 1) {
      for (const r of group) {
        r.warnings.push(
          `Familienmitglied at same address as ${group
            .filter((g) => g !== r)
            .map((g) => `${g.firstName} ${g.lastName} (line ${g.line})`)
            .join(", ")} — creates ${group.length} separate family memberships`
        );
      }
    }
  }

  return kept;
}

async function checkExistingAccounts(
  admin: typeof import("firebase-admin"),
  db: firestore.Firestore,
  rows: ParsedRow[],
  skipped: SkippedRow[]
): Promise<ParsedRow[]> {
  const auth = admin.auth();
  const existingEmails = new Set<string>();

  // Auth lookup, batched (getUsers accepts up to 100 identifiers).
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const result = await auth.getUsers(chunk.map((r) => ({ email: r.email })));
    for (const u of result.users) {
      if (u.email) existingEmails.add(u.email.toLowerCase());
    }
  }

  // Firestore lookup for pre-created docs ('in' filter caps at 30 values).
  for (let i = 0; i < rows.length; i += 30) {
    const chunk = rows.slice(i, i + 30);
    const snap = await db
      .collection("users")
      .where("email", "in", chunk.map((r) => r.email))
      .get();
    for (const doc of snap.docs) {
      const email = (doc.get("email") as string | null)?.toLowerCase();
      if (email) existingEmails.add(email);
    }
  }

  const kept: ParsedRow[] = [];
  for (const r of rows) {
    if (existingEmails.has(r.email)) {
      skipped.push({
        line: r.line,
        who: `${r.firstName} ${r.lastName}`,
        reason: `account for ${r.email} already exists — attach membership via admin UI if needed`,
      });
    } else {
      kept.push(r);
    }
  }
  return kept;
}

function printReport(args: {
  encoding: string;
  totalDataLines: number;
  toImport: ParsedRow[];
  skipped: SkippedRow[];
}) {
  const { encoding, totalDataLines, toImport, skipped } = args;
  const singles = toImport.filter((r) => r.type === "single").length;
  const families = toImport.filter((r) => r.type === "family").length;
  const withPhone = toImport.filter((r) => r.phone !== null).length;
  const warned = toImport.filter((r) => r.warnings.length > 0);

  const line = "=".repeat(72);
  console.log(`\n${line}\nMEMBER IMPORT REPORT\n${line}`);
  console.log(`File encoding detected : ${encoding}`);
  console.log(`Data rows in file      : ${totalDataLines}`);
  console.log(`Rows to import         : ${toImport.length}`);
  console.log(`Rows skipped           : ${skipped.length}`);
  console.log(`\nWill create:`);
  console.log(`  ${toImport.length} Auth users + users docs (unclaimed, termsAcceptedAt: null)`);
  console.log(`  ${singles} single ("Einzelmitglied") memberships`);
  console.log(`  ${families} family ("Familienmitglied") memberships`);
  console.log(`  ${withPhone}/${toImport.length} users with a phone number`);
  console.log(
    `\nMembership period: paid ${MEMBERSHIP_START.toISOString()} → validUntil ${MEMBERSHIP_VALID_UNTIL.toISOString()}`
  );
  console.log(
    "autoRenew stays on: renewal invoices go out automatically ~30 days before expiry."
  );
  console.log("Note: the Anrede column is not imported (no schema field for it).");

  if (skipped.length > 0) {
    console.log(`\n${"-".repeat(72)}\nSKIPPED ROWS (${skipped.length})`);
    for (const s of [...skipped].sort((a, b) => a.line - b.line)) {
      console.log(`  line ${s.line}: ${s.who} — ${s.reason}`);
    }
  }

  if (warned.length > 0) {
    console.log(`\n${"-".repeat(72)}\nWARNINGS (rows import anyway) (${warned.length})`);
    for (const r of warned) {
      for (const w of r.warnings) {
        console.log(`  line ${r.line}: ${r.firstName} ${r.lastName} — ${w}`);
      }
    }
  }
  console.log(line);
}

async function applyImport(
  admin: typeof import("firebase-admin"),
  db: firestore.Firestore,
  rows: ParsedRow[]
) {
  const auth = admin.auth();
  const { Timestamp } = await import("firebase-admin/firestore");
  const now = Timestamp.now();
  const lastPaidAt = Timestamp.fromDate(MEMBERSHIP_START);
  const validUntil = Timestamp.fromDate(MEMBERSHIP_VALID_UNTIL);

  let created = 0;
  const failures: SkippedRow[] = [];

  for (const r of rows) {
    let uid: string | null = null;
    try {
      const authUser = await auth.createUser({
        email: r.email,
        displayName: `${r.firstName} ${r.lastName}`,
      });
      uid = authUser.uid;

      const userRef = db.collection("users").doc(uid);
      const membershipRef = db.collection("memberships").doc();
      const batch = db.batch();
      batch.set(userRef, {
        created: now,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        phone: r.phone,
        permissions: [],
        roles: [],
        termsAcceptedAt: null,
        userType: "erwachsen",
        billingAddress: r.billingAddress,
        activeMembership: membershipRef,
      });
      batch.set(membershipRef, {
        type: r.type,
        status: "active",
        lastPaidAt,
        validUntil,
        ownerUserId: userRef,
        members: [userRef],
        paymentCheckouts: [],
        notes: "Importiert aus ClubDesk-Export (scripts/import-members.ts)",
        created: now,
        createdBy: null,
        modifiedAt: now,
        modifiedBy: null,
      });
      await batch.commit();
      created++;
      console.log(`  created ${r.email} (${r.type}) → users/${uid}`);
    } catch (err) {
      // Don't leave an orphaned Auth user behind (same rollback as the
      // create-user callable).
      if (uid) {
        await auth.deleteUser(uid).catch(() => undefined);
      }
      const message = err instanceof Error ? err.message : String(err);
      failures.push({
        line: r.line,
        who: `${r.firstName} ${r.lastName}`,
        reason: `IMPORT FAILED: ${message}`,
      });
      console.error(`  FAILED ${r.email}: ${message}`);
    }
  }

  console.log(`\nImported ${created}/${rows.length} members.`);
  if (failures.length > 0) {
    console.log(`${failures.length} failures:`);
    for (const f of failures) {
      console.log(`  line ${f.line}: ${f.who} — ${f.reason}`);
    }
    process.exitCode = 1;
  }
}

async function main() {
  if (!inputFile) {
    throw new Error(
      "Usage: npx tsx scripts/import-members.ts <export.txt> [--prod] [--apply]"
    );
  }
  const admin = await import("firebase-admin");

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID not set");
  }

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const targetingLive = !emulatorHost;
  if (targetingLive && !PROD_MODE) {
    throw new Error(
      `Refusing to touch the live project "${projectId}" without --prod flag. ` +
        "Either set FIRESTORE_EMULATOR_HOST or pass --prod explicitly."
    );
  }

  console.log(
    `Project: ${projectId}, Target: ${
      emulatorHost ? `emulator ${emulatorHost}` : `LIVE (${projectId})`
    }, Mode: ${APPLY ? "APPLY" : "dry run"}`
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

  const { text, encoding } = decodeFile(inputFile);
  const { rows, skipped, totalDataLines } = await parseRows(text);
  const deduped = checkDuplicates(rows, skipped);
  const toImport = await checkExistingAccounts(admin, db, deduped, skipped);

  printReport({ encoding, totalDataLines, toImport, skipped });

  if (!APPLY) {
    console.log("\nDry run — no writes performed. Re-run with --apply to import.");
    return;
  }

  console.log(`\nApplying: creating ${toImport.length} members...`);
  await applyImport(admin, db, toImport);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
