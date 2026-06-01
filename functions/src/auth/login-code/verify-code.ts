// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * verifyLoginCode — consumes a 6-digit code and returns a Firebase custom
 * token. Caps at 5 attempts per doc; the 6th attempt burns the doc.
 */

import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  constantTimeEqual,
  hashCode,
  mintSessionToken,
  normalizeEmail,
  parseIntParamOrDie,
} from "./helpers";

const MAX_ATTEMPTS = 5;

// Per-email rate-limit tunables (issue #152). Stored as strings so they can
// be tuned via the operations repo without a code change. Defaults match
// the prior hard-coded values (24h window, 30 cumulative attempts / email).
// `LOGIN_PER_EMAIL_WINDOW_MS` is shared with `request.ts` — same param name
// resolves to the same configured value at deploy time.
const perEmailWindowMsParam = defineString("LOGIN_PER_EMAIL_WINDOW_MS", {
  default: "86400000",
});
const maxAttemptsPerEmailParam = defineString("LOGIN_MAX_ATTEMPTS_PER_EMAIL", {
  default: "30",
});

export interface VerifyLoginCodeInput {
  email: string;
  code: string;
}

export interface VerifyLoginCodeResult {
  customToken: string;
}

export async function handleVerifyLoginCode(
  input: VerifyLoginCodeInput
): Promise<VerifyLoginCodeResult> {
  if (!input?.email || !input?.code) {
    throw new HttpsError("invalid-argument", "email and code are required");
  }
  const email = normalizeEmail(input.email);
  if (!/^\d{6}$/.test(input.code)) {
    throw new HttpsError("invalid-argument", "invalid code format");
  }

  const db = getFirestore();
  const col = db.collection("loginCodes");
  const snap = await col
    .where("email", "==", email)
    .orderBy("created", "desc")
    .limit(1)
    .get();

  if (snap.empty) {
    throw new HttpsError("failed-precondition", "Kein aktiver Anmeldecode.");
  }

  const docRef = snap.docs[0].ref;

  // Per-email cumulative-attempts cap (issue #152). Sum `attempts` across
  // all loginCodes docs for the email in the 24h window before allowing
  // an increment. Done as a pre-check OUTSIDE the transaction: the
  // alternative (querying inside `runTransaction`) complicates the
  // single-doc transaction shape, and the trade-off is minor — an
  // attacker could squeeze a few extra attempts during the read-write
  // gap, but the per-doc 5-attempt cap remains the hard defence; this
  // rolling cap is a soft ceiling that survives across rotating codes.
  const perEmailWindowMs = parseIntParamOrDie(
    "LOGIN_PER_EMAIL_WINDOW_MS",
    perEmailWindowMsParam.value()
  );
  const maxAttemptsPerEmail = parseIntParamOrDie(
    "LOGIN_MAX_ATTEMPTS_PER_EMAIL",
    maxAttemptsPerEmailParam.value()
  );
  const windowStart = Timestamp.fromMillis(Date.now() - perEmailWindowMs);
  const attemptsSnap = await col
    .where("email", "==", email)
    .where("created", ">=", windowStart)
    .select("attempts")
    .get();
  let cumulativeAttempts = 0;
  for (const d of attemptsSnap.docs) {
    cumulativeAttempts += (d.get("attempts") as number | undefined) ?? 0;
  }
  if (cumulativeAttempts >= maxAttemptsPerEmail) {
    throw new HttpsError(
      "resource-exhausted",
      "Zu viele falsche Code-Eingaben. Bitte versuche es später erneut."
    );
  }

  type Outcome =
    | { kind: "ok"; email: string }
    | { kind: "consumed" }
    | { kind: "expired" }
    | { kind: "locked" }
    | { kind: "wrong" };

  // Decide + commit the side-effect atomically. Throwing from inside the
  // transaction would roll back the attempts update, so we encode the
  // outcome as a return value and throw outside.
  const outcome = await db.runTransaction<Outcome>(async (tx) => {
    const doc = await tx.get(docRef);
    const data = doc.data();
    if (!data) return { kind: "consumed" };

    if (data.consumedAt) return { kind: "consumed" };
    if ((data.expiresAt as Timestamp).toMillis() < Date.now()) {
      return { kind: "expired" };
    }

    const newAttempts = (data.attempts ?? 0) + 1;
    if (newAttempts > MAX_ATTEMPTS) {
      tx.update(docRef, { consumedAt: Timestamp.now() });
      return { kind: "locked" };
    }

    const providedHash = hashCode(input.code, doc.id);
    const expectedHash = data.codeHash as string;
    if (!constantTimeEqual(providedHash, expectedHash)) {
      tx.update(docRef, { attempts: newAttempts });
      return { kind: "wrong" };
    }

    tx.update(docRef, {
      consumedAt: Timestamp.now(),
      attempts: newAttempts,
    });
    return { kind: "ok", email: data.email as string };
  });

  switch (outcome.kind) {
    case "consumed":
      throw new HttpsError("failed-precondition", "Code bereits verwendet.");
    case "expired":
      throw new HttpsError("failed-precondition", "Code abgelaufen.");
    case "locked":
      throw new HttpsError("failed-precondition", "Zu viele Versuche.");
    case "wrong":
      throw new HttpsError("failed-precondition", "Code falsch.");
    case "ok": {
      const customToken = await mintSessionToken(outcome.email, "emailCode");
      return { customToken };
    }
  }
}

export const verifyLoginCodeHandler = async (
  request: CallableRequest<VerifyLoginCodeInput>
) => handleVerifyLoginCode(request.data);
