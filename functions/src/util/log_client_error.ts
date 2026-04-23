// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable Cloud Function: record a client-side error in Cloud Logging.
 *
 * Does NOT require authentication — the client may not yet be signed in
 * when the failure happens (e.g. permission-denied during the auth
 * bootstrap). The function simply forwards a best-effort diagnostic
 * payload to `logger.warn` under the `clientError` message, which makes
 * it trivial to search by `sessionId` in Cloud Logging when a user
 * reports a bug.
 */

import * as logger from "firebase-functions/logger";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

const MAX_STRING_LENGTH = 2000;
const MAX_BODY_BYTES = 4096;

interface LogClientErrorInput {
  sessionId?: unknown;
  context?: unknown;
  code?: unknown;
  message?: unknown;
  path?: unknown;
  userAgent?: unknown;
}

interface SanitizedPayload {
  sessionId: string;
  context: string | null;
  code: string | null;
  message: string | null;
  path: string | null;
  userAgent: string | null;
}

function toCappedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  return value.length > MAX_STRING_LENGTH
    ? value.slice(0, MAX_STRING_LENGTH)
    : value;
}

/**
 * Sanitizes and truncates the incoming payload. Exported for unit tests;
 * the callable wrapper is a thin shell over this.
 */
export function buildClientErrorLogPayload(
  data: LogClientErrorInput,
  uid: string | null,
): { logFields: Record<string, unknown> } {
  const sanitized: SanitizedPayload = {
    sessionId: toCappedString(data.sessionId) ?? "unknown",
    context: toCappedString(data.context),
    code: toCappedString(data.code),
    message: toCappedString(data.message),
    path: toCappedString(data.path),
    userAgent: toCappedString(data.userAgent),
  };

  // Drop `message` if the total JSON body is over budget. Metadata stays so
  // we at least know *who* and *where* even if the message itself was huge.
  const fullBody = JSON.stringify(sanitized);
  if (Buffer.byteLength(fullBody, "utf8") > MAX_BODY_BYTES) {
    sanitized.message = null;
  }

  return {
    logFields: {
      sessionId: sanitized.sessionId,
      context: sanitized.context,
      code: sanitized.code,
      message: sanitized.message,
      path: sanitized.path,
      uid,
      userAgent: sanitized.userAgent,
    },
  };
}

export const logClientError = onCall(
  async (request: CallableRequest<LogClientErrorInput>) => {
    const { logFields } = buildClientErrorLogPayload(
      request.data ?? {},
      request.auth?.uid ?? null,
    );
    logger.warn("clientError", logFields);
    return { ok: true };
  },
);
