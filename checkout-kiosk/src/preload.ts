// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer } from "electron"
import type { Bridge, BridgeMode, NfcTagEvent } from "./types"

// Per-context subscriber sets. The main process broadcasts NFC events to
// every webContents that has called `bridge:nfc-subscribe`, so a single
// renderer + the loaded webview both get the same events without the main
// process needing to track them by hand.

const nfcCallbacks = new Set<(p: NfcTagEvent) => void>()
let nfcSubscribed = false

ipcRenderer.on("bridge:nfc-tag", (_event, payload: NfcTagEvent) => {
  nfcCallbacks.forEach((cb) => cb(payload))
})

const urlCallbacks = new Set<(url: string) => void>()

ipcRenderer.on("bridge:url-change", (_event, url: string) => {
  urlCallbacks.forEach((cb) => cb(url))
})

// Chrome renderer subscribes to overlay-open requests (e.g. the
// Nutzungsbestimmungen page #425 or the TWINT paylink #416) so it can mount
// the in-kiosk overlay webview.
const overlayCallbacks = new Set<(url: string) => void>()

ipcRenderer.on("bridge:open-overlay", (_event, url: string) => {
  overlayCallbacks.forEach((cb) => cb(url))
})

// "Neuer Checkout" reset request/ack channel (issue #415). The chrome button
// broadcasts `bridge:request-start-over`; the loaded web page listens for it,
// shows the shared confirm dialog, and broadcasts `bridge:start-over-ack` so
// the chrome can cancel its timeout fallback.
const startOverRequestCallbacks = new Set<() => void>()

ipcRenderer.on("bridge:request-start-over", () => {
  startOverRequestCallbacks.forEach((cb) => cb())
})

const startOverAckCallbacks = new Set<() => void>()

ipcRenderer.on("bridge:start-over-ack", () => {
  startOverAckCallbacks.forEach((cb) => cb())
})

// The checkout webview (web app) subscribes to payment-confirmed events:
// the renderer detects the RaiseNow payment_result URL on the overlay and
// asks main to broadcast it here so the web app can mark the bill paid.
const paymentConfirmedCallbacks = new Set<(paymentUuid: string) => void>()

ipcRenderer.on(
  "bridge:payment-confirmed",
  (_event, paymentUuid: string) => {
    paymentConfirmedCallbacks.forEach((cb) => cb(paymentUuid))
  }
)

// Bootstrap (mode + features) is delivered synchronously from main so
// the preload doesn't depend on any sibling module (sandboxed preloads
// can't reliably resolve relative requires).
const bootstrap = ipcRenderer.sendSync("bridge:bootstrap") as {
  mode: BridgeMode
  features: readonly string[]
}

const bridge: Bridge = {
  mode: bootstrap.mode,
  features: bootstrap.features,
  bearer: () => ipcRenderer.invoke("bridge:bearer"),
  resetSession: () => ipcRenderer.invoke("bridge:reset-session"),
  getUrl: () => ipcRenderer.invoke("bridge:get-url"),
  onUrlChange: (cb) => {
    urlCallbacks.add(cb)
    return () => urlCallbacks.delete(cb)
  },
  onOpenOverlay: (cb) => {
    overlayCallbacks.add(cb)
    return () => overlayCallbacks.delete(cb)
  },
  notifyPaymentConfirmed: (paymentUuid) =>
    ipcRenderer.send("bridge:payment-confirmed", paymentUuid),
  onPaymentConfirmed: (cb) => {
    paymentConfirmedCallbacks.add(cb)
    return () => paymentConfirmedCallbacks.delete(cb)
  },
  onNfcTag: (cb) => {
    nfcCallbacks.add(cb)
    if (!nfcSubscribed) {
      nfcSubscribed = true
      ipcRenderer.send("bridge:nfc-subscribe")
    }
    return () => {
      nfcCallbacks.delete(cb)
    }
  },
  requestStartOver: () => ipcRenderer.send("bridge:request-start-over"),
  ackStartOver: () => ipcRenderer.send("bridge:start-over-ack"),
  onStartOverRequest: (cb) => {
    startOverRequestCallbacks.add(cb)
    return () => {
      startOverRequestCallbacks.delete(cb)
    }
  },
  onStartOverAck: (cb) => {
    startOverAckCallbacks.add(cb)
    return () => {
      startOverAckCallbacks.delete(cb)
    }
  },
}

contextBridge.exposeInMainWorld("bridge", bridge)
