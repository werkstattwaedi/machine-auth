import { DocumentReference, Timestamp } from "firebase-admin/firestore";

import type {
  DiscountLevel,
  ItemType,
  PricingModel,
  UsageType,
  VariantPrice,
} from "@oww/shared";
export {
  priceForTier,
  type DiscountLevel,
  type ItemType,
  type PricingModel,
  type UsageType,
  type VariantPrice,
} from "@oww/shared";

/**
 * Firestore entity type definitions
 * These represent the actual shape of documents in Firestore
 */

export interface BillingAddress {
  company: string;
  street: string;
  zip: string;
  city: string;
}

export interface UserEntity {
  created: Timestamp;
  firstName: string;
  lastName: string;
  email?: string | null; // null for child accounts (no Firebase Auth credentials)
  permissions: DocumentReference[]; // References to /permission/{permissionId}
  roles: string[];
  termsAcceptedAt?: Timestamp | null;
  userType?: "erwachsen" | "kind" | "firma";
  // Denormalized pointer to the user's single active membership; maintained
  // by onMembershipWritten + the daily expiry job. `null` → not a member.
  activeMembership?: DocumentReference | null;
  billingAddress?: BillingAddress | null; // Required when userType == "firma"
}

export interface TokenEntity {
  userId: DocumentReference; // Reference to /users/{userId}
  registered: Timestamp;
  deactivated?: Timestamp;
  label: string;
  // Last observed SDM read counter (24-bit). Updated atomically in
  // verifyTagCheckout to defend against URL replay. Absent on tokens that
  // predate the replay-defense rollout (treated as 0).
  lastSdmCounter?: number;
}

export interface PermissionEntity {
  name: string;
}

export interface MachineEntity {
  name: string;
  workshop: string; // Workshop ID (e.g., "holz", "metall")
  checkoutTemplateId: DocumentReference; // Reference to /catalog/{itemId}
  requiredPermission: DocumentReference[]; // References to /permission/{permissionId}
  maco: DocumentReference; // Reference to /maco/{deviceId}
  control: Record<string, unknown>;
}

export interface MaCoEntity {
  name: string;
}

/**
 * Authentication entity for NTAG424 3-pass mutual auth.
 * Created during AuthenticateTag, completed during CompleteTagAuth.
 */
export interface AuthenticationEntity {
  tokenId: DocumentReference; // Reference to /tokens/{tokenId}
  keySlot: number; // Which key was used (0-4)
  created: Timestamp;

  // Crypto state - set to null once auth completes successfully
  inProgressAuth: {
    rndA: Uint8Array; // Cloud-generated random (RndA)
    rndB: Uint8Array; // Tag's random after decryption (RndB)
  } | null;

  // Firestore TTL marker. Set to created + 5 min on creation so abandoned
  // in-progress auth docs (firmware crash, lost power) get auto-deleted.
  // Cleared (set to null) on successful completion to retain the record.
  ttlAt?: Timestamp | null;
}

/**
 * Usage entity for machine usage tracking (audit trail).
 */
export interface UsageMachineEntity {
  userId: DocumentReference; // Reference to /users/{userId}
  authenticationId: DocumentReference | null; // Reference to /authentications/{authId}
  machine: DocumentReference; // Reference to /machine/{machineId}
  startTime: Timestamp;
  endTime: Timestamp;
  endReason?: string; // JSON of CheckOutReason
  checkoutItemRef?: DocumentReference; // Reference to /checkouts/{checkoutId}/items/{itemId} when billed
  workshop?: string | null; // Denormalized from machine
}

// --- Catalog ---

// PricingModel, DiscountLevel, VariantPrice, and priceForTier are re-exported
// from `@oww/shared` at the top of this file — they live there because the
// web app and (future) printer encoder need the same definitions, and the
// types have no firebase SDK coupling.

export interface CatalogVariant {
  id: string;                            // stable within the item, e.g. "default", "m2", "zuschnitt-a3", "single", "family"
  // Display label (e.g. "Per m²", "Zuschnitt A3"). Only meaningful when
  // an item has more than one variant; single-variant items rely on the
  // catalog `name` to describe themselves and leave `label` unset.
  label?: string | null;
  pricingModel: PricingModel;
  unitPrice: VariantPrice;
}

/**
 * Doc at `config/catalog-references`. Singleton lookup table for catalog
 * items referenced by production code. The seed writes this alongside
 * the catalog; ops can rebind a reference (e.g. roll a new membership
 * SKU mid-year) without a code deploy.
 */
export interface CatalogReferencesEntity {
  /** The Mitgliedschaft catalog item (variants: "single", "family"). */
  membership: DocumentReference;
}

export interface CatalogEntity {
  code: string;
  name: string;
  workshops: string[];
  /**
   * Root-to-leaf category path. Free-form values, not pre-registered;
   * queryable with `array-contains` at any depth. The picker derives the
   * chip tree from the values present among items in the current scope.
   */
  category: string[];
  active: boolean;
  userCanAdd: boolean;
  /**
   * What this item is, for billing-section bucketing (issue #105). Absent
   * means `material`. Machine catalog items (manual-hour entry / NFC usage)
   * carry `machine`.
   */
  type?: ItemType;
  description?: string | null;
  /**
   * 1..n purchase options. `variants[0]` is canonical: the picker uses it
   * silently when length == 1; auto-bill flows resolve through it. Array
   * order is meaningful — keep the default first.
   */
  variants: CatalogVariant[];
}

// --- Checkouts ---

export type CheckoutStatus = "open" | "closed";

export interface CheckoutPersonEntity {
  name: string;
  email: string;
  userType: "erwachsen" | "kind" | "firma";
  billingAddress?: {
    company: string;
    street: string;
    zip: string;
    city: string;
  };
  // Set when picked from the signed-in user's family roster — links the
  // visit to a real account (incl. child accounts).
  userRef?: DocumentReference | null;

  // True when this (named) person already paid the daily usage fee on the
  // same Zurich business day (boundary 03:00) via an earlier closed
  // checkout, so their entry fee is waived for this one (issue #268). Only
  // ever set for persons that carry a `userRef` (anonymous/guest persons
  // are always charged). Derived authoritatively at checkout-close time
  // from prior bills — there is no separate denormalized "charged today"
  // record. The invoice PDF reads this flag so the per-person fee it
  // re-derives stays consistent with the billed total.
  entryFeeWaivedToday?: boolean;
}

export interface CheckoutSummaryEntity {
  /** Net amount actually billed (raw sections minus the usage discount). */
  totalPrice: number;
  /**
   * Raw (pre-discount) section amounts. The usage-type discount is applied
   * on top (see {@link discountAmount}); storing raw lets the invoice
   * re-render standard prices with a per-section "waived" note rather than
   * silently showing zero (issue #284). No legacy data to migrate.
   */
  entryFees: number;
  machineCost: number;
  materialCost: number;
  tip: number;
  /**
   * Total discount waived by the usage type:
   * `(entryFees + machineCost + materialCost + tip) - totalPrice`.
   * Zero for `regular`. Issue #284.
   */
  discountAmount?: number;
}

export interface CheckoutEntity {
  userId: DocumentReference; // Reference to /users/{userId}
  status: CheckoutStatus;
  usageType: UsageType;
  created: Timestamp;
  workshopsVisited: string[];
  persons: CheckoutPersonEntity[];
  modifiedBy: string | null;
  modifiedAt: Timestamp;

  // Firebase Auth UID of the user who created this checkout. Set to
  // `request.auth.uid` for every client-side create (anonymous OR
  // signed-in Firebase Auth). Stable across the checkout's lifetime —
  // unlike `modifiedBy`, which tracks the last writer — so the
  // abandoned-checkout cleanup job can pair an expired anon auth user
  // with the checkouts they created. Null only for system / admin-SDK
  // writes. Issue #318.
  firebaseUid?: string | null;

  // Set when a bill is created for this checkout
  billRef?: DocumentReference | null;

  // Only present when status == "closed"
  closedAt?: Timestamp;
  notes?: string | null;
  summary?: CheckoutSummaryEntity;

  // Customer's last selected payment-method tab on Step 4 (Bezahlen).
  // Written fire-and-forget on every tab click. Distinct from the bill's
  // paymentMethodConfirmationTime/Source, which mark the commit-time ack
  // and gate the invoice email + membership activation.
  paymentMethod?: PaymentMethod | null;
}

export type PaymentMethod = "rechnung" | "monthly" | "twint";

export type ItemOrigin = "nfc" | "manual" | "qr";

export interface CheckoutItemEntity {
  workshop: string;
  description: string;
  origin: ItemOrigin;
  /**
   * Billing-section classification (issue #105). Absent means `material`.
   * Authoritative for machine-vs-material bucketing — see `isMachineItem`.
   */
  type?: ItemType;
  catalogId: DocumentReference | null; // Reference to /catalog/{itemId}, null for free-form
  /** Matches catalog.variants[i].id when catalogId is set; null for ad-hoc origin="manual" / "qr". */
  variantId?: string | null;
  created: Timestamp;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  formInputs?: { quantity: number; unit: string }[];
  pricingModel?: PricingModel | null;
}

// --- Memberships ---

export type MembershipType = "single" | "family";
export type MembershipStatus = "active" | "expired" | "cancelled";

export interface MembershipEntity {
  type: MembershipType;
  status: MembershipStatus;
  lastPaidAt: Timestamp | null;
  validUntil: Timestamp;
  ownerUserId: DocumentReference; // Reference to /users/{userId}
  members: DocumentReference[]; // References to /users/{userId}[]
  paymentCheckouts: DocumentReference[]; // References to /checkouts/{id}[]
  // Annual auto-renewal flag (issue #323). Missing value is treated as
  // true so legacy docs keep renewing until explicitly cancelled.
  autoRenew?: boolean;
  // Open renewal bill while a renewal invoice is outstanding; non-null
  // makes the daily renewalInvoicer cron skip this membership. Cleared
  // to null once the renewal is paid (applyMembershipPayment).
  pendingRenewalBill?: DocumentReference | null;
  notes?: string | null;
  created?: Timestamp;
  createdBy?: string | null;
  modifiedBy?: string | null;
  modifiedAt?: Timestamp;
}

export type MembershipInviteStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "revoked";

export interface MembershipInviteEntity {
  email: string; // normalized lowercase
  status: MembershipInviteStatus;
  invitedAt: Timestamp;
  invitedBy: DocumentReference; // Reference to /users/{userId}
  resolvedAt: Timestamp | null;
  resolvedUserId?: DocumentReference | null;
  ttlAt: Timestamp;
}
