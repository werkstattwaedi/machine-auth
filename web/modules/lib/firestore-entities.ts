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
  CatalogVariant,
  DiscountLevel,
  ItemType,
  PricingModel,
} from "@oww/shared"
export type {
  CatalogVariant,
  DiscountLevel,
  ItemType,
  PricingModel,
  VariantPrice,
} from "@oww/shared"

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

/**
 * Admin block on a machine. Absent/null = frei. `kind` distinguishes a
 * defect ("problem") from planned "maintenance" so the list can show the
 * right status. Set/cleared from the admin machine page; the terminal
 * denies sessions on blocked machines.
 */
export interface MachineBlockedDoc {
  kind: "problem" | "maintenance"
  note: string | null
  /** Display name of the admin who blocked — shown as "durch …". */
  byName: string | null
  at: Timestamp
}

export interface MachineDoc extends AuditFields {
  name: string
  workshop?: string
  checkoutTemplateId?: DocumentReference<CatalogItemDoc>
  requiredPermission: DocumentReference<PermissionDoc>[]
  maco?: DocumentReference<MacoDoc> | null
  control?: Record<string, unknown>
  blocked?: MachineBlockedDoc | null
}

// ── machine_reports ──────────────────────────────────────────────────────

/**
 * User-submitted machine issue report ("Meldung"). Members file these
 * (rules: public create); admins triage them on the machine page and
 * mark them done. `userId` is set for signed-in reporters, otherwise the
 * free-text `reporterName` (or neither, for anonymous kiosk reports).
 */
export interface MachineReportDoc {
  machine: DocumentReference<MachineDoc>
  message: string
  userId?: DocumentReference<UserDoc> | null
  reporterName?: string | null
  created: Timestamp
  status: "open" | "done"
  resolvedAt?: Timestamp | null
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

// PricingModel, DiscountLevel, VariantPrice, and CatalogVariant are
// re-exported from `@oww/shared` at the top of this file — they live there
// because both functions and the (future) printer-encoder package consume
// them, and they have no firebase SDK coupling.

export interface CatalogItemDoc extends AuditFields {
  code: string
  name: string
  /**
   * Curated label fields from Mario's pricelist (`Etikett Name` /
   * `Etikett Mass`), stored verbatim for the label printer (#313/#314). The
   * display `name` is composed from these on import. Absent on items not sourced
   * from the pricelist import.
   */
  labelName?: string
  labelMass?: string
  workshops: string[]
  /**
   * Root-to-leaf category path. Free-form values, not pre-registered;
   * queryable with `array-contains` at any depth. The picker derives the
   * chip tree from the values present among items in the current scope.
   */
  category: string[]
  active: boolean
  userCanAdd: boolean
  /**
   * What this item is, for billing-section bucketing (issue #105). Absent
   * means `material`. Machine catalog items (manual-hour entry / NFC usage)
   * carry `machine`.
   */
  type?: ItemType
  description?: string | null
  /**
   * The stored base variant(s). `variants[0]` is canonical: the picker uses
   * it silently when there are no derived variants; auto-bill flows resolve
   * through it. Additional purchase options are *derived* at read time from
   * {@link variantIds} — call `resolveVariants(item)` (`@oww/shared`) to get
   * the full list. In practice `variants` holds just the base entry.
   */
  variants: CatalogVariant[]
  /**
   * Ids of shared variant definitions (`VARIANT_DEFINITIONS` in `@oww/shared`)
   * that apply to this item — e.g. laser cut sizes `["a3","320-620"]`. Each
   * derives a purchase option priced `base × factor`. Absent/empty means the
   * item has only its base variant.
   */
  variantIds?: string[]
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
  /**
   * When the PDF was last generated. Compared against the listed catalog
   * items' `modifiedAt` to flag the printed Aushang as "veraltet".
   * Absent on lists never generated.
   */
  generatedAt?: Timestamp | null
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
  /** Net amount actually billed (raw sections minus the usage discount). */
  totalPrice: number
  /**
   * Raw (pre-discount) section amounts. The usage-type discount is applied
   * on top (see {@link discountAmount}); storing raw lets the invoice
   * re-render the standard prices with a per-section "waived" note instead
   * of silently showing zero (issue #284). No legacy data to migrate.
   */
  entryFees: number
  machineCost: number
  materialCost: number
  tip: number
  /**
   * Total discount waived by the usage type, i.e.
   * `(entryFees + machineCost + materialCost + tip) - totalPrice`.
   * Zero for `regular`. Stored so downstream consumers don't have to
   * re-derive the multiplier table. Issue #284.
   */
  discountAmount?: number
}

export type CheckoutUsageType =
  | "regular"
  | "ermaessigt"
  | "materialbezug"
  | "intern"
  | "hangenmoos"
  | "volunteering"

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
  /**
   * Firebase Auth UID of the user who created this checkout. Set to
   * `request.auth.uid` for every client-side create (anonymous OR
   * signed-in Firebase Auth). Stable across the doc's lifetime (unlike
   * `modifiedBy`, which tracks the last writer) so the cleanup job can
   * pair an expired anon auth user with the checkouts they created.
   * Null only for system / admin-SDK writes. Issue #318.
   */
  firebaseUid?: string | null
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
  /**
   * Billing-section classification (issue #105). Absent means `material`.
   * Authoritative for machine-vs-material bucketing — see `isMachineItem`.
   */
  type?: ItemType
  catalogId: DocumentReference<CatalogItemDoc> | null
  /** Matches catalog.variants[i].id when catalogId is set; null for ad-hoc origin="manual" / "qr". */
  variantId?: string | null
  created: Timestamp
  quantity: number
  unitPrice: number
  totalPrice: number
  formInputs?: { quantity: number; unit: string }[] | null
  pricingModel?: PricingModel | string | null
  /**
   * Self-service badge purchase (server-written ONLY — firestore.rules deny
   * these fields on client writes): the tapped badge's token id, carried on
   * the line item until checkout close associates `tokens/{tokenId}` with
   * the checkout's user.
   */
  tokenId?: string
  /** SDM counter of the purchase tap; stamped into the token doc at association. */
  badgeSdmCounter?: number
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
  // "invoice" = real, payable QR-bill. "beleg" = per-visit record for a
  // member who picked Sammelrechnung — the payable QR-bill is emitted as
  // the aggregated monthly Sammelrechnung (`aggregatedIntoBillRef`) on the
  // 1st. Missing `kind` is treated as "invoice" so legacy docs
  // migrate-free. Mirrors `BillEntity.kind` in
  // functions/src/invoice/types.ts. Issue #245/#405.
  kind?: "invoice" | "beleg"
  // Set on a `kind: "beleg"` once monthlyBillRun has folded it into a
  // monthly `kind: "invoice"`. Mirrors `BillEntity.aggregatedIntoBillRef`.
  aggregatedIntoBillRef?: DocumentReference<BillDoc> | null
  // Origin discriminator (issue #323). Missing value is treated as
  // "checkout" so legacy docs migrate-free.
  source?: "checkout" | "membership-renewal"
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
  // Annual auto-renewal flag (issue #323). Missing value is treated as
  // true so legacy docs keep renewing until explicitly cancelled.
  autoRenew?: boolean
  // Open renewal bill while a renewal invoice is outstanding; cleared to
  // null once the renewal is paid.
  pendingRenewalBill?: DocumentReference<BillDoc> | null
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

// ── printJobs ────────────────────────────────────────────────────────────

export type PrintJobStatus = "queued" | "printing" | "done" | "error"

/**
 * Label print job. The admin web app renders the label and builds the
 * Brother raster bytes client-side, then writes one of these as `queued`.
 * The on-LAN gateway (maco_gateway) watches for queued jobs via a Firestore
 * listener, sends the bytes to the printer, and writes the terminal
 * `status` (+ German `error` on failure) back, which the admin UI awaits.
 * See ADR / the printing-via-gateway plan. Auto-deleted via the `ttlAt`
 * TTL policy declared in firestore.indexes.json.
 */
export interface PrintJobDoc {
  /** base64-encoded Brother raster job (`buildRasterJob` output). */
  bytesB64: string
  /** Tape width used to build the job, e.g. "18mm". Informational. */
  tape: string
  status: PrintJobStatus
  /** German printer error (ported `parseStatus`) when status == "error". */
  error?: string | null
  /** Firebase Auth UID of the admin who enqueued the job. */
  createdBy: string
  createdAt: Timestamp
  /** Firestore TTL field — auto-delete ~1h after creation. */
  ttlAt: Timestamp
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
  /**
   * Catalog IDs shown with an always-visible hours input in this
   * workshop's machine section on the cost step, while no MaCo is deployed
   * (issue #105). References, not embedded prices — the catalog stays the
   * source of truth for label/price/type.
   */
  pinnedMachines?: string[]
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
 */
export interface CatalogReferencesDoc extends AuditFields {
  /** The Mitgliedschaft catalog item (variants: "single", "family"). */
  membership: DocumentReference<CatalogItemDoc>
  /** The NFC-Badge catalog item (variants: "standard", "gratis"). */
  badge?: DocumentReference<CatalogItemDoc>
}

export type ConfigDoc =
  | PricingConfigDoc
  | CatalogReferencesDoc
  | Record<string, unknown>
