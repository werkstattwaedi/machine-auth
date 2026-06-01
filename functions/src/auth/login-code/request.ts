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
  type CallableRequest,
} from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  buildMagicLink,
  generateCode,
  generateDocId,
  hashCode,
  isAllowedOrigin,
  isEmulator,
  isPlausibleEmail,
  normalizeEmail,
  parseIntParamOrDie,
} from "./helpers";
import {
  assertTemplateConfigured,
  sendTemplate,
} from "../../util/resend_template";

// No default: an unset param must fail loudly (see
// `assertResendLoginTemplateConfigured`) rather than silently calling
// Resend with an empty template id and producing an opaque provider
// error. In emulator mode we skip Resend entirely so the assertion is
// a no-op (issue #149, mirrors PR #142's LOGIN_ALLOWED_ORIGINS pattern).
const resendLoginTemplateId = defineString("RESEND_LOGIN_TEMPLATE_ID");

// Per-email rate-limit tunables (issue #152). Stored as strings so they can
// be tuned via the operations repo without a code change. Defaults match
// the prior hard-coded values (24h window, 20 codes / email).
const perEmailWindowMsParam = defineString("LOGIN_PER_EMAIL_WINDOW_MS", {
  default: "86400000",
});
const maxCodesPerEmailParam = defineString("LOGIN_MAX_CODES_PER_EMAIL", {
  default: "20",
});

/**
 * Thin wrapper around the shared `assertTemplateConfigured` helper. Kept
 * for backwards compatibility with `test/unit/login-code-helpers.test.ts`
 * which imports this symbol directly.
 */
export function assertResendLoginTemplateConfigured(value: string): void {
  assertTemplateConfigured(value, "RESEND_LOGIN_TEMPLATE_ID");
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

  // Per-email 24h cap on code requests (issue #152). Brute-force defence:
  // an attacker rotating fresh codes past the 60s throttle would otherwise
  // get unbounded attempts at one address. The inequality on `created`
  // needs an (email asc, created asc) composite index — distinct from the
  // (email asc, created desc) index used by the latest-doc lookup above.
  const perEmailWindowMs = parseIntParamOrDie(
    "LOGIN_PER_EMAIL_WINDOW_MS",
    perEmailWindowMsParam.value()
  );
  const maxCodesPerEmail = parseIntParamOrDie(
    "LOGIN_MAX_CODES_PER_EMAIL",
    maxCodesPerEmailParam.value()
  );
  const windowStart = Timestamp.fromMillis(Date.now() - perEmailWindowMs);
  const recentCount = await col
    .where("email", "==", email)
    .where("created", ">=", windowStart)
    .count()
    .get();
  if (recentCount.data().count >= maxCodesPerEmail) {
    throw new HttpsError(
      "resource-exhausted",
      "Zu viele Code-Anforderungen. Bitte versuche es später erneut."
    );
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
  await sendTemplate({
    to: email,
    templateId: resendLoginTemplateId.value(),
    templateIdParam: "RESEND_LOGIN_TEMPLATE_ID",
    variables: {
      CODE: code,
      MAGIC_LINK: magicLink,
      EXPIRES_MINUTES: "5",
    },
  });
}

export const requestLoginCodeHandler = async (
  request: CallableRequest<RequestLoginCodeInput>
) => {
    const origin =
      (request.rawRequest.headers.origin as string | undefined) ?? null;
    return handleRequestLoginCode(request.data, origin);
};
