// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Renderer-side chrome script. The web app (loaded inside the <webview>)
// owns checkout state and NFC navigation; this file is just the wrapper
// that creates the webview, sets its preload, and wires the kiosk-only
// "Neuer Checkout" reset button.

import { wireResetButton } from "./reset-button"

// Mirrors src/types.ts — kept here so renderer.ts stays a self-contained
// browser script with no Node imports.
interface NfcTagEvent {
  physicalUid: string
  url?: string
}
interface Bridge {
  mode: "kiosk"
  features: readonly string[]
  bearer: () => Promise<string | null>
  resetSession: () => Promise<void>
  getUrl: () => Promise<string>
  onUrlChange: (cb: (url: string) => void) => () => void
  onNfcTag: (cb: (p: NfcTagEvent) => void) => () => void
  onOpenOverlay: (cb: (url: string) => void) => () => void
  requestStartOver: () => void
  ackStartOver: () => void
  onStartOverRequest: (cb: () => void) => () => void
  onStartOverAck: (cb: () => void) => () => void
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

// Minimal local typing for Electron's `<webview>` element. We don't pull in
// the full electron types in the renderer tsconfig (they're Node-flavored),
// so re-declare the subset we touch.
interface WebviewElement extends HTMLElement {
  src: string
  setAttribute(name: string, value: string): void
}

const { mode } = window.bridge

document.body.dataset.mode = mode

const container = document.getElementById("webview-container") as HTMLDivElement

// Build absolute file:// URL for the preload script so the webview can
// load it (relative paths don't resolve in webview preload).
const preloadUrl = new URL("../dist/preload.js", window.location.href).href

// Volatile (wipeable) partition so a closed kiosk window equals a closed
// session.
const partition = "persist:kiosk:volatile"

const webview = document.createElement("webview") as WebviewElement
webview.id = "checkout-view"
webview.setAttribute("preload", preloadUrl)
webview.setAttribute("partition", partition)

window.bridge.getUrl().then((url) => {
  webview.src = url
})

webview.addEventListener("dom-ready", () => {
  console.log("Webview loaded:", webview.src)
})

container.appendChild(webview)

// "Neuer Checkout" — asks the loaded web page to show its confirm dialog
// (single confirm UI, issue #415) rather than dropping everything on a single
// tap. The web confirm, when accepted, wipes session storage via the same
// `resetSession` bridge call. If the page doesn't ack within the timeout (a
// wedged webview), `performReset` is the hardware escape hatch: direct
// storage wipe + reload. Wiping storage is what guarantees the previous
// user's Firebase Auth session is gone — navigation alone wouldn't clear
// IndexedDB.
const btnReset = document.getElementById("btn-reset") as HTMLButtonElement

async function performReset(): Promise<void> {
  try {
    await window.bridge.resetSession()
  } catch (err) {
    console.error("Failed to reset session:", err)
  }
  const url = await window.bridge.getUrl()
  webview.src = url
}

// Tapping "Neuer Checkout" also dismisses any open in-kiosk overlay (e.g. the
// Nutzungsbestimmungen page, issue #425) so the page's own confirm dialog
// underneath is visible. Registered before wireResetButton so it runs first on
// click; `closeOverlay` is a hoisted function declaration defined below.
btnReset.addEventListener("click", () => closeOverlay())

wireResetButton({
  onResetClick: (handler) => btnReset.addEventListener("click", handler),
  requestStartOver: () => window.bridge.requestStartOver(),
  onStartOverAck: (cb) => window.bridge.onStartOverAck(cb),
  performReset,
})

// In-kiosk overlay: when the checkout webview asks to open an allowlisted
// off-origin link (e.g. the Nutzungsbestimmungen page), main sends
// "bridge:open-overlay" and we mount a dedicated overlay webview on top of
// the checkout. Closing it destroys the webview so nothing lingers.
const overlay = document.getElementById("overlay") as HTMLDivElement
const overlayViewContainer = document.getElementById(
  "overlay-view-container"
) as HTMLDivElement
const overlayClose = document.getElementById(
  "overlay-close"
) as HTMLButtonElement

let overlayWebview: WebviewElement | null = null

function closeOverlay(): void {
  if (overlayWebview) {
    overlayViewContainer.removeChild(overlayWebview)
    overlayWebview = null
  }
  overlay.hidden = true
}

function openOverlay(url: string): void {
  // Replace any existing overlay so we never stack views.
  closeOverlay()
  const view = document.createElement("webview") as WebviewElement
  view.id = "overlay-view"
  view.setAttribute("partition", partition)
  view.src = url
  overlayWebview = view
  overlayViewContainer.appendChild(view)
  overlay.hidden = false
}

overlayClose.addEventListener("click", closeOverlay)

window.bridge.onOpenOverlay((url) => {
  openOverlay(url)
})
