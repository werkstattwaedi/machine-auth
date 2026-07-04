// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useSyncExternalStore } from "react"
import {
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithCustomToken,
  signOut as firebaseSignOut,
  type Auth,
} from "firebase/auth"
import { useFunctions, useFirebaseAuth } from "./firebase-context"
import { resolveBridgeBearer } from "./use-bridge"
import { rpcCallable } from "./rpc"

export interface TokenUser {
  /**
   * The tapped badge's token id, or null when the kiosk session was
   * established without a badge (email-code sign-in — ADR-0022).
   */
  tokenId: string | null
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  /**
   * Whether the kiosk user holds an active membership. Server-derived from
   * the CMAC-verified verify_tag / verifyLoginCodeKiosk response; drives
   * member pricing for kiosk checkout (issue #358).
   */
  activeMembership?: boolean
}

/**
 * An authentic-but-unregistered badge from the self-service stack: the tap
 * verified cryptographically but no `tokens/{id}` doc exists. The signed
 * voucher is the proof-of-tap the badge purchase callable requires.
 */
export interface UnregisteredBadge {
  tokenId: string
  badgeVoucher: string
}

interface UseTokenAuthResult {
  tokenUser: TokenUser | null
  /** True while verifying the tag and signing in */
  loading: boolean
  error: string | null
  /** True when the current Firebase Auth session is a kiosk actsAs session */
  isTagAuth: boolean
  /** Set when the tapped badge is genuine but not registered to anyone. */
  unregisteredBadge: UnregisteredBadge | null
  /** Sign out of the kiosk-created Firebase Auth session */
  tagSignOut: () => Promise<void>
}

type VerifyTagResponse =
  | {
      registered?: true
      customToken: string
      tokenId: string
      userId: string
      firstName?: string
      lastName?: string
      email?: string
      userType?: string
      activeMembership?: boolean
    }
  | {
      registered: false
      tokenId: string
      badgeVoucher: string
    }

// Module-level dedup of in-flight verify_tag calls. The verifyTagCheckout
// endpoint enforces a strict SDM counter increase; a duplicate request with
// the same picc (e.g. React StrictMode double-mount, browser reload, or a
// bare network retry) would be rejected as a replay even though it's the
// same physical tap. Returning the same promise to all callers keeps the
// server-side defense intact while making the hook idempotent per tap.
const inflightVerifyByKey = new Map<string, Promise<VerifyTagResponse>>()

// Module-level store of the established kiosk session, shared by every
// useTokenAuth consumer (RootDispatcher, wizard). All mint paths — badge
// tap (this file's verify effect) and the email/SMS code sign-ins
// (checkin-signin.tsx) — publish here, so the wizard treats a code
// sign-in identically to a badge tap.
let kioskTokenUser: TokenUser | null = null
const kioskSessionListeners = new Set<() => void>()

function publishKioskSession(user: TokenUser | null): void {
  kioskTokenUser = user
  for (const listener of kioskSessionListeners) listener()
}

export function getKioskTokenUser(): TokenUser | null {
  return kioskTokenUser
}

export function subscribeKioskSession(listener: () => void): () => void {
  kioskSessionListeners.add(listener)
  return () => kioskSessionListeners.delete(listener)
}

/**
 * Sign into Firebase with a kiosk custom token (synthetic uid + `actsAs`
 * claim) and publish the session to every useTokenAuth consumer.
 *
 * The kiosk session is short-lived and must not persist across tab/process
 * restarts. inMemoryPersistence applies to subsequent sign-ins on this Auth
 * instance; combined with the Electron partition wipe, a closed kiosk
 * window equals a closed session.
 */
export async function establishKioskSession(
  auth: Auth,
  customToken: string,
  tokenUser: TokenUser
): Promise<void> {
  await setPersistence(auth, inMemoryPersistence)
  await signInWithCustomToken(auth, customToken)
  publishKioskSession(tokenUser)
}

/**
 * Resolve user identity for the kiosk session. When `picc`/`cmac` are set
 * (NFC tag tap), verifies the tag via the backend and signs in; either way
 * it exposes the shared kiosk session (badge tap or email-code sign-in).
 */
export function useTokenAuth(
  picc: string | null,
  cmac: string | null
): UseTokenAuthResult {
  const functions = useFunctions()
  const auth = useFirebaseAuth()
  const tokenUser = useSyncExternalStore(subscribeKioskSession, getKioskTokenUser)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unregisteredBadge, setUnregisteredBadge] =
    useState<UnregisteredBadge | null>(null)

  const tagSignOut = useCallback(async () => {
    if (!getKioskTokenUser()) return
    publishKioskSession(null)
    await firebaseSignOut(auth)
  }, [auth])

  // A published session must never outlive its Firebase principal: if the
  // auth session dies externally (e.g. _wizard.tsx's mount-time signOut),
  // clear the store so no stale tokenUser drives pre-fill or pricing.
  // onAuthStateChanged fires immediately with the current state, so a
  // mount after an unobserved sign-out also cleans up.
  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (!user && getKioskTokenUser()) publishKioskSession(null)
      }),
    [auth]
  )

  useEffect(() => {
    if (!picc || !cmac) return

    setLoading(true)
    setError(null)

    let cancelled = false

    ;(async () => {
      try {
        const cacheKey = `${picc}|${cmac}`
        let pending = inflightVerifyByKey.get(cacheKey)
        if (!pending) {
          pending = (async () => {
            // Goes through the authCall dispatcher like every other web
            // callable, so CORS is handled by the Firebase SDK. The kiosk
            // bearer (soft revocation/audit gate) rides in the payload — the
            // Electron bridge supplies it; a normal browser sends none.
            const bearer = await resolveBridgeBearer()
            const verifyTagCheckout = rpcCallable<
              { picc: string; cmac: string; bearer?: string },
              VerifyTagResponse
            >(functions, "authCall", "verifyTagCheckout")
            const res = await verifyTagCheckout({
              picc,
              cmac,
              bearer: bearer ?? undefined,
            })
            return res.data
          })()
          inflightVerifyByKey.set(cacheKey, pending)
          // Drop the cache entry once settled so a fresh tap (after tagSignOut)
          // can re-issue. Failures also clear so a retry with the same picc
          // re-attempts the verify rather than being stuck on the prior error.
          pending.finally(() => {
            if (inflightVerifyByKey.get(cacheKey) === pending) {
              inflightVerifyByKey.delete(cacheKey)
            }
          })
        }
        const data = await pending
        if (cancelled) return

        // An authentic pre-personalized badge with no owner: no session to
        // establish — surface it so the wizard can offer the self-service
        // purchase (or a sign-in-first prompt).
        if (data.registered === false) {
          setUnregisteredBadge({
            tokenId: data.tokenId,
            badgeVoucher: data.badgeVoucher,
          })
          return
        }

        // Sign into Firebase Auth so Firestore rules allow reads/writes.
        // The custom token uses a synthetic UID with `actsAs` claim — see
        // functions/src/checkout/verify_tag.ts.
        await establishKioskSession(auth, data.customToken, {
          tokenId: data.tokenId,
          userId: data.userId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          userType: data.userType,
          activeMembership: data.activeMembership,
        })
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : "Tag-Verifizierung fehlgeschlagen"
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [picc, cmac, functions, auth])

  return {
    tokenUser,
    loading,
    error,
    isTagAuth: tokenUser !== null,
    unregisteredBadge,
    tagSignOut,
  }
}
