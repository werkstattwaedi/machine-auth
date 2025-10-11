import { Timestamp } from '@angular/fire/firestore';

/**
 * Token (NFC tag) document structure matching Firestore schema
 */
export interface TokenDocument {
  userId: string; // Reference to owning user (stored as path in Firestore)
  registered: Timestamp | Date; // Time the token was added
  deactivated?: Timestamp | Date; // Optional: when set, token is deactivated
  label: string; // Token label (e.g., "Key 1", "Main Card")
}

export interface TokenWithId extends TokenDocument {
  id: string; // NTag UID (e.g., "04c339aa1e1890")
}
