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
 * application-side `UserDoc` (with derived `displayName`, resolved
 * `permissions: string[]`) lives in `auth.tsx` and is built from this.
 */
export interface UserDoc extends AuditFields {
  created?: Timestamp
  email: string
  displayName: string | null
  firstName: string
  lastName: string
  permissions: DocumentReference<PermissionDoc>[]
  roles: string[]
  termsAcceptedAt?: Timestamp | null
  userType?: "erwachsen" | "kind" | "firma"
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

export type PricingModel =
  | "time"
  | "area"
  | "length"
  | "count"
  | "weight"
  | "direct"
  | "sla"

export type DiscountLevel = "none" | "member" | "intern"

export interface CatalogItemDoc extends AuditFields {
  code: string
  name: string
  workshops: string[]
  pricingModel: PricingModel
  unitPrice: Record<DiscountLevel, number>
  active: boolean
  userCanAdd: boolean
  description?: string | null
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
  | "materialbezug"
  | "intern"
  | "hangenmoos"

export interface CheckoutDoc extends AuditFields {
  userId: DocumentReference<UserDoc>
  status: "open" | "closed"
  usageType: CheckoutUsageType | string
  created: Timestamp
  workshopsVisited: string[]
  persons: CheckoutPersonDoc[]
  billRef?: DocumentReference<BillDoc> | null
  closedAt?: Timestamp
  notes?: string | null
  summary?: CheckoutSummaryDoc
}

export interface CheckoutItemDoc extends AuditFields {
  workshop: string
  description: string
  origin: "nfc" | "manual" | "qr"
  catalogId: DocumentReference<CatalogItemDoc> | null
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
  paidVia?: "twint" | "ebanking" | "cash" | null
  pdfGeneratedAt?: Timestamp | null
  emailSentAt?: Timestamp | null
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

export type ConfigDoc = PricingConfigDoc | Record<string, unknown>
