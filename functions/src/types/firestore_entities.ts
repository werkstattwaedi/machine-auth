import { DocumentReference, Timestamp } from "firebase-admin/firestore";

/**
 * Firestore entity type definitions
 * These represent the actual shape of documents in Firestore
 */

export interface UserEntity {
  created: Timestamp;
  displayName: string;
  name: string;
  permissions: DocumentReference[]; // References to /permission/{permissionId}
  roles: string[];
}

export interface TokenEntity {
  userId: DocumentReference; // Reference to /users/{userId}
  registered: Timestamp;
  deactivated?: Timestamp;
  label: string;
}

export interface SessionEntity {
  userId: DocumentReference; // Reference to /users/{userId}
  tokenId: DocumentReference; // Reference to /tokens/{tokenId}
  startTime: Timestamp;
  rndA?: Uint8Array; // Cloud-generated random bytes for authentication
  usage: UsageRecordEntity[];
  closed?: {
    time: Timestamp;
    metadata: string; // JSON string
  };
}

export interface UsageRecordEntity {
  machine: DocumentReference; // Reference to /machine/{machineId}
  checkIn: Timestamp;
  checkOut: Timestamp;
  metadata: string; // JSON string
}

export interface PermissionEntity {
  name: string;
}

export interface MachineEntity {
  name: string;
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
 * Usage entity for machine usage tracking.
 */
export interface UsageEntity {
  userId: DocumentReference; // Reference to /users/{userId}
  authenticationId: DocumentReference; // Reference to /authentications/{authId}
  machine: DocumentReference; // Reference to /machine/{machineId}
  checkIn: Timestamp;
  checkOut?: Timestamp;
  checkOutReason?: string; // JSON of CheckOutReason
  checkout?: DocumentReference; // Reference to /checkouts/{checkoutId} when paid
}

/**
 * Checkout entity for payment tracking.
 */
export interface CheckoutEntity {
  userId: DocumentReference; // Reference to /users/{userId}
  time: Timestamp;
  totalPrice: number;
}
