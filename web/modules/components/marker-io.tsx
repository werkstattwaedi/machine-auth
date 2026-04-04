// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"

const MARKERIO_PROJECT_ID = "69d16d8f1e2125e7567bff93"

declare global {
  interface Window {
    markerConfig?: { project: string; source: string }
    Marker?: Record<string, unknown>
    __Marker?: Record<string, unknown>
  }
}

export function MarkerIO() {
  useEffect(() => {
    if (window.__Marker) return

    window.markerConfig = {
      project: MARKERIO_PROJECT_ID,
      source: "snippet",
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

    const script = document.createElement("script")
    script.async = true
    script.src = "https://edge.marker.io/latest/shim.js"
    document.head.appendChild(script)

    return () => {
      script.remove()
    }
  }, [])

  return null
}
