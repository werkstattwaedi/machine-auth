// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Erasure engine (ADR-0038): per-subject deletion across every collection
 * in the subject-data map, DSG Art. 32.
 *
 * Phases, tracked in the PII-free receipt `erasures/{subjectId}`
 * (subjectId = uid, or HMAC(email) for email-only walk-ins):
 *
 *   blockers → flush → delete → auth → audit → done
 *
 * - Blockers (open checkout, unpaid bill, active owned membership, person
 *   in an open checkout) refuse with the full list and ZERO writes.
 * - Flush-before-delete pushes the subject's not-yet-exported closed
 *   checkouts / usages / paid bills through the production row builders
 *   into the stats sink, so statistics never lose data (ADR-0039).
 * - Deletions cover subject-owned docs; persons[] appearances in OTHER
 *   owners' checkouts are redacted in place; the tag UID on badge items
 *   (items.tokenId) is nulled. Tokens are deleted in one WriteBatch with
 *   the users doc (a token pointing at a missing user hard-rejects
 *   badge-in).
 * - Audit purge phase B removes audit_log entries by (collection, docId)
 *   for every deleted or redacted audited doc — including the fresh
 *   before-snapshots fired by the erasure's own writes. Trigger delivery
 *   is async, so a completed erasure can be re-run: phase B executes
 *   again and reports what it caught (the CLI waits ~60s and re-runs).
 *
 * Re-runs are idempotent: queries simply find fewer docs, and the receipt
 * accumulates paths via arrayUnion so purge coverage survives crashes.
 */

import * as logger from "firebase-functions/logger";
import {
  DocumentReference,
  FieldPath,
  FieldValue,
  Firestore,
  QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { statsSubjectSalt, subjectKey } from "./subject_key";
import { normalizeEmail, resolveSubject, type Subject } from "./subject";
import { findBlockers, type Blocker } from "./blockers";
import { moveInvoicePdfToArchive } from "./archive";
import {
  insertBillRows,
  insertCheckoutRows,
  insertUsageRows,
  statsDataset,
  type MemberCache,
  type StatsExportDeps,
} from "../stats/export_job";
import { CountingSink, makeBigQuerySink, type StatsSink } from "../stats/sink";
import { getStreamState, isUnexported } from "../stats/watermark";
import { logOperationInfo } from "../operations_log";
import type {
  CheckoutEntity,
  CheckoutPersonEntity,
  MembershipEntity,
} from "../types/firestore_entities";
import type { BillEntity } from "../invoice/types";

const IN_CHUNK = 30; // Firestore `in` operator limit
const BATCH_LIMIT = 400;
const SCAN_PAGE = 500;

export interface EraseDeps {
  db: Firestore;
  auth: Auth;
  salt: string;
  sink: StatsSink;
  actorUid: string;
}

export interface EraseOutcome {
  subjectId: string;
  kind: "registered" | "walk-in";
  dryRun: boolean;
  /** Non-empty ⇒ nothing was done. */
  blockers: Blocker[];
  /** Docs deleted/redacted per collection (would-be counts for dryRun). */
  counts: Record<string, number>;
  /** Human-readable action list (dry-run planning aid). */
  actions: string[];
  auditPurged: number;
  /** True when this call only re-ran the audit purge of a completed erasure. */
  rerunOnly: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function batchedDelete(
  db: Firestore,
  refs: DocumentReference[]
): Promise<void> {
  for (const part of chunk(refs, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const ref of part) batch.delete(ref);
    await batch.commit();
  }
}

/** Redacted persons[] entry: identity gone, stats dimensions kept. */
function redactPerson(p: CheckoutPersonEntity): CheckoutPersonEntity {
  const redacted: CheckoutPersonEntity = {
    name: "",
    email: "",
    userType: p.userType,
    userRef: null,
  };
  if (p.entryFeeWaivedToday !== undefined) {
    redacted.entryFeeWaivedToday = p.entryFeeWaivedToday;
  }
  return redacted;
}

function personMatches(
  p: CheckoutPersonEntity,
  subject: Subject
): boolean {
  if (subject.uid && p.userRef?.id === subject.uid) return true;
  if (subject.email && p.email && normalizeEmail(p.email) === subject.email) {
    return true;
  }
  return false;
}

/**
 * Phase B: delete audit_log entries for the given audited-doc paths.
 * Paths are `collection/docId`; grouped per collection, docId-in chunks.
 */
export async function purgeAuditEntries(
  db: Firestore,
  paths: string[]
): Promise<number> {
  const byCollection = new Map<string, string[]>();
  for (const path of paths) {
    const [collection, docId] = path.split("/");
    if (!collection || !docId) continue;
    const ids = byCollection.get(collection) ?? [];
    ids.push(docId);
    byCollection.set(collection, ids);
  }
  let purged = 0;
  for (const [collection, ids] of byCollection) {
    for (const idChunk of chunk([...new Set(ids)], IN_CHUNK)) {
      const snap = await db
        .collection("audit_log")
        .where("collection", "==", collection)
        .where("docId", "in", idChunk)
        .get();
      await batchedDelete(db, snap.docs.map((d) => d.ref));
      purged += snap.size;
    }
  }
  return purged;
}

interface EngineState {
  counts: Record<string, number>;
  actions: string[];
  /** `collection/docId` of audited docs whose audit entries must go. */
  auditPurgePaths: string[];
  deletedPaths: string[];
}

function record(
  state: EngineState,
  collection: string,
  n: number,
  action: string
): void {
  if (n === 0) return;
  state.counts[collection] = (state.counts[collection] ?? 0) + n;
  state.actions.push(action);
}

/** Owned checkouts: by billing user AND by creating principal, deduped. */
async function ownedCheckouts(
  db: Firestore,
  subject: Subject
): Promise<QueryDocumentSnapshot[]> {
  const seen = new Set<string>();
  const docs: QueryDocumentSnapshot[] = [];
  const queries = [];
  if (subject.userRef) {
    queries.push(
      db.collection("checkouts").where("userId", "==", subject.userRef).get()
    );
  }
  if (subject.uid) {
    queries.push(
      db.collection("checkouts").where("firebaseUid", "==", subject.uid).get()
    );
  }
  for (const snap of await Promise.all(queries)) {
    for (const doc of snap.docs) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        docs.push(doc);
      }
    }
  }
  return docs;
}

export async function eraseSubject(
  input: { uid?: string; email?: string },
  deps: EraseDeps,
  opts: { dryRun?: boolean } = {}
): Promise<EraseOutcome> {
  const dryRun = opts.dryRun ?? false;
  const subject = await resolveSubject(deps.db, deps.auth, input);
  const subjectId = subject.uid ?? subjectKey(deps.salt, subject.email);
  if (!subjectId) {
    throw new HttpsError("invalid-argument", "Subject has neither uid nor email");
  }

  const receiptRef = deps.db.collection("erasures").doc(subjectId);
  const receiptSnap = await receiptRef.get();
  const receiptPhase = receiptSnap.get("phase") as string | undefined;

  // Completed erasure re-run: only phase B again (async-trigger race fix).
  if (!dryRun && receiptPhase === "done") {
    const paths = (receiptSnap.get("auditPurgePaths") as string[]) ?? [];
    const purged = await purgeAuditEntries(deps.db, paths);
    await receiptRef.update({
      auditPurged: FieldValue.increment(purged),
      lastPurgeRunAt: Timestamp.now(),
    });
    return {
      subjectId,
      kind: subject.kind,
      dryRun,
      blockers: [],
      counts: {},
      actions: [`audit purge re-run: ${purged} late entries removed`],
      auditPurged: purged,
      rerunOnly: true,
    };
  }

  // Blockers — checked on EVERY run, including resumes: a crashed erasure
  // leaves the badge alive until the token batch near the end, so new
  // business (open checkout, fresh bill) can appear in the gap and must
  // block the resume just like a fresh run. None of the blocker
  // predicates false-positive on partially-erased state (they only match
  // live docs that would have blocked the original run too).
  {
    const blockers = await findBlockers(deps.db, subject);
    if (blockers.length > 0) {
      if (dryRun) {
        return {
          subjectId,
          kind: subject.kind,
          dryRun,
          blockers,
          counts: {},
          actions: [],
          auditPurged: 0,
          rerunOnly: false,
        };
      }
      throw new HttpsError("failed-precondition", "Erasure blocked", {
        blockers,
      });
    }
  }

  const state: EngineState = {
    counts: {},
    actions: [],
    auditPurgePaths: [],
    deletedPaths: [],
  };

  // ---- Collect the subject graph (shared by dryRun and live) ----
  const checkouts = await ownedCheckouts(deps.db, subject);
  const tokens = subject.userRef
    ? (
        await deps.db
          .collection("tokens")
          .where("userId", "==", subject.userRef)
          .get()
      ).docs
    : [];
  const bills = subject.userRef
    ? (
        await deps.db
          .collection("bills")
          .where("userId", "==", subject.userRef)
          .get()
      ).docs
    : [];
  const usages = subject.userRef
    ? (
        await deps.db
          .collection("usage_machine")
          .where("userId", "==", subject.userRef)
          .get()
      ).docs
    : [];
  const memberDocs = subject.userRef
    ? (
        await deps.db
          .collection("memberships")
          .where("members", "array-contains", subject.userRef)
          .get()
      ).docs
    : [];
  const ownedMemberships = subject.userRef
    ? (
        await deps.db
          .collection("memberships")
          .where("ownerUserId", "==", subject.userRef)
          .get()
      ).docs
    : [];
  const invitesByEmail = subject.email
    ? (
        await deps.db
          .collectionGroup("invites")
          .where("email", "==", subject.email)
          .get()
      ).docs
    : [];
  const invitesByInviterAll = subject.userRef
    ? (
        await deps.db
          .collectionGroup("invites")
          .where("invitedBy", "==", subject.userRef)
          .get()
      ).docs
    : [];
  const loginCodes = subject.email
    ? (
        await deps.db
          .collection("loginCodes")
          .where("email", "==", subject.email)
          .get()
      ).docs
    : [];
  const reports = subject.userRef
    ? (
        await deps.db
          .collection("machine_reports")
          .where("userId", "==", subject.userRef)
          .get()
      ).docs
    : [];
  const tokenRefs = tokens.map((t) => t.ref);
  const tokenIds = tokens.map((t) => t.id);
  const authDocs =
    tokenRefs.length > 0
      ? (
          await Promise.all(
            chunk(tokenRefs, IN_CHUNK).map((part) =>
              deps.db
                .collection("authentications")
                .where("tokenId", "in", part)
                .get()
            )
          )
        ).flatMap((s) => s.docs)
      : [];

  // persons[] appearances in checkouts the subject does NOT own (family
  // roster picks, walk-in guests). persons[] is not queryable — bounded
  // paged scan over all checkouts.
  const ownedIds = new Set(checkouts.map((d) => d.id));
  const personRedactions: Array<{
    ref: DocumentReference;
    persons: CheckoutPersonEntity[];
  }> = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    let scan = deps.db
      .collection("checkouts")
      .orderBy("__name__")
      .limit(SCAN_PAGE);
    if (cursor) scan = scan.startAfter(cursor);
    const page = await scan.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      if (ownedIds.has(doc.id)) continue;
      const persons = (doc.data() as CheckoutEntity).persons ?? [];
      if (!persons.some((p) => personMatches(p, subject))) continue;
      personRedactions.push({
        ref: doc.ref,
        persons: persons.map((p) =>
          personMatches(p, subject) ? redactPerson(p) : p
        ),
      });
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < SCAN_PAGE) break;
  }

  // Badge purchase items in other owners' checkouts carrying the deleted
  // tag UIDs. Collection-group index on items.tokenId exists.
  const badgeItems =
    tokenIds.length > 0
      ? (
          await Promise.all(
            chunk(tokenIds, IN_CHUNK).map((part) =>
              deps.db.collectionGroup("items").where("tokenId", "in", part).get()
            )
          )
        ).flatMap((s) => s.docs)
      : [];

  // Renewal guard (belt-and-braces — an unpaid pending bill is a blocker
  // already): never delete a bill referenced by pendingRenewalBill.
  const pendingBillIds = new Set(
    (subject.userRef
      ? await Promise.all(
          bills.map(async (bill) => {
            const refs = await deps.db
              .collection("memberships")
              .where("pendingRenewalBill", "==", bill.ref)
              .limit(1)
              .get();
            return refs.empty ? null : bill.id;
          })
        )
      : []
    ).filter((id): id is string => id !== null)
  );
  const deletableBills = bills.filter((b) => !pendingBillIds.has(b.id));

  const memberOnly = memberDocs.filter(
    (d) => (d.data() as MembershipEntity).ownerUserId?.id !== subject.uid
  );
  const erasableOwnedMemberships = ownedMemberships.filter(
    (d) => (d.data() as MembershipEntity).status !== "active"
  );
  // Invites living under a membership we recursiveDelete below vanish with
  // it — updating them afterwards would NOT_FOUND.
  const deletedMembershipPaths = erasableOwnedMemberships.map(
    (d) => `${d.ref.path}/`
  );
  const invitesByInviter = invitesByInviterAll.filter(
    (d) => !deletedMembershipPaths.some((p) => d.ref.path.startsWith(p))
  );

  record(
    state,
    "checkouts",
    checkouts.length,
    `delete ${checkouts.length} owned checkout(s) incl. items`
  );
  record(state, "bills", deletableBills.length, `delete ${deletableBills.length} bill(s); move PDFs to archive`);
  if (pendingBillIds.size > 0) {
    state.actions.push(
      `SKIP ${pendingBillIds.size} bill(s) referenced by pendingRenewalBill`
    );
  }
  record(state, "usage_machine", usages.length, `delete ${usages.length} usage record(s)`);
  record(state, "authentications", authDocs.length, `delete ${authDocs.length} authentication(s)`);
  record(state, "tokens", tokens.length, `delete ${tokens.length} token(s) atomically with the users doc`);
  record(state, "users", subject.userDocExists ? 1 : 0, "delete users doc");
  record(
    state,
    "memberships",
    memberOnly.length + erasableOwnedMemberships.length,
    `memberships: remove from ${memberOnly.length}, delete ${erasableOwnedMemberships.length} expired owned`
  );
  record(state, "memberships/invites", invitesByEmail.length, `delete ${invitesByEmail.length} invite(s) by email`);
  if (invitesByInviter.length > 0) {
    state.actions.push(`null invitedBy on ${invitesByInviter.length} invite(s)`);
  }
  record(state, "loginCodes", loginCodes.length, `delete ${loginCodes.length} login code(s)`);
  record(state, "machine_reports", reports.length, `redact ${reports.length} machine report(s)`);
  record(
    state,
    "checkouts/persons",
    personRedactions.length,
    `redact persons[] entry in ${personRedactions.length} other-owner checkout(s)`
  );
  record(state, "checkouts/items.tokenId", badgeItems.length, `null tokenId on ${badgeItems.length} badge item(s)`);
  if (subject.authUser) {
    state.actions.push(`delete Firebase Auth account ${subject.uid}`);
  }

  if (dryRun) {
    return {
      subjectId,
      kind: subject.kind,
      dryRun,
      blockers: [],
      counts: state.counts,
      actions: state.actions,
      auditPurged: 0,
      rerunOnly: false,
    };
  }

  // ---- Live run ----
  if (!receiptSnap.exists) {
    try {
      // create() (not set) so two concurrent first-time calls can't both
      // believe they own the fresh receipt; the loser proceeds as a
      // resume — every later step is idempotent.
      await receiptRef.create({
        subjectKind: subject.kind,
        startedAt: Timestamp.now(),
        actorUid: deps.actorUid,
        phase: "flush",
        counts: {},
        auditPurgePaths: [],
        auditPurged: 0,
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 6 /* ALREADY_EXISTS */) throw err;
    }
  }

  // Phase: flush unexported docs to the stats sink before deleting them.
  const statsDeps: StatsExportDeps = {
    db: deps.db,
    sink: deps.sink,
    salt: deps.salt,
  };
  const ctx = { exportedAt: new Date().toISOString() };
  const memberCache: MemberCache = new Map();
  const wmVisits = await getStreamState(deps.db, "visits");
  const wmUsage = await getStreamState(deps.db, "machine_usage");
  const wmBills = await getStreamState(deps.db, "bills");
  const flushCheckouts = checkouts.filter((d) => {
    const c = d.data() as CheckoutEntity;
    return c.status === "closed" && isUnexported(c.closedAt, d.id, wmVisits);
  });
  const flushUsages = usages.filter((d) =>
    isUnexported(d.get("endTime") as Timestamp, d.id, wmUsage)
  );
  const flushBills = deletableBills.filter((d) =>
    isUnexported((d.data() as BillEntity).paidAt, d.id, wmBills)
  );
  await insertCheckoutRows(statsDeps, flushCheckouts, ctx, memberCache);
  await insertUsageRows(statsDeps, flushUsages, ctx);
  await insertBillRows(statsDeps, flushBills, ctx);
  await receiptRef.update({ phase: "delete" });

  const unionPurgePaths = async (paths: string[]) => {
    state.auditPurgePaths.push(...paths);
    for (const part of chunk(paths, BATCH_LIMIT)) {
      if (part.length > 0) {
        await receiptRef.update({
          auditPurgePaths: FieldValue.arrayUnion(...part),
        });
      }
    }
  };

  // Owned checkouts (recursiveDelete removes the items subcollection).
  for (const doc of checkouts) {
    await deps.db.recursiveDelete(doc.ref);
  }
  await unionPurgePaths(checkouts.map((d) => `checkouts/${d.id}`));

  // Bills: PDF to escrow first, then delete the doc.
  for (const doc of deletableBills) {
    const bill = doc.data() as BillEntity;
    if (bill.storagePath) {
      await moveInvoicePdfToArchive(
        bill.storagePath,
        (bill.paidAt ?? bill.created).toDate()
      );
    }
  }
  await batchedDelete(deps.db, deletableBills.map((d) => d.ref));
  await unionPurgePaths(deletableBills.map((d) => `bills/${d.id}`));

  await batchedDelete(deps.db, usages.map((d) => d.ref));
  await unionPurgePaths(usages.map((d) => `usage_machine/${d.id}`));

  await batchedDelete(deps.db, authDocs.map((d) => d.ref));

  for (const doc of erasableOwnedMemberships) {
    await deps.db.recursiveDelete(doc.ref);
  }
  for (const doc of memberOnly) {
    await doc.ref.update({ members: FieldValue.arrayRemove(subject.userRef) });
  }
  await batchedDelete(deps.db, invitesByEmail.map((d) => d.ref));
  for (const part of chunk(invitesByInviter, BATCH_LIMIT)) {
    const batch = deps.db.batch();
    for (const doc of part) batch.update(doc.ref, { invitedBy: null });
    await batch.commit();
  }
  await batchedDelete(deps.db, loginCodes.map((d) => d.ref));
  for (const part of chunk(reports, BATCH_LIMIT)) {
    const batch = deps.db.batch();
    for (const doc of part) {
      batch.update(doc.ref, { userId: null, reporterName: null });
    }
    await batch.commit();
  }
  for (const part of chunk(personRedactions, BATCH_LIMIT)) {
    const batch = deps.db.batch();
    for (const r of part) batch.update(r.ref, { persons: r.persons });
    await batch.commit();
  }
  // Redacted checkouts keep living, but their audit history (and the
  // update entries this redaction just fired) contains the old persons[].
  await unionPurgePaths(
    personRedactions.map((r) => `checkouts/${r.ref.id}`)
  );
  for (const part of chunk(badgeItems, BATCH_LIMIT)) {
    const batch = deps.db.batch();
    for (const doc of part) {
      batch.update(doc.ref, { tokenId: null, badgeSdmCounter: null });
    }
    await batch.commit();
  }

  // Tokens + users doc in ONE batch (invariant: never a token without its
  // user — a dangling token hard-rejects badge-in but must not linger).
  {
    const batch = deps.db.batch();
    for (const ref of tokenRefs) batch.delete(ref);
    if (subject.userRef && subject.userDocExists) {
      batch.delete(subject.userRef);
    }
    await batch.commit();
  }
  await unionPurgePaths([
    ...tokenIds.map((id) => `tokens/${id}`),
    ...(subject.userDocExists ? [`users/${subject.uid}`] : []),
  ]);

  // Accumulate (never overwrite) so a crash-and-resume keeps the earlier
  // attempts' tallies. Planned-set counting means a crash mid-delete can
  // overcount slightly on resume; the receipt documents work attempted,
  // deletion itself stays exactly idempotent. FieldPath segments because
  // keys like "memberships/invites" aren't valid dotted paths.
  const countIncrements: unknown[] = [];
  for (const [key, n] of Object.entries(state.counts)) {
    countIncrements.push(new FieldPath("counts", key), FieldValue.increment(n));
  }
  await receiptRef.update("phase", "auth", ...countIncrements);

  if (subject.uid) {
    try {
      await deps.auth.deleteUser(subject.uid);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "auth/user-not-found") throw err;
    }
  }
  await receiptRef.update({ phase: "audit" });

  // Phase B — audit purge over everything recorded (incl. prior attempts).
  const allPaths = [
    ...new Set([
      ...(((await receiptRef.get()).get("auditPurgePaths") as string[]) ?? []),
      ...state.auditPurgePaths,
    ]),
  ];
  const purged = await purgeAuditEntries(deps.db, allPaths);
  await receiptRef.update({
    phase: "done",
    completedAt: Timestamp.now(),
    auditPurged: FieldValue.increment(purged),
    lastPurgeRunAt: Timestamp.now(),
  });

  logger.info("privacy erase completed", {
    subjectId,
    counts: state.counts,
    auditPurged: purged,
  });
  await logOperationInfo(
    "erasures",
    subjectId,
    "privacy_erase",
    `by ${deps.actorUid}: ${JSON.stringify(state.counts)}, auditPurged=${purged}`
  );

  return {
    subjectId,
    kind: subject.kind,
    dryRun,
    blockers: [],
    counts: state.counts,
    actions: state.actions,
    auditPurged: purged,
    rerunOnly: false,
  };
}

/**
 * `authCall/privacyErase` — admin-only. `confirmEmail` must repeat the
 * subject's email (typo guard for an irreversible action); waived on
 * re-runs of a completed erasure where the account no longer has one.
 */
export async function privacyEraseHandler(
  request: CallableRequest<{
    uid?: string;
    email?: string;
    confirmEmail?: string;
    dryRun?: boolean;
  }>
): Promise<EraseOutcome> {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const { uid, email, confirmEmail, dryRun } = request.data ?? {};

  const db = getFirestore();
  const auth = getAuth();
  const salt = statsSubjectSalt.value();
  const subject = await resolveSubject(db, auth, { uid, email });

  if (!dryRun) {
    const confirmed = confirmEmail ? normalizeEmail(confirmEmail) : null;
    if (subject.email && confirmed !== subject.email) {
      throw new HttpsError(
        "invalid-argument",
        "confirmEmail does not match the subject's email"
      );
    }
  }

  // No BigQuery emulator: emulator flushes go to a counting sink so dev
  // and integration flows never touch a real dataset.
  const emulated =
    process.env.FUNCTIONS_EMULATOR === "true" ||
    !!process.env.FIRESTORE_EMULATOR_HOST;
  const sink = emulated
    ? new CountingSink()
    : await makeBigQuerySink(statsDataset.value() || "stats");

  return eraseSubject(
    { uid, email },
    { db, auth, salt, sink, actorUid: request.auth.uid },
    { dryRun: dryRun ?? false }
  );
}
