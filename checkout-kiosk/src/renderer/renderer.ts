// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Renderer-side chrome script. The web app (loaded inside the <webview>)
// owns checkout state and NFC navigation; this file is just the wrapper
// that creates the webview, sets its preload, and wires the kiosk-only
// "Neuer Checkout" reset button.

// `export {}` makes this file a module so `declare global` below augments
// the existing global scope instead of re-declaring it.
export {}

// Mirrors src/types.ts — kept here so renderer.ts stays a self-contained
// browser script with no Node imports.
interface NfcTagEvent {
  physicalUid: string
  url?: string
}
interface Bridge {
  mode: "kiosk" | "admin"
  features: readonly string[]
  bearer: () => Promise<string | null>
  resetSession: () => Promise<void>
  getUrl: () => Promise<string>
  onUrlChange: (cb: (url: string) => void) => () => void
  onNfcTag: (cb: (p: NfcTagEvent) => void) => () => void
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

const topBar = document.getElementById("top-bar") as HTMLDivElement
const container = document.getElementById("webview-container") as HTMLDivElement

if (mode !== "kiosk") {
  // Admin: hide the kiosk reset button entirely. The web app has its own
  // header chrome.
  topBar.style.display = "none"
}

// Build absolute file:// URL for the preload script so the webview can
// load it (relative paths don't resolve in webview preload).
const preloadUrl = new URL("../dist/preload.js", window.location.href).href

// Partition is mode-specific: kiosk uses a volatile (wipeable) partition,
// admin uses a persistent one so the Firebase Auth session survives
// restarts.
const partition =
  mode === "kiosk" ? "persist:kiosk:volatile" : "persist:admin"

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

// "Neuer Checkout" — kiosk only. Wipes session storage and reloads the base
// URL. Wiping storage is what guarantees the previous user's Firebase Auth
// session is gone — navigation alone wouldn't clear IndexedDB.
if (mode === "kiosk") {
  const btnReset = document.getElementById("btn-reset") as HTMLButtonElement
  btnReset.addEventListener("click", async () => {
    try {
      await window.bridge.resetSession()
    } catch (err) {
      console.error("Failed to reset session:", err)
    }
    const url = await window.bridge.getUrl()
    webview.src = url
  })
}
