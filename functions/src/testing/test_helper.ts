import * as admin from "firebase-admin";

export function initializeTestEnvironment() {
  if (admin.apps.length === 0) {
    admin.initializeApp();
  }
}
