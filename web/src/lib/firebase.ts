// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { initializeApp } from "firebase/app"
import { connectAuthEmulator, getAuth } from "firebase/auth"
import {
  connectFirestoreEmulator,
  initializeFirestore,
} from "firebase/firestore"
import { connectFunctionsEmulator, getFunctions } from "firebase/functions"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
// Auto-detect long-polling to avoid WebChannel transport detection delays
// that can cause slow initial page loads (especially with emulators).
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
})
export const functions = getFunctions(app)

if (import.meta.env.DEV) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  })
  connectFirestoreEmulator(db, "127.0.0.1", 8080)
  connectFunctionsEmulator(functions, "127.0.0.1", 5001)
}
