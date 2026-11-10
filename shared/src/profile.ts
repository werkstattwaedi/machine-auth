// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/** The users-doc fields that decide whether the profile is complete. */
export interface ProfileCompletenessFields {
  firstName?: string | null
  lastName?: string | null
  userType?: string | null
  billingAddress?: {
    company?: string | null
    street?: string | null
    zip?: string | null
    city?: string | null
  } | null
  termsAcceptedAt?: unknown
}

/**
 * Profile is complete when name and terms are filled (ACC-2: until then the
 * welcome onboarding runs first). The postal address is captured later
 * (membership signup or profile edit) and is only *required* for companies
 * (`firma`), which always invoice and therefore need an address + company
 * name up front. Shared so the kiosk session payload can carry the answer
 * (#854) — a badge tap alone may not read the users doc.
 */
export function isProfileComplete(user: ProfileCompletenessFields): boolean {
  if (!user.firstName || !user.lastName || !user.termsAcceptedAt) {
    return false
  }
  if (user.userType === "firma") {
    const addr = user.billingAddress
    if (!addr || !addr.street || !addr.zip || !addr.city || !addr.company) {
      return false
    }
  }
  return true
}
