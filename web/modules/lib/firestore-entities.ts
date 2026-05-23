// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Single source of truth for the Firestore document shapes used by the web
 * apps. Every collection has:
 *   - an exported `*Doc` interface describing the wire format
 *   - a `*Doc` builder in `firestore-helpers.ts` that returns a typed
 *     `DocumentReference<*Doc>` / `CollectionReference<*Doc>`
 *
 * The shape mirrors `firestore/schema.jsonc`. Whenever the schema changes,
 * update both files together — the schema is the canonical contract and
 * these types are how the app reads/writes against it.
 */

import type {
  DocumentReference,
  Timestamp,
} from "firebase/firestore"

import type {
  DiscountLevel,
  PricingModel,
  VariantPrice,
} from "@oww/shared"
export type { DiscountLevel, PricingModel, VariantPrice } from "@oww/shared"

// ── Cross-cutting ────────────────────────────────────────────────────────

/**
 * Audit fields automatically stamped by `useFirestoreMutation` on every
 * write. Optional on the read side because legacy/seeded docs may predate
 * the wrapper.
 */
export interface AuditFields {
  modifiedBy?: string | null
  modifiedAt?: Timestamp
}

// ── users ────────────────────────────────────────────────────────────────

export interface BillingAddressDoc {
  company: string
  street: string
  zip: string
  city: string
}

/**
 * Wire-format user document. Doc id == Firebase Auth UID. The rich
 * application-side `UserDoc` (with derived `name`, resolved
 * `permissions: string[]`) lives in `auth.tsx` and is built from this.
 *
 * Child accounts (`userType === "kind"`) created by a family owner have
 * `email: null` and a Firebase Auth user with no sign-in credentials.
 */
export interface UserDoc extends AuditFields {
  created?: Timestamp
  email: string | null
  firstName: string
  lastName: string
  /** Optional contact phone — captured for everyone, never required. */
  phone?: string | null
  permissions: DocumentReference<PermissionDoc>[]
  roles: string[]
  termsAcceptedAt?: Timestamp | null
  userType?: "erwachsen" | "kind" | "firma"
  // Denormalized pointer to the user's single active membership. `null` when
  // the user is not a member. The server re-validates `validUntil > now`
  // before granting the member discount, so a stale denorm only ever costs
  // a brief extra read.
  activeMembership?: DocumentReference<MembershipDoc> | null
  /**
   * Postal address. Required for every registered user (street/zip/city);
   * `company` is only set for `userType === "firma"`. Stored under the
   * historic `billingAddress` key so existing reads keep working.
   */
  billingAddress?: BillingAddressDoc | null
}

// ── permission ───────────────────────────────────────────────────────────

export interface PermissionDoc extends AuditFields {
  name: string
  description?: string | null
  created?: Timestamp
}

// ── machine ──────────────────────────────────────────────────────────────

export interface MachineDoc extends AuditFields {
  name: string
  workshop?: string
  checkoutTemplateId?: DocumentReference<CatalogItemDoc>
  requiredPermission: DocumentReference<PermissionDoc>[]
  maco?: DocumentReference<MacoDoc> | null
  control?: Record<string, unknown>
}

// ── maco ─────────────────────────────────────────────────────────────────

export interface MacoDoc extends AuditFields {
  name: string
  hwRevision?: string | null
}

// ── tokens ───────────────────────────────────────────────────────────────

export interface TokenDoc extends AuditFields {
  userId: DocumentReference<UserDoc>
  registered?: Timestamp
  deactivated?: Timestamp | null
  label?: string
  lastSdmCounter?: number
}

// ── usage_machine ────────────────────────────────────────────────────────

export interface UsageMachineDoc extends AuditFields {
  userId: DocumentReference<UserDoc>
  authenticationId?: DocumentReference | null
  machine: DocumentReference<MachineDoc>
  startTime?: Timestamp
  endTime?: Timestamp
  endReason?: string | null
  checkoutItemRef?: DocumentReference<CheckoutItemDoc> | null
  workshop?: string
}

// ── catalog ──────────────────────────────────────────────────────────────

// PricingModel, DiscountLevel, and VariantPrice are re-exported from
// `@oww/shared` at the top of this file — they live there because both
// functions and the (future) printer-encoder package consume them, and
// they have no firebase SDK coupling.

export interface CatalogVariant {
  /** Stable within the item, e.g. "default", "m2", "zuschnitt-a3", "single", "family". */
  id: string
  /**
   * Display label, e.g. "Per m²", "Zuschnitt A3", "Einzel (Jahr)". Only
   * meaningful when an item has more than one variant; for single-variant
   * items the catalog `name` already carries everything. Picker UI gates
   * variant-selector rendering on `variants.length > 1`; inline rows
   * append the label after the item name only when it's set.
   */
  label?: string | null
  pricingModel: PricingModel
  unitPrice: VariantPrice
}

export interface CatalogItemDoc extends AuditFields {
  code: string
  name: string
  workshops: string[]
  /**
   * Root-to-leaf category path. Free-form values, not pre-registered;
   * queryable with `array-contains` at any depth. The picker derives the
   * chip tree from the values present among items in the current scope.
   */
  category: string[]
  active: boolean
  userCanAdd: boolean
  description?: string | null
  /**
   * 1..n purchase options. `variants[0]` is canonical: the picker uses it
   * silently when length == 1; auto-bill flows resolve through it. Array
   * order is meaningful — keep the default first.
   */
  variants: CatalogVariant[]
}

// ── price_lists ──────────────────────────────────────────────────────────

/**
 * NOTE: `items` is a list of plain catalog document IDs (strings), not
 * `DocumentReference`s. This is intentional — Firestore's `documentId()`
 * `in` query requires raw IDs, and we materialize the catalog items via
 * that query. See firestore/schema.jsonc.
 */
export interface PriceListDoc extends AuditFields {
  name: string
  items: string[]
  footer: string
  active: boolean
}

// ── checkouts ────────────────────────────────────────────────────────────

export interface CheckoutPersonDoc {
  name: string
  email: string
  userType: "erwachsen" | "kind" | "firma"
  billingAddress?: BillingAddressDoc
  // Set when the person was picked from the signed-in user's family roster,
  // so the visit is attributed to a real account (including child accounts).
  userRef?: DocumentReference<UserDoc> | null
}

export interface CheckoutSummaryDoc {
  totalPrice: number
  entryFees: number
  machineCost: number
  materialCost: number
  tip: number
}

export type CheckoutUsageType =
  | "regular"
  | "ermaessigt"
  | "materialbezug"
  | "intern"
  | "hangenmoos"

/**
 * Customer's last-selected payment method on the Bezahlen step. Written
 * fire-and-forget on every tab click so the workshop has a record of what
 * the user intended even when they leave without committing. The commit-
 * time ack itself lives on the bill (paymentMethodConfirmationTime /
 * paymentMethodConfirmationSource).
 */
export type PaymentMethod = "rechnung" | "monthly" | "twint"

export interface CheckoutDoc extends AuditFields {
  userId: DocumentReference<UserDoc> | null
  status: "open" | "closed"
  usageType: CheckoutUsageType | string
  created: Timestamp
  workshopsVisited: string[]
  persons: CheckoutPersonDoc[]
  billRef?: DocumentReference<BillDoc> | null
  closedAt?: Timestamp
  notes?: string | null
  summary?: CheckoutSummaryDoc
  paymentMethod?: PaymentMethod | null
}

export interface CheckoutItemDoc extends AuditFields {
  workshop: string
  description: string
  origin: "nfc" | "manual" | "qr"
  catalogId: DocumentReference<CatalogItemDoc> | null
  /** Matches catalog.variants[i].id when catalogId is set; null for ad-hoc origin="manual" / "qr". */
  variantId?: string | null
  created: Timestamp
  quantity: number
  unitPrice: number
  totalPrice: number
  formInputs?: { quantity: number; unit: string }[] | null
  pricingModel?: PricingModel | string | null
}

// ── bills ────────────────────────────────────────────────────────────────

export interface BillDoc extends AuditFields {
  userId: DocumentReference<UserDoc>
  checkouts: DocumentReference<CheckoutDoc>[]
  referenceNumber: number
  amount: number
  currency: string
  storagePath: string | null
  created: Timestamp
  paidAt?: Timestamp | null
  paidVia?: "twint" | "ebanking" | "cash" | "free" | null
  pdfGeneratedAt?: Timestamp | null
  emailSentAt?: Timestamp | null
  paymentMethodConfirmationTime?: Timestamp | null
  paymentMethodConfirmationSource?: "user" | "auto" | null
}

// ── memberships ──────────────────────────────────────────────────────────

export type MembershipType = "single" | "family"
export type MembershipStatus = "active" | "expired" | "cancelled"

export interface MembershipDoc extends AuditFields {
  type: MembershipType
  status: MembershipStatus
  lastPaidAt: Timestamp | null
  validUntil: Timestamp
  ownerUserId: DocumentReference<UserDoc>
  members: DocumentReference<UserDoc>[]
  paymentCheckouts: DocumentReference<CheckoutDoc>[]
  notes?: string | null
  created?: Timestamp
  createdBy?: string | null
}

export type MembershipInviteStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "revoked"

export interface MembershipInviteDoc {
  email: string
  status: MembershipInviteStatus
  invitedAt: Timestamp
  invitedBy: DocumentReference<UserDoc>
  resolvedAt: Timestamp | null
  resolvedUserId?: DocumentReference<UserDoc> | null
  // Firestore TTL field — auto-delete pending/rejected/revoked invites after
  // 30 days. Cleared/never set on accepted invites we want to retain.
  ttlAt: Timestamp
}

// ── audit_log ────────────────────────────────────────────────────────────

export interface AuditLogDoc {
  collection: string
  docId: string
  operation: "create" | "update" | "delete"
  actorUid: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  timestamp: Timestamp
}

// ── operations_log ───────────────────────────────────────────────────────

export interface OperationsLogDoc {
  collection: string
  docId: string
  operation: string
  severity: "error" | "warning"
  message: string
  timestamp: Timestamp
}

// ── config (config/pricing) ──────────────────────────────────────────────

export interface PricingEntryFees {
  erwachsen: Record<string, number>
  kind: Record<string, number>
  firma: Record<string, number>
}

export interface WorkshopConfigEntry {
  label: string
  order: number
}

export interface PricingLabels {
  units: Record<string, string>
  discounts: Record<DiscountLevel, string>
}

/**
 * Doc at `config/pricing`. The "config" collection is open-ended; right
 * now we only read this single doc, so the broader doc type is just an
 * alias.
 */
export interface PricingConfigDoc extends AuditFields {
  entryFees: PricingEntryFees
  workshops: Record<string, WorkshopConfigEntry>
  labels: PricingLabels
  slaLayerPrice: Record<DiscountLevel, number>
}

/**
 * Doc at `config/catalog-references`. Singleton lookup table for catalog
 * items referenced by production code. The seed writes this alongside
 * the catalog itself; ops can rebind a reference to a fresh catalog doc
 * (e.g. mid-year membership-price change with a new active SKU) without
 * a code deploy. Mirrors how `config/pricing` decouples fee values from
 * code today.
 *
 * Only `membership` is populated today. The 12 CognitoForms-importer
 * references are added in PR D as a server-only field — the web app
 * doesn't read them, so they can stay outside this doc until needed.
 */
export interface CatalogReferencesDoc extends AuditFields {
  /** The Mitgliedschaft catalog item (variants: "single", "family"). */
  membership: DocumentReference<CatalogItemDoc>
}

export type ConfigDoc =
  | PricingConfigDoc
  | CatalogReferencesDoc
  | Record<string, unknown>
