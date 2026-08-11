// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview completeOnboardingKiosk — persistence for the kiosk welcome
 * onboarding (issue #595, ADR-0022 amendment).
 *
 * An unclaimed/imported member who signs in at the kiosk runs the same
 * "Willkommen" wizard as on their own device, but the kiosk's actsAs
 * session cannot write `users` docs (Firestore rules deliberately reject
 * synthetic uids). This callable is the sanctioned write path: the
 * ESTABLISHED kiosk session itself is the credential — the caller must be
 * signed in with a `tagCheckout` principal, and the write targets exactly
 * the user named by its `actsAs` claim. No bearer needed: actsAs principals
 * only ever come out of the bearer-gated mint paths.
 *
 * Mirrors the own-device onboarding writes (welcome-onboarding.tsx):
 * profile fields in step 2, terms acceptance in step 3 — both optional so
 * each step commits as the member advances. `roles`, `permissions`,
 * `userType` and `email` are never touched. Additionally (code review):
 * profile writes are rejected once terms are accepted (the door closes with
 * onboarding; later edits belong in the member area on an own device), and
 * `termsAcceptedAt` is write-once so the original consent record can never
 * be restamped through a routine kiosk session.
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { requireActsAs } from "./kiosk_session";

export interface OnboardingProfile {
  firstName: string;
  lastName: string;
  /** E.164 (client-normalized via parseSwissPhone) or null to clear. */
  phone: string | null;
  billingAddress: {
    company: string;
    street: string;
    zip: string;
    city: string;
  } | null;
}

export interface CompleteOnboardingKioskInput {
  profile?: OnboardingProfile;
  termsAccepted?: boolean;
}

export interface CompleteOnboardingKioskResult {
  ok: true;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Server-side mirror of the wizard's step-2 validation. `isFirma` comes
 *  from the STORED doc — the form has no user-type switch. */
function validateProfile(
  profile: OnboardingProfile,
  isFirma: boolean
): OnboardingProfile {
  if (!isNonEmptyString(profile.firstName) || !isNonEmptyString(profile.lastName)) {
    throw new HttpsError("invalid-argument", "invalid profile");
  }
  if (profile.phone != null && !/^\+[1-9][0-9]{7,14}$/.test(profile.phone)) {
    throw new HttpsError("invalid-argument", "invalid phone");
  }
  let billingAddress: OnboardingProfile["billingAddress"] = null;
  if (profile.billingAddress != null) {
    const a = profile.billingAddress;
    if (
      typeof a.company !== "string" ||
      !isNonEmptyString(a.street) ||
      !isNonEmptyString(a.zip) ||
      !isNonEmptyString(a.city) ||
      !/^\d{4}$/.test(a.zip.trim())
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
  if (isFirma && (!billingAddress || !isNonEmptyString(billingAddress.company))) {
    // A firma profile cannot be completed address-less (isProfileComplete /
    // the Firestore-rules invariant on the own-device path).
    throw new HttpsError("invalid-argument", "billing address required");
  }
  return {
    firstName: profile.firstName.trim(),
    lastName: profile.lastName.trim(),
    phone: profile.phone ?? null,
    billingAddress,
  };
}

export const completeOnboardingKioskHandler = async (
  request: CallableRequest<CompleteOnboardingKioskInput>
): Promise<CompleteOnboardingKioskResult> => {
  const userId = requireActsAs(request);
  const { profile, termsAccepted } = request.data ?? {};
  if (profile == null && termsAccepted !== true) {
    throw new HttpsError("invalid-argument", "nothing to update");
  }

  const ref = getFirestore().collection("users").doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Kein Konto gefunden.");
  }
  const termsAlreadyAccepted = snap.get("termsAcceptedAt") != null;

  const update: Record<string, unknown> = {};
  if (profile != null) {
    // Profile edits are an ONBOARDING affordance: once terms are accepted
    // the profile is complete and this door closes — a routine kiosk
    // session of an onboarded member must not be able to rewrite it (the
    // member area on their own device is the place for later edits).
    if (termsAlreadyAccepted) {
      throw new HttpsError(
        "failed-precondition",
        "Onboarding bereits abgeschlossen — bearbeite dein Profil auf deinem eigenen Gerät."
      );
    }
    const clean = validateProfile(profile, snap.get("userType") === "firma");
    update.firstName = clean.firstName;
    update.lastName = clean.lastName;
    update.phone = clean.phone;
    update.billingAddress = clean.billingAddress;
  }
  // The consent timestamp is WRITE-ONCE: re-accepting (e.g. stepping back
  // and forward in the wizard) is an idempotent success that never restamps
  // the original record.
  if (termsAccepted === true && !termsAlreadyAccepted) {
    update.termsAcceptedAt = FieldValue.serverTimestamp();
  }
  if (Object.keys(update).length > 0) {
    await ref.update(update);
  }
  return { ok: true };
};
