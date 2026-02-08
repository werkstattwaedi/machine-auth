// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react"
import { httpsCallable } from "firebase/functions"
import { functions } from "./firebase"

interface TokenUser {
  tokenId: string
  userId: string
}

interface UseTokenAuthResult {
  tokenUser: TokenUser | null
  loading: boolean
  error: string | null
}

/**
 * Resolve user identity from NFC tag URL parameters (picc + cmac).
 * Used for public checkout and token-activated views.
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

    const verify = httpsCallable<
      { picc: string; cmac: string },
      { tokenId: string; userId: string }
    >(functions, "api/verifyTagCheckout")

    verify({ picc, cmac })
      .then((result) => {
        setTokenUser(result.data)
      })
      .catch((err) => {
        setError(err.message ?? "Tag-Verifizierung fehlgeschlagen")
      })
      .finally(() => setLoading(false))
  }, [picc, cmac])

  return { tokenUser, loading, error }
}
