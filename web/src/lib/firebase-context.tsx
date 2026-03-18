// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createContext, useContext, type ReactNode } from "react"
import type { Auth } from "firebase/auth"
import type { Firestore } from "firebase/firestore"
import type { Functions } from "firebase/functions"

export interface FirebaseServices {
  db: Firestore
  auth: Auth
  functions: Functions
}

const FirebaseContext = createContext<FirebaseServices | null>(null)

export function FirebaseProvider({
  children,
  value,
}: {
  children: ReactNode
  value: FirebaseServices
}) {
  return <FirebaseContext value={value}>{children}</FirebaseContext>
}

function useFirebaseServices(): FirebaseServices {
  const ctx = useContext(FirebaseContext)
  if (!ctx) throw new Error("useFirebaseServices requires FirebaseProvider")
  return ctx
}

export function useDb(): Firestore {
  return useFirebaseServices().db
}

export function useFirebaseAuth(): Auth {
  return useFirebaseServices().auth
}

export function useFunctions(): Functions {
  return useFirebaseServices().functions
}
