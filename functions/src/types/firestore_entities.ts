import { DocumentReference, Timestamp } from "firebase-admin/firestore";

/**
 * Firestore entity type definitions
 * These represent the actual shape of documents in Firestore
 */

export interface UserEntity {
  created: Timestamp;
  firebaseUid?: string;
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
