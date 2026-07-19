// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pseudonymous subject key for the BigQuery statistics export (ADR-0039).
 *
 * `subject_key = HMAC-SHA256(subjectId, STATS_SUBJECT_SALT)` — a stable,
 * per-project pseudonym that lets statistics group visits by person without
 * storing the person's identifier. The salt is a Secret Manager secret;
 * destroying it retroactively anonymizes every exported row (the documented
 * escape hatch in ADR-0039). Statistics survive erasure with a stable key
 * (DSG Art. 31(2)(e)); the key itself never leaves BigQuery.
 *
 * The subject id is `users/{id}` doc id (== Firebase Auth UID) for registered
 * users, or the creating anon principal's UID for anonymous checkouts — each
 * anonymous visit gets its own key, which is privacy-positive.
 */

import { createHmac } from "crypto";
import { defineSecret } from "firebase-functions/params";

// Attached to dailyStatsExport and authCall (erasure's flush-before-delete
// builds rows too). Generate with `openssl rand -hex 32`, distinct per project.
export const statsSubjectSalt = defineSecret("STATS_SUBJECT_SALT");

export function subjectKey(
  salt: string,
  subjectId: string | null | undefined
): string | null {
  if (!subjectId) return null;
  if (!salt) {
    throw new Error("subjectKey: empty salt (STATS_SUBJECT_SALT not set?)");
  }
  return createHmac("sha256", salt).update(subjectId, "utf8").digest("hex");
}
