// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/** User type affects base fee */
export type UserType = "erwachsen" | "kind" | "firma"

/**
 * Usage type affects fee calculation. Chosen per person on the check-in
 * (issue #605, ADR-0050): a person's type decides their usage fee; the
 * visit's type, derived from its persons ({@link deriveVisitUsageType}),
 * decides machine time and material.
 */
export type UsageType =
  | "regular"
  | "ermaessigt"
  | "materialbezug"
  | "intern"
  | "hangenmoos"
  | "volunteering"

/**
 * The four billable sections of a checkout. The discount table
 * (`USAGE_TYPE_DISCOUNTS`) carries one multiplier per section, so adding a
 * new section is a compile error until every usage type provides a value.
 */
export type BillingSection = "entryFee" | "machine" | "material" | "tip"

/**
 * Per-usage-type discount: a multiplier in [0, 1] applied to each billing
 * section's *standard* amount. `1` bills the full standard amount, `0`
 * waives it, fractions discount it (e.g. `ermaessigt` pays half the entry
 * fee). This is the single authoritative pricing model — there is exactly
 * one set of standard fees (`config/pricing.entryFees.{userType}.regular`
 * for entry fees; the per-item prices for machine/material) and this table
 * is the fractional discount on top.
 *
 * Hardcoded here in `@oww/shared` (not config-driven) per issue #284 so
 * the server, web, and the invoice renderer all agree on the same waiving
 * rules without a Firestore round-trip. Tweaking these requires a code
 * change and review — intentional, because loosening them changes what
 * customers are billed.
 *
 * | usage type   | entry fee | machine | material | tip |
 * |--------------|-----------|---------|----------|-----|
 * | regular      | 1         | 1       | 1        | 1   |
 * | ermaessigt   | .5        | 1       | 1        | 1   |
 * | materialbezug| 0         | 0 (n/a) | 1        | 1   |
 * | hangenmoos   | 0         | 1       | 1        | 1   |
 * | volunteering | 0         | 0       | 1        | 1   |
 * | intern       | 0         | 0       | 0        | 1   |
 */
export type UsageDiscount = Record<BillingSection, number>

export const USAGE_TYPE_DISCOUNTS: Record<UsageType, UsageDiscount> = {
  regular: { entryFee: 1, machine: 1, material: 1, tip: 1 },
  ermaessigt: { entryFee: 0.5, machine: 1, material: 1, tip: 1 },
  // materialbezug waives entry + cannot have machine usage (guarded
  // server-side); the machine multiplier is 0 as a defensive belt-and-
  // suspenders should an nfc item ever slip through.
  materialbezug: { entryFee: 0, machine: 0, material: 1, tip: 1 },
  hangenmoos: { entryFee: 0, machine: 1, material: 1, tip: 1 },
  // volunteering (issue #284): a Freiwilligengruppe works on its own
  // projects — entry + machine on the house, material still billed.
  volunteering: { entryFee: 0, machine: 0, material: 1, tip: 1 },
  // intern: an internal OWW project — everything but the (optional) tip
  // is on the house.
  intern: { entryFee: 0, machine: 0, material: 0, tip: 1 },
}

/** The multiplier table for a usage type, defaulting to no discount. */
export function usageDiscount(usageType: UsageType): UsageDiscount {
  return USAGE_TYPE_DISCOUNTS[usageType] ?? USAGE_TYPE_DISCOUNTS.regular
}

export type PricingModel =
  | "time"
  | "area"
  | "length"
  | "count"
  | "weight"
  | "direct"
  | "sla"

export type DiscountLevel = "none" | "member"

/**
 * What a line item *is*, for billing-section bucketing — independent of how
 * it was entered (`origin`). `machine` bills as "Maschinennutzung" and
 * follows the usage-type machine discount; `material` as "Materialbezug".
 * Stamped explicitly on every catalog and checkout item (issue #105); we
 * no longer infer machine-ness from `origin === "nfc"` or `pricingModel`.
 *
 * `service` (Dienstleistung, e.g. Keramik-Brennen, issue #685) is neither:
 * it shows in the workshop's upper section next to the machines, but bills
 * in the material bucket — allowed with „Begleitung / nur Materialbezug“, not waived for
 * volunteers. Only its labels differ (`materialSectionLabels`).
 */
export type ItemType = "machine" | "material" | "service"

/**
 * True iff a line item is billed as machine usage. The explicit `type` is
 * authoritative — set on NFC sync, the material picker, and pinned
 * manual-hour rows. Items without it bill as material.
 */
export function isMachineItem(item: { type?: string | null }): boolean {
  return item.type === "machine"
}

/** True iff a line item is a Dienstleistung (billed as material). */
export function isServiceItem(item: { type?: string | null }): boolean {
  return item.type === "service"
}

/**
 * Wording for the non-machine bucket, which holds material and services
 * alike. Named after what the items actually are, so a firing-only cart
 * doesn't read as „Materialbezug“.
 */
export interface MaterialSectionLabels {
  /** Section heading, e.g. "Materialbezug". */
  title: string
  /** Column header of the position table. */
  column: string
  /** Subject of a waiver sentence, e.g. "Material" in "Material wird nicht verrechnet". */
  waived: string
  /** Verb agreeing with `waived` ("wird" / "werden"). */
  waivedVerb: "wird" | "werden"
  /** Bill discount row, completed by "verrechnet": "kein Materialbezug verrechnet". */
  noneBilled: string
}

export function materialSectionLabels(
  items: ReadonlyArray<{ type?: string | null }>,
): MaterialSectionLabels {
  const hasService = items.some(isServiceItem)
  const hasMaterial = items.some((i) => !isServiceItem(i))
  if (hasService && hasMaterial) {
    return {
      title: "Material & Dienstleistungen",
      column: "Position",
      waived: "Material und Dienstleistungen",
      waivedVerb: "werden",
      noneBilled: "kein Material und keine Dienstleistungen",
    }
  }
  if (hasService) {
    return {
      title: "Dienstleistungen",
      column: "Dienstleistung",
      waived: "Dienstleistungen",
      waivedVerb: "werden",
      noneBilled: "keine Dienstleistungen",
    }
  }
  return {
    title: "Materialbezug",
    column: "Bezogenes Material",
    waived: "Material",
    waivedVerb: "wird",
    noneBilled: "kein Materialbezug",
  }
}

/**
 * Per-variant price. `default` is mandatory and is what an un-discounted
 * customer pays. Additional tiers (today only `member`) are optional
 * overrides; if absent, the default applies. Schema-extensible to future
 * tiers (volunteer, child, …) without touching items that don't use them.
 */
export interface VariantPrice {
  default: number
  member?: number
}

/**
 * Resolve a `VariantPrice` for a given customer tier. `DiscountLevel`
 * `"none"` maps to `default` (un-discounted baseline). Other tiers fall
 * back to `default` when the override is not set on the variant.
 */
export function priceForTier(price: VariantPrice, tier: DiscountLevel): number {
  if (tier === "member" && typeof price.member === "number") return price.member
  return price.default
}

/**
 * A concrete purchase option on a catalog item. SDK-agnostic (no firebase
 * coupling), so functions, the web apps, and the printer package share one
 * definition — the web `CatalogItemDoc` re-exports this.
 */
export interface CatalogVariant {
  /** Stable within the item, e.g. "default", "m2", "a3". */
  id: string
  /** Display label; only meaningful when an item has >1 variant. */
  label?: string | null
  pricingModel: PricingModel
  unitPrice: VariantPrice
}

export const USER_TYPE_LABELS: Record<UserType, string> = {
  erwachsen: "Erwachsen",
  kind: "Kind (u. 18)",
  firma: "Firma",
}

export const USAGE_TYPE_LABELS: Record<UsageType, string> = {
  regular: "Reguläre Nutzung",
  ermaessigt: "Ermässigte Nutzung (KulturLegi)",
  materialbezug: "Begleitung / nur Materialbezug",
  intern: "Interne Nutzung",
  hangenmoos: "Hangenmoos AG",
  volunteering: "Freiwilligengruppe",
}

/**
 * Short German reason shown on a discounted section line ("…wird nicht
 * verrechnet (Freiwilligengruppe)"). Only set for usage types that waive
 * at least one section; `regular` has no discount and so no label.
 *
 * Marco's complaint (issue #284) was that an `intern` checkout silently
 * showed the line items at full price but a CHF 0.00 total — the discount
 * was invisible. The renderer uses this to spell out *why* a section was
 * waived on the section itself, rather than as a mystery negative line.
 */
export const USAGE_DISCOUNT_LABELS: Partial<Record<UsageType, string>> = {
  ermaessigt: "Ermässigung",
  materialbezug: "Begleitung / nur Materialbezug",
  hangenmoos: "Hangenmoos AG",
  volunteering: "Freiwilligengruppe",
  intern: "Interne Nutzung",
}

/**
 * Display order of the usage types in the per-person Nutzungsart control
 * (issues #570, #605): the common case first, then Begleitung (the reason
 * the choice moved to the check-in), the discounts, and the owner-only
 * types last. `Object.keys(USAGE_TYPE_LABELS)` order is *not* the display
 * order.
 */
export const USAGE_TYPE_ORDER: readonly UsageType[] = [
  "regular",
  "materialbezug",
  "ermaessigt",
  "hangenmoos",
  "volunteering",
  "intern",
]

/**
 * What the checkout tells the visitor about each usage type (issue #570).
 * Kept next to {@link USAGE_TYPE_DISCOUNTS} on purpose: `effect` is the
 * human sentence for that discount row and `pricing.test.ts` asserts the
 * two agree, so a multiplier change cannot silently desync from its
 * description.
 */
export interface UsageTypeInfo {
  /**
   * Price effect shown on the selected value and on each option, e.g.
   * "Nutzungsgebühr wird nicht verrechnet". Empty for the undiscounted
   * `regular` type — the UI renders no effect line then.
   */
  effect: string
  /** Who the type is for, as a sentence about the person ("Arbeitet …"). */
  appliesTo: string
  /**
   * Only on the identified person's own line, and only while they are alone
   * on the visit (issues #570, #605): the club needs to know *who* claimed
   * to be a volunteer / on an internal project, and the type waives
   * machines (and material) for the whole visit.
   */
  ownerOnly: boolean
}

export const USAGE_TYPE_INFO: Record<UsageType, UsageTypeInfo> = {
  regular: {
    effect: "",
    appliesTo: "Arbeitet heute in der Werkstatt.",
    ownerOnly: false,
  },
  ermaessigt: {
    effect: "50% Ermässigung auf Nutzungsgebühr",
    appliesTo: "Mit gültiger KulturLegi.",
    ownerOnly: false,
  },
  hangenmoos: {
    effect: "Nutzungsgebühr wird nicht verrechnet",
    appliesTo: "Wohnt in einer Wohnung der Hangenmoos AG.",
    ownerOnly: false,
  },
  materialbezug: {
    // Machine usage is impossible here (guarded server-side), so the
    // machine multiplier of 0 is not worth a word to the visitor.
    effect: "Nutzungsgebühr wird nicht verrechnet",
    appliesTo:
      "Begleitet jemanden oder holt nur Material bzw. einen fertigen 3D-Druck ab.",
    ownerOnly: false,
  },
  volunteering: {
    effect: "Nutzungsgebühr und Maschinen werden nicht verrechnet",
    appliesTo: "Betreut heute eine Werkstatt und arbeitet am eigenen Projekt.",
    ownerOnly: true,
  },
  intern: {
    effect: "Nutzungsgebühr, Maschinen und Material werden nicht verrechnet",
    appliesTo: "Arbeitet an einem Projekt für die OWW.",
    ownerOnly: true,
  },
}

/** Freiwilligengruppe / Interne Nutzung: the identified person's alone (CHK-32). */
export function isOwnerOnlyUsage(usageType: UsageType): boolean {
  return USAGE_TYPE_INFO[usageType]?.ownerOnly ?? false
}

/** Why an owner-only type can't be picked while others are on the visit. */
export const OWNER_ONLY_OTHERS_REASON =
  "Nicht wählbar, solange weitere Personen erfasst sind."

export interface UsageTypeOption {
  type: UsageType
  /** Set when the option is shown but not selectable, with the reason. */
  disabledReason?: string
}

/**
 * The Nutzungsart options of one person on the check-in (issue #605), in
 * display order. The owner-only types appear only on the identified
 * person's own line — never for a guest check-in — and are disabled while
 * anyone else is on the visit; `current` is always kept so a rehydrated
 * selection can still be displayed.
 */
export function personUsageOptions(opts: {
  isOwner: boolean
  anonymous: boolean
  othersPresent: boolean
  current?: UsageType
}): UsageTypeOption[] {
  const ownerLine = opts.isOwner && !opts.anonymous
  return USAGE_TYPE_ORDER.filter(
    (t) => t === opts.current || !isOwnerOnlyUsage(t) || ownerLine,
  ).map((type) =>
    isOwnerOnlyUsage(type) && opts.othersPresent
      ? { type, disabledReason: OWNER_ONLY_OTHERS_REASON }
      : { type },
  )
}

/** A checkout person as far as the usage type is concerned. */
export interface UsagePerson {
  usageType?: UsageType | null
  /** The identified person's own line (the checkout owner). */
  isOwner?: boolean
}

/**
 * A person's usage type. Checkouts from before issue #605 carry a single
 * top-level type; `fallback` (that type) stands in for persons without one.
 */
export function personUsageType(
  person: Pick<UsagePerson, "usageType">,
  fallback: UsageType = "regular",
): UsageType {
  return person.usageType ?? fallback
}

/**
 * The visit's usage type, derived from its persons (issue #605, CHK-29):
 * the owner's Freiwilligengruppe / Interne Nutzung; otherwise Begleitung /
 * nur Materialbezug when every person has it; otherwise Reguläre Nutzung.
 * It decides machine time and material — each person's usage fee follows
 * their own type. It does NOT mark a checkout as purchase-only; that is
 * `purchaseOnly` (see `isPurchaseOnly`).
 */
export function deriveVisitUsageType(
  persons: readonly UsagePerson[],
  fallback: UsageType = "regular",
): UsageType {
  const owner = persons.find((p) => p.isOwner)
  if (owner) {
    const t = personUsageType(owner, fallback)
    if (isOwnerOnlyUsage(t)) return t
  }
  if (
    persons.length > 0 &&
    persons.every((p) => personUsageType(p, fallback) === "materialbezug")
  ) {
    return "materialbezug"
  }
  return "regular"
}

/**
 * Machine time can't be billed when every person only accompanies or buys
 * material (CHK-8): the visit's type would waive it. Check Out shows the
 * error and the server refuses the close.
 */
export function machineUsageBlocked(
  persons: readonly UsagePerson[],
  hasMachineUsage: boolean,
  fallback: UsageType = "regular",
): boolean {
  return (
    hasMachineUsage &&
    persons.length > 0 &&
    persons.every((p) => personUsageType(p, fallback) === "materialbezug")
  )
}

/**
 * What the person closing the checkout confirms about one person with a
 * discounted usage type (CHK-30), in du-form for themselves and by first
 * name for anyone else. Null for Reguläre Nutzung.
 */
export function usageDeclaration(
  usageType: UsageType,
  person: { firstName: string; isSelf: boolean },
): string | null {
  const name = person.firstName.trim() || "Diese Person"
  const self = person.isSelf
  switch (usageType) {
    case "materialbezug":
      return self
        ? "Du arbeitest heute nicht selbst in der Werkstatt."
        : `${name} arbeitet heute nicht selbst in der Werkstatt.`
    case "ermaessigt":
      return self
        ? "Du hast eine gültige KulturLegi dabei."
        : `${name} hat eine gültige KulturLegi dabei.`
    case "hangenmoos":
      return self
        ? "Du wohnst in einer Wohnung der Hangenmoos AG."
        : `${name} wohnt in einer Wohnung der Hangenmoos AG.`
    case "volunteering":
      return "Du bist heute als Werkstattbetreuung im Einsatz."
    case "intern":
      return "Du arbeitest an einem OWW-internen Projekt."
    default:
      return null
  }
}
