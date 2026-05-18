import { DocumentReference, Timestamp } from "firebase-admin/firestore";

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

export type PricingModel = "time" | "area" | "length" | "count" | "weight" | "direct" | "sla";
export type DiscountLevel = "none" | "member";

/**
 * Per-variant price. `default` is mandatory and is what an un-discounted
 * customer pays. Any additional tier (today only `member`) is an optional
 * override; if absent, the default applies. Schema-extensible to future
 * tiers (volunteer, child, …) without touching items that don't use them.
 */
export interface VariantPrice {
  default: number;
  member?: number;
}

/**
 * Resolve a `VariantPrice` for a given customer tier. `DiscountLevel`
 * `"none"` maps to `default` (un-discounted baseline). Other tiers fall
 * back to `default` when the override is not set on the variant.
 */
export function priceForTier(price: VariantPrice, tier: DiscountLevel): number {
  if (tier === "member" && typeof price.member === "number") return price.member;
  return price.default;
}

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
export type UsageType =
  | "regular"
  | "ermaessigt"
  | "materialbezug"
  | "intern"
  | "hangenmoos";

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
}

export interface CheckoutSummaryEntity {
  totalPrice: number;
  entryFees: number;
  machineCost: number;
  materialCost: number;
  tip: number;
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

  // Set when a bill is created for this checkout
  billRef?: DocumentReference | null;

  // Only present when status == "closed"
  closedAt?: Timestamp;
  notes?: string | null;
  summary?: CheckoutSummaryEntity;
}

export type ItemOrigin = "nfc" | "manual" | "qr";

export interface CheckoutItemEntity {
  workshop: string;
  description: string;
  origin: ItemOrigin;
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
