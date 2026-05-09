// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared Resend "send a templated email" helper. Two callers today
 * (login-code, family-invite) repeated the same assertion + Resend client
 * + error mapping; this lives here so a third caller doesn't tempt anyone
 * to copy-paste it again.
 *
 * The helper deliberately does NOT auto-skip in emulator mode — callers
 * already branch (`if (isEmulator()) { logger.info(...) } else { send(...) }`)
 * because the in-emulator surface (log line, debug doc field) is part of
 * the contract with E2E tests, not an internal detail.
 */

import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";

export const resendApiKey = defineSecret("RESEND_API_KEY");
export const resendFromEmail = defineString("RESEND_FROM_EMAIL");

/**
 * Throws `failed-precondition` when a Resend template id param is empty
 * outside the emulator. Surfaces the misconfiguration in Cloud Functions
 * logs without leaking provider details to the client.
 *
 * `paramName` is the env-var/param name (e.g. `RESEND_LOGIN_TEMPLATE_ID`)
 * — included in the log line so ops knows which knob to fix.
 */
export function assertTemplateConfigured(
  value: string,
  paramName: string
): void {
  if (process.env.FUNCTIONS_EMULATOR === "true") return;
  if (value.trim().length > 0) return;
  logger.error(
    `${paramName} is empty in production — emails using this template ` +
      "cannot be sent. Set the param via firebase functions:config or " +
      "regenerate functions/.env.<projectId> via `npm run generate-env`."
  );
  throw new HttpsError(
    "failed-precondition",
    `Resend template (${paramName}) not configured`
  );
}

export interface SendTemplateInput {
  to: string;
  templateId: string;
  /** Param name used in the configured-assertion log line. */
  templateIdParam: string;
  variables: Record<string, string>;
}

/**
 * Send a templated email via Resend. Asserts the template id is configured
 * before calling Resend (otherwise we'd get an opaque provider error).
 *
 * Caller must declare `resendApiKey` in `onCall({ secrets: [...] })` so the
 * value is available when this runs.
 */
export async function sendTemplate(input: SendTemplateInput): Promise<void> {
  const { to, templateId, templateIdParam, variables } = input;
  assertTemplateConfigured(templateId, templateIdParam);
  // Lazy import: keeps the Resend SDK out of the cold-start bundle for
  // every other function (resend_template is reachable from index.ts via
  // requestLoginCode and inviteFamilyMember exports).
  const { Resend } = await import("resend");
  const resend = new Resend(resendApiKey.value());
  const { error } = await resend.emails.send({
    from: resendFromEmail.value(),
    to,
    template: {
      id: templateId,
      variables,
    },
  });
  if (error) {
    logger.error("Resend send failed", { error, templateIdParam });
    throw new HttpsError("internal", "Email send failed");
  }
}
