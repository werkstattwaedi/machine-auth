import { DocumentReference } from "firebase-admin/firestore";

/**
 * Type guard to assert that a value is a Firestore DocumentReference
 * @param value - The value to check
 * @param fieldName - Optional field name for better error messages
 * @throws Error if the value is not a DocumentReference
 */
export function assertIsDocumentReference(
  value: unknown,
  fieldName?: string
): asserts value is DocumentReference {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    const field = fieldName ? `${fieldName}: ` : '';
    throw new Error(
      `${field}expected DocumentReference, got ${typeof value}`
    );
  }
}
