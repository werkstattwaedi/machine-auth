// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { CheckoutPerson } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email)
}

/**
 * Validate a checkout person's fields.
 * Returns a map of field name → German error message for each invalid field.
 * An empty map means the person is valid.
 */
export function validatePerson(
  person: CheckoutPerson,
  isAnonymous: boolean,
  isPrimary: boolean = true,
): Record<string, string> {
  // Identity-linked pre-fills (signed-in user, family, tag-tap) are trusted
  // and skipped. Anonymous walk-ins render editable even when pre-filled
  // (rehydrated from the open checkout), so they must still be validated —
  // otherwise a cleared name/email could pass through on Weiter.
  if (person.isPreFilled && !isAnonymous) return {}

  const errors: Record<string, string> = {}

  if (!person.firstName.trim()) {
    errors.firstName = "Vorname ist erforderlich."
  }
  if (!person.lastName.trim()) {
    errors.lastName = "Nachname ist erforderlich."
  }
  if (isPrimary) {
    if (!person.email.trim()) {
      errors.email = "E-Mail ist erforderlich."
    } else if (!isValidEmail(person.email.trim())) {
      errors.email = "E-Mail muss im Format name@address.xyz eingegeben werden."
    }
  } else if (person.email.trim() && !isValidEmail(person.email.trim())) {
    // For additional persons, only validate format if email is provided
    errors.email = "E-Mail muss im Format name@address.xyz eingegeben werden."
  }

  if (isAnonymous && !person.termsAccepted) {
    errors.termsAccepted = "Nutzungsbestimmungen ist erforderlich."
  }

  if (person.userType === "firma") {
    if (!person.billingCompany?.trim()) {
      errors.billingCompany = "Firma ist erforderlich."
    }
    if (!person.billingStreet?.trim()) {
      errors.billingStreet = "Strasse / Nr. ist erforderlich."
    }
    if (!person.billingZip?.trim()) {
      errors.billingZip = "PLZ ist erforderlich."
    }
    if (!person.billingCity?.trim()) {
      errors.billingCity = "Ort ist erforderlich."
    }
  }

  return errors
}

/**
 * ADR-0029 advisory roster check: only account-less family members may be
 * rostered onto someone else's checkout. A person linked to another account
 * (userId set, non-empty email ⇒ they have their own login) checks in on
 * their own account instead. The identified principal (`ownerUserId`) is the
 * allowed exception — the owner's own line naturally carries their userId.
 *
 * The quick-add chips already refuse to add such persons; this catches a
 * roster rehydrated from an open checkout created before the rule (or on
 * another device) so the visit fails here with a clear message instead of
 * at submit. The server guard in closeCheckoutAndGetPayment stays
 * authoritative.
 *
 * Returns a German error message naming the first offender, or null.
 */
export function rosterAccountError(
  persons: Pick<CheckoutPerson, "userId" | "email" | "firstName" | "lastName">[],
  ownerUserId: string | null,
): string | null {
  const offender = persons.find(
    (p) => p.userId && p.userId !== ownerUserId && p.email.trim(),
  )
  if (!offender) return null
  const name = `${offender.firstName} ${offender.lastName}`.trim()
  return `«${name}» hat ein eigenes Konto und muss den Besuch separat erfassen. Bitte Person entfernen.`
}

export interface ItemErrors {
  quantity?: string
  price?: string
  description?: string
}

/**
 * Validate a checkout item.
 * Returns a map of field → error message. Empty map means valid.
 */
export function validateCheckoutItem(item: CheckoutItemLocal): ItemErrors {
  if (item.origin === "nfc") return {}

  const errors: ItemErrors = {}

  if (item.pricingModel === "direct") {
    if (!item.description.trim()) {
      errors.description = "Beschreibung ist erforderlich."
    }
    if (item.totalPrice <= 0) {
      errors.price = "Preis muss grösser als 0 sein."
    }
    return errors
  }

  // For area/length/sla models, check formInputs instead of quantity
  if (item.pricingModel === "area") {
    const l = item.formInputs?.[0]?.quantity ?? 0
    const w = item.formInputs?.[1]?.quantity ?? 0
    if (l <= 0 || w <= 0) {
      errors.quantity = "Masse müssen grösser als 0 sein."
    }
  } else if (item.pricingModel === "length") {
    const l = item.formInputs?.[0]?.quantity ?? 0
    if (l <= 0) {
      errors.quantity = "Länge muss grösser als 0 sein."
    }
  } else if (item.pricingModel === "sla") {
    const resinMl = item.formInputs?.[0]?.quantity ?? 0
    const layers = item.formInputs?.[1]?.quantity ?? 0
    if (resinMl <= 0 || layers <= 0) {
      errors.quantity = "Resin (ml) und Layer müssen grösser als 0 sein."
    }
  } else if (item.quantity <= 0) {
    errors.quantity = "Anzahl muss grösser als 0 sein."
  }

  if (!item.catalogId && item.unitPrice <= 0) {
    errors.price = "Preis muss grösser als 0 sein."
  }

  return errors
}

/** Check if an ItemErrors object has any errors */
export function hasItemErrors(errors: ItemErrors): boolean {
  return Object.keys(errors).length > 0
}
