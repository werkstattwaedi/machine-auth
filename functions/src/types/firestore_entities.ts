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
  displayName?: string | null; // Optional nickname; derived from firstName+lastName if absent
  firstName: string;
  lastName: string;
  email?: string;
  permissions: DocumentReference[]; // References to /permission/{permissionId}
  roles: string[];
  termsAcceptedAt?: Timestamp | null;
  userType?: "erwachsen" | "kind" | "firma";
  billingAddress?: BillingAddress | null; // Required when userType == "firma"
}

export interface TokenEntity {
  userId: DocumentReference; // Reference to /users/{userId}
  registered: Timestamp;
  deactivated?: Timestamp;
  label: string;
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
export type DiscountLevel = "none" | "member" | "intern";

export interface CatalogEntity {
  code: string;
  name: string;
  workshops: string[];
  pricingModel: PricingModel;
  unitPrice: Record<DiscountLevel, number>;
  active: boolean;
  userCanAdd: boolean;
  description?: string | null;
}

// --- Checkouts ---

export type CheckoutStatus = "open" | "closed";
export type UsageType = "regular" | "materialbezug" | "intern" | "hangenmoos";

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
  created: Timestamp;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  formInputs?: { quantity: number; unit: string }[];
  pricingModel?: PricingModel | null;
}
