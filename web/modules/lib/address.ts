// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared postal-address shape + synchronous validation, used by the
 * controlled `AddressFields` component (sign-up firma address, checkout
 * membership line item). The react-hook-form profile pages keep their own
 * inline validators; this is the single rule for the controlled surfaces.
 */

import { isValidSwissPlz } from "./postal"

export interface AddressValue {
  company: string
  street: string
  zip: string
  city: string
}

export type AddressErrors = Partial<Record<keyof AddressValue, string>>

export const EMPTY_ADDRESS: AddressValue = {
  company: "",
  street: "",
  zip: "",
  city: "",
}

/**
 * Validate a postal address. Returns a (possibly empty) map of field → message.
 * `requireCompany` adds the company-name requirement for firma.
 */
export function validateAddress(
  value: AddressValue,
  { requireCompany = false }: { requireCompany?: boolean } = {}
): AddressErrors {
  const errors: AddressErrors = {}
  if (requireCompany && value.company.trim() === "") {
    errors.company = "Firmenname ist erforderlich"
  }
  if (value.street.trim() === "") {
    errors.street = "Strasse ist erforderlich"
  }
  if (value.zip.trim() === "") {
    errors.zip = "PLZ ist erforderlich"
  } else if (!isValidSwissPlz(value.zip)) {
    errors.zip = "PLZ muss vierstellig sein (z.B. 8820)"
  }
  if (value.city.trim() === "") {
    errors.city = "Ort ist erforderlich"
  }
  return errors
}

/** True when the address has the fields a (membership) invoice needs. */
export function isAddressComplete(
  value: AddressValue,
  { requireCompany = false }: { requireCompany?: boolean } = {}
): boolean {
  return Object.keys(validateAddress(value, { requireCompany })).length === 0
}
