// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * requestLoginCode — issues a 6-digit code + magic link for a given email.
 *
 * Rate limited to one request per email per 60 s; prior unconsumed codes
 * for the same email are invalidated so only the latest is usable.
 */

import * as logger from "firebase-functions/logger";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Resend } from "resend";
import {
  buildMagicLink,
  generateCode,
  generateDocId,
  hashCode,
  isAllowedOrigin,
  isEmulator,
  isPlausibleEmail,
  normalizeEmail,
} from "./helpers";

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineString("RESEND_FROM_EMAIL");
// No default: an unset param must fail loudly (see
// `assertResendLoginTemplateConfigured`) rather than silently calling
// Resend with an empty template id and producing an opaque provider
// error. In emulator mode we skip Resend entirely so the assertion is
// a no-op (issue #149, mirrors PR #142's LOGIN_ALLOWED_ORIGINS pattern).
const resendLoginTemplateId = defineString("RESEND_LOGIN_TEMPLATE_ID");

/**
 * Throws a `failed-precondition` error when the Resend login template id
 * is empty/whitespace in non-emulator mode. Surfaces the misconfiguration
 * in Cloud Functions logs without leaking provider details to the client.
 *
 * Exported separately so unit tests can pass the value directly without
 * stubbing `defineString` (mirrors `assertLoginOriginsConfigured`).
 */
export function assertResendLoginTemplateConfigured(value: string): void {
  if (process.env.FUNCTIONS_EMULATOR === "true") return;
  if (value.trim().length > 0) return;
  logger.error(
    "RESEND_LOGIN_TEMPLATE_ID is empty in production — login emails " +
      "cannot be sent. Set the param via firebase functions:config or " +
      "regenerate functions/.env.<projectId> via `npm run generate-env`."
  );
  throw new HttpsError(
    "failed-precondition",
    "Resend login template not configured"
  );
}

const CODE_EXPIRY_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface RequestLoginCodeInput {
  email: string;
}

export interface RequestLoginCodeResult {
  ok: true;
}

export async function handleRequestLoginCode(
  input: RequestLoginCodeInput,
  requestOrigin: string | undefined | null
): Promise<RequestLoginCodeResult> {
  if (!input?.email || typeof input.email !== "string") {
    throw new HttpsError("invalid-argument", "email is required");
  }
  const email = normalizeEmail(input.email);
  if (!isPlausibleEmail(email)) {
    throw new HttpsError("invalid-argument", "invalid email");
  }

  const origin = isAllowedOrigin(requestOrigin) ? requestOrigin! : null;
  if (!origin) {
    // Reject unknown origins rather than silently defaulting — the magic link
    // must point somewhere the user actually trusts.
    throw new HttpsError("failed-precondition", "unknown request origin");
  }

  const db = getFirestore();
  const col = db.collection("loginCodes");

  const recent = await col
    .where("email", "==", email)
    .orderBy("created", "desc")
    .limit(1)
    .get();

  if (!recent.empty) {
    const latest = recent.docs[0];
    const created = latest.get("created") as Timestamp | undefined;
    const consumedAt = latest.get("consumedAt") as
      | Timestamp
      | null
      | undefined;

    if (created && Date.now() - created.toMillis() < RATE_LIMIT_WINDOW_MS) {
      throw new HttpsError(
        "resource-exhausted",
        "Bitte warte kurz, bevor du einen neuen Code anforderst."
      );
    }

    if (consumedAt == null) {
      await latest.ref.update({ consumedAt: Timestamp.now() });
    }
  }

  const docId = generateDocId();
  const code = generateCode();
  const now = Timestamp.now();

  const docData: Record<string, unknown> = {
    email,
    codeHash: hashCode(code, docId),
    expiresAt: Timestamp.fromMillis(now.toMillis() + CODE_EXPIRY_MS),
    created: now,
    attempts: 0,
    consumedAt: null,
  };
  // EMULATOR ONLY: surface the plaintext code so E2E tests can read it.
  // Guarded so this path can never run in production.
  if (isEmulator()) {
    docData.debugCode = code;
  }

  await col.doc(docId).set(docData);

  const magicLink = buildMagicLink(origin, docId);

  if (isEmulator()) {
    logger.info(
      `[login-code] EMULATOR code for ${email}: code=${code} link=${magicLink}`
    );
  } else {
    await sendLoginEmail(email, code, magicLink);
  }

  return { ok: true };
}

async function sendLoginEmail(
  email: string,
  code: string,
  magicLink: string
): Promise<void> {
  const templateId = resendLoginTemplateId.value();
  // Fail loud before calling Resend with an empty template id (would
  // otherwise produce an opaque provider error).
  assertResendLoginTemplateConfigured(templateId);
  const resend = new Resend(resendApiKey.value());
  const { error } = await resend.emails.send({
    from: resendFromEmail.value(),
    to: email,
    template: {
      id: templateId,
      variables: {
        CODE: code,
        MAGIC_LINK: magicLink,
        EXPIRES_MINUTES: "5",
      },
    },
  });
  if (error) {
    logger.error("Resend send failed", { error });
    throw new HttpsError("internal", "Email send failed");
  }
}

export const requestLoginCode = onCall(
  { secrets: [resendApiKey] },
  async (request: CallableRequest<RequestLoginCodeInput>) => {
    const origin =
      (request.rawRequest.headers.origin as string | undefined) ?? null;
    return handleRequestLoginCode(request.data, origin);
  }
);
