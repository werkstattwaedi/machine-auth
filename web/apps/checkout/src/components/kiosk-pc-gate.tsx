// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "@tanstack/react-router"
import { signOut } from "firebase/auth"
import { KIOSK_LAUNCH_URL } from "@oww/shared"
import { Button } from "@modules/components/ui/button"
import { useFirebaseAuth } from "@modules/lib/firebase-context"
import { useBridge } from "@modules/lib/use-bridge"
import {
  resolveKioskPcMarker,
  withoutKioskPcParam,
} from "@/lib/kiosk-pc-marker"

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function openKioskApp(): void {
  window.location.href = KIOSK_LAUNCH_URL
}

/**
 * Keeps the web checkout from running in the browser of the shared kiosk PC
 * (see lib/kiosk-pc-marker.ts). In a marked browser the children are not
 * rendered at all; the visitor gets a page that opens the kiosk app via its
 * `oww-kiosk://` protocol instead.
 *
 * Inert inside the kiosk app itself, which the bridge identifies (its preload
 * exposes it before any page script runs). That webview has its own, wiped
 * storage partition and must never be gated, whatever ends up in it. The
 * kiosk's `?kiosk` URL parameter is deliberately not trusted here: anyone can
 * type it, and it would let a marked browser past the gate.
 */
export function KioskPcGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const auth = useFirebaseAuth()
  const { available: inKiosk } = useBridge()
  // Resolved once per page load; the marker only changes through the URL.
  const [{ marked, action }] = useState(() =>
    inKiosk
      ? { marked: false, action: null }
      : resolveKioskPcMarker(window.location.search, localStorageOrUndefined()),
  )
  const gated = marked && !inKiosk

  // Drop `?kiosk-pc=` from the address bar once applied, so the URL people
  // see (and copy, or get offered by autocomplete) on the terminal is the
  // plain one — sharing it must not arm someone else's browser.
  useEffect(() => {
    if (action === null) return
    const { pathname, search, hash } = window.location
    router.history.replace(`${pathname}${withoutKioskPcParam(search)}${hash}`)
  }, [action, router])

  // The terminal's browser was used for the web checkout before it was
  // marked, so members' logins may still persist in it. Nobody gets past the
  // gate to use them, but disarming the browser (or clearing just the marker)
  // would land the next person in someone else's account.
  useEffect(() => {
    if (!gated) return
    let cancelled = false
    void auth.authStateReady().then(() => {
      if (!cancelled && auth.currentUser) return signOut(auth)
    })
    return () => {
      cancelled = true
    }
  }, [gated, auth])

  useEffect(() => {
    // Hand over right away — except on the arming visit, which is the
    // browser's startup page: popping the kiosk (or a launch prompt) every
    // time the browser opens would be noise. Browsers may still refuse a
    // launch without a click; the button below covers that.
    if (gated && action !== "arm") openKioskApp()
  }, [gated, action])

  if (!gated) return <>{children}</>

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold">
          Bitte die Self-Checkout-App verwenden
        </h1>
        <p className="text-muted-foreground">
          An diesem Computer läuft der Checkout über die Self-Checkout-App. Sie
          meldet dich nach dem Bezahlen automatisch ab, damit niemand nach dir
          in deinem Konto landet.
        </p>
        <Button
          size="lg"
          className="w-full"
          data-testid="open-kiosk-app"
          onClick={openKioskApp}
        >
          Self-Checkout öffnen
        </Button>
        <p className="text-sm text-muted-foreground">
          Du kannst auch einfach deinen Badge an den Leser halten.
        </p>
      </div>
    </main>
  )
}
