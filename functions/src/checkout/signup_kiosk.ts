// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview signupKiosk — account creation at the checkout kiosk
 * (issue #595, ADR-0022 amendment).
 *
 * The kiosk sign-up form (same fields as the own-device dialog) posts here:
 * the login code proves e-mail ownership, then the account is created
 * SERVER-SIDE — the client never holds a real session, so the persistent
 * login can't leak onto the shared terminal. The response mints the same
 * lightweight synthetic-uid `actsAs` session a badge tap produces, so the
 * fresh account is immediately checked in.
 *
 * Because the visitor leaves the kiosk without a signed-in device, the
 * account-instructions email (how to sign in at home) is sent as part of
 * sign-up — best-effort: a Resend failure must not roll back an account
 * that already exists.
 *
 * Only truly NEW e-mails may sign up here. An existing `users` doc — most
 * importantly an imported/unclaimed member — must never be overwritten with
 * freshly typed data; those sign in (completed account) or finish onboarding
 * on their own device (the kiosk offers `sendAccountInstructions`).
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import {
  consumeLoginCode,
  type VerifyLoginCodeInput,
} from "../auth/login-code/verify-code";
import {
  normalizeEmail,
  resolveOrCreateAuthUid,
} from "../auth/login-code/helpers";
import { sendAccountInstructionsEmail } from "./account_instructions";
import {
  assertKioskBearer,
  buildKioskUserPayload,
  mintKioskSessionToken,
  type KioskUserPayload,
} from "./kiosk_session";

const USER_TYPES = ["erwachsen", "kind", "firma"] as const;
type UserType = (typeof USER_TYPES)[number];

export interface KioskSignupProfile {
  firstName: string;
  lastName: string;
  userType: UserType;
  termsAccepted: boolean;
  billingAddress: {
    company: string;
    street: string;
    zip: string;
    city: string;
  } | null;
}

export interface SignupKioskInput extends VerifyLoginCodeInput {
  profile: KioskSignupProfile;
}

export interface SignupKioskResult extends KioskUserPayload {
  customToken: string;
  /** False when the instructions email could not be sent (account still created). */
  emailSent: boolean;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Server-side mirror of `validateSignupFields` — the client is untrusted. */
function validateProfile(profile: unknown): KioskSignupProfile {
  const p = profile as Partial<KioskSignupProfile> | null | undefined;
  if (
    !p ||
    !isNonEmptyString(p.firstName) ||
    !isNonEmptyString(p.lastName) ||
    !USER_TYPES.includes(p.userType as UserType) ||
    p.termsAccepted !== true
  ) {
    throw new HttpsError("invalid-argument", "invalid signup profile");
  }
  let billingAddress: KioskSignupProfile["billingAddress"] = null;
  if (p.userType === "firma") {
    const a = p.billingAddress;
    if (
      !a ||
      !isNonEmptyString(a.company) ||
      !isNonEmptyString(a.street) ||
      !isNonEmptyString(a.zip) ||
      !isNonEmptyString(a.city)
    ) {
      throw new HttpsError("invalid-argument", "invalid billing address");
    }
    billingAddress = {
      company: a.company.trim(),
      street: a.street.trim(),
      zip: a.zip.trim(),
      city: a.city.trim(),
    };
  }
  return {
    firstName: p.firstName.trim(),
    lastName: p.lastName.trim(),
    userType: p.userType as UserType,
    termsAccepted: true,
    billingAddress,
  };
}

export async function handleSignupKiosk(
  input: SignupKioskInput
): Promise<SignupKioskResult> {
  const profile = validateProfile(input?.profile);

  const db = getFirestore();

  // Friendly pre-check BEFORE the code is consumed: an existing profile
  // (completed or imported/unclaimed) must not burn its one-shot code on a
  // path that can only fail. Racy by nature — the `create()` below is the
  // hard guard.
  const emailForCheck = normalizeEmail(input?.email ?? "");
  if (emailForCheck) {
    const existing = await db
      .collection("users")
      .where("email", "==", emailForCheck)
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Für diese E-Mail existiert bereits ein Konto. Bitte melde dich an."
      );
    }
  }

  const { email } = await consumeLoginCode(input);
  const uid = await resolveOrCreateAuthUid(email);

  // Same scaffold as the own-device sign-up (writeSignupProfile), written
  // with the admin SDK because the kiosk holds no principal yet. `create()`
  // refuses to clobber a concurrently created doc (e.g. the same person
  // finishing sign-up on their phone).
  const docData = {
    email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    userType: profile.userType,
    termsAcceptedAt: FieldValue.serverTimestamp(),
    billingAddress: profile.billingAddress,
    created: FieldValue.serverTimestamp(),
    roles: [],
    permissions: [],
    phone: null,
  };
  try {
    await db.collection("users").doc(uid).create(docData);
  } catch (err: unknown) {
    if ((err as { code?: number } | null)?.code === 6 /* ALREADY_EXISTS */) {
      throw new HttpsError(
        "failed-precondition",
        "Für diese E-Mail existiert bereits ein Konto. Bitte melde dich an."
      );
    }
    throw err;
  }

  // Best-effort: the account exists and the session below must still be
  // handed out. A failed send is an ops problem (template/provider), not
  // the visitor's — surfaced via error log, reported via `emailSent`.
  let emailSent = true;
  try {
    await sendAccountInstructionsEmail(email, profile.firstName);
    await db
      .collection("users")
      .doc(uid)
      .update({ accountInstructionsSentAt: FieldValue.serverTimestamp() });
  } catch (err) {
    emailSent = false;
    logger.error("signupKiosk: account-instructions email failed", { err });
  }

  const customToken = await mintKioskSessionToken(uid, "signup");
  return {
    customToken,
    emailSent,
    ...buildKioskUserPayload(uid, docData),
  };
}

export const signupKioskHandler = async (
  request: CallableRequest<SignupKioskInput & { bearer?: string }>
): Promise<SignupKioskResult> => {
  const { email, code, profile, bearer } =
    request.data ?? ({} as SignupKioskInput);
  assertKioskBearer(bearer, "signupKiosk");
  return handleSignupKiosk({ email, code, profile });
};
