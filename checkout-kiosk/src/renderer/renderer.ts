// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Renderer-side chrome script. The web app (loaded inside the <webview>)
// owns checkout state and NFC navigation; this file is just the wrapper
// that creates the webview, sets its preload, and wires the kiosk-only
// "Neuer Checkout" reset button.

// Explicit .js extension: this file is emitted as a native ES module and
// loaded directly via <script type="module"> (no bundler), so the browser
// needs the real runtime path — an extensionless specifier fails to resolve
// and silently kills the whole renderer (blank webview).
import { wireResetButton } from "./reset-button.js"

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
  resetSession: (opts?: { keepWindowOpen?: boolean }) => Promise<void>
  getUrl: () => Promise<string>
  onUrlChange: (cb: (url: string) => void) => () => void
  onOpenOverlay: (cb: (url: string) => void) => () => void
  notifyPaymentConfirmed: (paymentUuid: string) => void
  onPaymentConfirmed: (cb: (paymentUuid: string) => void) => () => void
  onNfcTag: (cb: (p: NfcTagEvent) => void) => () => void
  requestStartOver: () => void
  ackStartOver: () => void
  onStartOverRequest: (cb: () => void) => () => void
  onStartOverAck: (cb: () => void) => () => void
  onReloadCheckout: (cb: () => void) => () => void
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
  // Electron <webview> fires did-navigate / did-navigate-in-page with the
  // resulting URL on its DOM event (`event.url`). We only read that field.
  addEventListener(
    type: "did-navigate" | "did-navigate-in-page",
    listener: (event: Event & { url: string }) => void
  ): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
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
// Without `allowpopups`, Electron blocks every window.open / target=_blank
// from the guest BEFORE the embedder is consulted — main.ts's
// setWindowOpenHandler (which routes allowlisted URLs into the in-kiosk
// overlay, issue #416) never fires, so the TWINT paylink appeared to do
// nothing (issue #459). With the attribute set, the handler still denies
// all native popups; it only enables the interception path.
webview.setAttribute("allowpopups", "")

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

// Reload the checkout webview to a fresh page. Dropping the live in-memory
// session is the other half of a reset — a storage wipe alone leaves the
// running page authenticated.
async function reloadCheckout(): Promise<void> {
  const url = await window.bridge.getUrl()
  webview.src = url
}

async function performReset(): Promise<void> {
  try {
    await window.bridge.resetSession()
  } catch (err) {
    console.error("Failed to reset session:", err)
  }
  await reloadCheckout()
}

// Window closed mid-session (session-leak fix): main has already wiped the
// session storage; here we tear down any open overlay and reload the checkout
// webview so nothing of the previous user survives into the next appearance.
window.bridge.onReloadCheckout(() => {
  closeOverlay()
  void reloadCheckout()
})

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

// ---------------------------------------------------------------------------
// In-kiosk overlay (Nutzungsbestimmungen #425 + TWINT paylink #416)
// ---------------------------------------------------------------------------
//
// When the checkout webview asks to open an allowlisted off-origin link (the
// RaiseNow TWINT paylink), main sends "bridge:open-overlay" and we mount a
// dedicated overlay webview on top of the checkout. Closing it destroys the
// webview so nothing lingers. We watch the overlay's URL: once RaiseNow
// navigates to its payment_result view (the customer paid), we tell the
// checkout webview to mark the bill paid and auto-close the overlay after a
// short delay so the customer sees the confirmation.

// Origin of the RaiseNow paylink. Mirrors RAISENOW_PAYLINK_ORIGIN in
// @oww/shared/kiosk-navigation — re-declared here because this renderer is a
// self-contained browser script with no package imports (bare specifiers
// don't resolve at runtime without a bundler).
const RAISENOW_PAYLINK_ORIGIN = "https://pay.raisenow.io"

// Mirrors detectKioskPaymentConfirmation in @oww/shared (load-bearing logic is
// unit-tested there). Returns the payment uuid once RaiseNow signals a
// completed payment via rnw-view=payment_result&epms_payment_uuid=<uuid>.
function detectPaymentUuid(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.origin !== RAISENOW_PAYLINK_ORIGIN) return null
  if (parsed.searchParams.get("rnw-view") !== "payment_result") return null
  const uuid = parsed.searchParams.get("epms_payment_uuid")
  return uuid && uuid.length > 0 ? uuid : null
}

// Delay before the overlay auto-closes after a confirmed payment, so the
// customer can read the RaiseNow confirmation screen.
const OVERLAY_AUTOCLOSE_MS = 10_000

const overlay = document.getElementById("overlay") as HTMLDivElement
const overlayViewContainer = document.getElementById(
  "overlay-view-container"
) as HTMLDivElement
const overlayClose = document.getElementById(
  "overlay-close"
) as HTMLButtonElement

let overlayWebview: WebviewElement | null = null
let overlayAutoCloseTimer: ReturnType<typeof setTimeout> | null = null
// Guard so a single payment is reported once even though RaiseNow may fire
// several in-page navigations on the result view.
let overlayPaymentReported = false

function closeOverlay(): void {
  if (overlayAutoCloseTimer !== null) {
    clearTimeout(overlayAutoCloseTimer)
    overlayAutoCloseTimer = null
  }
  if (overlayWebview) {
    overlayViewContainer.removeChild(overlayWebview)
    overlayWebview = null
  }
  overlayPaymentReported = false
  overlay.hidden = true
}

function handleOverlayNavigation(url: string): void {
  if (overlayPaymentReported) return
  const uuid = detectPaymentUuid(url)
  if (!uuid) return
  overlayPaymentReported = true
  // Tell the checkout webview (web app) to mark the bill paid immediately.
  try {
    window.bridge.notifyPaymentConfirmed(uuid)
  } catch (err) {
    console.error("Failed to notify payment confirmed:", err)
  }
  // Leave the confirmation on screen briefly, then tear the overlay down.
  overlayAutoCloseTimer = setTimeout(closeOverlay, OVERLAY_AUTOCLOSE_MS)
}

function openOverlay(url: string): void {
  // Replace any existing overlay so we never stack views.
  closeOverlay()
  const view = document.createElement("webview") as WebviewElement
  view.id = "overlay-view"
  view.setAttribute("partition", partition)
  // Same rationale as the checkout webview: popups inside the overlay (the
  // payment page may window.open) must reach main.ts's setWindowOpenHandler
  // instead of being silently dropped. Native popups stay denied there.
  view.setAttribute("allowpopups", "")
  view.addEventListener("did-navigate", (e) => handleOverlayNavigation(e.url))
  view.addEventListener("did-navigate-in-page", (e) =>
    handleOverlayNavigation(e.url)
  )
  view.src = url
  overlayWebview = view
  overlayViewContainer.appendChild(view)
  overlay.hidden = false
}

overlayClose.addEventListener("click", closeOverlay)

window.bridge.onOpenOverlay((url) => {
  openOverlay(url)
})
