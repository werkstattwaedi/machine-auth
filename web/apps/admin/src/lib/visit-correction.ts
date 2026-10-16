// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pure model behind the admin correction editor (ADR-0042): a draft of an
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
import { billRevision } from "@modules/lib/format"
import {
  CANCEL_REASON_MIN_LENGTH,
  MAX_CANCELLATION_REASON_LENGTH,
  USAGE_TYPE_DISCOUNTS,
  USAGE_TYPE_LABELS,
  computeCheckoutSummary,
  deriveVisitUsageType,
  isOwnerOnlyUsage,
  machineUsageBlocked,
  partitionBadge,
  partitionMembership,
  roundCents,
  type CheckoutSummary,
  type CorrectCheckoutEntry,
  type CorrectCheckoutItemType,
  type UsageType,
} from "@oww/shared"

export type DraftUserType = CheckoutPersonDoc["userType"]

export interface DraftPerson {
  name: string
  email: string
  userType: DraftUserType
  userId: string | null
  entryFeeWaivedToday: boolean
  /** The person's own usage type (issue #605). */
  usageType: UsageType
  billingAddress: { company: string; street: string; zip: string; city: string } | null
}

export interface DraftItem {
  /** Stable React key; not sent to the server. */
  key: string
  workshop: string
  description: string
  type: CorrectCheckoutItemType
  catalogId: string | null
  variantId: string | null
  origin: "nfc" | "manual" | "qr"
  quantity: number
  unitPrice: number
}

export interface CorrectionDraft {
  /**
   * The checkout owner's user id: the only line that may carry an
   * owner-only usage type (CHK-32). Null for a guest checkout.
   */
  ownerId: string | null
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
/** A bill can be corrected at most this many times (one revision digit). */
export const MAX_BILL_REVISION = 10

export function correctionBlockedReason(
  visit: Pick<CheckoutDoc, "status">,
  bill: Pick<BillDoc, "paidAt" | "cancelledAt" | "source" | "kind" | "referenceNumber"> | null,
  items: Array<Pick<CheckoutItemDoc, "catalogId" | "variantId">>,
  refs: { membershipCatalogId: string | null; badgeCatalogId: string | null },
  /** The Sammelrechnung an aggregated Beleg was folded into; Belege never carry `paidAt` themselves. */
  aggregate: Pick<BillDoc, "paidAt" | "cancelledAt"> | null = null,
): string | null {
  if (visit.status === "cancelled") return "Dieser Besuch wurde bereits storniert."
  if (visit.status !== "closed") return "Nur abgeschlossene Besuche können korrigiert werden."
  if (!bill) return "Zu diesem Besuch gibt es keine Rechnung."
  if (bill.cancelledAt) return "Die Rechnung wurde bereits storniert."
  if (bill.paidAt) {
    return "Die Rechnung ist bereits bezahlt — bezahlte Rechnungen können in dieser Version nicht korrigiert werden."
  }
  if ((bill.kind ?? "invoice") === "beleg" && aggregate?.paidAt) {
    return "Die Sammelrechnung ist bereits bezahlt — bezahlte Rechnungen können in dieser Version nicht korrigiert werden."
  }
  if ((bill.source ?? "checkout") === "membership-renewal") {
    return "Mitgliederbeitrags-Rechnungen können nicht korrigiert werden."
  }
  if (billRevision(bill.referenceNumber) >= MAX_BILL_REVISION) {
    return "Diese Rechnung hat die maximale Anzahl Korrekturen erreicht."
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


function knownUsageType(t: unknown): UsageType | null {
  return USAGE_TYPES.includes(t as UsageType) ? (t as UsageType) : null
}

export function draftFromCheckout(
  checkout: Pick<CheckoutDoc, "usageType" | "persons" | "summary"> &
    Partial<Pick<CheckoutDoc, "userId">>,
  items: Array<CheckoutItemDoc & { id: string }>,
): CorrectionDraft {
  const ownerId = checkout.userId?.id ?? null
  const persons = checkout.persons ?? []
  // Checkouts from before issue #605 carry one top-level type; it stands in
  // for every person — an owner-only one only on the owner alone (the
  // server reads legacy checkouts the same way).
  const legacy = knownUsageType(checkout.usageType) ?? "regular"
  return {
    ownerId,
    persons: persons.map((p) => {
      const isOwner = !!ownerId && p.userRef?.id === ownerId
      const fallback =
        isOwnerOnlyUsage(legacy) && !(isOwner && persons.length === 1)
          ? "regular"
          : legacy
      return {
      name: p.name,
      email: p.email ?? "",
      userType: p.userType,
      userId: p.userRef?.id ?? null,
      entryFeeWaivedToday: p.entryFeeWaivedToday === true,
      usageType: knownUsageType(p.usageType) ?? fallback,
      billingAddress: p.billingAddress
        ? {
            company: p.billingAddress.company ?? "",
            street: p.billingAddress.street ?? "",
            zip: p.billingAddress.zip ?? "",
            city: p.billingAddress.city ?? "",
          }
        : null,
      }
    }),
    items: items.map((i) => ({
      key: i.id,
      workshop: i.workshop,
      description: i.description,
      type: i.type === "machine" || i.type === "service" ? i.type : "material",
      catalogId: i.catalogId?.id ?? null,
      variantId: i.variantId ?? null,
      origin: i.origin,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    tip: checkout.summary?.tip ?? 0,
  }
}

/** The roster as the shared usage-type helpers see it. */
function usagePersons(draft: Pick<CorrectionDraft, "ownerId" | "persons">) {
  return draft.persons.map((p) => ({
    usageType: p.usageType,
    isOwner: !!draft.ownerId && p.userId === draft.ownerId,
  }))
}

/**
 * The visit's usage type, derived from the persons' own (issue #605): it
 * decides machine time and material. The server derives it the same way.
 */
export function draftVisitUsageType(
  draft: Pick<CorrectionDraft, "ownerId" | "persons">,
): UsageType {
  return deriveVisitUsageType(usagePersons(draft))
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

/**
 * Line total in cents — the checkout wizard's rule and the server's, so an
 * untouched line reproduces its stored total instead of drifting.
 */
export function rowTotal(item: Pick<DraftItem, "quantity" | "unitPrice">): number {
  return roundCents(item.quantity * item.unitPrice)
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
  // Mirrors the server (CHK-32): Freiwilligengruppe / Interne Nutzung only
  // on the owner's line while they are alone.
  const people = usagePersons(draft)
  draft.persons.forEach((p, i) => {
    if (!isOwnerOnlyUsage(p.usageType)) return
    const label = USAGE_TYPE_LABELS[p.usageType]
    if (!people[i].isOwner) {
      errors.push(`${label} ist nur für die angemeldete Person möglich.`)
    } else if (draft.persons.length > 1) {
      errors.push(`${label} ist nicht möglich, solange weitere Personen erfasst sind.`)
    }
  })
  // CHK-8: machine time can't be billed when everyone only accompanies.
  if (machineUsageBlocked(people, draft.items.some((i) => i.type === "machine"))) {
    errors.push(
      `Maschinen wurden genutzt, aber alle Personen sind als „${USAGE_TYPE_LABELS.materialbezug}“ erfasst.`,
    )
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
    tip: Math.round(draft.tip * 100),
    persons: draft.persons.map((p) => [
      p.userType,
      p.entryFeeWaivedToday,
      p.userId,
      p.name,
      p.usageType,
    ]),
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
    usageType: draftVisitUsageType(draft),
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
      // Derived; the server re-derives it from the persons (issue #605).
      usageType: draftVisitUsageType(draft),
      persons: draft.persons.map((p) => ({
        name: p.name.trim(),
        email: p.email.trim(),
        userType: p.userType,
        userId: p.userId,
        entryFeeWaivedToday: p.entryFeeWaivedToday,
        usageType: p.usageType,
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
