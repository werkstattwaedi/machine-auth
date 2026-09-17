// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Identity consistency audit (ADR-0043, issue #633): does every users doc
 * have the Auth record it should, and do their e-mail / phone agree?
 *
 * Login and the `syncAuthIdentity` trigger heal a member when they next
 * sign in or their doc next changes; this finds the drift nobody has
 * tripped over yet — and is the backfill for the state that predates the
 * sync. `fix` applies the mechanical repairs (the same `ensureAuthIdentity`
 * login uses) and re-scans; everything it leaves is for a human.
 *
 * Findings carry uids only — never an e-mail or a phone number — so the
 * outcome can be pasted into an issue.
 *
 * Runs through `scripts/privacy-cli.ts audit-identity [--fix]` against the
 * `authCall` dispatcher (admin-only), like the DSAR tooling.
 */

import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { logOperationInfo } from "../operations_log";
import { formatFullName } from "../util/username-utils";
import {
  ensureAuthIdentity,
  identityFromUserDoc,
  isBareAuthRecord,
  normalizeEmail,
  type IdentityDeps,
} from "./identity";

export type IdentityFindingKind =
  /** users doc whose Auth record is gone — login recreates it; so does fix. */
  | "doc-without-auth"
  /** Non-bare Auth record with an e-mail/provider/phone but no users doc. */
  | "auth-without-doc"
  /** Doc-less Auth record with an erasure receipt — `privacy-cli erase` re-run. */
  | "erasure-in-progress"
  /** Leftover of an abandoned code request. Informational; reclaimed on demand. */
  | "bare-auth"
  | "email-mismatch"
  | "email-not-normalized"
  /** Two users docs share an e-mail — login refuses both until merged. */
  | "duplicate-email"
  /** The doc's e-mail is held by ANOTHER Auth uid. */
  | "email-conflict"
  /** Auth-linked (SMS login) number differs from users.phone. */
  | "phone-mismatch"
  /** Disabled Auth record on a doc with an e-mail: a manual block, or a
   *  managed-member promotion that never reached Auth (then there is an
   *  email-mismatch next to it, and fixing that enables the record). */
  | "disabled-with-email";

/** Kinds `fix` never acts on — they need a human decision. */
export const REPORT_ONLY_KINDS: ReadonlySet<IdentityFindingKind> = new Set([
  "auth-without-doc",
  "erasure-in-progress",
  "bare-auth",
  "duplicate-email",
  "disabled-with-email",
]);

export interface IdentityFinding {
  kind: IdentityFindingKind;
  uid: string;
  otherUid?: string;
  detail: string;
}

export interface IdentityAuditOutcome {
  generatedAt: string;
  fix: boolean;
  scanned: { usersDocs: number; authRecords: number };
  counts: Partial<Record<IdentityFindingKind, number>>;
  findings: IdentityFinding[];
  /** What `fix` did, one line per action. Empty without `fix`. */
  actions: string[];
  /** Findings of the re-scan after `fix`. Absent without `fix`. */
  residual?: IdentityFinding[];
}

const USERS_PAGE_SIZE = 500;
const AUTH_LIST_PAGE_SIZE = 1000;
/** The synthetic principal `scripts/privacy-cli.ts` signs in as. */
const CLI_UID = "privacy-cli";

interface UserDocInfo {
  data: DocumentData;
  /** Raw stored value. */
  rawEmail: string | null;
  /** As Auth would store it. */
  email: string | null;
  phone: string | null;
}

async function loadUserDocs(
  deps: IdentityDeps
): Promise<Map<string, UserDocInfo>> {
  const docs = new Map<string, UserDocInfo>();
  let query = deps.db
    .collection("users")
    .orderBy("__name__")
    .select("email", "phone", "firstName", "lastName", "roles")
    .limit(USERS_PAGE_SIZE);
  for (;;) {
    const page = await query.get();
    for (const doc of page.docs) {
      const rawEmail = (doc.get("email") as string | null | undefined) || null;
      docs.set(doc.id, {
        data: doc.data(),
        rawEmail,
        email: rawEmail ? normalizeEmail(rawEmail) : null,
        phone: (doc.get("phone") as string | null | undefined) || null,
      });
    }
    if (page.size < USERS_PAGE_SIZE) return docs;
    query = query.startAfter(page.docs[page.docs.length - 1]);
  }
}

async function loadAuthRecords(
  deps: IdentityDeps
): Promise<Map<string, UserRecord>> {
  const records = new Map<string, UserRecord>();
  let pageToken: string | undefined = undefined;
  do {
    const page = await deps.auth.listUsers(AUTH_LIST_PAGE_SIZE, pageToken);
    for (const user of page.users) records.set(user.uid, user);
    pageToken = page.pageToken;
  } while (pageToken);
  return records;
}

/**
 * Principals that are doc-less BY DESIGN: kiosk `tag:` sessions, anonymous
 * checkout sessions, the CLI's own uid. Applied only to the Auth-without-doc
 * side — a managed member's record has the anonymous shape too (no provider,
 * e-mail or phone), and filtering before the join would report every one of
 * them as `doc-without-auth`.
 */
function isDocLessByDesign(user: UserRecord): boolean {
  return (
    user.uid.startsWith("tag:") ||
    user.uid === CLI_UID ||
    (user.providerData.length === 0 && !user.email && !user.phoneNumber)
  );
}

interface ScanResult {
  findings: IdentityFinding[];
  docs: Map<string, UserDocInfo>;
  authRecords: Map<string, UserRecord>;
  /** uids of docs that share their e-mail with another doc. */
  duplicatedUids: Set<string>;
}

async function scan(deps: IdentityDeps): Promise<ScanResult> {
  const [docs, authRecords] = await Promise.all([
    loadUserDocs(deps),
    loadAuthRecords(deps),
  ]);
  const findings: IdentityFinding[] = [];

  const authUidByEmail = new Map<string, string>();
  for (const user of authRecords.values()) {
    if (user.email) authUidByEmail.set(user.email, user.uid);
  }

  const docUidsByEmail = new Map<string, string[]>();
  for (const [uid, doc] of docs) {
    if (!doc.email) continue;
    docUidsByEmail.set(doc.email, [...(docUidsByEmail.get(doc.email) ?? []), uid]);
  }
  const duplicatedUids = new Set<string>();
  for (const uids of docUidsByEmail.values()) {
    if (uids.length < 2) continue;
    for (const uid of uids) duplicatedUids.add(uid);
    findings.push({
      kind: "duplicate-email",
      uid: uids[0],
      otherUid: uids[1],
      detail: `${uids.length} users docs share one e-mail: ${uids.join(", ")}`,
    });
  }

  for (const [uid, doc] of docs) {
    if (doc.rawEmail && doc.rawEmail !== doc.email) {
      findings.push({
        kind: "email-not-normalized",
        uid,
        detail: "users.email is not trimmed + lowercase; the login lookup misses it",
      });
    }

    const holderUid = doc.email ? authUidByEmail.get(doc.email) : undefined;
    const heldByOther = holderUid !== undefined && holderUid !== uid;
    const holderNote = heldByOther
      ? isBareAuthRecord(authRecords.get(holderUid)!) && !docs.has(holderUid)
        ? "held by a bare Auth record (reclaimable)"
        : "held by a non-bare Auth record"
      : "";

    const user = authRecords.get(uid);
    if (!user) {
      findings.push({
        kind: "doc-without-auth",
        uid,
        ...(heldByOther ? { otherUid: holderUid } : {}),
        detail: doc.email
          ? heldByOther
            ? `no Auth record; its e-mail is ${holderNote}`
            : "no Auth record; the member's next login recreates it"
          : "no Auth record for an e-mail-less (managed) member",
      });
      continue;
    }

    if (doc.email && user.email !== doc.email) {
      findings.push(
        heldByOther
          ? {
              kind: "email-conflict",
              uid,
              otherUid: holderUid,
              detail: `users.email is ${holderNote}`,
            }
          : {
              kind: "email-mismatch",
              uid,
              detail: user.email
                ? "Auth e-mail differs from users.email"
                : "Auth has no e-mail, users.email is set (unpromoted managed member?)",
            }
      );
    } else if (!doc.email && user.email) {
      findings.push({
        kind: "email-mismatch",
        uid,
        detail: "Auth has an e-mail, users.email is empty — decide which side is right",
      });
    }

    if (user.phoneNumber && user.phoneNumber !== doc.phone) {
      findings.push({
        kind: "phone-mismatch",
        uid,
        detail: doc.phone
          ? "Auth-linked number differs from users.phone"
          : "Auth has a linked number, users.phone is empty",
      });
    }

    if (user.disabled && doc.email) {
      findings.push({
        kind: "disabled-with-email",
        uid,
        detail: "Auth record is disabled although the doc has a login e-mail",
      });
    }
  }

  for (const user of authRecords.values()) {
    if (docs.has(user.uid) || isDocLessByDesign(user)) continue;
    const receipt = await deps.db.collection("erasures").doc(user.uid).get();
    if (receipt.exists) {
      findings.push({
        kind: "erasure-in-progress",
        uid: user.uid,
        detail: `erasure receipt in phase "${receipt.get("phase") ?? "?"}" — re-run privacy-cli erase`,
      });
    } else if (isBareAuthRecord(user)) {
      findings.push({
        kind: "bare-auth",
        uid: user.uid,
        detail: "abandoned code request; reclaimed when a member needs the e-mail",
      });
    } else {
      findings.push({
        kind: "auth-without-doc",
        uid: user.uid,
        detail: "Auth record with a provider, phone or claims but no users doc",
      });
    }
  }

  return { findings, docs, authRecords, duplicatedUids };
}

async function applyFixes(
  deps: IdentityDeps,
  { findings, docs, duplicatedUids }: ScanResult
): Promise<string[]> {
  const actions: string[] = [];
  // A uid can carry several findings that one ensureAuthIdentity resolves.
  const ensured = new Set<string>();

  for (const finding of findings) {
    if (REPORT_ONLY_KINDS.has(finding.kind)) continue;
    const { uid } = finding;
    const doc = docs.get(uid);
    if (!doc) continue;

    switch (finding.kind) {
      case "email-not-normalized":
        // Normalizing must never be what makes two docs collide for real.
        if (duplicatedUids.has(uid)) {
          actions.push(`${uid}: e-mail NOT normalized — shared with another doc`);
          break;
        }
        await deps.db.collection("users").doc(uid).update({ email: doc.email });
        actions.push(`${uid}: users.email normalized`);
        break;

      case "phone-mismatch":
        await deps.auth.updateUser(uid, { phoneNumber: null });
        actions.push(`${uid}: Auth phone unlinked (member re-verifies)`);
        break;

      case "doc-without-auth":
      case "email-mismatch":
      case "email-conflict": {
        if (ensured.has(uid)) break;
        ensured.add(uid);
        if (!doc.email) {
          if (finding.kind !== "doc-without-auth") break; // Auth-only e-mail: a human decides
          // Managed member: same shape createManagedMember gives them.
          await deps.auth.createUser({
            uid,
            displayName: formatFullName(doc.data) || undefined,
            disabled: true,
          });
          actions.push(`${uid}: managed-member Auth record recreated (disabled)`);
          break;
        }
        const result = await ensureAuthIdentity(
          deps,
          uid,
          identityFromUserDoc(doc.data, doc.email)
        );
        actions.push(`${uid}: ensureAuthIdentity → ${result}`);
        break;
      }
    }
  }
  return actions;
}

function countByKind(
  findings: IdentityFinding[]
): Partial<Record<IdentityFindingKind, number>> {
  const counts: Partial<Record<IdentityFindingKind, number>> = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return counts;
}

export async function runIdentityAudit(
  deps: IdentityDeps,
  options: { fix?: boolean } = {}
): Promise<IdentityAuditOutcome> {
  const fix = options.fix === true;
  const first = await scan(deps);
  const outcome: IdentityAuditOutcome = {
    generatedAt: new Date().toISOString(),
    fix,
    scanned: {
      usersDocs: first.docs.size,
      authRecords: first.authRecords.size,
    },
    counts: countByKind(first.findings),
    findings: first.findings,
    actions: [],
  };
  if (!fix) return outcome;

  outcome.actions = await applyFixes(deps, first);
  outcome.residual = (await scan(deps)).findings;
  return outcome;
}

export async function auditIdentityHandler(
  request: CallableRequest<{ fix?: boolean }>
): Promise<IdentityAuditOutcome> {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const outcome = await runIdentityAudit(
    { auth: getAuth(), db: getFirestore() },
    { fix: request.data?.fix === true }
  );
  await logOperationInfo(
    "users",
    "audit-identity",
    "identity_audit",
    `by ${request.auth.uid}: fix=${outcome.fix} ` +
      `findings=${JSON.stringify(outcome.counts)} actions=${outcome.actions.length}`
  );
  return outcome;
}
