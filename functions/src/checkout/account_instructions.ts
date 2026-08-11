// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Account-instructions email ("so nutzt du dein Konto") for
 * visitors whose account exists but whose authenticated area is out of reach
 * at the kiosk (issue #595, ADR-0022 amendment).
 *
 * Two callers:
 *  - `sendAccountInstructions` (callable): step 4 of the kiosk welcome
 *    onboarding offers the email. The ESTABLISHED kiosk session is the
 *    credential (`requireActsAs`) and the recipient is derived server-side
 *    from that user's doc — no e-mail in the payload, so the callable is
 *    neither an account-existence oracle nor a mail-anyone trigger
 *    (code-review finding).
 *  - `signupKiosk` sends the same email directly after a kiosk account
 *    creation, so the fresh account isn't stranded on a shared terminal.
 */

import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { isEmulator } from "../auth/login-code/helpers";
import { sendTemplate } from "../util/resend_template";
import { requireActsAs } from "./kiosk_session";

// No default: unset must fail loudly at send time (see
// `assertTemplateConfigured` inside sendTemplate) instead of calling Resend
// with an empty template id. Emulator mode skips Resend entirely.
const resendAccountInstructionsTemplateId = defineString(
  "RESEND_ACCOUNT_INSTRUCTIONS_TEMPLATE_ID"
);

/** Repeated taps on the kiosk button must not turn into inbox spam. */
const RESEND_THROTTLE_MS = 60 * 60 * 1000;

/**
 * Send the instructions email. In the emulator the send is skipped and the
 * payload logged instead (the log line + return contract are part of the
 * E2E surface, mirroring the login-code pattern).
 */
export async function sendAccountInstructionsEmail(
  email: string,
  firstName: string | undefined
): Promise<void> {
  const greeting = firstName ? `Hallo ${firstName}` : "Hallo";
  if (isEmulator()) {
    logger.info(
      `[account-instructions] EMULATOR email for ${email}: greeting=${greeting}`
    );
    return;
  }
  await sendTemplate({
    to: email,
    templateId: resendAccountInstructionsTemplateId.value(),
    templateIdParam: "RESEND_ACCOUNT_INSTRUCTIONS_TEMPLATE_ID",
    variables: { GREETING: greeting },
  });
}

export interface SendAccountInstructionsResult {
  ok: true;
  /** True when the 1h per-account throttle suppressed a re-send. */
  throttled: boolean;
}

export const sendAccountInstructionsHandler = async (
  request: CallableRequest<unknown>
): Promise<SendAccountInstructionsResult> => {
  const userId = requireActsAs(request);

  const db = getFirestore();
  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) {
    throw new HttpsError("failed-precondition", "Kein Konto gefunden.");
  }
  const email = userDoc.get("email") as string | null | undefined;
  if (!email) {
    // Child accounts have no e-mail of their own.
    throw new HttpsError(
      "failed-precondition",
      "Für dieses Konto ist keine E-Mail-Adresse hinterlegt."
    );
  }

  const lastSent = userDoc.get("accountInstructionsSentAt") as
    | Timestamp
    | undefined;
  if (lastSent && Date.now() - lastSent.toMillis() < RESEND_THROTTLE_MS) {
    // Idempotent success: the visitor's goal (an email in their inbox) is
    // already met — a kiosk error message would only confuse.
    return { ok: true, throttled: true };
  }

  await sendAccountInstructionsEmail(
    email,
    userDoc.get("firstName") as string | undefined
  );
  await userDoc.ref.update({ accountInstructionsSentAt: Timestamp.now() });
  return { ok: true, throttled: false };
};
