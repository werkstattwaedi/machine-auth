export interface UserDocument {
  firebaseUid?: string; // Present if account is claimed
  email: string;
  displayName: string;
  name?: string;
  created: Date;
  roles: string[]; // e.g., ['admin', 'vereinsmitglied']
  permissions: string[]; // Array of permission IDs
}

export interface UserWithId extends UserDocument {
  id: string;
}
