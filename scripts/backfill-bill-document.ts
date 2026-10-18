#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot backfill (ADR-0052): give every bill minted before it the two
 * stored facts that replace the legacy `kind` — its committed
 * `paymentMethod` and its `document` — derived exactly as the readers'
 * fallback does today (`billPaymentMethodOf` / `billDocumentOf` in
 * shared/src/bill-document.ts), so nothing a customer sees changes: a TWINT
 * bill keeps its Quittung `RE-` number (BIL-46), a CHF 0 bill stays a
 * Rechnung.
 *
 * The legacy method lives on the bill's first checkout and counts only for a
 * committed bill (ack stamp, or `kind: "beleg"`); an unconfirmed bill gets
 * `paymentMethod: null` and `document: "rechnung"`, and its commit sets both.
 *
 * Idempotent — bills that already carry `document` are skipped, so a re-run
 * that finds nothing writes nothing. `modifiedAt` / `modifiedBy` stay
 * untouched (not a user edit). Each write also fires `auditBills` (one
 * audit_log doc) and `onBillUpdate` (a no-op: no `kind` or ack transition),
 * so a run costs ~2 writes and ~2 reads per bill.
 *
 * Ends with the gate the follow-up PR (monthly run on `paymentMethod`)
 * depends on: no bill without `document`, and every `kind: "beleg"` bill on
 * an aggregated method. Exit code 3 while the gate fails (after a real run).
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/backfill-bill-document.ts
 *
 *   # Staging / production (dry-run first)
 *   FIREBASE_PROJECT_ID=oww-maco-staging GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/backfill-bill-document.ts --prod --dry-run
 *   FIREBASE_PROJECT_ID=oww-maco-staging GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/backfill-bill-document.ts --prod
 */

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  billDocumentOf,
  billPaymentMethodOf,
  isCollectedBeleg,
  type BillDocumentFields,
} from "../shared/src/bill-document";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PROD_MODE = argv.includes("--prod");
const DRY_RUN = argv.includes("--dry-run");
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

const PAGE = 400; // Firestore batch limit is 500

interface LegacyBill extends BillDocumentFields {
  checkouts?: FirebaseFirestore.DocumentReference[];
  paymentMethodConfirmationTime?: unknown;
}

/** The fields a pre-ADR-0052 bill gets; exported for the integration test. */
export function backfillFields(
  bill: LegacyBill,
  firstCheckoutMethod: unknown,
): Pick<Required<BillDocumentFields>, "paymentMethod" | "document"> {
  const committed = !!bill.paymentMethodConfirmationTime || isCollectedBeleg(bill);
  // An unconfirmed checkout's method is only the tab last tapped.
  const legacyMethod = committed ? firstCheckoutMethod : null;
  return {
    paymentMethod: billPaymentMethodOf(bill, legacyMethod),
    document: billDocumentOf(bill, legacyMethod),
  };
}

async function main() {
  const admin = await import("firebase-admin");

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID not set");
  }

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const targetingProd = !emulatorHost;
  if (targetingProd && !PROD_MODE) {
    throw new Error(
      "Refusing to write to production without --prod flag. " +
        "Either set FIRESTORE_EMULATOR_HOST or pass --prod explicitly.",
    );
  }

  console.log(
    `Project: ${projectId}, Target: ${emulatorHost ?? "PRODUCTION"}, Dry-run: ${DRY_RUN}`,
  );

  if (!admin.apps.length) {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (emulatorHost) {
      admin.initializeApp({ projectId });
    } else if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      console.log(`Using service account: ${serviceAccountPath}`);
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
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
  const counts = new Map<string, number>();
  let scanned = 0;
  let written = 0;
  let missingDocument = 0;
  let belegOffQueue = 0;

  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let query = db.collection("bills").orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1];
    scanned += snap.size;

    const todo = snap.docs.filter((d) => !(d.data() as LegacyBill).document);
    const firstCheckouts = todo
      .map((d) => (d.data() as LegacyBill).checkouts?.[0])
      .filter((ref): ref is FirebaseFirestore.DocumentReference => !!ref);
    const checkoutSnaps = firstCheckouts.length ? await db.getAll(...firstCheckouts) : [];
    const methodByPath = new Map(
      checkoutSnaps.map((s) => [s.ref.path, s.data()?.paymentMethod ?? null]),
    );

    const batch = db.batch();
    for (const doc of snap.docs) {
      const bill = doc.data() as LegacyBill;
      let after: LegacyBill = bill;
      if (!bill.document) {
        const method = methodByPath.get(bill.checkouts?.[0]?.path ?? "") ?? null;
        const fields = backfillFields(bill, method);
        const key = `kind=${bill.kind ?? "-"} → document=${fields.document} paymentMethod=${fields.paymentMethod ?? "null"}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        after = { ...bill, ...fields };
        if (!DRY_RUN) batch.update(doc.ref, fields);
        written++;
      }
      if (!after.document) missingDocument++;
      if ((after.kind ?? "invoice") === "beleg" && !isCollectedBeleg(after)) belegOffQueue++;
    }
    if (!DRY_RUN && todo.length) await batch.commit();
    console.log(`  scanned ${scanned}, ${DRY_RUN ? "would write" : "wrote"} ${written}`);
  }

  console.log(`\nBills scanned: ${scanned}; ${DRY_RUN ? "to backfill" : "backfilled"}: ${written}`);
  for (const [key, n] of [...counts.entries()].sort()) console.log(`  ${n.toString().padStart(6)}  ${key}`);

  // In a dry run the gate shows the state the run would leave behind.
  console.log(
    `\nGate: bills without document: ${missingDocument}; ` +
      `kind "beleg" not on an aggregated method: ${belegOffQueue}`,
  );
  const gateOk = missingDocument === 0 && belegOffQueue === 0;
  console.log(gateOk ? "Gate passes." : "Gate FAILS.");
  console.log(DRY_RUN ? "Dry-run: no writes performed." : "Done.");
  if (!DRY_RUN && !gateOk) process.exit(3);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
}
