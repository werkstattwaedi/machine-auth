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
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  doc,
  getDocs,
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
  firebaseUid?: string
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
    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      if (!firebaseUser) {
        setUserDoc(null)
      }
      // Always resolve auth loading immediately - don't wait for Firestore
      setLoading(false)
      setUserDocLoading(!!firebaseUser)
    })
  }, [])

  // Listen to Firestore user doc when authenticated
  useEffect(() => {
    if (!user) return

    const usersRef = collection(db, "users")
    const q = query(usersRef, where("firebaseUid", "==", user.uid))

    return onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        setUserDoc(null)
      } else {
        const docSnap = snapshot.docs[0]
        const data = docSnap.data()
        setUserDoc({
          id: docSnap.id,
          displayName: data.displayName ?? "",
          name: data.name ?? "",
          email: data.email,
          roles: data.roles ?? [],
          permissions: (data.permissions ?? []).map(
            (ref: { id: string }) => ref.id
          ),
          firebaseUid: data.firebaseUid,
          termsAcceptedAt: data.termsAcceptedAt ?? null,
          userType: data.userType ?? "erwachsen",
        })
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
 * Account claiming: link Firebase Auth user to existing Firestore user doc,
 * or create a new one.
 */
async function handleSignIn(user: User): Promise<void> {
  if (!user.email) throw new Error("E-Mail-Adresse benötigt")

  const usersRef = collection(db, "users")

  // Check if already linked
  const uidQuery = query(usersRef, where("firebaseUid", "==", user.uid))
  const uidSnapshot = await getDocs(uidQuery)
  if (!uidSnapshot.empty) return

  // Check for unclaimed account with matching email
  const emailQuery = query(usersRef, where("email", "==", user.email))
  const emailSnapshot = await getDocs(emailQuery)

  if (!emailSnapshot.empty) {
    // Claim existing account
    const existingRef = emailSnapshot.docs[0].ref
    await setDoc(
      existingRef,
      {
        firebaseUid: user.uid,
        displayName:
          user.displayName || emailSnapshot.docs[0].data().displayName,
      },
      { merge: true }
    )
  } else {
    // Create new user document
    const newUserRef = doc(usersRef)
    await setDoc(newUserRef, {
      firebaseUid: user.uid,
      email: user.email,
      displayName: user.displayName || "New User",
      name: "",
      created: serverTimestamp(),
      roles: ["vereinsmitglied"],
      permissions: [],
    })
  }
}
