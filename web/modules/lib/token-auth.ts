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

interface TokenUser {
  tokenId: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
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

const FUNCTIONS_REGION = import.meta.env.VITE_FUNCTIONS_REGION ?? "us-central1"

/** Build the base URL for the Functions endpoint. */
function functionsBaseUrl(projectId: string | undefined): string {
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_EMULATOR_FUNCTIONS_PORT || "5001"
    return `http://127.0.0.1:${port}/${import.meta.env.VITE_FIREBASE_PROJECT_ID}/${FUNCTIONS_REGION}`
  }
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`
}

/**
 * Kiosk runtime contract: the Electron preload exposes `window.kiosk` with
 * an IPC handle for the per-kiosk Bearer secret used to authenticate the
 * verifyTagCheckout call. The Bearer is intentionally a soft revocation/
 * audit knob, not real attestation — the structural defense is the
 * synthetic-UID custom token returned by verifyTagCheckout.
 */
interface KioskWindow {
  bearer?: () => Promise<string | null | undefined>
}

function getKiosk(): KioskWindow | undefined {
  return (window as unknown as { kiosk?: KioskWindow }).kiosk
}

/**
 * Resolve the kiosk Bearer if running inside the Electron kiosk shell.
 * Returns null if not in the kiosk (regular browser, phone tap, dev). The
 * dev/emulator Functions middleware bypasses the Bearer check, so a
 * missing header is fine in development.
 */
async function resolveKioskBearer(): Promise<string | null> {
  const kiosk = getKiosk()
  if (!kiosk?.bearer) return null
  const value = await kiosk.bearer()
  return typeof value === "string" && value.length > 0 ? value : null
}

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

    const url = `${functionsBaseUrl(functions.app.options.projectId)}/api/verifyTagCheckout`
    let cancelled = false

    ;(async () => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        }
        const bearer = await resolveKioskBearer()
        if (bearer) headers["Authorization"] = `Bearer ${bearer}`

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ picc, cmac }),
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error ?? "Tag-Verifizierung fehlgeschlagen")
        }
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
