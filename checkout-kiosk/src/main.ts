// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  webContents,
  type WebContents,
} from "electron"
import path from "node:path"
import {
  decideKioskOverlay,
  isAllowedKioskOverlayNavigation,
  RAISENOW_PAYLINK_ORIGIN,
} from "@oww/shared"
import { resolveConfig } from "./config"
import { startNfc } from "./bridge/nfc"
import type { NfcTagEvent } from "./types"

const config = resolveConfig()

// Off-origin URLs the checkout app links to via target="_blank" that should
// open inside the in-kiosk overlay webview (with a close button) instead of
// being denied. The webview's default deny-all stays in place for everything
// else. werkstattwaedi.ch hosts the Nutzungsbestimmungen page (#425); the
// RaiseNow paylink origin hosts the TWINT payment page (#416).
const OVERLAY_ALLOWLIST = [
  "https://werkstattwaedi.ch",
  RAISENOW_PAYLINK_ORIGIN,
] as const

// Accept self-signed certs in dev (Vite basicSsl plugin)
if (config.isDev) {
  app.commandLine.appendSwitch("ignore-certificate-errors")
}

// Kiosk uses a volatile, wipeable partition so a closed kiosk window equals a
// closed session.
async function clearSession(): Promise<void> {
  try {
    const sess = session.fromPartition(config.partition)
    await sess.clearStorageData()
    await sess.clearCache()
    console.log(`Session cleared (${config.partition})`)
  } catch (err) {
    console.error(
      "Failed to clear session:",
      err instanceof Error ? err.message : err
    )
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: config.productName,
    width: config.windowOpts.width,
    height: config.windowOpts.height,
    frame: true,
    autoHideMenuBar: config.windowOpts.autoHideMenuBar,
    kiosk: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true,
      // Modern Electron defaults — stated explicitly so future upgrades
      // don't silently regress.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  // Keep the OS window title pinned to the product name. The constructor
  // `title` is only a hint: once a document loads, its <title> takes over —
  // which is how the window previously ended up reading the renderer's
  // hardcoded title (issue #421). Re-assert it and block the page from
  // overriding it.
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault()
  })
  mainWindow.setTitle(config.productName)

  // Start maximized: the configured width/height are only a fallback for an
  // un-maximized window. At the fixed 1280×900 default the payment page's
  // QR code and the overlay close button fell below the fold on the kiosk's
  // screen (issue #458).
  mainWindow.maximize()

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"))

  // Lock down the chrome window: no new windows, no navigation away from the
  // bundled renderer page. The webview's own webContents is locked down on
  // attach below.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.on(
    "did-attach-webview",
    (_event, webviewWebContents) => {
      // Window-opens (target="_blank") stay denied so no native window
      // spawns. For allowlisted off-origin links (e.g. the Nutzungsbestimmungen
      // page #425 or the RaiseNow TWINT paylink #416) we instead ask the chrome
      // renderer to mount an in-kiosk overlay webview pointing at the URL — the
      // overlay is torn down on close, so nothing lingers outside the kiosk.
      webviewWebContents.setWindowOpenHandler(({ url }) => {
        if (
          decideKioskOverlay(url, { allowedOverlayOrigins: OVERLAY_ALLOWLIST })
            .open
        ) {
          mainWindow?.webContents.send("bridge:open-overlay", url)
        }
        return { action: "deny" }
      })
      webviewWebContents.on("will-navigate", (event, navUrl) => {
        // The checkout origin is always allowed. Overlay webviews navigate
        // within an allowlisted off-origin (e.g. werkstattwaedi.ch for the
        // Nutzungsbestimmungen page) and across RaiseNow's own domain family
        // for the TWINT payment (pay.raisenow.io → twint.raisenow.io, #470),
        // so permit those too — the overlay is created and torn down by the
        // renderer.
        if (
          !isAllowedKioskOverlayNavigation(navUrl, {
            checkoutOrigin: new URL(config.url).origin,
            allowedOverlayOrigins: OVERLAY_ALLOWLIST,
          })
        ) {
          console.warn(`Blocked webview navigation to off-origin URL: ${navUrl}`)
          event.preventDefault()
        }
      })
    }
  )

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("bridge:url-change", config.url)
  })
}

// NFC subscriber set: every webContents (the chrome renderer + the loaded
// webview) calls `bridge:nfc-subscribe` from its preload and gets removed
// automatically on destroy. The main process broadcasts each tag read to
// all current subscribers — no manual bookkeeping per window.
const nfcSubscribers = new Set<WebContents>()

ipcMain.on("bridge:nfc-subscribe", (event) => {
  const wc = event.sender
  if (nfcSubscribers.has(wc)) return
  nfcSubscribers.add(wc)
  wc.once("destroyed", () => nfcSubscribers.delete(wc))
})

// The chrome renderer detects the RaiseNow payment_result URL on the overlay
// webview and forwards it here; re-broadcast to every subscribed webContents
// so the checkout webview (web app) can mark the bill paid (#416). The
// overlay webview itself is not a subscriber, so it never echoes back.
ipcMain.on("bridge:payment-confirmed", (_event, paymentUuid: string) => {
  for (const wc of nfcSubscribers) {
    try {
      wc.send("bridge:payment-confirmed", paymentUuid)
    } catch (err) {
      console.warn(
        "Failed to dispatch payment-confirmed event:",
        err instanceof Error ? err.message : err
      )
    }
  }
})

function dispatchNfc(event: NfcTagEvent): void {
  // Subscriber count matters while chasing silent taps: 0 means nobody is
  // listening (webview not loaded / preload not run), 1 is usually only the
  // chrome renderer — the checkout web app expects to be the 2nd.
  console.log(
    `[nfc] dispatching tag event to ${nfcSubscribers.size} subscriber(s)`
  )
  for (const wc of nfcSubscribers) {
    try {
      wc.send("bridge:nfc-tag", event)
    } catch (err) {
      console.warn(
        "Failed to dispatch NFC event:",
        err instanceof Error ? err.message : err
      )
    }
  }
}

// Synchronous bootstrap payload delivered to the preload at startup.
// Sandboxed preloads can't `require("./build-config.generated")` reliably, so
// the mode is plumbed through here alongside the feature list. Keep
// this serialisable — `event.returnValue` goes through Electron's
// structured clone.
const bridgeBootstrap = {
  mode: config.mode,
  features: ["nfc"] as readonly string[],
}

// IPC handles backing the `window.bridge.*` preload API
ipcMain.on("bridge:bootstrap", (event) => {
  event.returnValue = bridgeBootstrap
})
// "Neuer Checkout" reset request/ack (issue #415). The chrome renderer asks
// the loaded web page to show its confirm dialog; the page acks once it has
// the request. Both are broadcast to every webContents (chrome renderer +
// webview) — the originating sender simply ignores the echo since it doesn't
// subscribe to the opposite channel.
function broadcastToAll(channel: string): void {
  for (const wc of webContents.getAllWebContents()) {
    try {
      wc.send(channel)
    } catch (err) {
      console.warn(
        `Failed to broadcast ${channel}:`,
        err instanceof Error ? err.message : err
      )
    }
  }
}

ipcMain.on("bridge:request-start-over", () => {
  broadcastToAll("bridge:request-start-over")
})
ipcMain.on("bridge:start-over-ack", () => {
  broadcastToAll("bridge:start-over-ack")
})

ipcMain.handle("bridge:get-url", () => config.url)
ipcMain.handle("bridge:bearer", () => config.bearer || null)
ipcMain.handle("bridge:reset-session", async () => {
  await clearSession()
})

app.whenReady().then(async () => {
  // Always start from a clean session — any leftover IndexedDB / cookies /
  // Firebase Auth state from a previous run is wiped before the renderer
  // attaches its webview.
  await clearSession()
  createWindow()
  startNfc({ onTag: dispatchNfc })
})

app.on("window-all-closed", () => {
  app.quit()
})
