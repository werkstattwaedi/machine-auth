// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
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
