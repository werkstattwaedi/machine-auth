// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react"
import { functions } from "./firebase"

interface TokenUser {
  tokenId: string
  userId: string
  name?: string
  email?: string
  userType?: string
}

interface UseTokenAuthResult {
  tokenUser: TokenUser | null
  loading: boolean
  error: string | null
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
 * Uses a direct POST because verifyTagCheckout is a plain Express route,
 * not a Firebase callable function.
 */
export function useTokenAuth(
  picc: string | null,
  cmac: string | null
): UseTokenAuthResult {
  const [tokenUser, setTokenUser] = useState<TokenUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        setTokenUser(data)
      })
      .catch((err) => {
        setError(err.message ?? "Tag-Verifizierung fehlgeschlagen")
      })
      .finally(() => setLoading(false))
  }, [picc, cmac])

  return { tokenUser, loading, error }
}
