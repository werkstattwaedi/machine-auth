#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Grant a machine permission to everyone listed in a course-attendance
 * workbook (e.g. the Laserkurs list), creating the accounts that don't exist.
 *
 * Input: an .xlsx whose first worksheet has a header row with
 *   Vorname  Nachname  E-Mail
 * (matched by header text, not position; other columns are ignored).
 *
 * Per row, by the normalized e-mail (ADR-0043 — the users doc is canonical):
 *   - users doc exists, has the permission  → nothing to do
 *   - users doc exists, lacks it            → arrayUnion the permission ref
 *   - no users doc                          → Auth user + `users/{uid}` doc
 *     (unclaimed, termsAcceptedAt: null) with the permission; the person
 *     claims it later by signing in with a login code. A *bare* Auth record
 *     already holding the e-mail is adopted, exactly like the admin
 *     `createUser` callable does; any other Auth holder is a conflict.
 *     Before creating, existing users with the same name (case, accents and
 *     a swapped first/last name ignored) are listed as a warning — usually
 *     the person registered with another address and the file should carry
 *     that one instead, so fix the file and re-run the dry run.
 *   - invalid / missing e-mail, duplicate e-mail in the file, two users docs
 *     for one e-mail, Auth conflict → skipped and reported (manual review)
 *
 * The permission defaults to the one named "Lasercutter"; pass
 * `--permission <permissionId>` to pick another.
 *
 * Usage (dry run is the default — always run it first):
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/grant-permission-from-xlsx.ts laserkurs.xlsx
 *
 *   # Live project, read-only
 *   FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/grant-permission-from-xlsx.ts laserkurs.xlsx --prod
 *
 *   # Live project, write
 *   FIREBASE_PROJECT_ID=oww-maco npx tsx scripts/grant-permission-from-xlsx.ts laserkurs.xlsx --prod --apply
 */

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { firestore } from "firebase-admin";
import type { UserRecord } from "firebase-admin/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PROD_MODE = argv.includes("--prod");
const APPLY = argv.includes("--apply");
const permIdx = argv.indexOf("--permission");
const PERMISSION_ID = permIdx >= 0 ? argv[permIdx + 1] : undefined;
const DEFAULT_PERMISSION_NAME = "Lasercutter";
const inputFile = argv.find(
  (a, i) => !a.startsWith("--") && !(permIdx >= 0 && i === permIdx + 1)
);
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

const HEADERS = ["Vorname", "Nachname", "E-Mail"] as const;
type Header = (typeof HEADERS)[number];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Row {
  line: number;
  firstName: string;
  lastName: string;
  email: string;
}

type Plan =
  | { kind: "has"; row: Row; uid: string }
  | { kind: "grant"; row: Row; uid: string; nameNote: string | null }
  | { kind: "create"; row: Row; adoptUid: string | null; sameName: string[] }
  | { kind: "skip"; row: Row | { line: number; who: string }; reason: string };

/**
 * Excel cells come back as strings, numbers, hyperlinks (`{ text, hyperlink }`
 * — Excel auto-links typed e-mails), rich text or formula results.
 */
function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((r) => r.text).join("").trim();
    }
    if (typeof v.text === "string") return v.text.trim();
    if (v.text && typeof v.text === "object") return cellText(v.text);
    if ("result" in v) return cellText(v.result);
    if (typeof v.hyperlink === "string") return v.hyperlink.replace(/^mailto:/i, "").trim();
  }
  return String(value).trim();
}

async function readRows(file: string): Promise<{ rows: Row[]; skipped: Plan[] }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Workbook has no worksheets");

  // The header row is the first row naming all three columns (tolerates a
  // title row above it).
  let headerRow = -1;
  const col = new Map<Header, number>();
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && headerRow < 0; r++) {
    const cells = new Map<string, number>();
    ws.getRow(r).eachCell((cell, c) => cells.set(cellText(cell.value).toLowerCase(), c));
    if (HEADERS.every((h) => cells.has(h.toLowerCase()))) {
      headerRow = r;
      for (const h of HEADERS) col.set(h, cells.get(h.toLowerCase())!);
    }
  }
  if (headerRow < 0) {
    throw new Error(
      `No header row with ${HEADERS.join(" / ")} in the first 10 rows of sheet "${ws.name}"`
    );
  }

  const rows: Row[] = [];
  const skipped: Plan[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (h: Header) => cellText(row.getCell(col.get(h)!).value);
    const firstName = get("Vorname");
    const lastName = get("Nachname");
    const rawEmail = get("E-Mail");
    if (!firstName && !lastName && !rawEmail) continue;
    const who = `${firstName} ${lastName}`.trim() || "(no name)";
    const email = rawEmail.replace(/^mailto:/i, "").trim().toLowerCase();
    if (!email) {
      skipped.push({ kind: "skip", row: { line: r, who }, reason: "no e-mail" });
    } else if (!EMAIL_RE.test(email)) {
      skipped.push({ kind: "skip", row: { line: r, who }, reason: `invalid e-mail "${rawEmail}"` });
    } else {
      rows.push({ line: r, firstName, lastName, email });
    }
  }

  // A duplicate e-mail is harmless for the grant, but if the names differ it
  // is likely a typo for someone else — flag those, keep exact repeats once.
  const byEmail = new Map<string, Row[]>();
  for (const r of rows) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
  const kept: Row[] = [];
  for (const [email, group] of byEmail) {
    const names = new Set(group.map((g) => `${g.firstName} ${g.lastName}`.toLowerCase()));
    if (names.size === 1) {
      kept.push(group[0]);
    } else {
      for (const g of group) {
        skipped.push({
          kind: "skip",
          row: g,
          reason: `e-mail ${email} used by different names (lines ${group
            .map((x) => x.line)
            .join(", ")}) — resolve manually`,
        });
      }
    }
  }
  kept.sort((a, b) => a.line - b.line);
  return { rows: kept, skipped };
}

/** Name key that ignores case, accents, spacing and first/last order. */
function nameKey(first: string, last: string): string {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return [norm(first), norm(last)].sort().join("|");
}

function who(row: Plan["row"]): string {
  return "email" in row
    ? `${row.firstName} ${row.lastName} <${row.email}>`
    : row.who;
}

async function main() {
  if (!inputFile) {
    throw new Error(
      "Usage: npx tsx scripts/grant-permission-from-xlsx.ts <file.xlsx> [--permission <id>] [--prod] [--apply]"
    );
  }
  const admin = await import("firebase-admin");
  const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
  const { findUserDocByEmail, isBareAuthRecord } = await import(
    "../functions/src/auth/identity"
  );

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID not set");
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulatorHost && !PROD_MODE) {
    throw new Error(
      `Refusing to touch the live project "${projectId}" without --prod. ` +
        "Set FIRESTORE_EMULATOR_HOST or pass --prod explicitly."
    );
  }
  if (emulatorHost && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is set but FIREBASE_AUTH_EMULATOR_HOST is not — " +
        "Auth writes would go to the live project."
    );
  }
  console.log(
    `Project: ${projectId}, Target: ${emulatorHost ? `emulator ${emulatorHost}` : "LIVE"}, ` +
      `Mode: ${APPLY ? "APPLY" : "dry run"}`
  );

  if (!admin.apps.length) {
    const sa = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!emulatorHost && sa && fs.existsSync(sa)) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(fs.readFileSync(sa, "utf8"))),
        projectId,
      });
    } else {
      admin.initializeApp({ projectId });
    }
  }
  const db = admin.firestore();
  const auth = admin.auth();

  // Resolve the permission.
  let permRef: firestore.DocumentReference;
  if (PERMISSION_ID) {
    permRef = db.collection("permission").doc(PERMISSION_ID);
    const snap = await permRef.get();
    if (!snap.exists) throw new Error(`permission/${PERMISSION_ID} does not exist`);
    console.log(`Permission: ${snap.get("name")} (permission/${permRef.id})`);
  } else {
    const snap = await db
      .collection("permission")
      .where("name", "==", DEFAULT_PERMISSION_NAME)
      .get();
    if (snap.size !== 1) {
      throw new Error(
        `Expected exactly one permission named "${DEFAULT_PERMISSION_NAME}", found ${snap.size} — pass --permission <id>`
      );
    }
    permRef = snap.docs[0].ref;
    console.log(`Permission: ${DEFAULT_PERMISSION_NAME} (permission/${permRef.id})`);
  }

  const { rows, skipped } = await readRows(inputFile);

  // Plan every row read-only first, so the dry run shows exactly what
  // --apply will do.
  const plans: Plan[] = [...skipped];
  for (const row of rows) {
    let doc: firestore.QueryDocumentSnapshot | null;
    try {
      doc = await findUserDocByEmail(db, row.email);
    } catch {
      plans.push({ kind: "skip", row, reason: "several users docs share this e-mail — merge first" });
      continue;
    }
    if (doc) {
      const perms = (doc.get("permissions") as firestore.DocumentReference[] | undefined) ?? [];
      if (perms.some((p) => p.isEqual(permRef))) {
        plans.push({ kind: "has", row, uid: doc.id });
      } else {
        const docName = `${doc.get("firstName") ?? ""} ${doc.get("lastName") ?? ""}`.trim();
        const fileName = `${row.firstName} ${row.lastName}`.trim();
        plans.push({
          kind: "grant",
          row,
          uid: doc.id,
          nameNote:
            docName.toLowerCase() === fileName.toLowerCase()
              ? null
              : `account name is "${docName}"`,
        });
      }
      continue;
    }

    // No users doc — check the Auth side the same way the admin createUser
    // callable does: only a bare leftover record may be adopted.
    let holder: UserRecord | null = null;
    try {
      holder = await auth.getUserByEmail(row.email);
    } catch (err) {
      if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
    }
    if (!holder) {
      plans.push({ kind: "create", row, adoptUid: null, sameName: [] });
    } else if (
      !(await db.collection("users").doc(holder.uid).get()).exists &&
      isBareAuthRecord(holder)
    ) {
      plans.push({ kind: "create", row, adoptUid: holder.uid, sameName: [] });
    } else {
      plans.push({
        kind: "skip",
        row,
        reason: `Auth record ${holder.uid} holds this e-mail but its users doc names another — resolve via privacy-cli audit-identity`,
      });
    }
  }

  // Same-name check for accounts about to be created. One pass over all
  // users (name + e-mail fields only), and only when something is created.
  const creates = plans.filter(
    (p): p is Extract<Plan, { kind: "create" }> => p.kind === "create"
  );
  if (creates.length > 0) {
    const byName = new Map<string, string[]>();
    const snap = await db.collection("users").select("firstName", "lastName", "email").get();
    for (const d of snap.docs) {
      const key = nameKey(d.get("firstName") ?? "", d.get("lastName") ?? "");
      if (key === "|") continue;
      const label = `${d.get("firstName") ?? ""} ${d.get("lastName") ?? ""}`.trim();
      byName.set(key, [
        ...(byName.get(key) ?? []),
        `${label} <${d.get("email") ?? "no e-mail"}> users/${d.id}`,
      ]);
    }
    for (const p of creates) {
      p.sameName = byName.get(nameKey(p.row.firstName, p.row.lastName)) ?? [];
    }
  }

  const by = <K extends Plan["kind"]>(k: K) =>
    plans.filter((p): p is Extract<Plan, { kind: K }> => p.kind === k);
  const has = by("has");
  const grant = by("grant");
  const create = by("create");
  const skip = by("skip").sort((a, b) => a.row.line - b.row.line);

  const bar = "=".repeat(72);
  console.log(`\n${bar}\nPERMISSION GRANT REPORT — ${inputFile}\n${bar}`);
  console.log(`Already have permission : ${has.length}`);
  console.log(`Existing, to grant      : ${grant.length}`);
  console.log(`New accounts to create  : ${create.length}`);
  console.log(`Skipped                 : ${skip.length}`);
  const sameName = create.filter((p) => p.sameName.length > 0);
  if (sameName.length) {
    console.log(`\n⚠ ${sameName.length} new account(s) share a name with an existing user — see CREATE`);
  }
  if (grant.length) {
    console.log(`\nGRANT`);
    for (const p of grant) {
      console.log(`  line ${p.row.line}: ${who(p.row)} → users/${p.uid}${p.nameNote ? ` (${p.nameNote})` : ""}`);
    }
  }
  if (create.length) {
    console.log(`\nCREATE`);
    for (const p of create) {
      console.log(`  line ${p.row.line}: ${who(p.row)}${p.adoptUid ? ` (adopts bare Auth record ${p.adoptUid})` : ""}`);
      for (const m of p.sameName) {
        console.log(`    ⚠ same name, different e-mail: ${m}`);
      }
    }
  }
  if (skip.length) {
    console.log(`\nSKIPPED`);
    for (const p of skip) console.log(`  line ${p.row.line}: ${who(p.row)} — ${p.reason}`);
  }
  console.log(bar);

  if (!APPLY) {
    console.log("\nDry run — no writes performed. Re-run with --apply.");
    return;
  }

  let failures = 0;
  const now = () => Timestamp.now();

  for (const p of grant) {
    try {
      // modifiedBy: null so the audit trail doesn't attribute this to the
      // last admin who edited the doc.
      await db.collection("users").doc(p.uid).update({
        permissions: FieldValue.arrayUnion(permRef),
        modifiedBy: null,
        modifiedAt: now(),
      });
      console.log(`  granted ${p.row.email} → users/${p.uid}`);
    } catch (err) {
      failures++;
      console.error(`  FAILED grant ${p.row.email}: ${(err as Error).message}`);
    }
  }

  for (const p of create) {
    const displayName = `${p.row.firstName} ${p.row.lastName}`.trim();
    let uid: string | null = null;
    let createdHere = false;
    try {
      if (p.adoptUid) {
        uid = p.adoptUid;
        await auth.updateUser(uid, { displayName });
      } else {
        uid = (await auth.createUser({ email: p.row.email, displayName })).uid;
        createdHere = true;
      }
      // create() so a sign-up finishing on an adopted uid is never clobbered.
      await db.collection("users").doc(uid).create({
        created: now(),
        email: p.row.email,
        phone: null,
        firstName: p.row.firstName,
        lastName: p.row.lastName,
        permissions: [permRef],
        roles: [],
        termsAcceptedAt: null,
        userType: "erwachsen",
        billingAddress: null,
      });
      console.log(`  created ${p.row.email} → users/${uid}`);
    } catch (err) {
      failures++;
      if (createdHere && uid) await auth.deleteUser(uid).catch(() => undefined);
      console.error(`  FAILED create ${p.row.email}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\nDone: ${grant.length + create.length - failures}/${grant.length + create.length} writes succeeded.`
  );
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
