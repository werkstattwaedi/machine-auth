// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useRef } from "react"
import {
  inMemoryPersistence,
  setPersistence,
  signInWithCustomToken,
  signOut as firebaseSignOut,
} from "firebase/auth"
import { useFunctions, useFirebaseAuth } from "./firebase-context"
import { resolveBridgeBearer } from "./use-bridge"
import { rpcCallable } from "./rpc"

export interface TokenUser {
  tokenId: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  /**
   * Whether the tag user holds an active membership. Server-derived from the
   * CMAC-verified verify_tag response; drives member pricing for tag-tap
   * checkout (issue #358).
   */
  activeMembership?: boolean
}

interface UseTokenAuthResult {
  tokenUser: TokenUser | null
  /** True while verifying the tag and signing in */
  loading: boolean
  error: string | null
  /** True when the current Firebase Auth session was created by a tag tap */
  isTagAuth: boolean
  /** Sign out of the tag-created Firebase Auth session */
  tagSignOut: () => Promise<void>
}

interface VerifyTagResponse {
  customToken: string
  tokenId: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  activeMembership?: boolean
}

// Module-level dedup of in-flight verify_tag calls. The verifyTagCheckout
// endpoint enforces a strict SDM counter increase; a duplicate request with
// the same picc (e.g. React StrictMode double-mount, browser reload, or a
// bare network retry) would be rejected as a replay even though it's the
// same physical tap. Returning the same promise to all callers keeps the
// server-side defense intact while making the hook idempotent per tap.
const inflightVerifyByKey = new Map<string, Promise<VerifyTagResponse>>()

/**
 * Resolve user identity from NFC tag URL parameters (picc + cmac).
 *
 * Verifies the tag via the backend, then signs into Firebase Auth with a
 * short-lived custom token so the client can read/write Firestore directly
 * (security rules require `request.auth`).
 */
export function useTokenAuth(
  picc: string | null,
  cmac: string | null
): UseTokenAuthResult {
  const functions = useFunctions()
  const auth = useFirebaseAuth()
  const [tokenUser, setTokenUser] = useState<TokenUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isTagAuth, setIsTagAuth] = useState(false)
  const tagAuthRef = useRef(false)

  const tagSignOut = useCallback(async () => {
    if (!tagAuthRef.current) return
    tagAuthRef.current = false
    setIsTagAuth(false)
    await firebaseSignOut(auth)
  }, [auth])

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

        // The kiosk session is short-lived and must not persist across
        // tab/process restarts. inMemoryPersistence applies to subsequent
        // sign-ins on this Auth instance; combined with Phase D's Electron
        // session wipe, a closed kiosk window equals a closed session.
        await setPersistence(auth, inMemoryPersistence)

        // Sign into Firebase Auth so Firestore rules allow reads/writes.
        // The custom token uses a synthetic UID with `actsAs` claim — see
        // functions/src/checkout/verify_tag.ts.
        await signInWithCustomToken(auth, data.customToken)
        if (cancelled) return

        tagAuthRef.current = true
        setIsTagAuth(true)

        setTokenUser({
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

  return { tokenUser, loading, error, isTagAuth, tagSignOut }
}
