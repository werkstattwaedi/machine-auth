// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  COGNITOFORMS_FORM_ID,
  SYNC_DOC_PATH,
  runImport,
  type CognitoformsSyncState,
} from "./run_import";
import { CognitoformsClient } from "./api_client";

const cognitoformsApiKey = defineSecret("COGNITOFORMS_API_KEY");

/**
 * Daily import of CognitoForms self-checkout submissions. Runs at ~04:00 CET
 * via Cloud Scheduler. The cursor in `import_state/cognitoforms` makes each
 * run incremental.
 */
export const scheduledCognitoformsImport = onSchedule(
  {
    schedule: "every 24 hours",
    region: "europe-west6",
    timeoutSeconds: 540,
    secrets: [cognitoformsApiKey],
  },
  async () => {
    try {
      const client = new CognitoformsClient({
        apiKey: cognitoformsApiKey.value(),
      });
      const result = await runImport({ client });
      logger.info("scheduledCognitoformsImport finished", result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("scheduledCognitoformsImport failed", { message });
      await recordRunFailure(message);
      throw err;
    }
  },
);

interface BackfillRequest {
  sinceIso?: string;
  untilIso?: string;
  maxEntries?: number;
}

/**
 * Admin-only callable that re-runs the importer against a bounded
 * date window. Use for the one-time historical backfill so the 540s
 * schedule budget isn't blown by the 3500-row tail. Admin custom claim
 * gating mirrors the existing admin callables in this repo.
 */
export const backfillCognitoforms = onCall<BackfillRequest>(
  {
    region: "europe-west6",
    timeoutSeconds: 540,
    secrets: [cognitoformsApiKey],
  },
  async (request) => {
    if (!request.auth?.token.admin) {
      throw new HttpsError("permission-denied", "Admin required.");
    }
    const { sinceIso, untilIso, maxEntries } = request.data ?? {};
    try {
      const client = new CognitoformsClient({
        apiKey: cognitoformsApiKey.value(),
      });
      const result = await runImport({
        client,
        sinceIso: sinceIso ?? null,
        untilIso: untilIso ?? null,
        maxEntries: maxEntries ?? 1000,
      });
      logger.info("backfillCognitoforms finished", { ...result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("backfillCognitoforms failed", { message });
      await recordRunFailure(message);
      throw new HttpsError("internal", message);
    }
  },
);

async function recordRunFailure(message: string): Promise<void> {
  try {
    const db = getFirestore();
    await db.doc(SYNC_DOC_PATH).set(
      {
        lastRunAt: Timestamp.now(),
        lastRunStatus: "error",
        lastRunError: message.slice(0, 1000),
      } satisfies Partial<CognitoformsSyncState>,
      { merge: true },
    );
  } catch {
    // best-effort — primary error has already been logged
  }
}

export { COGNITOFORMS_FORM_ID };
