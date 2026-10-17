// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"
import { useAuth } from "@modules/lib/auth"
import { useBridge } from "@modules/lib/use-bridge"
import {
  isFeedbackShortcut,
  openFeedback,
  shouldShowMarkerLauncher,
} from "@modules/lib/feedback-widget"

const MARKERIO_PROJECT_ID = "69d16d8f1e2125e7567bff93"

type MarkerMethod = (...args: unknown[]) => void

declare global {
  interface Window {
    markerConfig?: {
      project: string
      source: string
      keyboardShortcuts?: boolean
      customData?: Record<string, unknown>
    }
    Marker?: Record<string, unknown> & {
      capture?: MarkerMethod
      hide?: MarkerMethod
      setReporter?: MarkerMethod
      setCustomData?: MarkerMethod
      on?: MarkerMethod
    }
    __Marker?: Record<string, unknown>
  }
}

// Marker's setReporter reads the project the widget fetches after the shim
// loads. Replayed from the stub queue before that — a signed-in admin on a
// fresh page load — it rejects uncaught, so the reporter waits for "load".
let markerLoaded: Promise<void> | null = null

export interface MarkerIOProps {
  /** Which web app reports come from — lands in the report's custom data. */
  app: "checkout" | "admin"
}

/**
 * Loads the Marker.io widget for every visitor (issue #669). The floating
 * launcher shows only where the operations config sets
 * web.markerLauncherVisible (staging); elsewhere the capture is opened
 * from the header menu (`AppMenu`) or with Ctrl+Shift+PrintScreen.
 */
export function MarkerIO({ app }: MarkerIOProps) {
  const { user, userDoc, sessionKind } = useAuth()
  const { available: kiosk } = useBridge()

  useEffect(() => {
    if (window.__Marker) return

    window.markerConfig = {
      project: MARKERIO_PROJECT_ID,
      source: "snippet",
      // Marker's own shortcut (Alt+U / ⌘+U) stays as a fallback: the OS often
      // swallows PrintScreen before the page sees it.
      keyboardShortcuts: true,
      customData: { app },
    }

    window.__Marker = {}
    const queue: unknown[][] = []
    const stub: Record<string, unknown> = { __cs: queue }
    ;[
      "show",
      "hide",
      "isVisible",
      "capture",
      "cancelCapture",
      "unload",
      "reload",
      "isExtensionInstalled",
      "setReporter",
      "clearReporter",
      "setCustomData",
      "on",
      "off",
    ].forEach((method) => {
      stub[method] = function () {
        const args = Array.prototype.slice.call(arguments)
        args.unshift(method)
        queue.push(args)
      }
    })
    window.Marker = stub
    markerLoaded = new Promise((resolve) => {
      window.Marker?.on?.("load", () => resolve())
    })

    // Queued before the shim loads, so it replays before the launcher paints.
    if (!shouldShowMarkerLauncher(import.meta.env.VITE_MARKER_LAUNCHER_VISIBLE)) {
      window.Marker.hide?.()
    }

    const script = document.createElement("script")
    script.async = true
    script.src = "https://edge.marker.io/latest/shim.js"
    document.head.appendChild(script)

    return () => {
      script.remove()
    }
  }, [app])

  // Say where a report came from, and pre-fill the reporter for members.
  const email = user?.email || userDoc?.email || null
  const fullName = userDoc?.name || null
  useEffect(() => {
    window.Marker?.setCustomData?.({ app, sessionKind, kiosk })
    if (sessionKind !== "real" || !email || !markerLoaded) return
    let cancelled = false
    // The pre-filled reporter is a convenience: a failure must not surface.
    markerLoaded
      .then(() => {
        if (cancelled) return
        return window.Marker?.setReporter?.({ email, fullName: fullName ?? email })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [app, sessionKind, kiosk, email, fullName])

  // Ctrl+Shift+PrintScreen. Listening on keyup: Windows browsers deliver
  // PrintScreen as keyup only.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isFeedbackShortcut(event)) return
      event.preventDefault()
      openFeedback()
    }
    window.addEventListener("keyup", onKey)
    return () => window.removeEventListener("keyup", onKey)
  }, [])

  return null
}
