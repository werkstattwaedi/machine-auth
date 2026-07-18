// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Subject-data map — the single source of truth for where personal data
 * lives and what happens to it (ADR-0038).
 *
 * The DSAR report, the erasure engine, the yearly trim, and the processing
 * register in docs/data-protection.md all derive from this map. The
 * coverage unit test asserts every audited collection has an entry, so a
 * new collection cannot ship without a data-protection policy.
 *
 * Semantics of `erasure`:
 *  - "delete"          docs deleted outright (subject-owned)
 *  - "recursiveDelete" incl. subcollections (checkouts/items, memberships/invites)
 *  - "redact"          PII fields cleared in place, doc retained
 *  - "special"         engine-specific handling, described in `notes`
 *  - "none"            collection holds no personal data
 *  - "residual"        PII may remain; documented accepted risk
 *
 * `trim` marks collections covered by the yearly 3-year retention trim;
 * absent means TTL-bounded, identity data (kept until erasure), or no PII.
 */

export interface TrimSpec {
  ageField: string;
  retentionYears: number;
  /** Age fallback when ageField is null (e.g. unpaid bills). */
  fallbackAgeField?: string;
}

export interface SubjectDataEntry {
  collection: string;
  piiFields: string[];
  legalBasis: string;
  retention: string;
  trim?: TrimSpec;
  erasure: "delete" | "recursiveDelete" | "redact" | "special" | "none" | "residual";
  notes?: string;
}

export const RETENTION_YEARS = 3;

export const SUBJECT_DATA_MAP: SubjectDataEntry[] = [
  {
    collection: "users",
    piiFields: ["firstName", "lastName", "email", "billingAddress"],
    legalBasis: "Contract (membership / workshop usage)",
    retention: "Until erasure request",
    erasure: "special",
    notes:
      "Deleted in one batch with the user's tokens (badge-in hard-rejects a " +
      "token pointing at a missing user), then the Firebase Auth account.",
  },
  {
    collection: "tokens",
    piiFields: ["doc id = NFC tag UID", "userId", "label"],
    legalBasis: "Contract (badge access)",
    retention: "Until erasure request",
    erasure: "special",
    notes: "Deleted atomically with the users doc (same WriteBatch).",
  },
  {
    collection: "checkouts",
    piiFields: ["persons[].name", "persons[].email", "persons[].billingAddress", "notes", "firebaseUid"],
    legalBasis: "Contract (billing); DSG Art. 31(2)(e) for derived statistics",
    retention: `${RETENTION_YEARS} years after closedAt`,
    trim: { ageField: "closedAt", retentionYears: RETENTION_YEARS },
    erasure: "special",
    notes:
      "Subject-owned checkouts (by userId ref OR firebaseUid): recursiveDelete " +
      "incl. items. Appearances in OTHER owners' checkouts (persons[] via " +
      "userRef or email — family roster picks, walk-ins): matching entry " +
      "redacted in place; checkout, items, and other persons retained. " +
      "items.tokenId (tag UID) nulled where it references a deleted token.",
  },
  {
    collection: "bills",
    piiFields: ["userId", "referenceNumber (person-linkable)", "storagePath"],
    legalBasis: "Contract (billing); OR Art. 958f for the PDF archive",
    retention: `${RETENTION_YEARS} years after paidAt (unpaid: created); PDF 10 years escrowed`,
    trim: {
      ageField: "paidAt",
      retentionYears: RETENTION_YEARS,
      fallbackAgeField: "created",
    },
    erasure: "special",
    notes:
      "Deleted (not anonymized — an anonymized bill re-links trivially to its " +
      "PDF via amount/referenceNumber). The invoice PDF is moved to the locked " +
      "archive bucket first. Guard: a bill referenced by a non-null " +
      "memberships.pendingRenewalBill is never deleted.",
  },
  {
    collection: "usage_machine",
    piiFields: ["userId"],
    legalBasis: "Contract (machine billing)",
    retention: `${RETENTION_YEARS} years after endTime`,
    trim: { ageField: "endTime", retentionYears: RETENTION_YEARS },
    erasure: "delete",
  },
  {
    collection: "memberships",
    piiFields: ["ownerUserId", "members[]", "notes"],
    legalBasis: "Contract (membership)",
    retention: "Until erasure request (expired) / blocker (active owned)",
    erasure: "special",
    notes:
      "Member (non-owner): arrayRemove from members[]. Expired/cancelled owned: " +
      "recursiveDelete incl. invites. Active owned: erasure blocker — admin " +
      "settles via the existing UI first.",
  },
  {
    collection: "memberships/invites",
    piiFields: ["email", "invitedBy", "resolvedUserId"],
    legalBasis: "Consent (invitation)",
    retention: "TTL 30 days (ttlAt)",
    erasure: "special",
    notes:
      "Deleted where email == subject email (collectionGroup); invitedBy on " +
      "other people's invites set to null.",
  },
  {
    collection: "loginCodes",
    piiFields: ["email"],
    legalBasis: "Contract (authentication)",
    retention: "TTL 5 minutes (expiresAt)",
    erasure: "delete",
    notes: "Deleted by email; near-no-op given the TTL.",
  },
  {
    collection: "authentications",
    piiFields: ["tokenId (links to tag UID)"],
    legalBasis: "Contract (badge authentication)",
    retention: `${RETENTION_YEARS} years after created (in-progress: TTL 5 min)`,
    trim: { ageField: "created", retentionYears: RETENTION_YEARS },
    erasure: "delete",
    notes: "Deleted where tokenId references one of the subject's deleted tokens.",
  },
  {
    collection: "machine_reports",
    piiFields: ["userId", "reporterName", "message (free text)"],
    legalBasis: "Legitimate interest (machine maintenance)",
    retention: "Until resolved + erasure request",
    erasure: "redact",
    notes:
      "userId → null, reporterName cleared. The free-text defect message is " +
      "retained (operational value); self-disclosed PII inside it is a " +
      "documented residual — redact manually on request.",
  },
  {
    collection: "audit_log",
    piiFields: ["before/after full doc copies of the nine audited collections"],
    legalBasis: "Legitimate interest (operational audit)",
    retention: `${RETENTION_YEARS} years after timestamp`,
    trim: { ageField: "timestamp", retentionYears: RETENTION_YEARS },
    erasure: "special",
    notes:
      "Two-phase purge: entries for every deleted or persons-redacted audited " +
      "doc are removed by (collection, docId) — including the fresh " +
      "before-snapshots the erasure's own deletes trigger. Async trigger " +
      "delivery means phase B re-runs after a delay (CLI waits ~60s).",
  },
  {
    collection: "operations_log",
    piiFields: ["message (free text, may embed emails from error payloads)"],
    legalBasis: "Legitimate interest (operational monitoring)",
    retention: `${RETENTION_YEARS} years after timestamp`,
    trim: { ageField: "timestamp", retentionYears: RETENTION_YEARS },
    erasure: "residual",
    notes: "Documented residual; bounded by the yearly trim.",
  },
  {
    collection: "erasures",
    piiFields: ["none (receipt keyed by uid / HMAC(email); paths + counts only)"],
    legalBasis: "Legal obligation (erasure accountability)",
    retention: "Indefinite (proof of erasure)",
    erasure: "none",
  },
  {
    collection: "export_state",
    piiFields: ["none (export watermarks)"],
    legalBasis: "—",
    retention: "Operational",
    erasure: "none",
  },
  {
    collection: "printJobs",
    piiFields: ["createdBy (admin uid)"],
    legalBasis: "Legitimate interest (label printing)",
    retention: "TTL ~1 hour (ttlAt)",
    erasure: "none",
  },
  // Audited collections without personal data — listed so the coverage
  // test forces an explicit statement rather than an omission.
  {
    collection: "machine",
    piiFields: ["none"],
    legalBasis: "—",
    retention: "Operational",
    erasure: "none",
  },
  {
    collection: "permission",
    piiFields: ["none"],
    legalBasis: "—",
    retention: "Operational",
    erasure: "none",
  },
  {
    collection: "maco",
    piiFields: ["none"],
    legalBasis: "—",
    retention: "Operational",
    erasure: "none",
  },
  {
    collection: "catalog",
    piiFields: ["none"],
    legalBasis: "—",
    retention: "Operational",
    erasure: "none",
  },
];

export function mapEntry(collection: string): SubjectDataEntry | undefined {
  return SUBJECT_DATA_MAP.find((e) => e.collection === collection);
}

/** Entries the yearly trim processes, in deletion order. */
export function trimEntries(): Array<SubjectDataEntry & { trim: TrimSpec }> {
  return SUBJECT_DATA_MAP.filter(
    (e): e is SubjectDataEntry & { trim: TrimSpec } => e.trim !== undefined
  );
}
