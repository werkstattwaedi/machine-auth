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
  signInAnonymously,
  signInWithCustomToken,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithPopup,
  type Auth,
  type User,
} from "firebase/auth"
import {
  onSnapshot,
  setDoc,
  getDoc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore"
import { httpsCallable, type Functions } from "firebase/functions"
import { useDb, useFirebaseAuth, useFunctions } from "./firebase-context"
import { userRef } from "./firestore-helpers"

export interface BillingAddress {
  company: string
  street: string
  zip: string
  city: string
}

export interface UserDoc {
  id: string
  displayName: string // Derived from firstName+lastName if not set in Firestore
  rawDisplayName: string | null // The actual Firestore value (null if not explicitly set)
  firstName: string
  lastName: string
  email?: string
  roles: string[]
  permissions: string[] // permission doc IDs (resolved from refs)
  termsAcceptedAt?: { toDate(): Date } | null
  userType?: string // "erwachsen" | "kind" | "firma"
  billingAddress?: BillingAddress | null
}

/** Profile is complete when name, terms, and (for firma) billing address are filled. */
export function isProfileComplete(userDoc: UserDoc): boolean {
  if (!userDoc.firstName || !userDoc.lastName || !userDoc.termsAcceptedAt) {
    return false
  }
  if (userDoc.userType === "firma") {
    const addr = userDoc.billingAddress
    if (!addr || !addr.company || !addr.street || !addr.zip || !addr.city) {
      return false
    }
  }
  return true
}

/**
 * Provenance of the current Firebase Auth session.
 *
 * - `real`: an email-code, magic-link, or Google sign-in. Full member-area
 *   access; user.uid equals the user doc id.
 * - `tag`: a kiosk badge tap. Synthetic uid (`tag:…`) with `actsAs` claim;
 *   the session is a different Firebase principal than the user and must
 *   NOT be allowed to navigate the member area. See route guards below.
 * - `anonymous`: Firebase signInAnonymously (Phase C). Used for the
 *   no-account checkout path.
 * - `null`: not signed in (or claims not yet resolved).
 */
export type SessionKind = "real" | "tag" | "anonymous" | null

interface AuthContextValue {
  user: User | null
  userDoc: UserDoc | null
  isAdmin: boolean
  sessionKind: SessionKind
  /** True until Firebase Auth state resolves (fast, local check). */
  loading: boolean
  /** True while the Firestore user doc is being fetched (may be slow). */
  userDocLoading: boolean
  /** Ask the server to email a 6-digit code + magic link. */
  requestLoginEmail: (email: string) => Promise<void>
  /** Redeem the 6-digit code and sign in. */
  verifyLoginCode: (email: string, code: string) => Promise<void>
  /** Redeem a magic-link token (read from ?token=…) and sign in. Returns true if redeemed. */
  completeMagicLink: (token: string) => Promise<boolean>
  signInWithGoogle: () => Promise<void>
  linkGoogle: () => Promise<void>
  signOut: () => Promise<void>
  /**
   * Sign in as a Firebase Anonymous user if no session exists. Used by the
   * truly-anonymous checkout path so Firestore rules can gate on a real
   * principal rather than `if true` for unauth writes. No-op if a session
   * (real, anonymous, or tag) already exists.
   */
  signInAnonymouslyIfNeeded: () => Promise<void>
  /** Set when Google sign-in failed because an email-link account exists. */
  pendingGoogleLink: boolean
  clearPendingGoogleLink: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useFirebaseAuth()
  const db = useDb()
  const functions = useFunctions()
  const [user, setUser] = useState<User | null>(null)
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [userDocLoading, setUserDocLoading] = useState(false)
  const [sessionKind, setSessionKind] = useState<SessionKind>(null)

  // Listen to Firebase Auth state. Resolve sessionKind from the ID-token
  // claims so callers can distinguish a real login from a kiosk tag-tap.
  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (!firebaseUser) {
        setUserDoc(null)
        setSessionKind(null)
        setLoading(false)
        setUserDocLoading(false)
        return
      }

      // Tag sessions are minted with a synthetic uid like `tag:{userId}:{nonce}`.
      // We use the prefix as a fail-safe identifier that doesn't depend on
      // a successful network round-trip to decode claims — see the catch
      // block below.
      const uidIsTag = firebaseUser.uid.startsWith("tag:")

      // Resolve sessionKind from token claims. The tag-tap session is the
      // one that must be locked out of the member area; everything else
      // is "real" (email/magic-link/Google) or "anonymous" (Phase C).
      try {
        const tokenResult = await firebaseUser.getIdTokenResult()
        const claims = tokenResult.claims as { tagCheckout?: unknown; actsAs?: unknown }
        if (claims.tagCheckout === true || typeof claims.actsAs === "string" || uidIsTag) {
          setSessionKind("tag")
        } else if (firebaseUser.isAnonymous) {
          setSessionKind("anonymous")
        } else {
          setSessionKind("real")
        }
      } catch {
        // Token decoding failed (network partition, expired refresh, …).
        // Fail safe: a tag-shaped uid stays a tag session, so the route
        // guards still bounce it out of the member area. Anything else
        // we treat as real to avoid accidental lockouts of legitimate
        // members.
        setSessionKind(uidIsTag ? "tag" : "real")
      }

      setLoading(false)
      // Tag sessions don't have a user doc at users/{user.uid} — the
      // synthetic uid never spawned one. Skip the Firestore subscription
      // and the loading flag so the UI doesn't spin forever.
      setUserDocLoading(!uidIsTag)
    })
  }, [auth])

  // Listen to Firestore user doc when authenticated (doc ID = Auth UID).
  // Tag-tap sessions have a synthetic uid (`tag:…`) and no corresponding
  // user doc; skip the subscription entirely (the kiosk reads pre-fill
  // data from useTokenAuth's response).
  useEffect(() => {
    if (!user) return
    if (user.uid.startsWith("tag:")) {
      setUserDoc(null)
      setUserDocLoading(false)
      return
    }

    const userDocRef = userRef(db, user.uid)

    return onSnapshot(userDocRef, async (docSnap) => {
      if (!docSnap.exists()) {
        setUserDoc(null)
      } else {
        const data = docSnap.data()
        const roles: string[] = data.roles ?? []
        const firstName = data.firstName ?? ""
        const lastName = data.lastName ?? ""
        const rawDisplayName: string | null = data.displayName || null
        setUserDoc({
          id: docSnap.id,
          displayName: rawDisplayName || `${firstName} ${lastName}`.trim() || "",
          rawDisplayName,
          firstName,
          lastName,
          email: data.email,
          roles,
          permissions: (data.permissions ?? []).map(
            (ref: { id: string }) => ref.id
          ),
          termsAcceptedAt: data.termsAcceptedAt ?? null,
          userType: data.userType ?? "erwachsen",
          billingAddress: data.billingAddress ?? null,
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
  }, [user, db])

  const [pendingGoogleLink, setPendingGoogleLink] = useState(
    () => window.localStorage.getItem("pendingGoogleLink") === "true"
  )

  const signInWithGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      await handleSignIn(db, result.user)
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "auth/account-exists-with-different-credential"
      ) {
        // Existing email account — user must sign in via email first, then link
        window.localStorage.setItem("pendingGoogleLink", "true")
        setPendingGoogleLink(true)
      }
      throw error
    }
  }

  const linkGoogle = async () => {
    if (!user) throw new Error("Nicht angemeldet")
    await linkWithPopup(user, new GoogleAuthProvider())
    clearPendingGoogleLink()
  }

  const clearPendingGoogleLink = () => {
    window.localStorage.removeItem("pendingGoogleLink")
    setPendingGoogleLink(false)
  }

  const requestLoginEmail = async (email: string) => {
    const fn = httpsCallable<{ email: string }, { ok: true }>(
      functions,
      "requestLoginCode"
    )
    await fn({ email })
  }

  const verifyLoginCode = async (email: string, code: string) => {
    await redeemCustomToken(
      functions,
      "verifyLoginCode",
      { email, code },
      auth,
      db
    )
  }

  const completeMagicLink = async (token: string): Promise<boolean> => {
    if (!token) return false
    await redeemCustomToken(
      functions,
      "verifyMagicLink",
      { token },
      auth,
      db
    )
    return true
  }

  const signOut = async () => {
    await firebaseSignOut(auth)
  }

  const signInAnonymouslyIfNeeded = async () => {
    if (auth.currentUser) return
    await signInAnonymously(auth)
  }

  const isAdmin = userDoc?.roles?.includes("admin") ?? false

  return (
    <AuthContext value={{
      user,
      userDoc,
      isAdmin,
      sessionKind,
      loading,
      userDocLoading,
      requestLoginEmail,
      verifyLoginCode,
      completeMagicLink,
      signInWithGoogle,
      linkGoogle,
      signOut,
      signInAnonymouslyIfNeeded,
      pendingGoogleLink,
      clearPendingGoogleLink,
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

async function redeemCustomToken(
  functions: Functions,
  name: "verifyLoginCode" | "verifyMagicLink",
  payload: Record<string, string>,
  auth: Auth,
  db: Firestore
): Promise<void> {
  const fn = httpsCallable<Record<string, string>, { customToken: string }>(
    functions,
    name
  )
  const { data } = await fn(payload)
  const credential = await signInWithCustomToken(auth, data.customToken)
  await handleSignIn(db, credential.user)
}

/**
 * Self-registration: if no user doc exists for this Auth UID, create one.
 * Admin-created users already have a doc, so this is a no-op for them.
 */
async function handleSignIn(db: Firestore, user: User): Promise<void> {
  if (!user.email) throw new Error("E-Mail-Adresse benötigt")

  const userDocRef = userRef(db, user.uid)
  const snapshot = await getDoc(userDocRef)
  if (snapshot.exists()) return

  // Create new user document with Auth UID as doc ID
  await setDoc(userDocRef, {
    email: user.email,
    displayName: null,
    firstName: "",
    lastName: "",
    created: serverTimestamp(),
    roles: [],
    permissions: [],
    termsAcceptedAt: null,
    userType: "erwachsen",
    billingAddress: null,
  })
}
