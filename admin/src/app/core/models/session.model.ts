import { DocumentReference, Timestamp } from '@angular/fire/firestore';

/**
 * Usage record within a session
 */
export interface UsageRecord {
  machine: DocumentReference; // Reference to /machine/{machineId}
  checkIn: Timestamp;
  checkOut?: Timestamp;
  metadata?: string; // JSON representation of checkout reason
}

/**
 * Session document from Firestore
 */
export interface SessionDocument {
  userId: DocumentReference; // Reference to /users/{userId}
  tokenId: DocumentReference; // Reference to /tokens/{tokenId}
  startTime: Timestamp;
  rndA?: {
    _byteString: string; // Base64 encoded random bytes
  };
  usage: UsageRecord[];
  closed?: {
    time: Timestamp;
    metadata: string; // JSON representation of how session was closed
  };
}

/**
 * Session with ID
 */
export interface SessionWithId extends SessionDocument {
  id: string;
}

/**
 * Summary of usage for checkout display
 */
export interface UsageSummary {
  totalSessions: number;
  machineUsage: MachineUsageSummary[];
  totalDurationMinutes: number;
}

/**
 * Usage summary per machine
 */
export interface MachineUsageSummary {
  machineId: string;
  machineName: string;
  usageCount: number; // Number of check-ins
  totalDurationMinutes: number;
}
