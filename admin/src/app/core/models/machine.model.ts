import { DocumentReference } from '@angular/fire/firestore';

/**
 * Machine document structure matching Firestore schema
 */
export interface MachineDocument {
  name: string; // Human readable label
  requiredPermission: string[]; // Array of permission IDs (stored as references in Firestore)
  maco: string; // Particle device ID of MaCo terminal
  control?: Record<string, any>; // Optional metadata on how to control the machine
}

export interface MachineWithId extends MachineDocument {
  id: string; // Firestore document ID
}

/**
 * MaCo (Machine Controller) terminal document structure
 */
export interface MacoDocument {
  name: string; // Human readable terminal name (e.g., "Dev Terminal 01")
}

export interface MacoWithId extends MacoDocument {
  id: string; // Particle device ID (e.g., "0a10aced202194944a042f04")
}
