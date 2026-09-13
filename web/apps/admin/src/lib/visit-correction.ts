// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pure model behind the admin correction editor (ADR-0041): a draft of an
 * edited visit, its validation, the client-side estimate (via the shared
 * summary arithmetic — the server prices authoritatively), and the wire
 * entry for `correctCheckouts`. No React, no Firestore — unit-tested.
 */

import type {
  BillDoc,
  CheckoutDoc,
  CheckoutItemDoc,
  CheckoutPersonDoc,
} from "@modules/lib/firestore-entities"
import {
  CANCEL_REASON_MIN_LENGTH,
  MAX_CANCELLATION_REASON_LENGTH,
  USAGE_TYPE_DISCOUNTS,
  computeCheckoutSummary,
  partitionBadge,
  partitionMembership,
  type CheckoutSummary,
  type CorrectCheckoutEntry,
  type UsageType,
} from "@oww/shared"

export type DraftUserType = CheckoutPersonDoc["userType"]

export interface DraftPerson {
  name: string
  email: string
  userType: DraftUserType
  userId: string | null
  entryFeeWaivedToday: boolean
  billingAddress: { company: string; street: string; zip: string; city: string } | null
}

export interface DraftItem {
  /** Stable React key; not sent to the server. */
  key: string
  workshop: string
  description: string
  type: "machine" | "material"
  catalogId: string | null
  variantId: string | null
  origin: "nfc" | "manual" | "qr"
  quantity: number
  unitPrice: number
}

export interface CorrectionDraft {
  usageType: UsageType
  persons: DraftPerson[]
  items: DraftItem[]
  tip: number
}

export const USAGE_TYPES = Object.keys(USAGE_TYPE_DISCOUNTS) as UsageType[]

/**
 * Why a visit can't be corrected right now (German, shown in the UI), or
 * `null` when it can. Mirrors the server guards in `correctCheckouts`;
 * the server stays authoritative. Membership / badge lines are matched on
 * catalog id — a missing references doc means "no such SKU".
 */
export function correctionBlockedReason(
  visit: Pick<CheckoutDoc, "status">,
  bill: Pick<BillDoc, "paidAt" | "cancelledAt" | "source"> | null,
  items: Array<Pick<CheckoutItemDoc, "catalogId" | "variantId">>,
  refs: { membershipCatalogId: string | null; badgeCatalogId: string | null },
): string | null {
  if (visit.status === "cancelled") return "Dieser Besuch wurde bereits storniert."
  if (visit.status !== "closed") return "Nur abgeschlossene Besuche können korrigiert werden."
  if (!bill) return "Zu diesem Besuch gibt es keine Rechnung."
  if (bill.cancelledAt) return "Die Rechnung wurde bereits storniert."
  if (bill.paidAt) {
    return "Die Rechnung ist bereits bezahlt — bezahlte Rechnungen können in dieser Version nicht korrigiert werden."
  }
  if ((bill.source ?? "checkout") === "membership-renewal") {
    return "Mitgliederbeitrags-Rechnungen können nicht korrigiert werden."
  }
  const classifiable = items.map((i) => ({
    catalogId: i.catalogId?.id ?? null,
    variantId: i.variantId ?? null,
  }))
  const membership = partitionMembership(classifiable, {
    membershipCatalogId: refs.membershipCatalogId,
  }).membershipItems.length
  const badge = partitionBadge(classifiable, { badgeCatalogId: refs.badgeCatalogId }).badgeItems.length
  if (membership > 0 || badge > 0) {
    return "Besuche mit Mitgliedschaft oder Badge können nicht korrigiert werden."
  }
  return null
}


export function draftFromCheckout(
  checkout: Pick<CheckoutDoc, "usageType" | "persons" | "summary">,
  items: Array<CheckoutItemDoc & { id: string }>,
): CorrectionDraft {
  return {
    usageType: (USAGE_TYPES.includes(checkout.usageType as UsageType)
      ? checkout.usageType
      : "regular") as UsageType,
    persons: (checkout.persons ?? []).map((p) => ({
      name: p.name,
      email: p.email ?? "",
      userType: p.userType,
      userId: p.userRef?.id ?? null,
      entryFeeWaivedToday: p.entryFeeWaivedToday === true,
      billingAddress: p.billingAddress
        ? {
            company: p.billingAddress.company ?? "",
            street: p.billingAddress.street ?? "",
            zip: p.billingAddress.zip ?? "",
            city: p.billingAddress.city ?? "",
          }
        : null,
    })),
    items: items.map((i) => ({
      key: i.id,
      workshop: i.workshop,
      description: i.description,
      type: i.type === "machine" ? "machine" : "material",
      catalogId: i.catalogId?.id ?? null,
      variantId: i.variantId ?? null,
      origin: i.origin,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    tip: checkout.summary?.tip ?? 0,
  }
}

export function newItemRow(workshop: string, key: string): DraftItem {
  return {
    key,
    workshop,
    description: "",
    type: "material",
    catalogId: null,
    variantId: null,
    origin: "manual",
    quantity: 1,
    unitPrice: 0,
  }
}

/** Line total rounded to 5 Rappen, like the catalog prices. */
export function rowTotal(item: Pick<DraftItem, "quantity" | "unitPrice">): number {
  return Math.round(item.quantity * item.unitPrice * 20) / 20
}

const MAX_MONEY = 1_000_000

/** German validation messages; empty when the draft can be submitted. */
export function validateDraft(draft: CorrectionDraft): string[] {
  const errors: string[] = []
  if (draft.persons.length === 0) errors.push("Mindestens eine Person ist nötig.")
  draft.items.forEach((item, i) => {
    const n = i + 1
    if (!item.description.trim()) errors.push(`Position ${n}: Bezeichnung fehlt.`)
    if (!item.workshop) errors.push(`Position ${n}: Werkstatt fehlt.`)
    if (!(item.quantity > 0) || !Number.isFinite(item.quantity))
      errors.push(`Position ${n}: Menge muss grösser als 0 sein.`)
    if (!(item.unitPrice >= 0) || !Number.isFinite(item.unitPrice) || item.unitPrice >= MAX_MONEY)
      errors.push(`Position ${n}: Einzelpreis ist ungültig.`)
  })
  if (!(draft.tip >= 0) || !Number.isFinite(draft.tip)) errors.push("Trinkgeld darf nicht negativ sein.")
  if (draft.usageType === "materialbezug" && draft.items.some((i) => i.type === "machine")) {
    errors.push("Materialbezug ist nicht möglich, wenn Maschinen genutzt wurden.")
  }
  return errors
}

export function validateReason(reason: string): string | null {
  const len = reason.trim().length
  if (len < CANCEL_REASON_MIN_LENGTH) return `Grund: mindestens ${CANCEL_REASON_MIN_LENGTH} Zeichen.`
  if (len > MAX_CANCELLATION_REASON_LENGTH) return `Grund: höchstens ${MAX_CANCELLATION_REASON_LENGTH} Zeichen.`
  return null
}

function normalize(draft: CorrectionDraft): string {
  return JSON.stringify({
    usageType: draft.usageType,
    tip: Math.round(draft.tip * 100),
    persons: draft.persons.map((p) => [p.userType, p.entryFeeWaivedToday, p.userId, p.name]),
    items: draft.items.map((i) => [
      i.workshop,
      i.description.trim(),
      i.type,
      i.catalogId,
      Math.round(i.quantity * 1000),
      Math.round(i.unitPrice * 100),
    ]),
  })
}

/** True when nothing billable changed — the page then points at "Stornieren". */
export function isUnchanged(draft: CorrectionDraft, original: CorrectionDraft): boolean {
  return normalize(draft) === normalize(original)
}

/**
 * Client-side estimate through the shared arithmetic; `null` while the
 * pricing config isn't loaded or lacks a fee row (the page shows a hint).
 */
export function estimateSummary(
  draft: CorrectionDraft,
  standardEntryFee: (userType: string) => number | null,
): CheckoutSummary | null {
  let missing = false
  const summary = computeCheckoutSummary({
    persons: draft.persons,
    usageType: draft.usageType,
    items: draft.items.map((i) => ({ type: i.type, totalPrice: rowTotal(i) })),
    standardEntryFee: (ut) => {
      const fee = standardEntryFee(ut)
      if (fee == null) missing = true
      return fee ?? 0
    },
    tip: draft.tip,
  })
  return missing ? null : summary
}

export function toWireEntry(checkoutId: string, draft: CorrectionDraft): CorrectCheckoutEntry {
  return {
    checkoutId,
    replacement: {
      usageType: draft.usageType,
      persons: draft.persons.map((p) => ({
        name: p.name.trim(),
        email: p.email.trim(),
        userType: p.userType,
        userId: p.userId,
        entryFeeWaivedToday: p.entryFeeWaivedToday,
        billingAddress: p.billingAddress,
      })),
      items: draft.items.map((i) => ({
        workshop: i.workshop,
        description: i.description.trim(),
        type: i.type,
        catalogId: i.catalogId,
        variantId: i.variantId,
        origin: i.origin,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: rowTotal(i),
      })),
      tip: draft.tip,
    },
  }
}
