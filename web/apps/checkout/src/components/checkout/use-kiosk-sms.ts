// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk SMS code plumbing shared by the check-in sign-in and the kiosk
 * step-up dialog (ADR-0031 / ADR-0041).
 *
 * Firebase phone auth is client-driven: `signInWithPhoneNumber` needs an
 * invisible reCAPTCHA (single-use, recreated per send inside a stable host
 * element) and `confirm(code)` signs the browser in as the REAL user. On the
 * kiosk that persistent principal must never survive on the shared terminal,
 * so the confirm is immediately exchanged for the ephemeral `actsAs` kiosk
 * session (`exchangeKioskSession`) — and torn down again if the exchange
 * fails.
 */

import { useCallback, useEffect, useRef } from "react"
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
  type ConfirmationResult,
} from "firebase/auth"
import { useFirebaseAuth, useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { resolveBridgeBearer } from "@modules/lib/use-bridge"
import { establishKioskSession, type TokenUser } from "@modules/lib/token-auth"

export interface ExchangeKioskSessionResponse {
  customToken: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  activeMembership?: boolean
  elevatedUntil?: number | null
}

/** Firebase's phone-auth error codes, mapped to the German copy. */
export function smsConfirmErrorMessage(err: unknown): Error | null {
  const code = (err as { code?: string } | null)?.code
  if (code === "auth/invalid-verification-code") return new Error("Code falsch.")
  if (code === "auth/code-expired") {
    return new Error("Der Code ist abgelaufen. Bitte fordere einen neuen an.")
  }
  return null
}

export function useKioskSms() {
  const auth = useFirebaseAuth()
  const functions = useFunctions()
  const confirmationRef = useRef<ConfirmationResult | null>(null)
  const recaptchaHostRef = useRef<HTMLDivElement | null>(null)
  const verifierRef = useRef<RecaptchaVerifier | null>(null)
  useEffect(
    () => () => {
      verifierRef.current?.clear()
      verifierRef.current = null
    },
    [],
  )

  /** Fresh invisible reCAPTCHA for each SMS send (a verifier is consumed by
   *  one signInWithPhoneNumber call). In the emulator the challenge is
   *  bypassed via appVerificationDisabledForTesting (firebase.ts). */
  const newRecaptchaVerifier = useCallback((): RecaptchaVerifier => {
    verifierRef.current?.clear()
    const host = recaptchaHostRef.current
    if (!host) throw new Error("reCAPTCHA host not mounted")
    const slot = document.createElement("div")
    host.replaceChildren(slot)
    const verifier = new RecaptchaVerifier(auth, slot, { size: "invisible" })
    verifierRef.current = verifier
    return verifier
  }, [auth])

  /** Send the SMS to an E.164 number; the confirmation handle is kept. */
  const sendCode = useCallback(
    async (e164: string): Promise<void> => {
      confirmationRef.current = await signInWithPhoneNumber(
        auth,
        e164,
        newRecaptchaVerifier(),
      )
    },
    [auth, newRecaptchaVerifier],
  )

  const clear = useCallback(() => {
    confirmationRef.current = null
  }, [])

  /** Confirm the typed code — signs the browser in as the REAL user. On the
   *  own device that persistent phone session IS the login. */
  const confirm = useCallback(async (code: string): Promise<void> => {
    const confirmation = confirmationRef.current
    if (!confirmation) {
      throw new Error("Kein Code aktiv — bitte fordere einen neuen Code an.")
    }
    try {
      await confirmation.confirm(code)
    } catch (err) {
      throw smsConfirmErrorMessage(err) ?? err
    }
  }, [])

  /**
   * Confirm the typed code, then swap the real phone session for the kiosk
   * `actsAs` session. `expectedUserId` (step-up) makes the server refuse
   * when the confirming phone belongs to a different account. Returns the
   * established TokenUser.
   */
  const confirmAndExchange = useCallback(
    async (code: string, expectedUserId?: string): Promise<TokenUser> => {
      await confirm(code)
      try {
        const bearer = await resolveBridgeBearer()
        const exchange = rpcCallable<
          { bearer?: string; expectedUserId?: string },
          ExchangeKioskSessionResponse
        >(functions, "authCall", "exchangeKioskSession")
        const { data } = await exchange({
          bearer: bearer ?? undefined,
          expectedUserId,
        })
        const tokenUser: TokenUser = {
          tokenId: null,
          userId: data.userId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          userType: data.userType,
          activeMembership: data.activeMembership,
          elevatedUntil: data.elevatedUntil ?? null,
        }
        await establishKioskSession(auth, data.customToken, tokenUser)
        return tokenUser
      } catch (err) {
        // Never leave the real phone session behind on the shared terminal.
        await firebaseSignOut(auth).catch(() => {})
        throw err
      }
    },
    [auth, functions, confirm],
  )

  return { recaptchaHostRef, sendCode, confirm, confirmAndExchange, clear }
}
