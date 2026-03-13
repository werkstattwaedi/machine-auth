// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useRef } from "react"
import {
  signInWithCustomToken,
  signOut as firebaseSignOut,
} from "firebase/auth"
import { auth, functions } from "./firebase"

interface TokenUser {
  tokenId: string
  userId: string
  name?: string
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

const FUNCTIONS_REGION = "us-central1"

/** Build the base URL for the Functions endpoint. */
function functionsBaseUrl(): string {
  if (import.meta.env.DEV) {
    return `http://127.0.0.1:5001/oww-maschinenfreigabe/${FUNCTIONS_REGION}`
  }
  const projectId = functions.app.options.projectId
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`
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
  }, [])

  useEffect(() => {
    if (!picc || !cmac) return

    setLoading(true)
    setError(null)

    const url = `${functionsBaseUrl()}/api/verifyTagCheckout`

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picc, cmac }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Tag-Verifizierung fehlgeschlagen")

        // Sign into Firebase Auth so Firestore rules allow reads/writes
        await signInWithCustomToken(auth, data.customToken)
        tagAuthRef.current = true
        setIsTagAuth(true)

        setTokenUser({
          tokenId: data.tokenId,
          userId: data.userId,
          name: data.name,
          email: data.email,
          userType: data.userType,
        })
      })
      .catch((err) => {
        setError(err.message ?? "Tag-Verifizierung fehlgeschlagen")
      })
      .finally(() => setLoading(false))
  }, [picc, cmac])

  return { tokenUser, loading, error, isTagAuth, tagSignOut }
}
