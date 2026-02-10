// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import {
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth"
import {
  onSnapshot,
  setDoc,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore"
import { auth, db } from "./firebase"

export interface UserDoc {
  id: string
  displayName: string
  name: string
  email?: string
  roles: string[]
  permissions: string[] // permission doc IDs (resolved from refs)
  termsAcceptedAt?: { toDate(): Date } | null
  userType?: string // "erwachsen" | "kind" | "firma"
}

interface AuthContextValue {
  user: User | null
  userDoc: UserDoc | null
  isAdmin: boolean
  /** True until Firebase Auth state resolves (fast, local check). */
  loading: boolean
  /** True while the Firestore user doc is being fetched (may be slow). */
  userDocLoading: boolean
  signInWithEmail: (email: string) => Promise<void>
  completeSignIn: () => Promise<boolean>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [userDocLoading, setUserDocLoading] = useState(false)

  // Listen to Firebase Auth state
  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (!firebaseUser) {
        setUserDoc(null)
      }
      // Always resolve auth loading immediately - don't wait for Firestore
      setLoading(false)
      setUserDocLoading(!!firebaseUser)
    })
  }, [])

  // Listen to Firestore user doc when authenticated (doc ID = Auth UID)
  useEffect(() => {
    if (!user) return

    const userDocRef = doc(db, "users", user.uid)

    return onSnapshot(userDocRef, async (docSnap) => {
      if (!docSnap.exists()) {
        setUserDoc(null)
      } else {
        const data = docSnap.data()
        const roles: string[] = data.roles ?? []
        setUserDoc({
          id: docSnap.id,
          displayName: data.displayName ?? "",
          name: data.name ?? "",
          email: data.email,
          roles,
          permissions: (data.permissions ?? []).map(
            (ref: { id: string }) => ref.id
          ),
          termsAcceptedAt: data.termsAcceptedAt ?? null,
          userType: data.userType ?? "erwachsen",
        })

        // If user doc says admin but token doesn't have the claim,
        // force a token refresh so Firestore rules see the updated claims.
        if (roles.includes("admin")) {
          const tokenResult = await user.getIdTokenResult()
          if (!tokenResult.claims.admin) {
            await user.getIdToken(true)
          }
        }
      }
      setUserDocLoading(false)
    })
  }, [user])

  const signInWithEmail = async (email: string) => {
    await sendSignInLinkToEmail(auth, email, {
      url: `${window.location.origin}/login`,
      handleCodeInApp: true,
    })
    window.localStorage.setItem("emailForSignIn", email)
  }

  const completeSignIn = async (): Promise<boolean> => {
    if (!isSignInWithEmailLink(auth, window.location.href)) {
      return false
    }

    let email = window.localStorage.getItem("emailForSignIn")
    if (!email) {
      email = window.prompt("Bitte E-Mail-Adresse bestätigen:")
    }
    if (!email) throw new Error("E-Mail-Adresse benötigt")

    const credential = await signInWithEmailLink(
      auth,
      email,
      window.location.href
    )
    window.localStorage.removeItem("emailForSignIn")

    await handleSignIn(credential.user)
    return true
  }

  const signOut = async () => {
    await firebaseSignOut(auth)
  }

  const isAdmin = userDoc?.roles?.includes("admin") ?? false

  return (
    <AuthContext value={{
      user,
      userDoc,
      isAdmin,
      loading,
      userDocLoading,
      signInWithEmail,
      completeSignIn,
      signOut,
    }}>
      {children}
    </AuthContext>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}

/**
 * Self-registration: if no user doc exists for this Auth UID, create one.
 * Admin-created users already have a doc, so this is a no-op for them.
 */
async function handleSignIn(user: User): Promise<void> {
  if (!user.email) throw new Error("E-Mail-Adresse benötigt")

  const userDocRef = doc(db, "users", user.uid)
  const snapshot = await getDoc(userDocRef)
  if (snapshot.exists()) return

  // Create new user document with Auth UID as doc ID
  await setDoc(userDocRef, {
    email: user.email,
    displayName: user.displayName || "New User",
    name: "",
    created: serverTimestamp(),
    roles: ["vereinsmitglied"],
    permissions: [],
    termsAcceptedAt: null,
    userType: "erwachsen",
  })
}
