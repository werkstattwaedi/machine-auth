#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot migration (#843): `users.permissions` from a list of refs to the
 * grant map (`shared/src/permission-grants.ts`). Each ref becomes
 * `{ permission, source: "legacy", grantedAt, grantedBy }`; when and by whom
 * are taken from the audit log (`audit_log`, collection "users": the last
 * write that added the permission, with its `actorUid`) and stay null where
 * the log doesn't reach back (retention trim, imports before the trigger).
 *
 * Idempotent — docs whose `permissions` is already a map are skipped; a doc
 * written meanwhile (a callable grant converts it itself) is left alone. Writes
 * leave `modifiedAt`/`modifiedBy` alone (not a user edit); each write also
 * fires `auditUsers` (one audit_log doc). Prints counts and uids only.
 *
 * Run it right after the deploy that reads both shapes and after
 * `scripts/deploy/set-min-client-version.ts` (docs/deploy step). Ends with
 * the gate: no users doc left with a list. Exit code 3 while it fails (after
 * a real run).
 *
 * Usage:
 *   # Emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=oww-maco \
 *     npx tsx scripts/migrate-permission-grants.ts
 *
 *   # Staging / production (ADC; dry-run first)
 *   FIREBASE_PROJECT_ID=oww-maco-staging npx tsx scripts/migrate-permission-grants.ts --prod --dry-run
 *   FIREBASE_PROJECT_ID=oww-maco-staging npx tsx scripts/migrate-permission-grants.ts --prod
 */

import * as path from "path";
import { fileURLToPath } from "url";

const argv = process.argv.slice(2);
const PROD_MODE = argv.includes("--prod");
const DRY_RUN = argv.includes("--dry-run");

const PAGE = 400 // users read per page

/** An `audit_log` entry for a users doc, as the audit trigger stores it (refs as paths). */
export interface UserAuditEntry {
  timestamp: { toMillis(): number }
  actorUid: string | null
  before: { permissions?: unknown } | null
  after: { permissions?: unknown } | null
}

function holds(doc: { permissions?: unknown } | null, permissionPath: string): boolean {
  const p = doc?.permissions
  if (Array.isArray(p)) return p.includes(permissionPath)
  // Grant maps serialize with `permission` as a path.
  if (p && typeof p === "object") {
    return Object.values(p as Record<string, { permission?: unknown }>).some(
      (g) => g?.permission === permissionPath,
    )
  }
  return false
}

/**
 * When and by whom a permission was last granted: the latest audit entry in
 * which the doc goes from not holding it to holding it. null if the log has
 * no such entry.
 */
export function lastGrantFromAudit(
  entries: readonly UserAuditEntry[],
  permissionPath: string,
): { atMs: number; actorUid: string | null } | null {
  let found: { atMs: number; actorUid: string | null } | null = null
  for (const e of [...entries].sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())) {
    if (!holds(e.before, permissionPath) && holds(e.after, permissionPath)) {
      found = { atMs: e.timestamp.toMillis(), actorUid: e.actorUid ?? null }
    }
  }
  return found
}

async function main() {
  const admin = await import("firebase-admin")

  const projectId = process.env.FIREBASE_PROJECT_ID
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID not set")
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
  if (!emulatorHost && !PROD_MODE) {
    throw new Error(
      "Refusing to write to a real project without --prod. " +
        "Either set FIRESTORE_EMULATOR_HOST or pass --prod explicitly.",
    )
  }
  console.log(`Project: ${projectId}, Target: ${emulatorHost ?? "REAL PROJECT"}, Dry-run: ${DRY_RUN}`)
  if (!admin.apps.length) admin.initializeApp({ projectId })

  const db = admin.firestore()
  const { Timestamp } = admin.firestore

  let scanned = 0
  let migrated = 0
  let changedMeanwhile = 0
  let grants = 0
  let dated = 0
  let listsLeft = 0

  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let query = db.collection("users").orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE)
    if (last) query = query.startAfter(last)
    const snap = await query.get()
    if (snap.empty) break
    last = snap.docs[snap.docs.length - 1]
    scanned += snap.size

    for (const doc of snap.docs) {
      const stored = doc.get("permissions")
      if (!Array.isArray(stored)) continue
      const refs = stored as FirebaseFirestore.DocumentReference[]

      // Equality filters only: served by single-field indexes.
      const audit = refs.length
        ? (
            await db
              .collection("audit_log")
              .where("collection", "==", "users")
              .where("docId", "==", doc.id)
              .get()
          ).docs.map((d) => d.data() as UserAuditEntry)
        : []

      const map: Record<string, unknown> = {}
      for (const ref of refs) {
        const from = lastGrantFromAudit(audit, ref.path)
        if (from) dated++
        map[ref.id] = {
          permission: ref,
          grantedAt: from ? Timestamp.fromMillis(from.atMs) : null,
          grantedBy: from?.actorUid ? db.collection("users").doc(from.actorUid) : null,
          source: "legacy",
        }
        grants++
      }
      if (DRY_RUN) {
        migrated++
        continue
      }
      // Only if the doc is unchanged since it was read: grantPermission /
      // revokePermission are live during the step and convert the list
      // themselves — overwriting their map with one built from the stale
      // list would lose that grant.
      try {
        await doc.ref.update({ permissions: map }, { lastUpdateTime: doc.updateTime })
        migrated++
      } catch (err) {
        if ((err as { code?: number }).code !== 9) throw err // 9 = FAILED_PRECONDITION
        changedMeanwhile++
        console.log(`  changed meanwhile, left for a re-run: users/${doc.id}`)
      }
    }
    console.log(`  scanned ${scanned}, ${DRY_RUN ? "would migrate" : "migrated"} ${migrated}`)
  }

  if (!DRY_RUN) {
    // Gate: re-scan for lists (cheap at this size, and catches a doc a
    // client wrote with the old shape during the run).
    let after: FirebaseFirestore.QueryDocumentSnapshot | null = null
    for (;;) {
      let query = db.collection("users").orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE)
      if (after) query = query.startAfter(after)
      const snap = await query.get()
      if (snap.empty) break
      after = snap.docs[snap.docs.length - 1]
      for (const doc of snap.docs) {
        if (Array.isArray(doc.get("permissions"))) {
          listsLeft++
          console.log(`  still a list: users/${doc.id}`)
        }
      }
    }
  }

  console.log(
    `\nUsers scanned: ${scanned}; ${DRY_RUN ? "to migrate" : "migrated"}: ${migrated} ` +
      `(${grants} grants, ${dated} dated from the audit log, ${grants - dated} without date)` +
      (changedMeanwhile ? `; ${changedMeanwhile} changed meanwhile (re-run to pick them up)` : ""),
  )
  if (DRY_RUN) {
    console.log("Dry-run: no writes performed.")
    return
  }
  console.log(listsLeft === 0 ? "Gate passes: no users doc holds a list." : `Gate FAILS: ${listsLeft} lists left.`)
  if (listsLeft > 0) process.exit(3)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((err) => {
    console.error("Failed:", err)
    process.exit(1)
  })
}
