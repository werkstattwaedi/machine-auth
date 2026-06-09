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
  getAdditionalUserInfo,
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
import { type Functions } from "firebase/functions"
import { rpcCallable } from "./rpc"
import { useDb, useFirebaseAuth, useFunctions } from "./firebase-context"
import { userRef } from "./firestore-helpers"
import { formatFullName } from "./username-utils"
import { type UserType } from "./pricing"

export interface BillingAddress {
  company: string
  street: string
  zip: string
  city: string
}

/**
 * The fields captured during the combined sign-up flow. Account creation is
 * deliberately light: name + member type + terms. A company (`firma`) also
 * supplies its billing address inline, because it always invoices.
 */
export interface SignupProfile {
  firstName: string
  lastName: string
  userType: UserType
  termsAccepted: boolean
  billingAddress?: BillingAddress | null
}

export interface UserDoc {
  id: string
  /** Full name = `firstName lastName` (trimmed). Empty until profile is filled. */
  name: string
  firstName: string
  lastName: string
  email: string | null // null for child accounts (no Firebase Auth email)
  /** Optional contact phone — captured for everyone, never required.
   *  Always normalized to a non-undefined value (`null` when absent). */
  phone: string | null
  roles: string[]
  permissions: string[] // permission doc IDs (resolved from refs)
  termsAcceptedAt?: { toDate(): Date } | null
  userType?: string // "erwachsen" | "kind" | "firma"
  billingAddress?: BillingAddress | null
  // ID of the user's single active membership, denormalized from the
  // membership doc. `null` → not a member. Pricing keys off this.
  activeMembership: string | null
}

/**
 * Profile is complete when name and terms are filled. The postal address is
 * captured later (membership signup or profile edit) and is only *required*
 * for companies (`firma`), which always invoice and therefore need an address
 * + company name up front.
 */
export function isProfileComplete(userDoc: UserDoc): boolean {
  if (!userDoc.firstName || !userDoc.lastName || !userDoc.termsAcceptedAt) {
    return false
  }
  if (userDoc.userType === "firma") {
    const addr = userDoc.billingAddress
    if (!addr || !addr.street || !addr.zip || !addr.city || !addr.company) {
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
  /** Does a *completed* account (name + accepted terms) exist for this email? */
  checkAccountExists: (
    email: string
  ) => Promise<{ exists: boolean; hasAuthUser: boolean }>
  /** Ask the server to email a 6-digit code + magic link. */
  requestLoginEmail: (email: string) => Promise<void>
  /** Redeem the 6-digit code and sign in (existing account — no doc write). */
  verifyLoginCode: (email: string, code: string) => Promise<void>
  /** Redeem the 6-digit code, sign in, and create the user doc (sign-up). */
  verifyLoginCodeAndCreateProfile: (
    email: string,
    code: string,
    profile: SignupProfile
  ) => Promise<void>
  /** Write the user doc for an already-signed-in principal (Google / magic link sign-up). */
  completeSignedInSignup: (profile: SignupProfile) => Promise<void>
  /** Redeem a magic-link token (read from ?token=…) and sign in. Returns true if redeemed. */
  completeMagicLink: (token: string) => Promise<boolean>
  /** Sign in with Google. Returns whether the account is new + the identity name. */
  signInWithGoogle: () => Promise<{
    isNewAccount: boolean
    firstName: string
    lastName: string
  }>
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
        setUserDoc({
          id: docSnap.id,
          name: formatFullName({ firstName, lastName }),
          firstName,
          lastName,
          email: data.email ?? null,
          phone: data.phone ?? null,
          roles,
          permissions: (data.permissions ?? []).map(
            (ref: { id: string }) => ref.id
          ),
          termsAcceptedAt: data.termsAcceptedAt ?? null,
          userType: data.userType ?? "erwachsen",
          billingAddress: data.billingAddress ?? null,
          activeMembership: data.activeMembership?.id ?? null,
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

  const signInWithGoogle = async (): Promise<{
    isNewAccount: boolean
    firstName: string
    lastName: string
  }> => {
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      // Prefer the OAuth identity's structured name claims; fall back to
      // splitting displayName on the first space when they're absent.
      const profile = getAdditionalUserInfo(result)?.profile as
        | { given_name?: string; family_name?: string }
        | undefined
      let firstName = profile?.given_name ?? ""
      let lastName = profile?.family_name ?? ""
      if (!firstName && !lastName && result.user.displayName) {
        const parts = result.user.displayName.trim().split(/\s+/)
        firstName = parts[0] ?? ""
        lastName = parts.slice(1).join(" ")
      }
      // New-vs-existing WITHOUT creating a doc: a completed account has
      // accepted terms. An existing Auth user with no terms (legacy / abandoned)
      // is treated as new so they finish sign-up. The read is best-effort:
      // sign-in itself already succeeded, so a failed lookup must not reject
      // the whole call — default to "not new" and let the login page's
      // redirect effect drop an incomplete account into sign-up anyway.
      let isNewAccount = false
      try {
        const snap = await getDoc(userRef(db, result.user.uid))
        isNewAccount = !(snap.exists() && snap.data()?.termsAcceptedAt)
      } catch (err) {
        console.error("signInWithGoogle: user-doc lookup failed", err)
      }
      return { isNewAccount, firstName, lastName }
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

  const checkAccountExists = async (email: string) => {
    const fn = rpcCallable<
      { email: string },
      { exists: boolean; hasAuthUser: boolean }
    >(functions, "authCall", "checkAccountExists")
    const { data } = await fn({ email })
    return data
  }

  const requestLoginEmail = async (email: string) => {
    const fn = rpcCallable<{ email: string }, { ok: true }>(
      functions,
      "authCall",
      "requestLoginCode"
    )
    await fn({ email })
  }

  const verifyLoginCode = async (email: string, code: string) => {
    await redeemCustomToken(functions, "verifyLoginCode", { email, code }, auth)
  }

  const verifyLoginCodeAndCreateProfile = async (
    email: string,
    code: string,
    profile: SignupProfile
  ) => {
    const user = await redeemCustomToken(
      functions,
      "verifyLoginCode",
      { email, code },
      auth
    )
    await writeSignupProfile(db, user, profile)
  }

  const completeSignedInSignup = async (profile: SignupProfile) => {
    if (!auth.currentUser) throw new Error("Nicht angemeldet")
    await writeSignupProfile(db, auth.currentUser, profile)
  }

  const completeMagicLink = async (token: string): Promise<boolean> => {
    if (!token) return false
    await redeemCustomToken(functions, "verifyMagicLink", { token }, auth)
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
      checkAccountExists,
      requestLoginEmail,
      verifyLoginCode,
      verifyLoginCodeAndCreateProfile,
      completeSignedInSignup,
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
  auth: Auth
): Promise<User> {
  const fn = rpcCallable<Record<string, string>, { customToken: string }>(
    functions,
    "authCall",
    name
  )
  const { data } = await fn(payload)
  const credential = await signInWithCustomToken(auth, data.customToken)
  return credential.user
}

/**
 * Create (or finish) the user doc from the sign-up form. New accounts get the
 * full scaffold; an existing-but-incomplete doc (admin-created / abandoned) is
 * merged so its roles/permissions/created are preserved.
 */
async function writeSignupProfile(
  db: Firestore,
  user: User,
  profile: SignupProfile
): Promise<void> {
  if (!user.email) throw new Error("E-Mail-Adresse benötigt")

  const userDocRef = userRef(db, user.uid)
  const snapshot = await getDoc(userDocRef)

  await setDoc(
    userDocRef,
    {
      email: user.email,
      firstName: profile.firstName.trim(),
      lastName: profile.lastName.trim(),
      userType: profile.userType,
      termsAcceptedAt: serverTimestamp(),
      billingAddress: profile.billingAddress ?? null,
      // New accounts get the full scaffold; an existing doc keeps its
      // roles/permissions/created/phone (merge omits these fields).
      ...(snapshot.exists()
        ? {}
        : {
            created: serverTimestamp(),
            roles: [],
            permissions: [],
            phone: null,
          }),
    },
    { merge: true }
  )
}
