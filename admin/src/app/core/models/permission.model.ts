/**
 * Permission document structure matching Firestore schema
 */
export interface PermissionDocument {
  name: string; // Human readable permission name (e.g., "Laser Cutter")
}

export interface PermissionWithId extends PermissionDocument {
  id: string; // Firestore document ID
}
