// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * DSAR access report (DSG Art. 25, ADR-0038) — `authCall/privacyReport`.
 *
 * Collects every doc the subject-data map attributes to a subject and
 * serializes it with the audit-trigger convention (refs → paths,
 * Timestamps → ISO). Appearances inside OTHER people's checkouts return
 * only the subject's own persons[] entry plus the checkout id/date —
 * never the other visitors' data.
 *
 * audit_log entries mirror the business docs 1:1, so the report carries
 * per-collection counts instead of duplicating potentially thousands of
 * before/after copies; the full JSON stays well under the 10MB callable
 * response limit.
 */

import { Timestamp, getFirestore } from "firebase-admin/firestore";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { serializeValue } from "../audit/audit-trigger";
import { resolveSubject, type Subject } from "./subject";
import { SUBJECT_DATA_MAP } from "./subject_data_map";
import { logOperationInfo } from "../operations_log";
import type {
  CheckoutEntity,
  CheckoutPersonEntity,
} from "../types/firestore_entities";

const IN_CHUNK = 30;
const SCAN_PAGE = 500;

/** Processor disclosure — mirrored in docs/data-protection.md. */
export const PROCESSORS = [
  {
    name: "Google Cloud / Firebase (europe-west6, Zürich)",
    role: "Hosting, Firestore, Auth, Storage, BigQuery statistics",
    notes:
      "Cloud Logging retains function logs ~30 days; phone-auth SMS are " +
      "routed through Google's SMS providers.",
  },
  {
    name: "Resend",
    role: "Transactional email (invoices, login codes, invites)",
    notes: "Email metadata/content per Resend's retention; manual deletion on request.",
  },
];

export const STATISTICS_DISCLOSURE =
  "Pseudonymized visit/usage/billing statistics are retained in BigQuery " +
  "under an HMAC subject key (DSG Art. 31(2)(e)). The rows carry no name, " +
  "email, or tag UID and survive erasure; destroying the HMAC salt " +
  "irreversibly anonymizes all of them (ADR-0039).";

export const RESIDUALS_DISCLOSURE = [
  "Firestore backups/PITR retain deleted docs for up to 7 days after erasure.",
  "Invoice PDFs are retained 10 years in a locked archive bucket (OR Art. 958f), readable only via break-glass access.",
  "operations_log / machine_reports free-text may embed self-disclosed data until the 3-year trim.",
  "Resend and Cloud Logging retention windows apply until their own expiry or manual deletion.",
];

function serializeDocs(
  docs: QueryDocumentSnapshot[]
): Array<Record<string, unknown>> {
  return docs.map((d) => ({
    id: d.id,
    ...(serializeValue(d.data()) as Record<string, unknown>),
  }));
}

async function auditCount(
  db: Firestore,
  collection: string,
  docIds: string[]
): Promise<number> {
  let total = 0;
  for (let i = 0; i < docIds.length; i += IN_CHUNK) {
    const part = docIds.slice(i, i + IN_CHUNK);
    const agg = await db
      .collection("audit_log")
      .where("collection", "==", collection)
      .where("docId", "in", part)
      .count()
      .get();
    total += agg.data().count;
  }
  return total;
}

function personMatches(p: CheckoutPersonEntity, subject: Subject): boolean {
  if (subject.uid && p.userRef?.id === subject.uid) return true;
  if (subject.email && p.email && p.email.toLowerCase() === subject.email) {
    return true;
  }
  return false;
}

export async function buildPrivacyReport(
  input: { uid?: string; email?: string },
  deps: { db: Firestore; auth: Auth }
): Promise<Record<string, unknown>> {
  const { db, auth } = deps;
  const subject = await resolveSubject(db, auth, input);

  const [byUser, byPrincipal] = await Promise.all([
    subject.userRef
      ? db.collection("checkouts").where("userId", "==", subject.userRef).get()
      : null,
    subject.uid
      ? db.collection("checkouts").where("firebaseUid", "==", subject.uid).get()
      : null,
  ]);
  const ownedSeen = new Set<string>();
  const ownedCheckouts: QueryDocumentSnapshot[] = [];
  for (const doc of [...(byUser?.docs ?? []), ...(byPrincipal?.docs ?? [])]) {
    if (!ownedSeen.has(doc.id)) {
      ownedSeen.add(doc.id);
      ownedCheckouts.push(doc);
    }
  }
  const checkoutsWithItems = await Promise.all(
    ownedCheckouts.map(async (doc) => ({
      id: doc.id,
      ...(serializeValue(doc.data()) as Record<string, unknown>),
      items: serializeDocs((await doc.ref.collection("items").get()).docs),
    }))
  );

  // Appearances in other owners' checkouts: subject's entry only.
  const appearances: Array<Record<string, unknown>> = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    let scan = db.collection("checkouts").orderBy("__name__").limit(SCAN_PAGE);
    if (cursor) scan = scan.startAfter(cursor);
    const page = await scan.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      if (ownedSeen.has(doc.id)) continue;
      const checkout = doc.data() as CheckoutEntity;
      for (const p of checkout.persons ?? []) {
        if (personMatches(p, subject)) {
          appearances.push({
            checkoutId: doc.id,
            status: checkout.status,
            closedAt: serializeValue(checkout.closedAt ?? null),
            entry: serializeValue(p),
          });
        }
      }
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < SCAN_PAGE) break;
  }

  const [tokens, bills, usages, memberships, invites, loginCodes, reports] =
    await Promise.all([
      subject.userRef
        ? db.collection("tokens").where("userId", "==", subject.userRef).get()
        : null,
      subject.userRef
        ? db.collection("bills").where("userId", "==", subject.userRef).get()
        : null,
      subject.userRef
        ? db
            .collection("usage_machine")
            .where("userId", "==", subject.userRef)
            .get()
        : null,
      subject.userRef
        ? db
            .collection("memberships")
            .where("members", "array-contains", subject.userRef)
            .get()
        : null,
      subject.email
        ? db.collectionGroup("invites").where("email", "==", subject.email).get()
        : null,
      subject.email
        ? db.collection("loginCodes").where("email", "==", subject.email).get()
        : null,
      subject.userRef
        ? db
            .collection("machine_reports")
            .where("userId", "==", subject.userRef)
            .get()
        : null,
    ]);

  const auditCounts: Record<string, number> = {};
  if (subject.uid) {
    auditCounts.users = await auditCount(db, "users", [subject.uid]);
    auditCounts.tokens = await auditCount(
      db,
      "tokens",
      (tokens?.docs ?? []).map((d) => d.id)
    );
    auditCounts.checkouts = await auditCount(db, "checkouts", [
      ...ownedSeen,
      ...appearances.map((a) => a.checkoutId as string),
    ]);
    auditCounts.bills = await auditCount(
      db,
      "bills",
      (bills?.docs ?? []).map((d) => d.id)
    );
    auditCounts.usage_machine = await auditCount(
      db,
      "usage_machine",
      (usages?.docs ?? []).map((d) => d.id)
    );
  }

  const userDoc = subject.userRef ? await subject.userRef.get() : null;

  return {
    generatedAt: new Date().toISOString(),
    subject: {
      kind: subject.kind,
      uid: subject.uid,
      email: subject.email,
    },
    authAccount: subject.authUser
      ? {
          uid: subject.authUser.uid,
          email: subject.authUser.email ?? null,
          emailVerified: subject.authUser.emailVerified,
          displayName: subject.authUser.displayName ?? null,
          phoneNumber: subject.authUser.phoneNumber ?? null,
          disabled: subject.authUser.disabled,
          created: subject.authUser.metadata.creationTime,
          lastSignIn: subject.authUser.metadata.lastSignInTime ?? null,
          customClaims: subject.authUser.customClaims ?? {},
          providers: subject.authUser.providerData.map((p) => p.providerId),
        }
      : null,
    user:
      userDoc?.exists === true
        ? { id: userDoc.id, ...(serializeValue(userDoc.data()) as object) }
        : null,
    tokens: serializeDocs(tokens?.docs ?? []),
    checkouts: checkoutsWithItems,
    personsAppearances: appearances,
    bills: serializeDocs(bills?.docs ?? []),
    invoicePdfs: {
      note:
        "Invoice PDFs are retained for 10 years (OR Art. 958f); after the " +
        "3-year operational retention they live in a locked archive bucket.",
      paths: (bills?.docs ?? [])
        .map((d) => d.get("storagePath") as string | null)
        .filter((p): p is string => !!p),
    },
    usageMachine: serializeDocs(usages?.docs ?? []),
    memberships: serializeDocs(memberships?.docs ?? []),
    membershipInvites: serializeDocs(invites?.docs ?? []),
    loginCodes: serializeDocs(loginCodes?.docs ?? []),
    machineReports: serializeDocs(reports?.docs ?? []),
    auditLog: {
      note:
        "audit_log holds before/after copies of the docs above (3-year " +
        "retention); contents mirror the documents in this report.",
      countsByCollection: auditCounts,
    },
    statistics: STATISTICS_DISCLOSURE,
    processors: PROCESSORS,
    residuals: RESIDUALS_DISCLOSURE,
    processingRegister: SUBJECT_DATA_MAP,
  };
}

export async function privacyReportHandler(
  request: CallableRequest<{ uid?: string; email?: string }>
): Promise<Record<string, unknown>> {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const db = getFirestore();
  const auth = getAuth();
  const report = await buildPrivacyReport(request.data ?? {}, { db, auth });
  const subject = report.subject as { uid: string | null; kind: string };
  await logOperationInfo(
    "users",
    subject.uid ?? "walk-in",
    "privacy_report",
    `DSAR report generated by ${request.auth.uid} (${subject.kind}) at ${Timestamp.now().toDate().toISOString()}`
  );
  return report;
}
