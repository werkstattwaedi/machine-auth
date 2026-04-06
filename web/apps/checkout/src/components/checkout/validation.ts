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
  if (person.isPreFilled) return {}

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

  // For area/length models, check formInputs instead of quantity
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
